import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    // The PDF suites (jsPDF/PDFKit) do a CPU-heavy cold-start font/module init on
    // their first generate call (~13s wall-clock cold). On a loaded shared CI
    // runner that first call can exceed vitest's 5s default, flaking the run and
    // blocking the release (e.g. pdf-web "returns a Blob" timed out at 5000ms on
    // main while passing on the PR branch and locally). Real tests finish in ms;
    // a 20s floor only ever absorbs cold-start/contention, never masks a hang.
    testTimeout: 20_000,
    define: {
      __APP_VERSION__: JSON.stringify("test"),
      __COMMIT_HASH__: JSON.stringify("test"),
    },
    coverage: {
      provider: "v8",
      include: ["src/engine/**", "src/generators/**", "src/parsers/**", "src/i18n/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
