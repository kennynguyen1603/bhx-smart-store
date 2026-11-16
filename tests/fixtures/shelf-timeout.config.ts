import { defineConfig } from "@playwright/test";

// Invoked only by the parent regression, which owns the local server.
export default defineConfig({
  testDir: ".",
  testMatch: "shelf-timeout-probe.ts",
  workers: 1,
  retries: 0,
  reporter: "json",
  outputDir: "../../test-results/shelf-timeout-probe",
  use: { baseURL: process.env.NEXTAUTH_URL || "http://localhost:3000", channel: process.env.CI ? undefined : "chrome" },
});
