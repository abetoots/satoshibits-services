// Import environment-aware SDK factory
import type {
  SmartClientAPI,
  SmartClientConfig,
  UnifiedObservabilityClient,
} from "./unified-smart-client.mjs";

import {
  getInitializationPromise,
  getUnifiedClientInstance,
  setInitializationPromise,
  setUnifiedClientInstance,
} from "./client-instance.mjs";
import { createUnifiedClient, shutdownEnvironmentSdk } from "./sdk-factory.mjs";
// Import error handling from smart-errors
import {
  categorizeErrorForObservability,
  reportError,
  withErrorReporting,
} from "./smart-errors.mjs";
// Import smart metrics from smart-metrics module
import {
  createSmartCounter,
  createSmartGauge,
  createSmartHistogram,
  createSmartUpDownCounter,
} from "./smart-metrics.mjs";

/**
 * @satoshibits/observability
 *
 * Smart observability client built on OpenTelemetry SDK.
 * Provides automatic instrumentation, context propagation,
 * and business context enrichment out of the box.
 */

// Re-export the singleton accessor for use by global helpers and external code
export { getUnifiedClientInstance } from "./client-instance.mjs";

/**
 * Convenience function to initialize observability and return the unified client (ASYNC)
 * Uses dynamic imports for bundle optimization
 */
export async function initializeObservability(
  config: SmartClientConfig,
): Promise<UnifiedObservabilityClient> {
  // return existing instance if already initialized
  const existingInstance = getUnifiedClientInstance();
  if (existingInstance) {
    console.warn("Observability client already initialized");
    return existingInstance;
  }

  // if initialization is in progress, wait for it
  const existingPromise = getInitializationPromise();
  if (existingPromise) {
    return existingPromise;
  }

  // start initialization with atomic guard
  const promise = (async () => {
    try {
      const client = await createUnifiedClient(config);
      setUnifiedClientInstance(client);

      // Note: SIGTERM handler is registered by sdk-wrapper-node.mts
      // No need for duplicate handler here - the Node wrapper handles
      // graceful shutdown with proper timeout and cleanup

      return client;
    } catch (error) {
      // clear initialization promise on error so retry is possible
      setInitializationPromise(null);
      throw error;
    }
  })();

  setInitializationPromise(promise);
  return promise;
}

/**
 * Shutdown helper that clears the cached singleton so clients can re-initialize safely.
 */
export async function shutdownObservability(): Promise<void> {
  try {
    await shutdownEnvironmentSdk();
  } finally {
    setUnifiedClientInstance(null);
    setInitializationPromise(null);
  }
}

// Re-export smart metric functions
export {
  createSmartCounter,
  createSmartHistogram,
  createSmartGauge,
  createSmartUpDownCounter,
};

// Re-export error handling functions
export { reportError, withErrorReporting, categorizeErrorForObservability };

// re-export commonly used OpenTelemetry types
export { SpanStatusCode, SpanKind } from "@opentelemetry/api";
export type { Span, Tracer, Meter } from "@opentelemetry/api";

// export sampling and result utilities
export * from "./sampling.mjs";
export * from "./utils/result-adapter.mjs";

// export enrichment utilities
export {
  runWithBusinessContext,
  getBusinessContext as getSmartContext,
  mergeBusinessContext,
  type SmartContext,
  type ApplicationContext,
  ContextEnricher,
  getGlobalContext,
  addBreadcrumb,
  setUser,
  addTag,
  getEnrichedLabels,
  clearContext,
} from "./enrichment/context.mjs";

// export unified client
export { UnifiedObservabilityClient } from "./unified-smart-client.mjs";

/**
 * SmartClient namespace - Branded entry point matching SMART_CLIENT_API spec (ASYNC)
 */
export const SmartClient: SmartClientAPI = {
  /**
   * Initialize the smart observability client (ASYNC)
   * Branded alias for initializeObservability()
   * Works in both Node.js and browser environments
   */
  initialize: initializeObservability,

  /**
   * Create a client without singleton behavior (ASYNC)
   * Useful for testing or multiple instances
   */
  create: createUnifiedClient,

  /**
   * Shutdown the SDK gracefully
   */
  shutdown: shutdownObservability,
};

// Note: Environment-specific SDK helpers are available via
// '@satoshibits/observability/node' and '@satoshibits/observability/browser'.
// The universal entrypoint intentionally avoids re-exporting node/browser-only
// helpers to prevent accidental bundling of environment-specific code.

// export sanitizers
export {
  sanitize,
  sanitizeError,
  sanitizeObject,
  sanitizeString,
  clearSanitizationCache,
  getCacheStats,
  SanitizerManager,
  SanitizerPresets,
  type SanitizerOptions,
} from "./enrichment/sanitizer.mjs";
