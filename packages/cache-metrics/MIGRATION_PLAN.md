# Cache Metrics Migration Plan

## Overview
Transform cache-metrics from a standalone package to a specialized implementation on top of core-metrics.

## Phase 1: Add Dependencies & Update Structure

### 1.1 Update package.json
```json
{
  "dependencies": {
    "@satoshibits/core-metrics": "workspace:*"
  }
}
```

### 1.2 File Changes
- DELETE: `src/event-emitter.ts` (use core-metrics)
- DELETE: `src/handlers/base.ts` (use core-metrics)
- DELETE: `src/aggregator.ts` (use core-metrics time-window)
- RENAME: All `.ts` files to `.mts`
- CREATE: `src/cache-collector.mts` (new main collector)

## Phase 2: Transform Types

### 2.1 Update types.mts
```typescript
import { MetricEvent, MetricType } from '@satoshibits/core-metrics';

// Extend core MetricEvent for cache-specific events
export interface CacheMetricEvent extends MetricEvent {
  operation?: 'hit' | 'miss' | 'set' | 'delete' | 'clear';
  metadata?: {
    key: string;
    ttl?: number;
    size?: number;
    error?: Error;
  };
}

// Keep cache-specific types
export type CacheOperation = 'get' | 'set' | 'del' | 'clear';
```

## Phase 3: Implement CacheCollector

### 3.1 Create cache-collector.mts
```typescript
import { 
  BaseCollector, 
  CounterCollector, 
  HistogramCollector,
  GaugeCollector,
  MetricType 
} from '@satoshibits/core-metrics';

export class CacheCollector extends BaseCollector {
  private hits: CounterCollector;
  private misses: CounterCollector;
  private sets: CounterCollector;
  private deletes: CounterCollector;
  private errors: CounterCollector;
  private stampedes: CounterCollector;
  private latency: HistogramCollector;
  private hitRate: GaugeCollector;
  private cacheSize: GaugeCollector;
  
  constructor(name = 'cache', options = {}) {
    super({ name, type: MetricType.Summary, ...options });
    
    // Initialize internal collectors
    this.hits = new CounterCollector(`${name}_hits`);
    this.misses = new CounterCollector(`${name}_misses`);
    this.sets = new CounterCollector(`${name}_sets`);
    this.deletes = new CounterCollector(`${name}_deletes`);
    this.errors = new CounterCollector(`${name}_errors`);
    this.stampedes = new CounterCollector(`${name}_stampede_prevented`);
    this.latency = new HistogramCollector(`${name}_latency_ms`, {
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000]
    });
    this.hitRate = new GaugeCollector(`${name}_hit_rate`);
    this.cacheSize = new GaugeCollector(`${name}_size`);
    
    // Forward events from sub-collectors
    this.setupEventForwarding();
  }
  
  // Cache-specific public API
  recordHit(key: string, latency?: number): void {
    this.hits.inc();
    if (latency !== undefined) {
      this.latency.observe(latency, { operation: 'get', result: 'hit' });
    }
    this.updateHitRate();
    this.emitCacheEvent('hit', key, latency);
  }
  
  recordMiss(key: string, latency?: number): void {
    this.misses.inc();
    if (latency !== undefined) {
      this.latency.observe(latency, { operation: 'get', result: 'miss' });
    }
    this.updateHitRate();
    this.emitCacheEvent('miss', key, latency);
  }
  
  // ... other record methods ...
  
  private updateHitRate(): void {
    const hitsValue = this.hits.getValue();
    const missesValue = this.misses.getValue();
    const total = hitsValue + missesValue;
    const rate = total > 0 ? hitsValue / total : 0;
    this.hitRate.set(rate);
  }
}
```

## Phase 4: Transform Handlers

### 4.1 Update each handler to extend BaseHandler
```typescript
import { BaseHandler, MetricSnapshot } from '@satoshibits/core-metrics';

export class PrometheusHandler extends BaseHandler {
  constructor() {
    super('prometheus');
  }
  
  handleSnapshot(snapshot: MetricSnapshot): void {
    // Convert to Prometheus format
    // Keep existing formatting logic
  }
}
```

## Phase 5: Migration Strategy

### 5.1 Backward Compatibility
- Export CacheCollector as MetricsCollector for compatibility
- Keep all public method signatures unchanged
- Preserve event names and data structures

### 5.2 Testing Strategy
1. Unit tests for new CacheCollector
2. Integration tests with core-metrics
3. Compatibility tests for existing API
4. Performance benchmarks

## Files to Remove
1. `src/event-emitter.ts` - Using core-metrics EventEmitter
2. `src/handlers/base.ts` - Using core-metrics BaseHandler
3. `src/aggregator.ts` - Using core-metrics TimeWindowAggregator

## Files to Modify
1. `src/collector.ts` → `src/cache-collector.mts`
2. `src/types.ts` → `src/types.mts`
3. `src/handlers/prometheus.ts` → `src/handlers/prometheus.mts`
4. `src/handlers/json.ts` → `src/handlers/json.mts`
5. `src/handlers/console.ts` → `src/handlers/console.mts`
6. `src/index.mts` - Update exports

## Implementation Order
1. Add core-metrics dependency
2. Create new types extending core-metrics
3. Implement CacheCollector
4. Transform handlers one by one
5. Update index exports
6. Remove deprecated files
7. Update tests
8. Verify backward compatibility