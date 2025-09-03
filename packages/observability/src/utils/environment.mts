/* eslint-disable @typescript-eslint/no-empty-function */
/**
 * Environment detection utilities
 *
 * Provides reliable detection of runtime environment (Node.js vs Browser)
 * to enable the unified SmartClient API.
 */

// Declare non-standard or environment-specific globals to make TypeScript aware of them.
// This provides type safety without relying on `any` or disabling lint rules.
declare const Deno: { version?: { deno?: string } } | undefined;

/**
 * Detect the current runtime environment
 */
export function detectEnvironment(): "browser" | "node" | "unknown" {
  // Check for browser environment (including test environments with jsdom)
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }

  // Check for web workers (browser without window)
  // Use 'importScripts' in self to check for Web Worker environment
  if (
    typeof self !== "undefined" &&
    typeof self === "object" &&
    self !== null &&
    "importScripts" in self
  ) {
    return "browser";
  }

  // Check for test environments that might have navigator but no window
  if (typeof navigator !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }

  // Check for Node.js environment
  if (typeof process !== "undefined" && process.versions?.node) {
    return "node";
  }

  // Check for Deno
  // using optional chaining handles undefined gracefully
  if (Deno?.version?.deno) {
    return "node"; // Treat Deno as Node-like for now
  }

  // Fallback: if we have global but not window/process, assume Node-like
  if (typeof global !== "undefined" && typeof window === "undefined") {
    return "node";
  }

  // Last resort: default to browser for unknown environments
  // This helps with test environments that might not perfectly simulate either
  return "browser";
}

/**
 * Check if running in a browser environment
 */
export function isBrowser(): boolean {
  return detectEnvironment() === "browser";
}

/**
 * Check if running in a Node.js environment
 */
export function isNode(): boolean {
  return detectEnvironment() === "node";
}

/**
 * Get environment-specific global object
 */
export function getGlobalObject() {
  if (isBrowser()) {
    return typeof window !== "undefined" ? window : self;
  }
  if (isNode()) {
    return global;
  }
  // Fallback
  return typeof globalThis !== "undefined" ? globalThis : {};
}

/**
 * Safe access to process.env (returns empty object in browser)
 */
export function getProcessEnv(): Record<string, string | undefined> {
  if (isNode() && typeof process !== "undefined" && process.env) {
    return process.env;
  }
  return {};
}

/**
 * Process-like interface for cross-platform compatibility
 */
interface ProcessLike {
  env: Record<string, string | undefined>;
  versions: Record<string, string>;
  platform: string;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  once: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener: (...args: unknown[]) => void) => void;
  exit: (code?: number) => void;
  nextTick: (callback: () => void) => void;
}

/**
 * Safe access to process (returns mock in browser)
 */
export function getProcess(): ProcessLike {
  if (isNode() && typeof process !== "undefined") {
    return process as ProcessLike;
  }

  // Return a mock process for browser
  return {
    env: {},
    versions: {},
    platform: "browser",
    on: () => {}, // no-op
    once: () => {}, // no-op
    off: () => {}, // no-op
    exit: () => {}, // no-op
    nextTick: (cb: () => void) => setTimeout(cb, 0),
  };
}

/**
 * Environment-specific configuration defaults
 */
// (Removed getEnvironmentDefaults: unused and undocumented)
