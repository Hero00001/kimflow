import { defineConfig } from "vite";

const host = process.env.ELECTRON_DEV_HOST;

export default defineConfig(async () => ({
  // Electron loads packaged pages with file://, so assets must use relative
  // URLs rather than root-relative /assets/... paths.
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        overlay: "src/overlay.html",
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/backend/**", "**/node_modules/**", "**/dist/**"],
    },
  },
}));
