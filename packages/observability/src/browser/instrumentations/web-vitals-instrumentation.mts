/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  InstrumentationBase,
  InstrumentationConfig,
} from "@opentelemetry/instrumentation";

import type { Metric } from "web-vitals";

export interface VitalsSamplerConfig {
  /**
   * Thresholds for each metric to determine rating
   * Values <= good are "good", > poor are "poor", between are "needs-improvement"
   */
  thresholds?: Record<string, { good?: number; poor?: number }>;

  /**
   * Sampling rates for each rating level (0.0 to 1.0)
   */
  samplingRates?: {
    good?: number; // e.g., 0.1 = 10%
    needsImprovement?: number; // e.g., 0.5 = 50%
    poor?: number; // e.g., 1.0 = 100%
  };

  /**
   * Per-metric overrides for sampling rates
   */
  metricOverrides?: Record<
    string,
    {
      samplingRates?: {
        good?: number;
        needsImprovement?: number;
        poor?: number;
      };
    }
  >;
}

export interface BrowserWebVitalsInstrumentationConfig
  extends InstrumentationConfig {
  /** Enable CLS sampling logic */
  enableSampling?: boolean;
  /** Custom business context provider */
  getBusinessContext?: () => Record<string, unknown>;
  /** Custom sampler configuration or instance */
  sampler?: VitalsSamplerConfig | VitalsSampler;
}

/**
 * Browser Web Vitals Instrumentation for OpenTelemetry
 *
 * Instruments Core Web Vitals metrics (CLS, LCP, FCP, TTFB, INP) and reports them
 * as OpenTelemetry metrics with proper sampling and business context enrichment.
 */
export class BrowserWebVitalsInstrumentation extends InstrumentationBase<BrowserWebVitalsInstrumentationConfig> {
  readonly component: string = "browser-web-vitals";
  readonly version: string = "1.0.0";
  moduleName = this.component;

  private _webVitalsEnabled = false;
  private _isInitializing = false;
  private _webVitalsCleanup: (() => void)[] = [];

  constructor(config: BrowserWebVitalsInstrumentationConfig = {}) {
    // prevent enable() from being called by the base constructor
    // registerInstrumentations() will call enable() later after full construction
    super("@satoshibits/browser-web-vitals-instrumentation", "1.0.0", { ...config, enabled: false });
  }

  protected init() {
    // initialization is handled in enable()
  }

  enable() {
    if (typeof window === "undefined") {
      this.logger.emit({
        severityNumber: SeverityNumber.WARN,
        body: {
          message:
            "BrowserWebVitalsInstrumentation only works in browser environment",
        },
      });
      return;
    }

    // prevent double initialization
    if (this._webVitalsEnabled || this._isInitializing) {
      return;
    }
    this._isInitializing = true;

    void this._initializeWebVitals();
  }

  disable() {
    if (typeof window === "undefined") {
      return;
    }

    // clean up web-vitals callbacks
    this._webVitalsCleanup.forEach((cleanup) => cleanup());
    this._webVitalsCleanup = [];
    this._webVitalsEnabled = false;
  }

  private async _initializeWebVitals(): Promise<void> {
    try {
      // dynamically import to avoid issues in non-browser environments
      const { onCLS, onFCP, onLCP, onTTFB, onINP } = await import("web-vitals");

      // register callbacks for all Core Web Vitals with cleanup
      const clsCleanup = this._registerMetric(onCLS, "cls");
      const lcpCleanup = this._registerMetric(onLCP, "lcp");
      const fcpCleanup = this._registerMetric(onFCP, "fcp");
      const ttfbCleanup = this._registerMetric(onTTFB, "ttfb");
      const inpCleanup = this._registerMetric(onINP, "inp");

      // store cleanup functions
      this._webVitalsCleanup = [
        clsCleanup,
        lcpCleanup,
        fcpCleanup,
        ttfbCleanup,
        inpCleanup,
      ];
      this._webVitalsEnabled = true;
    } catch (_error) {
      // graceful degradation if web-vitals is not available
      console.warn("Web Vitals not available, metrics disabled");
      this._webVitalsEnabled = false;
    } finally {
      this._isInitializing = false;
    }
  }

  private _registerMetric(
    onMetric: (callback: (metric: Metric) => void) => (() => void) | void,
    name: string,
  ): () => void {
    const callback = (metric: Metric) => this._reportMetric(name, metric);

    // register the callback and get cleanup function
    const cleanup = onMetric(callback);

    // return cleanup function (some web-vitals functions return cleanup, others don't)
    return (
      cleanup ??
      (() => {
        // if no cleanup function provided, we'll use a no-op callback to stop reporting
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onMetric(() => {});
      })
    );
  }

  /**
   * Report a Web Vitals metric to OpenTelemetry
   */
  private _reportMetric(name: string, metric: Metric): void {
    if (!this._webVitalsEnabled) return;

    // apply sampling logic if enabled
    if (this._config.enableSampling !== false) {
      // use custom sampler if provided, otherwise use default static method
      const sampler =
        this._config.sampler instanceof VitalsSampler
          ? this._config.sampler
          : this._config.sampler
            ? new VitalsSampler(this._config.sampler)
            : VitalsSampler.default();

      if (!sampler.shouldSample(metric.name, metric.value)) {
        return;
      }
    }

    // get business context
    const businessContext = this._config.getBusinessContext?.() ?? {};

    // report the metric using OpenTelemetry meter
    const histogram = this.meter.createHistogram(`web_vitals_${name}`, {
      description: `Core Web Vitals ${name.toUpperCase()} metric`,
      unit: name === "cls" ? "1" : "ms", // CLS is unitless, others are in milliseconds
    });

    histogram.record(metric.value, {
      rating: metric.rating,
      navigation_type: (metric as Metric & { navigationType?: string })
        .navigationType,
      // add any business context
      ...businessContext,
    });
  }

  /**
   * Check if Web Vitals collection is enabled
   */
  isEnabled(): boolean {
    return this._webVitalsEnabled;
  }
}

/**
 * Sampling logic for Web Vitals metrics
 * Reduces data volume while preserving important metrics
 *
 * Applications can customize thresholds and sampling rates to match their
 * specific performance requirements and user base.
 */
export class VitalsSampler {
  private config: Required<VitalsSamplerConfig>;

  /**
   * Default thresholds based on Google's Web Vitals recommendations
   * By default, only CLS has thresholds configured
   * Applications can configure thresholds for other metrics as needed
   */
  private static readonly DEFAULT_THRESHOLDS: VitalsSamplerConfig["thresholds"] =
    {
      CLS: { good: 0.1, poor: 0.25 },
      // Other metrics: uncomment to enable sampling
      // LCP: { good: 2500, poor: 4000 },
      // FID: { good: 100, poor: 300 },
      // INP: { good: 200, poor: 500 },
      // TTFB: { good: 800, poor: 1800 },
      // FCP: { good: 1800, poor: 3000 },
    };

  /**
   * Default sampling rates
   * - good: 10% (low priority)
   * - needs-improvement: 50% (medium priority)
   * - poor: 100% (high priority - always sample)
   */
  private static readonly DEFAULT_SAMPLING_RATES: Required<
    NonNullable<VitalsSamplerConfig["samplingRates"]>
  > = {
    good: 0.1,
    needsImprovement: 0.5,
    poor: 1.0,
  };

  constructor(config: VitalsSamplerConfig = {}) {
    this.config = {
      thresholds: {
        ...VitalsSampler.DEFAULT_THRESHOLDS,
        ...(config.thresholds ?? {}),
      },
      samplingRates: {
        ...VitalsSampler.DEFAULT_SAMPLING_RATES,
        ...(config.samplingRates ?? {}),
      },
      metricOverrides: config.metricOverrides ?? {},
    };
  }

  /**
   * Create a default sampler instance
   */
  static default(): VitalsSampler {
    return new VitalsSampler();
  }

  /**
   * Determine if a metric should be sampled based on configured thresholds and rates
   */
  shouldSample(metricName: string, value: number): boolean {
    const thresholds = this.config.thresholds?.[metricName];

    // no thresholds configured for this metric - always sample
    if (!thresholds) {
      return true;
    }

    // determine rating based on thresholds
    const rating = this.getRating(value, thresholds);

    // get sampling rate (check metric overrides first)
    const metricOverride = this.config.metricOverrides?.[metricName];
    const samplingRates =
      metricOverride?.samplingRates ?? this.config.samplingRates;

    const samplingRate = samplingRates?.[rating] ?? 1.0;

    // probabilistic sampling based on rate
    return Math.random() < samplingRate;
  }

  /**
   * Determine the rating (good/needs-improvement/poor) for a metric value
   */
  private getRating(
    value: number,
    thresholds: { good?: number; poor?: number },
  ): "good" | "needsImprovement" | "poor" {
    if (thresholds.good !== undefined && value <= thresholds.good) {
      return "good";
    }
    if (thresholds.poor !== undefined && value > thresholds.poor) {
      return "poor";
    }
    return "needsImprovement";
  }
}
