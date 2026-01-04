/**
 * Instance management for UnifiedObservabilityClient
 *
 * This module provides a centralized location for managing client instances
 * and their initialization state. It exists as a separate module to avoid circular
 * dependencies when other modules (context.mts, sanitizer.mts) need to access
 * client instances.
 *
 * API Boundary Fix - Issue #4: Micro-Frontend Compatibility
 * =========================================================
 * This module now supports both singleton and multi-instance patterns:
 *
 * - **Singleton** (`SmartClient.initialize()`): Uses `unifiedClientInstance`
 * - **Multi-instance** (`SmartClient.create()`): Tracked in `instanceRegistry`
 *
 * OpenTelemetry Shared State:
 * The underlying OTel TracerProvider and MeterProvider are global singletons
 * by design. All client instances share:
 * - The trace context propagation
 * - The metric export pipeline
 * - Resource attributes (service.name from first initialization)
 *
 * Instance-Isolated State:
 * Each client instance owns:
 * - Instrument cache (counters, gauges, histograms)
 * - Scoped client cache
 * - Sanitizer manager configuration
 * - Context enricher state
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
 * Registry of all created client instances (for multi-instance support).
 * Uses a Set which creates strong references. Instances MUST be explicitly
 * unregistered via client.destroy() to prevent memory leaks.
 * @internal
 */
const instanceRegistry = new Set<UnifiedObservabilityClient>();

/**
 * Get the current unified client instance (singleton)
 * @returns The client instance or null if not initialized
 * @internal
 */
export function getUnifiedClientInstance(): UnifiedObservabilityClient | null {
  return unifiedClientInstance;
}

/**
 * Set the unified client instance (singleton)
 * @param instance - The client instance to set, or null to clear
 * @internal
 */
export function setUnifiedClientInstance(
  instance: UnifiedObservabilityClient | null,
): void {
  // if there was a previous singleton, remove it from the registry to prevent a leak
  if (unifiedClientInstance && unifiedClientInstance !== instance) {
    instanceRegistry.delete(unifiedClientInstance);
  }

  unifiedClientInstance = instance;

  // also add the new instance to the registry if it's not null
  if (instance) {
    instanceRegistry.add(instance);
  }
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

// ===== Multi-Instance Support (API Boundary Fix - Issue #4) =====

/**
 * Register a client instance in the registry
 * Called by SmartClient.create() for non-singleton instances
 * @param instance - The client instance to register
 * @internal
 */
export function registerInstance(instance: UnifiedObservabilityClient): void {
  instanceRegistry.add(instance);
}

/**
 * Unregister a client instance from the registry
 * Called by client.destroy() when an instance is disposed
 * @param instance - The client instance to unregister
 * @internal
 */
export function unregisterInstance(instance: UnifiedObservabilityClient): void {
  instanceRegistry.delete(instance);
  // if this was the singleton, clear it AND the initialization promise
  // to allow SmartClient.initialize() to create a fresh client
  if (unifiedClientInstance === instance) {
    unifiedClientInstance = null;
    initializationPromise = null;
  }
}

/**
 * Get all registered client instances
 * Useful for testing or debugging multi-instance scenarios
 * @returns Array of all registered client instances
 * @internal
 */
export function getAllInstances(): UnifiedObservabilityClient[] {
  return Array.from(instanceRegistry);
}

/**
 * Get the count of registered instances
 * @returns Number of active client instances
 * @internal
 */
export function getInstanceCount(): number {
  return instanceRegistry.size;
}

/**
 * Clear all instances (for testing)
 * @internal
 */
export function clearAllInstances(): void {
  instanceRegistry.clear();
  unifiedClientInstance = null;
  initializationPromise = null;
}
