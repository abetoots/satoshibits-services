/**
 * Resource Factory for OpenTelemetry Resource Attributes
 *
 * Centralizes common resource attribute creation for both browser and node SDKs.
 * Each platform can augment the base attributes with platform-specific ones.
 *
 * Why this file exists:
 * - Both browser and node SDKs create identical base resource attributes
 * - This is "essential duplication" - the same logic repeated verbatim
 * - Refactoring accepted by Gemini 2.5 Pro review (see REFACTORING-ADVISOR-SYNTHESIS.md)
 */

import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import type { Resource } from "@opentelemetry/resources";

/**
 * Custom attribute for deployment environment
 * Not yet standardized in semantic conventions
 */
const ATTR_DEPLOYMENT_ENVIRONMENT = "deployment.environment";

/**
 * Base configuration for resource creation
 * These attributes are common across all platforms
 */
export interface BaseResourceConfig {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
}

/**
 * Create base resource attributes common to all platforms
 *
 * @param config - Base configuration
 * @returns Resource attributes object
 */
export function createBaseResourceAttributes(
  config: BaseResourceConfig
): Record<string, string | number | boolean> {
  return {
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion ?? "0.0.0",
    [ATTR_DEPLOYMENT_ENVIRONMENT]: config.environment ?? "production",
  };
}

/**
 * Create a complete OpenTelemetry Resource with base and additional attributes
 *
 * This function creates a resource with base attributes and allows platforms
 * to augment with platform-specific attributes (e.g., browser.page.url for browser,
 * process.pid for node).
 *
 * @param baseConfig - Base configuration (service name, version, environment)
 * @param additionalAttributes - Platform-specific attributes to merge
 * @returns OpenTelemetry Resource instance
 *
 * @example
 * // Browser usage
 * const browserResource = createResource(
 *   { serviceName: "my-app", environment: "production" },
 *   { "browser.page.url": window.location.href }
 * );
 *
 * @example
 * // Node usage
 * const nodeResource = createResource(
 *   { serviceName: "my-api", environment: "staging" },
 *   { "process.pid": process.pid }
 * );
 */
export function createResource(
  baseConfig: BaseResourceConfig,
  additionalAttributes: Record<string, string | number | boolean> = {}
): Resource {
  const attributes = {
    ...createBaseResourceAttributes(baseConfig),
    ...additionalAttributes,
  };

  return resourceFromAttributes(attributes);
}
