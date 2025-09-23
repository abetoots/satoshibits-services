/**
 * @module performance
 * @description Functional utilities for optimizing performance through timing control,
 * batching, and caching. These utilities help manage expensive operations
 * and prevent performance issues in applications. All utilities are designed
 * to be composable and work well with functional programming patterns.
 * 
 * ### For Dummies
 * - These helpers slow noisy functions down, speed slow ones up, and batch the rest.
 * - Wrap your callbacks so typing, scrolling, or API calls stop overwhelming the app.
 * - Everything here returns a new function—swap it in place of the original.
 *
 * ### Decision Tree
 * - Need to wait until the user pauses? Use `debounce(fn, delay)`.
 * - Want to run at most once per interval? Reach for `throttle(fn, delay)`.
 * - Flooded with async work? Chunk it with `batchAsync(items, worker, size, gap)`.
 * - Tracking how long things take or need advanced timers? Look in `timingUtils` for extras like `measureTime`.
 *
 * @example
 * ```typescript
 * import { debounce, throttle, batchAsync, timingUtils } from './performance.mts';
 * 
 * // debounce user input
 * const search = debounce((query: string) => {
 *   performSearch(query);
 * }, 300);
 * 
 * // throttle scroll events
 * const handleScroll = throttle(() => {
 *   updateScrollPosition();
 * }, 100);
 * 
 * // batch API calls
 * const userIds = Array.from({ length: 100 }, (_, i) => i + 1);
 * const users = await batchAsync(userIds, async (id) => {
 *   const res = await api.getUser(id);
 *   return res.data;
 * }, 100, 1000);
 * 
 * // measure runtime for observability
 * const fetchJson = async (url: string) => {
 *   const response = await fetch(url);
 *   return response.json();
 * };
 * 
 * const fetchWithTiming = timingUtils.measureTime(fetchJson, (ms) => {
 *   logger.info('fetchJson duration', { ms });
 * });
 * ```
 * 
 * @category Performance
 * @since 2025-07-03
 */

/**
 * Debounce function execution.
 * @description Delays invoking the function until after the specified delay has elapsed
 * since the last time it was invoked. Useful for expensive operations triggered
 * by user input like search or resize events. Each new call resets the timer.
 * 
 * @template T - The types of the function arguments
 * @param {function(...T): void} fn - The function to debounce
 * @param {number} delay - The delay in milliseconds
 * @returns {function(...T): void} The debounced function
 * 
 * @category Timing
 * @example
 * // Basic debounce
 * const saveChanges = debounce((text: string) => {
 *   console.log('Saving:', text);
 * }, 1000);
 * 
 * saveChanges('H');
 * saveChanges('He');
 * saveChanges('Hello'); // Only this will execute after 1 second
 * 
 * @example
 * // Search input debouncing
 * const searchInput = document.getElementById('search');
 * const performSearch = debounce((query: string) => {
 *   fetch(`/api/search?q=${query}`)
 *     .then(res => res.json())
 *     .then(results => displayResults(results));
 * }, 300);
 * 
 * searchInput.addEventListener('input', (e) => {
 *   performSearch(e.target.value);
 * });
 * 
 * @example
 * // Window resize handler
 * const handleResize = debounce(() => {
 *   const width = window.innerWidth;
 *   const height = window.innerHeight;
 *   console.log(`Resized to ${width}x${height}`);
 *   recalculateLayout();
 * }, 250);
 * 
 * window.addEventListener('resize', handleResize);
 * 
 * @see throttle - Limit execution rate without delaying
 * @since 2025-07-03
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const debounce = <T extends any[]>(
  fn: (...args: T) => void,
  delay: number
): ((...args: T) => void) => {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: T): void => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

/**
 * Throttle function execution.
 * @description Ensures the function is called at most once per specified time period.
 * Unlike debounce, throttle guarantees regular execution for continuous events.
 * The first call is executed immediately, then subsequent calls are rate-limited.
 * 
 * @template T - The types of the function arguments
 * @param {function(...T): void} fn - The function to throttle
 * @param {number} delay - The minimum delay between calls in milliseconds
 * @returns {function(...T): void} The throttled function
 * 
 * @category Timing
 * @example
 * // Basic throttle
 * const logScroll = throttle(() => {
 *   console.log('Scroll position:', window.scrollY);
 * }, 100);
 * 
 * window.addEventListener('scroll', logScroll);
 * // Logs at most once every 100ms during scrolling
 * 
 * @example
 * // API rate limiting
 * const trackEvent = throttle((event: string, data: any) => {
 *   fetch('/api/analytics', {
 *     method: 'POST',
 *     body: JSON.stringify({ event, data, timestamp: Date.now() })
 *   });
 * }, 1000);
 * 
 * // Won't exceed 1 request per second
 * button.addEventListener('click', () => trackEvent('button_click', { id: 'submit' }));
 * 
 * @example
 * // Game loop or animation
 * const updateGame = throttle(() => {
 *   player.updatePosition();
 *   enemies.forEach(e => e.update());
 *   renderer.draw();
 * }, 16); // ~60 FPS
 * 
 * setInterval(updateGame, 0);
 * 
 * @see debounce - Delay execution until activity stops
 * @since 2025-07-03
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const throttle = <T extends any[], R>(
  fn: (...args: T) => R,
  limit: number
): ((...args: T) => R | undefined) => {
  let inThrottle = false;
  
  return (...args: T): R | undefined => {
    if (!inThrottle) {
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
      return fn(...args);
    }
    return undefined;
  };
};

/**
 * Batch async operations to avoid overwhelming external services.
 * @description Processes items in chunks with optional delays between batches.
 * Essential for rate-limited APIs or resource-intensive operations.
 * Executes operations in parallel within each batch but sequential between batches.
 * 
 * @template T - The type of items to process
 * @template R - The type of results
 * @param {T[]} items - Array of items to process
 * @param {function(T): Promise<R>} fn - Async function to process each item
 * @param {number} batchSize - Maximum number of items to process in parallel
 * @param {number} [delayMs=0] - Delay in milliseconds between batches
 * @returns {Promise<R[]>} Array of results in the same order as input
 * 
 * @category Batching
 * @example
 * // Basic batch processing
 * const userIds = Array.from({ length: 100 }, (_, i) => i + 1);
 * const fetchUser = async (id: number) => {
 *   const res = await fetch(`/api/users/${id}`);
 *   return res.json();
 * };
 * 
 * const users = await batchAsync(userIds, fetchUser, 10, 100);
 * // Fetches 10 users at a time with 100ms delay between batches
 * 
 * @example
 * // Email sending with rate limits
 * const recipients = [
 *   { email: 'user1@example.com', name: 'User 1' },
 *   { email: 'user2@example.com', name: 'User 2' },
 *   // ... many more
 * ];
 * 
 * const sendEmail = async (recipient: typeof recipients[0]) => {
 *   return await emailService.send({
 *     to: recipient.email,
 *     subject: 'Newsletter',
 *     body: `Hello ${recipient.name}!`
 *   });
 * };
 * 
 * // Send 20 emails per batch with 1 second delay (rate limit compliance)
 * const results = await batchAsync(recipients, sendEmail, 20, 1000);
 * 
 * @example
 * // Image processing
 * const imageUrls = ['img1.jpg', 'img2.jpg', // ... more images, 'img100.jpg'];
 * 
 * const processImage = async (url: string) => {
 *   const img = await loadImage(url);
 *   const processed = await applyFilters(img);
 *   return await saveImage(processed);
 * };
 * 
 * // Process 5 images at a time to avoid memory issues
 * const processed = await batchAsync(imageUrls, processImage, 5, 200);
 * console.log(`Processed ${processed.length} images`);
 * 
 * @see Promise.all - Process all items concurrently without batching
 */
export const batchAsync = async <T, U>(
  items: T[],
  fn: (item: T) => Promise<U>,
  batchSize = 10,
  delayMs = 100
): Promise<U[]> => {
  const results: U[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(item => fn(item)));
    results.push(...batchResults);

    // Add delay between batches to avoid rate limiting
    if (i + batchSize < items.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
};

/**
 * Advanced timing utilities for specialized use cases.
 * 
 * @category Advanced
 */
export const timingUtils = {
  /**
   * Debounce with immediate option.
   * Optionally invokes the function immediately on the leading edge.
   * 
   * @example
   * // Execute immediately on first call, then debounce
   * const saveWithFeedback = timingUtils.debounceWithImmediate(
   *   (data: string) => {
   *     showSaveIndicator();
   *     saveToServer(data);
   *   },
   *   1000,
   *   true // immediate
   * );
   * 
   * // First call executes immediately, subsequent calls are debounced
   * saveWithFeedback('data1'); // Executes immediately
   * saveWithFeedback('data2'); // Debounced
   * saveWithFeedback('data3'); // Debounced, only this executes after 1s
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debounceWithImmediate: <T extends any[]>(
    fn: (...args: T) => void,
    delay: number,
    immediate = false
  ): ((...args: T) => void) => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    return (...args: T): void => {
      const callNow = immediate && !timeoutId;
      
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (!immediate) {
          fn(...args);
        }
      }, delay);
      
      if (callNow) {
        fn(...args);
      }
    };
  },

  /**
   * Throttle with trailing call option.
   * Ensures the last call is always executed.
   * 
   * @example
   * // Progress updates with final state guarantee
   * const updateProgress = timingUtils.throttleWithTrailing(
   *   (percent: number) => {
   *     progressBar.style.width = `${percent}%`;
   *     if (percent === 100) {
   *       showCompletionMessage();
   *     }
   *   },
   *   100,
   *   true // trailing
   * );
   * 
   * // Updates at most every 100ms, but guarantees the final 100% is shown
   * for (let i = 0; i <= 100; i++) {
   *   updateProgress(i);
   * }
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  throttleWithTrailing: <T extends any[]>(
    fn: (...args: T) => void,
    limit: number,
    trailing = true
  ): ((...args: T) => void) => {
    let lastArgs: T | null = null;
    let lastCallTime = 0;
    let timeoutId: NodeJS.Timeout | null = null;
    
    return (...args: T): void => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallTime;
      
      if (timeSinceLastCall >= limit) {
        fn(...args);
        lastCallTime = now;
        lastArgs = null;
      } else {
        lastArgs = args;
        
        if (trailing && !timeoutId) {
          const remainingTime = limit - timeSinceLastCall;
          timeoutId = setTimeout(() => {
            if (lastArgs) {
              fn(...lastArgs);
              lastCallTime = Date.now();
              lastArgs = null;
            }
            timeoutId = null;
          }, remainingTime);
        }
      }
    };
  },

  /**
   * Create a function that measures its execution time.
   * 
   * @example
   * const timedFetch = timingUtils.measureTime(
   *   async (url: string) => {
   *     const response = await fetch(url);
   *     return response.json();
   *   },
   *   (duration, result) => {
   *     console.log(`Fetch took ${duration}ms`);
   *     analytics.track('api_call_duration', { duration, url: result.url });
   *   }
   * );
   * 
   * const data = await timedFetch('/api/data');
   */
  measureTime: <T extends unknown[], R>(
    fn: (...args: T) => R,
    onComplete?: (duration: number, result: Awaited<R>) => void,
    onError?: (duration: number, error: unknown) => void
  ): ((...args: T) => R) => {
    return (...args: T): R => {
      const start = performance.now();
      try {
        const result = fn(...args);

        if (result instanceof Promise) {
          const promiseWithTiming = (result as Promise<Awaited<R>>) 
            .then((value) => {
              onComplete?.(performance.now() - start, value);
              return value;
            })
            .catch((error) => {
              onError?.(performance.now() - start, error);
              throw error;
            });
          return promiseWithTiming as unknown as R;
        }

        onComplete?.(performance.now() - start, result as Awaited<R>);
        return result;
      } catch (error) {
        onError?.(performance.now() - start, error);
        throw error;
      }
    };
  },
};
