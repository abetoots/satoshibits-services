/**
 * README.md drift detection tests
 *
 * These tests verify that the README.md remains accurate as the codebase evolves.
 * They don't test library functionality (that's what other tests do), but rather
 * ensure the documentation itself is trustworthy.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('README.md drift detection', () => {
  // read README from package root (one level up from src/)
  const readmePath = path.join(__dirname, '../README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf-8');

  describe('Core claims accuracy', () => {
    it('should have the correct number of error types mentioned', () => {
      // the library defines exactly 7 error types
      const errorTags = [
        'ConfigurationError',
        'OperationalError',
        'CriticalError',
        'ValidationError',
        'RetryError',
        'CircuitBreakerError',
        'TimeoutError',
      ];
      const errorTypeCount = errorTags.length;

      // the README should mention "7 error types" in multiple places
      const pattern = new RegExp(`\\b${errorTypeCount}\\b(?=.*error types)`, 'gi');
      const matches = readmeContent.match(pattern);

      expect(matches, 'README should mention the correct number of error types').not.toBeNull();
      expect(matches!.length, 'The "7 error types" claim should appear at least once').toBeGreaterThanOrEqual(1);
    });
  });

  describe('API Reference completeness', () => {
    it('should document all error constructors', () => {
      const expectedConstructors = [
        'createConfigurationError',
        'createOperationalError',
        'createCriticalError',
        'createValidationError',
        'createRetryError',
        'createCircuitBreakerError',
        'createTimeoutError',
      ];

      for (const constructor of expectedConstructors) {
        expect(
          readmeContent,
          `README should document ${constructor}`
        ).toContain(`\`${constructor}`);
      }
    });

    it('should document all type guards', () => {
      const expectedTypeGuards = [
        'isConfigurationError',
        'isOperationalError',
        'isCriticalError',
        'isValidationError',
        'isRetryError',
        'isCircuitBreakerError',
        'isTimeoutError',
        'isRetryable',
        'isRecoverable',
      ];

      for (const guard of expectedTypeGuards) {
        expect(
          readmeContent,
          `README should document ${guard}`
        ).toContain(`\`${guard}`);
      }
    });

    it('should document resilience utilities', () => {
      const expectedUtils = [
        'retry',
        'retrySync',
        'createRetry',
        'createCircuitBreaker',
        'CircuitBreakerManual',
      ];

      for (const util of expectedUtils) {
        expect(
          readmeContent,
          `README should document ${util}`
        ).toContain(`\`${util}`);
      }
    });

    it('should document result utilities', () => {
      const expectedUtils = [
        'tryCatch',
        'tryCatchSync',
      ];

      for (const util of expectedUtils) {
        expect(
          readmeContent,
          `README should document ${util}`
        ).toContain(`\`${util}`);
      }
    });

    it('should document error handlers', () => {
      const expectedHandlers = [
        'handleErrorType',
        'recoverWithDefault',
        'recoverWith',
        'toLoggableFormat',
        'mapError',
        'withContext',
      ];

      for (const handler of expectedHandlers) {
        expect(
          readmeContent,
          `README should document ${handler}`
        ).toContain(`\`${handler}`);
      }
    });
  });

  describe('Code example validity markers', () => {
    it('should use realistic import statements in examples', () => {
      // all code examples should import from the actual package name
      const codeBlocks = readmeContent.match(/```typescript[\s\S]*?```/g) ?? [];

      const importingBlocks = codeBlocks.filter(block =>
        block.includes("import") && block.includes("@satoshibits/functional-errors")
      );

      expect(
        importingBlocks.length,
        'At least some code examples should show proper imports'
      ).toBeGreaterThan(0);
    });

    it('should not use deleted APIs in examples', () => {
      // extract content before migration guide (which legitimately documents removed APIs)
      const migrationIndex = readmeContent.indexOf('## Migration from v1.x');
      const contentBeforeMigration = migrationIndex > 0
        ? readmeContent.substring(0, migrationIndex)
        : readmeContent;

      // these APIs were removed in v2.0.0 and should not appear in examples or API reference
      const deletedAPIsInBackticks = [
        '`createValidationAccumulator',
        '`addFieldError',
        '`addGlobalError',
        '`all(',
        '`allSettled(',
        '`fromNullable',
        '`withCircuitBreaker', // renamed to createCircuitBreaker
        '`errorToJSON',
        '`errorFromJSON',
      ];

      for (const api of deletedAPIsInBackticks) {
        expect(
          contentBeforeMigration,
          `README should not reference deleted API in backticks: ${api}`
        ).not.toContain(api);
      }

      // also check that these don't appear as imports in code blocks
      const deletedImports = [
        'createValidationAccumulator',
        'addFieldError',
        'fromNullable',
      ];

      const codeBlocks = readmeContent.match(/```typescript[\s\S]*?```/g) ?? [];
      const allCodeContent = codeBlocks.join('\n');

      for (const api of deletedImports) {
        expect(
          allCodeContent,
          `Code examples should not import deleted API: ${api}`
        ).not.toContain(api);
      }
    });
  });

  describe('Structural consistency', () => {
    it('should have the guided tour sections in order', () => {
      // the guided tour should follow this progression
      const sections = [
        '### Part 1: From `throw` to `Result`',
        '### Part 2: What Kind of Error Is It? The Error Taxonomy',
        '### Part 3: Handling Transient Failures with `retry`',
        '### Part 4: Preventing Cascading Failures with `createCircuitBreaker`',
      ];

      let lastIndex = -1;
      for (const section of sections) {
        const index = readmeContent.indexOf(section);
        expect(index, `Section "${section}" should exist`).toBeGreaterThan(-1);
        expect(index, `Section "${section}" should appear in order`).toBeGreaterThan(lastIndex);
        lastIndex = index;
      }
    });

    it('should have the recipes section', () => {
      expect(readmeContent).toContain('## Recipes: Common Scenarios');
    });

    it('should have collapsed migration guide', () => {
      expect(readmeContent).toContain('## Migration from v1.x');
      expect(readmeContent).toContain('<details>');
      expect(readmeContent).toContain('<summary>Click to expand Migration Guide from v1.x</summary>');
    });
  });
});
