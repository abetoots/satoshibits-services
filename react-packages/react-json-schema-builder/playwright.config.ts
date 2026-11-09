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
  use: { baseURL: "http://localhost:4179" },
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
