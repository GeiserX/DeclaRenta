import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: false,
    clean: true,
    target: "es2022",
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
  },
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node",
    },
    sourcemap: false,
    target: "node20",
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
  },
]);
