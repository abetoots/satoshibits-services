import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartSampler, normalizeHash } from '../../sampling.mjs';
import { Context, SpanKind, trace, context, TraceFlags, SpanContext, Link } from '@opentelemetry/api';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';

// test subclass to expose protected methods for unit testing
class TestableSmartSampler extends SmartSampler {
  public testHashTraceId(traceId: string): number {
    return this.hashTraceId(traceId);
  }
}

// test subclass that forces a specific RAW hash value and uses PRODUCTION normalizeHash
class ForcedRawHashSmartSampler extends SmartSampler {
  constructor(
    private forcedRawHash: number,
    config?: ConstructorParameters<typeof SmartSampler>[0]
  ) {
    super(config);
  }

  protected hashTraceId(_traceId: string): number {
    // use the ACTUAL production normalizeHash function - no logic duplication
    return normalizeHash(this.forcedRawHash);
  }
}

// simulates BROKEN behavior (without the MIN_INT32 fix) for comparison
function brokenNormalizeHash(hash: number): number {
  // BUG: no MIN_INT32 handling - this is what the bug looked like
  return Math.abs(hash) / 0x7fffffff;
}

// Note: These tests cover both public API (SmartSampler with baseRate, errorRate, slowThresholdMs)
// and internal features (tierRates, isImportantOperation) that are kept for future use but not
// part of the stable public API.
// [H3] Removed AdaptiveSampler tests - class was removed per YAGNI/KISS review

describe('SmartSampler config logic (unit)', () => {
  it('always samples errors and premium customers per config', () => {
    const sampler = new SmartSampler({
      alwaysSample: ['error-span'],
      tierRates: {
        enterprise: 1.0,
      },
      baseRate: 0.1,
    });

    const mockContext = context.active();
    const traceId = 'trace-123';
    const spanName = 'test-span';
    const spanKind = SpanKind.INTERNAL;
    const links: Link[] = [];

    // Simulate sampling decision: always sample span
    let decision = sampler.shouldSample(
      mockContext,
      traceId,
      'error-span',
      spanKind,
      { 'error.type': 'ValidationError' },
      links
    );
    expect(decision.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);

    // Simulate sampling decision: default path (probabilistic)  
    decision = sampler.shouldSample(
      mockContext,
      traceId,
      spanName,
      spanKind,
      { regular: 'attribute' },
      links
    );
    // Decision should be a valid sampling decision number
    expect([SamplingDecision.NOT_RECORD, SamplingDecision.RECORD, SamplingDecision.RECORD_AND_SAMPLED]).toContain(decision.decision);

    // Default path is probabilistic; we can at least call it without throwing
    decision = sampler.shouldSample(
      mockContext,
      traceId,
      spanName,
      spanKind,
      { route: '/api' },
      links
    );
    expect(typeof decision.decision).toBe('number');
  });

  describe('isImportantOperation callback (Issue #8)', () => {
    const mockContext = context.active();
    const traceId = 'trace-123';
    const spanKind = SpanKind.SERVER; // use SERVER for business logic checks
    const links: Link[] = [];

    beforeEach(() => {
      // clear console warn mock before each test
      vi.restoreAllMocks();
    });

    it('should use custom isImportantOperation callback when provided', () => {
      const customCallback = vi.fn(({ spanName }) => {
        // healthcare-specific logic
        return spanName.includes('patient-admission') || spanName.includes('emergency');
      });

      const sampler = new SmartSampler({
        baseRate: 0.1,
        isImportantOperation: customCallback,
      });

      // test: healthcare span should be sampled
      const healthcareDecision = sampler.shouldSample(
        mockContext,
        traceId,
        'patient-admission',
        spanKind,
        {},
        links
      );
      expect(customCallback).toHaveBeenCalled();
      expect(healthcareDecision.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(healthcareDecision.attributes?.['sampling.reason']).toBe('important_operation');

      // test: e-commerce span should NOT be sampled (not in healthcare callback)
      customCallback.mockClear();
      const ecommerceDecision = sampler.shouldSample(
        mockContext,
        traceId,
        'payment-checkout',
        spanKind,
        { 'transaction.value': 5000 },
        links
      );
      expect(customCallback).toHaveBeenCalled();
      // not marked as important by healthcare callback, falls through to base rate
      expect(ecommerceDecision.attributes?.['sampling.reason']).not.toBe('important_operation');
    });

    it('should pass correct context to callback', () => {
      const customCallback = vi.fn(() => false);

      const sampler = new SmartSampler({
        baseRate: 0.1,
        isImportantOperation: customCallback,
      });

      const attributes = { 'user.id': '123', 'order.total': 500 };
      sampler.shouldSample(
        mockContext,
        traceId,
        'test-operation',
        spanKind,
        attributes,
        links
      );

      expect(customCallback).toHaveBeenCalledWith({
        spanName: 'test-operation',
        attributes: attributes,
        businessContext: expect.any(Object),
      });
    });

    it('should not sample any operations as important when no callback provided', () => {
      const sampler = new SmartSampler({
        baseRate: 0.1,
        // no isImportantOperation callback provided
      });

      // test: payment span should NOT be marked as important
      const paymentDecision = sampler.shouldSample(
        mockContext,
        traceId,
        'payment-process',
        spanKind,
        {},
        links
      );
      // should not be marked as important, falls through to base rate
      expect(paymentDecision.attributes?.['sampling.reason']).not.toBe('important_operation');

      // test: checkout span should NOT be marked as important
      const checkoutDecision = sampler.shouldSample(
        mockContext,
        traceId,
        'checkout-process',
        spanKind,
        {},
        links
      );
      expect(checkoutDecision.attributes?.['sampling.reason']).not.toBe('important_operation');
    });

    it('should support e-commerce via custom callback', () => {
      const ecommerceCallback = ({ spanName, attributes, businessContext }: { spanName: string; attributes: Record<string, unknown>; businessContext: Record<string, unknown> }) => {
        // replicate old hardcoded logic as custom callback
        if (spanName.includes('payment') || spanName.includes('checkout')) return true;
        if (spanName.includes('register') || spanName.includes('login') || spanName.includes('auth')) return true;
        if (businessContext.businessFlow === 'checkout' || businessContext.businessFlow === 'payment') return true;
        if (attributes['transaction.value'] && Number(attributes['transaction.value']) > 1000) return true;
        return false;
      };

      const sampler = new SmartSampler({
        baseRate: 0.1,
        isImportantOperation: ecommerceCallback,
      });

      // all e-commerce scenarios should still work
      expect(sampler.shouldSample(mockContext, traceId, 'payment-process', spanKind, {}, links).decision)
        .toBe(SamplingDecision.RECORD_AND_SAMPLED);

      expect(sampler.shouldSample(mockContext, traceId, 'user-login', spanKind, {}, links).decision)
        .toBe(SamplingDecision.RECORD_AND_SAMPLED);

      expect(sampler.shouldSample(
        mockContext,
        traceId,
        'order-create',
        spanKind,
        { 'transaction.value': 5000 },
        links
      ).decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    });

    it('should allow applications to disable importance logic entirely', () => {
      const sampler = new SmartSampler({
        baseRate: 0.1,
        isImportantOperation: () => false, // always return false
      });

      // even payment spans should NOT be marked as important
      const decision = sampler.shouldSample(
        mockContext,
        traceId,
        'payment-process',
        spanKind,
        { 'transaction.value': 10000 },
        links
      );

      // should not be sampled as "important", falls through to base rate
      expect(decision.attributes?.['sampling.reason']).not.toBe('important_operation');
    });

    it('should handle callback errors gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const sampler = new SmartSampler({
        baseRate: 0.1,
        isImportantOperation: () => {
          throw new Error('Simulated callback error');
        },
      });

      // callback throws but sampler should not crash
      const decision = sampler.shouldSample(
        mockContext,
        traceId,
        'test-operation',
        spanKind,
        {},
        links
      );

      // should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('isImportantOperation callback threw an error'),
        expect.any(Error)
      );

      // should treat operation as not important (return false)
      expect(decision.attributes?.['sampling.reason']).not.toBe('important_operation');

      consoleErrorSpy.mockRestore();
    });
  });

  // [H3] Removed AdaptiveSampler config tests (Issue #13) - class removed per YAGNI/KISS review
  // [H3] Removed AdaptiveSampler config validation tests - class removed per YAGNI/KISS review

  // New tests for parent context sampling (trace integrity)
  describe('Parent context sampling (trace integrity)', () => {
    const traceId = 'd4cda95b652f4a1592b449d5929fda1b';
    const links: Link[] = [];

    it('should sample when parent has SAMPLED flag', () => {
      const sampler = new SmartSampler({ baseRate: 0.0 }); // base rate 0 to ensure parent triggers sampling

      // Create a sampled parent context using real OTel API
      const parentSpanContext: SpanContext = {
        traceId,
        spanId: '6e0c63257de34c92',
        traceFlags: TraceFlags.SAMPLED,
      };
      const parentContext = trace.setSpanContext(context.active(), parentSpanContext);

      const result = sampler.shouldSample(
        parentContext,
        traceId,
        'child-span',
        SpanKind.SERVER,
        {},
        links
      );

      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('parent_sampled');
    });

    it('should NOT sample when parent is not sampled', () => {
      const sampler = new SmartSampler({ baseRate: 0.0 }); // base rate 0

      // Create an unsampled parent context
      const parentSpanContext: SpanContext = {
        traceId,
        spanId: '6e0c63257de34c92',
        traceFlags: TraceFlags.NONE, // NOT sampled
      };
      const parentContext = trace.setSpanContext(context.active(), parentSpanContext);

      const result = sampler.shouldSample(
        parentContext,
        traceId,
        'child-span',
        SpanKind.SERVER,
        {},
        links
      );

      // Should fall through to base rate (0.0 = not sampled)
      expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
    });

    it('should respect neverSample > parent sampled priority', () => {
      const sampler = new SmartSampler({
        baseRate: 1.0,
        neverSample: ['blocked-span'],
      });

      // Create sampled parent - normally this would force sampling
      const parentSpanContext: SpanContext = {
        traceId,
        spanId: '6e0c63257de34c92',
        traceFlags: TraceFlags.SAMPLED,
      };
      const parentContext = trace.setSpanContext(context.active(), parentSpanContext);

      const result = sampler.shouldSample(
        parentContext,
        traceId,
        'blocked-span', // in neverSample list
        SpanKind.SERVER,
        {},
        links
      );

      // neverSample takes precedence
      expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
      expect(result.attributes?.['sampling.reason']).toBe('never_sample_list');
    });

    it('should respect alwaysSample > parent sampled priority', () => {
      const sampler = new SmartSampler({
        baseRate: 0.0,
        alwaysSample: ['critical-span'],
      });

      // Even without sampled parent, alwaysSample wins
      const emptyContext = context.active(); // no parent

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'critical-span',
        SpanKind.SERVER,
        {},
        links
      );

      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('always_sample_list');
    });
  });

  // New tests for SpanKind-based sampling logic
  describe('SpanKind-based sampling logic (performance optimization)', () => {
    const traceId = 'test-trace-id';
    const links: Link[] = [];
    const emptyContext = context.active();

    it('should check tier rates for SERVER spans', () => {
      // use operation-specific rate to verify business logic runs for SERVER
      const sampler = new SmartSampler({
        baseRate: 0.0,
        operationRates: { 'test-span': 1.0 },
      });

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'test-span',
        SpanKind.SERVER, // entry point - business logic should execute
        {},
        links
      );

      // operation rate should apply (business logic executed)
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('operation_rate');
    });

    it('should check tier rates for CONSUMER spans', () => {
      // use operation-specific rate to verify business logic runs for CONSUMER
      const sampler = new SmartSampler({
        baseRate: 0.0,
        operationRates: { 'test-span': 1.0 },
      });

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'test-span',
        SpanKind.CONSUMER, // entry point - business logic should execute
        {},
        links
      );

      // operation rate should apply (business logic executed)
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('operation_rate');
    });

    it('should skip tier rate checks for CLIENT spans', () => {
      const sampler = new SmartSampler({
        baseRate: 1.0, // High base rate to ensure sampling
        tierRates: { enterprise: 0.0 }, // Low tier rate (would block if checked)
      });

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'test-span',
        SpanKind.CLIENT, // NOT entry point
        {},
        links
      );

      // CLIENT spans skip tier logic, fall to base rate
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('base_rate');
    });

    it('should skip tier rate checks for INTERNAL spans', () => {
      const sampler = new SmartSampler({
        baseRate: 1.0,
        tierRates: { enterprise: 0.0 },
      });

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'test-span',
        SpanKind.INTERNAL, // NOT entry point
        {},
        links
      );

      // INTERNAL spans skip tier logic
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('base_rate');
    });

    it('should skip tier rate checks for PRODUCER spans', () => {
      const sampler = new SmartSampler({
        baseRate: 1.0,
        tierRates: { enterprise: 0.0 },
      });

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'test-span',
        SpanKind.PRODUCER, // NOT entry point
        {},
        links
      );

      // PRODUCER spans skip tier logic
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('base_rate');
    });
  });

  // New tests for linked trace sampling (async correlation)
  describe('Linked trace sampling (async correlation)', () => {
    const traceId = 'test-trace-id';
    const emptyContext = context.active();

    it('should sample when linked to SAMPLED trace', () => {
      const sampler = new SmartSampler({ baseRate: 0.0 }); // base rate 0

      // Create a link to a sampled trace
      const sampledLink: Link = {
        context: {
          traceId: 'linked-trace-id',
          spanId: 'linked-span-id',
          traceFlags: TraceFlags.SAMPLED,
        },
        attributes: {},
      };

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'async-task',
        SpanKind.INTERNAL,
        {},
        [sampledLink]
      );

      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('linked_trace_sampled');
    });

    it('should NOT sample when links are not sampled', () => {
      const sampler = new SmartSampler({ baseRate: 0.0 });

      // Create a link to an unsampled trace
      const unsampledLink: Link = {
        context: {
          traceId: 'linked-trace-id',
          spanId: 'linked-span-id',
          traceFlags: TraceFlags.NONE, // NOT sampled
        },
        attributes: {},
      };

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'async-task',
        SpanKind.INTERNAL,
        {},
        [unsampledLink]
      );

      // Falls through to base rate
      expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
    });

    it('should handle empty links array', () => {
      const sampler = new SmartSampler({ baseRate: 1.0 });

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'no-links-span',
        SpanKind.INTERNAL,
        {},
        [] // empty links
      );

      // Falls through to base rate
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('base_rate');
    });

    it('should sample if ANY link is sampled', () => {
      const sampler = new SmartSampler({ baseRate: 0.0 });

      const links: Link[] = [
        {
          context: {
            traceId: 'unsampled-1',
            spanId: 'span-1',
            traceFlags: TraceFlags.NONE,
          },
          attributes: {},
        },
        {
          context: {
            traceId: 'sampled',
            spanId: 'span-2',
            traceFlags: TraceFlags.SAMPLED, // This one is sampled
          },
          attributes: {},
        },
        {
          context: {
            traceId: 'unsampled-2',
            spanId: 'span-3',
            traceFlags: TraceFlags.NONE,
          },
          attributes: {},
        },
      ];

      const result = sampler.shouldSample(
        emptyContext,
        traceId,
        'multi-link-span',
        SpanKind.INTERNAL,
        {},
        links
      );

      // Should sample because one link was sampled
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      expect(result.attributes?.['sampling.reason']).toBe('linked_trace_sampled');
    });
  });

  // Doc 4 C1: Math.abs integer overflow fix
  describe('hashTraceId edge cases (Doc 4 C1 Fix)', () => {
    const MIN_INT32 = -2147483648;
    const emptyContext = context.active();
    const links: Link[] = [];

    it('should always return a value between 0 and 1', () => {
      const sampler = new TestableSmartSampler({ baseRate: 0.5 });

      // test with deterministic trace IDs to ensure hash is always in 0-1 range
      const traceIds = [
        '00000000000000000000000000000000',
        'ffffffffffffffffffffffffffffffff',
        'd4cda95b652f4a1592b449d5929fda1b',
        'abcdef1234567890abcdef1234567890',
      ];

      for (const traceId of traceIds) {
        const hash = sampler.testHashTraceId(traceId);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(1);
      }
    });

    it('should handle MIN_INT32 edge case correctly - DIRECT PRODUCTION CODE TEST', () => {
      // DIRECT TEST of the production normalizeHash function
      // This test will FAIL if the MIN_INT32 fix is removed from sampling.mts

      // Test production normalizeHash with MIN_INT32
      const fixedResult = normalizeHash(MIN_INT32);
      expect(fixedResult).toBeLessThanOrEqual(1);
      expect(fixedResult).toBeGreaterThanOrEqual(0);
      expect(fixedResult).toBe(1); // exactly 1.0 (2147483647 / 2147483647)

      // Compare with broken implementation
      const brokenResult = brokenNormalizeHash(MIN_INT32);
      expect(brokenResult).toBeGreaterThan(1); // ~1.0000000004656613

      // This test proves the production fix works
    });

    it('should handle boundary values correctly', () => {
      // Test production normalizeHash with various boundary values
      expect(normalizeHash(0)).toBe(0);
      expect(normalizeHash(1)).toBeCloseTo(1 / 0x7fffffff);
      expect(normalizeHash(-1)).toBeCloseTo(1 / 0x7fffffff);
      expect(normalizeHash(2147483647)).toBe(1); // MAX_INT32
      expect(normalizeHash(-2147483647)).toBeCloseTo(2147483647 / 0x7fffffff);
      expect(normalizeHash(-2147483648)).toBe(1); // MIN_INT32 - the edge case

      // all results should be in [0, 1]
      const testValues = [0, 1, -1, 100, -100, 2147483647, -2147483647, -2147483648];
      for (const val of testValues) {
        const result = normalizeHash(val);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }
    });

    it('should sample correctly with MIN_INT32 hash at high rates', () => {
      // Test using ForcedRawHashSmartSampler which calls production normalizeHash
      // The normalized hash for MIN_INT32 is 1.0

      // hash=1.0, rate=0.9999 => NOT sampled (1.0 < 0.9999 is false)
      const sampler = new ForcedRawHashSmartSampler(MIN_INT32, { baseRate: 0.9999 });
      const result = sampler.shouldSample(
        emptyContext,
        'any-trace-id',
        'test-span',
        SpanKind.INTERNAL,
        {},
        links
      );
      expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
    });

    it('should demonstrate bug impact: broken impl produces invalid hash', () => {
      // This test documents the actual bug impact

      // Broken implementation produces hash > 1.0
      const brokenHash = brokenNormalizeHash(MIN_INT32);
      expect(brokenHash).toBeGreaterThan(1);
      expect(brokenHash).toBeCloseTo(1.0000000004656613);

      // At rate=1.0 (100% sampling), broken hash would NOT be sampled
      // because brokenHash < 1.0 is false
      expect(brokenHash < 1.0).toBe(false);

      // Production normalizeHash fixes this
      const fixedHash = normalizeHash(MIN_INT32);
      expect(fixedHash).toBe(1);
      expect(fixedHash <= 1.0).toBe(true);
    });
  });
});

/**
 * M8: SmartSampler Logic Tests - Error/Slow Detection and Tier Fallbacks
 *
 * These tests specifically target the sampling decision logic gaps identified
 * in the multi-model test quality review:
 * - Error detection via various attribute patterns
 * - Slow operation detection via duration attributes
 * - Tier rate fallbacks when tier is unknown or rate is 0
 */
describe('SmartSampler error detection (M8)', () => {
  const mockContext = context.active();
  const traceId = 'trace-error-detection';
  const spanKind = SpanKind.INTERNAL;
  const links: Link[] = [];

  it('should sample when error attribute is true', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 }); // 0 base rate to prove error override
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'error-span',
      spanKind,
      { error: true },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('error');
  });

  it('should sample when http.status_code >= 500 (numeric)', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'http-error-span',
      spanKind,
      { 'http.status_code': 500 },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('error');
  });

  it('should sample when http.status_code >= 500 (string)', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'http-error-span',
      spanKind,
      { 'http.status_code': '503' },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('error');
  });

  it('should NOT sample when http.status_code < 500', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'http-ok-span',
      spanKind,
      { 'http.status_code': 404 },
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('should NOT sample when http.status_code is 499 (boundary check)', () => {
    // boundary test: 499 is just below the 500 error threshold
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'boundary-status-span',
      spanKind,
      { 'http.status_code': 499 },
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('should sample when status.code is ERROR', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'status-error-span',
      spanKind,
      { 'status.code': 'ERROR' },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('error');
  });

  it('should sample when exception.type is present', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'exception-span',
      spanKind,
      { 'exception.type': 'TypeError' },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('error');
  });

  it('should NOT sample when error attribute is false', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'no-error-span',
      spanKind,
      { error: false },
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('should NOT sample when http.status_code is invalid string (Doc 4 L4 regression)', () => {
    // regression test: prior parseInt implementation would parse "500foo" as 500
    // Number() correctly rejects partial parses
    const sampler = new SmartSampler({ baseRate: 0.0 });

    // "500foo" should NOT be treated as 500
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'invalid-status-span',
      spanKind,
      { 'http.status_code': '500foo' },
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('should NOT sample when http.status_code is non-numeric string', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });

    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'non-numeric-status-span',
      spanKind,
      { 'http.status_code': 'error' },
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });
});

describe('SmartSampler slow operation detection (M8)', () => {
  const mockContext = context.active();
  const traceId = 'trace-slow-detection';
  const spanKind = SpanKind.INTERNAL;
  const links: Link[] = [];

  it('should sample when duration.ms exceeds slowThresholdMs', () => {
    const sampler = new SmartSampler({
      baseRate: 0.0,
      slowThresholdMs: 1000,
    });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'slow-span',
      spanKind,
      { 'duration.ms': 1500 },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('slow_operation');
  });

  it('should sample when duration attribute exceeds slowThresholdMs', () => {
    const sampler = new SmartSampler({
      baseRate: 0.0,
      slowThresholdMs: 500,
    });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'slow-span',
      spanKind,
      { duration: 600 },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('slow_operation');
  });

  it('should sample when slow attribute is true', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'marked-slow-span',
      spanKind,
      { slow: true },
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('slow_operation');
  });

  it('should sample when duration.ms is string exceeding threshold', () => {
    // isSlow uses Number() coercion, so string durations should work
    const sampler = new SmartSampler({
      baseRate: 0.0,
      slowThresholdMs: 1000,
    });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'slow-span-string',
      spanKind,
      { 'duration.ms': '1500' }, // string value
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('slow_operation');
  });

  it('should NOT sample when duration.ms is invalid string', () => {
    const sampler = new SmartSampler({
      baseRate: 0.0,
      slowThresholdMs: 1000,
    });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'invalid-duration-span',
      spanKind,
      { 'duration.ms': 'slow' }, // non-numeric string
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('should NOT sample when duration is negative (clock skew protection)', () => {
    // negative durations can occur due to clock skew or measurement errors
    const sampler = new SmartSampler({
      baseRate: 0.0,
      slowThresholdMs: 1000,
    });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'negative-duration-span',
      spanKind,
      { 'duration.ms': -100 },
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('should NOT sample when duration is below threshold', () => {
    const sampler = new SmartSampler({
      baseRate: 0.0,
      slowThresholdMs: 1000,
    });
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'fast-span',
      spanKind,
      { 'duration.ms': 500 },
      links
    );

    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('should use default slowThresholdMs of 1000 when not configured', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });

    // 999ms should not trigger slow sampling
    const fastResult = sampler.shouldSample(
      mockContext,
      traceId,
      'fast-span',
      spanKind,
      { 'duration.ms': 999 },
      links
    );
    expect(fastResult.decision).toBe(SamplingDecision.NOT_RECORD);

    // 1001ms should trigger slow sampling
    const slowResult = sampler.shouldSample(
      mockContext,
      traceId,
      'slow-span',
      spanKind,
      { 'duration.ms': 1001 },
      links
    );
    expect(slowResult.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(slowResult.attributes?.['sampling.reason']).toBe('slow_operation');
  });
});

describe('SmartSampler tier rate configuration (M8)', () => {
  // note: tier rate APPLICATION (with business context) is tested in SpanKind-based tests above
  // these tests verify tier rate CONFIGURATION and validation

  it('should use default tier rates when not configured', () => {
    // default tier rates: free: 0.01, pro: 0.1, enterprise: 0.5
    const sampler = new SmartSampler({});

    // access config via protected property (cast for test)
    const config = (sampler as unknown as { config: { tierRates: Record<string, number> } }).config;

    expect(config.tierRates.free).toBe(0.01);
    expect(config.tierRates.pro).toBe(0.1);
    expect(config.tierRates.enterprise).toBe(0.5);
  });

  it('should allow custom tier rates', () => {
    const sampler = new SmartSampler({
      tierRates: {
        free: 0.05,
        pro: 0.25,
        enterprise: 0.75,
      },
    });

    const config = (sampler as unknown as { config: { tierRates: Record<string, number> } }).config;

    expect(config.tierRates.free).toBe(0.05);
    expect(config.tierRates.pro).toBe(0.25);
    expect(config.tierRates.enterprise).toBe(0.75);
  });

  it('should reset to defaults if any tier rate is invalid', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const sampler = new SmartSampler({
      tierRates: {
        free: 0.05,
        pro: 1.5, // invalid: > 1.0
        enterprise: 0.75,
      },
    });

    const config = (sampler as unknown as { config: { tierRates: Record<string, number> } }).config;

    // should reset to defaults
    expect(config.tierRates.free).toBe(0.01);
    expect(config.tierRates.pro).toBe(0.1);
    expect(config.tierRates.enterprise).toBe(0.5);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid tier rate for pro')
    );

    consoleSpy.mockRestore();
  });

  it('should fall back to baseRate when no tier matches (via SpanKind logic)', () => {
    // for INTERNAL spans, tier-based sampling is skipped entirely
    // this tests that baseRate is used as fallback
    const sampler = new SmartSampler({
      baseRate: 1.0, // 100% base rate
      tierRates: {
        enterprise: 0.0, // even if enterprise, wouldn't be checked for INTERNAL
      },
    });

    const result = sampler.shouldSample(
      context.active(),
      'trace-internal',
      'internal-span',
      SpanKind.INTERNAL, // INTERNAL skips tier checks
      {},
      []
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('base_rate');
  });

  it('should allow 0% tier rate (falls through to baseRate)', () => {
    // when tier rate is 0, shouldSampleWithRate returns false,
    // so sampling falls through to next priority (baseRate)
    const sampler = new SmartSampler({
      baseRate: 1.0,
      tierRates: {
        enterprise: 0.0, // 0% = never sample via tier
      },
    });

    const config = (sampler as unknown as { config: { tierRates: Record<string, number> } }).config;

    // 0 is a valid rate (means never sample via this tier)
    expect(config.tierRates.enterprise).toBe(0.0);
  });
});

describe('SmartSampler priority ordering (M8)', () => {
  const mockContext = context.active();
  const traceId = 'trace-priority';
  const spanKind = SpanKind.INTERNAL;
  const links: Link[] = [];

  it('should prioritize error sampling over slow sampling', () => {
    const sampler = new SmartSampler({ baseRate: 0.0 });

    // span has both error and slow attributes
    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'error-and-slow-span',
      spanKind,
      {
        error: true,
        'duration.ms': 5000, // also slow
      },
      links
    );

    // error check happens before slow check, so reason should be 'error'
    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('error');
  });

  it('should prioritize neverSample over error attributes', () => {
    const sampler = new SmartSampler({
      baseRate: 0.0,
      neverSample: ['health-check'],
    });

    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'health-check', // in neverSample list
      spanKind,
      { error: true }, // has error
      links
    );

    // neverSample takes priority
    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
    expect(result.attributes?.['sampling.reason']).toBe('never_sample_list');
  });

  it('should prioritize alwaysSample over baseRate of 0', () => {
    const sampler = new SmartSampler({
      baseRate: 0.0, // would not sample
      alwaysSample: ['critical-operation'],
    });

    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'critical-operation',
      spanKind,
      {},
      links
    );

    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(result.attributes?.['sampling.reason']).toBe('always_sample_list');
  });

  it('should prioritize neverSample over alwaysSample (configuration conflict)', () => {
    // edge case: span in both lists - neverSample should win (security/cost control)
    const sampler = new SmartSampler({
      baseRate: 0.0,
      neverSample: ['conflict-span'],
      alwaysSample: ['conflict-span'],
    });

    const result = sampler.shouldSample(
      mockContext,
      traceId,
      'conflict-span',
      spanKind,
      {},
      links
    );

    // neverSample takes priority (checked first in shouldSample)
    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
    expect(result.attributes?.['sampling.reason']).toBe('never_sample_list');
  });
});

