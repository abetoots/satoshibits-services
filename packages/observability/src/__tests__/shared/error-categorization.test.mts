import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  categorizeErrorForObservability,
  configureErrorCategorization,
  ErrorCategory,
} from '../../smart-errors.mjs';

// Note: These tests cover both public API (disableDefaults)
// and internal features (customCategorizer, customRules) that are kept for
// future use but not part of the stable public API.

describe('Error Categorization (Issue #12)', () => {
  beforeEach(() => {
    // reset configuration before each test
    vi.restoreAllMocks();
    configureErrorCategorization({});
  });

  describe('Default categorization behavior', () => {
    it('should categorize validation errors', () => {
      const error = new Error('Invalid email format');
      const category = categorizeErrorForObservability(error);
      expect(category).toBe(ErrorCategory.VALIDATION);
    });

    it('should categorize network errors', () => {
      const error = new Error('Network connection failed');
      const category = categorizeErrorForObservability(error);
      expect(category).toBe(ErrorCategory.NETWORK);
    });

    it('should categorize timeout errors', () => {
      const error = new Error('Request timeout');
      const category = categorizeErrorForObservability(error);
      expect(category).toBe(ErrorCategory.TIMEOUT);
    });

    it('should return UNKNOWN for unrecognized errors', () => {
      const error = new Error('Something went wrong');
      const category = categorizeErrorForObservability(error);
      expect(category).toBe(ErrorCategory.UNKNOWN);
    });
  });

  describe('Custom categorization rules', () => {
    it('should use custom rules to categorize application-specific errors', () => {
      // e-commerce application with custom error types
      configureErrorCategorization({
        customRules: [
          {
            category: ErrorCategory.VALIDATION,
            test: (error) => error.name === 'OrderValidationError',
          },
          {
            category: ErrorCategory.EXTERNAL_SERVICE,
            test: (error) => error.name === 'PaymentGatewayError',
          },
          {
            category: ErrorCategory.DATABASE,
            test: (error) => error.name === 'InventoryQueryError',
          },
        ],
      });

      const orderError = new Error('Invalid order items');
      orderError.name = 'OrderValidationError';
      expect(categorizeErrorForObservability(orderError)).toBe(ErrorCategory.VALIDATION);

      const paymentError = new Error('Payment processing failed');
      paymentError.name = 'PaymentGatewayError';
      expect(categorizeErrorForObservability(paymentError)).toBe(ErrorCategory.EXTERNAL_SERVICE);

      const inventoryError = new Error('Out of stock');
      inventoryError.name = 'InventoryQueryError';
      expect(categorizeErrorForObservability(inventoryError)).toBe(ErrorCategory.DATABASE);
    });

    it('should try custom rules before default categorization', () => {
      configureErrorCategorization({
        customRules: [
          {
            category: ErrorCategory.EXTERNAL_SERVICE,
            test: (error) => error.message.includes('validation'),
          },
        ],
      });

      // custom rule overrides default validation categorization
      const error = new Error('Third-party validation service failed');
      expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.EXTERNAL_SERVICE);
    });

    it('should fall back to default categorization if custom rules dont match', () => {
      configureErrorCategorization({
        customRules: [
          {
            category: ErrorCategory.EXTERNAL_SERVICE,
            test: (error) => error.name === 'PaymentError',
          },
        ],
      });

      // no custom rule matches, should use default categorization
      const error = new Error('Invalid email format');
      expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.VALIDATION);
    });
  });

  describe('Custom categorizer function', () => {
    it('should use custom categorizer function for complete control', () => {
      // microservice with custom taxonomy
      class ServiceDegradedError extends Error {
        name = 'ServiceDegradedError';
      }
      class CircuitOpenError extends Error {
        name = 'CircuitOpenError';
      }
      class DataInconsistencyError extends Error {
        name = 'DataInconsistencyError';
      }

      configureErrorCategorization({
        customCategorizer: (error) => {
          if (error instanceof ServiceDegradedError) {
            return ErrorCategory.EXTERNAL_SERVICE;
          }
          if (error instanceof CircuitOpenError) {
            return ErrorCategory.RATE_LIMIT;
          }
          if (error instanceof DataInconsistencyError) {
            return ErrorCategory.INTERNAL;
          }
          // fall through to default/rules
          return undefined;
        },
      });

      expect(categorizeErrorForObservability(new ServiceDegradedError())).toBe(
        ErrorCategory.EXTERNAL_SERVICE
      );
      expect(categorizeErrorForObservability(new CircuitOpenError())).toBe(
        ErrorCategory.RATE_LIMIT
      );
      expect(categorizeErrorForObservability(new DataInconsistencyError())).toBe(
        ErrorCategory.INTERNAL
      );

      // falls through to default categorization
      const networkError = new Error('Connection failed');
      expect(categorizeErrorForObservability(networkError)).toBe(ErrorCategory.NETWORK);
    });

    it('should prioritize custom categorizer over custom rules', () => {
      configureErrorCategorization({
        customCategorizer: (error) => {
          if (error.message.includes('special')) {
            return ErrorCategory.EXTERNAL_SERVICE;
          }
          return undefined;
        },
        customRules: [
          {
            category: ErrorCategory.VALIDATION,
            test: (error) => error.message.includes('special'),
          },
        ],
      });

      const error = new Error('special error');
      // custom categorizer should win over custom rules
      expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.EXTERNAL_SERVICE);
    });
  });

  describe('Disable default categorization', () => {
    it('should only use custom logic when defaults are disabled', () => {
      configureErrorCategorization({
        disableDefaults: true,
        customCategorizer: (error) => {
          if (error.message.includes('known')) {
            return ErrorCategory.INTERNAL;
          }
          return undefined;
        },
      });

      const knownError = new Error('This is a known error');
      expect(categorizeErrorForObservability(knownError)).toBe(ErrorCategory.INTERNAL);

      // default would categorize this as VALIDATION, but defaults are disabled
      const unknownError = new Error('Invalid input');
      expect(categorizeErrorForObservability(unknownError)).toBe(ErrorCategory.UNKNOWN);
    });

    it('should still check custom rules when defaults are disabled', () => {
      configureErrorCategorization({
        disableDefaults: true,
        customRules: [
          {
            category: ErrorCategory.EXTERNAL_SERVICE,
            test: (error) => error.name === 'CustomError',
          },
        ],
      });

      const customError = new Error('Something failed');
      customError.name = 'CustomError';
      expect(categorizeErrorForObservability(customError)).toBe(ErrorCategory.EXTERNAL_SERVICE);

      // no custom rule matches and defaults disabled
      const otherError = new Error('Invalid data');
      expect(categorizeErrorForObservability(otherError)).toBe(ErrorCategory.UNKNOWN);
    });
  });

  describe('Error handling in callbacks', () => {
    it('should handle errors in custom categorizer gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      configureErrorCategorization({
        customCategorizer: () => {
          throw new Error('Categorizer crashed');
        },
      });

      const error = new Error('Test error');
      // should fall back to default categorization
      expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.UNKNOWN);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('customCategorizer threw an error'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle errors in custom rules gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      configureErrorCategorization({
        customRules: [
          {
            category: ErrorCategory.EXTERNAL_SERVICE,
            test: () => {
              throw new Error('Rule crashed');
            },
          },
        ],
      });

      const error = new Error('Invalid email');
      // should skip failed rule and use default categorization
      expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.VALIDATION);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('customRules[0] threw an error'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Structured data categorization (Issue #9)', () => {
    describe('HTTP status codes', () => {
      it('should categorize by error.status', () => {
        const error400 = Object.assign(new Error('Bad Request'), { status: 400 });
        expect(categorizeErrorForObservability(error400)).toBe(ErrorCategory.VALIDATION);

        const error401 = Object.assign(new Error('Unauthorized'), { status: 401 });
        expect(categorizeErrorForObservability(error401)).toBe(ErrorCategory.AUTHENTICATION);

        const error403 = Object.assign(new Error('Forbidden'), { status: 403 });
        expect(categorizeErrorForObservability(error403)).toBe(ErrorCategory.AUTHORIZATION);

        const error404 = Object.assign(new Error('Not Found'), { status: 404 });
        expect(categorizeErrorForObservability(error404)).toBe(ErrorCategory.NOT_FOUND);

        const error408 = Object.assign(new Error('Request Timeout'), { status: 408 });
        expect(categorizeErrorForObservability(error408)).toBe(ErrorCategory.TIMEOUT);

        const error429 = Object.assign(new Error('Too Many Requests'), { status: 429 });
        expect(categorizeErrorForObservability(error429)).toBe(ErrorCategory.RATE_LIMIT);

        const error500 = Object.assign(new Error('Internal Server Error'), { status: 500 });
        expect(categorizeErrorForObservability(error500)).toBe(ErrorCategory.INTERNAL);

        const error503 = Object.assign(new Error('Service Unavailable'), { status: 503 });
        expect(categorizeErrorForObservability(error503)).toBe(ErrorCategory.INTERNAL);
      });

      it('should categorize HTTP 422 Unprocessable Entity as VALIDATION', () => {
        const error422 = Object.assign(new Error('Unprocessable Entity'), { status: 422 });
        expect(categorizeErrorForObservability(error422)).toBe(ErrorCategory.VALIDATION);
      });

      it('should categorize HTTP 409 Conflict as VALIDATION (multi-model review)', () => {
        const error409 = Object.assign(new Error('Conflict'), { status: 409 });
        expect(categorizeErrorForObservability(error409)).toBe(ErrorCategory.VALIDATION);
      });

      it('should handle status codes as strings (Codex review)', () => {
        // some libraries expose status as string
        const errorStringStatus = Object.assign(new Error('Not Found'), { status: '404' });
        expect(categorizeErrorForObservability(errorStringStatus)).toBe(ErrorCategory.NOT_FOUND);
      });

      it('should categorize HTTP 504 Gateway Timeout as TIMEOUT', () => {
        const error504 = Object.assign(new Error('Gateway Timeout'), { status: 504 });
        expect(categorizeErrorForObservability(error504)).toBe(ErrorCategory.TIMEOUT);
      });

      it('should categorize by error.statusCode (axios-style)', () => {
        const error = Object.assign(new Error('Request failed'), { statusCode: 404 });
        expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.NOT_FOUND);
      });

      it('should categorize by error.response.status (fetch/axios response)', () => {
        const error = Object.assign(new Error('Request failed'), {
          response: { status: 401 },
        });
        expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.AUTHENTICATION);
      });

      it('should prioritize structured data over string matching', () => {
        // error message says "network" but status says 404
        const error = Object.assign(new Error('Network request failed'), { status: 404 });
        expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.NOT_FOUND);
      });
    });

    describe('Node.js error codes', () => {
      it('should categorize network-related error codes', () => {
        const econnrefused = Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        });
        expect(categorizeErrorForObservability(econnrefused)).toBe(ErrorCategory.NETWORK);

        const enotfound = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
          code: 'ENOTFOUND',
        });
        expect(categorizeErrorForObservability(enotfound)).toBe(ErrorCategory.NETWORK);

        const econnreset = Object.assign(new Error('read ECONNRESET'), {
          code: 'ECONNRESET',
        });
        expect(categorizeErrorForObservability(econnreset)).toBe(ErrorCategory.NETWORK);

        const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
        expect(categorizeErrorForObservability(epipe)).toBe(ErrorCategory.NETWORK);

        const enetunreach = Object.assign(new Error('connect ENETUNREACH'), {
          code: 'ENETUNREACH',
        });
        expect(categorizeErrorForObservability(enetunreach)).toBe(ErrorCategory.NETWORK);
      });

      it('should categorize timeout-related error codes', () => {
        const etimedout = Object.assign(new Error('connect ETIMEDOUT'), {
          code: 'ETIMEDOUT',
        });
        expect(categorizeErrorForObservability(etimedout)).toBe(ErrorCategory.TIMEOUT);

        const esockettimedout = Object.assign(new Error('socket timeout'), {
          code: 'ESOCKETTIMEDOUT',
        });
        expect(categorizeErrorForObservability(esockettimedout)).toBe(ErrorCategory.TIMEOUT);

        const econnaborted = Object.assign(new Error('Connection aborted'), {
          code: 'ECONNABORTED',
        });
        expect(categorizeErrorForObservability(econnaborted)).toBe(ErrorCategory.TIMEOUT);
      });

      it('should categorize database-related error codes', () => {
        // MySQL error
        const mysqlError = Object.assign(new Error('Duplicate entry'), {
          code: 'ER_DUP_ENTRY',
        });
        expect(categorizeErrorForObservability(mysqlError)).toBe(ErrorCategory.DATABASE);

        // PostgreSQL constraint violation
        const pgError = Object.assign(new Error('violates foreign key constraint'), {
          code: '23503',
        });
        expect(categorizeErrorForObservability(pgError)).toBe(ErrorCategory.DATABASE);

        // SQLite constraint error
        const sqliteError = Object.assign(new Error('UNIQUE constraint failed'), {
          code: 'SQLITE_CONSTRAINT',
        });
        expect(categorizeErrorForObservability(sqliteError)).toBe(ErrorCategory.DATABASE);
      });

      it('should handle numeric error codes (Gemini review - MongoDB)', () => {
        // MongoDB duplicate key error uses numeric code
        const mongoError = Object.assign(new Error('duplicate key error'), {
          code: 11000,
        });
        expect(categorizeErrorForObservability(mongoError)).toBe(ErrorCategory.DATABASE);
      });

      it('should categorize additional network codes (Codex review)', () => {
        const ehostunreach = Object.assign(new Error('host unreachable'), {
          code: 'EHOSTUNREACH',
        });
        expect(categorizeErrorForObservability(ehostunreach)).toBe(ErrorCategory.NETWORK);

        const enetdown = Object.assign(new Error('network is down'), {
          code: 'ENETDOWN',
        });
        expect(categorizeErrorForObservability(enetdown)).toBe(ErrorCategory.NETWORK);

        const eaiAgain = Object.assign(new Error('DNS lookup failed'), {
          code: 'EAI_AGAIN',
        });
        expect(categorizeErrorForObservability(eaiAgain)).toBe(ErrorCategory.NETWORK);
      });

      it('should fall back to string matching when no structured data', () => {
        // no status, no code - should use string matching
        const error = new Error('Invalid email format');
        expect(categorizeErrorForObservability(error)).toBe(ErrorCategory.VALIDATION);
      });

      it('should handle error codes case-insensitively', () => {
        // lowercase error code (some libraries may use this)
        const lowerError = Object.assign(new Error('connection refused'), {
          code: 'econnrefused',
        });
        expect(categorizeErrorForObservability(lowerError)).toBe(ErrorCategory.NETWORK);

        // mixed case error code
        const mixedError = Object.assign(new Error('socket timeout'), {
          code: 'ETimedOut',
        });
        expect(categorizeErrorForObservability(mixedError)).toBe(ErrorCategory.TIMEOUT);
      });
    });

    describe('Locale independence', () => {
      it('should work with non-English error messages when status code present', () => {
        // German error message with HTTP status
        const germanError = Object.assign(new Error('Verbindung fehlgeschlagen'), {
          status: 408,
        });
        expect(categorizeErrorForObservability(germanError)).toBe(ErrorCategory.TIMEOUT);

        // Japanese error message with error code
        const japaneseError = Object.assign(new Error('接続が拒否されました'), {
          code: 'ECONNREFUSED',
        });
        expect(categorizeErrorForObservability(japaneseError)).toBe(ErrorCategory.NETWORK);
      });
    });
  });

  describe('Real-world scenarios', () => {
    it('should support healthcare application with domain-specific errors', () => {
      configureErrorCategorization({
        customRules: [
          {
            category: ErrorCategory.VALIDATION,
            test: (error) => error.name.includes('PatientValidation'),
          },
          {
            category: ErrorCategory.AUTHORIZATION,
            test: (error) => error.name.includes('HIPAAViolation'),
          },
          {
            category: ErrorCategory.DATABASE,
            test: (error) => error.name.includes('MedicalRecordQuery'),
          },
        ],
      });

      const patientError = new Error('Invalid patient ID');
      patientError.name = 'PatientValidationError';
      expect(categorizeErrorForObservability(patientError)).toBe(ErrorCategory.VALIDATION);

      const hipaaError = new Error('Unauthorized access to medical records');
      hipaaError.name = 'HIPAAViolationError';
      expect(categorizeErrorForObservability(hipaaError)).toBe(ErrorCategory.AUTHORIZATION);
    });

    it('should support gaming application with custom error types', () => {
      class MatchmakingError extends Error {
        name = 'MatchmakingError';
      }
      class LeaderboardError extends Error {
        name = 'LeaderboardError';
      }

      configureErrorCategorization({
        customCategorizer: (error) => {
          if (error instanceof MatchmakingError) return ErrorCategory.EXTERNAL_SERVICE;
          if (error instanceof LeaderboardError) return ErrorCategory.DATABASE;
          return undefined;
        },
      });

      expect(categorizeErrorForObservability(new MatchmakingError('No players found'))).toBe(
        ErrorCategory.EXTERNAL_SERVICE
      );
      expect(categorizeErrorForObservability(new LeaderboardError('Query failed'))).toBe(
        ErrorCategory.DATABASE
      );
    });
  });
});
