import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isRetryableError,
  configureRetryClassification,
  ErrorCategory,
  categorizeErrorForObservability,
} from '../../smart-errors.mjs';

// Note: These tests cover both public API (retryableCategories)
// and internal features (isRetryable) that are kept for
// future use but not part of the stable public API.

describe('Retry Classification (Issue #7)', () => {
  beforeEach(() => {
    // reset configuration before each test
    vi.restoreAllMocks();
    configureRetryClassification({});
  });

  describe('Default retry behavior', () => {
    it('should consider timeout errors retryable', () => {
      const error = new Error('Request timeout');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should consider network errors retryable', () => {
      const error = new Error('Network connection failed');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should consider rate limit errors retryable', () => {
      const error = new Error('Too many requests');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should consider database errors retryable', () => {
      const error = new Error('Database connection lost');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should consider external service errors retryable', () => {
      const error = new Error('External API failed');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should not consider validation errors retryable', () => {
      const error = new Error('Invalid email format');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not consider authorization errors retryable', () => {
      const error = new Error('Forbidden access');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not consider authentication errors retryable', () => {
      const error = new Error('Unauthorized');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('Custom retry function', () => {
    it('should use custom function for complete control over retry logic', () => {
      // api gateway service - retry only network and timeout
      configureRetryClassification({
        isRetryable: (error, category) => {
          return (
            category === ErrorCategory.TIMEOUT ||
            category === ErrorCategory.NETWORK
          );
        },
      });

      expect(isRetryableError(new Error('Request timeout'))).toBe(true);
      expect(isRetryableError(new Error('Network failed'))).toBe(true);
      expect(isRetryableError(new Error('Rate limited'))).toBe(false); // not retryable in API Gateway
      expect(isRetryableError(new Error('Database error'))).toBe(false);
    });

    it('should allow complex retry logic based on error properties', () => {
      configureRetryClassification({
        isRetryable: (error, category) => {
          // retry if category is retryable AND message doesn't indicate permanent failure
          const temporaryCategories = [
            ErrorCategory.TIMEOUT,
            ErrorCategory.NETWORK,
            ErrorCategory.RATE_LIMIT,
          ];

          if (!temporaryCategories.includes(category)) {
            return false;
          }

          // don't retry if error indicates permanent failure
          if (error.message.includes('permanent')) {
            return false;
          }

          return true;
        },
      });

      expect(isRetryableError(new Error('Network timeout'))).toBe(true);
      expect(isRetryableError(new Error('Network permanent failure'))).toBe(false);
    });

    it('should prioritize custom function over default logic', () => {
      // make validation errors retryable (unusual but demonstrates control)
      configureRetryClassification({
        isRetryable: (error, category) => {
          return category === ErrorCategory.VALIDATION;
        },
      });

      expect(isRetryableError(new Error('Invalid input'))).toBe(true);
      expect(isRetryableError(new Error('Network error'))).toBe(false);
    });
  });

  describe('Custom retryable categories', () => {
    it('should use custom category list when provided', () => {
      // background job service - retry everything except validation
      configureRetryClassification({
        retryableCategories: [
          ErrorCategory.TIMEOUT,
          ErrorCategory.NETWORK,
          ErrorCategory.RATE_LIMIT,
          ErrorCategory.DATABASE,
          ErrorCategory.EXTERNAL_SERVICE,
          ErrorCategory.INTERNAL,
          ErrorCategory.AUTHORIZATION, // retry auth in background jobs
        ],
      });

      expect(isRetryableError(new Error('Timeout'))).toBe(true);
      expect(isRetryableError(new Error('Forbidden'))).toBe(true); // retryable now
      expect(isRetryableError(new Error('Invalid input'))).toBe(false);
    });

    it('should support conservative retry policy', () => {
      // real-time system - only retry network and timeout
      configureRetryClassification({
        retryableCategories: [
          ErrorCategory.TIMEOUT,
          ErrorCategory.NETWORK,
        ],
      });

      expect(isRetryableError(new Error('Timeout'))).toBe(true);
      expect(isRetryableError(new Error('Network error'))).toBe(true);
      expect(isRetryableError(new Error('Rate limited'))).toBe(false);
      expect(isRetryableError(new Error('Database error'))).toBe(false);
    });

    it('should support aggressive retry policy', () => {
      // data pipeline - retry everything except validation
      configureRetryClassification({
        retryableCategories: [
          ErrorCategory.TIMEOUT,
          ErrorCategory.NETWORK,
          ErrorCategory.RATE_LIMIT,
          ErrorCategory.DATABASE,
          ErrorCategory.EXTERNAL_SERVICE,
          ErrorCategory.INTERNAL,
          ErrorCategory.AUTHORIZATION,
          ErrorCategory.AUTHENTICATION,
          ErrorCategory.NOT_FOUND,
        ],
      });

      expect(isRetryableError(new Error('Timeout'))).toBe(true);
      expect(isRetryableError(new Error('Database error'))).toBe(true);
      expect(isRetryableError(new Error('Forbidden'))).toBe(true);
      expect(isRetryableError(new Error('Not found'))).toBe(true);
      expect(isRetryableError(new Error('Invalid input'))).toBe(false); // validation still not retryable
    });
  });

  describe('Error handling in callbacks', () => {
    it('should handle errors in custom retry function gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      configureRetryClassification({
        isRetryable: () => {
          throw new Error('Retry function crashed');
        },
      });

      const error = new Error('Network error');
      // should return false for safety when callback crashes
      expect(isRetryableError(error)).toBe(false);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('isRetryable function threw an error'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Real-world scenarios', () => {
    it('should support API Gateway retry policy', () => {
      // api gateways need fast failure - only retry clear transient errors
      configureRetryClassification({
        retryableCategories: [
          ErrorCategory.TIMEOUT,
          ErrorCategory.NETWORK,
        ],
      });

      expect(isRetryableError(new Error('Connection timeout'))).toBe(true);
      expect(isRetryableError(new Error('Network unreachable'))).toBe(true);
      expect(isRetryableError(new Error('Rate limited'))).toBe(false);
      expect(isRetryableError(new Error('Database error'))).toBe(false);
      expect(isRetryableError(new Error('External service failed'))).toBe(false);
    });

    it('should support background job retry policy', () => {
      // background jobs can retry more aggressively
      configureRetryClassification({
        retryableCategories: [
          ErrorCategory.TIMEOUT,
          ErrorCategory.NETWORK,
          ErrorCategory.RATE_LIMIT,
          ErrorCategory.DATABASE,
          ErrorCategory.EXTERNAL_SERVICE,
          ErrorCategory.INTERNAL,
        ],
      });

      expect(isRetryableError(new Error('Timeout'))).toBe(true);
      expect(isRetryableError(new Error('Database connection lost'))).toBe(true);
      expect(isRetryableError(new Error('External API unavailable'))).toBe(true);
      expect(isRetryableError(new Error('Rate limited'))).toBe(true);
      expect(isRetryableError(new Error('Invalid input'))).toBe(false);
    });

    it('should support real-time system with custom retry logic', () => {
      // real-time systems need ultra-fast decisions
      configureRetryClassification({
        isRetryable: (error, category) => {
          // only retry if timeout is under 100ms
          if (category === ErrorCategory.TIMEOUT) {
            // in real implementation, error would have timeout duration property
            return !error.message.includes('long');
          }

          // retry fast network errors only
          if (category === ErrorCategory.NETWORK) {
            return !error.message.includes('dns'); // dns failures are slow to retry
          }

          return false;
        },
      });

      expect(isRetryableError(new Error('Quick timeout'))).toBe(true);
      expect(isRetryableError(new Error('long timeout'))).toBe(false);
      expect(isRetryableError(new Error('Network connection reset'))).toBe(true);
      expect(isRetryableError(new Error('Network dns failure'))).toBe(false);
      expect(isRetryableError(new Error('Database error'))).toBe(false);
    });

    it('should support data pipeline with status-code based retry logic', () => {
      class HTTPError extends Error {
        constructor(message: string, public statusCode: number) {
          super(message);
          this.name = 'HTTPError';
        }
      }

      // data pipelines often use status codes for retry decisions
      configureRetryClassification({
        isRetryable: (error) => {
          if (error instanceof HTTPError) {
            // retry server errors (5xx) but not client errors (4xx)
            return error.statusCode >= 500 && error.statusCode < 600;
          }

          // default to retrying network/timeout errors
          const category = categorizeErrorForObservability(error);
          return category === ErrorCategory.TIMEOUT || category === ErrorCategory.NETWORK;
        },
      });

      expect(isRetryableError(new HTTPError('Server error', 500))).toBe(true);
      expect(isRetryableError(new HTTPError('Bad gateway', 502))).toBe(true);
      expect(isRetryableError(new HTTPError('Bad request', 400))).toBe(false);
      expect(isRetryableError(new HTTPError('Not found', 404))).toBe(false);
      expect(isRetryableError(new Error('Timeout'))).toBe(true);
    });
  });

  describe('Disable default retry logic', () => {
    it('should allow disabling all automatic retries', () => {
      // explicit retry control - no automatic retries
      configureRetryClassification({
        retryableCategories: [],
      });

      expect(isRetryableError(new Error('Timeout'))).toBe(false);
      expect(isRetryableError(new Error('Network error'))).toBe(false);
      expect(isRetryableError(new Error('Rate limited'))).toBe(false);
    });

    it('should allow opt-in retry with custom function', () => {
      configureRetryClassification({
        isRetryable: (error) => {
          // only retry if error message explicitly says "retry"
          return error.message.toLowerCase().includes('retry');
        },
      });

      expect(isRetryableError(new Error('Please retry this operation'))).toBe(true);
      expect(isRetryableError(new Error('Network error'))).toBe(false);
      expect(isRetryableError(new Error('Timeout'))).toBe(false);
    });
  });
});
