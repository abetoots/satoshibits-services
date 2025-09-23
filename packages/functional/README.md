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

Each module exposes its own "For Dummies" primer and decision tree at the very top of the source file. Treat those JSDoc blocks as the single source of truth—they are updated alongside the implementation and explain how to choose between related helpers.

- [`array-utils.mts`](./src/array-utils.mts) – Immutable array helpers.
- [`object-utils.mts`](./src/object-utils.mts) – Copy-on-write object transforms.
- [`composition.mts`](./src/composition.mts) – `pipe`, `flow`, `compose`, and friends.
- [`predicates.mts`](./src/predicates.mts) – Predicate combinators and batteries-included checks.
- [`performance.mts`](./src/performance.mts) – Debounce/throttle/batching utilities plus timing helpers.
- [`pipeline.mts`](./src/pipeline.mts) – Chainable class wrapper over composition patterns.
- [`result.mts`](./src/result.mts) – Explicit success/error container utilities.
- [`reader.mts`](./src/reader.mts) & [`reader-result.mts`](./src/reader-result.mts) – Dependency injection-friendly monads.
- [`task.mts`](./src/task.mts) – Lazy async computations.
- [`option.mts`](./src/option.mts) – Maybe-style optional handling.
- [`types.mts`](./src/types.mts) – Branded/nominal type helpers.
- [`validation.mts`](./src/validation.mts) – Result-powered validation DSL.

> 📌 Tip: when in doubt, open the module and read the lead JSDoc—it includes simple explanations, usage guidance, and decision trees that stay in sync with the code.

## Usage Patterns

### Import Strategy

Prefer targeted subpath imports so bundlers only touch the code you need. The root export still works and is now marked `sideEffects: false`, so unused utilities are tree-shaken either way.

```typescript
// Focused imports keep bundles lean
import { pipe, compose } from "@satoshibits/functional/composition";
import { mapValues, pick } from "@satoshibits/functional/object-utils";

// Root import stays available; bundlers will drop unused exports
import { Result } from "@satoshibits/functional";
```

### Composition Patterns

Functions are designed to work together through composition:

```typescript
import { chunk, filterMap } from "@satoshibits/functional/array-utils";
import { pipe } from "@satoshibits/functional/composition";
import { isNotNil } from "@satoshibits/functional/predicates";

// Combine utilities for complex transformations
const processData = pipe(
  filterMap((x: unknown) => (isNotNil(x) ? x : undefined)),
  chunk(10),
);
```

### Error Handling

Use Result types for explicit error handling:

```typescript
import { findSafe } from "@satoshibits/functional/array-utils";
import { Result } from "@satoshibits/functional";

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
6. Refresh the module's lead JSDoc so the "For Dummies" + decision tree guidance stays accurate

## License - MIT
