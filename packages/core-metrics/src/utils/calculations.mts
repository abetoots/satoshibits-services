/**
 * Utility functions for metric calculations
 * 
 * Provides common statistical calculations used across metric types.
 */

import type { Percentiles } from '../types.mjs';

/**
 * Calculate percentiles from an array of values
 */
export function calculatePercentiles(values: number[]): Percentiles {
  if (values.length === 0) {
    return {
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      p999: 0
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  
  const percentile = (p: number): number => {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
  };

  return {
    p50: percentile(0.5),
    p75: percentile(0.75),
    p90: percentile(0.9),
    p95: percentile(0.95),
    p99: percentile(0.99),
    p999: percentile(0.999)
  };
}

/**
 * Calculate rate of change between two values
 */
export function calculateRate(
  currentValue: number,
  previousValue: number,
  timeDeltaMs: number
): number {
  if (timeDeltaMs <= 0) {
    return 0;
  }
  
  const valueDelta = currentValue - previousValue;
  const timeDeltaSec = timeDeltaMs / 1000;
  
  return valueDelta / timeDeltaSec;
}

/**
 * Calculate moving average
 */
export function calculateMovingAverage(
  values: number[],
  windowSize: number
): number[] {
  if (values.length === 0 || windowSize <= 0) {
    return [];
  }

  const result: number[] = [];
  
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = values.slice(start, i + 1);
    const sum = window.reduce((a, b) => a + b, 0);
    result.push(sum / window.length);
  }
  
  return result;
}

/**
 * Calculate exponential moving average
 */
export function calculateEMA(
  values: number[],
  alpha = 0.1
): number[] {
  if (values.length === 0) {
    return [];
  }

  const firstValue = values[0];
  if (firstValue === undefined) {
    return [];
  }

  const result: number[] = [firstValue];
  
  for (let i = 1; i < values.length; i++) {
    const currentValue = values[i];
    const prevValue = result[i - 1];
    if (currentValue !== undefined && prevValue !== undefined) {
      const ema = alpha * currentValue + (1 - alpha) * prevValue;
      result.push(ema);
    }
  }
  
  return result;
}

/**
 * Calculate standard deviation
 */
export function calculateStdDev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce(
    (acc, val) => acc + Math.pow(val - mean, 2), 0
  ) / values.length;
  
  return Math.sqrt(variance);
}

/**
 * Calculate histogram buckets
 */
export function calculateHistogramBuckets(
  values: number[],
  bucketCount = 10
): { min: number; max: number; count: number }[] {
  if (values.length === 0 || bucketCount <= 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  
  if (range === 0) {
    return [{ min, max, count: values.length }];
  }

  const bucketSize = range / bucketCount;
  const buckets: { min: number; max: number; count: number }[] = [];
  
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      min: min + i * bucketSize,
      max: min + (i + 1) * bucketSize,
      count: 0
    });
  }

  // count values in each bucket
  values.forEach(value => {
    const bucketIndex = Math.min(
      Math.floor((value - min) / bucketSize),
      bucketCount - 1
    );
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex]!.count++;
    }
  });

  return buckets;
}

/**
 * Detect outliers using IQR method
 */
export function detectOutliers(values: number[]): {
  outliers: number[];
  lowerBound: number;
  upperBound: number;
} {
  if (values.length < 4) {
    return { outliers: [], lowerBound: 0, upperBound: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  
  const q1 = sorted[q1Index] ?? 0;
  const q3 = sorted[q3Index] ?? 0;
  const iqr = q3 - q1;
  
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  
  const outliers = values.filter(v => v < lowerBound || v > upperBound);
  
  return { outliers, lowerBound, upperBound };
}