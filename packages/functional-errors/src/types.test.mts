/**
 * Tests for error types and type guards
 */

import { describe, it, expect } from 'vitest';
import {
  createConfigurationError,
  createOperationalError,
  createCriticalError,
  createValidationError,
  createRetryError,
  createCircuitBreakerError,
  createTimeoutError,
  isConfigurationError,
  isOperationalError,
  isCriticalError,
  isValidationError,
  isRetryError,
  isCircuitBreakerError,
  isTimeoutError,
  isRecoverable,
  isRetryable,
  type ErrorType
} from './types.mjs';

describe('Error Type Constructors', () => {
  describe('createConfigurationError', () => {
    it('should create configuration error with correct properties', () => {
      const error = createConfigurationError('Config failed');
      
      expect(error.tag).toBe('configuration');
      expect(error.message).toBe('Config failed');
      expect(error.recoverable).toBe(false);
      expect(error.retryable).toBe(false);
    });

    it('should include context if provided', () => {
      const context = { file: 'config.json', line: 42 };
      const error = createConfigurationError('Config failed', context);
      
      expect(error.context).toEqual(context);
    });
  });

  describe('createOperationalError', () => {
    it('should create operational error with default retryable true', () => {
      const error = createOperationalError('Network error');
      
      expect(error.tag).toBe('operational');
      expect(error.message).toBe('Network error');
      expect(error.recoverable).toBe(true);
      expect(error.retryable).toBe(true);
    });

    it('should allow setting retryable to false', () => {
      const error = createOperationalError('Permission denied', false);
      
      expect(error.retryable).toBe(false);
      expect(error.recoverable).toBe(true); // still recoverable
    });

    it('should include context', () => {
      const context = { statusCode: 500 };
      const error = createOperationalError('Server error', true, context);
      
      expect(error.context).toEqual(context);
    });
  });

  describe('createCriticalError', () => {
    it('should create critical error', () => {
      const error = createCriticalError('System failure');
      
      expect(error.tag).toBe('critical');
      expect(error.message).toBe('System failure');
      expect(error.recoverable).toBe(false);
      expect(error.retryable).toBe(false);
    });

    it('should include cause if provided', () => {
      const cause = new Error('Root cause');
      const error = createCriticalError('System failure', cause);
      
      expect(error.cause).toBe(cause);
    });

    it('should include context', () => {
      const cause = new Error('Root');
      const context = { severity: 'high' };
      const error = createCriticalError('System failure', cause, context);
      
      expect(error.context).toEqual(context);
    });
  });

  describe('createValidationError', () => {
    it('should create validation error', () => {
      const error = createValidationError('Invalid input');
      
      expect(error.tag).toBe('validation');
      expect(error.message).toBe('Invalid input');
      expect(error.recoverable).toBe(true);
      expect(error.retryable).toBe(false);
    });

    it('should include field errors', () => {
      const fields = {
        email: ['Invalid format', 'Required'],
        password: ['Too short']
      };
      const error = createValidationError('Form invalid', fields);
      
      expect(error.fields).toEqual(fields);
    });

    it('should include context', () => {
      const fields = { email: ['Invalid'] };
      const context = { form: 'signup' };
      const error = createValidationError('Invalid', fields, context);
      
      expect(error.context).toEqual(context);
    });
  });

  describe('createRetryError', () => {
    it('should create retry error with proper message', () => {
      const lastError = createOperationalError('Network timeout');
      const error = createRetryError(3, lastError);
      
      expect(error.tag).toBe('retry');
      expect(error.message).toBe('Maximum retry attempts (3) exceeded');
      expect(error.recoverable).toBe(false);
      expect(error.retryable).toBe(false);
      expect(error.attempts).toBe(3);
      expect(error.lastError).toBe(lastError);
    });

    it('should include context', () => {
      const lastError = createOperationalError('Failed');
      const context = { operation: 'fetch' };
      const error = createRetryError(5, lastError, context);

      expect(error.context).toEqual(context);
    });

    describe('edge cases', () => {
      it('should handle zero attempts', () => {
        const lastError = createOperationalError('Failed');
        const error = createRetryError(0, lastError);

        expect(error.attempts).toBe(0);
        expect(error.message).toBe('Maximum retry attempts (0) exceeded');
        expect(error.lastError).toBe(lastError);
      });

      it('should handle negative attempts', () => {
        const lastError = createOperationalError('Failed');
        const error = createRetryError(-3, lastError);

        expect(error.attempts).toBe(-3);
        expect(error.message).toBe('Maximum retry attempts (-3) exceeded');
        expect(error.lastError).toBe(lastError);
      });

      it('should handle very large attempt counts', () => {
        const lastError = createOperationalError('Failed');
        const largeCount = Number.MAX_SAFE_INTEGER;
        const error = createRetryError(largeCount, lastError);

        expect(error.attempts).toBe(largeCount);
        expect(error.message).toBe(`Maximum retry attempts (${largeCount}) exceeded`);
        expect(error.lastError).toBe(lastError);
      });

      it('should handle nested RetryError as lastError', () => {
        const originalError = createOperationalError('Root cause');
        const firstRetry = createRetryError(3, originalError);
        const nestedRetry = createRetryError(2, firstRetry);

        expect(isRetryError(nestedRetry.lastError)).toBe(true);
        if (isRetryError(nestedRetry.lastError)) {
          expect(nestedRetry.lastError.lastError).toBe(originalError);
          expect(nestedRetry.lastError.attempts).toBe(3);
        }
        expect(nestedRetry.attempts).toBe(2);
      });

      it('should preserve error chain for debugging', () => {
        // create a chain: original -> first retry -> second retry
        const originalError = createOperationalError('Network timeout', true, {
          url: 'https://api.example.com',
          statusCode: 504
        });
        const firstRetry = createRetryError(3, originalError, {
          retryStrategy: 'exponential-backoff'
        });
        const secondRetry = createRetryError(2, firstRetry, {
          finalAttempt: true
        });

        // verify entire chain is preserved
        expect(secondRetry.lastError).toBe(firstRetry);
        expect(isRetryError(secondRetry.lastError)).toBe(true);

        if (isRetryError(secondRetry.lastError)) {
          expect(secondRetry.lastError.lastError).toBe(originalError);
          expect(isOperationalError(secondRetry.lastError.lastError)).toBe(true);

          // verify context is preserved at each level
          expect(secondRetry.context?.finalAttempt).toBe(true);
          expect(secondRetry.lastError.context?.retryStrategy).toBe('exponential-backoff');
          if (isOperationalError(secondRetry.lastError.lastError)) {
            expect(secondRetry.lastError.lastError.context?.url).toBe('https://api.example.com');
            expect(secondRetry.lastError.lastError.context?.statusCode).toBe(504);
          }
        }
      });
    });
  });

  describe('createCircuitBreakerError', () => {
    it('should create circuit breaker error for open state', () => {
      const error = createCircuitBreakerError('open');
      
      expect(error.tag).toBe('circuit-breaker');
      expect(error.message).toBe('Circuit breaker is open');
      expect(error.recoverable).toBe(true);
      expect(error.retryable).toBe(false);
      expect(error.state).toBe('open');
    });

    it('should include next attempt time', () => {
      const nextAttempt = new Date(Date.now() + 60000);
      const error = createCircuitBreakerError('open', nextAttempt);
      
      expect(error.nextAttempt).toBe(nextAttempt);
    });

    it('should handle half-open state', () => {
      const error = createCircuitBreakerError('half-open');
      
      expect(error.message).toBe('Circuit breaker is half-open');
      expect(error.state).toBe('half-open');
    });

    it('should include context', () => {
      const context = { circuit: 'main' };
      const error = createCircuitBreakerError('open', undefined, context);
      
      expect(error.context).toEqual(context);
    });
  });

  describe('createTimeoutError', () => {
    it('should create timeout error with correct properties', () => {
      const error = createTimeoutError('fetchData', 5000);

      expect(error.tag).toBe('timeout');
      expect(error.message).toBe('fetchData timed out after 5000ms');
      expect(error.operationName).toBe('fetchData');
      expect(error.timeoutMs).toBe(5000);
      expect(error.recoverable).toBe(true);
      expect(error.retryable).toBe(true);
    });

    it('should include context if provided', () => {
      const context = { operation: 'fetchData', url: '/api/data' };
      const error = createTimeoutError('fetchData', 3000, context);

      expect(error.context).toEqual(context);
    });
  });
});

describe('Type Guards', () => {
  describe('isConfigurationError', () => {
    it('should identify configuration errors', () => {
      const configError = createConfigurationError('config error');
      expect(isConfigurationError(configError)).toBe(true);
    });

    it('should return false for non-configuration errors', () => {
      const otherErrors = [
        createOperationalError('operational'),
        createCriticalError('critical'),
        createValidationError('validation'),
        createRetryError(3, createOperationalError('retry')),
        createCircuitBreakerError('open'),
        createTimeoutError('timeout', 1000)
      ];

      otherErrors.forEach(error => {
        expect(isConfigurationError(error)).toBe(false);
      });
    });
  });

  describe('isOperationalError', () => {
    it('should identify operational errors', () => {
      const opError = createOperationalError('operational error');
      expect(isOperationalError(opError)).toBe(true);
    });

    it('should return false for non-operational errors', () => {
      const otherErrors = [
        createConfigurationError('config'),
        createCriticalError('critical'),
        createValidationError('validation'),
        createRetryError(3, createOperationalError('retry')),
        createCircuitBreakerError('open'),
        createTimeoutError('timeout', 1000)
      ];

      otherErrors.forEach(error => {
        expect(isOperationalError(error)).toBe(false);
      });
    });
  });

  describe('isCriticalError', () => {
    it('should identify critical errors', () => {
      const criticalError = createCriticalError('critical error');
      expect(isCriticalError(criticalError)).toBe(true);
    });

    it('should return false for non-critical errors', () => {
      const otherErrors = [
        createConfigurationError('config'),
        createOperationalError('operational'),
        createValidationError('validation'),
        createRetryError(3, createOperationalError('retry')),
        createCircuitBreakerError('open'),
        createTimeoutError('timeout', 1000)
      ];

      otherErrors.forEach(error => {
        expect(isCriticalError(error)).toBe(false);
      });
    });
  });

  describe('isValidationError', () => {
    it('should identify validation errors', () => {
      const validationError = createValidationError('validation error');
      expect(isValidationError(validationError)).toBe(true);
    });

    it('should return false for non-validation errors', () => {
      const otherErrors = [
        createConfigurationError('config'),
        createOperationalError('operational'),
        createCriticalError('critical'),
        createRetryError(3, createOperationalError('retry')),
        createCircuitBreakerError('open'),
        createTimeoutError('timeout', 1000)
      ];

      otherErrors.forEach(error => {
        expect(isValidationError(error)).toBe(false);
      });
    });
  });

  describe('isRetryError', () => {
    it('should identify retry errors', () => {
      const retryError = createRetryError(3, createOperationalError('failed'));
      expect(isRetryError(retryError)).toBe(true);
    });

    it('should return false for non-retry errors', () => {
      const otherErrors = [
        createConfigurationError('config'),
        createOperationalError('operational'),
        createCriticalError('critical'),
        createValidationError('validation'),
        createCircuitBreakerError('open'),
        createTimeoutError('timeout', 1000)
      ];

      otherErrors.forEach(error => {
        expect(isRetryError(error)).toBe(false);
      });
    });
  });

  describe('isCircuitBreakerError', () => {
    it('should identify circuit breaker errors', () => {
      const cbError = createCircuitBreakerError('open');
      expect(isCircuitBreakerError(cbError)).toBe(true);
    });

    it('should return false for non-circuit-breaker errors', () => {
      const otherErrors = [
        createConfigurationError('config'),
        createOperationalError('operational'),
        createCriticalError('critical'),
        createValidationError('validation'),
        createRetryError(3, createOperationalError('retry')),
        createTimeoutError('timeout', 1000)
      ];

      otherErrors.forEach(error => {
        expect(isCircuitBreakerError(error)).toBe(false);
      });
    });
  });

  describe('isTimeoutError', () => {
    it('should identify timeout errors', () => {
      const timeoutError = createTimeoutError('fetchData', 5000);
      expect(isTimeoutError(timeoutError)).toBe(true);
    });

    it('should return false for non-timeout errors', () => {
      const otherErrors = [
        createConfigurationError('config'),
        createOperationalError('operational'),
        createCriticalError('critical'),
        createValidationError('validation'),
        createRetryError(3, createOperationalError('retry')),
        createCircuitBreakerError('open')
      ];

      otherErrors.forEach(error => {
        expect(isTimeoutError(error)).toBe(false);
      });
    });
  });
});

describe('Error Properties', () => {
  describe('isRecoverable', () => {
    it('should identify recoverable errors', () => {
      const recoverableErrors = [
        createOperationalError('op'),
        createValidationError('val'),
        createCircuitBreakerError('open')
      ];
      
      recoverableErrors.forEach(error => {
        expect(isRecoverable(error)).toBe(true);
      });
    });

    it('should identify non-recoverable errors', () => {
      const nonRecoverableErrors = [
        createConfigurationError('config'),
        createCriticalError('critical'),
        createRetryError(3, createOperationalError('retry'))
      ];
      
      nonRecoverableErrors.forEach(error => {
        expect(isRecoverable(error)).toBe(false);
      });
    });
  });

  describe('isRetryable', () => {
    it('should identify retryable errors', () => {
      const retryableError = createOperationalError('network', true);
      expect(isRetryable(retryableError)).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      const nonRetryableErrors = [
        createConfigurationError('config'),
        createCriticalError('critical'),
        createValidationError('validation'),
        createOperationalError('permission', false),
        createRetryError(3, createOperationalError('retry')),
        createCircuitBreakerError('open')
      ];
      
      nonRetryableErrors.forEach(error => {
        expect(isRetryable(error)).toBe(false);
      });
    });
  });
});

describe('Type Safety', () => {
  it('should have readonly properties', () => {
    const error = createOperationalError('test');

    // TypeScript prevents these at compile time
    // At runtime, JavaScript objects are mutable unless frozen
    // But our types declare them as readonly which is what matters

    // the properties exist and have correct values
    expect(error.message).toBe('test');
    expect(error.recoverable).toBe(true);
    expect(error.retryable).toBe(true);
  });

  it('should enforce immutability at compile time', () => {
    const error = createOperationalError('test');

    // TypeScript should prevent these mutations at compile time
    // @ts-expect-error - Cannot assign to 'message' because it is a read-only property
    error.message = 'changed';

    // @ts-expect-error - Cannot assign to 'tag' because it is a read-only property
    error.tag = 'critical';

    // @ts-expect-error - Cannot assign to 'recoverable' because it is a read-only property
    error.recoverable = false;

    // @ts-expect-error - Cannot assign to 'retryable' because it is a read-only property
    error.retryable = false;

    // note: at runtime, these properties ARE mutable (JavaScript has no true readonly)
    // but TypeScript's type system prevents accidental mutations at compile time
    // this is the intended design - readonly is a compile-time safety feature
  });

  it('should maintain discriminated union types', () => {
    const error: ErrorType = createOperationalError('test');
    
    // type narrowing should work
    if (error.tag === 'operational') {
      // TypeScript knows this is OperationalError
      expect(error.recoverable).toBe(true);
    }
    
    // Test different error types
    const opError = createOperationalError('test');
    if (opError.tag === 'operational') {
      expect(opError.recoverable).toBe(true);
    }
    
    const configError = createConfigurationError('test');
    if (configError.tag === 'configuration') {
      expect(configError.recoverable).toBe(false);
    }
    
    const criticalError = createCriticalError('test');
    if (criticalError.tag === 'critical') {
      expect(criticalError.cause).toBeUndefined(); // optional property
    }
    
    const validationError = createValidationError('test');
    if (validationError.tag === 'validation') {
      expect(validationError.fields).toBeUndefined(); // optional property
    }
    
    const retryError = createRetryError(3, createOperationalError('test'));
    if (retryError.tag === 'retry') {
      expect(retryError.attempts).toBe(3);
    }
    
    const cbError = createCircuitBreakerError('open');
    if (cbError.tag === 'circuit-breaker') {
      expect(['open', 'half-open']).toContain(cbError.state);
    }
  });
});

describe('Context Edge Cases', () => {
  it('should handle undefined context (not provided)', () => {
    // when context is not provided, it should be undefined
    const error = createOperationalError('test');
    expect(error.context).toBeUndefined();
  });

  it('should handle empty object context', () => {
    const emptyContext = {};
    const error = createOperationalError('test', true, emptyContext);
    expect(error.context).toEqual({});
    expect(Object.keys(error.context!).length).toBe(0);
  });

  it('should handle context with undefined values', () => {
    const context = {
      defined: 'value',
      undefined: undefined
    };
    const error = createOperationalError('test', true, context);

    expect(error.context?.defined).toBe('value');
    expect(error.context?.undefined).toBeUndefined();
    expect('undefined' in error.context!).toBe(true); // key exists
  });

  it('should handle context with null values', () => {
    const context = {
      key: null,
      other: 'value'
    };
    const error = createOperationalError('test', true, context);

    expect(error.context?.key).toBe(null);
    expect(error.context?.other).toBe('value');
  });

  it('should handle context with mixed null and undefined', () => {
    const context: Record<string, unknown> = {
      nullValue: null,
      undefinedValue: undefined,
      zeroValue: 0,
      falseValue: false,
      emptyString: '',
      actualValue: 'data'
    };
    const error = createOperationalError('test', true, context);

    // all falsy values should be preserved
    expect(error.context?.nullValue).toBe(null);
    expect(error.context?.undefinedValue).toBeUndefined();
    expect(error.context?.zeroValue).toBe(0);
    expect(error.context?.falseValue).toBe(false);
    expect(error.context?.emptyString).toBe('');
    expect(error.context?.actualValue).toBe('data');
  });
});