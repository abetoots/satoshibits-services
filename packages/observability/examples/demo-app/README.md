# Observability Demo Application

A production-ready demonstration of end-to-end observability using the `@satoshibits/observability` package. This demo shows how to instrument both frontend (React) and backend (Express) applications with distributed tracing, metrics collection, and error tracking.

## 🎯 What This Demo Shows

- **Frontend Observability**: React app with user interactions, performance monitoring, and error tracking
- **Backend Observability**: Express API with distributed tracing, business metrics, and context enrichment
- **CLI & Workers**: Data migration scripts and background queue workers with non-HTTP observability
- **Complete Pipeline**: Telemetry collection → OpenTelemetry Collector → Multiple backends (Jaeger, Prometheus, Grafana)
- **Production Patterns**: Graceful degradation, proper error handling, security best practices

## 🏗️ Architecture

```
┌─────────────┐    ┌─────────────────┐    ┌──────────────────┐
│   React     │    │   Express       │    │  OpenTelemetry   │
│  Frontend   │────│   Backend       │────│    Collector     │
│  (Port 3000)│    │  (Port 3001)    │    │  (Port 4318)     │
└─────────────┘    └─────────────────┘    └──────────────────┘
                                                     │
       ┌─────────────────────────────────────────────┤
       │                                             │
┌──────────────┐                                     │
│ CLI Scripts  │                                     │
│  & Workers   │─────────────────────────────────────┤
│   (Node.js)  │                                     │
└──────────────┘                                     │
                           ┌─────────────────────────┼─────────────────────────┐
                           │                         │                         │
                    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
                    │   Jaeger    │         │ Prometheus  │         │   Grafana   │
                    │  (Traces)   │         │ (Metrics)   │         │ (Dashboards)│
                    │Port 16686   │         │ Port 9090   │         │ Port 3002   │
                    └─────────────┘         └─────────────┘         └─────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Docker** (20.10+)
- **Docker Compose** (2.0+)

### 1. Clone and Navigate

```bash
git clone <repository>
cd packages/observability/examples/demo-app
```

### 2. Configure Environment

Copy the environment file and customize if needed:

```bash
cp .env .env.local
```

Default credentials:
- **Grafana**: admin / demo_secure_password

### 3. Start the Complete Stack

```bash
# Start all services
docker-compose up -d

# View logs (optional)
docker-compose logs -f
```

### 4. Wait for Services

All services should be healthy within 2-3 minutes. Check status:

```bash
docker-compose ps
```

### 5. Access the Applications

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | http://localhost:3000 | React demo app with user interactions |
| **Backend API** | http://localhost:3001 | Express API (try /health endpoint) |
| **Jaeger UI** | http://localhost:16686 | Distributed tracing visualization |
| **Prometheus** | http://localhost:9090 | Metrics query interface |
| **Grafana** | http://localhost:3002 | Dashboards and visualization |

## 🎮 Demo Scenarios

The frontend provides four key scenarios that demonstrate different observability patterns:

### 1. **Order Processing** (`/orders`)
**Demonstrates**: Distributed tracing with multiple service calls
- Place an order with product selection
- Watch traces span: inventory check → payment processing → order persistence
- **View in Jaeger**: Search for `process_order` traces

### 2. **User Profile** (`/profile`) 
**Demonstrates**: Context enrichment and user journey tracking
- Update profile information
- See how user context is enriched throughout the request
- **View in Jaeger**: Search for `update_profile` traces with user context

### 3. **Payment Processing** (`/payments`)
**Demonstrates**: Error handling and retry patterns with observability
- Simulate payment failures (intentional ~30% failure rate)
- Observe error correlation between logs, metrics, and traces
- **View in Jaeger**: Look for failed payment traces with error tags

### 4. **Product Search** (`/search`)
**Demonstrates**: Performance monitoring and caching metrics
- Search for products with different query lengths
- Watch cache hit/miss ratios and performance metrics
- **View in Prometheus**: Query `product_search_duration_ms` metrics

## 🔧 CLI & Background Worker Examples

Beyond HTTP-based workloads, this demo includes observability patterns for **non-HTTP contexts**:

### Data Migration Script (`cli/src/migrate-data.ts`)
**Demonstrates**: Batch processing with observability
- Processes 1000 records in batches of 100
- Progress tracking with console output and metrics
- Individual record error handling without stopping batches
- Performance metrics (throughput, duration)
- **Run it**: `cd cli && npm install && npm run migrate`
- **View in Jaeger**: Search for `migrate_all_records` traces
- **View in Prometheus**: Query `migration_duration_seconds` and `migration_throughput_records_per_sec`

### Queue Processing Worker (`cli/src/process-queue.ts`)
**Demonstrates**: Long-running background worker patterns
- Continuous queue polling (runs until Ctrl+C)
- Retry logic with exponential backoff
- Dead letter queue for failed jobs
- Real-time queue depth and throughput metrics
- Graceful shutdown with telemetry flushing
- **Run it**: `cd cli && npm install && npm run queue`
- **View in Jaeger**: Search for `process_job` traces with retry spans
- **View in Prometheus**: Query `queue_depth` and `worker_throughput_jobs_per_sec`

**Key patterns shown**:
- ✅ `autoInstrument: false` for non-HTTP workloads
- ✅ `client.shutdown()` to flush telemetry before exit
- ✅ Scoped instrumentation with `getInstrumentation()`
- ✅ Batch progress tracking
- ✅ Error handling without stopping processing

See `cli/README.md` for detailed documentation and code examples.

## 📊 What Telemetry to Expect

### Traces (Jaeger)
- **Service Maps**: See how requests flow between frontend and backend
- **Span Details**: HTTP calls, database operations, business logic
- **Error Correlation**: Failed requests with full context and stack traces
- **Performance**: Request latencies and bottlenecks

### Metrics (Prometheus)
- **Business Metrics**: Orders created, profiles updated, search queries
- **Performance Metrics**: Request duration, cache hit ratios, error rates  
- **Infrastructure Metrics**: HTTP response codes, request counts
- **Custom Histograms**: Search duration, order value distributions

### Errors & Context
- **Structured Errors**: Captured with full context and user information
- **Breadcrumb Trails**: Step-by-step request journey for debugging
- **User Context**: Profile data and session information attached to telemetry

## 🔧 Configuration

### Environment Variables (.env)

```bash
# Grafana Admin Password (customize for production)
GRAFANA_ADMIN_PASSWORD=your_secure_password

# Optional: Override default ports
FRONTEND_PORT=3000
BACKEND_PORT=3001
GRAFANA_PORT=3002
PROMETHEUS_PORT=9090
JAEGER_PORT=16686
```

### Console Exporter (optional)

Enable frontend console exporting for quick, infrastructure-free feedback. When enabled, spans are printed to the browser console instead of being sent to the collector.

```bash
# Frontend: enable console exporter (Level 1)
VITE_USE_CONSOLE_EXPORTER=1
```

Notes:
- Use this for quick demos without the Collector/Jaeger.
- Leave it unset (default) when running the full Docker stack so telemetry flows to the Collector.

### Observability Endpoints

The applications are configured to send telemetry to:
- **Backend → Collector**: `http://otel-collector:4318` (internal Docker network)
- **Frontend → Collector**: `http://localhost:4318/v1/traces` (from browser)

## 🛠️ Development

### Running Individual Services

```bash
# Frontend only (requires backend running)
cd frontend && npm install && npm run dev

# Backend only
cd backend && npm install && npm run dev

# CLI examples (requires observability stack running)
cd cli && npm install
npm run migrate  # data migration script
npm run queue    # background queue worker (Ctrl+C to stop)

# Just the observability stack
docker-compose up jaeger prometheus grafana otel-collector
```

### Adding Custom Metrics

```javascript
// In your route handlers
client.metrics.increment('custom_action', {
  user_id: userId,
  feature: 'new_feature'
})

client.metrics.histogram('operation_duration_ms', duration, {
  operation: 'data_processing'
})
```

### Custom Tracing

```javascript
// Add nested spans
await client.trace('custom_operation', async (span) => {
  span.setAttributes({
    'operation.type': 'data_processing',
    'operation.items': items.length
  })
  
  // Nested operation
  await client.trace('sub_operation', async (subSpan) => {
    // ... work
  })
})
```

## 📈 Monitoring & Alerts

### Key Metrics to Monitor

1. **Error Rates**:
   - `sum(rate(http_requests_total{status_code=~"5.."}[5m]))`
   - `sum(rate(orders_failed[5m]))`

2. **Performance**:
   - `histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))`
   - `histogram_quantile(0.99, rate(product_search_duration_ms_bucket[5m]))`

3. **Business KPIs**:
   - `sum(rate(orders_created[1h]))`  # Orders per hour
   - `sum(rate(profiles_updated[1d]))` # Profile updates per day

### Sample Prometheus Queries

```promql
# 95th percentile response time
histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))

# Error rate percentage  
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100

# Cache hit ratio
sum(rate(product_search_cache_hits[5m])) / (sum(rate(product_search_cache_hits[5m])) + sum(rate(product_search_cache_misses[5m]))) * 100
```

## 🐛 Troubleshooting

### Services Not Starting

```bash
# Check service status
docker-compose ps

# View specific service logs
docker-compose logs frontend
docker-compose logs backend
docker-compose logs otel-collector

# Restart specific service
docker-compose restart backend
```

### No Telemetry Data

1. **Check Collector Health**:
   ```bash
   curl http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d '{}'
   ```

2. **Verify Frontend Connection**:
   - Open browser dev tools → Network tab
   - Look for requests to `localhost:4318`
   - Check for CORS errors

3. **Check Backend Connection**:
   ```bash
   docker-compose logs backend | grep -i observability
   ```

### Performance Issues

1. **Reduce Telemetry Volume**:
   - Adjust batch sizes in `otel-collector-config.yml`
   - Implement sampling for high-traffic applications

2. **Check Resource Usage**:
   ```bash
   docker stats
   ```

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Port Conflicts** | Service won't start | Change ports in `docker-compose.yml` |
| **CORS Errors** | Frontend can't send telemetry | Check collector CORS config |
| **Missing Traces** | Empty Jaeger UI | Verify collector → Jaeger connection |
| **No Metrics** | Empty Prometheus | Check collector → Prometheus endpoint |

## 🔒 Security Considerations

- **Passwords**: Never commit `.env` files with real passwords
- **Secrets**: Use Docker secrets or external secret management in production
- **Network**: Consider internal networks for production deployments  
- **Access**: Restrict UI access (Grafana, Jaeger) in production environments

## 🛑 Cleanup

```bash
# Stop all services
docker-compose down

# Remove volumes (clears all data)
docker-compose down -v

# Remove images (for full cleanup)
docker-compose down -v --rmi all
```

## 📚 Learn More

- **OpenTelemetry**: https://opentelemetry.io/docs/
- **Jaeger**: https://www.jaegertracing.io/docs/
- **Prometheus**: https://prometheus.io/docs/
- **Grafana**: https://grafana.com/docs/

## 🤝 Contributing

This demo is part of the `@satoshibits/observability` package. For issues or contributions, please refer to the main package documentation.
