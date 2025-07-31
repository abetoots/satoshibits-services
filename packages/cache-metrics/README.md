# @satoshibits/cache-metrics

Zero-dependency cache performance monitoring with event-based collection and multiple output formats.

## Features

- **Zero Dependencies**: Pure TypeScript implementation with no external dependencies
- **Event-Based Architecture**: Built on a lightweight EventEmitter for flexible handling
- **Multiple Output Formats**: Console, Prometheus, JSON, and NDJSON handlers included
- **Time-Window Aggregation**: Aggregate metrics over configurable time windows
- **Flexible Handlers**: Easy to extend with custom handlers
- **Performance Tracking**: Track hit rates, latencies, errors, and cache stampede prevention

## Installation

```bash
npm install @satoshibits/cache-metrics
# or
pnpm add @satoshibits/cache-metrics
```

## Quick Start

```typescript
import { createMetricsCollector } from '@satoshibits/cache-metrics';

// Create a metrics collector
const collector = createMetricsCollector({
  maxLatencySamples: 1000,
  calculatePercentiles: true,
});

// Record cache operations
collector.recordHit('user:123', 1.5); // key, latency in ms
collector.recordMiss('user:456', 0.8);
collector.recordSet('user:789', 2.1);
collector.recordDelete('user:123', 0.5);

// Get snapshot
const snapshot = collector.getSnapshot();
console.log(`Hit rate: ${(snapshot.hitRate * 100).toFixed(2)}%`);
```

## With Handlers

```typescript
import { createCollectorWithHandlers } from '@satoshibits/cache-metrics';

// Create collector with pre-configured handlers
const { collector, handlers } = createCollectorWithHandlers({
  enableConsole: true,
  enablePrometheus: true,
  snapshotInterval: 60000, // emit snapshots every minute
});

// Use the collector
collector.recordHit('key', 1.2);
```

## Custom Event Handlers

```typescript
import { MetricsCollector, ConsoleEventHandler } from '@satoshibits/cache-metrics';

const collector = new MetricsCollector();

// Add console handler for errors only
const errorHandler = new ConsoleEventHandler('error-logger', {
  eventTypes: new Set(['error']),
  includeTimestamp: true,
});

collector.on('event', (event) => errorHandler.handle(event));
```

## Prometheus Integration

```typescript
import { MetricsCollector, PrometheusHandler } from '@satoshibits/cache-metrics';

const collector = new MetricsCollector();
const prometheusHandler = new PrometheusHandler('prometheus', (text) => {
  // Send to your metrics endpoint
  fetch('/metrics', { method: 'POST', body: text });
});

// Emit Prometheus format every 30 seconds
collector.on('snapshot', (snapshot) => prometheusHandler.handle(snapshot));
collector.startSnapshotTimer(30000);
```

## Aggregated Metrics

```typescript
import { MetricsCollector, MetricsAggregator } from '@satoshibits/cache-metrics';

const collector = new MetricsCollector();
const aggregator = new MetricsAggregator({
  maxSnapshots: 60,
  windowDuration: 3600000, // 1 hour
});

// Collect snapshots
collector.on('snapshot', (snapshot) => aggregator.addSnapshot(snapshot));
collector.startSnapshotTimer(60000); // every minute

// Get aggregated metrics
const aggregated = aggregator.getAggregatedMetrics();
const hitRateStats = aggregator.getHitRateStats();
console.log(`Average hit rate: ${(hitRateStats.average * 100).toFixed(2)}%`);
console.log(`Trend: ${hitRateStats.trend}`);
```

## API Reference

### MetricsCollector

The main class for collecting cache metrics.

**Methods:**
- `record(event)` - Record a cache event
- `recordHit(key, latency?)` - Record a cache hit
- `recordMiss(key, latency?)` - Record a cache miss
- `recordSet(key, latency?)` - Record a set operation
- `recordDelete(key, latency?)` - Record a delete operation
- `recordError(operation, error?)` - Record an error
- `recordStampedePrevented()` - Record a prevented cache stampede
- `updateCacheSize(size)` - Update cache size metric
- `getSnapshot()` - Get current metrics snapshot
- `reset()` - Reset all metrics
- `startSnapshotTimer(intervalMs)` - Start periodic snapshot emission
- `stopSnapshotTimer()` - Stop periodic snapshots

### Event Types

- `hit` - Cache hit
- `miss` - Cache miss
- `set` - Set operation
- `delete` - Delete operation
- `error` - Error occurred
- `clear` - Cache cleared

### Handlers

- **ConsoleEventHandler** - Log events to console
- **ConsoleSnapshotHandler** - Log snapshots to console
- **PrometheusHandler** - Format metrics in Prometheus exposition format
- **JsonHandler** - Format metrics as JSON
- **NdjsonHandler** - Stream metrics as newline-delimited JSON

## License

ISC