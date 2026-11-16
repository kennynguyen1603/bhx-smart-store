import { defineConfig, devices } from "@playwright/test";

// These component regressions bundle the real UI without an app server or database.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "admin-foundation.spec.ts",
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome" },
});
