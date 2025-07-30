# @satoshibits/core-metrics

Zero-dependency metrics collection core for Node.js and browsers. Provides the foundation for domain-specific metrics packages.

## Features

- **Zero Dependencies**: No external dependencies, works everywhere
- **Type Safe**: Full TypeScript support with strict typing
- **Extensible**: Base classes for building domain-specific collectors
- **Multiple Formats**: Prometheus, JSON, and Console output handlers
- **Event-Driven**: Built on a lightweight event emitter
- **Performance**: Minimal overhead with efficient aggregation

## Installation

```bash
npm install @satoshibits/core-metrics
```

## Quick Start

```typescript
import { createMetricsCollector } from '@satoshibits/core-metrics';

// Create a collector with handlers
const { collector, handlers } = createMetricsCollector({
  enableConsole: true,
  enablePrometheus: true,
  snapshotInterval: 60000 // 1 minute
});

// Record metrics
collector.increment('requests_total');
collector.gauge('active_connections', 42);
collector.histogram('request_duration', 123.45);

// Generate a snapshot manually
const snapshot = collector.snapshot();
```

## Core Concepts

### Metric Types

- **Counter**: Monotonically increasing value (e.g., total requests)
- **Gauge**: Value that can go up or down (e.g., active connections)
- **Histogram**: Distribution of values (e.g., response times)
- **Summary**: Statistical summary with percentiles

### Event-Driven Architecture

```typescript
import { BaseCollector } from '@satoshibits/core-metrics';

class MyCollector extends BaseCollector {
  recordCustomEvent(name: string, value: number) {
    this.record({
      type: 'custom.event',
      name,
      value,
      timestamp: Date.now()
    });
  }
}

const collector = new MyCollector();
collector.on('event', (event) => {
  console.log('Metric recorded:', event);
});
```

### Handlers

#### Prometheus Handler

```typescript
import { PrometheusHandler } from '@satoshibits/core-metrics';

const handler = new PrometheusHandler('prometheus', {
  prefix: 'myapp_',
  labels: { service: 'api', region: 'us-west' }
});

collector.on('snapshot', (snapshot) => {
  handler.handleSnapshot(snapshot);
});
```

#### JSON Handler

```typescript
import { JsonHandler } from '@satoshibits/core-metrics';

const handler = new JsonHandler('json', {
  pretty: true,
  includeTimestamp: true
});
```

#### Console Handler

```typescript
import { ConsoleHandler } from '@satoshibits/core-metrics';

const handler = new ConsoleHandler('console', {
  showSummary: true,
  useColors: true
});
```

## Advanced Usage

### Custom Collectors

```typescript
import { BaseCollector, MetricEvent } from '@satoshibits/core-metrics';

interface CustomEvent extends MetricEvent {
  customField: string;
}

class CustomCollector extends BaseCollector {
  recordCustom(name: string, value: number, customField: string) {
    const event: CustomEvent = {
      type: 'custom',
      name,
      value,
      timestamp: Date.now(),
      customField
    };
    
    this.record(event);
  }
}
```

### Time Window Aggregation

```typescript
import { createSlidingWindow } from '@satoshibits/core-metrics';

const window = createSlidingWindow(300000, 10); // 5 minutes, 10 buckets

collector.on('event', (event) => {
  window.add(event);
});

// Get events from the last 5 minutes
const recentEvents = window.getEvents();
```

### Calculations

```typescript
import { 
  calculatePercentiles,
  calculateRate,
  detectOutliers 
} from '@satoshibits/core-metrics';

const values = [10, 20, 30, 40, 50, 100, 200];

const percentiles = calculatePercentiles(values);
// { p50: 40, p75: 50, p90: 100, p95: 150, p99: 190, p999: 199 }

const rate = calculateRate(1000, 900, 60000); // 100 increase over 1 minute
// 1.67 per second

const { outliers } = detectOutliers(values);
// [200]
```

## API Reference

### BaseCollector

Base class for creating metric collectors.

```typescript
class BaseCollector extends EventEmitter<CollectorEvents> {
  constructor(config?: MetricConfig);
  
  // Core methods
  record(event: MetricEvent): void;
  increment(name: string, value?: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  
  // Snapshot management
  snapshot(): MetricSnapshot;
  reset(): void;
  startSnapshotTimer(interval?: number): void;
  stopSnapshotTimer(): void;
  
  // Analysis
  getSummary(name: string, labels?: Record<string, string>): MetricSummary | undefined;
  getMetricNames(): string[];
}
```

### Types

```typescript
interface MetricEvent<T = unknown> {
  type: string;
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
  metadata?: T;
}

interface MetricSnapshot {
  startTime: number;
  endTime: number;
  duration: number;
  metrics: Map<string, MetricValue>;
  labels?: Record<string, string>;
}

interface MetricSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  stdDev?: number;
  percentiles?: Percentiles;
}
```

## License

ISC