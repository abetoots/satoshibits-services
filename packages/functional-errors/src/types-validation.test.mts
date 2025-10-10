/**
 * Additional validation and edge case tests for error types
 * Testing robustness, serialization, and edge cases
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-empty-function */

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
  type ErrorType,
} from './types.mjs';

describe('Error Type Input Validation', () => {
  describe('Edge case inputs', () => {
    it('should handle empty string messages', () => {
      const error = createOperationalError('');
      expect(error.message).toBe('');
      expect(error.tag).toBe('operational');
    });

    it('should handle very long messages', () => {
      const longMessage = 'x'.repeat(10000);
      const error = createValidationError(longMessage);
      expect(error.message).toBe(longMessage);
    });

    it('should handle special characters in messages', () => {
      const specialMessage = '🚀 Error: \n\t"quoted" & <tagged> \\ backslash';
      const error = createOperationalError(specialMessage);
      expect(error.message).toBe(specialMessage);
    });
  });

  describe('Context validation', () => {
    it('should handle circular references in context', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const context: any = { value: 1 };
      context.circular = context; // create circular reference

      const error = createOperationalError('Error', true, context);
      expect(error.context).toBe(context);

      // should not throw when trying to inspect
      expect(() => JSON.stringify(error.context, getCircularReplacer())).not.toThrow();
    });

    it('should handle non-serializable context values', () => {
      const context = {
        bigint: BigInt(123),
        symbol: Symbol('test'),
        function: () => 'test',
        undefined: undefined,
        date: new Date(),
        regex: /test/g
      };
      
      const error = createOperationalError('Error', true, context);
      expect(error.context).toEqual(context);
    });

    it('should protect against prototype pollution', () => {
      const maliciousContext = JSON.parse('{"__proto__": {"isAdmin": true}}');
      createOperationalError('test', true, maliciousContext);

      // verify prototype wasn't polluted
      const testObj = {};
      // @ts-expect-error - checking that prototype wasn't polluted
      expect(testObj.isAdmin).toBeUndefined();
    });

    it('should handle deeply nested context', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deepContext: any = {};
      let current = deepContext;
      for (let i = 0; i < 100; i++) {
        current.nested = { level: i };
        current = current.nested;
      }

      const error = createOperationalError('Error', true, deepContext);
      expect(error.context).toBe(deepContext);
    });
  });

  describe('ValidationError field validation', () => {
    it('should handle empty field arrays', () => {
      const fields = {
        email: [],
        password: []
      };
      const error = createValidationError('Invalid', fields);
      expect(error.fields).toEqual(fields);
    });

    it('should handle very long field error messages', () => {
      const longError = 'x'.repeat(1000);
      const fields = {
        field: [longError]
      };
      const error = createValidationError('Invalid', fields);
      expect(error.fields?.field?.[0]).toBe(longError);
    });

    it('should handle deeply nested field paths', () => {
      const fields = {
        'user.profile.settings.preferences.theme.color.primary': ['Invalid color']
      };
      const error = createValidationError('Invalid', fields);
      expect(error.fields).toEqual(fields);
    });

    it('should handle special characters in field names', () => {
      const fields = {
        'field[0].value': ['Required'],
        'user.email@domain': ['Invalid'],
        'data["key"]': ['Missing']
      };
      const error = createValidationError('Invalid', fields);
      expect(error.fields).toEqual(fields);
    });
  });
});

describe('Type Guard Robustness', () => {
  describe('Null and undefined handling', () => {
    it('should handle null gracefully', () => {
      // type guards now safely check for null and return false
      expect(isOperationalError(null)).toBe(false);
      expect(isValidationError(null)).toBe(false);
      expect(isConfigurationError(null)).toBe(false);
      expect(isRetryError(null)).toBe(false);
      expect(isCircuitBreakerError(null)).toBe(false);
      expect(isTimeoutError(null)).toBe(false);
      expect(isCriticalError(null)).toBe(false);
    });

    it('should handle undefined gracefully', () => {
      // type guards now safely check for undefined and return false
      expect(isOperationalError(undefined)).toBe(false);
      expect(isValidationError(undefined)).toBe(false);
      expect(isConfigurationError(undefined)).toBe(false);
      expect(isRetryError(undefined)).toBe(false);
      expect(isCircuitBreakerError(undefined)).toBe(false);
      expect(isTimeoutError(undefined)).toBe(false);
      expect(isCriticalError(undefined)).toBe(false);
    });
  });

  describe('Plain object handling', () => {
    it('should return false for objects missing tag property', () => {
      const fakeError = {
        message: 'Error',
        recoverable: true,
        retryable: true
      };
      expect(isOperationalError(fakeError)).toBe(false);
    });

    it('should return false for objects with wrong tag', () => {
      const fakeError = {
        tag: 'unknown',
        message: 'Error',
        recoverable: true,
        retryable: true
      };
      expect(isOperationalError(fakeError)).toBe(false);
    });

    it('should work with serialized and deserialized errors', () => {
      const originalError = createValidationError('Invalid', { email: ['Required'] });
      const serialized = JSON.stringify(originalError);
      const deserialized = JSON.parse(serialized);
      
      // should still work because type guards use structural typing
      expect(isValidationError(deserialized)).toBe(true);
      expect(deserialized.tag).toBe('validation');
    });

    it('should handle objects with extra properties', () => {
      const errorWithExtras = {
        ...createOperationalError('Error'),
        extraProp: 'extra',
        anotherProp: 123
      };
      expect(isOperationalError(errorWithExtras)).toBe(true);
    });
  });

  describe('Cross-type guard checks', () => {
    it('should not match other error types', () => {
      const operational = createOperationalError('Op error');
      const validation = createValidationError('Val error');
      const critical = createCriticalError('Crit error');
      
      // operational should only match isOperationalError
      expect(isOperationalError(operational)).toBe(true);
      expect(isValidationError(operational)).toBe(false);
      expect(isCriticalError(operational)).toBe(false);
      expect(isConfigurationError(operational)).toBe(false);
      
      // validation should only match isValidationError
      expect(isOperationalError(validation)).toBe(false);
      expect(isValidationError(validation)).toBe(true);
      expect(isCriticalError(validation)).toBe(false);
      expect(isConfigurationError(validation)).toBe(false);
      
      // critical should only match isCriticalError
      expect(isOperationalError(critical)).toBe(false);
      expect(isValidationError(critical)).toBe(false);
      expect(isCriticalError(critical)).toBe(true);
      expect(isConfigurationError(critical)).toBe(false);
    });
  });

  describe('Type coercion edge cases', () => {
    it('should handle primitive values', () => {
      expect(isOperationalError('string')).toBe(false);
      expect(isOperationalError(123)).toBe(false);
      expect(isOperationalError(true)).toBe(false);
      expect(isOperationalError(Symbol())).toBe(false);
    });

    it('should handle arrays', () => {
      expect(isOperationalError([])).toBe(false);
      expect(isOperationalError([1, 2, 3])).toBe(false);
    });

    it('should handle functions', () => {
      expect(isOperationalError(() => {})).toBe(false);
      expect(isOperationalError(function() {})).toBe(false);
    });
  });
});

describe('Error Serialization', () => {
  it('should serialize to JSON correctly', () => {
    const error = createOperationalError('Test error', true, { code: 500 });
    const json = JSON.stringify(error);
    const parsed = JSON.parse(json);
    
    expect(parsed.tag).toBe('operational');
    expect(parsed.message).toBe('Test error');
    expect(parsed.recoverable).toBe(true);
    expect(parsed.retryable).toBe(true);
    expect(parsed.context).toEqual({ code: 500 });
  });

  it('should handle Date serialization in errors', () => {
    const nextAttempt = new Date('2025-01-01T00:00:00Z');
    const error = createCircuitBreakerError('open', nextAttempt);
    const json = JSON.stringify(error);
    const parsed = JSON.parse(json);
    
    // date becomes string after serialization
    expect(typeof parsed.nextAttempt).toBe('string');
    expect(new Date(parsed.nextAttempt).getTime()).toBe(nextAttempt.getTime());
  });

  it('should document Error.cause serialization loss', () => {
    const cause = new Error('Root cause');
    const error = createCriticalError('Critical failure', cause);

    // note: Error.cause is not automatically serialized by JSON.stringify
    // this test documents actual behavior
    const json = JSON.stringify(error);
    const parsed = JSON.parse(json);

    // cause is an Error object, which serializes to {}
    expect(parsed.cause).toEqual({});
  });

  it('should provide custom serializer that preserves Error.cause details', () => {
    const cause = new Error('Root cause');
    const error = createCriticalError('Critical failure', cause);

    const serialized = JSON.stringify(error, (_key, value) => {
      if (value instanceof Error) {
        return {
          __type: 'Error',
          message: value.message,
          stack: value.stack,
          name: value.name,
        };
      }
      return value;
    });

    const parsed = JSON.parse(serialized);
    expect(parsed.cause.__type).toBe('Error');
    expect(parsed.cause.message).toBe('Root cause');
    expect(parsed.cause.stack).toBeDefined();
  });

  it('should handle non-serializable context values during serialization', () => {
    const context = {
      bigint: BigInt(123),
      symbol: Symbol('test'),
      function: () => 'test',
      undefined: undefined,
      date: new Date(),
      regex: /test/g
    };

    const error = createOperationalError('Error', true, context);

    // attempt to serialize - some values will be lost
    const serialized = JSON.stringify(error, (_key, value) => {
      // custom serializer handles non-serializable types
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (typeof value === 'symbol') {
        return value.toString();
      }
      if (typeof value === 'function') {
        return '[Function]';
      }
      return value;
    });

    const parsed = JSON.parse(serialized);

    // verify custom serialization preserved values
    expect(parsed.context.bigint).toBe('123');
    expect(parsed.context.symbol).toBe('Symbol(test)');
    expect(parsed.context.function).toBe('[Function]');
    expect(parsed.context.date).toBeDefined();
  });

  it('should allow type guards to work on deserialized errors', () => {
    const error = createValidationError('Invalid input', { email: ['Required'] });
    const serialized = JSON.stringify(error);
    const deserialized = JSON.parse(serialized);

    // type guards use structural typing, should work on deserialized errors
    expect(isValidationError(deserialized)).toBe(true);
    expect(deserialized.tag).toBe('validation');
    expect(deserialized.fields).toEqual({ email: ['Required'] });
  });

  it('should handle cross-process error serialization', () => {
    // simulate sending error across process boundary (e.g., worker thread, HTTP)
    const originalError = createOperationalError('Failed to fetch', true, {
      url: 'https://api.example.com',
      statusCode: 500
    });

    // serialize for IPC
    const serialized = JSON.stringify(originalError);

    // simulate receiving in different process
    const received = JSON.parse(serialized);

    // verify all properties preserved
    expect(received.tag).toBe('operational');
    expect(received.message).toBe('Failed to fetch');
    expect(received.recoverable).toBe(true);
    expect(received.retryable).toBe(true);
    expect(received.context).toEqual({
      url: 'https://api.example.com',
      statusCode: 500
    });

    // verify type guards still work
    expect(isOperationalError(received)).toBe(true);
  });
});

describe('Helper Function Edge Cases', () => {
  describe('isRecoverable', () => {
    it('should handle all error types correctly', () => {
      expect(isRecoverable(createOperationalError('op'))).toBe(true);
      expect(isRecoverable(createValidationError('val'))).toBe(true);
      expect(isRecoverable(createTimeoutError('timeout', 1000))).toBe(true);
      expect(isRecoverable(createCircuitBreakerError('open'))).toBe(true);

      expect(isRecoverable(createConfigurationError('config'))).toBe(false);
      expect(isRecoverable(createCriticalError('critical'))).toBe(false);
      expect(isRecoverable(createRetryError(3, createOperationalError('op')))).toBe(false);
    });
  });

  describe('isRetryable', () => {
    it('should handle all error types correctly', () => {
      expect(isRetryable(createOperationalError('op', true))).toBe(true);
      expect(isRetryable(createTimeoutError('timeout', 1000))).toBe(true);

      expect(isRetryable(createOperationalError('op', false))).toBe(false);
      expect(isRetryable(createValidationError('val'))).toBe(false);
      expect(isRetryable(createConfigurationError('config'))).toBe(false);
      expect(isRetryable(createCriticalError('critical'))).toBe(false);
      expect(isRetryable(createRetryError(3, createOperationalError('op')))).toBe(false);
      expect(isRetryable(createCircuitBreakerError('open'))).toBe(false);
    });
  });
});

describe('Performance and Memory', () => {
  // note: these are smoke tests, not performance benchmarks
  // they verify the library handles large workloads without crashing or memory leaks
  // actual performance optimization is not a priority for this error handling library

  it('should handle creating many errors without memory issues', () => {
    const errors: ErrorType[] = [];
    for (let i = 0; i < 10000; i++) {
      errors.push(createOperationalError(`Error ${i}`, i % 2 === 0));
    }

    expect(errors.length).toBe(10000);
    expect(errors[0]?.message).toBe('Error 0');
    expect(errors[9999]?.message).toBe('Error 9999');
  });

  it('should handle large context objects', () => {
    const largeContext = {
      data: new Array(1000).fill(null).map((_, i) => ({
        id: i,
        value: `value-${i}`,
        nested: {
          prop1: Math.random(),
          prop2: new Date().toISOString()
        }
      }))
    };

    const error = createOperationalError('Error with large context', true, largeContext);
    expect(error.context).toBe(largeContext);
    expect((error.context as typeof largeContext).data.length).toBe(1000);
  });
});

// helper function for circular reference handling
function getCircularReplacer() {
  const seen = new WeakSet();
  return (_key: string, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  };
}