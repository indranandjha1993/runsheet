import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The console and the driver app are one build. Locally, every call to the platform is proxied
// to the gateway so the browser never needs a cross-origin allowance.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env["PORT_WEB"] ?? 14100),
    proxy: {
      "/v1": process.env["GATEWAY_URL"] ?? "http://localhost:14000",
      "/track": process.env["GATEWAY_URL"] ?? "http://localhost:14000",
      "/health": process.env["GATEWAY_URL"] ?? "http://localhost:14000",
    },
  },
  build: { outDir: "dist", sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
