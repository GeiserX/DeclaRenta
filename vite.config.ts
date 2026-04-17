import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "child_process";

const version = process.env.npm_package_version ?? "dev";
let commitHash = "dev";
try {
  commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch { /* not in git repo */ }

export default defineConfig({
  root: "src/web",
  base: "/DeclaRenta/",
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
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
