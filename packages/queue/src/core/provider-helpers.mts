/**
 * Provider resolution and lifecycle utilities
 */

import type { IQueueProvider, IProviderFactory } from "../providers/provider.interface.mjs";
import { MemoryProvider } from "../providers/memory/memory.provider.mjs";

/**
 * Helper utilities for provider resolution and lifecycle management
 */
export class ProviderHelper {
  /**
   * Resolves a provider or factory into a queue-bound provider instance
   *
   * @param provider - Provider instance or factory (or undefined for default)
   * @param queueName - Queue name to bind to
   * @returns Bound provider instance
   *
   * @example
   * const boundProvider = ProviderHelper.resolveBoundProvider(
   *   options?.provider,
   *   "my-queue"
   * );
   */
  static resolveBoundProvider(
    provider: IQueueProvider | IProviderFactory | undefined,
    queueName: string,
  ): IQueueProvider {
    // default to MemoryProvider if no provider specified (zero-config)
    const resolved = provider ?? new MemoryProvider();

    // if provider has forQueue method, it's a factory - create bound instance
    // otherwise, assume it's already queue-bound
    return "forQueue" in resolved
      ? resolved.forQueue(queueName)
      : resolved;
  }

  /**
   * Safely disconnects a provider if it has a disconnect method
   * Used during cleanup to avoid errors with providers that don't implement disconnect
   *
   * @param provider - Provider to disconnect
   */
  static async conditionalDisconnect(
    provider: IQueueProvider,
  ): Promise<void> {
    if ("disconnect" in provider && typeof provider.disconnect === "function") {
      await provider.disconnect();
    }
  }

  /**
   * Type guard to check if a provider is a factory
   */
  static isFactory(
    provider: IQueueProvider | IProviderFactory,
  ): provider is IProviderFactory {
    return "forQueue" in provider;
  }
}
