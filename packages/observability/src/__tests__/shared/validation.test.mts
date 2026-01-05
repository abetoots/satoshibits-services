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
    it('should handle null metric names gracefully with descriptive warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // observability libraries must not throw - fail gracefully
      expect(() => {
        // @ts-expect-error - Testing null metric name validation
        client.metrics.increment(null);
      }).not.toThrow();

      // should warn with descriptive message about invalid input (L4 fix)
      expect(consoleSpy).toHaveBeenCalled();
      const warningMessage = consoleSpy.mock.calls[0]?.[0];
      expect(typeof warningMessage).toBe('string');
      // warning should mention the issue (metric name or invalid)
      expect(warningMessage).toMatch(/metric|name|invalid|null/i);

      consoleSpy.mockRestore();
    });

    it('should handle undefined metric names gracefully with descriptive warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        // @ts-expect-error - Testing undefined metric name validation
        client.metrics.increment(undefined);
      }).not.toThrow();

      // verify warning content (L4 fix)
      expect(consoleSpy).toHaveBeenCalled();
      const warningMessage = consoleSpy.mock.calls[0]?.[0];
      expect(typeof warningMessage).toBe('string');
      expect(warningMessage).toMatch(/metric|name|invalid|undefined/i);

      consoleSpy.mockRestore();
    });

    it('should handle empty string metric names gracefully with descriptive warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.increment('');
      }).not.toThrow();

      // verify warning content (L4 fix)
      expect(consoleSpy).toHaveBeenCalled();
      const warningMessage = consoleSpy.mock.calls[0]?.[0];
      expect(typeof warningMessage).toBe('string');
      expect(warningMessage).toMatch(/metric|name|invalid|empty/i);

      consoleSpy.mockRestore();
    });
  });

  describe('Metric Value Validation', () => {
    it('should handle NaN values gracefully with descriptive warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.gauge('test_metric', NaN);
      }).not.toThrow();

      // verify warning content (L4 fix)
      expect(consoleSpy).toHaveBeenCalled();
      const warningMessage = consoleSpy.mock.calls[0]?.[0];
      expect(typeof warningMessage).toBe('string');
      expect(warningMessage).toMatch(/value|NaN|invalid|number/i);

      consoleSpy.mockRestore();
    });

    it('should handle Infinity values gracefully with descriptive warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.record('test_metric', Infinity);
      }).not.toThrow();

      // verify warning content (L4 fix)
      expect(consoleSpy).toHaveBeenCalled();
      const warningMessage = consoleSpy.mock.calls[0]?.[0];
      expect(typeof warningMessage).toBe('string');
      expect(warningMessage).toMatch(/value|Infinity|invalid|number/i);

      consoleSpy.mockRestore();
    });

    it('should handle negative Infinity values gracefully with descriptive warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.record('test_metric', -Infinity);
      }).not.toThrow();

      // verify warning content (L4 fix)
      expect(consoleSpy).toHaveBeenCalled();
      const warningMessage = consoleSpy.mock.calls[0]?.[0];
      expect(typeof warningMessage).toBe('string');
      expect(warningMessage).toMatch(/value|Infinity|invalid|number/i);

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

  describe('Unicode and Whitespace Metric Names (L7 Implementation)', () => {
    it('should handle whitespace-only metric names gracefully (no warning per current impl)', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // whitespace-only names should not throw (fail-safe)
      // NOTE: Current implementation uses `!name` check (metric-validation.mts:130)
      // which only catches falsy values (empty string, null, undefined).
      // Whitespace-only strings are truthy in JS so they pass validation.
      // This documents actual behavior; consider if whitespace-only should warn.
      expect(() => {
        client.metrics.increment('   ');
        client.metrics.gauge('\t', 42);
        client.metrics.record('\n', 100);
        client.metrics.increment('  \t\n  ');
      }).not.toThrow();

      // current impl: whitespace-only is truthy, so no warning (unlike empty string)
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle leading/trailing whitespace in metric names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // leading/trailing whitespace should not throw
      expect(() => {
        client.metrics.increment('  metric_name');
        client.metrics.gauge('metric_name  ', 42);
        client.metrics.record('  metric_name  ', 100);
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle unicode characters in metric names without warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // valid unicode names should not throw and should not warn
      expect(() => {
        client.metrics.increment('метрика'); // cyrillic
        client.metrics.gauge('メトリック', 42); // japanese
        client.metrics.record('指标', 100); // chinese
        client.metrics.increment('μέτρηση'); // greek
      }).not.toThrow();

      // valid unicode characters should not trigger warnings
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle emoji in metric names without warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // emoji names should not throw and should not warn
      expect(() => {
        client.metrics.increment('metric_🚀');
        client.metrics.gauge('📊_count', 42);
        client.metrics.record('errors_❌', 100);
      }).not.toThrow();

      // emojis are valid unicode, should not warn
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle mixed unicode and ASCII in metric names without warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        client.metrics.increment('http_requests_успех');
        client.metrics.gauge('api_calls_成功', 42);
        client.metrics.record('cache_hits_キャッシュ', 100);
      }).not.toThrow();

      // mixed unicode + ASCII should not warn
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle control characters in metric names gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // control characters should not throw (fail-safe)
      expect(() => {
        client.metrics.increment('metric\x00name'); // null byte
        client.metrics.gauge('metric\x07bell', 42); // bell
        client.metrics.record('metric\x1bescape', 100); // escape
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle zero-width characters in metric names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // zero-width characters should not throw (fail-safe)
      expect(() => {
        client.metrics.increment('metric\u200Bname'); // zero-width space
        client.metrics.gauge('metric\u200Cname', 42); // zero-width non-joiner
        client.metrics.record('metric\uFEFFname', 100); // byte order mark
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle unpaired surrogate characters gracefully (Gemini fix)', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // unpaired surrogates are invalid unicode but should not throw (fail-safe)
      expect(() => {
        client.metrics.increment('metric\uD800name'); // lone high surrogate
        client.metrics.gauge('metric\uDC00name', 42); // lone low surrogate
        client.metrics.record('\uD800', 100); // just high surrogate
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle very long unicode metric names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // long unicode string should not throw
      const longUnicode = '指'.repeat(200);
      expect(() => {
        client.metrics.increment(longUnicode);
        client.metrics.gauge(longUnicode, 42);
        client.metrics.record(longUnicode, 100);
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle RTL characters in metric names without warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // right-to-left characters should not throw
      expect(() => {
        client.metrics.increment('מדד_בדיקה'); // hebrew
        client.metrics.gauge('مقياس_اختبار', 42); // arabic
        client.metrics.record('آزمایش_متری', 100); // persian
      }).not.toThrow();

      // RTL characters are valid unicode, should not warn
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
