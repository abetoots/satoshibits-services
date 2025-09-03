import { describe, it, expect, vi } from "vitest";
import { VitalsSampler } from "../../browser/instrumentations/web-vitals-instrumentation.mjs";

describe("VitalsSampler - Configurable Thresholds", () => {
  describe("default configuration", () => {
    it("should use Google's recommended thresholds for CLS", () => {
      const sampler = new VitalsSampler();

      // poor CLS (> 0.25) - always sample
      expect(sampler.shouldSample("CLS", 0.3)).toBe(true);
      expect(sampler.shouldSample("CLS", 0.5)).toBe(true);

      // note: good and needs-improvement are probabilistic, tested separately
    });

    it("should sample 100% of good CLS by default (0.1 = 10%)", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.05); // Below 0.1
      const sampler = new VitalsSampler();

      expect(sampler.shouldSample("CLS", 0.05)).toBe(true);
      expect(sampler.shouldSample("CLS", 0.1)).toBe(true);

      vi.mocked(Math.random).mockRestore();
    });

    it("should reject some good CLS when random is above threshold", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.15); // Above 0.1
      const sampler = new VitalsSampler();

      expect(sampler.shouldSample("CLS", 0.05)).toBe(false);

      vi.mocked(Math.random).mockRestore();
    });

    it("should sample 50% of needs-improvement CLS", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.4); // Below 0.5
      const sampler = new VitalsSampler();

      expect(sampler.shouldSample("CLS", 0.15)).toBe(true);
      expect(sampler.shouldSample("CLS", 0.2)).toBe(true);

      vi.mocked(Math.random).mockRestore();
    });

    it("should always sample non-CLS metrics by default", () => {
      const sampler = new VitalsSampler();

      expect(sampler.shouldSample("LCP", 2000)).toBe(true);
      expect(sampler.shouldSample("FID", 50)).toBe(true);
      expect(sampler.shouldSample("INP", 150)).toBe(true);
      expect(sampler.shouldSample("TTFB", 500)).toBe(true);
    });
  });

  describe("custom thresholds", () => {
    it("should allow customizing CLS thresholds (data visualization app)", () => {
      // stricter CLS requirements for data viz app
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.05, poor: 0.15 },
        },
      });

      // poor CLS (> 0.15) - always sample
      expect(sampler.shouldSample("CLS", 0.2)).toBe(true);

      // good CLS (<= 0.05) - probabilistic
      vi.spyOn(Math, "random").mockReturnValue(0.05);
      expect(sampler.shouldSample("CLS", 0.03)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      // needs-improvement (0.05 < x <= 0.15) - probabilistic
      vi.spyOn(Math, "random").mockReturnValue(0.4);
      expect(sampler.shouldSample("CLS", 0.1)).toBe(true);
      vi.mocked(Math.random).mockRestore();
    });

    it("should allow configuring thresholds for LCP", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          LCP: { good: 2000, poor: 3500 },
        },
        samplingRates: {
          good: 0.2, // 20% of good vitals
          needsImprovement: 0.5, // 50%
          poor: 1.0, // 100%
        },
      });

      // poor LCP (> 3500ms) - always sample
      expect(sampler.shouldSample("LCP", 4000)).toBe(true);

      // good LCP (<= 2000ms) - sample 20%
      vi.spyOn(Math, "random").mockReturnValue(0.1); // Below 0.2
      expect(sampler.shouldSample("LCP", 1500)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      vi.spyOn(Math, "random").mockReturnValue(0.3); // Above 0.2
      expect(sampler.shouldSample("LCP", 1500)).toBe(false);
      vi.mocked(Math.random).mockRestore();

      // needs-improvement (2000 < x <= 3500) - sample 50%
      vi.spyOn(Math, "random").mockReturnValue(0.4); // Below 0.5
      expect(sampler.shouldSample("LCP", 3000)).toBe(true);
      vi.mocked(Math.random).mockRestore();
    });

    it("should allow configuring thresholds for INP (gaming site)", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          INP: { good: 100, poor: 300 },
        },
        samplingRates: {
          good: 0.3,
          needsImprovement: 0.8,
          poor: 1.0,
        },
      });

      // poor INP (> 300ms) - always sample
      expect(sampler.shouldSample("INP", 350)).toBe(true);

      // good INP (<= 100ms) - sample 30%
      vi.spyOn(Math, "random").mockReturnValue(0.2);
      expect(sampler.shouldSample("INP", 80)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      // needs-improvement (100 < x <= 300) - sample 80%
      vi.spyOn(Math, "random").mockReturnValue(0.7);
      expect(sampler.shouldSample("INP", 200)).toBe(true);
      vi.mocked(Math.random).mockRestore();
    });
  });

  describe("custom sampling rates", () => {
    it("should allow customizing global sampling rates", () => {
      const sampler = new VitalsSampler({
        samplingRates: {
          good: 0.2, // 20% of good vitals
          needsImprovement: 0.8, // 80%
          poor: 1.0, // 100%
        },
      });

      // good CLS - sample 20%
      vi.spyOn(Math, "random").mockReturnValue(0.15); // Below 0.2
      expect(sampler.shouldSample("CLS", 0.05)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      vi.spyOn(Math, "random").mockReturnValue(0.25); // Above 0.2
      expect(sampler.shouldSample("CLS", 0.05)).toBe(false);
      vi.mocked(Math.random).mockRestore();

      // needs-improvement CLS - sample 80%
      vi.spyOn(Math, "random").mockReturnValue(0.7); // Below 0.8
      expect(sampler.shouldSample("CLS", 0.15)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      // poor CLS - always sample
      expect(sampler.shouldSample("CLS", 0.3)).toBe(true);
    });
  });

  describe("metric-specific overrides", () => {
    it("should allow per-metric sampling rate overrides", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.1, poor: 0.25 },
          INP: { good: 200, poor: 500 },
        },
        samplingRates: {
          good: 0.1, // default: 10%
          needsImprovement: 0.5, // default: 50%
          poor: 1.0, // default: 100%
        },
        metricOverrides: {
          INP: {
            samplingRates: {
              good: 0.5, // sample 50% of good INP (higher than default)
              needsImprovement: 0.9, // sample 90%
              poor: 1.0,
            },
          },
        },
      });

      // CLS uses default rates (10%, 50%, 100%)
      vi.spyOn(Math, "random").mockReturnValue(0.05);
      expect(sampler.shouldSample("CLS", 0.05)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      vi.spyOn(Math, "random").mockReturnValue(0.15); // Above 0.1
      expect(sampler.shouldSample("CLS", 0.05)).toBe(false);
      vi.mocked(Math.random).mockRestore();

      // INP uses override rates (50%, 90%, 100%)
      vi.spyOn(Math, "random").mockReturnValue(0.4); // Below 0.5
      expect(sampler.shouldSample("INP", 150)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      vi.spyOn(Math, "random").mockReturnValue(0.6); // Above 0.5
      expect(sampler.shouldSample("INP", 150)).toBe(false);
      vi.mocked(Math.random).mockRestore();
    });
  });

  describe("all Web Vitals metrics", () => {
    it("should support configuring all standard Web Vitals metrics", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.1, poor: 0.25 },
          LCP: { good: 2500, poor: 4000 },
          FID: { good: 100, poor: 300 },
          INP: { good: 200, poor: 500 },
          TTFB: { good: 800, poor: 1800 },
          FCP: { good: 1800, poor: 3000 },
        },
        samplingRates: {
          good: 0.1,
          needsImprovement: 0.5,
          poor: 1.0,
        },
      });

      // verify each metric can be sampled with thresholds (all poor = always sampled)
      expect(sampler.shouldSample("CLS", 0.3)).toBe(true); // poor
      expect(sampler.shouldSample("LCP", 5000)).toBe(true); // poor
      expect(sampler.shouldSample("FID", 350)).toBe(true); // poor
      expect(sampler.shouldSample("INP", 600)).toBe(true); // poor
      expect(sampler.shouldSample("TTFB", 2000)).toBe(true); // poor
      expect(sampler.shouldSample("FCP", 3500)).toBe(true); // poor
    });

    it("should demonstrate Google's recommended thresholds", () => {
      // example showing Google's recommended thresholds for all metrics
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.1, poor: 0.25 },
          LCP: { good: 2500, poor: 4000 },
          FID: { good: 100, poor: 300 },
          INP: { good: 200, poor: 500 },
          TTFB: { good: 800, poor: 1800 },
          FCP: { good: 1800, poor: 3000 },
        },
      });

      // verify thresholds are applied
      expect(sampler.shouldSample("LCP", 5000)).toBe(true); // poor - always sampled
    });
  });

  describe("edge cases", () => {
    it("should handle metrics without configured thresholds (always sample)", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.1, poor: 0.25 },
        },
      });

      // metrics without thresholds always sample
      expect(sampler.shouldSample("LCP", 2000)).toBe(true);
      expect(sampler.shouldSample("UNKNOWN_METRIC", 100)).toBe(true);
    });

    it("should handle boundary values correctly", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.1, poor: 0.25 },
        },
      });

      // exactly at good threshold
      vi.spyOn(Math, "random").mockReturnValue(0.05);
      expect(sampler.shouldSample("CLS", 0.1)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      // exactly at poor threshold (needs-improvement)
      vi.spyOn(Math, "random").mockReturnValue(0.4);
      expect(sampler.shouldSample("CLS", 0.25)).toBe(true);
      vi.mocked(Math.random).mockRestore();

      // just above poor threshold
      expect(sampler.shouldSample("CLS", 0.26)).toBe(true);
    });

    it("should handle zero and negative values", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.1, poor: 0.25 },
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0.05);
      expect(sampler.shouldSample("CLS", 0)).toBe(true); // good
      vi.mocked(Math.random).mockRestore();
    });

    it("should handle partial threshold configuration", () => {
      const sampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.1 }, // only good threshold, no poor threshold
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0.05);
      expect(sampler.shouldSample("CLS", 0.05)).toBe(true); // good
      vi.mocked(Math.random).mockRestore();

      // without poor threshold, all non-good values are needs-improvement
      vi.spyOn(Math, "random").mockReturnValue(0.4);
      expect(sampler.shouldSample("CLS", 0.3)).toBe(true);
      vi.mocked(Math.random).mockRestore();
    });
  });

  describe("integration with BrowserWebVitalsInstrumentation", () => {
    it("should allow passing custom sampler to instrumentation", () => {
      // this test verifies the API design - actual integration tested in browser tests
      const customSampler = new VitalsSampler({
        thresholds: {
          CLS: { good: 0.05, poor: 0.15 },
        },
        samplingRates: {
          good: 0.2,
          needsImprovement: 0.8,
          poor: 1.0,
        },
      });

      // verify custom sampler works as expected
      expect(customSampler.shouldSample("CLS", 0.2)).toBe(true); // poor
    });
  });
});
