# @satoshibits/observability

🚀 **Production-ready observability for Full-Stack JavaScript applications** - Works seamlessly in Node.js backends and browser frontends with zero configuration.

## 🤔 The Problem

You're building a JavaScript application. Users are experiencing issues, but you can't reproduce them. Performance degrades randomly. Errors happen in production that never showed up in development. You need answers:

- **Why is this endpoint slow?** Sometimes it takes 50ms, sometimes 5 seconds.
- **What caused this error?** The stack trace points to line 42, but what was the user doing?
- **Is this affecting everyone?** Or just premium customers? Mobile users? A specific region?
- **How often does this happen?** Is it getting worse? Did the last deploy cause it?

## ✨ The Solution

This package gives you **X-ray vision into your application** - both backend and frontend:

```typescript
// One line to start seeing everything
const client = await SmartClient.initialize({
  serviceName: "my-app",
});

// Get scoped instrumentation for your module
const observability = client.getInstrumentation("my-app/checkout", "1.0.0");

// Errors now tell the whole story
try {
  await processPayment(order);
} catch (error) {
  observability.errors.record(error);
  // Automatically captures: user ID, session, feature flags,
  // call stack, related requests, and breadcrumbs
}

// Track what matters to your business
observability.metrics.increment("completed", 1, {
  plan: "premium",
  amount: 99.99,
});

// See the full user journey
client.context.business.addBreadcrumb("Added item to cart");
client.context.business.addBreadcrumb("Applied discount code");
client.context.business.addBreadcrumb("Selected express shipping");
```

## 💡 What is Observability? (A 5-Minute Guide)

If you're new to observability, think of it like this: Your application is a car, and observability gives you:

- **Metrics** = Your dashboard (speedometer, fuel gauge, engine temperature)
- **Logs** = Your diagnostic computer (detailed error codes and system messages)
- **Traces** = Your GPS journey history (where you went, how long each segment took)
- **Context** = The driver, passengers, and trip purpose

### The Three Pillars Explained

#### 1. Metrics - Measuring Your Application

Metrics are numbers that track what's happening in your system over time. They answer questions like "how many?" and "how fast?"

```typescript
// Get scoped instrumentation for your module
const apiMetrics = client.getInstrumentation("my-app/api", "1.0.0");

// Count events (like your car's trip odometer)
apiMetrics.metrics.increment("requests"); // +1
apiMetrics.metrics.increment("revenue", order.total); // +amount

// Track current values (like your fuel gauge)
apiMetrics.metrics.gauge("users.online", activeUsers.size);
apiMetrics.metrics.gauge("queue.depth", messages.length);

// Measure distributions (like tracking your speed over a trip)
apiMetrics.metrics.record("response.time", 234); // milliseconds
apiMetrics.metrics.record("file.size", 5242880); // bytes
```

#### 2. Traces - Understanding Request Flow

A trace tells the complete story of a request through your system. Each step is called a "span."

```typescript
// Get scoped instrumentation for your checkout module
const checkout = client.getInstrumentation("my-app/checkout", "1.0.0");

// Trace shows WHERE time is spent (like GPS segments of your journey)
await checkout.traces.withSpan("checkout-flow", async () => {
  await validateCart(); // 50ms
  await calculateTax(); // 200ms
  await processPayment(); // 1500ms ← Found the bottleneck!
  await sendConfirmation(); // 100ms
});
// Total: 1850ms, Payment processing is the slowdown
```

#### 3. Logs - Recording Detailed Context

Logs capture the specific details of what happened. They're your detailed record.

```typescript
// Get scoped instrumentation for your payment module
const payment = client.getInstrumentation("my-app/payment", "1.0.0");

// Logs tell you WHAT happened (like diagnostic messages)
payment.logs.info("Payment processed", {
  gateway: "stripe",
  amount: 99.99,
  currency: "USD",
});
payment.logs.error("Payment failed", error, {
  reason: "Insufficient funds",
  attempted_amount: 150.0,
});
```

### Key Concepts

**Breadcrumbs**: A trail of user actions leading up to an event

```typescript
// Like your car's trip computer showing recent destinations
client.context.business.addBreadcrumb("Viewed product page");
client.context.business.addBreadcrumb("Added to cart");
client.context.business.addBreadcrumb("Started checkout");
// If an error occurs, you'll see these steps leading to it
```

**Context**: The "who, what, where" automatically attached to all telemetry

```typescript
// Like knowing who was driving and why
client.context.business.setUser({
  id: "user-123",
  plan: "premium",
  region: "us-west",
});
// Now every metric, log, and trace includes this context
```

## 🔄 How It Works: The Journey of a Request

Here's how observability tracks a request through your entire system:

```
Browser          │  API Server        │  Database      │  Queue Worker
                 │                    │                │
[User Click]─────┼──►[POST /api]      │                │
  traceId: A1    │   traceId: A1      │                │
                 │   ├──►[Validate]    │                │
                 │   ├──►[Query DB]────┼──►[SELECT]     │
                 │   │   span: A1.1    │   traceId: A1  │
                 │   ◄──[Results]──────┼────────────────┤
                 │   ├──►[Queue Job]───┼────────────────┼──►[Process]
                 │   │   span: A1.2    │                │   traceId: A1
                 │   │                  │                │   span: A1.2.1
◄────────────────┼───[200 OK]          │                │
  traceId: A1    │   duration: 234ms   │                │

All connected by traceId: A1 - one story across all services!
```

**How Context Flows Automatically:**

- **Backend**: Auto-instrumentation creates a context for each request that flows through all async operations
- **Frontend**: Context maintained through the user's session
- **Cross-Service**: Trace IDs propagate via headers, connecting the entire journey

## 🎯 What Makes This Different?

### 1. **Works Everywhere**

Same API for Node.js backends and browser frontends. Write once, observe everywhere.

### 2. **Simple API with Progressive Depth**

Start simple with `record()`, `increment()`, and `trace()`. Access OpenTelemetry primitives when you need advanced control.

### 3. **Automatic Context**

Every metric, log, and error automatically includes:

- User ID and session
- Request/trace IDs for correlation
- Business context (customer tier, feature flags)
- Navigation breadcrumbs
- Performance timings

### 4. **Privacy Built-in**

Automatically sanitizes:

- Passwords and API keys
- Credit card numbers
- Social security numbers
- Email addresses (configurable)
- JWT tokens

### 5. **Smart Sampling**

Automatically captures:

- 100% of errors
- 100% of slow requests
- 100% of premium customer requests
- 10% of everything else (configurable)

### 6. **Production Ready**

- Graceful degradation when backends are down
- Automatic retries with backoff
- Memory-safe with bounded buffers
- Type-safe with full TypeScript support

## 📦 Installation

```bash
npm install @satoshibits/observability
```

### Import Options

```typescript
// Recommended: Universal entrypoint with auto environment detection
import { SmartClient } from "@satoshibits/observability";

// Optional: Environment-specific initializers (export initialize only)
import { initialize as initializeBrowser } from "@satoshibits/observability/browser";
import { initialize as initializeNode } from "@satoshibits/observability/node";
```

- Use the universal `SmartClient` for most apps (Node, Browser, SSR). It exposes `initialize`, `create`, and `shutdown`.
- Environment-specific helpers (direct SDK wrappers) are available only from `@satoshibits/observability/node` and `@satoshibits/observability/browser`. The universal entrypoint intentionally does not re-export them to avoid cross‑environment bundling.
- The browser implementation uses a lightweight exporter (Fetch/Beacon) to avoid Node dependencies.

## 🧪 Testing

This package supports Node, shared, and real‑browser tests. Use the Vitest Browser Runner for the browser project.

- All tests (Node + Shared + Browser via Browser Runner):
  - `pnpm --filter @satoshibits/observability test`
- Browser‑only (headless):
  - `pnpm --filter @satoshibits/observability run test:browser`
- Browser‑only (headed):
  - `pnpm --filter @satoshibits/observability run test:browser:headed`

Notes
- The Browser Runner requires `@vitest/browser` and a provider like Playwright; install browsers with `npx playwright install`.
- We do not polyfill Node internals in production browser code. Any minimal `process` stubs exist only in test setup to satisfy the runner.

## 🚀 Quick Start: Beyond the Web

### Example 1: Express/Node.js API Server

> 📁 **Complete working example**: [`examples/demo-app/backend/src/server.ts`](./examples/demo-app/backend/src/server.ts)

```typescript
import { SmartClient } from "@satoshibits/observability";

// Initialize once at app startup
const client = await SmartClient.initialize({
  serviceName: "api-server",
  endpoint: process.env.OTEL_ENDPOINT || "http://localhost:4318",
});

// Get scoped instrumentation for your API module
const observability = client.getInstrumentation("api-server/checkout", "1.0.0");

// Automatic instrumentation for Express
app.use((req, res, next) => {
  // User context flows through all async operations automatically
  client.context.run(
    {
      userId: req.user?.id,
      tenantId: req.tenant,
      customerTier: req.user?.plan,
    },
    next,
  );
});

// Track business metrics
app.post("/api/checkout", async (req, res) => {
  const timer = observability.metrics.timer("duration");

  try {
    const order = await processOrder(req.body);
    observability.metrics.increment("success", 1, {
      amount: order.total,
      items: order.items.length,
    });
    timer.end({ status: "success" });
    res.json(order);
  } catch (error) {
    observability.errors.record(error);
    observability.metrics.increment("failed");
    timer.end({ status: "error" });
    res.status(500).json({ error: "Checkout failed" });
  }
});
```

### Example 2: Browser/React Application

> 📁 **Complete working example**: [`examples/demo-app/frontend/src/main.tsx`](./examples/demo-app/frontend/src/main.tsx)

```typescript
import { SmartClient } from "@satoshibits/observability";

// Initialize once at app startup
const client = await SmartClient.initialize({
  serviceName: "web-app",
  endpoint: "https://api.example.com/telemetry",
  // Browser-specific options
  captureErrors: true, // Auto-capture unhandled errors
  captureNavigation: true, // Track page views
  captureInteractions: true, // Track clicks and form submissions
});

// Get scoped instrumentation for your UI module
const uiInstrument = client.getInstrumentation("web-app/ui", "1.0.0");

// Set user context (e.g., after login)
client.context.business.setUser({
  id: user.id,
  email: user.email,
  segment: user.subscription,
});

// Track user interactions
button.addEventListener("click", () => {
  client.context.business.addBreadcrumb("Clicked purchase button");
  uiInstrument.metrics.increment("button.click", 1, {
    button: "purchase",
    product: currentProduct.id,
  });
});

// Retrieve breadcrumbs later (e.g., to attach to diagnostics)
const crumbs = client.context.getBreadcrumbs();
console.log("Recent breadcrumbs:", crumbs);

// Browser exporter note: ensure your endpoint supports CORS and accepts OTLP/JSON payloads.
// Small payloads use navigator.sendBeacon() automatically; larger ones use fetch() with keepalive.
```

## ⚙️ Config Reference (Source of Truth)

- Sanitizer options: see `packages/observability/src/enrichment/sanitizer.mts` for the full, up‑to‑date type and behavior (`SanitizerOptions`, redaction rules, defaults).
- Smart sampling: see `packages/observability/src/sampling.mts` for configuration shape and sampling logic (`SmartSamplerConfig`, categories, rules).

Linking directly to the implementation avoids doc drift during pre‑release.

### Example 3: Background Job Processor

```typescript
import { observability } from "./observability";
import { queue } from "./queue"; // Your message queue client

queue.process("email-jobs", async (job) => {
  // Create dedicated context for this job
  return observability.context.run(
    {
      jobId: job.id,
      jobType: "email",
      priority: job.priority,
    },
    async () => {
      return observability.trace("process-email-job", async (span) => {
        // Add metadata to the trace
        span.setAttribute("email.recipient", job.data.to);
        span.setAttribute("email.template", job.data.template);

        try {
          await observability.trace("render-template", () =>
            renderEmailTemplate(job.data),
          );

          await observability.trace("send-email", () => sendEmail(job.data));

          observability.metrics.increment("emails.sent.success");
          observability.logs.info("Email sent successfully");
        } catch (error) {
          observability.errors.record(error);
          observability.metrics.increment("emails.sent.failed");
          throw error; // Let queue handle retry
        }
      });
    },
  );
});
```

### Example 4: CLI Tool / Data Migration Script

> 📁 **Complete working examples**:
> - Data migration: [`examples/demo-app/cli/src/migrate-data.ts`](./examples/demo-app/cli/src/migrate-data.ts)
> - Queue worker: [`examples/demo-app/cli/src/process-queue.ts`](./examples/demo-app/cli/src/process-queue.ts)

```typescript
#!/usr/bin/env node
import { SmartClient } from "@satoshibits/observability/node";

// Perfect for monitoring one-off scripts
const observability = await SmartClient.initialize({
  serviceName: "data-migration-v2",
  // Scripts often run in different environments
  endpoint: process.env.OTEL_ENDPOINT || "http://localhost:4318",
});

async function migrateUsers() {
  return observability.trace("migrate-users", async () => {
    const users = await fetchLegacyUsers();
    observability.metrics.gauge("migration.total_users", users.length);

    let processed = 0;
    let failed = 0;

    for (const batch of chunk(users, 100)) {
      // Use consistent span name, add variation as attributes
      await observability.trace("migrate-batch", async (span) => {
        span.setAttribute("batch.start_id", batch[0].id);
        span.setAttribute("batch.size", batch.length);

        try {
          await processBatch(batch);
          processed += batch.length;
          observability.metrics.gauge("migration.processed", processed);
        } catch (error) {
          failed += batch.length;
          observability.errors.record(error, { batch_start: batch[0].id });
          observability.metrics.gauge("migration.failed", failed);
        }
      });
    }

    observability.logs.info("Migration completed", { processed, failed });
  });
}

// Run with proper error handling
migrateUsers().catch((error) => {
  observability.errors.record(error);
  process.exit(1);
});
```

## 📚 Core API: Recipes & Decision Trees

### When to Use What?

| If you need to...      | Use this method                    | Example                                 |
| ---------------------- | ---------------------------------- | --------------------------------------- |
| Count occurrences      | `metrics.increment()`              | User signups, API calls, errors         |
| Track a changing value | `metrics.gauge()`                  | Queue size, active users, memory        |
| Measure distributions  | `metrics.record()`                 | Response times, file sizes, amounts     |
| Time an operation      | `metrics.timer()`                  | Database queries, API calls             |
| Debug a slow operation | `trace()`                          | Complex workflows, multi-step processes |
| Record what happened   | `logs.*()`                         | User actions, system events, debugging  |
| Track user journey     | `context.business.addBreadcrumb()` | Navigation, interactions, state changes |
| Identify the user      | `context.business.setUser()`       | After login, on session start           |
| Add business context   | `context.addTag()`                 | Feature flags, A/B tests, customer tier |

### Metrics - Track What Matters

```typescript
// COUNTERS - For things that only go up
observability.metrics.increment("users.signup"); // +1 by default
observability.metrics.increment("revenue", order.total); // Custom amount
observability.metrics.decrement("inventory", 1, { sku }); // Can go down too

// GAUGES - For values that fluctuate
observability.metrics.gauge("memory.usage", process.memoryUsage().heapUsed);
observability.metrics.gauge("users.online", activeUsers.size);
observability.metrics.gauge("queue.depth", pendingJobs.length);

// HISTOGRAMS - For distributions and percentiles
observability.metrics.record("api.latency", responseTime);
observability.metrics.record("order.total", 299.99, { currency: "USD" });
observability.metrics.record("batch.size", items.length);

// TIMERS - Convenience for measuring duration
const timer = observability.metrics.timer("db.query");
const result = await db.query(sql);
const duration = timer.end(); // Returns ms, records to histogram
```

#### Decision Tree: Counter vs Gauge vs Histogram

```
Is it a value that only increases?
├─ Yes → Counter (increment/decrement)
└─ No → Can it go up AND down?
    ├─ Yes → Is it a point-in-time snapshot?
    │   ├─ Yes → Gauge
    │   └─ No → Histogram (you want percentiles)
    └─ No → It's a distribution → Histogram
```

### Tracing - See the Flow

```typescript
// AUTOMATIC TRACING - Wraps async operations
await observability.trace("fetch-user-data", async () => {
  const user = await db.getUser(id);
  const posts = await db.getPosts(user.id);
  return { user, posts };
});
// Automatically times, captures errors, adds context

// MANUAL SPANS - When you need more control
const span = observability.traces.startSpan("complex-operation");
span.setAttribute("user.id", userId);
span.addEvent("Starting validation");
// ... do work
span.addEvent("Validation complete");
span.end();

// DISTRIBUTED TRACING - Connects across services
// Backend: Automatically adds trace headers to responses
// Frontend: Automatically continues the trace
// You see the complete journey!
```

#### When to Add Tracing?

```
Is the operation slow or complex?
├─ No → Don't trace (avoid noise)
└─ Yes → Does it have multiple steps?
    ├─ No → Use a timer instead
    └─ Yes → Does it cross service boundaries?
        ├─ Yes → Definitely trace (distributed tracing)
        └─ No → Is it business-critical?
            ├─ Yes → Trace it
            └─ No → Consider sampling
```

### Logging - Structured & Correlated

```typescript
// Logs automatically include trace IDs, user context, and breadcrumbs
observability.logs.info("Order placed", { orderId, total });
observability.logs.warn("Inventory low", { sku, remaining: 5 });
observability.logs.error("Payment failed", error, { orderId });

// Debug logs in development, ignored in production
observability.logs.debug("Cache hit", { key, ttl });
```

#### Log Levels Guide

| Level   | When to Use                        | Example                      |
| ------- | ---------------------------------- | ---------------------------- |
| `debug` | Development only, verbose details  | SQL queries, cache keys      |
| `info`  | Normal operations, business events | User login, order placed     |
| `warn`  | Concerning but handled             | Low memory, high latency     |
| `error` | Failures requiring attention       | Payment failed, service down |

### Error Handling - Full Story, Every Time

```typescript
// RECORD ERRORS - With automatic context
observability.errors.record(error);
// Captures: stack, user, session, breadcrumbs, related traces

// WRAP RISKY OPERATIONS
const data = await observability.errors.wrap(() => fetchExternalAPI(), {
  retry: true,
  timeout: 5000,
});

// ERROR BOUNDARIES - With fallback
const safeFn = observability.errors.boundary(riskyFunction, (error) => {
  // Fallback logic
  return defaultValue;
});

// RESULT TYPES - If using functional patterns
const result = await fetchUser(id);
observability.result.trace(result); // Records if failed
if (result.success) {
  return result.value;
}
```

### Context - The Story Behind the Data

```typescript
// USER IDENTITY - Set after authentication
// Use context.business.setUser() with an object:
client.context.business.setUser({
  id: user.id,
  email: user.email,
  name: user.name,
  segment: user.customerTier,  // Optional: segment field for grouping
});

// BREADCRUMBS - Track the user journey
// Simple string + optional data (recommended):
client.context.business.addBreadcrumb("Viewed product", { id: productId });
client.context.business.addBreadcrumb("Added to cart");
client.context.business.addBreadcrumb("Applied coupon", { code: "SAVE20" });

// With category and level in data:
client.context.business.addBreadcrumb("Payment processing started", {
  category: "action",  // action | navigation | http | error | console | info
  level: "info",       // debug | info | warning | error
  amount: 99.99,
  method: "stripe"
});

// TAGS - Add searchable metadata
client.context.addTag("feature", "checkout-v2");
client.context.addTag("experiment", "fast-checkout");
client.context.addTag("region", "us-west");

// SCOPED CONTEXT - For specific operations (Node.js)
client.context.run(
  {
    tenantId: "acme-corp",
    feature: "reporting",
  },
  async () => {
    // Everything in here includes tenantId and feature
    await generateReport();
  },
);

// GET TRACE ID - Useful for error messages and support
const traceId = client.context.getTraceId();
// Display to users: "Error ID: ABC123" for support tickets
```

#### Where to Capture Context?

```
Is it user-specific?
├─ Yes → Set at authentication (context.business.setUser)
└─ No → Is it request-specific?
    ├─ Yes → Set in middleware (context.run)
    └─ No → Is it app-wide?
        ├─ Yes → Set at initialization
        └─ No → Set at point of use (addTag)
```

## 🔌 Auto-Instrumentation

### Node.js - 100+ Libraries Automatically Tracked

The library automatically instruments popular packages across:

- **Web Frameworks** (Express, Fastify, Koa, Next.js, and more)
- **Databases** (PostgreSQL, MySQL, MongoDB, Redis, and more)
- **HTTP Clients** (Axios, node-fetch, got, and more)
- **Message Queues** (RabbitMQ, Kafka, Bull, SQS, and more)
- **Cloud SDKs** (AWS, Google Cloud, Azure)
- **ORMs & ODMs** (Prisma, TypeORM, Sequelize, Mongoose, and more)

📖 **[View Complete Compatibility Matrix](./docs/compatibility.md)** for the full, up-to-date list of supported libraries and versions.

### Browser - Core Web APIs Automatically Tracked

- **Page Navigation**: Load time, route changes
- **HTTP Requests**: Fetch, XMLHttpRequest
- **User Interactions**: Clicks, form submissions
- **Errors**: Unhandled exceptions, promise rejections
- **Performance**: Core Web Vitals, resource timings
- **Console**: Errors and warnings

## 🔒 Privacy & Security

### Automatic PII Sanitization

Sensitive data is automatically redacted before leaving your application:

```typescript
observability.logs.info("User login", {
  username: "john",
  password: "secret123", // → '[REDACTED]'
  apiKey: "sk_live_abc", // → 'sk_live_[REDACTED]'
  ssn: "123-45-6789", // → '[REDACTED]'
  creditCard: "4242424242424242", // → '[REDACTED]'
  email: "user@example.com", // → 'u***@example.com' (configurable)
  jwt: "eyJhbGc...", // → '[JWT_REDACTED]'
});
```

### Configurable Sanitization

```typescript
const observability = await SmartClient.initialize({
  serviceName: "my-app",
  sanitize: {
    enabled: true,
    redactEmails: false, // Keep emails visible
    customPatterns: [
      /employee_id:\s*\d+/gi, // Custom patterns
    ],
    allowedFields: ["user.id"], // Never redact these
  },
});
```

## 🧪 Testing Your Instrumentation

> 📁 **Complete working example**: [`examples/demo-app/backend/src/__tests__/orders.test.ts`](./examples/demo-app/backend/src/__tests__/orders.test.ts)

Testing observability code is critical. We provide a mock client that captures all telemetry:

```typescript
import { MockClient } from "@satoshibits/observability/testing";

describe("checkout process", () => {
  test("successful checkout records metrics", async () => {
    const mockObservability = new MockClient();

    await checkout(cart, mockObservability);

    // Assert metrics were recorded
    expect(mockObservability.metrics.incremented("checkout.completed")).toBe(
      true,
    );
    expect(mockObservability.metrics.getIncrement("payment.success")).toBe(
      99.99,
    );

    // Assert traces were created
    expect(mockObservability.traces.hasSpan("process-payment")).toBe(true);
    const span = mockObservability.traces.getSpan("process-payment");
    expect(span.duration).toBeLessThan(2000); // Under 2 seconds

    // Assert no errors
    expect(mockObservability.errors.recorded()).toHaveLength(0);
  });

  test("failed payment records error", async () => {
    const mockObservability = new MockClient();
    paymentGateway.charge = jest
      .fn()
      .mockRejectedValue(new Error("Insufficient funds"));

    await expect(checkout(cart, mockObservability)).rejects.toThrow();

    // Assert error was recorded with context
    expect(mockObservability.errors.recorded()).toHaveLength(1);
    const error = mockObservability.errors.getLastError();
    expect(error.message).toBe("Insufficient funds");
    expect(error.context.cartId).toBe(cart.id);
  });
});
```

## 🚢 Production Readiness Guide

### Managing Data Volume & Cost

Observability data can be expensive. Use sampling to control costs:

```typescript
const observability = await SmartClient.initialize({
  serviceName: "my-app",
  sampling: {
    base: 0.1, // 10% of normal traffic
    rules: [
      // Always capture important data
      { error: true, rate: 1.0 }, // 100% of errors
      { slow: true, rate: 1.0 }, // 100% of slow requests (>1s)
      { userId: /^vip-/, rate: 1.0 }, // 100% of VIP users

      // Reduce noise
      { path: "/health", rate: 0 }, // 0% of health checks
      { path: "/metrics", rate: 0 }, // 0% of metric endpoints

      // Sample by business importance
      { customerTier: "enterprise", rate: 0.5 }, // 50% of enterprise
      { customerTier: "free", rate: 0.01 }, // 1% of free tier
    ],
  },
});
```

#### Cost Optimization Tips

1. **Start with aggressive sampling** (0.01) and increase as needed
2. **Exclude noisy endpoints** like health checks and metrics
3. **Sample by business value** - more for paying customers
4. **Use dynamic sampling** - increase during incidents
5. **Set retention policies** in your backend (e.g., 7 days for traces, 30 for metrics)

### Common Pitfalls & Anti-Patterns

#### ❌ High Cardinality Tags in Metrics

**BAD**: Creates millions of unique time series

```typescript
// DON'T DO THIS
observability.metrics.increment("api.requests", 1, {
  userId: user.id, // Millions of unique values!
  requestId: req.id, // Every request is unique!
  timestamp: Date.now(), // Infinite cardinality!
});
```

**GOOD**: Use low-cardinality tags

```typescript
// DO THIS INSTEAD
observability.metrics.increment("api.requests", 1, {
  customerTier: user.tier, // ~5 values (free, basic, pro, enterprise)
  endpoint: "/api/users", // ~100 endpoints
  status: "success", // 2 values
});

// Put high-cardinality data in traces/logs
observability.traces.currentSpan?.setAttribute("user.id", user.id);
observability.logs.info("Request processed", {
  userId: user.id,
  requestId: req.id,
});
```

### 📊 Metric Naming Best Practices

Following consistent naming conventions prevents cardinality explosions and makes your metrics discoverable and queryable.

#### Metric Name Guidelines

**Use hierarchical dot notation** - Group related metrics under common prefixes:

```typescript
// ✅ GOOD - Clear hierarchy
"api.requests.count"
"api.requests.duration"
"api.errors.count"
"api.errors.rate"

"payment.stripe.success"
"payment.stripe.failed"
"payment.paypal.success"

"db.query.duration"
"db.pool.size"
"db.connection.errors"
```

**Keep names static** - Never include dynamic data in metric names:

```typescript
// ❌ BAD - Creates infinite metrics
`user_${userId}_requests`  // Creates user_123_requests, user_456_requests...
`api_${endpoint}_duration`  // Creates api_/users/123_duration, api_/orders/456_duration...

// ✅ GOOD - Use attributes for dynamic data
observability.metrics.increment("user.requests", 1, { userId });
observability.metrics.record("api.duration", ms, { endpoint });
```

**Follow OpenTelemetry conventions** - Use semantic naming patterns:

```typescript
// Resource operations
"http.server.request.duration"
"http.client.request.size"
"db.client.query.duration"

// Business metrics (custom, but consistent)
"business.orders.completed"
"business.revenue.total"
"business.users.active"
```

**Use underscores for units** - Make units explicit:

```typescript
"response.time_ms"           // Milliseconds
"file.size_bytes"            // Bytes
"queue.depth_count"          // Count
"memory.usage_mb"            // Megabytes
"latency.p95_seconds"        // Seconds
```

#### Attribute Best Practices

**Use low-cardinality attributes** - Keep unique combinations under 1000:

```typescript
// ✅ GOOD - Low cardinality (manageable combinations)
observability.metrics.increment("api.requests", 1, {
  method: "GET",           // ~7 values (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
  status_code: "200",      // ~20 values (200, 201, 400, 401, 404, 500, etc.)
  customer_tier: "pro",    // ~5 values (free, basic, pro, enterprise, admin)
  region: "us-west",       // ~10 values (major regions)
});
// Total combinations: 7 × 20 × 5 × 10 = 7,000 time series (acceptable)

// ❌ BAD - High cardinality (exploding combinations)
observability.metrics.increment("api.requests", 1, {
  user_id: user.id,        // 1M+ values
  request_id: req.id,      // Infinite values
  timestamp: Date.now(),   // Infinite values
  session_id: session,     // 100K+ values
});
// Total combinations: Millions or billions of time series (disaster)
```

**Common low-cardinality attributes:**

| Category | Attribute Examples | Typical Cardinality |
|----------|-------------------|---------------------|
| **HTTP** | `method`, `status_code`, `protocol` | 5-50 |
| **User Segments** | `tier`, `cohort`, `plan`, `role` | 3-20 |
| **Geographic** | `region`, `country`, `continent` | 5-200 |
| **Environment** | `env`, `stage`, `deployment` | 3-10 |
| **Status** | `success`/`error`, `state`, `phase` | 2-10 |
| **Resource Types** | `resource_type`, `operation`, `action` | 5-50 |

**Attribute naming conventions:**

```typescript
// Use snake_case for attributes (OpenTelemetry convention)
{
  customer_tier: "enterprise",  // ✅ GOOD
  customerTier: "enterprise",   // ❌ Inconsistent with OTel
}

// Prefix boolean attributes with "is_" or "has_"
{
  is_premium: true,
  has_discount: false,
  cache_hit: true,  // Boolean meaning is clear
}

// Use standard semantic attributes where available
{
  "http.method": "POST",
  "http.status_code": 200,
  "db.operation": "SELECT",
  // See: https://opentelemetry.io/docs/specs/semconv/
}
```

#### Scope Naming Conventions

Instrumentation scopes provide module-level attribution. Scope names **must be static**.

```typescript
// ✅ GOOD - Static module identifiers
const checkout = client.getInstrumentation("my-app/checkout", "1.0.0");
const database = client.getInstrumentation("my-app/database", "2.3.1");
const payments = client.getInstrumentation("@company/payment-sdk", "1.5.0");

// ❌ BAD - Dynamic scope names (library will throw an error)
const userScope = client.getInstrumentation(`user/${userId}`);  // ⚠️ Error!
const tenantScope = client.getInstrumentation(`tenant-${id}`);  // ⚠️ Error!

// ✅ CORRECT - Use attributes for dynamic data
const observability = client.getInstrumentation("my-app/users", "1.0.0");
observability.metrics.increment("user.login", 1, { userId });
```

**Scope naming patterns:**

```typescript
// Application modules
"app-name/module-name"       // "my-shop/checkout", "my-shop/inventory"

// Library/SDK format
"@company/library-name"      // "@acme/auth-sdk", "@acme/payments"

// Domain-driven design
"service-name/domain"        // "api/orders", "api/users", "api/products"
```

The library validates scope names and prevents high-cardinality patterns like UUIDs, timestamps, user IDs, and session IDs.

#### Complete Example: E-commerce Metrics

```typescript
// Get scoped instrumentation for checkout module
const checkout = client.getInstrumentation("my-shop/checkout", "2.1.0");

// ✅ Perfect metric structure
checkout.metrics.increment("checkout.started", 1, {
  // Low-cardinality business attributes
  customer_tier: "enterprise",   // 5 values
  checkout_type: "express",      // 3 values (express, standard, guest)
  has_discount: true,            // 2 values
  region: "us-west",             // 10 values
  // Total: 5 × 3 × 2 × 10 = 300 time series ✅
});

checkout.metrics.record("checkout.duration_ms", durationMs, {
  status: "success",             // 2-3 values (success, error, timeout)
  payment_method: "stripe",      // 5-10 values
  items_count_range: "1-5",      // 5 values (1-5, 6-10, 11-20, 21-50, 50+)
});

// ❌ Don't do this - high cardinality
checkout.metrics.increment("checkout", 1, {
  order_id: order.id,            // ❌ Infinite values
  user_id: user.id,              // ❌ Millions of values
  exact_amount: order.total,     // ❌ Infinite values
  timestamp: Date.now(),         // ❌ Infinite values
});

// ✅ Put high-cardinality data in traces/logs instead
checkout.traces.startSpan("checkout").setAttributes({
  "order.id": order.id,          // ✅ OK in traces
  "user.id": user.id,            // ✅ OK in traces
  "order.amount": order.total,   // ✅ OK in traces
});
```

#### Decision Tree: Metric Name vs Attribute

```
Is the value dynamic (user IDs, timestamps, amounts)?
├─ Yes → Use as trace/log attribute, NOT metric attribute
└─ No → Does it have < 100 unique values?
    ├─ Yes → Safe as metric attribute
    └─ No → How many?
        ├─ 100-1000 → Use cautiously, consider bucketing
        └─ > 1000 → Use in traces/logs only, or bucket into ranges
```

#### ❌ Tracing Trivial Operations

**BAD**: Creates noise without value

```typescript
// DON'T DO THIS
await observability.trace("add-numbers", () => {
  return a + b; // Synchronous, instant operation
});
```

**GOOD**: Trace meaningful operations

```typescript
// DO THIS INSTEAD
await observability.trace("process-order", async () => {
  await validateOrder();
  await chargePayment();
  await updateInventory();
  await sendConfirmation();
});
```

#### ❌ Generic Naming

**BAD**: Makes data hard to search and aggregate

```typescript
observability.metrics.increment("success"); // Success of what?
observability.metrics.increment("error"); // What kind of error?
observability.trace("process", () => {}); // Process what?
```

**GOOD**: Use descriptive, hierarchical names

```typescript
observability.metrics.increment("payment.success");
observability.metrics.increment("auth.login.failed");
observability.trace("checkout.payment.process", () => {});
```

#### ❌ Logging Sensitive Data

**BAD**: PII in logs is a security/compliance risk

```typescript
observability.logs.info("User logged in", {
  password: user.password, // NEVER log passwords!
  creditCard: card.number, // PCI violation!
  ssn: user.ssn, // Privacy violation!
});
```

**GOOD**: Log only what's necessary

```typescript
observability.logs.info("User logged in", {
  userId: user.id,
  email: user.email, // Will be auto-sanitized to u***@example.com
  loginMethod: "oauth",
});
```

### Production Checklist

Before going to production:

- [ ] **Sampling configured** - Start low (1-10%), increase as needed
- [ ] **PII sanitization tested** - Verify sensitive data is redacted
- [ ] **Alerts configured** - Set up alerts for error rates, latencies
- [ ] **Dashboards created** - Build dashboards for key metrics
- [ ] **Retention configured** - Set appropriate data retention periods
- [ ] **Costs estimated** - Calculate telemetry costs at expected volume
- [ ] **Team trained** - Ensure team knows how to use observability data
- [ ] **Runbook updated** - Document what metrics/traces mean
- [ ] **Fallback tested** - Verify app works when telemetry backend is down
- [ ] **Context verified** - Ensure user/business context is captured

### When NOT to Use Observability

- **Tiny scripts** that run once and exit
- **Development-only tools** that never run in production
- **Extremely high-frequency operations** (use sampling or aggregate first)
- **Sensitive operations** where even metadata could be a security risk

## ⚙️ Configuration

Configuration is provided via the `SmartClient.initialize()` method. The configuration adapts to your environment automatically, or you can specify options explicitly.

### Core Options

```typescript
const client = await SmartClient.initialize({
  // Required
  serviceName: 'my-app',                              // Your application identifier

  // Optional - Environment detection
  environment: 'node' | 'browser',                    // Auto-detected if omitted

  // Optional - Telemetry backend
  endpoint: 'http://localhost:4318',                  // OTLP endpoint URL
  headers: { 'Authorization': 'Bearer token' },       // Custom headers for auth

  // Optional - Auto-instrumentation
  autoInstrument: true,                               // Enable automatic tracing
                                                      // (Express, databases, HTTP clients in Node.js)
                                                      // (fetch, XHR, navigation in browser)
});
```

### Environment-Specific Configuration

#### Node.js Configuration

```typescript
const client = await SmartClient.initialize({
  serviceName: 'api-server',
  environment: 'node',  // Explicit (or auto-detected)
  autoInstrument: true, // ✅ Recommended: Instruments Express, databases, HTTP clients
  endpoint: process.env.OTEL_ENDPOINT || 'http://localhost:4318',
});
```

**When `autoInstrument: true` (default for Node.js):**
- ✅ Automatic HTTP server instrumentation (Express, Fastify, Koa, etc.)
- ✅ Automatic database instrumentation (PostgreSQL, MySQL, MongoDB, Redis, etc.)
- ✅ Automatic HTTP client instrumentation (axios, node-fetch, got, etc.)
- ✅ Automatic queue instrumentation (Bull, BullMQ, SQS, RabbitMQ, etc.)

**When `autoInstrument: false` (recommended for CLI scripts and workers):**
- Manual instrumentation only
- Use for CLI scripts, data migrations, background workers
- Reduces overhead for non-HTTP workloads

#### Browser Configuration

```typescript
const client = await SmartClient.initialize({
  serviceName: 'web-app',
  environment: 'browser',  // Explicit (or auto-detected)
  endpoint: 'https://api.example.com/telemetry',

  // Browser-specific options
  captureErrors: true,            // Auto-capture unhandled errors and promise rejections
  captureNavigation: true,        // Track page views and route changes
  captureInteractions: true,      // Track clicks, form submissions, input events
  captureConsole: false,          // Capture console.error() calls (default: false)

  // Performance monitoring
  capturePerformance: true,       // Core Web Vitals, resource timings

  // Privacy controls
  sanitize: {
    enabled: true,
    redactEmails: true,           // Redact email addresses
    customPatterns: [],           // Additional patterns to redact
  },
});
```

**Browser-specific features:**
- ✅ Automatic error capture (`window.onerror`, `unhandledrejection`)
- ✅ Automatic navigation tracking (page views, route changes)
- ✅ Automatic interaction tracking (clicks, form submissions)
- ✅ Core Web Vitals (LCP, FID, CLS, TTFB)
- ✅ Resource timing (scripts, styles, images, fonts)
- ✅ Lightweight exporter (uses `fetch` with `keepalive` and `sendBeacon`)

### Sampling Configuration

Control data volume and costs with rule-based sampling:

```typescript
const client = await SmartClient.initialize({
  serviceName: 'my-app',
  sampling: {
    base: 0.1,  // Sample 10% of normal traffic

    rules: [
      // Always capture important data
      { error: true, rate: 1.0 },              // 100% of errors
      { slow: true, rate: 1.0 },               // 100% of slow requests (>1s)

      // Reduce noise
      { path: '/health', rate: 0 },            // 0% of health checks
      { path: '/metrics', rate: 0 },           // 0% of metrics endpoints

      // Sample by business importance
      { path: '/api/checkout', rate: 1.0 },    // 100% of checkout (critical)
      { path: '/api/orders', rate: 0.5 },      // 50% of orders
      { customerTier: 'enterprise', rate: 0.8 }, // 80% of enterprise users
      { customerTier: 'free', rate: 0.01 },    // 1% of free tier
    ],
  },
});
```

### Sanitization Configuration

Protect sensitive data with automatic PII redaction:

```typescript
const client = await SmartClient.initialize({
  serviceName: 'my-app',
  sanitize: {
    enabled: true,

    // Control email redaction
    redactEmails: true,  // 'user@example.com' → 'u***@example.com'

    // Custom patterns to redact (in addition to built-in patterns)
    customPatterns: [
      /employee_id:\s*\d+/gi,
      /internal_token:\s*\w+/gi,
    ],

    // Fields that should never be redacted
    allowedFields: ['user.id', 'trace.id'],
  },
});
```

**Automatically redacted patterns:**
- Passwords (`password`, `passwd`, `pwd`)
- API keys (`api_key`, `apiKey`, `secret`)
- Tokens (`token`, `auth_token`, `bearer`)
- Credit cards (all major card formats)
- Social security numbers (SSN, US format)
- JWT tokens (starts with `eyJ`)

### Performance Limits

Prevent memory issues with bounded buffers:

```typescript
const client = await SmartClient.initialize({
  serviceName: 'my-app',

  // Breadcrumb limits
  maxBreadcrumbs: 100,          // Maximum breadcrumbs to keep (default: 100)

  // Attribute limits
  maxTags: 50,                  // Maximum tags per event (default: 50)
  maxSpanAttributes: 128,       // Maximum attributes per span (default: 128)

  // Batch sizes
  batchSize: 512,               // Batch size for telemetry exports (default: 512)
  batchTimeout: 5000,           // Batch timeout in ms (default: 5000)
});
```

### Complete Configuration Example

```typescript
const client = await SmartClient.initialize({
  // Core
  serviceName: 'my-production-app',
  environment: 'node',
  endpoint: process.env.OTEL_ENDPOINT,
  headers: {
    'Authorization': `Bearer ${process.env.OTEL_TOKEN}`,
  },

  // Auto-instrumentation
  autoInstrument: true,

  // Sampling
  sampling: {
    base: 0.1,
    rules: [
      { error: true, rate: 1.0 },
      { slow: true, rate: 1.0 },
      { path: '/health', rate: 0 },
    ],
  },

  // Privacy
  sanitize: {
    enabled: true,
    redactEmails: true,
    customPatterns: [/internal_id:\s*\d+/gi],
  },

  // Performance
  maxBreadcrumbs: 100,
  maxTags: 50,
  batchSize: 512,
  batchTimeout: 5000,
});
```

📖 **[View the complete `SmartClientConfig` TypeScript interface](./docs/api.md#config)** for all configuration options with detailed descriptions and types.

> 📁 **Demo app configuration guide**: [`examples/demo-app/CONFIG.md`](./examples/demo-app/CONFIG.md) - Complete configuration reference for the demo application with environment variables, sampling examples, and deployment checklist.

## 🔧 Backend Support

Works with any OpenTelemetry-compatible backend:

- **Grafana Cloud** - Traces (Tempo) + Metrics (Prometheus) + Logs (Loki)
- **Datadog** - Full APM suite
- **New Relic** - Application monitoring
- **Honeycomb** - Observability platform
- **Jaeger** - Open source tracing
- **Zipkin** - Distributed tracing
- **Elastic APM** - Part of Elastic Stack
- **AWS X-Ray** - AWS native
- **Google Cloud Trace** - GCP native
- **Azure Monitor** - Azure native

### Quick Backend Setup Examples

> **Note**: These configurations are illustrative examples. Please consult each backend's official documentation for the most up-to-date setup instructions.

#### Local Development (Jaeger)

```bash
docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
# UI at http://localhost:16686
# Configure: endpoint: 'http://localhost:4318'
```

#### Grafana Cloud

```typescript
// Check Grafana's docs for current authentication method
{
  endpoint: 'https://otlp-gateway-prod-us-central-0.grafana.net/otlp',
  headers: {
    'Authorization': `Basic ${Buffer.from(`${instanceId}:${apiKey}`).toString('base64')}`
  }
}
```

#### Datadog

```typescript
// Verify endpoint URL in Datadog's documentation
{
  endpoint: 'https://api.datadoghq.com',
  headers: {
    'DD-API-KEY': process.env.DD_API_KEY
  }
}
```

## 💡 Real-World Examples

### E-Commerce Checkout Flow

```typescript
// Track the entire checkout process with full observability
app.post("/api/checkout", async (req, res) => {
  return observability.trace("checkout", async () => {
    const { cartId, paymentMethod } = req.body;

    // Business context flows through automatically
    client.context.business.addBreadcrumb("Checkout started", { cartId });
    observability.metrics.increment("checkout.started");

    // Validate cart
    const cart = await observability.trace("validate-cart", () =>
      validateCart(cartId),
    );

    if (!cart.valid) {
      observability.metrics.increment("checkout.invalid_cart");
      throw new ValidationError("Invalid cart");
    }

    // Process payment
    client.context.business.addBreadcrumb("Processing payment");
    const payment = await observability.trace("process-payment", async () => {
      const timer = observability.metrics.timer("payment.duration");

      try {
        const result = await paymentGateway.charge({
          amount: cart.total,
          method: paymentMethod,
        });

        timer.end({ status: "success", gateway: "stripe" });
        observability.metrics.increment("payment.success", cart.total);

        return result;
      } catch (error) {
        timer.end({ status: "failed", error: error.code });
        observability.errors.record(error, {
          cartId,
          amount: cart.total,
        });
        throw error;
      }
    });

    // Create order
    const order = await createOrder(cart, payment);

    observability.metrics.increment("checkout.completed", 1, {
      amount: order.total,
      items: order.items.length,
      customerTier: req.user.tier,
    });

    client.context.business.addBreadcrumb("Checkout completed", {
      orderId: order.id,
    });

    return order;
  });
});
```

### React Error Boundary with Observability

#### Modern Approach with Hooks (Recommended)

```tsx
import { ErrorBoundary } from "react-error-boundary";
import { observability } from "./observability";

function ErrorFallback({ error, resetErrorBoundary }) {
  // Record error when fallback renders
  React.useEffect(() => {
    observability.errors.record(error);
    observability.metrics.increment("ui.error", 1, {
      component: "ErrorBoundary",
      error: error.name,
    });
  }, [error]);

  return (
    <div role="alert">
      <h2>Something went wrong</h2>
      <p>Error ID: {observability.context.getTraceId()}</p>
      <details style={{ whiteSpace: "pre-wrap" }}>{error.message}</details>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

// Usage in your app
function App() {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, errorInfo) => {
        // Log error with component stack
        observability.errors.record(error, {
          componentStack: errorInfo.componentStack,
        });
      }}
    >
      <YourAppComponents />
    </ErrorBoundary>
  );
}
```

#### Class Component Approach (Legacy)

```tsx
import { Component, ErrorInfo } from "react";
import { observability } from "./observability";

class ErrorBoundary extends Component {
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Full error context automatically captured
    observability.errors.record(error, {
      component: errorInfo.componentStack,
      props: this.props,
      state: this.state,
      // breadcrumbs are captured automatically
    });

    // Track error metrics
    observability.metrics.increment("ui.error", 1, {
      component: this.constructor.name,
      error: error.name,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div>
          <h2>Something went wrong</h2>
          <p>Error ID: {observability.context.getTraceId()}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### Database Connection Pool Monitoring

```typescript
class DatabasePool {
  constructor(private observability: ObservabilityClient) {
    // Track pool metrics every 10 seconds
    setInterval(() => this.recordMetrics(), 10000);
  }

  private recordMetrics() {
    // Note: Property names vary by database client library
    // Adjust these based on your pool implementation (pg, mysql2, etc.)
    this.observability.metrics.gauge("db.pool.size", this.pool.size);
    this.observability.metrics.gauge("db.pool.available", this.pool.available);
    this.observability.metrics.gauge("db.pool.waiting", this.pool.waitingCount);
    this.observability.metrics.gauge("db.pool.active", this.pool.activeCount);
  }

  async query<T>(sql: string, params?: any[]): Promise<T> {
    const timer = this.observability.metrics.timer("db.query.duration");

    return this.observability.trace("db.query", async (span) => {
      span.setAttribute("db.statement", sql);
      span.setAttribute("db.operation", sql.split(" ")[0]); // SELECT, INSERT, etc

      const connection = await this.acquire();

      try {
        const result = await connection.query(sql, params);
        timer.end({ status: "success" });
        return result;
      } catch (error) {
        timer.end({ status: "error" });
        this.observability.errors.record(error, { sql });
        throw error;
      } finally {
        this.release(connection);
      }
    });
  }
}
```

## 🤝 Resources & Getting Help

This README provides a high-level overview. For detailed references and support:

- 📖 **[Full Documentation](https://docs.satoshibits.com/observability)** - In-depth guides and tutorials
- ⚙️ **[API Reference](./docs/api.md)** - Complete TypeScript definitions and method signatures
- 📦 **[Compatibility Matrix](./docs/compatibility.md)** - Up-to-date list of auto-instrumented libraries
- 🔄 **[Changelog](./CHANGELOG.md)** - Recent updates and migration guides
- 💬 **[Discord Community](https://discord.gg/satoshibits)** - Ask questions and share experiences
- 🐛 **[Report Issues](https://github.com/satoshibits/observability/issues)** - Report bugs or request features
- 📧 **[Email Support](support@satoshibits.com)** - For commercial support inquiries

## 📈 What You'll See

Once integrated, you'll be able to answer:

- **Performance**: Which endpoints are slow? For which users? Since when?
- **Errors**: What's the error rate? Which errors are new? Who's affected?
- **Business**: Conversion rate? Cart abandonment? Feature adoption?
- **User Experience**: Page load times? Time to interactive? Rage clicks?
- **Infrastructure**: Memory leaks? Connection pool exhaustion? CPU spikes?

## License

ISC - Use it freely in your projects!
