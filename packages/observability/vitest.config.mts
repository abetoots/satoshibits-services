import { defineConfig } from "vitest/config";

const useBrowserRunner = process.env.USE_VITEST_BROWSER === "1";

export default defineConfig({
  test: {
    globals: true,
    // automatic mock cleanup - eliminates need for manual afterEach blocks
    restoreMocks: true, // auto-restore vi.spyOn after each test
    unstubGlobals: true, // auto-unstub vi.stubGlobal after each test
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
      {
        test: {
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
          environment: "node",
          include: ["src/__tests__/node/**/*.test.mts"],
          exclude: ["src/__tests__/node/integration/**"],
          env: { OBS_TEST_NO_EXPORT: "1" },
        },
      },
      // Node integration tests (real SDK, no network exporters)
      {
        test: {
          environment: "node",
          include: [
            "src/__tests__/node/integration/**/*.test.mts",
            "src/__tests__/integration/**/*.test.mts",
          ],
          env: { OBS_TEST_NO_EXPORT: "1" },
        },
      },

      useBrowserRunner
        ? {
            test: {
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
