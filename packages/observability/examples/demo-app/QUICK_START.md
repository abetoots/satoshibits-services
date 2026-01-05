# 🚀 5-Minute Quick Start

Get the complete observability demo running in under 5 minutes.

## Prerequisites
- Docker & Docker Compose installed
- Ports 3000, 3001, 3002, 4318, 9090, 16686 available

## Steps

1. **Navigate to the demo directory**:
   ```bash
   cd packages/observability/examples/demo-app
   ```

2. **Start the stack** (includes building the observability package):
   ```bash
   docker compose up --build
   ```

   First build will take ~3-5 minutes (builds `@satoshibits/observability` package + demo apps)
   Subsequent builds are faster (~1-2 minutes)

3. **Wait for "Server running" messages** in the logs

4. **Open the demo app**: http://localhost:3000

   You'll see 4 interactive scenarios ready to test

5. **Generate telemetry** by clicking through the demo scenarios:
   - **Order Submission** → Creates distributed traces across frontend/backend
   - **Profile Update** → Shows context enrichment and breadcrumbs
   - **Payment Processing** → Demonstrates error handling and retry patterns
   - **Product Search** → Shows performance metrics and caching

6. **View your telemetry in real-time**:
   - **Traces**: http://localhost:16686 (Jaeger) - See end-to-end request flows
   - **Metrics**: http://localhost:9090 (Prometheus) - Query business & technical metrics
   - **Dashboards**: http://localhost:3002 (Grafana - admin/demo_secure_password)

## Expected Results

- **Jaeger**: See traces for `process_order`, `update_profile`, `process_payment`, `product_search`
- **Prometheus**: Query metrics like `orders_created`, `http_request_duration_ms`
- **Grafana**: Login and create dashboards from Prometheus data source

## Troubleshooting

- **Services not starting**: Run `docker-compose ps` to check status
- **No telemetry**: Check `docker-compose logs otel-collector`
- **Port conflicts**: Modify ports in `docker-compose.yml`

That's it! You now have a complete observability pipeline running locally.

📖 See [README.md](./README.md) for detailed documentation.