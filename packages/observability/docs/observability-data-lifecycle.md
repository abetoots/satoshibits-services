# The Complete Observability Data Lifecycle Guide
*From Browser Click to Observability Backend*

Ever wondered what *actually* happens when you call `client.metrics.increment()` or `client.errors.capture()`? How does that single line of code in your application translate into a rich, queryable dashboard with correlated traces, logs, and metrics?

This guide demystifies that journey. We'll follow a single user interaction from a browser click, through a backend service, and finally to the point of export, explaining both *what* happens and *how* it happens under the hood.

## Part A: The Journey of a Single Click

Let's imagine a simple e-commerce application: a React frontend (`web-store`) and an Express.js backend (`order-service`). Our user, Jane, is about to complete her purchase.

**Scenario: Jane clicks "Submit Order".**

### 1. 🖱️ The Click (React Frontend)

Jane clicks the button. In the `onClick` handler, our application code interacts with the `UnifiedObservabilityClient`:

```typescript
// In a React component
const handleSubmitOrder = async () => {
  client.context.addBreadcrumb('User clicked Submit Order');
  client.metrics.increment('orders.submitted', 1, { cartValue: 129.99 });

  try {
    // The client's FetchInstrumentation will automatically trace this.
    const response = await fetch('/api/orders', { method: 'POST', /* ... */ });
    // ...handle success
  } catch (error) {
    client.errors.capture(error as Error, { context: 'order-submission' });
  }
};
```

Here's what happens instantly:
- ✅ **Breadcrumb** → Created and added to the in-memory `ContextEnricher`'s breadcrumb buffer
- ✅ **Metric** → SDK finds or creates a `Counter` instrument and updates its in-memory aggregate value (very low overhead)
- ✅ **Span** → `FetchInstrumentation` intercepts the call, starting a new span named `HTTP POST`
- ✅ **Context Propagation** → Instrumentation injects a `traceparent` HTTP header containing the unique `traceId` and `spanId`

At this moment, the trace span is active, but no data has been sent to a backend yet. It's all efficiently held in the browser's memory.

### 2. 🔄 The Processing (Express.js Backend)

The request, carrying its `traceparent` passport, arrives at the `order-service`.

- The Node.js SDK's `HttpInstrumentation` automatically detects the `traceparent` header, extracts the context, and starts a new backend span, linking it as a child of the frontend `fetch` span
- **Our distributed trace is now connected across services**

```typescript
// In an Express route handler
app.post('/api/orders', async (req, res) => {
  // Add business-specific context for this request's scope
  await client.context.run({ tenantId: 'acme-corp' }, async () => {
    try {
      const order = await client.trace('database.saveOrder', async () => {
        return db.orders.save(req.body);
      });

      client.logs.info('Order saved successfully', { orderId: order.id });
      res.status(201).json(order);

    } catch (dbError) {
      client.errors.capture(dbError as Error);
      res.status(500).send('Failed to save order');
    }
  });
});
```

**What happens here:**
- `client.context.run()` uses `AsyncLocalStorage` to apply `tenantId: 'acme-corp'` to all telemetry generated within its callback
- `client.trace()` creates a new child span for the database operation
- `client.logs.info()` emits a structured log automatically stamped with the current `traceId` and `spanId`
- When the handler finishes, the `HttpInstrumentation` automatically ends the backend spans

### 3. 📤 The Export (Sending the Data)

The telemetry has been generated, but it still resides in memory on the respective machines. The final step is exporting it.

**On the Backend (Node.js):**
- Ended spans sit in the `BatchSpanProcessor`'s buffer. Within 5 seconds (by default), this processor sends them as a compressed batch to the OTel Collector
- Log records sit in the `BatchLogRecordProcessor` and are exported in similar batches
- The `orders.submitted` metric's value is held by the `PeriodicExportingMetricReader`. Every 10 seconds, it exports the latest aggregated value

**On the Frontend (Browser):**
- When the `fetch` call completes, its span ends and is pushed into our custom `BrowserBatchSpanProcessor`'s queue
- Within 500ms (or if the queue hits 50 spans), the processor bundles up all finished spans and sends them using the `FetchSpanExporter`
- This exporter intelligently uses `navigator.sendBeacon()`—a highly reliable API for sending data even if the user navigates away immediately
  - Falls back to `fetch()` with `keepalive: true` for larger payloads
  - Avoids Node dependencies entirely; ensure your telemetry endpoint supports CORS and OTLP/JSON

The journey is complete. A single click has generated a distributed trace, metrics, logs, and breadcrumbs, all correlated and sent efficiently from two different environments to your observability backend.

## Part B: Behind the Scenes—The Implementation Mechanics

The smooth journey described above is made possible by specific components working in concert.

### 1. 🔄 Batching: Server vs. Browser

**Node.js (`BatchSpanProcessor`)**
- Designed for high-throughput, long-running services
- Collects telemetry in a buffer and exports on a timer (5s) or when buffer is full (512 spans)
- Prioritizes network efficiency over immediate feedback
- *Implementation*: `sdk-wrapper-node.mts`, Line 144: `spanProcessor = new BatchSpanProcessor(...)`

**Browser (`BrowserBatchSpanProcessor`)**
- Designed for the unpredictable browser environment
- Custom implementation that exports more frequently (500ms or 50 spans)
- Avoids Node.js-specific APIs and built for resilience
- *Implementation*: `sdk-wrapper-browser.mts`, Line 141: `export class BrowserBatchSpanProcessor ...`

### 2. 🧠 Memory Management: Preventing Leaks

In long-running Single-Page Applications (SPAs), telemetry could accumulate indefinitely. We prevent this with explicit limits:

**Span Queue Management:**
```typescript
if (this._spans.length > this._maxQueueSize) {
  this._spans.splice(0, this._spans.length - this._maxQueueSize);
}
```
- The `BrowserBatchSpanProcessor` is capped at 100 spans
- If more spans are generated before export, the oldest ones are dropped
- Ensures most recent data is preserved while preventing memory bloat
- *Implementation*: `sdk-wrapper-browser.mts`, Lines 176-178

**Breadcrumb Buffer Management:**
```typescript
if (this.breadcrumbs.length > this.maxBreadcrumbs) {
  this.breadcrumbs.shift();
}
```
- Global `ContextEnricher` maintains a circular buffer of up to 100 breadcrumbs
- When the 101st breadcrumb is added, the 1st one is removed
- *Implementation*: `enrichment/context.mts`, Lines 213-215

### 3. 🗂️ Context Enrichment: The "Two Pockets" System

To ensure telemetry has the right context without data leaking between requests, we use a two-part system:

**Global Context (`ContextEnricher`) - "Session Pocket"**
- Holds long-lived data: `sessionId`, `userId`, breadcrumb buffer
- Managed as a singleton
- Persists across operations

**Async Context (`runWithBusinessContext`) - "Request Pocket"**
- Holds short-lived data relevant only to current operation: `tenantId`, `feature` flags
- Powered by `AsyncLocalStorage` in Node.js
- Keeps context separate for each concurrent request

**The Merge:**
```typescript
return { ...contextLabels, ...businessLabels, ...additionalLabels };
```
These two contexts are only merged at the very last moment when a log or metric is emitted, ensuring perfect enrichment without cross-contamination.
- *Implementation*: `enrichment/context.mts`, Line 655

### 4. 🔗 Error Correlation: Connecting the Dots

When `client.errors.capture()` is called, a precise sequence ensures the error is linked to everything else:

```typescript
const span = trace.getActiveSpan();              // 1. Find active trace
const errorContext = extractErrorContext(error); // 2. Extract error details  
const businessContext = getBusinessContext();    // 3. Get request context
const globalContext = getGlobalContext();        // 4. Get session context

if (span) {
  span.recordException(error);                   // 5. Attach to trace
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.setAttributes(fullContext);
}

logger.emit({ ...fullContext });                 // 6. Emit correlated log
```

**The correlation chain:**
1. **Find the Active Trace** → Grabs currently active span (`trace.getActiveSpan()`)
2. **Gather Evidence** → Collects all context: error details, session context, request context
3. **Attach to Trace** → Error recorded as `recordException` event on span with all context as attributes
4. **Emit Correlated Log** → Structured log with same information, automatically stamped with `traceId` and `spanId`

*Implementation*: `smart-errors.mts`, Lines 324-364

## Part C: Production Considerations

### ⚡ Performance Impact

The SDK is designed to be lightweight with several key optimizations:

**Sampling Control**
- When `SmartSampler` decides to drop a trace at creation, all subsequent operations become inexpensive no-ops
- Cost of an unsampled trace is negligible
- Primary performance control mechanism

**Async Processing**
- All network I/O (exporting) done asynchronously in batches
- Prevents main application thread from being blocked
- Keeps UI responsive and API performant

**Instrument Caching**
- Metrics API reuses instrument objects for common metrics
- Avoids recreating Counter/Histogram/Gauge instruments
- *Implementation*: `unified-smart-client.mts`, Line 411

### 🛡️ Reliability in the Wild

**Browser Reliability Patterns:**
```typescript
// FetchSpanExporter intelligently chooses export method
if (body.length < 65536 && navigator.sendBeacon) {
  navigator.sendBeacon(url, body);
} else {
  fetch(url, { method: 'POST', body, keepalive: true });
}
```
- Uses `navigator.sendBeacon()` for guaranteed delivery even if user closes tab
- Falls back to `fetch` with `keepalive: true` for larger payloads
- *Implementation*: `sdk-wrapper-browser.mts`, Lines 91-109

**Node.js Reliability Patterns:**
- Graceful shutdown hooks for `SIGTERM` signals (common in Kubernetes)
- Attempts to flush buffered telemetry before exiting
- *Implementation*: `sdk-wrapper-node.mts`, Lines 235-237

**Cross‑Environment Safety:**
- Browser SDK never relies on Node internals (no `process`/`Buffer`); export is implemented with Web APIs only
- Node SDK never relies on browser globals; all web APIs are guarded in tests to avoid accidental coupling

**Memory Safety:**
- Bounded queues prevent out-of-memory crashes
- LRU eviction ensures most recent data is preserved
- Circular buffers for long-running sessions

## The Complete Data Flow Diagram

```
┌─────────────┐   traceparent   ┌─────────────┐
│   Browser   │ ─────────────→  │   Node.js   │
│   React     │   HTTP header   │   Express   │
└─────┬───────┘                 └─────┬───────┘
      │ OTLP/HTTP                     │ OTLP/gRPC
      │ (sendBeacon)                  │ (batch)
      ▼                               ▼
┌─────────────────────────────────────────────┐
│         OpenTelemetry Collector            │
├─────────────────┬───────────────────────────┤
│     Traces      │        Metrics            │
│    (Jaeger)     │     (Prometheus)          │
└─────────────────┴───────────────────────────┘
```

## Key Architectural Insights

### Breadcrumbs: The User Journey Trail

Breadcrumbs are **session-level context** that persist across spans and operations:

**Where They Belong:**
- Session-level (not span-level)
- Cross-span context that accumulates over time
- User journey tracking across multiple operations

**Lifecycle:**
```typescript
// 1. ACCUMULATION PHASE
client.context.addBreadcrumb("User clicked login");
client.context.addBreadcrumb("User entered credentials"); 
client.context.addBreadcrumb("Login attempt started");

// 2. CONSUMPTION PHASE (when error occurs)
reportError(error, deps, customContext) {
  const globalContext = getGlobalContext().getContext();
  // Breadcrumbs automatically included in error context
}

// 3. FLUSH PHASE (session cleanup)
client.context.resetSession(); // Clears breadcrumbs
```

**Strategic Value:**
- **User Experience Debugging** → "Why did checkout fail for this user?"
- **A/B Testing Analysis** → "Which user paths lead to errors?"
- **Performance Investigation** → "What sequence of actions causes slowdown?"
- **Security Analysis** → "What did the user do before suspicious activity?"

### Context System Architecture

The "split-brain" context system was unified to provide consistent API behavior:

**Before (Broken):**
- `client.context.addBreadcrumb()` → stored in global `ContextEnricher`
- `client.context.getContext()` → returned only business context (no breadcrumbs)

**After (Unified):**
```typescript
getContext: (): Record<string, unknown> => {
  // Get enriched context (includes breadcrumbs) from global context
  const enrichedContext = getGlobalContext().getContext();
  // Get business context
  const businessContext = getBusinessContext();
  // Merge both contexts, with business context taking precedence
  return {
    ...enrichedContext,
    ...businessContext,
  } as Record<string, unknown>;
}
```

This architectural fix ensures that breadcrumbs added via `addBreadcrumb()` are accessible via `getContext()`, providing the unified API experience users expect.

---

## Conclusion

This layered architecture provides **unified observability** with environment-specific optimizations, ensuring your telemetry data flows reliably from any part of your application to your observability backend.

**The key insight**: Your single line of code (`client.errors.capture()`) triggers a sophisticated chain of correlation, enrichment, and export that preserves context across service boundaries and delivers comprehensive observability.

The SDK handles the complexity of:
- **Cross-service trace propagation** via HTTP headers
- **Memory-safe data collection** with bounded queues
- **Reliable data export** with environment-specific strategies
- **Rich context correlation** linking errors, logs, metrics, and user journeys
- **Performance optimization** through sampling and async processing

Understanding this lifecycle helps you make informed decisions about observability strategy, debugging approaches, and performance optimization in your applications.
