/**
 * Input Validation Tests (Real Client Integration)
 *
 * These tests use a real SmartClient instance to verify production validation logic.
 * This complements the mock-based tests which intentionally skip validation.
 *
 * Purpose: Ensure that the observability library validates inputs correctly and
 * fails gracefully when given invalid data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SmartClient } from '../../index.mjs';
import type { UnifiedObservabilityClient } from '../../unified-smart-client.mjs';

describe('Input Validation (Real Client Integration)', () => {
  let client: UnifiedObservabilityClient;

  beforeEach(async () => {
    // use real client with in-memory exporters
    client = await SmartClient.initialize({
      serviceName: 'validation-test',
      environment: 'node',
      disableInstrumentation: true,
    });
  });

  afterEach(async () => {
    await SmartClient.shutdown();
  });

  describe('Metric Name Validation', () => {
    it('should handle null metric names gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // observability libraries must not throw - fail gracefully
      expect(() => {
        // @ts-expect-error - Testing null metric name validation
        client.metrics.increment(null);
      }).not.toThrow();

      // but should warn about invalid input
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle undefined metric names gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        // @ts-expect-error - Testing undefined metric name validation
        client.metrics.increment(undefined);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle empty string metric names gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.increment('');
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Metric Value Validation', () => {
    it('should handle NaN values gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.gauge('test_metric', NaN);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle Infinity values gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.record('test_metric', Infinity);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle negative Infinity values gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.record('test_metric', -Infinity);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should accept valid numeric values', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.gauge('test_metric', 42);
        client.metrics.record('test_histogram', 123.45);
        client.metrics.increment('test_counter', 5);
      }).not.toThrow();

      // should not warn for valid values
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('High-Cardinality Detection', () => {
    it('should detect curly brace variable patterns', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const dangerousNames = [
        'user_{userId}_requests',
        'api_{tenantId}_calls',
        'request_{requestId}_duration',
      ];

      dangerousNames.forEach(metricName => {
        client.metrics.increment(metricName);
      });

      // verify warnings were emitted for high-cardinality patterns
      expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(dangerousNames.length);

      consoleSpy.mockRestore();
    });

    it('should detect dollar sign variable patterns', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const dangerousNames = [
        'request_${requestId}_duration',
        'user_${userId}_events',
      ];

      dangerousNames.forEach(metricName => {
        client.metrics.increment(metricName);
      });

      expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(dangerousNames.length);

      consoleSpy.mockRestore();
    });

    it('should not warn for safe metric names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const safeNames = [
        'http.requests.total',
        'database.queries.duration',
        'cache.hits',
      ];

      safeNames.forEach(metricName => {
        client.metrics.increment(metricName);
      });

      // should not warn for safe patterns
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Log Message Validation', () => {
    it('should handle null log messages gracefully', () => {
      expect(() => {
        // @ts-expect-error - Testing null log message validation
        client.logs.info(null);
      }).not.toThrow();
    });

    it('should handle undefined log messages gracefully', () => {
      expect(() => {
        // @ts-expect-error - Testing undefined log message validation
        client.logs.debug(undefined);
      }).not.toThrow();
    });

    it('should handle empty string log messages', () => {
      expect(() => {
        client.logs.info('');
      }).not.toThrow();
    });

    it('should accept valid log messages', () => {
      expect(() => {
        client.logs.info('Test message');
        client.logs.debug('Debug message');
        client.logs.warn('Warning message');
        client.logs.error('Error message');
      }).not.toThrow();
    });
  });

  describe('Attribute Validation', () => {
    it('should handle null attributes gracefully', () => {
      expect(() => {
        // @ts-expect-error - Testing null attributes validation
        client.metrics.increment('test', 1, null);
      }).not.toThrow();
    });

    it('should handle undefined attributes gracefully', () => {
      expect(() => {
        client.metrics.increment('test', 1, undefined);
      }).not.toThrow();
    });

    it('should accept valid attribute objects', () => {
      expect(() => {
        client.metrics.increment('test', 1, { environment: 'test', version: '1.0' });
      }).not.toThrow();
    });
  });

  describe('Graceful Degradation', () => {
    it('should continue working after invalid inputs', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // send some invalid inputs
      // @ts-expect-error - Testing null metric name
      client.metrics.increment(null);
      client.metrics.gauge('test', NaN);
      // @ts-expect-error - Testing null log message
      client.logs.info(null);

      // subsequent valid calls should still work
      expect(() => {
        client.metrics.increment('valid_metric', 1);
        client.logs.info('Valid message');
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should never throw errors from the observability library', () => {
      // observability libraries must be fail-safe
      const badInputs = [
        // @ts-expect-error - Testing null metric name
        () => client.metrics.increment(null),
        () => client.metrics.gauge('test', NaN),
        () => client.metrics.record('test', Infinity),
        // @ts-expect-error - Testing null log message
        () => client.logs.info(null),
        // @ts-expect-error - Testing undefined log message
        () => client.logs.debug(undefined),
        () => client.metrics.increment('', 1),
      ];

      badInputs.forEach(fn => {
        expect(fn).not.toThrow();
      });
    });
  });

  describe('Scope Name High-Cardinality Validation (Real Client)', () => {
    // These tests verify that getInstrumentation() validates scope names
    // against high-cardinality patterns in the REAL client (not mock)

    describe('with scopeNameValidation: "strict" (throws errors)', () => {
      let strictClient: UnifiedObservabilityClient;

      beforeEach(async () => {
        strictClient = await SmartClient.create({
          serviceName: 'strict-validation-test',
          environment: 'node',
          disableInstrumentation: true,
          scopeNameValidation: 'strict',
        });
      });

      it('should reject scope names containing user IDs', () => {
        expect(() => {
          strictClient.getInstrumentation('user-123');
        }).toThrow(/High-cardinality scope name detected.*user IDs/i);
      });

      it('should reject scope names containing request IDs', () => {
        expect(() => {
          strictClient.getInstrumentation('request-abc123456');
        }).toThrow(/High-cardinality scope name detected.*request IDs/i);
      });

      it('should reject scope names containing UUIDs', () => {
        expect(() => {
          strictClient.getInstrumentation('550e8400-e29b-41d4-a716-446655440000');
        }).toThrow(/High-cardinality scope name detected.*UUIDs/i);
      });

      it('should reject scope names containing timestamps', () => {
        expect(() => {
          strictClient.getInstrumentation('operation-1234567890123');
        }).toThrow(/High-cardinality scope name detected.*timestamps/i);
      });

      it('should reject scope names containing session IDs', () => {
        expect(() => {
          strictClient.getInstrumentation('session-abc123def456');
        }).toThrow(/High-cardinality scope name detected.*session IDs/i);
      });

      it('should reject scope names containing tenant IDs', () => {
        expect(() => {
          strictClient.getInstrumentation('tenant-456');
        }).toThrow(/High-cardinality scope name detected.*tenant IDs/i);
      });

      it('should reject scope names containing customer IDs', () => {
        expect(() => {
          strictClient.getInstrumentation('customer_789');
        }).toThrow(/High-cardinality scope name detected.*customer IDs/i);
      });

      it('should provide helpful error messages with examples', () => {
        try {
          strictClient.getInstrumentation('user/123');
          // should not reach here
          expect(true).toBe(false);
        } catch (error) {
          const errorMessage = (error as Error).message;

          // verify error message contains helpful guidance
          expect(errorMessage).toContain('Scope names should be static module identifiers');
          expect(errorMessage).toContain('Use attributes for dynamic data');
          expect(errorMessage).toContain('instrument.metrics.increment');
          expect(errorMessage).toContain('https://opentelemetry.io/docs/specs/otel/glossary/#instrumentation-scope');
        }
      });
    });

    describe('with scopeNameValidation: "warn" (default - logs warning)', () => {
      it('should warn but not throw for high-cardinality scope names', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // default client uses 'warn' mode - should not throw
        expect(() => {
          client.getInstrumentation('user-123');
        }).not.toThrow();

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/High-cardinality scope name detected/i),
        );

        consoleSpy.mockRestore();
      });
    });

    it('should accept valid static scope names', () => {
      const validScopes = [
        'my-app/checkout',
        'my-app/inventory',
        '@company/http-client',
        'user-service',
        'payment-processor',
      ];

      validScopes.forEach((scopeName) => {
        expect(() => {
          client.getInstrumentation(scopeName);
        }).not.toThrow();
      });
    });

    it('should warn for unusually long scope names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const longScopeName = 'a'.repeat(150);

      // should not throw, but should warn
      expect(() => {
        client.getInstrumentation(longScopeName);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Scope name is unusually long/i),
      );

      consoleSpy.mockRestore();
    });

    it('should cache valid scopes and reuse them', () => {
      const scope1 = client.getInstrumentation('my-service/module-a');
      const scope2 = client.getInstrumentation('my-service/module-a');

      // should return the same cached instance
      expect(scope1).toBe(scope2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long metric names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const longName = 'x'.repeat(500);

      expect(() => {
        client.metrics.increment(longName);
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle special characters in metric names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const specialNames = [
        'metric@test',
        'metric#test',
        'metric!test',
        'metric with spaces',
      ];

      specialNames.forEach(name => {
        expect(() => {
          client.metrics.increment(name);
        }).not.toThrow();
      });

      consoleSpy.mockRestore();
    });

    it('should handle very large numeric values', () => {
      expect(() => {
        client.metrics.gauge('test', Number.MAX_SAFE_INTEGER);
        client.metrics.gauge('test', Number.MIN_SAFE_INTEGER);
      }).not.toThrow();
    });

    it('should handle zero values', () => {
      expect(() => {
        client.metrics.increment('test', 0);
        client.metrics.gauge('test', 0);
        client.metrics.record('test', 0);
      }).not.toThrow();
    });

    it('should handle negative values', () => {
      expect(() => {
        client.metrics.gauge('test', -42);
        client.metrics.record('test', -123.45);
      }).not.toThrow();
    });
  });
});
