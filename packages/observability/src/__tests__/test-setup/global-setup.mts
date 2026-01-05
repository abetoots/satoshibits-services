/**
 * Global setup for Vitest workers.
 * Provides a minimal `process` object when missing (e.g., jsdom workers)
 * so Vitest internals that call process.listeners() do not crash.
 * This is test-only and does not affect production bundles.
 */

import { createProcessStub } from "../test-utils/test-types.mjs";

export default function () {
  if (typeof globalThis.process === "undefined") {
    // use shared ProcessStub from test-types to avoid duplication
    globalThis.process = createProcessStub() as unknown as NodeJS.Process;
  }
}
