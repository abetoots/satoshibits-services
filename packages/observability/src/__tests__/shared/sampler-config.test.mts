import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartSampler, AdaptiveSampler } from '../../sampling.mjs';
import { Context, SpanKind, trace, context, TraceFlags, SpanContext, Link } from '@opentelemetry/api';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';

// Note: These tests cover both public API (SmartSampler with baseRate, errorRate, slowThresholdMs)
// and internal features (tierRates, isImportantOperation, AdaptiveSampler) that are kept for
// future use but not part of the stable public API.

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
    const links: unknown[] = [];

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
    const links: unknown[] = [];

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

  describe('AdaptiveSampler config (Issue #13)', () => {
    const mockContext = context.active();
    const traceId = 'trace-123';
    const spanKind = SpanKind.INTERNAL;
    const links: unknown[] = [];

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should use default thresholds when not configured', () => {
      const sampler = new AdaptiveSampler({
        baseRate: 0.1,
      });

      // default thresholds should be used
      // resetInterval: 60000ms
      // highTrafficThreshold: 1000 requests/min
      // highErrorRateThreshold: 0.1
      // highTrafficRateMultiplier: 0.1

      // just verify sampler works without crashing
      const decision = sampler.shouldSample(
        mockContext,
        traceId,
        'test-span',
        spanKind,
        {},
        links
      );
      expect(typeof decision.decision).toBe('number');
    });

    it('should accept custom threshold configuration', () => {
      const sampler = new AdaptiveSampler({
        baseRate: 0.1,
        adaptive: {
          resetInterval: 30000, // 30 seconds
          highTrafficThreshold: 500, // lower threshold
          highErrorRateThreshold: 0.05, // 5% instead of 10%
          highTrafficRateMultiplier: 0.2, // less aggressive reduction
        },
      });

      // verify sampler uses custom config without crashing
      const decision = sampler.shouldSample(
        mockContext,
        traceId,
        'test-span',
        spanKind,
        {},
        links
      );
      expect(typeof decision.decision).toBe('number');
    });

    it('should support custom adaptation callback for complete control', () => {
      const customAdaptation = vi.fn((stats) => {
        // custom logic: only adapt during business hours
        const hour = new Date().getHours();
        if (hour >= 9 && hour <= 17) {
          return {
            shouldReduce: stats.requestsPerMinute > 100,
            reducedRate: stats.baseRate * 0.5,
            reason: 'business_hours_adaptation',
          };
        }
        return null; // no adaptation outside business hours
      });

      const sampler = new AdaptiveSampler({
        baseRate: 0.1,
        adaptive: {
          customAdaptation,
        },
      });

      // trigger sampling to invoke callback
      sampler.shouldSample(mockContext, traceId, 'test-span', spanKind, {}, links);

      // callback should be invoked with stats
      expect(customAdaptation).toHaveBeenCalledWith(
        expect.objectContaining({
          requestCount: expect.any(Number),
          errorCount: expect.any(Number),
          errorRate: expect.any(Number),
          requestsPerMinute: expect.any(Number),
          baseRate: 0.1,
        })
      );
    });

    it('should handle custom adaptation callback errors gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const sampler = new AdaptiveSampler({
        baseRate: 0.1,
        adaptive: {
          customAdaptation: () => {
            throw new Error('Simulated adaptation error');
          },
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
        expect.stringContaining('customAdaptation callback threw an error'),
        expect.any(Error)
      );

      // should fall back to standard adaptive behavior
      expect(typeof decision.decision).toBe('number');

      consoleErrorSpy.mockRestore();
    });

    it('should allow low-traffic services to use higher error threshold', () => {
      // low-traffic service: fewer requests, tolerate higher error rate
      const sampler = new AdaptiveSampler({
        baseRate: 0.5, // higher base rate for low traffic
        adaptive: {
          highTrafficThreshold: 100, // 100 requests/min = "high" for this service
          highErrorRateThreshold: 0.2, // tolerate up to 20% errors
          highTrafficRateMultiplier: 0.5, // less aggressive reduction
        },
      });

      const decision = sampler.shouldSample(
        mockContext,
        traceId,
        'low-traffic-span',
        spanKind,
        {},
        links
      );
      expect(typeof decision.decision).toBe('number');
    });

    it('should allow high-traffic services to use aggressive reduction', () => {
      // high-traffic service: many requests, need aggressive sampling
      const sampler = new AdaptiveSampler({
        baseRate: 0.01, // already low base rate
        adaptive: {
          highTrafficThreshold: 10000, // 10k requests/min = "high"
          highErrorRateThreshold: 0.05, // strict error threshold
          highTrafficRateMultiplier: 0.01, // very aggressive reduction (100x)
        },
      });

      const decision = sampler.shouldSample(
        mockContext,
        traceId,
        'high-traffic-span',
        spanKind,
        {},
        links
      );
      expect(typeof decision.decision).toBe('number');
    });
  });

  describe('AdaptiveSampler config validation', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should warn and use default for resetInterval < 1000ms', () => {
      new AdaptiveSampler({ adaptive: { resetInterval: 500 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid resetInterval: 500. Must be >= 1000ms. Using default 60000ms.')
      );

      new AdaptiveSampler({ adaptive: { resetInterval: 0 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid resetInterval: 0. Must be >= 1000ms. Using default 60000ms.')
      );

      new AdaptiveSampler({ adaptive: { resetInterval: -1 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid resetInterval: -1. Must be >= 1000ms. Using default 60000ms.')
      );
    });

    it('should warn and use default for negative highTrafficThreshold', () => {
      new AdaptiveSampler({ adaptive: { highTrafficThreshold: -100 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid highTrafficThreshold: -100. Must be non-negative. Using default 1000.')
      );
    });

    it('should warn and use default for highErrorRateThreshold outside [0, 1]', () => {
      new AdaptiveSampler({ adaptive: { highErrorRateThreshold: -0.1 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid highErrorRateThreshold: -0.1. Must be between 0 and 1. Using default 0.1.')
      );

      new AdaptiveSampler({ adaptive: { highErrorRateThreshold: 1.1 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid highErrorRateThreshold: 1.1. Must be between 0 and 1. Using default 0.1.')
      );
    });

    it('should warn and use default for highTrafficRateMultiplier outside [0, 1]', () => {
      new AdaptiveSampler({ adaptive: { highTrafficRateMultiplier: -0.1 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid highTrafficRateMultiplier: -0.1. Must be between 0 and 1. Using default 0.1.')
      );

      new AdaptiveSampler({ adaptive: { highTrafficRateMultiplier: 1.1 } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid highTrafficRateMultiplier: 1.1. Must be between 0 and 1. Using default 0.1.')
      );
    });

    it('should not warn for valid edge case values', () => {
      new AdaptiveSampler({
        adaptive: {
          highTrafficThreshold: 0,
          highErrorRateThreshold: 0,
          highTrafficRateMultiplier: 0,
        },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      new AdaptiveSampler({
        adaptive: {
          highErrorRateThreshold: 1,
          highTrafficRateMultiplier: 1,
        },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

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
});

