/**
 * Browser Performance Features Tests
 * 
 * Tests browser-specific performance monitoring:
 * - Resource timing (scripts, images, fonts)
 * - Navigation timing
 * - Long task detection  
 * - Memory usage tracking
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SmartClient } from '../../../index.mjs';
import type { UnifiedObservabilityClient } from '../../../unified-smart-client.mjs';
import type { ServiceInstrumentType } from '../../test-utils/test-types.mjs';

describe('Browser Performance Features', () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ServiceInstrumentType;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock Performance API methods on the existing global
    if (globalThis.performance) {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
      vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
      vi.spyOn(performance, 'mark');
      vi.spyOn(performance, 'measure');
      vi.spyOn(performance, 'now').mockReturnValue(Date.now());

      // Mock navigation and timing if they exist
      if (!performance.navigation) {
        Object.defineProperty(performance, 'navigation', {
          value: {
            type: 0,
            redirectCount: 0
          },
          writable: true,
          configurable: true
        });
      }

      if (!performance.timing) {
        const now = Date.now();
        Object.defineProperty(performance, 'timing', {
          value: {
            navigationStart: now - 5000,
            domainLookupStart: now - 4900,
            domainLookupEnd: now - 4800,
            connectStart: now - 4700,
            connectEnd: now - 4600,
            requestStart: now - 4500,
            responseStart: now - 4000,
            responseEnd: now - 3500,
            domLoading: now - 3400,
            domInteractive: now - 2000,
            domContentLoadedEventStart: now - 1500,
            domContentLoadedEventEnd: now - 1400,
            domComplete: now - 500,
            loadEventStart: now - 400,
            loadEventEnd: now - 300
          },
          writable: true,
          configurable: true
        });
      }
    }

    // Mock PerformanceObserver if needed
    if (!globalThis.PerformanceObserver) {
      (globalThis as typeof globalThis & { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver = vi.fn().mockImplementation((callback) => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => [])
      })) as unknown as typeof PerformanceObserver;
    }

    client = await SmartClient.initialize({
      serviceName: 'browser-performance-test',
      environment: 'browser',
      endpoint: undefined // no-network mode
    });

    // cast to test type - actual ScopedInstrument has more methods
    serviceInstrument = client.getServiceInstrumentation() as unknown as ServiceInstrumentType;
  });

  afterEach(async () => {
    if (client) {
      await SmartClient.shutdown();
      client = null as unknown as UnifiedObservabilityClient;
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('Resource Timing', () => {
    it('should track script loading performance', () => {
      const scriptEntries = [
        {
          name: 'https://cdn.example.com/app.js',
          entryType: 'resource',
          initiatorType: 'script',
          startTime: 100,
          duration: 250,
          transferSize: 50000,
          encodedBodySize: 45000,
          decodedBodySize: 120000
        },
        {
          name: 'https://cdn.example.com/vendor.js', 
          entryType: 'resource',
          initiatorType: 'script',
          startTime: 200,
          duration: 180,
          transferSize: 80000,
          encodedBodySize: 75000,
          decodedBodySize: 200000
        }
      ];

      if (performance.getEntriesByType) {
        vi.mocked(performance.getEntriesByType).mockReturnValue(scriptEntries as unknown as PerformanceEntryList);
      }

      expect(() => {
        const entries = performance.getEntriesByType('resource');
        entries
          .filter(entry => entry.initiatorType === 'script')
          .forEach(entry => {
            serviceInstrument.metrics.record('resource.script.duration', entry.duration, {
              url: entry.name,
              size: entry.transferSize
            });
          });
      }).not.toThrow();
    });

    it('should track image loading performance', () => {
      const imageEntries = [
        {
          name: 'https://cdn.example.com/hero.jpg',
          entryType: 'resource', 
          initiatorType: 'img',
          startTime: 150,
          duration: 800,
          transferSize: 250000,
          encodedBodySize: 240000,
          decodedBodySize: 240000
        }
      ];

      vi.mocked(performance.getEntriesByType).mockReturnValue(imageEntries as unknown as PerformanceEntryList);

      expect(() => {
        const entries = performance.getEntriesByType('resource');
        entries
          .filter(entry => entry.initiatorType === 'img')
          .forEach(entry => {
            serviceInstrument.metrics.record('resource.image.duration', entry.duration, {
              url: entry.name,
              size: entry.transferSize
            });
          });
      }).not.toThrow();
    });

    it('should track font loading performance', () => {
      const fontEntries = [
        {
          name: 'https://fonts.googleapis.com/css2?family=Roboto',
          entryType: 'resource',
          initiatorType: 'css', 
          startTime: 50,
          duration: 120,
          transferSize: 15000,
          encodedBodySize: 14000,
          decodedBodySize: 14000
        }
      ];

      vi.mocked(performance.getEntriesByType).mockReturnValue(fontEntries as unknown as PerformanceEntryList);

      expect(() => {
        const entries = performance.getEntriesByType('resource');
        entries
          .filter(entry => entry.name.includes('font') || entry.initiatorType === 'css')
          .forEach(entry => {
            serviceInstrument.metrics.record('resource.font.duration', entry.duration, {
              url: entry.name
            });
          });
      }).not.toThrow();
    });
  });

  describe('Navigation Timing', () => {
    it('should track page navigation metrics', () => {
      const timing = performance.timing;

      expect(() => {
        // DNS lookup time
        const dnsTime = timing.domainLookupEnd - timing.domainLookupStart;
        serviceInstrument.metrics.record('navigation.dns_lookup', dnsTime);

        // TCP connection time  
        const connectTime = timing.connectEnd - timing.connectStart;
        serviceInstrument.metrics.record('navigation.tcp_connect', connectTime);

        // Request/response time
        const responseTime = timing.responseEnd - timing.requestStart;
        serviceInstrument.metrics.record('navigation.response_time', responseTime);

        // DOM processing time
        const domTime = timing.domComplete - timing.domLoading;
        serviceInstrument.metrics.record('navigation.dom_processing', domTime);

        // Page load time
        const loadTime = timing.loadEventEnd - timing.navigationStart;
        serviceInstrument.metrics.record('navigation.page_load', loadTime);
      }).not.toThrow();
    });

    it('should track time to interactive', () => {
      const timing = performance.timing;

      expect(() => {
        const timeToInteractive = timing.domInteractive - timing.navigationStart;
        serviceInstrument.metrics.record('navigation.time_to_interactive', timeToInteractive);

        const domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart;
        serviceInstrument.metrics.record('navigation.dom_content_loaded', domContentLoaded);
      }).not.toThrow();
    });

    it('should track navigation type', () => {
      expect(() => {
        const navType = performance.navigation.type;
        const typeNames = ['navigate', 'reload', 'back_forward', 'prerender'];
        
        serviceInstrument.metrics.increment('navigation.type', 1, {
          type: typeNames[navType] || 'unknown'
        });

        client.context.business.addTag('navigation.type', typeNames[navType] || 'unknown');
      }).not.toThrow();
    });
  });

  describe('Long Task Detection', () => {
    it('should monitor long tasks using PerformanceObserver', () => {
      const longTaskEntries = [
        {
          name: 'unknown',
          entryType: 'longtask',
          startTime: 1000,
          duration: 150, // 150ms > 50ms threshold
          attribution: [{
            name: 'script',
            entryType: 'taskattribution',
            startTime: 1000,
            duration: 150,
            containerType: 'window',
            containerSrc: 'https://example.com',
            containerId: '',
            containerName: ''
          }]
        }
      ];

      expect(() => {
        // Simulate PerformanceObserver callback
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach(entry => {
            if (entry.entryType === 'longtask') {
              serviceInstrument.metrics.record('browser.long_task.duration', entry.duration);
              client.context.business.addBreadcrumb(`Long task detected: ${entry.duration}ms`);
            }
          });
        });

        observer.observe({ entryTypes: ['longtask'] });

        // Simulate long task detection
        longTaskEntries.forEach(entry => {
          serviceInstrument.metrics.record('browser.long_task.duration', entry.duration);
        });
      }).not.toThrow();
    });

    it('should track task blocking time', () => {
      expect(() => {
        const longTasks = [
          { duration: 120, startTime: 1000 },
          { duration: 80, startTime: 2000 },
          { duration: 200, startTime: 3000 }
        ];

        const threshold = 50; // 50ms threshold
        let totalBlockingTime = 0;

        longTasks.forEach(task => {
          if (task.duration > threshold) {
            totalBlockingTime += (task.duration - threshold);
          }
        });

        serviceInstrument.metrics.gauge('browser.total_blocking_time', totalBlockingTime);
        serviceInstrument.metrics.gauge('browser.long_task.count', longTasks.length);
      }).not.toThrow();
    });
  });

  describe('Memory Usage Tracking', () => {
    it('should track JavaScript heap usage', () => {
      // Mock memory API
      Object.defineProperty(performance, 'memory', {
        value: {
          usedJSHeapSize: 50 * 1024 * 1024, // 50MB
          totalJSHeapSize: 100 * 1024 * 1024, // 100MB  
          jsHeapSizeLimit: 2 * 1024 * 1024 * 1024 // 2GB
        },
        writable: true
      });

      expect(() => {
        if ('memory' in performance) {
          const memory = (performance as Performance & { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
          
          serviceInstrument.metrics.gauge('browser.memory.used_heap', memory.usedJSHeapSize);
          serviceInstrument.metrics.gauge('browser.memory.total_heap', memory.totalJSHeapSize);
          serviceInstrument.metrics.gauge('browser.memory.heap_limit', memory.jsHeapSizeLimit);
          
          // Calculate memory usage percentage
          const usagePercent = (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100;
          serviceInstrument.metrics.gauge('browser.memory.usage_percent', usagePercent);
        }
      }).not.toThrow();
    });

    it('should monitor memory pressure', () => {
      expect(() => {
        // Simulate memory pressure detection
        const mockMemoryUsage = 85; // 85% usage

        if (mockMemoryUsage > 80) {
          client.context.business.addBreadcrumb('High memory usage detected', {
            usage_percent: mockMemoryUsage,
            category: 'performance'
          });
          
          serviceInstrument.metrics.increment('browser.memory.pressure_warning');
        }
      }).not.toThrow();
    });
  });

  describe('Performance Integration', () => {
    it('should capture performance context with errors', () => {
      expect(() => {
        // Simulate poor performance context
        client.context.business.addTag('performance.long_tasks', '3');
        client.context.business.addTag('performance.memory_usage', '78%');
        client.context.business.addTag('performance.page_load', '3200ms');
        
        const error = new Error('Application slow/unresponsive');
        client.errors.record(error);
      }).not.toThrow();
    });

    it('should track performance budgets', () => {
      const performanceBudgets = {
        pageLoad: 2000, // 2 seconds
        timeToInteractive: 3000, // 3 seconds
        totalBlockingTime: 300, // 300ms
        memoryUsage: 70 // 70%
      };

      expect(() => {
        // Mock actual measurements
        const actualPageLoad = 2500;
        const actualTTI = 3500;
        const actualTBT = 450;
        const actualMemory = 75;

        // Track budget violations
        if (actualPageLoad > performanceBudgets.pageLoad) {
          serviceInstrument.metrics.increment('performance.budget.violation', 1, {
            metric: 'page_load',
            actual: actualPageLoad,
            budget: performanceBudgets.pageLoad
          });
        }

        if (actualMemory > performanceBudgets.memoryUsage) {
          serviceInstrument.metrics.increment('performance.budget.violation', 1, {
            metric: 'memory_usage', 
            actual: actualMemory,
            budget: performanceBudgets.memoryUsage
          });
        }
      }).not.toThrow();
    });

    it('should correlate performance with user experience', () => {
      expect(() => {
        // Simulate performance impact on UX
        const pageLoadTime = 4000; // 4 seconds (slow)
        const bounceRate = 0.65; // 65% bounce rate

        serviceInstrument.metrics.record('ux.page_load_time', pageLoadTime);
        serviceInstrument.metrics.gauge('ux.bounce_rate', bounceRate);
        
        // Tag slow experiences
        if (pageLoadTime > 3000) {
          client.context.business.addTag('ux.performance', 'slow');
          serviceInstrument.metrics.increment('ux.slow_experience');
        }
      }).not.toThrow();
    });
  });
});