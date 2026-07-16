import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["server/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/lib/analytics/**", "src/lib/query/**", "src/lib/stores/**"],
      thresholds: { lines: 60, functions: 60, statements: 60, branches: 55 },
    },
  },
  resolve: {
    alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") },
  },
});
