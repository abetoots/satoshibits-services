/**
 * The resource every exported record carries.
 *
 * The preset builds the finished resource itself and gives it to NodeSDK with
 * NodeSDK's own detection turned off. Otherwise NodeSDK would merge
 * `OTEL_RESOURCE_ATTRIBUTES` in afterwards and those values would bypass the
 * filtering done here and the policy the application named. The upstream environment detector is not
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

import { abandon, isThenable } from "./redaction.mjs";

// not yet in the stable semantic-conventions export
const ATTR_SERVICE_NAMESPACE = "service.namespace";
const ATTR_SERVICE_INSTANCE_ID = "service.instance.id";
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";
const ATTR_OS_TYPE = "os.type";

/**
 * Keys that identify the machine, the command line or the OS user. Dropped
 * from everything the preset gathers, wherever the value came from, before
 * the policy sees the resource. (A policy that adds such a key itself has it
 * exported: what the policy returns is the application's decision.)
 */
const DROPPED_KEY_PATTERNS: readonly RegExp[] = [
  /^host\./,
  /^process\.command/,
  /^process\.executable\./,
  /^process\.owner$/,
  // the newer spellings of the OS user
  /^process\.(user|real_user|saved_user)\./,
];

export const isDroppedResourceKey = (key: string): boolean =>
  DROPPED_KEY_PATTERNS.some((pattern) => pattern.test(key));

/** the semantic-conventions spelling of this platform's OS type */
function conventionalOsType(): string {
  const type = osType().toLowerCase();
  return type === "windows_nt" ? "windows" : type;
}

/** never passed to a policy and never taken from one: a changed name or instance id would merge services and replicas */
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_INSTANCE_ID,
]);

/**
 * The keys of an attribute set whose value is a promise, each promise having
 * been given a handler so that none is left to reject unheard. Called on what
 * the caller passed before anything else looks at it: before a setting can
 * replace a key, before the SDK is found disabled, before validation can fail.
 */
export function deferredAttributes(attributes: unknown): string[] {
  if (typeof attributes !== "object" || attributes === null) return [];
  const deferred = Object.entries(attributes).filter(([, value]) => isThenable(value));
  for (const [, value] of deferred) abandon(value);
  return deferred.map(([key]) => key);
}

/**
 * The SDK takes a promise for an attribute's value and waits for it: such a
 * value would be exported without the policy ever having seen it. A resource
 * attribute is a value. Every promise found is first given a handler, so that
 * none is left to reject unheard once the set is refused.
 */
function refuseDeferred(attributes: Attributes, what: string): void {
  const [first] = deferredAttributes(attributes);
  if (first !== undefined) {
    throw new TypeError(`${what} is a promise, not a value: ${first}`);
  }
}

export function buildResource(config: ResolvedConfig, redactor: Redactor): Resource {
  const merged: Attributes = {
    // the SDK's own description of itself (telemetry.sdk.*); ours wins on every shared key
    ...defaultResource().attributes,
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
    // the environment wins over options for everything but the two identity keys
    ...config.environmentAttributes,
  };

  // the caller's own were refused in validation; this is everything gathered, checked again
  // before any key is dropped
  refuseDeferred(merged, "a resource attribute");

  // everything that will be exported goes to the policy, the two identity keys aside,
  // wherever a value came from: the SDK, an option, or OTEL_RESOURCE_ATTRIBUTES
  const kept: Attributes = {};
  for (const [key, value] of Object.entries(merged)) {
    if (!isDroppedResourceKey(key) && !IDENTITY_KEYS.has(key)) kept[key] = value;
  }

  const exported = redactor.attributes("resource", kept);
  refuseDeferred(exported, "a resource attribute the redaction policy returned");

  return resourceFromAttributes({
    ...exported,
    // added after the policy has run, over whatever it returned.
    // a name passed in code wins, so two processes sharing one environment stay distinct
    [ATTR_SERVICE_NAME]: config.serviceName,
    // one per process; the environment cannot pin it to a shared value
    [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
  });
}
