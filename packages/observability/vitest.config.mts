import { defineConfig } from "vitest/config";

const useBrowserRunner = process.env.USE_VITEST_BROWSER === "1";

export default defineConfig({
  // pre-bundle zone.js to prevent vite reloading during tests
  optimizeDeps: {
    include: ["zone.js"],
  },
  test: {
    globals: true,
    // automatic mock cleanup - eliminates need for manual afterEach blocks
    restoreMocks: true, // auto-restore vi.spyOn after each test
    unstubGlobals: true, // auto-unstub vi.stubGlobal after each test
    // note: zone.js must load before any SDK modules, so it's in global setup
    // the setup file conditionally loads zone.js only in browser environments
    setupFiles: [
      "./src/__tests__/test-setup/setup.mts",
      "./src/__tests__/test-setup/vitest-browser-setup.mts",
    ],
    globalSetup: ["./src/__tests__/test-setup/global-setup.mts"],
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
            "src/__tests__/readme-examples.test.mts",
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
          testTimeout: 30_000,
        },
      },

      // Browser tests
      useBrowserRunner
        ? {
            test: {
              name: "browser",
              browser: {
                provider: "playwright",
                enabled: true,
                name: process.env.VITEST_BROWSER_NAME ?? "chromium",
                headless: true,
                screenshotFailures: false,
              },
              include: [
                "src/__tests__/browser/**/*.test.mts",
                // also run api-parity tests in browser for true cross-environment testing
                "src/__tests__/shared/api-parity.test.mts",
              ],
            },
          }
        : {
            test: {
              name: "browser",
              environment: "jsdom",
              include: [
                "src/__tests__/browser/**/*.test.mts",
                // also run api-parity tests in browser for true cross-environment testing
                "src/__tests__/shared/api-parity.test.mts",
              ],
              pool: "forks",
            },
          },
    ],
  },
});
