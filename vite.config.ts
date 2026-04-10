import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src/web",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/web"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
