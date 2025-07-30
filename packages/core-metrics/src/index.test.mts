import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createCounter,
  createGauge,
  createHistogram,
  createSummary,
  MetricType,
  EventEmitter,
  BaseCollector,
  MetricRegistry,
  PrometheusHandler,
  JSONHandler,
  ConsoleHandler,
  Mutex,
  CardinalityLimitError,
  InvalidMetricValueError,
  TimeWindowAggregator,
  calculatePercentiles,
  calculateRate
} from './index.mjs';
import type { MetricEvent } from './index.mjs';

describe('core-metrics', () => {
  describe('Metric Collectors', () => {
    it('should create counter collector', () => {
      const counter = createCounter('test_counter');
      expect(counter).toBeDefined();
      expect(counter.getName()).toBe('test_counter');
    });

    it('should create gauge collector', () => {
      const gauge = createGauge('test_gauge');
      expect(gauge).toBeDefined();
      expect(gauge.getName()).toBe('test_gauge');
    });

    it('should create histogram collector', () => {
      const histogram = createHistogram('test_histogram');
      expect(histogram).toBeDefined();
      expect(histogram.getName()).toBe('test_histogram');
    });

    it('should create summary collector', () => {
      const summary = createSummary('test_summary');
      expect(summary).toBeDefined();
      expect(summary.getName()).toBe('test_summary');
    });
  });

  describe('MetricType enum', () => {
    it('should have correct values', () => {
      expect(MetricType.Counter).toBe('counter');
      expect(MetricType.Gauge).toBe('gauge');
      expect(MetricType.Histogram).toBe('histogram');
      expect(MetricType.Summary).toBe('summary');
    });
  });

  describe('EventEmitter', () => {
    let emitter: EventEmitter<{ test: string; error: Error }>;

    beforeEach(() => {
      emitter = new EventEmitter();
    });

    it('should emit and listen to events', () => {
      const listener = vi.fn();
      emitter.on('test', listener);
      
      emitter.emit('test', 'hello');
      
      expect(listener).toHaveBeenCalledWith('hello');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should support once listeners', () => {
      const listener = vi.fn();
      emitter.once('test', listener);
      
      emitter.emit('test', 'first');
      emitter.emit('test', 'second');
      
      expect(listener).toHaveBeenCalledWith('first');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should remove listeners', () => {
      const listener = vi.fn();
      emitter.on('test', listener);
      emitter.off('test', listener);
      
      emitter.emit('test', 'hello');
      
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle errors in listeners', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* no-op */ });
      
      emitter.on('test', () => {
        throw new Error('Listener error');
      });
      
      const result = emitter.emit('test', 'hello');
      
      expect(result).toBe(true);
      expect(consoleError).toHaveBeenCalled();
      
      consoleError.mockRestore();
    });
  });

  describe('BaseCollector', () => {
    class TestCollector extends BaseCollector {
      testRecord(value: number): void {
        this.record({
          type: 'test.event',
          name: this.config.name,
          value,
          timestamp: Date.now()
        });
      }
    }

    it('should enforce cardinality limits', () => {
      const collector = new TestCollector({
        name: 'test',
        maxCardinality: 2
      });

      const errorListener = vi.fn();
      collector.on('error', errorListener);

      // first two unique label combinations should work
      collector.testRecord(1);
      collector.gauge('test', 1, { env: 'prod' });
      collector.gauge('test', 2, { env: 'dev' });

      // third should trigger error
      collector.gauge('test', 3, { env: 'staging' });

      expect(errorListener).toHaveBeenCalled();
      const errorCall = errorListener.mock.calls[0] as unknown as [{ error: Error }];
      const error = errorCall[0].error;
      expect(error).toBeInstanceOf(CardinalityLimitError);
    });

    it('should validate metric values', () => {
      const collector = new TestCollector({ name: 'test' });
      const errorListener = vi.fn();
      collector.on('error', errorListener);

      collector.record({
        type: 'test',
        name: 'test',
        value: NaN,
        timestamp: Date.now()
      });

      expect(errorListener).toHaveBeenCalled();
      const errorCall = errorListener.mock.calls[0] as unknown as [{ error: Error }];
      const error = errorCall[0].error;
      expect(error).toBeInstanceOf(InvalidMetricValueError);
    });

    it('should generate snapshots', () => {
      const collector = new TestCollector({ name: 'test' });
      collector.testRecord(42);

      const snapshot = collector.snapshot();
      
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.metrics.size).toBeGreaterThan(0);
    });
  });

  describe('MetricRegistry', () => {
    let registry: MetricRegistry;

    beforeEach(() => {
      registry = new MetricRegistry();
    });

    it('should register and retrieve collectors', () => {
      const counter = createCounter('test_counter');
      registry.register(counter);

      expect(registry.get('test_counter')).toBe(counter);
      expect(registry.getAll()).toContain(counter);
    });

    it('should prevent duplicate registrations', () => {
      const counter1 = createCounter('test_counter');
      const counter2 = createCounter('test_counter');

      registry.register(counter1);
      
      expect(() => registry.register(counter2)).toThrow();
    });

    it('should unregister collectors', () => {
      const counter = createCounter('test_counter');
      registry.register(counter);

      const result = registry.unregister('test_counter');
      
      expect(result).toBe(true);
      expect(registry.get('test_counter')).toBeUndefined();
    });

    it('should create aggregate snapshots', () => {
      const counter = createCounter('counter');
      const gauge = createGauge('gauge');
      
      registry.register(counter);
      registry.register(gauge);
      
      counter.inc();
      gauge.set(42);

      const snapshot = registry.snapshot();
      
      expect(snapshot.metrics.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Handlers', () => {
    it('should create Prometheus handler', () => {
      const handler = new PrometheusHandler();
      expect(handler.name).toBe('prometheus');
      expect(handler.enabled).toBe(true);
    });

    it('should create JSON handler', () => {
      const handler = new JSONHandler();
      expect(handler.name).toBe('json');
      expect(handler.enabled).toBe(true);
    });

    it('should create Console handler', () => {
      const handler = new ConsoleHandler();
      expect(handler.name).toBe('console');
      expect(handler.enabled).toBe(true);
    });
  });

  describe('Mutex', () => {
    it('should provide mutual exclusion', async () => {
      const mutex = new Mutex();
      const results: number[] = [];

      const task = async (value: number) => {
        await mutex.withLock(async () => {
          results.push(value);
          await new Promise(resolve => setTimeout(resolve, 10));
          results.push(value * 10);
        });
      };

      await Promise.all([task(1), task(2), task(3)]);

      // check that operations didn't interleave
      expect(results).toEqual([1, 10, 2, 20, 3, 30]);
    });

    it('should report lock status', async () => {
      const mutex = new Mutex();
      
      expect(mutex.isLocked()).toBe(false);
      
      const release = await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);
      
      release();
      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('Utility Functions', () => {
    it('should calculate percentiles', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const percentiles = calculatePercentiles(values);

      expect(percentiles.p50).toBe(5);
      expect(percentiles.p90).toBe(9);
      expect(percentiles.p95).toBe(10);
      expect(percentiles.p99).toBe(10);
    });

    it('should calculate rate', () => {
      const rate = calculateRate(100, 50, 10000); // 50 increase over 10 seconds
      expect(rate).toBe(5); // 5 per second
    });
  });

  describe('TimeWindowAggregator', () => {
    it('should aggregate events over time window', () => {
      const aggregator = new TimeWindowAggregator({
        size: 100,
        buckets: 10,
        type: 'sliding'
      });

      const event1: MetricEvent = { type: 'test', name: 'metric1', value: 10, timestamp: Date.now() };
      const event2: MetricEvent = { type: 'test', name: 'metric1', value: 20, timestamp: Date.now() };
      const event3: MetricEvent = { type: 'test', name: 'metric1', value: 30, timestamp: Date.now() };

      aggregator.add(event1);
      aggregator.add(event2);
      aggregator.add(event3);

      const events = aggregator.getEvents();
      expect(events).toHaveLength(3);
      expect(events[0]?.value).toBe(10);
      expect(events[1]?.value).toBe(20);
      expect(events[2]?.value).toBe(30);
    });
  });

  describe('Error Handling', () => {
    it('should create custom error types', () => {
      const cardinalityError = new CardinalityLimitError('test_metric', 1001, 1000);
      expect(cardinalityError.message).toContain('Cardinality limit exceeded');
      expect(cardinalityError.metricName).toBe('test_metric');
      expect(cardinalityError.current).toBe(1001);
      expect(cardinalityError.limit).toBe(1000);

      const valueError = new InvalidMetricValueError('test_metric', 'not-a-number', 'number');
      expect(valueError.message).toContain('Invalid value');
      expect(valueError.metricName).toBe('test_metric');
    });
  });
});