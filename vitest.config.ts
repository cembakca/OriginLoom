import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
      "@server": resolve(__dirname, "server"),
    },
  },
  test: {
    globalSetup: ["./tests/global-setup.mjs"],
    setupFiles: ["./tests/setup-runtime.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["server/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
      thresholds: {
        statements: 76,
        branches: 71,
        functions: 75,
        lines: 79,
      },
    },
  },
});
