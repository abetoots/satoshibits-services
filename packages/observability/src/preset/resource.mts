/**
 * The resource every exported record carries.
 *
 * The preset builds the finished resource itself and gives it to NodeSDK with
 * NodeSDK's own detection turned off. Otherwise NodeSDK would merge
 * `OTEL_RESOURCE_ATTRIBUTES` in afterwards and those values would bypass the
 * filtering and redaction done here. The upstream environment detector is not
 * used either: at debug level it logs the raw attributes it found.
 */

import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { randomUUID } from "node:crypto";
import { type as osType } from "node:os";

import type { ResolvedConfig } from "./config.mjs";
import type { Redactor } from "./redaction.mjs";
import type { Attributes } from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";

// not yet in the stable semantic-conventions export
const ATTR_SERVICE_NAMESPACE = "service.namespace";
const ATTR_SERVICE_INSTANCE_ID = "service.instance.id";
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";
const ATTR_OS_TYPE = "os.type";

/**
 * Keys that identify the machine, the command line or the OS user. Dropped
 * after every merge, wherever the value came from.
 */
const DROPPED_KEY_PATTERNS: readonly RegExp[] = [
  /^host\./,
  /^process\.command/,
  /^process\.executable\./,
  /^process\.owner$/,
];

export const isDroppedResourceKey = (key: string): boolean =>
  DROPPED_KEY_PATTERNS.some((pattern) => pattern.test(key));

/** the semantic-conventions spelling of this platform's OS type */
function conventionalOsType(): string {
  const type = osType().toLowerCase();
  return type === "windows_nt" ? "windows" : type;
}

export function buildResource(config: ResolvedConfig, redactor: Redactor): Resource {
  const merged: Attributes = {
    // only the OS type: the detector's kernel version string identifies the machine image
    [ATTR_OS_TYPE]: conventionalOsType(),
    ...config.resourceAttributes,
    ...(config.serviceNamespace !== undefined && {
      [ATTR_SERVICE_NAMESPACE]: config.serviceNamespace,
    }),
    ...(config.serviceVersion !== undefined && {
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    ...(config.deploymentEnvironment !== undefined && {
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.deploymentEnvironment,
    }),
    // the environment wins over options for everything but the two keys added last
    ...config.environmentAttributes,
  };

  const kept: Attributes = {};
  for (const [key, value] of Object.entries(merged)) {
    if (!isDroppedResourceKey(key)) kept[key] = value;
  }

  // defaultResource supplies telemetry.sdk.*; ours wins on every shared key
  return defaultResource().merge(
    resourceFromAttributes({
      ...redactor.attributes(kept),
      // the two identity keys are added after redaction: a masked name or
      // instance id would merge the series of different services and replicas.
      // a name passed in code wins, so two processes sharing one environment stay distinct
      [ATTR_SERVICE_NAME]: config.serviceName,
      // one per process; the environment cannot pin it to a shared value
      [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
    }),
  );
}
