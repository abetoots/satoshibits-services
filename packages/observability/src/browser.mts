/**
 * Browser Entry Point - Direct Static Import
 *
 * Optimized for browser bundles - only imports browser SDK code
 * No Node.js dependencies included
 */

import type { BaseSDKState } from "./sdk-factory.mjs";
import { BrowserSDKWrapper } from "./sdk-wrapper-browser.mjs";
import type { BrowserClientConfig } from "./unified-smart-client.mjs";

/**
 * Initialize the Browser OpenTelemetry SDK
 * @returns SDK state after initialization
 */
export const initialize: (config: BrowserClientConfig) => BaseSDKState =
  BrowserSDKWrapper.initializeSdk;
export { UnifiedObservabilityClient } from "./unified-smart-client.mjs";
export type { BaseSDKState } from "./sdk-factory.mjs";
export type {
  BrowserClientConfig,
  BaseClientConfig,
} from "./unified-smart-client.mjs";

// Re-export Smart Metrics for convenience
export * from "./smart-metrics.mjs";

// Re-export sampling
export { SmartSampler } from "./sampling.mjs";
export type { SmartSamplerConfig } from "./sampling.mjs";
