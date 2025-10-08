# Documentation Principles: Preventing Code Drift

**Date**: 2025-10-08
**Context**: Principles established through analysis with Gemini Pro to prevent documentation drift

## The Problem

Documentation that duplicates code structure inevitably drifts from reality:
- **API examples** show methods that don't exist (`BullMQProvider.factory()`)
- **Interface definitions** copied into docs become outdated
- **Type signatures** manually maintained fall out of sync
- **Configuration options** documented exhaustively require constant updates

**Result**: Users encounter code that doesn't work, support burden increases, trust erodes.

## Core Principles

### 1. The Source is the Truth

**TypeScript source files are the ultimate authority** on API signatures, configuration interfaces, and types.

**✅ DO:**
- Link directly to source files for complete API reference
- Use comments like: `// See BullMQProviderConfig in src/providers/bullmq/bullmq.provider.mts`
- Trust the code, not the docs, when there's conflict

**❌ DON'T:**
- Copy interface definitions into documentation
- Manually maintain type signatures in markdown
- Duplicate method signatures from implementation

**Example - Before (will drift):**
```markdown
### BullMQProviderConfig

```typescript
interface BullMQProviderConfig {
  connection: ConnectionOptions;
  prefix?: string;
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: "exponential" | "fixed";
      delay: number;
    };
    removeOnComplete?: boolean | number;
    removeOnFail?: boolean | number;
  };
  healthErrorRateThreshold?: number;
}
```
```

**Example - After (resilient):**
```markdown
### BullMQProvider Configuration

```typescript
const provider = new BullMQProvider({
  connection: {
    host: 'localhost',
    port: 6379
  }
  // For full configuration options, see BullMQProviderConfig
  // in src/providers/bullmq/bullmq.provider.mts
});
```
```

### 2. Document for the Consumer

**README is for users** of the library. Focus on *how to use it*, not *how it works*.

**Consumer Needs:**
- How do I get started?
- What are common use cases?
- How do I solve specific problems?
- Where can I find complete details?

**Contributor Needs (ARCHITECTURE.md):**
- Why was it designed this way?
- What are the trade-offs?
- How do components interact?
- What are the invariants?

**✅ DO:**
- Show realistic, minimal working examples
- Explain concepts and patterns
- Link to source for exhaustive details
- Focus on the "what" and "why" over the "how"

**❌ DON'T:**
- Document internal implementation details in README
- Copy every config option into consumer docs
- Explain architecture decisions in quick-start guides
- Duplicate information between README and ARCHITECTURE

### 3. Examples are Executable Contracts

**Every code example is a promise** to your user that "this works."

**✅ DO:**
- Keep examples minimal but complete
- Test examples or extract them from tests
- Update examples when APIs change
- Prefer real-world scenarios over toy examples

**❌ DON'T:**
- Use fictional methods or APIs
- Show incomplete examples that won't compile
- Include commented-out "variations" that confuse
- Create examples you haven't actually run

**Testing Strategy:**
```typescript
// Good: Example is literally from your test suite
// test/examples/readme-quickstart.test.ts
it('matches README quick start example', async () => {
  // This code block is copied directly to README
  const queue = new Queue('emails');
  await queue.add('send-welcome', { userId: 123 });
  // ...
});
```

### 4. Show, Don't Just Tell

**A well-chosen example is more instructive than an exhaustive list.**

**✅ DO:**
- Show common configuration patterns in code blocks
- Use realistic use cases in examples
- Demonstrate best practices implicitly
- Let code speak for itself

**❌ DON'T:**
- Create tables of every possible option
- Write prose descriptions when code is clearer
- Explain what the code obviously does
- Duplicate information from JSDoc

**Example - Before (exhaustive, will drift):**
```markdown
### Worker Options

- `concurrency`: number - Max concurrent jobs (default: 1)
- `batchSize`: number - Jobs per fetch (default: 1)
- `pollInterval`: number - Milliseconds between polls (default: 100)
- `errorBackoff`: number - Wait after error (default: 1000)
- `provider`: IQueueProvider - Queue provider instance (required)
- `maxJobSize`: number - Max job payload bytes (default: undefined)
- ... (12 more options)
```

**Example - After (practical, resilient):**
```markdown
### Worker Options

```typescript
const worker = new Worker('emails', handler, {
  provider: myProvider,
  concurrency: 10,
  batchSize: 5
});
```

For all available options, see the `WorkerOptions` interface in `src/api/worker.mts`.
```

## Practical Guidelines

### For README.md

**Target Audience**: Library consumers, developers integrating the library

**Include:**
- Installation instructions
- Quick start with minimal example
- Common patterns and use cases
- Troubleshooting common mistakes
- Links to source for detailed config

**Exclude:**
- Internal implementation details
- Complete interface definitions
- Architecture rationale
- Provider implementation specifics

**Structure:**
```markdown
1. What/Why (value proposition)
2. Quick Start (minimal working example)
3. Core Concepts (how to think about it)
4. Common Patterns (real-world usage)
5. Configuration Reference (minimal + link to source)
6. Links to ARCHITECTURE.md for deep dives
```

### For ARCHITECTURE.md

**Target Audience**: Contributors, maintainers, architects evaluating the library

**Include:**
- Design principles and rationale
- Trade-offs and alternatives considered
- Component interactions and boundaries
- Invariants and constraints
- Extension points
- Links to specific implementation files

**Exclude:**
- API usage examples (that's README)
- Installation/quick-start (that's README)
- Complete interface dumps (that's source)
- Step-by-step tutorials (that's README)

**Structure:**
```markdown
1. Philosophy (why it exists, what problems it solves)
2. Architecture Overview (high-level components)
3. Design Decisions (trade-offs, alternatives)
4. Key Abstractions (provider interface, job lifecycle)
5. Extension Points (how to add providers)
6. Constraints and Invariants (what must remain true)
```

### Linking Strategy

**Link to source** for exhaustive details:
```markdown
For complete configuration options, see:
- `BullMQProviderConfig` in `src/providers/bullmq/bullmq.provider.mts`
- `WorkerOptions` in `src/api/worker.mts`
```

**Link to ARCHITECTURE.md** for design rationale:
```markdown
Why do we use Result types? See [Error Handling](./ARCHITECTURE.md#error-handling).
```

**Link to examples/** for complex scenarios:
```markdown
See [Production Setup Example](./examples/production-setup/) for a complete runnable demonstration.
```

## Code Example Template

```typescript
// Good example structure:

// 1. Minimal imports
import { Queue, Worker } from '@satoshibits/queue';
import { BullMQProvider } from '@satoshibits/queue/providers/bullmq';

// 2. Show the actual API (not fictional)
const provider = new BullMQProvider({
  connection: { host: 'localhost', port: 6379 }
  // Comment pointing to source for full config
});

// 3. Realistic use case
const queue = new Queue('emails', {
  provider: provider.forQueue('emails')
});

// 4. No commented-out variations
await queue.add('send-welcome', { userId: 123 });
```

## Red Flags: When Documentation Will Drift

🚩 **Copied interface definition** - Will diverge from source
🚩 **Exhaustive option table** - Will become incomplete
🚩 **Method signature in prose** - Will change in implementation
🚩 **Multiple examples of same pattern** - Hard to keep consistent
🚩 **Commented-out code** - Confusing, likely outdated
🚩 **"Coming soon" features** - Never updated when implemented
🚩 **Inline type definitions** - Duplicates source of truth

## Maintenance Workflow

### When Adding a Feature

1. ✅ Implement feature with tests
2. ✅ Add ONE minimal example to README (if user-facing)
3. ✅ Document design decision in ARCHITECTURE.md (if significant)
4. ✅ Link to source for complete details
5. ❌ Don't copy interface definition to docs
6. ❌ Don't create exhaustive option tables

### When Changing an API

1. ✅ Update implementation and tests
2. ✅ Search docs for code examples using old API
3. ✅ Update examples to use new API
4. ✅ Verify links to source files are still correct
5. ❌ Don't need to update interface docs (they link to source)

### During Code Review

**Check for:**
- [ ] Examples match actual implementation
- [ ] No copied interfaces or type definitions
- [ ] Links to source for complete details
- [ ] Examples are minimal and realistic
- [ ] ARCHITECTURE.md has design rationale, not usage
- [ ] README has usage, not implementation details

## Summary: Quick Reference

| Aspect | ✅ DO | ❌ DON'T |
|--------|-------|----------|
| **API Reference** | Link to source files | Copy interface definitions |
| **Examples** | Minimal, tested, realistic | Exhaustive, fictional, complex |
| **Config Options** | Show common cases + link | List every option in table |
| **Design Rationale** | ARCHITECTURE.md | README.md |
| **Usage Patterns** | README.md | ARCHITECTURE.md |
| **Type Signatures** | Let TypeScript provide them | Maintain in docs manually |
| **Complete Details** | Point to source | Duplicate in markdown |

## Application Checklist for ARCHITECTURE.md

When updating ARCHITECTURE.md, ensure:

- [ ] Focus on **why** decisions were made, not **how** to use the API
- [ ] Explain **trade-offs** and alternatives considered
- [ ] Document **invariants** that must be maintained
- [ ] Link to **specific implementation files** for examples
- [ ] Avoid duplicating **interface definitions** (link to source)
- [ ] Keep **component diagrams** conceptual, not exhaustive
- [ ] Document **extension points** for contributors
- [ ] Reference **specific commits/PRs** for historical context when relevant
- [ ] Distinguish between **philosophy** (timeless) and **implementation** (may change)

---

**Remember**: Documentation should be a **map**, not a **duplicate** of the territory. Maps can be simple and still be accurate. Duplicates will always drift.
