import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "child_process";

function tryExec(cmd: string): string | undefined {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch { return undefined; }
}

// Version: env var (Docker build-arg) → git tag → package.json → "dev"
const version = process.env.APP_VERSION
  ?? tryExec("git describe --tags --abbrev=0")?.replace(/^v/, "")
  ?? process.env.npm_package_version
  ?? "dev";

// Commit hash: env var (Docker build-arg) → git → "dev"
const commitHash = process.env.COMMIT_HASH
  ?? tryExec("git rev-parse --short HEAD")
  ?? "dev";

export default defineConfig({
  root: "src/web",
  publicDir: resolve(__dirname, "src/web/public"),
  base: "/",
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
    // Explicit target (matches tsconfig ES2022). Pins the browser baseline so it
    // doesn't drift with Vite's default, and stops the bundler trying to down-level
    // modern destructuring (from jspdf/jspdf-autotable) to an old target — the
    // failure mode that bit the earlier standalone esbuild bump under Vite 6.
    target: "es2022",
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
