/**
 * SDK Factory - Environment-aware SDK initialization
 *
 * Detects runtime environment and initializes the appropriate SDK
 * (Node.js or Browser) while maintaining a unified API.
 *
 * Uses centralized SDKStateMachine for coordinated state management.
 * @see sdk-state.mts for state machine implementation
 * @see ARCHITECTURE_MULTI_MODEL_REVIEW.md - Issue C2 resolution
 */

import type {
  BaseClientConfig,
  SmartClientConfig,
} from "./unified-smart-client.mjs";

import { getBusinessContext } from "./enrichment/context.mjs";
import { initializeSanitizer } from "./enrichment/sanitizer.mjs";
import { sdkStateMachine } from "./sdk-state.mjs";
import { configureErrorSanitizer, resetErrorSanitizer } from "./smart-errors.mjs";
import { UnifiedObservabilityClient } from "./unified-smart-client.mjs";
// Note: SDK wrappers loaded dynamically to avoid bundle bloat
import { detectEnvironment } from "./utils/environment.mjs";

/**
 * Base SDK interface with configurable return type.
 * Browser SDK is synchronous, Node SDK is asynchronous.
 * @template TConfig - Configuration type (BrowserClientConfig or NodeClientConfig)
 * @template TResult - Return type (BaseSDKState for sync, Promise<BaseSDKState> for async)
 */
export interface BaseSDK<
  TConfig = BaseClientConfig,
  TResult extends BaseSDKState | Promise<BaseSDKState> = BaseSDKState | Promise<BaseSDKState>,
> {
  initializeSdk: (config: TConfig) => TResult;
}

export interface BaseSDKState {
  environment: "node" | "browser" | "unknown";
  isInitialized: boolean;
  shutdown: () => Promise<void> | void;
  sanitizer: ReturnType<typeof initializeSanitizer> | null;
}

// [C2] Removed legacy dual-path sdkState variable - now using sdkStateMachine as single source of truth
// @see 3-SIMPLICITY_AND_DEAD_CODE_MULTI_MODEL_REVIEW.md - Issue C2

/**
 * Initialize SDK based on detected environment (DYNAMIC IMPORTS)
 *
 * Uses sdkStateMachine as single source of truth for state management.
 * @see 3-SIMPLICITY_AND_DEAD_CODE_MULTI_MODEL_REVIEW.md - Issue C2
 */
export async function initializeEnvironmentSdkDynamic(
  config: SmartClientConfig,
): Promise<BaseSDKState> {
  // check centralized state machine first
  if (sdkStateMachine.isReady()) {
    console.warn("SDK already initialized");
    return sdkStateMachine.getState();
  }

  // prevent concurrent initialization by checking existing promise
  const existingPromise = sdkStateMachine.getInitPromise();
  if (existingPromise) {
    await existingPromise;
    return sdkStateMachine.getState();
  }

  const environment = detectEnvironment();

  // dispatch init start event to state machine (only for known environments)
  if (environment === "browser" || environment === "node") {
    sdkStateMachine.dispatch({ type: "INIT_START", environment });
  }

  // wrap the initialization in a promise and track it on the state machine
  let resultState: BaseSDKState | null = null;

  const initPromise = (async () => {
    try {
      if (environment === "browser") {
        const browserSdk = await import("./sdk-wrapper-browser.mjs");
        const browserConfig =
          config.environment === "browser"
            ? config
            : { ...config, environment: "browser" as const };

        resultState = await browserSdk.BrowserSDKWrapper.initializeSdk(browserConfig);
      } else if (environment === "node") {
        const nodeSdk = await import("./sdk-wrapper-node.mjs");
        const nodeConfig =
          config.environment === "node"
            ? config
            : { ...config, environment: "node" as const };

        resultState = await nodeSdk.NodeSDKWrapper.initializeSdk(nodeConfig);
      } else {
        throw new Error(`Unknown environment: ${environment}`);
      }

      // dispatch success event to state machine (single source of truth)
      sdkStateMachine.dispatch({
        type: "INIT_SUCCESS",
        shutdown: async () => { await resultState?.shutdown(); },
        sanitizer: resultState.sanitizer,
      });

      console.debug(`OpenTelemetry SDK initialized for ${environment} environment`);
    } catch (error) {
      console.error(`Failed to initialize ${environment} SDK:`, error);
      sdkStateMachine.dispatch({
        type: "INIT_FAILURE",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      sdkStateMachine.setInitPromise(null);
    }
  })();

  sdkStateMachine.setInitPromise(initPromise);
  await initPromise;
  return sdkStateMachine.getState();
}

/**
 * Shutdown SDK gracefully (DYNAMIC IMPORTS)
 *
 * Uses sdkStateMachine as single source of truth for state management.
 */
export async function shutdownEnvironmentSdk(): Promise<void> {
  // wait for pending initialization to complete before shutting down
  const initPromise = sdkStateMachine.getInitPromise();
  if (initPromise) {
    try {
      await initPromise;
    } catch {
      // ignore init failure - we still want to proceed with shutdown checks
    }
  }

  // check state machine (single source of truth)
  if (!sdkStateMachine.isReady()) return;

  // prevent concurrent shutdown
  const existingShutdown = sdkStateMachine.getShutdownPromise();
  if (existingShutdown) {
    await existingShutdown;
    return;
  }

  sdkStateMachine.dispatch({ type: "SHUTDOWN_START" });

  const currentState = sdkStateMachine.getState();

  const shutdownPromise = (async () => {
    try {
      await sdkStateMachine.runCleanups();

      // shutdown environment-specific SDK
      if (currentState.environment === "browser") {
        const browserSdk = await import("./sdk-wrapper-browser.mjs");
        await browserSdk.shutdownBrowserSdk();
      } else if (currentState.environment === "node") {
        const nodeSdk = await import("./sdk-wrapper-node.mjs");
        await nodeSdk.shutdownSdk();
      }

      sdkStateMachine.dispatch({ type: "SHUTDOWN_COMPLETE" });
      resetErrorSanitizer();
      console.debug("OpenTelemetry SDK shutdown complete");
    } finally {
      // always clear promise lock (Codex review fix)
      sdkStateMachine.setShutdownPromise(null);
    }
  })();

  sdkStateMachine.setShutdownPromise(shutdownPromise);
  await shutdownPromise;
}

/**
 * Get current SDK state (from single source of truth)
 */
export function getSdkState(): BaseSDKState {
  return sdkStateMachine.getState();
}

/**
 * Check if SDK is initialized (single source of truth)
 */
export function isInitialized(): boolean {
  return sdkStateMachine.isReady();
}

// [M1] Removed getCurrentEnvironment() - use sdkStateMachine.getState().environment directly

/**
 * Register a cleanup function to run on SDK shutdown
 * Uses centralized state machine for coordinated cleanup
 */
export function registerCleanup(cleanup: () => void | Promise<void>): void {
  // only register in state machine - legacy cleanupFunctions array is deprecated
  sdkStateMachine.dispatch({ type: "REGISTER_CLEANUP", cleanup });
}

// re-export state machine for direct access when needed
export { sdkStateMachine };

/**
 * Unified client creation function (DYNAMIC IMPORTS)
 * Consolidates all initialization logic with dynamic imports to preserve bundle size
 * Integrates SmartSampler, WebVitals, and DataSanitizer
 *
 * Supports "Bring Your Own Provider" mode (API Boundary Fix - Issue #5):
 * - `skipSdkInitialization: true` - Skip all SDK setup, use globally registered providers
 * - `existingTracerProvider` / `existingMeterProvider` - Use provided providers instead
 */
export async function createUnifiedClient(
  config: SmartClientConfig,
): Promise<UnifiedObservabilityClient> {
  // API Boundary Fix - Issue #5: Bring Your Own Provider
  // Determine if we should skip SDK initialization:
  // - skipSdkInitialization: true - use globally registered providers
  // - existingTracerProvider + existingMeterProvider both set - use provided providers
  const shouldSkipSdkInit =
    config.skipSdkInitialization ||
    (config.existingTracerProvider !== undefined &&
      config.existingMeterProvider !== undefined);

  if (shouldSkipSdkInit) {
    const reason = config.skipSdkInitialization
      ? "using globally registered providers"
      : "using provided TracerProvider and MeterProvider";
    console.debug(`[Observability SDK] Skipping SDK initialization - ${reason}`);

    // dispatch INIT_START first so state machine transitions to 'initializing'
    sdkStateMachine.dispatch({
      type: "INIT_START",
      environment: config.environment,
    });

    // then dispatch INIT_SUCCESS with no-op shutdown
    sdkStateMachine.dispatch({
      type: "INIT_SUCCESS",
      shutdown: async () => {
        // no-op shutdown since we didn't initialize the SDK
        console.debug("[Observability SDK] Shutdown skipped - SDK was not initialized by us");
      },
      sanitizer: null,
    });
  } else {
    // Initialize environment-specific SDK with dynamic imports
    await initializeEnvironmentSdkDynamic(config);
  }

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

  // Configure error sanitizer (API Boundary Fix - Issue #3)
  // ALWAYS configure to ensure consistent behavior regardless of initialization order.
  // This prevents the bug where client A sets 'minimal' and client B uses defaults,
  // but client B doesn't call configure, leaving global state at 'minimal'.
  // Note: This is still a singleton - full per-client isolation is addressed in Issue #4.
  //
  // C3 Fix (Doc 4): Merge sanitizerOptions with errorSanitizerOptions to ensure
  // user-configured sanitization rules apply to BOTH breadcrumbs/context AND errors.
  // This unifies the dual sanitizer architecture identified in the multi-model review.
  const mergedErrorSanitizerOptions: typeof config.errorSanitizerOptions =
    config.sanitizerOptions || config.errorSanitizerOptions
      ? {
          ...config.sanitizerOptions,
          ...config.errorSanitizerOptions,
          // merge custom patterns from both sources (error-specific patterns run first to take precedence)
          customPatterns: [
            ...(config.errorSanitizerOptions?.customPatterns ?? []),
            ...(config.sanitizerOptions?.customPatterns ?? []),
          ],
          // merge custom redact fields from both sources
          customRedactFields: [
            ...(config.sanitizerOptions?.customRedactFields ?? []),
            ...(config.errorSanitizerOptions?.customRedactFields ?? []),
          ],
        }
      : undefined;

  configureErrorSanitizer(
    config.errorSanitizerPreset ?? "strict",
    mergedErrorSanitizerOptions,
  );

  // Register instance in the global registry (API Boundary Fix - Issue #4)
  // This allows tracking multiple client instances for micro-frontend scenarios
  const { registerInstance } = await import("./client-instance.mjs");
  registerInstance(client);

  return client;
}
