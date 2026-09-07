import { defineConfig } from "vitest/config";

const shared = ["**/node_modules/**", "**/dist/**"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "platform",
          environment: "node",
          include: [
            "packages/**/*.test.ts",
            "services/**/*.test.ts",
            "contracts/**/*.test.ts",
            "api/**/*.test.ts",
            "spec/**/*.test.ts",
            "apps/driver/**/*.test.ts",
          ],
          exclude: shared,
        },
      },
      {
        // The web app renders into a document, so its tests run in a browser-like environment.
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
          exclude: shared,
          setupFiles: ["./apps/web/src/test-setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      include: ["packages/**/src/**/*.ts", "services/**/src/**/*.ts", "contracts/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts", "**/test-doubles.ts", "**/main.ts"],
    },
  },
});
