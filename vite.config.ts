import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => ({
  // Vitest runs pure logic in node; the Cloudflare plugin is only needed for dev/build.
  plugins: mode === "test" ? [] : [react(), cloudflare()],
  server: {
    port: 3000,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
}));
