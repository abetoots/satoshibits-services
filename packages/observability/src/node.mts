/**
 * Node.js Entry Point - Direct Static Import
 *
 * Optimized for Node.js bundles - only imports Node.js SDK code
 * No browser dependencies included
 */

import type { BaseSDKState } from "./sdk-factory.mjs";
import { NodeSDKWrapper } from "./sdk-wrapper-node.mjs";
import type { NodeClientConfig } from "./unified-smart-client.mjs";

/**
 * Initialize the Node.js OpenTelemetry SDK
 * @returns Promise that resolves when SDK initialization is complete
 */
export const initialize: (config: NodeClientConfig) => Promise<BaseSDKState> =
  NodeSDKWrapper.initializeSdk;
export { UnifiedObservabilityClient } from "./unified-smart-client.mjs";
export type { BaseSDKState } from "./sdk-factory.mjs";
export type {
  NodeClientConfig,
  BaseClientConfig,
} from "./unified-smart-client.mjs";

// Re-export Smart Metrics for convenience
export * from "./smart-metrics.mjs";

// Re-export sampling
export { SmartSampler } from "./sampling.mjs";
export type { SmartSamplerConfig } from "./sampling.mjs";
