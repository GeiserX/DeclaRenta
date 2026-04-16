import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src/web",
  base: "/DeclaRenta/",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/web/index.html"),
        docs: resolve(__dirname, "src/web/docs.html"),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
