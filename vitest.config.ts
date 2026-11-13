import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
      env: { DATABASE_URL: env.DATABASE_URL },
      exclude: ["tests/e2e/**", "node_modules/**"],
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
