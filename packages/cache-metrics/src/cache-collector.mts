/**
 * CacheCollector - Cache-specific metrics collector extending core-metrics
 */

import {
  BaseCollector,
  CounterCollector,
  HistogramCollector,
  GaugeCollector,
  MetricType,
  type MetricEvent,
  type MetricConfig,
} from '@satoshibits/core-metrics';

import type {
  CacheOperation,
  CacheMetricEvent,
} from './types.mjs';

export interface CacheCollectorOptions extends Partial<Omit<MetricConfig, 'type'>> {
  maxLatencySamples?: number;
  calculatePercentiles?: boolean;
  enableTimestamps?: boolean;
}

/**
 * Cache-specific metrics collector
 */
export class CacheCollector extends BaseCollector {
  private hits: CounterCollector;
  private misses: CounterCollector;
  private sets: CounterCollector;
  private deletes: CounterCollector;
  private errors: CounterCollector;
  private stampedes: CounterCollector;
  private latencyGet: HistogramCollector;
  private latencySet: HistogramCollector;
  private latencyDel: HistogramCollector;
  private hitRate: GaugeCollector;
  private cacheSize: GaugeCollector;
  
  // per-operation error counters
  private errorsGet: CounterCollector;
  private errorsSet: CounterCollector;
  private errorsDel: CounterCollector;
  private errorsClear: CounterCollector;
  
  private cacheConfig: Required<Pick<CacheCollectorOptions, 'maxLatencySamples' | 'calculatePercentiles' | 'enableTimestamps'>>;
  
  constructor(options: CacheCollectorOptions = {}) {
    super({
      ...options,
      name: options.name ?? 'cache',
      type: MetricType.Summary,
    });
    
    // cache-specific config
    this.cacheConfig = {
      maxLatencySamples: options.maxLatencySamples ?? 1000,
      calculatePercentiles: options.calculatePercentiles ?? true,
      enableTimestamps: options.enableTimestamps ?? true,
    };
    
    // initialize internal collectors
    const prefix = this.config.name;
    this.hits = new CounterCollector(`${prefix}_hits`, {
      description: 'Total number of cache hits',
      defaultLabels: options.defaultLabels,
    });
    this.misses = new CounterCollector(`${prefix}_misses`, {
      description: 'Total number of cache misses',
      defaultLabels: options.defaultLabels,
    });
    this.sets = new CounterCollector(`${prefix}_sets`, {
      description: 'Total number of cache sets',
      defaultLabels: options.defaultLabels,
    });
    this.deletes = new CounterCollector(`${prefix}_deletes`, {
      description: 'Total number of cache deletes',
      defaultLabels: options.defaultLabels,
    });
    this.errors = new CounterCollector(`${prefix}_errors`, {
      description: 'Total number of cache errors',
      defaultLabels: options.defaultLabels,
    });
    this.stampedes = new CounterCollector(`${prefix}_stampede_prevented`, {
      description: 'Total number of prevented cache stampedes',
      defaultLabels: options.defaultLabels,
    });
    
    // per-operation error counters
    this.errorsGet = new CounterCollector(`${prefix}_errors_get`, {
      description: 'Total number of cache get errors',
      defaultLabels: options.defaultLabels,
    });
    this.errorsSet = new CounterCollector(`${prefix}_errors_set`, {
      description: 'Total number of cache set errors',
      defaultLabels: options.defaultLabels,
    });
    this.errorsDel = new CounterCollector(`${prefix}_errors_del`, {
      description: 'Total number of cache del errors',
      defaultLabels: options.defaultLabels,
    });
    this.errorsClear = new CounterCollector(`${prefix}_errors_clear`, {
      description: 'Total number of cache clear errors',
      defaultLabels: options.defaultLabels,
    });
    
    // latency histograms with buckets suitable for cache operations (in ms)
    const latencyOptions = {
      buckets: [0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500, 1000],
      defaultLabels: options.defaultLabels,
      maxObservations: this.cacheConfig.maxLatencySamples,
    };
    
    this.latencyGet = new HistogramCollector(`${prefix}_latency_get_ms`, {
      ...latencyOptions,
      description: 'Cache get operation latency in milliseconds',
    });
    this.latencySet = new HistogramCollector(`${prefix}_latency_set_ms`, {
      ...latencyOptions,
      description: 'Cache set operation latency in milliseconds',
    });
    this.latencyDel = new HistogramCollector(`${prefix}_latency_del_ms`, {
      ...latencyOptions,
      description: 'Cache del operation latency in milliseconds',
    });
    
    this.hitRate = new GaugeCollector(`${prefix}_hit_rate`, {
      description: 'Cache hit rate (0-1)',
      defaultLabels: options.defaultLabels,
    });
    this.cacheSize = new GaugeCollector(`${prefix}_size`, {
      description: 'Current cache size',
      defaultLabels: options.defaultLabels,
    });
    
    // forward events from sub-collectors
    this.setupEventForwarding();
  }
  
  /**
   * Setup event forwarding from sub-collectors
   */
  private setupEventForwarding(): void {
    const collectors = [
      this.hits, this.misses, this.sets, this.deletes,
      this.errors, this.stampedes,
      this.latencyGet, this.latencySet, this.latencyDel,
      this.hitRate, this.cacheSize,
      this.errorsGet, this.errorsSet, this.errorsDel, this.errorsClear
    ];
    
    for (const collector of collectors) {
      collector.on('metric', (event) => {
        this.emit('metric', event as MetricEvent);
      });
    }
  }
  
  /**
   * Record a cache hit
   */
  recordHit(key: string, latency?: number): void {
    if (typeof key !== 'string' || !key) {
      console.warn('[CacheCollector] recordHit called with invalid key');
      return;
    }
    
    this.hits.inc();
    
    if (latency !== undefined && latency >= 0 && isFinite(latency)) {
      this.latencyGet.observe(latency);
    }
    
    this.updateHitRate();
    this.emitCacheEvent('hit', key, latency);
  }
  
  /**
   * Record a cache miss
   */
  recordMiss(key: string, latency?: number): void {
    if (typeof key !== 'string' || !key) {
      console.warn('[CacheCollector] recordMiss called with invalid key');
      return;
    }
    
    this.misses.inc();
    
    if (latency !== undefined && latency >= 0 && isFinite(latency)) {
      this.latencyGet.observe(latency);
    }
    
    this.updateHitRate();
    this.emitCacheEvent('miss', key, latency);
  }
  
  /**
   * Record a cache set operation
   */
  recordSet(key: string, latency?: number): void {
    if (typeof key !== 'string' || !key) {
      console.warn('[CacheCollector] recordSet called with invalid key');
      return;
    }
    
    this.sets.inc();
    
    if (latency !== undefined && latency >= 0 && isFinite(latency)) {
      this.latencySet.observe(latency);
    }
    
    this.emitCacheEvent('set', key, latency);
  }
  
  /**
   * Record a cache delete operation
   */
  recordDelete(key: string, latency?: number): void {
    if (typeof key !== 'string' || !key) {
      console.warn('[CacheCollector] recordDelete called with invalid key');
      return;
    }
    
    this.deletes.inc();
    
    if (latency !== undefined && latency >= 0 && isFinite(latency)) {
      this.latencyDel.observe(latency);
    }
    
    this.emitCacheEvent('delete', key, latency);
  }
  
  /**
   * Record an error
   */
  recordError(operation: CacheOperation, error?: Error): void {
    // validate operation
    const validOperations: CacheOperation[] = ['get', 'set', 'del', 'clear'];
    if (!validOperations.includes(operation)) {
      console.warn(`[CacheCollector] recordError called with invalid operation: ${operation}`);
      return;
    }
    
    // increment total errors
    this.errors.inc(1, { operation });
    
    // increment per-operation error counter
    switch (operation) {
      case 'get':
        this.errorsGet.inc();
        break;
      case 'set':
        this.errorsSet.inc();
        break;
      case 'del':
        this.errorsDel.inc();
        break;
      case 'clear':
        this.errorsClear.inc();
        break;
    }
    
    const event: CacheMetricEvent = {
      type: 'cache.error',
      name: `${this.config.name}_error`,
      value: 1,
      timestamp: Date.now(),
      labels: { operation },
      metadata: {
        key: '',
        operation,
        error,
      }
    };
    
    this.record(event);
  }
  
  /**
   * Record a prevented cache stampede
   */
  recordStampedePrevented(): void {
    this.stampedes.inc();
  }
  
  /**
   * Update the cache size
   */
  updateCacheSize(size: number): void {
    if (typeof size !== 'number' || size < 0 || !isFinite(size)) {
      console.warn('[CacheCollector] updateCacheSize called with invalid size');
      return;
    }
    
    this.cacheSize.set(size);
  }
  
  /**
   * Measure operation latency
   */
  async measureLatency<T>(
    operation: CacheOperation,
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    let error: Error | undefined;

    try {
      const result = await fn();
      return result;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      throw error;
    } finally {
      const latency = performance.now() - start;
      
      if (error) {
        this.recordError(operation, error);
      } else {
        // record based on operation type
        switch (operation) {
          case 'get':
            // for get operations, we need the result to know hit/miss
            // this would be handled by the caller
            break;
          case 'set':
            this.recordSet(key, latency);
            break;
          case 'del':
            this.recordDelete(key, latency);
            break;
        }
      }
    }
  }
  
  
  /**
   * Reset all metrics
   */
  reset(): void {
    // reset all internal collectors using their reset methods
    this.hits.reset();
    this.misses.reset();
    this.sets.reset();
    this.deletes.reset();
    this.errors.reset();
    this.stampedes.reset();
    this.latencyGet.reset();
    this.latencySet.reset();
    this.latencyDel.reset();
    this.hitRate.set(0);
    this.cacheSize.set(0);
    
    // reset per-operation error counters
    this.errorsGet.reset();
    this.errorsSet.reset();
    this.errorsDel.reset();
    this.errorsClear.reset();
    
    // call parent reset to clear base collector state
    super.reset();
  }
  
  /**
   * Update hit rate gauge
   */
  private updateHitRate(): void {
    const hits = this.hits.getValue();
    const misses = this.misses.getValue();
    const total = hits + misses;
    const rate = total > 0 ? hits / total : 0;
    this.hitRate.set(rate);
  }
  
  /**
   * Emit cache-specific event
   */
  private emitCacheEvent(
    type: 'hit' | 'miss' | 'set' | 'delete',
    key: string,
    _latency?: number
  ): void {
    const event: CacheMetricEvent = {
      type: `cache.${type}`,
      name: `${this.config.name}_${type}`,
      value: 1,
      timestamp: Date.now(),
      metadata: {
        key,
        operation: type === 'hit' || type === 'miss' ? 'get' : type === 'delete' ? 'del' : type,
        result: type === 'hit' || type === 'miss' ? type : undefined,
      }
    };
    
    this.record(event);
  }
  
}

