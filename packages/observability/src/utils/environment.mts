/* eslint-disable @typescript-eslint/no-empty-function */
/**
 * Environment detection utilities
 *
 * Provides detection of the runtime environment for the SmartClient API.
 */

// Declare non-standard or environment-specific globals to make TypeScript aware of them.
// This provides type safety without relying on `any` or disabling lint rules.
declare const Deno: { version?: { deno?: string } } | undefined;

/**
 * Detect the current runtime environment. Node.js is the only runtime the
 * library supports: the browser entry was removed in 2.0.0.
 */
export function detectEnvironment(): "node" | "unknown" {
  // Check for Node.js environment
  if (typeof process !== "undefined" && process.versions?.node) {
    return "node";
  }

  // Check for Deno
  // using optional chaining handles undefined gracefully
  if (Deno?.version?.deno) {
    return "node"; // Treat Deno as Node-like for now
  }

  // Fallback: a runtime with `global` is Node-like
  if (typeof global !== "undefined") {
    return "node";
  }

  return "unknown";
}

/**
 * Check if running in a Node.js environment
 */
export function isNode(): boolean {
  return detectEnvironment() === "node";
}

/**
 * Safe access to process.env (returns an empty object outside Node.js)
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
 * Safe access to process (returns a mock outside Node.js)
 */
export function getProcess(): ProcessLike {
  if (isNode() && typeof process !== "undefined") {
    return process as ProcessLike;
  }

  // Return a mock process for a runtime without one
  return {
    env: {},
    versions: {},
    platform: "unknown",
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
