/**
 * Global setup for Vitest workers.
 * Provides a minimal `process` object when missing (e.g., jsdom workers)
 * so Vitest internals that call process.listeners() do not crash.
 * This is test-only and does not affect production bundles.
 */

export default function () {
  if (typeof globalThis.process === "undefined") {
    globalThis.process = {
      env: {},
      listeners: (_event: string) => [],
      removeListener: () => {},
      on: () => {},
      once: () => {},
      emit: () => false,
      removeAllListeners: () => {},
      setMaxListeners: () => {},
      getMaxListeners: () => 10,
      eventNames: () => [],
      listenerCount: () => 0,
    };
  }
}
