/**
 * SDK Factory - Environment-aware SDK initialization
 *
 * Detects runtime environment and initializes the appropriate SDK
 * (Node.js or Browser) while maintaining a unified API.
 */

import type {
  BaseClientConfig,
  SmartClientConfig,
} from "./unified-smart-client.mjs";

import { getBusinessContext } from "./enrichment/context.mjs";
import { initializeSanitizer } from "./enrichment/sanitizer.mjs";
import { UnifiedObservabilityClient } from "./unified-smart-client.mjs";
// Note: SDK wrappers loaded dynamically to avoid bundle bloat
import { detectEnvironment } from "./utils/environment.mjs";

export interface BaseSDK<T = BaseClientConfig> {
  initializeSdk: (config: T) => BaseSDKState | Promise<BaseSDKState>;
}

export interface BaseSDKState {
  environment: "node" | "browser" | "unknown";
  isInitialized: boolean;
  shutdown: () => Promise<void> | void;
  cleanupFunctions?: (() => void)[];
  sanitizer: ReturnType<typeof initializeSanitizer> | null;
}

/**
 * The root SDK state - other environment states extend this
 * but are kept separate since users may choose a specific SDK's entrypoint
 * and we want to avoid unnecessary dependencies in those cases.
 */
let sdkState: BaseSDKState = {
  environment: "unknown",
  isInitialized: false,
  cleanupFunctions: [],
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  shutdown: () => {},
  sanitizer: null,
};

/**
 * Initialize SDK based on detected environment (DYNAMIC IMPORTS)
 */
export async function initializeEnvironmentSdkDynamic(
  config: SmartClientConfig,
): Promise<BaseSDKState> {
  if (sdkState.isInitialized) {
    console.warn("SDK already initialized");
    return sdkState;
  }

  const environment = detectEnvironment();
  sdkState.environment = environment;

  try {
    if (environment === "browser") {
      // Dynamically import browser SDK to avoid Node.js dependencies in bundle
      const browserSdk = await import("./sdk-wrapper-browser.mjs");

      // Ensure config is browser-specific or create fallback
      const browserConfig =
        config.environment === "browser"
          ? config
          : {
              ...config,
              environment: "browser" as const,
            };

      // Initialize browser SDK and capture the returned state
      // Note: await handles both sync and async initializers for future-proofing
      const browserState = await browserSdk.BrowserSDKWrapper.initializeSdk(browserConfig);

      // Update module-level state with wrapper return value
      sdkState = browserState;
    } else if (environment === "node") {
      // Dynamically import Node SDK to avoid browser dependencies in Node
      const nodeSdk = await import("./sdk-wrapper-node.mjs");

      // Ensure config is node-specific or create fallback
      const nodeConfig =
        config.environment === "node"
          ? config
          : {
              ...config,
              environment: "node" as const,
            };

      // Initialize Node SDK (async) and capture the returned state
      const nodeState = await nodeSdk.NodeSDKWrapper.initializeSdk(nodeConfig);

      // Update module-level state with wrapper return value
      sdkState = nodeState;
    } else {
      throw new Error(`Unknown environment: ${environment}`);
    }

    // use debug level - can be filtered in production
    console.debug(`OpenTelemetry SDK initialized for ${environment} environment`);
    return sdkState;
  } catch (error) {
    console.error(`Failed to initialize ${environment} SDK:`, error);

    // OpenTelemetry automatically provides no-op implementations
    // when SDK isn't initialized - we don't need to track fallback state
    sdkState.isInitialized = false;

    return sdkState;
  }
}

/**
 * Shutdown SDK gracefully (DYNAMIC IMPORTS)
 */
export async function shutdownEnvironmentSdk(): Promise<void> {
  if (!sdkState.isInitialized) return;

  // Run registered cleanup callbacks (event handlers, etc.)
  if (sdkState.cleanupFunctions && sdkState.cleanupFunctions.length > 0) {
    for (const cleanup of sdkState.cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.error(
          "Cleanup function threw an error during shutdown:",
          error,
        );
      }
    }
  }

  // Shutdown SDK first to flush all pending telemetry data
  if (sdkState.environment === "browser") {
    const browserSdk = await import("./sdk-wrapper-browser.mjs");
    await browserSdk.shutdownBrowserSdk();
  } else if (sdkState.environment === "node") {
    const nodeSdk = await import("./sdk-wrapper-node.mjs");
    await nodeSdk.shutdownSdk();
  }

  // note: instrument cache is now managed per-client-instance
  // and will be garbage collected when the client instance is destroyed

  // Reset state
  sdkState = {
    environment: "unknown",
    isInitialized: false,
    cleanupFunctions: [],
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    shutdown: () => {},
    sanitizer: null,
  };

  console.debug("OpenTelemetry SDK shutdown complete");
}

/**
 * Get current SDK state
 */
export function getSdkState() {
  return {
    ...sdkState,
  };
}

/**
 * Check if SDK is initialized
 */
export function isInitialized(): boolean {
  return sdkState.isInitialized;
}

/**
 * Get current environment
 */
export function getCurrentEnvironment(): "node" | "browser" | "unknown" {
  return sdkState.environment;
}

/**
 * Unified client creation function (DYNAMIC IMPORTS)
 * Consolidates all initialization logic with dynamic imports to preserve bundle size
 * Integrates SmartSampler, WebVitals, and DataSanitizer
 */
export async function createUnifiedClient(
  config: SmartClientConfig,
): Promise<UnifiedObservabilityClient> {
  // Initialize environment-specific SDK with dynamic imports
  await initializeEnvironmentSdkDynamic(config);

  // Create and initialize the unified client
  const client = new UnifiedObservabilityClient(config);

  // Initialize global sanitizer with provided options so sanitize() helpers
  // respect configuration passed through entrypoints across all modules.
  if (config.sanitize !== false) {
    initializeSanitizer(config.sanitizerOptions, {
      maxTenantSanitizers: config.maxTenantSanitizers,
      tenantConfigProvider: config.tenantSanitizerConfigProvider,
      // Inject the business context getter to break the circular dependency
      contextProvider: () => {
        const businessCtx = getBusinessContext();
        if (businessCtx?.tenantId) {
          return {
            tenantId: businessCtx.tenantId,
            region: businessCtx.region as string | undefined,
          };
        }
        return undefined;
      },
    });
  }

  return client;
}
