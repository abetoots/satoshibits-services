/**
 * Singleton management for UnifiedObservabilityClient
 *
 * This module provides a centralized location for managing the global client instance
 * and its initialization state. It exists as a separate module to avoid circular
 * dependencies when other modules (context.mts, sanitizer.mts) need to access
 * the singleton instance.
 *
 * @module client-instance
 * @internal
 */

import type { UnifiedObservabilityClient } from "./unified-smart-client.mjs";

/**
 * Singleton instance of the unified observability client
 * @internal
 */
let unifiedClientInstance: UnifiedObservabilityClient | null = null;

/**
 * Initialization promise guard to prevent race conditions
 * @internal
 */
let initializationPromise: Promise<UnifiedObservabilityClient> | null = null;

/**
 * Get the current unified client instance
 * @returns The client instance or null if not initialized
 * @internal
 */
export function getUnifiedClientInstance(): UnifiedObservabilityClient | null {
  return unifiedClientInstance;
}

/**
 * Set the unified client instance
 * @param instance - The client instance to set, or null to clear
 * @internal
 */
export function setUnifiedClientInstance(
  instance: UnifiedObservabilityClient | null,
): void {
  unifiedClientInstance = instance;
}

/**
 * Get the current initialization promise
 * @returns The initialization promise or null if not initializing
 * @internal
 */
export function getInitializationPromise(): Promise<UnifiedObservabilityClient> | null {
  return initializationPromise;
}

/**
 * Set the initialization promise
 * @param promise - The initialization promise to set, or null to clear
 * @internal
 */
export function setInitializationPromise(
  promise: Promise<UnifiedObservabilityClient> | null,
): void {
  initializationPromise = promise;
}
