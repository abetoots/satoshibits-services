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

/**
 * Adaptive sampling configuration for AdaptiveSampler
 * @internal - Not part of public API, kept for future use
 */
interface AdaptiveSamplerConfig {
  /** time window for resetting counters in milliseconds (default: 60000 = 1 minute) */
  resetInterval?: number;
  /** requests per minute threshold for "high traffic" (default: 1000) */
  highTrafficThreshold?: number;
  /** error rate threshold for increased sampling (default: 0.1 = 10%) */
  highErrorRateThreshold?: number;
  /** multiplier for base rate during high traffic (default: 0.1 = 10x reduction) */
  highTrafficRateMultiplier?: number;
  /**
   * Custom function to control adaptive behavior completely.
   *
   * **Performance Note:** This function is on a hot path and will be invoked for every span.
   * Keep it fast and avoid expensive operations.
   *
   * Return null to use standard adaptive behavior, or return an object to override:
   * - shouldReduce: whether to reduce sampling rate
   * - reducedRate: the rate to use (0.0 to 1.0)
   * - reason: optional reason for telemetry (added to sampling.reason attribute)
   *
   * @example
   * // Only adapt during business hours
   * customAdaptation: (stats) => {
   *   const hour = new Date().getHours();
   *   if (hour >= 9 && hour <= 17 && stats.requestsPerMinute > 100) {
   *     return {
   *       shouldReduce: true,
   *       reducedRate: stats.baseRate * 0.5,
   *       reason: 'business_hours_adaptation'
   *     };
   *   }
   *   return null; // use standard behavior
   * }
   */
  customAdaptation?: (stats: {
    requestCount: number;
    errorCount: number;
    errorRate: number;
    requestsPerMinute: number;
    baseRate: number;
  }) => { shouldReduce: boolean; reducedRate: number; reason?: string } | null;
}

/**
 * Sampling configuration
 *
 * Public API includes commonly-used options for simple sampling strategies.
 * Advanced features (tier-based, operation-based, adaptive sampling) are
 * available internally but not exposed to prevent API bloat.
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
  /** type of sampler to use (default: 'smart') */
  type?: "smart" | "adaptive";
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
  /** adaptive sampling configuration (only used by AdaptiveSampler) */
  adaptive?: AdaptiveSamplerConfig;
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
    if (
      attributes["http.status_code"] &&
      Number(attributes["http.status_code"]) >= 500
    )
      return true;
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
    // convert to 0-1 range
    return Math.abs(hash) / 0x7fffffff;
  }
}

/**
 * Create a smart sampler with default configuration
 */
export function createSmartSampler(config?: SmartSamplerConfig): SmartSampler {
  return new SmartSampler(config);
}

/**
 * Adaptive sampler that adjusts rates based on traffic
 *
 * @internal - Not part of stable public API. Exported only for testing.
 * @deprecated - Use SmartSampler instead. This may be re-introduced in future versions.
 */
export class AdaptiveSampler extends SmartSampler {
  private requestCount = 0;
  private errorCount = 0;
  private lastReset = Date.now();
  private readonly resetInterval: number;
  private readonly highTrafficThreshold: number;
  private readonly highErrorRateThreshold: number;
  private readonly highTrafficRateMultiplier: number;
  private readonly customAdaptation?: AdaptiveSamplerConfig["customAdaptation"];

  // performance optimizations: cache calculated rates
  private cachedHighTrafficRate: number;

  constructor(config: InternalSamplerConfig = {}) {
    super(config);

    // Default values for validation fallback
    const DEFAULTS = {
      RESET_INTERVAL: 60000,
      HIGH_TRAFFIC_THRESHOLD: 1000,
      HIGH_ERROR_RATE_THRESHOLD: 0.1,
      HIGH_TRAFFIC_RATE_MULTIPLIER: 0.1,
      MIN_RESET_INTERVAL: 1000, // 1 second minimum
    };

    // extract adaptive configuration with defaults
    const adaptiveConfig = config.adaptive ?? {};
    let resetInterval = adaptiveConfig.resetInterval ?? DEFAULTS.RESET_INTERVAL;
    let highTrafficThreshold =
      adaptiveConfig.highTrafficThreshold ?? DEFAULTS.HIGH_TRAFFIC_THRESHOLD;
    let highErrorRateThreshold =
      adaptiveConfig.highErrorRateThreshold ??
      DEFAULTS.HIGH_ERROR_RATE_THRESHOLD;
    let highTrafficRateMultiplier =
      adaptiveConfig.highTrafficRateMultiplier ??
      DEFAULTS.HIGH_TRAFFIC_RATE_MULTIPLIER;

    // Validate adaptive configuration
    if (resetInterval < DEFAULTS.MIN_RESET_INTERVAL) {
      console.warn(
        `Invalid resetInterval: ${resetInterval}. Must be >= ${DEFAULTS.MIN_RESET_INTERVAL}ms. Using default ${DEFAULTS.RESET_INTERVAL}ms.`,
      );
      resetInterval = DEFAULTS.RESET_INTERVAL;
    }
    if (highTrafficThreshold < 0) {
      console.warn(
        `Invalid highTrafficThreshold: ${highTrafficThreshold}. Must be non-negative. Using default ${DEFAULTS.HIGH_TRAFFIC_THRESHOLD}.`,
      );
      highTrafficThreshold = DEFAULTS.HIGH_TRAFFIC_THRESHOLD;
    }
    if (highErrorRateThreshold < 0 || highErrorRateThreshold > 1) {
      console.warn(
        `Invalid highErrorRateThreshold: ${highErrorRateThreshold}. Must be between 0 and 1. Using default ${DEFAULTS.HIGH_ERROR_RATE_THRESHOLD}.`,
      );
      highErrorRateThreshold = DEFAULTS.HIGH_ERROR_RATE_THRESHOLD;
    }
    if (highTrafficRateMultiplier < 0 || highTrafficRateMultiplier > 1) {
      console.warn(
        `Invalid highTrafficRateMultiplier: ${highTrafficRateMultiplier}. Must be between 0 and 1. Using default ${DEFAULTS.HIGH_TRAFFIC_RATE_MULTIPLIER}.`,
      );
      highTrafficRateMultiplier = DEFAULTS.HIGH_TRAFFIC_RATE_MULTIPLIER;
    }

    this.resetInterval = resetInterval;
    this.highTrafficThreshold = highTrafficThreshold;
    this.highErrorRateThreshold = highErrorRateThreshold;
    this.highTrafficRateMultiplier = highTrafficRateMultiplier;
    this.customAdaptation = adaptiveConfig.customAdaptation;

    // pre-calculate the high traffic rate
    this.cachedHighTrafficRate =
      this.config.baseRate * this.highTrafficRateMultiplier;
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    // reset counters periodically
    this.resetCountersIfNeeded();

    // track request count
    this.requestCount++;

    // track error count
    if (this.hasError(attributes)) {
      this.errorCount++;
    }

    // calculate stats for adaptation decisions
    const errorRate = this.errorCount / Math.max(this.requestCount, 1);
    const elapsedMs = Date.now() - this.lastReset;
    const requestsPerMinute =
      elapsedMs > 0 ? this.requestCount / (elapsedMs / 60000) : 0;

    // try custom adaptation callback first
    if (this.customAdaptation) {
      try {
        const adaptationResult = this.customAdaptation({
          requestCount: this.requestCount,
          errorCount: this.errorCount,
          errorRate,
          requestsPerMinute,
          baseRate: this.config.baseRate,
        });

        if (adaptationResult) {
          // custom adaptation returned a result - use it
          if (adaptationResult.shouldReduce) {
            // reduce sampling - check if this trace should be sampled at reduced rate
            if (
              this.shouldSampleWithRate(adaptationResult.reducedRate, traceId)
            ) {
              return {
                decision: SamplingDecision.RECORD_AND_SAMPLED,
                attributes: {
                  "sampling.reason":
                    adaptationResult.reason ?? "custom_adaptation",
                  "sampling.adaptive": true,
                  "sampling.requests_per_minute": Math.round(requestsPerMinute),
                },
              };
            } else {
              return {
                decision: SamplingDecision.NOT_RECORD,
              };
            }
          } else {
            // shouldReduce = false, fall through to parent sampler
            return super.shouldSample(
              context,
              traceId,
              spanName,
              spanKind,
              attributes,
              links,
            );
          }
        }
        // customAdaptation returned null, fall through to standard behavior
      } catch (error) {
        console.error(
          "[@satoshibits/observability] AdaptiveSampler: customAdaptation callback threw an error. " +
            "Falling back to standard adaptive behavior. Error:",
          error,
        );
        // fall through to standard behavior
      }
    }

    // standard adaptive behavior: adjust sampling based on error rate
    if (errorRate > this.highErrorRateThreshold) {
      // high error rate - sample more aggressively
      return super.shouldSample(
        context,
        traceId,
        spanName,
        spanKind,
        {
          ...attributes,
          "sampling.adaptive": true,
          "sampling.error_rate": errorRate,
        },
        links,
      );
    }

    // standard adaptive behavior: adjust sampling based on traffic volume
    if (requestsPerMinute > this.highTrafficThreshold) {
      // high traffic - use cached reduced sampling rate
      if (this.shouldSampleWithRate(this.cachedHighTrafficRate, traceId)) {
        return {
          decision: SamplingDecision.RECORD_AND_SAMPLED,
          attributes: {
            "sampling.reason": "base_rate_adjusted",
            "sampling.adaptive": true,
            "sampling.high_traffic": true,
            "sampling.requests_per_minute": Math.round(requestsPerMinute),
          },
        };
      }
      return {
        decision: SamplingDecision.NOT_RECORD,
      };
    }

    return super.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links,
    );
  }

  private resetCountersIfNeeded() {
    const now = Date.now();
    if (now - this.lastReset > this.resetInterval) {
      this.requestCount = 0;
      this.errorCount = 0;
      this.lastReset = now;
    }
  }
}
