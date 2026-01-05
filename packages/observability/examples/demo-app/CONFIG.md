# Demo Application Configuration Guide

This document explains all configuration options available in the observability demo application.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Backend Configuration](#backend-configuration)
- [Frontend Configuration](#frontend-configuration)
- [CLI Configuration](#cli-configuration)
- [Observability Configuration](#observability-configuration)
- [Docker Compose Configuration](#docker-compose-configuration)

---

## Environment Variables

### `.env` File

The demo uses environment variables for configuration. Copy `.env` to `.env.local` and customize:

```bash
# Grafana Admin Password
GRAFANA_ADMIN_PASSWORD=demo_secure_password

# Service Ports (optional overrides)
FRONTEND_PORT=3000
BACKEND_PORT=3001
GRAFANA_PORT=3002
PROMETHEUS_PORT=9090
JAEGER_PORT=16686
OTEL_COLLECTOR_PORT=4318

# Frontend Configuration
VITE_USE_CONSOLE_EXPORTER=    # 1 to enable console output (for quick demos)
VITE_BACKEND_URL=http://localhost:3001

# Backend Configuration
OBSERVABILITY_ENDPOINT=http://localhost:4318
FRONTEND_URL=http://localhost:3000
```

### Environment Variable Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAFANA_ADMIN_PASSWORD` | `demo_secure_password` | Grafana admin password |
| `FRONTEND_PORT` | `3000` | React frontend port |
| `BACKEND_PORT` | `3001` | Express backend port |
| `GRAFANA_PORT` | `3002` | Grafana dashboard port |
| `PROMETHEUS_PORT` | `9090` | Prometheus metrics port |
| `JAEGER_PORT` | `16686` | Jaeger UI port |
| `OTEL_COLLECTOR_PORT` | `4318` | OpenTelemetry Collector port |
| `VITE_USE_CONSOLE_EXPORTER` | _(empty)_ | Enable browser console exporter (1=enabled) |
| `VITE_BACKEND_URL` | `http://localhost:3001` | Backend API URL for frontend |
| `OBSERVABILITY_ENDPOINT` | `http://localhost:4318` | Telemetry backend endpoint |
| `FRONTEND_URL` | `http://localhost:3000` | Frontend URL for CORS |

---

## Backend Configuration

### Observability Configuration (`backend/src/server.ts`)

The backend uses `SmartClient.initialize()` with the following configuration:

```typescript
const observabilityConfig = {
  serviceName: "web-store-backend",
  environment: "node" as const,
  endpoint: process.env.OBSERVABILITY_ENDPOINT ?? "http://localhost:4318",
  autoInstrument: true,

  sampling: {
    base: 0.1, // 10% of normal traffic

    rules: [
      // Always capture important data
      { error: true, rate: 1.0 },     // 100% of errors
      { slow: true, rate: 1.0 },      // 100% of slow requests (>1s)

      // Reduce noise from health checks
      { path: "/health", rate: 0 },   // 0% of health checks

      // Sample by endpoint importance
      { path: "/api/orders", rate: 0.5 },   // 50% of orders
      { path: "/api/payments", rate: 1.0 }, // 100% of payments (critical)
    ],
  },
};
```

#### Configuration Options

##### `serviceName` (required)
- **Type**: `string`
- **Value**: `"web-store-backend"`
- **Purpose**: Identifies this service in telemetry data

##### `environment` (optional)
- **Type**: `"node" | "browser"`
- **Value**: `"node"`
- **Purpose**: Explicitly sets environment (auto-detected if omitted)

##### `endpoint` (optional)
- **Type**: `string`
- **Default**: `"http://localhost:4318"`
- **Purpose**: OpenTelemetry Collector endpoint
- **Override**: Set `OBSERVABILITY_ENDPOINT` environment variable

##### `autoInstrument` (optional)
- **Type**: `boolean`
- **Default**: `true`
- **Purpose**: Enable automatic instrumentation for Express, databases, HTTP clients
- **Recommendation**: Keep `true` for web servers, set `false` for CLI scripts

##### `sampling` (optional)
- **Type**: `SmartSamplerConfig`
- **Purpose**: Control data volume and costs
- **Structure**:
  ```typescript
  {
    base: number,      // Base sampling rate (0-1)
    rules: Array<{     // Conditional sampling rules
      error?: boolean, // Match errors
      slow?: boolean,  // Match slow requests (>1s)
      path?: string,   // Match request path
      [key: string]: any // Custom context matching
      rate: number     // Sampling rate (0-1)
    }>
  }
  ```

#### Customizing Sampling

**Example 1: Aggressive sampling for high traffic**
```typescript
sampling: {
  base: 0.01,  // 1% of normal traffic
  rules: [
    { error: true, rate: 1.0 },
    { slow: true, rate: 1.0 },
    { path: "/health", rate: 0 },
    { customerTier: "enterprise", rate: 0.5 },  // 50% of enterprise
    { customerTier: "free", rate: 0.001 },      // 0.1% of free tier
  ],
}
```

**Example 2: Debug mode (sample everything)**
```typescript
sampling: {
  base: 1.0,  // 100% of all traffic
  rules: [],
}
```

**Example 3: Errors and critical paths only**
```typescript
sampling: {
  base: 0,  // Don't sample normal traffic
  rules: [
    { error: true, rate: 1.0 },
    { path: "/api/checkout", rate: 1.0 },
    { path: "/api/payments", rate: 1.0 },
  ],
}
```

#### Context Middleware

The backend uses `context.run()` middleware to propagate context automatically:

```typescript
app.use((req, res, next) => {
  if (observabilityClient) {
    observabilityClient.context.run(
      {
        requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        method: req.method,
        path: req.path,
      },
      next,
    );
  } else {
    next();
  }
});
```

**Customize context** by adding additional fields:
```typescript
{
  requestId: generateRequestId(),
  method: req.method,
  path: req.path,
  tenantId: req.headers['x-tenant-id'],  // Multi-tenant
  userId: req.user?.id,                   // After authentication
  environment: process.env.NODE_ENV,
}
```

---

## Frontend Configuration

### Observability Configuration (`frontend/src/main.tsx`)

The frontend uses browser-specific configuration:

```typescript
const client = await SmartClient.initialize({
  serviceName: 'web-store-frontend',
  environment: 'browser',
  endpoint: 'http://localhost:4318/v1/traces',

  // Browser-specific options
  captureErrors: true,
  captureNavigation: true,
  captureInteractions: true,
  capturePerformance: true,
});
```

#### Configuration Options

##### Browser-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `captureErrors` | `boolean` | `true` | Auto-capture unhandled errors and promise rejections |
| `captureNavigation` | `boolean` | `true` | Track page views and route changes |
| `captureInteractions` | `boolean` | `true` | Track clicks, form submissions, input events |
| `captureConsole` | `boolean` | `false` | Capture `console.error()` calls |
| `capturePerformance` | `boolean` | `true` | Capture Core Web Vitals and resource timings |

#### Console Exporter Mode

For quick demos without infrastructure:

```bash
# Enable console exporter
VITE_USE_CONSOLE_EXPORTER=1 npm run dev
```

When enabled, telemetry is printed to browser console instead of sent to collector.

**Use cases:**
- Quick demos without Docker stack
- Local development without telemetry backend
- Debugging telemetry data

**Note**: Disable for production or when using full observability stack.

---

## CLI Configuration

### Data Migration Script (`cli/src/migrate-data.ts`)

```typescript
const observabilityConfig = {
  serviceName: 'data-migration-cli',
  environment: 'node' as const,
  endpoint: process.env.OBSERVABILITY_ENDPOINT ?? 'http://localhost:4318',
  autoInstrument: false,  // ⚠️ Important for CLI scripts
};
```

### Queue Worker (`cli/src/process-queue.ts`)

```typescript
const observabilityConfig = {
  serviceName: 'queue-worker',
  environment: 'node' as const,
  endpoint: process.env.OBSERVABILITY_ENDPOINT ?? 'http://localhost:4318',
  autoInstrument: false,  // ⚠️ Important for workers
};
```

#### Why `autoInstrument: false` for CLI?

CLI scripts and background workers typically:
- Don't use HTTP servers (Express, Fastify)
- Don't need automatic HTTP client tracing
- Have different performance characteristics
- Benefit from explicit instrumentation

**When to use `autoInstrument: false`:**
- ✅ CLI scripts (data migrations, one-off tasks)
- ✅ Background workers (queue processors)
- ✅ Scheduled jobs (cron tasks)
- ✅ Testing utilities

**When to use `autoInstrument: true`:**
- ✅ Web servers (Express, Fastify, Koa)
- ✅ API gateways
- ✅ Microservices with HTTP endpoints

---

## Observability Configuration

### Common Patterns

#### Scoped Instrumentation

All examples use `getInstrumentation()` for module-level attribution:

```typescript
// Backend route
const orderService = client.getInstrumentation('web-store/orders', '1.0.0');

// Frontend component
const uiInstrument = client.getInstrumentation('web-store-frontend/ui', '1.0.0');

// CLI script
const migrationService = client.getInstrumentation('data-migration', '1.0.0');
```

**Naming conventions:**
- Format: `"service/module"` or `"@company/package"`
- Examples: `"my-app/checkout"`, `"@acme/auth-sdk"`
- Must be static (no user IDs, timestamps, or dynamic data)

#### Low-Cardinality Metrics

The demo follows best practices for metric attributes:

```typescript
// ✅ GOOD - Low cardinality
orderService.metrics.increment('orders_created', {
  source: 'api',              // ~3 values
  order_status: 'success',    // ~3 values
});

// ❌ BAD - High cardinality (commented out in demo)
// orderService.metrics.increment('orders_created', {
//   user_id: userId,          // Millions of values!
//   product_id: productId,    // Thousands of values!
// });
```

**High-cardinality data belongs in traces:**
```typescript
span.setAttributes({
  'order.product_id': productId,  // ✅ OK in traces
  'order.user_id': userId,        // ✅ OK in traces
});
```

#### Graceful Degradation

The demo handles observability failures gracefully:

```typescript
try {
  observabilityClient = await SmartClient.initialize(observabilityConfig);
  console.log('✅ Observability initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize observability:', error);
  console.warn('⚠️  Service will continue without observability telemetry');
  // App continues running
}
```

---

## Docker Compose Configuration

### Service Configuration

The demo uses Docker Compose with the following services:

```yaml
services:
  otel-collector:   # OpenTelemetry Collector
  jaeger:           # Distributed tracing UI
  prometheus:       # Metrics storage & query
  grafana:          # Dashboards & visualization
  frontend:         # React app (optional - can run locally)
  backend:          # Express API (optional - can run locally)
```

### Ports

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 3000 | React application |
| Backend | 3001 | Express API |
| Grafana | 3002 | Dashboards |
| OTel Collector | 4318 | OTLP HTTP endpoint |
| Prometheus | 9090 | Metrics query |
| Jaeger UI | 16686 | Trace visualization |

### Volumes

Persistent data is stored in named volumes:
- `prometheus_data` - Metrics time series
- `grafana_data` - Dashboards and settings

**To reset all data:**
```bash
docker-compose down -v
```

---

## Advanced Configuration

### Custom Headers

For authenticated backends:

```typescript
const client = await SmartClient.initialize({
  serviceName: 'my-app',
  endpoint: process.env.OTEL_ENDPOINT,
  headers: {
    'Authorization': `Bearer ${process.env.OTEL_TOKEN}`,
    'X-Custom-Header': 'value',
  },
});
```

### Performance Limits

Prevent memory issues with bounded buffers:

```typescript
const client = await SmartClient.initialize({
  serviceName: 'my-app',
  maxBreadcrumbs: 100,        // Max breadcrumbs to keep
  maxTags: 50,                // Max tags per event
  maxSpanAttributes: 128,     // Max attributes per span
  batchSize: 512,             // Telemetry batch size
  batchTimeout: 5000,         // Batch timeout (ms)
});
```

### PII Sanitization

Customize what gets redacted:

```typescript
const client = await SmartClient.initialize({
  serviceName: 'my-app',
  sanitize: {
    enabled: true,
    redactEmails: false,     // Keep emails visible
    customPatterns: [
      /employee_id:\s*\d+/gi, // Custom patterns
    ],
    allowedFields: ['user.id'], // Never redact these
  },
});
```

---

## Configuration Checklist

Before deploying:

- [ ] Set strong `GRAFANA_ADMIN_PASSWORD`
- [ ] Configure appropriate sampling rates
- [ ] Enable PII sanitization for production
- [ ] Set custom headers for authentication
- [ ] Configure performance limits for your scale
- [ ] Test graceful degradation (disable collector)
- [ ] Verify CORS settings for browser telemetry
- [ ] Document custom configuration for your team

---

## Troubleshooting

### No Telemetry Data

1. **Check collector health:**
   ```bash
   curl http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d '{}'
   ```

2. **Check application logs:**
   ```bash
   # Backend
   docker-compose logs backend | grep observability

   # Frontend (browser console)
   # Look for initialization messages
   ```

3. **Verify endpoint URLs:**
   - Backend: `http://otel-collector:4318` (Docker network)
   - Frontend: `http://localhost:4318/v1/traces` (from browser)

### High Cardinality Warnings

If metrics explode:

1. Review metric attributes for high-cardinality values (user IDs, timestamps)
2. Move high-cardinality data to traces
3. Use bucketing for numeric values (e.g., `"1-5"`, `"6-10"`, `"11-20"`)
4. Increase sampling to reduce volume

### CORS Errors (Frontend)

If browser can't send telemetry:

1. Check `otel-collector-config.yml` CORS settings
2. Verify `endpoint` URL is accessible from browser
3. Check browser console for CORS errors
4. Consider using console exporter for development

---

## See Also

- **Main README**: `../../../README.md` - Core library documentation
- **Demo README**: `./README.md` - Demo architecture and scenarios
- **CLI README**: `./cli/README.md` - CLI examples documentation
