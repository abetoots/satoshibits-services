/**
 * Smart Sampling Strategy
 *
 * Implements intelligent sampling based on business rules,
 * error conditions, performance, and customer importance.
 */

import {
  Attributes,
  Context,
  Link,
  SpanKind,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import {
  Sampler,
  SamplingDecision,
  SamplingResult,
} from "@opentelemetry/sdk-trace-base";

import { getBusinessContext } from "./enrichment/context.mjs";

// [H3] Removed AdaptiveSamplerConfig interface - was used by removed AdaptiveSampler

/**
 * Sampling configuration
 *
 * Public API includes commonly-used options for simple sampling strategies.
 * Advanced features (tier-based, operation-based sampling) are available
 * internally but not exposed to prevent API bloat.
 */
export interface SmartSamplerConfig {
  /** base sampling rate for normal operations (0.0 to 1.0, default: 0.1) */
  baseRate?: number;
  /** sampling rate for errors (0.0 to 1.0, default: 1.0 = always sample errors) */
  errorRate?: number;
  /** sampling rate for slow operations (0.0 to 1.0, default: 1.0) */
  slowRate?: number;
  /** threshold for slow operations in ms (default: 1000) */
  slowThresholdMs?: number;
  /** always sample these span names regardless of rate */
  alwaysSample?: string[];
  /** never sample these span names */
  neverSample?: string[];
}

/**
 * Internal sampling configuration with advanced features
 * @internal - Not part of public API, used internally by SmartSampler
 */
interface InternalSamplerConfig extends SmartSamplerConfig {
  // [H3] Removed type?: "smart" | "adaptive" - AdaptiveSampler was removed
  /** sampling rates per customer tier */
  tierRates?: {
    free?: number;
    pro?: number;
    enterprise?: number;
  };
  /** sampling rates per operation type */
  operationRates?: Record<string, number>;
  /**
   * Custom function to determine if an operation is important.
   * @internal
   */
  isImportantOperation?: (context: {
    spanName: string;
    attributes: Attributes;
    businessContext: Record<string, unknown>;
  }) => boolean;
  // [H3] Removed adaptive?: AdaptiveSamplerConfig - was used by removed AdaptiveSampler
}

/**
 * Smart sampler that makes intelligent sampling decisions
 */
export class SmartSampler implements Sampler {
  protected config: Required<
    Omit<InternalSamplerConfig, "isImportantOperation" | "adaptive" | "type">
  > & {
    isImportantOperation?: (context: {
      spanName: string;
      attributes: Attributes;
      businessContext: Record<string, unknown>;
    }) => boolean;
  };

  constructor(config: SmartSamplerConfig | InternalSamplerConfig = {}) {
    // cast to internal config to access advanced features
    const internalConfig = config as InternalSamplerConfig;

    // validate sampling rates
    if (
      config.baseRate !== undefined &&
      (config.baseRate < 0 || config.baseRate > 1)
    ) {
      console.warn(
        `Invalid baseRate: ${config.baseRate}. Must be between 0 and 1. Using default 0.1.`,
      );
      config.baseRate = 0.1;
    }
    if (
      config.errorRate !== undefined &&
      (config.errorRate < 0 || config.errorRate > 1)
    ) {
      console.warn(
        `Invalid errorRate: ${config.errorRate}. Must be between 0 and 1. Using default 1.0.`,
      );
      config.errorRate = 1.0;
    }
    if (
      config.slowRate !== undefined &&
      (config.slowRate < 0 || config.slowRate > 1)
    ) {
      console.warn(
        `Invalid slowRate: ${config.slowRate}. Must be between 0 and 1. Using default 1.0.`,
      );
      config.slowRate = 1.0;
    }

    // validate tier rates (internal feature)
    const validatedTierRates = {
      free: internalConfig.tierRates?.free ?? 0.01,
      pro: internalConfig.tierRates?.pro ?? 0.1,
      enterprise: internalConfig.tierRates?.enterprise ?? 0.5,
    };

    for (const [tier, rate] of Object.entries(validatedTierRates)) {
      if (rate < 0 || rate > 1) {
        console.warn(
          `Invalid tier rate for ${tier}: ${rate}. Must be between 0 and 1. Using default.`,
        );
        // reset to defaults
        validatedTierRates.free = 0.01;
        validatedTierRates.pro = 0.1;
        validatedTierRates.enterprise = 0.5;
        break;
      }
    }

    // validate operation rates (internal feature)
    const validatedOperationRates: Record<string, number> = {};
    if (internalConfig.operationRates) {
      for (const [op, rate] of Object.entries(internalConfig.operationRates)) {
        if (rate < 0 || rate > 1) {
          console.warn(
            `Invalid operation rate for ${op}: ${rate}. Must be between 0 and 1. Skipping.`,
          );
        } else {
          validatedOperationRates[op] = rate;
        }
      }
    }

    this.config = {
      baseRate: config.baseRate ?? 0.1,
      errorRate: config.errorRate ?? 1.0,
      slowRate: config.slowRate ?? 1.0,
      slowThresholdMs: config.slowThresholdMs ?? 1000,
      tierRates: validatedTierRates,
      operationRates: validatedOperationRates,
      alwaysSample: config.alwaysSample ?? [],
      neverSample: config.neverSample ?? [],
      isImportantOperation: internalConfig.isImportantOperation,
    };
  }

  /**
   * Make a sampling decision based on context and attributes
   */
  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    // 1. Highest priority: never sample if in the never list
    if (this.config.neverSample.includes(spanName)) {
      return {
        decision: SamplingDecision.NOT_RECORD,
        attributes: { "sampling.reason": "never_sample_list" },
      };
    }

    // 2. High priority: always sample if in the always list
    if (this.config.alwaysSample.includes(spanName)) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { "sampling.reason": "always_sample_list" },
      };
    }

    // 3. CRITICAL: Respect parent's sampling decision to maintain trace integrity
    // This prevents fragmented traces where parent is sampled but children are not
    const parentContext = trace.getSpanContext(context);
    if (parentContext && parentContext.traceFlags & TraceFlags.SAMPLED) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { "sampling.reason": "parent_sampled" },
      };
    }

    // 4. Always sample errors (critical for debugging)
    if (this.hasError(attributes)) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { "sampling.reason": "error" },
      };
    }

    // 5. Always sample slow operations (performance analysis)
    if (this.isSlow(attributes)) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { "sampling.reason": "slow_operation" },
      };
    }

    // 6. Sample if linked from an already-sampled trace (async correlation)
    if (links && links.length > 0) {
      for (const link of links) {
        if (link.context.traceFlags & TraceFlags.SAMPLED) {
          return {
            decision: SamplingDecision.RECORD_AND_SAMPLED,
            attributes: { "sampling.reason": "linked_trace_sampled" },
          };
        }
      }
    }

    // 7. PERFORMANCE: Scope expensive business logic to service entry points only
    // SERVER and CONSUMER spans are entry points; CLIENT and INTERNAL are typically children
    if (spanKind === SpanKind.SERVER || spanKind === SpanKind.CONSUMER) {
      // get business context for tier-based sampling
      const businessContext = getBusinessContext();
      const customerTier = businessContext.customerTier;

      // use tier-based sampling if customer tier is known
      if (customerTier && this.config.tierRates[customerTier] !== undefined) {
        const tierRate = this.config.tierRates[customerTier];
        if (this.shouldSampleWithRate(tierRate, traceId)) {
          return {
            decision: SamplingDecision.RECORD_AND_SAMPLED,
            attributes: {
              "sampling.reason": "customer_tier",
              "sampling.tier": customerTier,
            },
          };
        }
      }

      // check operation-specific rates
      if (this.config.operationRates[spanName] !== undefined) {
        const operationRate = this.config.operationRates[spanName];
        if (this.shouldSampleWithRate(operationRate, traceId)) {
          return {
            decision: SamplingDecision.RECORD_AND_SAMPLED,
            attributes: {
              "sampling.reason": "operation_rate",
              "sampling.operation": spanName,
            },
          };
        }
      }

      // check for important business operations
      if (this.isImportantOperation(spanName, attributes, businessContext)) {
        return {
          decision: SamplingDecision.RECORD_AND_SAMPLED,
          attributes: { "sampling.reason": "important_operation" },
        };
      }
    }

    // 8. Fall back to base sampling rate (for all span kinds)
    if (this.shouldSampleWithRate(this.config.baseRate, traceId)) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: { "sampling.reason": "base_rate" },
      };
    }

    return {
      decision: SamplingDecision.NOT_RECORD,
    };
  }

  /**
   * Return a string representation of the sampler
   */
  toString(): string {
    return `SmartSampler{baseRate=${this.config.baseRate}}`;
  }

  /**
   * Check if attributes indicate an error
   */
  protected hasError(attributes: Attributes): boolean {
    // check for error status
    if (attributes.error === true) return true;
    // Doc 4 L4 Fix: safe numeric coercion for http.status_code
    // Codex review: use Number() not parseInt() to reject partial parses like "500foo"
    const rawStatusCode = attributes["http.status_code"];
    if (rawStatusCode !== undefined) {
      const normalized =
        typeof rawStatusCode === "string" ? rawStatusCode.trim() : rawStatusCode;
      const statusCode = Number(normalized);
      if (Number.isFinite(statusCode) && statusCode >= 500) return true;
    }
    if (attributes["status.code"] === "ERROR") return true;
    if (attributes["exception.type"]) return true;

    return false;
  }

  /**
   * Check if operation is slow
   */
  protected isSlow(attributes: Attributes): boolean {
    // check duration attribute
    const duration = attributes["duration.ms"] ?? attributes.duration;
    if (duration && Number(duration) > this.config.slowThresholdMs) {
      return true;
    }

    // check if marked as slow
    if (attributes.slow === true) return true;

    return false;
  }

  /**
   * Check if this is an important business operation
   * Delegates to application-provided callback with error handling
   */
  private isImportantOperation(
    spanName: string,
    attributes: Attributes,
    businessContext: Record<string, unknown>,
  ): boolean {
    // delegate to application-provided callback
    if (this.config.isImportantOperation) {
      try {
        return this.config.isImportantOperation({
          spanName,
          attributes,
          businessContext,
        });
      } catch (error) {
        console.error(
          "[@satoshibits/observability] SmartSampler: isImportantOperation callback threw an error. " +
            "Treating operation as not important. Error:",
          error,
        );
        return false;
      }
    }

    // no callback provided - no operations are important by default
    return false;
  }

  /**
   * Deterministic sampling based on trace ID
   */
  protected shouldSampleWithRate(rate: number, traceId: string): boolean {
    if (rate <= 0) return false;
    if (rate >= 1) return true;

    // use trace ID for deterministic sampling
    // this ensures all spans in a trace are sampled consistently
    const hash = this.hashTraceId(traceId);
    return hash < rate;
  }

  /**
   * Hash trace ID to a number between 0 and 1
   */
  protected hashTraceId(traceId: string): number {
    // simple hash function for trace ID
    let hash = 0;
    for (let i = 0; i < traceId.length; i++) {
      hash = (hash << 5) - hash + traceId.charCodeAt(i);
      hash = hash & hash; // convert to 32-bit integer
    }
    return normalizeHash(hash);
  }
}

/**
 * Normalize a 32-bit signed integer hash to a value between 0 and 1.
 *
 * Doc 4 C1 Fix: Handle MIN_INT32 edge case where Math.abs(-2147483648) = 2147483648
 * which exceeds 0x7fffffff (2147483647), producing a value > 1.0
 *
 * @internal Exported for testing purposes only - not part of the public API
 * @param hash - 32-bit signed integer hash value
 * @returns Normalized value in range [0, 1]
 */
export function normalizeHash(hash: number): number {
  const absHash = hash === -2147483648 ? 2147483647 : Math.abs(hash);
  return absHash / 0x7fffffff;
}

/**
 * Create a smart sampler with default configuration
 */
export function createSmartSampler(config?: SmartSamplerConfig): SmartSampler {
  return new SmartSampler(config);
}

// [H3] Removed deprecated AdaptiveSampler class (~210 lines)
// @see 3-SIMPLICITY_AND_DEAD_CODE_MULTI_MODEL_REVIEW.md - Issue H3
// Use SmartSampler instead. Can be recovered from git if needed.
