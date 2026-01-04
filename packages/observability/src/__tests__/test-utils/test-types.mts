/**
 * Shared Type Definitions for Tests
 *
 * This file provides type-safe alternatives to `any` for common test patterns.
 * Using proper types improves test reliability and catches errors at compile time.
 */

import type { SanitizedValue } from "../../enrichment/sanitizer.mjs";

/**
 * Test object for circular reference scenarios.
 * Properties can be either the expected type or the circular reference sentinel.
 */
export interface CircularTestObject {
  name?: string;
  id?: number;
  data?: string;
  password?: string;
  self?: CircularTestObject | string;
  nested?: { circular?: CircularTestObject | string };
  child?: CircularTestObject;
  parent?: CircularTestObject | string;
  ref?: CircularTestObject | string;
  b?: CircularTestObject;
  a?: CircularTestObject | string;
  [key: string]: unknown;
}

/**
 * Error objects with custom properties for testing error sanitization.
 */
export interface TestErrorWithProps extends Error {
  userPassword?: string;
  userId?: string;
  errorCode?: string;
  customProp?: string;
  password?: string;
  apiKey?: string;
  [key: string]: unknown;
}

/**
 * Test user data structure for sanitization tests.
 */
export interface TestUserData {
  username?: string;
  password?: string;
  email?: string;
  apiKey?: string;
  auth_token?: string;
  private_key?: string;
  creditCard?: string;
  ssn?: string;
  normal_field?: string;
  customSecret?: string;
  internalId?: string;
  publicField?: string;
  passwordSettings?: {
    minLength?: number;
    requireNumbers?: boolean;
  };
  user?: string;
  id?: string;
  key?: string;
  userId?: string;
  accountId?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Nested user profile structure for testing deep sanitization.
 */
export interface TestUserProfile {
  user?: {
    profile?: {
      name?: string;
      password?: string;
      preferences?: {
        theme?: string;
        apiKey?: string;
      };
    };
  };
  users?: {
    name?: string;
    password?: string;
  }[];
  level1?: {
    level2?:
      | {
          level3?:
            | {
                value?: string;
              }
            | string;
        }
      | string;
  };
  string?: string;
  number?: number;
  boolean?: boolean;
  null_value?: null;
  array?: string[];
  nested?: {
    apiKey?: string;
  };
  [key: string]: unknown;
}

/**
 * Metric labels structure for testing label sanitization.
 */
export interface TestMetricLabels {
  service?: string;
  version?: string;
  apiKey?: string;
  userPassword?: string;
  endpoint?: string;
  contact_number?: string;
}

/**
 * Type guard to check if a sanitized value is an object.
 * Use this instead of casting with `as any`.
 *
 * @example
 * const result = sanitizer.sanitize(data);
 * if (isSanitizedObject(result)) {
 *   expect(result.password).toBe("[REDACTED]");
 * }
 */
export function isSanitizedObject(
  value: SanitizedValue,
): value is Record<string, SanitizedValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a sanitized value is an array.
 *
 * @example
 * const result = sanitizer.sanitize(data);
 * if (isSanitizedArray(result)) {
 *   expect(result[0].name).toBe("Alice");
 * }
 */
export function isSanitizedArray(
  value: SanitizedValue,
): value is SanitizedValue[] {
  return Array.isArray(value);
}

/**
 * Type guard to check if a sanitized value is a string.
 *
 * @example
 * const result = sanitizer.sanitize(input);
 * if (isSanitizedString(result)) {
 *   expect(result).toContain("[REDACTED]");
 * }
 */
export function isSanitizedString(value: SanitizedValue): value is string {
  return typeof value === "string";
}

/**
 * Service instrument type for testing.
 * Represents the return type of UnifiedObservabilityClient.getServiceInstrumentation()
 *
 * This matches the ScopedInstrument class API from internal/scoped-instrument.mts
 */
export interface ServiceInstrumentType {
  errors: {
    record: (error: Error, context?: Record<string, unknown>) => void;
    capture: (error: Error, context?: Record<string, unknown>) => void;
    recordResult: (result: unknown, context?: Record<string, unknown>) => void;
    categorize: (error: Error) => string;
    wrap: <T extends (...args: unknown[]) => unknown>(
      fn: T,
      options?: {
        retry?: number;
        timeout?: number;
        name?: string;
        captureArgs?: boolean;
      },
    ) => T;
    boundary: <T>(
      fn: () => T | Promise<T>,
      fallback?: (error: Error) => T | Promise<T>,
    ) => Promise<T>;
  };
  metrics: {
    increment: (
      name: string,
      valueOrAttributes?: number | Record<string, unknown>,
      attributes?: Record<string, unknown>,
    ) => void;
    decrement: (
      name: string,
      valueOrAttributes?: number | Record<string, unknown>,
      attributes?: Record<string, unknown>,
    ) => void;
    record: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => void;
    histogram: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => void;
    gauge: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => void;
    timing: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
    timer: (name: string) => { end: (attributes?: Record<string, unknown>) => number };
  };
  traces: {
    // startSpan returns an OTel Span which has chainable methods
    startSpan: (name: string, options?: Record<string, unknown>) => {
      end: () => void;
      // setAttribute returns Span for chaining in OTel, use unknown for flexibility
      setAttribute: (key: string, value: unknown) => unknown;
      setAttributes: (attributes: Record<string, unknown>) => unknown;
      recordException: (error: Error) => void;
      setStatus: (status: { code: number; message?: string }) => unknown;
    };
    getActiveSpan: () => unknown;
    withSpan: <T>(
      name: string,
      fn: () => Promise<T>,
      options?: Record<string, unknown>,
    ) => Promise<T>;
    flush: () => Promise<void>;
  };
  logs: {
    info: (message: string, attributes?: Record<string, unknown>) => void;
    warn: (message: string, attributes?: Record<string, unknown>) => void;
    debug: (message: string, attributes?: Record<string, unknown>) => void;
    error: (message: string, error?: Error, attributes?: Record<string, unknown>) => void;
  };
  result: {
    trace: <T>(
      name: string,
      fn: () => T | Promise<T>,
      options?: Record<string, unknown>,
    ) => Promise<T>;
    metrics: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  };
  raw?: {
    meter: unknown;
    tracer: unknown;
    logger: unknown;
  };
}

/**
 * Error context for browser/node error handlers in tests.
 */
export interface ErrorContext {
  source?: string;
  severity?: string;
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * Browser test configuration handlers.
 */
export interface BrowserTestHandlers {
  errorHandler?: (error: Error, context?: ErrorContext) => void;
  interactionHandler?: (type: string, data?: Record<string, unknown>) => void;
  metricsHandler?: (
    name: string,
    value: number,
    attributes?: Record<string, unknown>,
  ) => void;
}

/**
 * Minimal process stub type for test environments.
 * Methods return the stub for chaining (matching Node.js Process interface).
 */
export interface ProcessStub {
  env: Record<string, string | undefined>;
  listeners: (event: string) => (() => void)[];
  removeListener: (event: string, listener: () => void) => ProcessStub;
  on: (event: string, listener: () => void) => ProcessStub;
  once: (event: string, listener: () => void) => ProcessStub;
  emit: (event: string, ...args: unknown[]) => boolean;
  removeAllListeners: (event?: string) => ProcessStub;
  setMaxListeners: (n: number) => ProcessStub;
  getMaxListeners: () => number;
  eventNames: () => (string | symbol)[];
  listenerCount: (event: string) => number;
  // index signature for NodeJS.Process compatibility
  [key: string]: unknown;
}

/**
 * Creates a minimal process stub for browser environment tests.
 * Returns the stub for direct use or assignment to globalThis.process.
 */
export function createProcessStub(): ProcessStub {
  const stub: ProcessStub = {
    env: {},
    listeners: () => [],
    removeListener() { return stub; },
    on() { return stub; },
    once() { return stub; },
    emit: () => false,
    removeAllListeners() { return stub; },
    setMaxListeners() { return stub; },
    getMaxListeners: () => 10,
    eventNames: () => [],
    listenerCount: () => 0,
  };
  return stub;
}

/**
 * Installs a process stub on globalThis if not present.
 * Safe to call multiple times - only installs once.
 */
export function installProcessStub(): void {
  if (typeof globalThis.process === "undefined") {
    (globalThis as { process?: unknown }).process = createProcessStub();
  }
}

/**
 * Global with process for browser environment tests.
 * @deprecated Use installProcessStub() instead for cleaner type safety.
 */
export type GlobalWithProcess = typeof globalThis & { process?: ProcessStub };

/**
 * Global with window/document for environment simulation.
 */
export interface GlobalWithBrowserGlobals {
  window?: Window | undefined;
  document?: Document | undefined;
  navigator?: Navigator | undefined;
}

/**
 * Unhandled rejection event for browser error tests.
 */
export interface UnhandledRejectionEvent extends Event {
  reason?: unknown;
  promise?: Promise<unknown>;
}

/**
 * Window location mock for browser tests.
 */
export interface MockLocation {
  href?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  origin?: string;
  [key: string]: unknown;
}
