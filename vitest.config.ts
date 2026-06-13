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
      // What counts toward coverage. Kept to code that is unit-testable WITHOUT a
      // full jsdom/browser harness so the numbers reflect logic we actually
      // exercise, not unreachable DOM glue. The narrow original list
      // (engine/generators/parsers/i18n) hid real gaps in the pure web helpers,
      // which DO have tests but were never measured.
      include: [
        "src/engine/**",
        "src/generators/**",
        "src/parsers/**",
        "src/i18n/**",
        // Pure web helpers — no DOM, no localStorage, no network. Each returns
        // data or an HTML string and is unit-tested directly (see tests/web/).
        "src/web/esc.ts", // HTML-escaper (XSS) — tests/web/esc.test.ts
        "src/web/validation.ts", // post-parse sanity checks + issue rendering — tests/web/validation.test.ts
        "src/web/asset-labels.ts", // canonical asset-category label map — tests/web/asset-labels.test.ts
        "src/web/format.ts", // Spanish number formatting (fmtEur) — tests/web/format.test.ts
        "src/web/charts.ts", // pure SVG/data extraction (extractChartData) — tests/web/charts.test.ts
        "src/web/operations-annex.ts", // operations annex data builder (pure)
        "src/web/detection-cache.ts", // broker-detection cache resolution (pure) — tests/web/detection-cache.test.ts
      ],
      // Deliberately EXCLUDED — DOM/browser-bound entry points and renderers that
      // read/write document, window, localStorage, or attach event listeners.
      // Unit-testing them would require standing up a jsdom harness with a built
      // DOM tree (out of scope here); counting them would only depress coverage
      // with code that has no pure surface to assert against. Their pure
      // sub-logic already lives in the included modules above (e.g. crypto-rate
      // parsing is in src/engine/manual-rates.ts, which IS measured).
      exclude: [
        "src/web/main.ts", // app bootstrap, splash, wizard orchestration, file upload (heavy DOM)
        "src/web/section-720.ts", // Modelo 720 DOM renderer
        "src/web/section-721.ts", // Modelo 721 DOM renderer
        "src/web/section-d6.ts", // Modelo D-6 DOM renderer
        "src/web/section-guide.ts", // broker-guide section DOM renderer
        "src/web/sidebar.ts", // hash routing + sidebar DOM toggling
        "src/web/profile.ts", // fiscal-profile form (DOM + localStorage)
        "src/web/broker-guides.ts", // broker card grid + guides (DOM)
        "src/web/casilla-detail.ts", // expandable casilla cards (innerHTML + listeners)
        "src/web/wizard.ts", // 3-step wizard DOM flow
        "src/web/year-compare.ts", // year-over-year compare (DOM + localStorage)
        "src/web/manual-rates.ts", // crypto-rates panel (DOM + localStorage); validation lives in src/engine/manual-rates.ts
        "src/web/storage.ts", // localStorage persistence wrappers
        "src/web/clipboard.ts", // navigator.clipboard wrapper
        "src/web/disclaimer.ts", // legal disclaimer modal (DOM)
        "src/web/env.d.ts", // ambient type declarations (no runtime code)
      ],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
