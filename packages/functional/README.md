# Functional Library

A comprehensive collection of functional programming utilities for TypeScript, designed to promote immutability, composability, and type safety.

## Overview

This library provides a set of pure, composable functions that follow functional programming principles. All utilities are designed to be tree-shakeable, type-safe, and optimized for performance.

## Architecture Principles

- **Pure Functions**: All utilities are pure functions with no side effects
- **Immutability**: Functions never mutate input data, always returning new values
- **Composability**: Designed to work together through function composition
- **Type Safety**: Full TypeScript support with comprehensive type inference
- **Tree-Shaking**: No barrel exports - import directly from specific modules
- **Performance**: Optimized implementations with minimal overhead

## Modules

### `array-utils.mts`

Functional utilities for array manipulation and transformation.

**Functions:**

- `mapWithIndex` - Map with access to element index
- `filterMap` - Combined filter and map in a single pass
- `chunk` - Split array into chunks of specified size
- `groupBy` - Group elements by a key function
- `findSafe` - Type-safe array element finder returning Result type
- `partition` - Split array into two based on predicate

### `object-utils.mts`

Utilities for immutable object operations.

**Functions:**

- `mapValues` - Transform object values while preserving keys
- `pick` - Create new object with selected keys
- `omit` - Create new object without specified keys
- `merge` - Deep merge objects with type safety

### `composition.mts`

Core function composition utilities.

**Functions:**

- `pipe` - Left-to-right function composition
- `pipeAsync` - Async function pipeline
- `compose` - Right-to-left function composition
- `composeAsync` - Async function composition
- `flow` - Type-safe variadic pipe
- `flowAsync` - Type-safe variadic async pipe
- `tap` - Side effect injection
- `curry` - Function currying
- `partial` - Partial application
- `flip` - Flip function arguments
- `memoize` - Function memoization
- `constant` - Create constant function
- `identity` - Identity function
- `noop` - No-operation function

### `predicates.mts`

Predicate functions and logical combinators.

**Functions:**

- `and` - Logical AND combinator
- `or` - Logical OR combinator
- `not` - Logical NOT combinator
- `xor` - Logical XOR combinator
- `isNil` - Check for null or undefined
- `isNotNil` - Check for non-null/undefined
- `isEmpty` - Check for empty values
- `isNotEmpty` - Check for non-empty values
- `equals` - Deep equality check
- `oneOf` - Check if value is in array
- `inRange` - Check if number is in range
- `matches` - Partial object matching
- `hasProperty` - Property existence check
- `includes` - Substring/array element check
- `alwaysTrue` - Constant true predicate
- `alwaysFalse` - Constant false predicate

### `performance.mts`

Performance optimization utilities.

**Functions:**

- `debounce` - Delay function execution
- `throttle` - Rate limit function calls
- `batchAsync` - Batch async operations
- `performanceUtils.measure` - Measure function execution time

### `pipeline.mts`

Fluent pipeline API for chaining operations.

**Class:**

- `Pipeline` - Chainable transformation pipeline with methods:
  - `map` - Transform value
  - `flatMap` - Transform and flatten
  - `filter` - Conditional transformation
  - `tap` - Side effects
  - `pipeAsync` - Async transformations
  - `value` - Extract final value

### `result.mts`

Result type for explicit error handling without exceptions.

**Types & Functions:**

- `Result<T, E>` - Success or error union type
- `Result.ok` - Create success result
- `Result.err` - Create error result
- `Result.map` - Transform success value
- `Result.mapError` - Transform error value
- `Result.chain` - Monadic bind
- `Result.match` - Pattern matching
- `Result.isOk` - Type guard for success
- `Result.isErr` - Type guard for error

### `reader-result.mts`

Reader monad combined with Result type for dependency injection and error handling.

**Types & Functions:**

- `ReaderResult<D, E, A>` - Reader + Result monad
- `ReaderResult.of` - Create from value
- `ReaderResult.fromResult` - Lift Result
- `ReaderResult.ask` - Access dependencies
- `ReaderResult.chain` - Monadic composition
- `ReaderResult.map` - Transform success value
- `ReaderResult.run` - Execute with dependencies

### `validation.mts`

Validation utilities and error types.

**Types & Functions:**

- `ValidationError` - Structured validation error
- `createValidationError` - Error factory
- `combineValidationErrors` - Merge multiple errors
- `formatValidationError` - Error formatting

## Usage Patterns

### Import Strategy

Always import directly from specific modules for optimal tree-shaking:

```typescript
// ✅ Correct - Direct imports
import { pipe, compose } from "@/lib/functional/composition.mjs";
import { mapValues, pick } from "@/lib/functional/object-utils.mjs";

// ❌ Wrong - No barrel imports (index.mts was removed)
import { pipe } from "@/lib/functional";
```

### Composition Patterns

Functions are designed to work together through composition:

```typescript
import { chunk, filterMap } from "@/lib/functional/array-utils.mjs";
import { pipe } from "@/lib/functional/composition.mjs";
import { isNotNil } from "@/lib/functional/predicates.mjs";

// Combine utilities for complex transformations
const processData = pipe(
  filterMap((x: unknown) => (isNotNil(x) ? x : undefined)),
  chunk(10),
);
```

### Error Handling

Use Result types for explicit error handling:

```typescript
import { findSafe } from "@/lib/functional/array-utils.mjs";
import { Result } from "@/lib/functional/result.mjs";

// Functions return Result types for safety
const result = findSafe((x: User) => x.id === targetId)(users);

if (result.success) {
  console.log("Found user:", result.data);
} else {
  console.log("User not found");
}
```

## Testing

All utilities have comprehensive test suites. Run tests with:

```bash
# Run all functional library tests
pnpm test src/lib/functional

# Run specific module tests
pnpm test src/lib/functional/array-utils.test.ts
```

## Performance Considerations

- **Memory Efficiency**: Functions like `filterMap` avoid intermediate arrays
- **Lazy Evaluation**: Pipeline class enables lazy transformation chains
- **Memoization**: Use `memoize` for expensive pure computations
- **Batching**: `batchAsync` optimizes concurrent async operations

## Migration Guide

If migrating from the old structure:

1. Replace imports from `pipe.mts` with `composition.mts`
2. Import array/object utilities from their dedicated modules
3. Remove any imports from `index.mts` (barrel file removed)
4. Update type imports for Result and ValidationError

## Contributing

When adding new utilities:

1. Ensure functions are pure with no side effects
2. Add comprehensive JSDoc with `@example` blocks
3. Include proper `@since` tags with current date
4. Write thorough unit tests
5. Follow established naming conventions
6. Update this README with new functions

## License - MIT
