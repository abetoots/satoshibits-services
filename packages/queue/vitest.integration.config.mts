import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.mts"],
    globals: true,
    testTimeout: 30000, // integration tests may take longer
    hookTimeout: 30000,
    teardownTimeout: 30000,
    // run tests sequentially to avoid race conditions with shared infrastructure
    fileParallelism: false,
    // each file runs its tests sequentially
    sequence: {
      shuffle: false,
    },
  },
});
