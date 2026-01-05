/**
 * Browser Entry Point - Direct Static Import
 *
 * Optimized for browser bundles - only imports browser SDK code
 * No Node.js dependencies included
 */

import type { BaseSDKState } from "./sdk-factory.mjs";
import { BrowserSDKWrapper } from "./sdk-wrapper-browser.mjs";
import type { BrowserClientConfig, BrowserClientUserConfig } from "./config/client-config.mjs";

/**
 * Config type that accepts both old (with environment) and new (without) shapes.
 * Maintains backward compatibility with existing code (Codex review finding).
 */
export type BrowserInitConfig = BrowserClientUserConfig & Partial<Pick<BrowserClientConfig, "environment">>;

/**
 * Initialize the Browser OpenTelemetry SDK (asynchronous)
 * Environment is automatically set to 'browser' - users don't need to specify it (H3 fix)
 *
 * M4 fix: Now async to support dynamic import of auto-instrumentations-web
 * for bundle size optimization when using `webInstrumentationMode: 'minimal'`.
 *
 * @param config - Browser client configuration (environment field optional for backward compatibility)
 * @returns Promise that resolves to SDK state after initialization
 */
export async function initialize(config: BrowserInitConfig): Promise<BaseSDKState> {
  // H3 fix: Automatically inject environment so users don't have to specify it
  // Backward compatibility: accept but ignore any user-provided environment field
  return BrowserSDKWrapper.initializeSdk({ ...config, environment: "browser" });
}

export { UnifiedObservabilityClient } from "./unified-smart-client.mjs";
export type { BaseSDKState } from "./sdk-factory.mjs";
// H3 fix: Export both the user-facing config (no environment required) and full config
export type {
  BrowserClientUserConfig,
  BrowserClientConfig,
  BaseClientConfig,
  ScopeNameValidationMode,
} from "./config/client-config.mjs";

// API Boundary Fix - Issue #6: Export convenience presets for opt-in instrumentations
export {
  RECOMMENDED_BROWSER_INSTRUMENTATION,
  FULL_BROWSER_INSTRUMENTATION,
} from "./config/client-config.mjs";

// Re-export Smart Metrics for convenience
export * from "./smart-metrics.mjs";

// Re-export sampling
export { SmartSampler } from "./sampling.mjs";
export type { SmartSamplerConfig } from "./sampling.mjs";
