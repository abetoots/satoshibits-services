/**
 * Smart Metrics Wrappers
 *
 * Provides OpenTelemetry metric wrappers with automatic context enrichment.
 * Exemplars are automatic in SDK 2.0 when traces and metrics coexist.
 */

import type { Attributes, Meter } from "@opentelemetry/api";
import type { LabelSet } from "./types.mjs";

import {
  getEnrichedLabels,
} from "./enrichment/context.mjs";

/**
 * Create a smart counter with automatic context enrichment
 * Exemplars are automatic in SDK 2.0 - they link metrics to active traces
 */
export function createSmartCounter(
  name: string,
  meter: Meter,
  description?: string,
) {
  const counter = meter.createCounter(name, {
    description,
  });

  return {
    /**
     * Increment the counter with automatic context enrichment
     */
    increment(value = 1, customContext?: Record<string, unknown>) {
      // no manual trace ID needed - exemplars are automatic!
      const enrichedContext = getEnrichedLabels(customContext as LabelSet);
      counter.add(value, enrichedContext);
      // SDK 2.0 automatically attaches the active span as an exemplar
    },
  };
}

/**
 * Create a smart histogram with automatic context enrichment
 */
export function createSmartHistogram(
  name: string,
  meter: Meter,
  description?: string,
  unit?: string,
) {
  const histogram = meter.createHistogram(name, {
    description,
    unit,
  });

  return {
    /**
     * Record a value with automatic context enrichment
     */
    record(value: number, customContext?: Record<string, unknown>) {
      const enrichedContext = getEnrichedLabels(customContext as LabelSet);
      histogram.record(value, enrichedContext);
    },
  };
}

/**
 * Create a smart gauge with automatic context enrichment
 */
export function createSmartGauge(
  name: string,
  meter: Meter,
  description?: string,
  unit?: string,
) {
  const observable = meter.createObservableGauge(name, {
    description,
    unit,
  });

  let currentValue = 0;
  let currentAttributes: Record<string, unknown> = {};

  observable.addCallback((result) => {
    result.observe(currentValue, currentAttributes as Attributes);
  });

  return {
    /**
     * Set the gauge value with automatic context enrichment
     */
    set(value: number, customContext?: Record<string, unknown>) {
      currentValue = value;
      currentAttributes = getEnrichedLabels(customContext as LabelSet);
    },
  };
}

/**
 * Create a smart up/down counter with automatic context enrichment
 */
export function createSmartUpDownCounter(
  name: string,
  meter: Meter,
  description?: string,
) {
  const counter = meter.createUpDownCounter(name, {
    description,
  });

  return {
    /**
     * Add to the counter (can be negative) with automatic context enrichment
     */
    add(value: number, customContext?: Record<string, unknown>) {
      const enrichedContext = getEnrichedLabels(customContext as LabelSet);
      counter.add(value, enrichedContext);
    },
  };
}

/**
 * Helper to record a duration with automatic timing
 */
export function createSmartTimer(
  name: string,
  meter: Meter,
  description = "Operation duration",
) {
  const histogram = createSmartHistogram(name, meter, description, "ms");

  return {
    /**
     * Start timing an operation
     */
    startTimer(customContext?: Record<string, unknown>) {
      const startTime = Date.now();

      return {
        /**
         * End the timer and record the duration
         */
        end(additionalContext?: Record<string, unknown>) {
          const duration = Date.now() - startTime;
          const context = { ...customContext, ...additionalContext };
          histogram.record(duration, context);
          return duration;
        },
      };
    },

    /**
     * Time a function execution
     */
    async timeFunction<T>(
      fn: () => T | Promise<T>,
      customContext?: Record<string, unknown>,
    ): Promise<T> {
      const timer = this.startTimer(customContext);
      try {
        const result = await fn();
        timer.end({ status: "success" });
        return result;
      } catch (error) {
        timer.end({ status: "error", error_type: error?.constructor?.name });
        throw error;
      }
    },
  };
}

// [L1] Removed createHttpMetrics, createDatabaseMetrics, createBusinessMetrics (~70 lines)
// These domain-specific factory functions are now documented as examples in:
// docs/examples/metrics-recipes.md
