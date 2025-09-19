# fp-ts Migration Guide

This guide maps fp-ts concepts to our functional library and documents gaps to implement.

## Export Conflicts Resolved

- ✅ Renamed `tap` → `tapOption` in option.mts
- ✅ Renamed `sequence` → `sequenceOption` in option.mts
- ✅ Renamed `sequence` → `sequenceAsync` in composition.mts
- ✅ Updated Option namespace exports

## fp-ts Equivalents (Already Implemented)

### Core Types
| fp-ts | Our Library | Notes |
|-------|-------------|-------|
| `Either<E, A>` | `Result<T, E>` | Order reversed: success first |
| `Option<A>` | `Option<T>` | Same concept |
| `ReaderTaskEither<R, E, A>` | `ReaderResult<R, E, A>` | Async Reader + Result |

### Result/Either Functions
| fp-ts | Our Library |
|-------|-------------|
| `Either.right/left` | `Result.ok/err` |
| `Either.map` | `Result.map` |
| `Either.chain` | `Result.flatMap` |
| `Either.mapLeft` | `Result.mapError` |
| `Either.fold/match` | `Result.fold` |
| `Either.getOrElse` | `Result.getOrElse` |
| `Either.alt` | `Result.orElse` |
| `TaskEither.tryCatch` | `Result.fromPromise` |
| `Either.tryCatch` | `Result.fromThrowable` |
| `Either.isRight/isLeft` | `Result.isOk/isErr` |

### Option Functions
| fp-ts | Our Library |
|-------|-------------|
| `Option.some/none` | `Option.some/none` |
| `Option.map` | `Option.map` |
| `Option.chain` | `Option.flatMap/chain` |
| `Option.fromNullable` | `Option.fromNullable` |
| `Option.getOrElse` | `Option.getOrElse` |
| `Option.filter` | `Option.filter` |
| `Option.fold` | `Option.match` |

### ReaderResult/ReaderTaskEither Functions
| fp-ts | Our Library |
|-------|-------------|
| `ReaderTaskEither.of` | `ReaderResult.of` |
| `ReaderTaskEither.ask/asks` | `ReaderResult.ask/asks` |
| `ReaderTaskEither.chain` | `ReaderResult.chain` |
| `ReaderTaskEither.tryCatch` | `ReaderResult.tryCatch` |

**Note**: `ReaderResult.tryCatch` handles the `fromPromise` use case - no need for separate implementation.

## Consensus Recommendations for Implementation

Based on consensus from Gemini Pro and Gemini Flash, here are the prioritized recommendations:

### 🔴 HIGH Priority (Implement First)

**Strong Agreement:**
1. **`Task<A>`** - Async computation that always succeeds
   - Foundation for async operations
   - Critical for Promise interop

2. **`IO<A>`** - Synchronous side effects
   - Fundamental for pure side effect management
   - Enables referential transparency

3. **`traverse/sequence` for Result**
   - Essential for processing arrays where items can fail
   - Most critical missing utility

4. **`ap` / `sequenceT` / `sequenceS` for Result**
   - Applicative utilities for combining independent Results
   - Massive ergonomic win for validations

5. **Do notation helpers for Result/Option**
   - Game-changer for readability
   - Transforms nested chains into imperative style

**Some Disagreement (Flash rates HIGH, Pro rates MEDIUM):**
6. **`Reader<R, A>`** - Plain dependency injection
   - Flash: HIGH (foundational for DI)
   - Pro: MEDIUM (ReaderResult covers many cases)
   - **Recommendation**: Include as HIGH priority

7. **`bimap`** - Map both channels simultaneously
   - Flash: HIGH (common for error normalization)
   - Pro: MEDIUM (syntactic sugar)
   - **Recommendation**: Include as HIGH priority

8. **`chainFirst`** - Side effect with original value
   - Flash: HIGH (common for logging)
   - Pro: MEDIUM (nice to have)
   - **Recommendation**: Include as HIGH priority

### 🟡 MEDIUM Priority (Implement After Core)

**Agreement:**
1. **`These<E, A>`** - Both Left and Right simultaneously
   - Useful for accumulating errors with partial success
   - Niche but powerful for validation

2. **`State<S, A>`** - Stateful computations
   - Good for parsers, algorithms
   - Often overkill for simple state

### 🟢 LOW Priority (Defer Implementation)

**Strong Agreement:**
1. **`Writer<W, A>`** - Computations with logging
   - Academic interest mostly
   - Modern apps use dedicated logging

2. **`alt` for Result** - Redundant with our `orElse`

## Implementation Roadmap

### Phase 1: Core Types
```typescript
// task.mts
export type Task<A> = () => Promise<A>;

// io.mts
export type IO<A> = () => A;

// reader.mts
export type Reader<R, A> = (deps: R) => A;
```

### Phase 2: Result Utilities
```typescript
// Add to result.mts
- traverse/sequence
- ap (applicative)
- bimap
- chainFirst
- sequenceT/sequenceS
- Do notation helpers
```

### Phase 3: Option Utilities
```typescript
// Add to option.mts
- Do notation helpers
```

### Phase 4: Consider Later
- These<E, A>
- State<S, A>

## Key Takeaways

1. **Focus on practical value** - Prioritize utilities with common real-world use cases
2. **Group related implementations** - Implement applicative utilities together
3. **Defer academic types** - Writer, State, These are powerful but specialized
4. **Do notation is critical** - Despite complexity, it's a massive ergonomic improvement
5. **Our library is already well-aligned** - Most core fp-ts patterns have equivalents