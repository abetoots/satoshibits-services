import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/css",
  // the default testMatch ignores .pw.ts
  testMatch: "**/*.pw.ts",
  // outside the package so tailwind never scans the results
  outputDir: path.join(os.tmpdir(), "rjsb-playwright-results"),
  // never reuse a server: a stray one on the port would be tested by mistake
  webServer: {
    command: "pnpm exec vite --port 4179 --strictPort",
    url: "http://localhost:4179/render-harness.html",
    reuseExistingServer: false,
  },
  // ci keeps a trace of each failed test (dom, focus, console, timing) for the uploaded artifact
  use: { baseURL: "http://localhost:4179", trace: process.env.CI ? "retain-on-failure" : "off" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
      },
    },
  ],
});
