# Changelog

## 2.0.0

### Major Changes

- 0d5eb9e: production-ready functional error handling library without reinventing the wheel

All notable changes to `@satoshibits/functional-errors` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-10-09

### 🎯 Strategic Refocus

This is a **complete rewrite** focused on our core value proposition: **type-safe error taxonomy** with battle-tested resilience patterns. We've eliminated ~40% of the codebase that reinvented wheels and refocused on what makes this library unique.

### ✨ Added

- **cockatiel integration**: Resilience patterns (retry, circuit breaker) now powered by [cockatiel](https://github.com/connor4312/cockatiel)
- **Structural type guards**: Added to types.mts for checking error shapes (`hasTag`, `hasContext`, `hasCause`, etc.)
- **Simplified error constructors**: Removed `Object.freeze()` overhead for better performance
- **New resilience module**: Dedicated `src/resilience/` with clean cockatiel wrappers

### 🔄 Changed

- **Retry logic**: Replaced custom implementation with cockatiel wrapper

  - `retry()` - Now uses cockatiel's exponential backoff
  - `retrySync()` - Synchronous retry without delays
  - `withRetry()` - Create retryable functions
  - API remains similar but powered by production-grade library

- **Circuit breaker**: Replaced custom implementation with cockatiel wrapper

  - `withCircuitBreaker()` - One-time circuit breaker
  - `createCircuitBreaker()` - Reusable circuit breaker
  - `CircuitBreakerManual` - Class-based manual control

- **Validation**: Renamed `accumulator.mts` → `validation.mts`

  - Focused solely on form/field validation
  - Removed generic `ErrorAccumulator` (users can use arrays)
  - Kept `ValidationAccumulator` for field-level error collection

- **Type Guards**: Merged `type-guards.mts` into `types.mts`

  - Single source of truth for all type guards
  - Both type-specific and structural guards in one place

- **Package structure**: Reorganized for clarity
  ```
  src/
  ├── types.mts              # Error taxonomy + type guards
  ├── validation.mts         # Validation accumulator
  ├── handlers.mts           # Error handlers (simplified)
  ├── result-utilities.mts   # Result helpers
  └── resilience/
      ├── retry.mts          # cockatiel retry wrapper
      ├── circuit-breaker.mts # cockatiel circuit breaker wrapper
      └── index.mts          # Resilience exports
  ```

### ❌ Removed

#### Error Types (Too Specific)

- `RateLimitError` - Use `OperationalError` with context instead
- `AuthenticationError` - Use `OperationalError` with context instead

**Migration:**

```typescript
// Before
createRateLimitError("Rate limited", new Date(), 100);

// After
createOperationalError("Rate limited", true, {
  retryAfter: new Date(),
  limit: 100,
});
```

#### Functions (Removed from handlers.mts)

- `categorizeError()` - Naive pattern matching, users should be explicit about error types
- `errorToJSON()` / `errorFromJSON()` - Userland concern, applications should handle serialization
- `filterError()` - Trivial utility, users can implement in 2 lines
- `aggregateResults()` - Just use `Promise.all()` or array methods

#### Utilities (Out of Scope)

- `LRUCache` class - Use [lru-cache](https://www.npmjs.com/package/lru-cache) (40M+ weekly downloads)
- Generic `ErrorAccumulator` - Just use arrays: `const errors: ErrorType[] = []`

#### Runtime Overhead

- Removed `Object.freeze()` from error constructors (TypeScript provides compile-time safety)
- Removed runtime validation (rely on TypeScript's type system)

### 📦 Dependencies

- **Added**: `cockatiel` ^3.2.1 - Battle-tested resilience patterns

### 🔧 Internal Improvements

- Reduced codebase from ~2,800 lines to ~1,400 lines (~50% reduction)
- Eliminated ~900 lines of wheel-reinvention (retry, circuit breaker, cache)
- Improved type safety by relying on TypeScript instead of runtime checks
- Better performance by removing `Object.freeze()` overhead

### 📝 Documentation

- **New README**: Complete rewrite with clear value proposition
- **API examples**: Comprehensive usage examples for all major features
- **Migration guide**: Clear guidance for upgrading from v1.x

### ⚠️ Breaking Changes

This is a **major version** with significant breaking changes. See the [Migration Guide](./README.md#migration-from-v1x) for details.

**Key breaking changes:**

1. Error types removed: `RateLimitError`, `AuthenticationError`
2. Functions removed: `categorizeError`, `errorToJSON`, `errorFromJSON`, `filterError`, `aggregateResults`
3. Utilities removed: `LRUCache`, generic `ErrorAccumulator`
4. Module structure changed: type guards now in `types.mts` instead of separate file
5. Retry/circuit breaker APIs changed: now powered by cockatiel with different configuration options

## [1.0.0] - 2025-08-27

### Initial Release

- Core error taxonomy (9 error types)
- Result pattern implementation
- Custom retry logic with exponential backoff
- Custom circuit breaker implementation
- LRU cache implementation
- Error accumulator for collecting errors
- Type guards for structural checking
- Error handlers and transformers

---

**Legend:**

- ✨ Added: New features
- 🔄 Changed: Changes in existing functionality
- ❌ Removed: Removed features
- 🔧 Fixed: Bug fixes
- 📦 Dependencies: Dependency changes
- 🔧 Internal: Internal improvements

[2.0.0]: https://github.com/abetoots/satoshibits-services/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/abetoots/satoshibits-services/releases/tag/v1.0.0
