/**
 * Node.js Entry Point - Direct Static Import
 *
 * Optimized for Node.js bundles - only imports Node.js SDK code
 * No browser dependencies included
 */

import type { BaseSDKState } from "./sdk-factory.mjs";
import { NodeSDKWrapper } from "./sdk-wrapper-node.mjs";
import type { NodeClientConfig, NodeClientUserConfig } from "./config/client-config.mjs";

/**
 * Config type that accepts both old (with environment) and new (without) shapes.
 * Maintains backward compatibility with existing code (Codex review finding).
 */
export type NodeInitConfig = NodeClientUserConfig & Partial<Pick<NodeClientConfig, "environment">>;

/**
 * Initialize the Node.js OpenTelemetry SDK (asynchronous)
 * Environment is automatically set to 'node' - users don't need to specify it (H3 fix)
 * @param config - Node client configuration (environment field optional for backward compatibility)
 * @returns Promise that resolves when SDK initialization is complete
 */
export async function initialize(config: NodeInitConfig): Promise<BaseSDKState> {
  // H3 fix: Automatically inject environment so users don't have to specify it
  // Backward compatibility: accept but ignore any user-provided environment field
  return NodeSDKWrapper.initializeSdk({ ...config, environment: "node" });
}

export { UnifiedObservabilityClient } from "./unified-smart-client.mjs";
export type { BaseSDKState } from "./sdk-factory.mjs";
// H3 fix: Export both the user-facing config (no environment required) and full config
export type {
  NodeClientUserConfig,
  NodeClientConfig,
  BaseClientConfig,
  ProcessHandlerOptions,
  ScopeNameValidationMode,
} from "./config/client-config.mjs";

// Re-export Smart Metrics for convenience
export * from "./smart-metrics.mjs";

// Re-export sampling
export { SmartSampler } from "./sampling.mjs";
export type { SmartSamplerConfig } from "./sampling.mjs";

// ===== Process Lifecycle Utilities (API Boundary Fix) =====
// These utilities give consumers full control over process lifecycle
// while still benefiting from SDK telemetry flushing.
export {
  flushTelemetry,
  recordErrorTelemetry,
  createShutdownHandler,
} from "./sdk-wrapper-node.mjs";
