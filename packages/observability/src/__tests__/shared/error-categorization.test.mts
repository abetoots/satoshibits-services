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
