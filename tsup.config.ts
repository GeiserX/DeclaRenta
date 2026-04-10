import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
  },
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node",
    },
    sourcemap: true,
    target: "node20",
  },
]);
