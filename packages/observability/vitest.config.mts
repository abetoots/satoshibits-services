import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // automatic mock cleanup - eliminates need for manual afterEach blocks
    restoreMocks: true, // auto-restore vi.spyOn after each test
    unstubGlobals: true, // auto-unstub vi.stubGlobal after each test
    setupFiles: ["./src/__tests__/test-setup/setup.mts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "src/__tests__/", "*.config.*"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
    projects: [
      // Shared tests (run in Node.js)
      {
        test: {
          name: "shared",
          environment: "node",
          include: [
            "src/__tests__/shared/**/*.test.mts",
            "src/__tests__/gap-validation.test.mts",
          ],
        },
      },
      // Node unit tests
      {
        test: {
          name: "node:unit",
          environment: "node",
          include: [
            "src/__tests__/node/unit/**/*.test.mts",
            "src/__tests__/node/node-*.test.mts",
          ],
          exclude: ["src/__tests__/node/integration/**"],
          env: { OBS_TEST_NO_EXPORT: "1" },
        },
      },
      // Node integration tests (real SDK, no network exporters)
      {
        test: {
          name: "node:integration",
          environment: "node",
          include: ["src/__tests__/node/integration/**/*.test.mts"],
          env: { OBS_TEST_NO_EXPORT: "1" },
        },
      },
      // the 2.0 preset and its test kit: real pipelines, in-process
      {
        test: {
          name: "preset",
          environment: "node",
          include: ["src/__tests__/preset/*.test.mts"],
          // these tests start the real preset in-process; a variable set in the
          // developer's shell or by CI must not change what they see
          setupFiles: ["./src/__tests__/preset/scrub-env.mts"],
        },
      },
      // the preset in child processes. They bind the specification's default
      // port (4318), so the files run one at a time in a single worker.
      {
        test: {
          name: "preset:subprocess",
          environment: "node",
          include: ["src/__tests__/preset/subprocess/*.test.mts"],
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          // a test runs up to three children, each killed by the harness after 20 s; this limit
          // covers two such kills, so a test that runs three relies on its children exiting normally
          testTimeout: 50_000,
        },
      },
    ],
  },
});
