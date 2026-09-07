import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "services/**/*.test.ts", "contracts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      include: ["packages/**/src/**/*.ts", "services/**/src/**/*.ts", "contracts/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts", "**/test-doubles.ts", "**/main.ts"],
    },
  },
});
