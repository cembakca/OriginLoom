import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*/vitest.config.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "apps/showroom/server/**/*.{ts,tsx}",
        "apps/showroom/src/**/*.{ts,tsx}",
        "packages/*/src/**/*.{ts,tsx}",
      ],
      thresholds: {
        statements: 76,
        branches: 71,
        functions: 75,
        lines: 79,
      },
    },
  },
});
