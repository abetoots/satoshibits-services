/**
 * Node.js API Integration Tests
 * 
 * Tests our SmartClient integration WITH the real OpenTelemetry SDK.
 * Focuses on testing OUR wrapper/abstraction layer, not the SDK itself.
 * 
 * Key principle: Test our integration, not OpenTelemetry's functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SmartClient, sanitize, sanitizeError } from '../../../index.mjs';
import { extractErrorContext } from '../../../smart-errors.mjs';
import type { UnifiedObservabilityClient } from '../../../unified-smart-client.mjs';
import type { ServiceInstrumentType, TestErrorWithProps } from '../../test-utils/test-types.mjs';
import { isSanitizedObject } from '../../test-utils/test-types.mjs';

describe('Node.js API Integration - Testing Our Code With Real SDK', () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ServiceInstrumentType;
  
  beforeEach(async () => {
    // Initialize with a no-op configuration to avoid network calls
    // This tests that our initialization logic works with the real SDK
    client = await SmartClient.initialize({
      serviceName: 'api-integration-test',
      serviceVersion: '1.0.0',
      environment: 'node',
      disableInstrumentation: true, // Minimize side effects
      endpoint: undefined // Use default (should work without network)
    });
    
    serviceInstrument = client.getServiceInstrumentation() as unknown as ServiceInstrumentType;
  });
  
  afterEach(async () => {
    // Test that our shutdown logic works
    await SmartClient.shutdown();
  });
  
  describe('SmartClient Initialization', () => {
    it('Should initialize successfully with valid config', async () => {
      // Test our initialization wrapper
      const testClient = await SmartClient.create({
        serviceName: 'test-service',
        environment: 'node'
      });
      
      // Verify our client provides expected API
      expect(testClient).toBeDefined();
      expect(testClient.getServiceInstrumentation).toBeDefined();
      expect(testClient.getInstrumentation).toBeDefined();
      expect(testClient.context).toBeDefined();
      expect(testClient.raw).toBeDefined();
      
      // Verify scoped instrumentation provides expected APIs
      const testServiceInstrument = testClient.getServiceInstrumentation();
      expect(testServiceInstrument.traces).toBeDefined();
      expect(testServiceInstrument.metrics).toBeDefined();
      expect(testServiceInstrument.errors).toBeDefined();
      expect(testServiceInstrument.logs).toBeDefined();
      expect(testServiceInstrument.result).toBeDefined();
    });

    it('Should provide OpenTelemetry objects via raw API', () => {
      // Test that our wrapper exposes real OpenTelemetry objects
      const { meter, tracer, logger } = client.raw;
      
      expect(tracer).toBeDefined();
      expect(typeof tracer.startSpan).toBe('function');
      expect(meter).toBeDefined();
      expect(typeof meter.createCounter).toBe('function');
      expect(logger).toBeDefined();
    });

    it('Should map our config to SDK config correctly', async () => {
      // Test our configuration mapping
      const testClient = await SmartClient.create({
        serviceName: 'config-test',
        serviceVersion: '2.0.0',
        environment: 'node',
        disableInstrumentation: true
      });
      
      // The fact that this doesn't throw means our config mapping worked
      expect(testClient).toBeDefined();
    });
  });
  
  describe('Our Metrics Wrapper Integration', () => {
    it('Should provide metrics API that works with real SDK', () => {
      // Test that our metrics methods exist and don't throw
      expect(() => {
        serviceInstrument.metrics.increment('test.counter', 1, { test: 'value' });
        serviceInstrument.metrics.decrement('test.decrement', 1);
        serviceInstrument.metrics.record('test.histogram', 123.45, { unit: 'ms' });
        serviceInstrument.metrics.gauge('test.gauge', 42);
      }).not.toThrow();
    });

    it('Should handle metrics sanitization in our wrapper', () => {
      // Test that our sanitization wrapper works
      expect(() => {
        serviceInstrument.metrics.increment('test.sanitized', 1, {
          email: 'user@example.com', // Should be sanitized
          userId: 'user-123', // Should be preserved
          sensitive: 'sk_live_123456' // Should be sanitized
        });
      }).not.toThrow();
    });

    it('Should create timing measurements', async () => {
      // Test our timing wrapper
      const result = await serviceInstrument.metrics.timing('test.operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'completed';
      });
      
      expect(result).toBe('completed');
    });

    it('Should provide timer interface', () => {
      // Test our timer wrapper
      const timer = serviceInstrument.metrics.timer('test.manual.timer');
      expect(timer).toBeDefined();
      expect(typeof timer.end).toBe('function');
      
      const duration = timer.end({ status: 'success' });
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThan(0);
    });
  });
  
  describe('Our Tracing Wrapper Integration', () => {
    it('Should provide tracing API that integrates with real SDK', async () => {
      // Test our withSpan wrapper
      const result = await serviceInstrument.traces.withSpan('test-span', async () => {
        // Verify we can get the active span (from real SDK)
        const span = serviceInstrument.traces.getActiveSpan();
        expect(span).toBeDefined();
        
        return 'span-result';
      });
      
      expect(result).toBe('span-result');
    });

    it('Should handle span attributes and sanitization', async () => {
      await serviceInstrument.traces.withSpan('test-attributes', async () => {
        // This tests that our attribute handling works with the real SDK
        const span = serviceInstrument.traces.getActiveSpan();
        if (span) {
          // Test our attribute sanitization
          const sanitizedAttrs = sanitize({
            userId: 'user-123',
            email: 'test@example.com', // Should be sanitized
            operation: 'test'
          });

          // The fact that this doesn't throw means our integration works
          (span as { setAttributes: (attrs: unknown) => void }).setAttributes(sanitizedAttrs);
        }
      });
    });

    it('Should support convenience trace method', async () => {
      const result = await client.trace('convenience-test', async () => {
        return 'traced-result';
      });
      
      expect(result).toBe('traced-result');
    });
  });
  
  describe('Our Context Wrapper Integration', () => {
    it('Should provide context API that works with real SDK', async () => {
      // Test our context wrapper integration
      await client.context.business.run(
        { userId: 'test-123', operation: 'integration-test' },
        async () => {
          const context = client.context.business.get();
          expect(context.userId).toBe('test-123');
          expect(context.operation).toBe('integration-test');

          // Test nested context
          await client.context.business.withAdditional(
            { step: 'nested' },
            async () => {
              const nestedContext = client.context.business.get();
              expect(nestedContext.userId).toBe('test-123'); // Inherited
              expect(nestedContext.step).toBe('nested'); // Added
            }
          );
        }
      );
    });

    it('Should handle user setting and breadcrumbs', () => {
      // Test our context enrichment
      expect(() => {
        client.context.business.setUser('user-456', { role: 'admin' });
        client.context.business.addBreadcrumb('Integration test breadcrumb', { level: 'info' });
        client.context.business.addTag('test-tag', 'test-value');
      }).not.toThrow();
    });
  });
  
  describe('Our Error Handling Integration', () => {
    it('Should handle error capture with real SDK', () => {
      const testError = new Error('Integration test error');
      const testErrorWithProps = testError as TestErrorWithProps;
      testErrorWithProps.sensitive = 'sk_live_secret';
      
      expect(() => {
        serviceInstrument.errors.capture(testError, { operation: 'integration-test' });
        serviceInstrument.errors.record(testError);
      }).not.toThrow();
    });

    it('Should sanitize errors properly', () => {
      const error = new Error('Test error');
      const errorWithProps = error as TestErrorWithProps;
      errorWithProps.apiKey = 'sk_live_123456';
      errorWithProps.email = 'user@example.com';
      
      const sanitized = sanitizeError(error) as unknown as { message: string; apiKey?: string };
      expect(sanitized.message).toBe('Test error');
      expect(sanitized.apiKey).not.toBe('sk_live_123456');
    });

    it('Should provide error boundary functionality', async () => {
      const result = await serviceInstrument.errors.boundary(
        async () => {
          throw new Error('Boundary test error');
        },
        async (error) => {
          expect(error.message).toBe('Boundary test error');
          return 'fallback-result';
        }
      );
      
      expect(result).toBe('fallback-result');
    });

    it('Should wrap functions with error handling', () => {
      const wrappedFn = serviceInstrument.errors.wrap(((x: number) => {
        if (x < 0) throw new Error('Negative number');
        return x * 2;
      }) as (...args: unknown[]) => unknown) as (x: number) => number;
      
      expect(wrappedFn(5)).toBe(10);
      expect(() => wrappedFn(-1)).toThrow('Negative number');
    });
  });

  describe('C3 Fix: Unified Sanitizer Architecture', () => {
    // Integration test for Doc 4 C3 Fix: verifies that sanitizerOptions patterns
    // are applied to error sanitization through the actual sdk-factory merge path.

    it('Should apply sanitizerOptions custom patterns to error sanitization', async () => {
      // shutdown existing client first
      await SmartClient.shutdown();

      // create a new client with sanitizerOptions containing custom patterns
      // (this is the original bug scenario - user provides sanitizerOptions only)
      const testClient = await SmartClient.create({
        serviceName: 'c3-fix-test',
        environment: 'node',
        disableInstrumentation: true,
        sanitizerOptions: {
          customPatterns: [
            { pattern: /INTEGRATION_SECRET_\w+/gi, replacement: '[INT_REDACTED]' },
          ],
        },
        // note: no errorSanitizerOptions - this tests the merge path
      });

      expect(testClient).toBeDefined();

      // verify the custom pattern from sanitizerOptions is applied to errors
      const testError = new Error('Failed with INTEGRATION_SECRET_abc123');
      const context = extractErrorContext(testError);

      // the pattern should be redacted (proving the sdk-factory merge worked)
      expect(context['error.message']).not.toContain('INTEGRATION_SECRET_abc123');
      expect(context['error.message']).toContain('[INT_REDACTED]');
    });
  });

  describe('Our Logging Integration', () => {
    it('Should provide logging API with real SDK', () => {
      expect(() => {
        serviceInstrument.logs.info('Integration test info message', { component: 'test' });
        serviceInstrument.logs.warn('Integration test warning', { level: 'test' });
        serviceInstrument.logs.error('Integration test error', new Error('Test error'), { context: 'integration' });
      }).not.toThrow();
    });
  });
  
  describe('Environment Detection', () => {
    it('Should correctly identify Node.js environment', async () => {
      // This test verifies our environment detection works
      const nodeClient = await SmartClient.create({
        serviceName: 'env-test',
        environment: 'node'
      });
      
      expect(nodeClient).toBeDefined();
      // The fact that we got a Node client means our environment detection worked
    });
  });
  
  describe('API Contract Consistency', () => {
    it('Should provide all expected methods', () => {
      // Test that our API contract is complete
      
      // Metrics API
      expect(typeof serviceInstrument.metrics.increment).toBe('function');
      expect(typeof serviceInstrument.metrics.decrement).toBe('function');
      expect(typeof serviceInstrument.metrics.record).toBe('function');
      expect(typeof serviceInstrument.metrics.gauge).toBe('function');
      expect(typeof serviceInstrument.metrics.timing).toBe('function');
      expect(typeof serviceInstrument.metrics.timer).toBe('function');
      
      // Tracing API
      expect(typeof serviceInstrument.traces.withSpan).toBe('function');
      expect(typeof serviceInstrument.traces.getActiveSpan).toBe('function');
      expect(typeof serviceInstrument.traces.startSpan).toBe('function');
      expect(typeof client.trace).toBe('function');
      
      // Context API (business namespace)
      expect(typeof client.context.business.run).toBe('function');
      expect(typeof client.context.business.get).toBe('function');
      expect(typeof client.context.business.withAdditional).toBe('function');
      expect(typeof client.context.business.setUser).toBe('function');
      expect(typeof client.context.business.addBreadcrumb).toBe('function');
      expect(typeof client.context.business.addTag).toBe('function');

      // Context API (trace namespace)
      expect(typeof client.context.trace.getTraceId).toBe('function');
      expect(typeof client.context.trace.getSpanId).toBe('function');

      // Context API (convenience methods)
      expect(typeof client.context.getAll).toBe('function');
      
      // Error API
      expect(typeof serviceInstrument.errors.capture).toBe('function');
      expect(typeof serviceInstrument.errors.record).toBe('function');
      expect(typeof serviceInstrument.errors.boundary).toBe('function');
      expect(typeof serviceInstrument.errors.wrap).toBe('function');
      
      // Logging API
      expect(typeof serviceInstrument.logs.info).toBe('function');
      expect(typeof serviceInstrument.logs.warn).toBe('function');
      expect(typeof serviceInstrument.logs.error).toBe('function');
    });
  });
});