import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 30_000,
    include: [
      "tests/e2e/**/*.e2e.test.ts",
      "tests/e2e/lib/harness.self.test.ts",
    ],
  },
});
