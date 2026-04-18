# Mega PR: Complete Phases 2, 3, 4 of DeclaRenta

**Date:** 2026-04-16
**Base branch:** `main` (v0.4.0, 228 tests passing)
**Target:** Single PR covering all remaining Phase 2, 3, and 4 items
**Estimated version:** v0.5.0 (or v0.8.0 per roadmap Phase 4)

---

## Context

DeclaRenta is a browser-first, privacy-focused tool that converts foreign broker reports into Spanish tax declarations. The core engine (FIFO, ECB rates, dividends, wash-sales, loss carryforward) and 5 broker parsers are complete. This PR adds the remaining fiscal model improvements (D-6 negativa, 720 enhancements, crypto parsers), multi-currency fixes, and the full Phase 4 web UI overhaul (wizard, charts, casilla detail, PWA, i18n, a11y, GitHub Pages deploy).

### Current File Layout

```
src/
  cli/index.ts              CLI entry point (commander)
  engine/                   fifo.ts, ecb.ts, dividends.ts, wash-sale.ts, double-taxation.ts, loss-carryforward.ts, dates.ts
  generators/               report.ts, modelo720.ts, modelo721.ts, d6.ts, pdf.ts, csv.ts
  parsers/                  index.ts (registry), ibkr.ts, degiro.ts, scalable.ts, freedom24.ts, etoro.ts, csv-utils.ts
  types/                    ibkr.ts (FlexStatement, Trade, etc.), broker.ts (BrokerParser), tax.ts, ecb.ts, index.ts
  web/                      main.ts, index.html, style.css
  index.ts                  Public API barrel
tests/                      Mirrors src/ structure
```

### Key Technical Facts

- **BrokerParser interface:** `{ name, formats, detect(input): boolean, parse(input): Statement }` -- all parsers return `FlexStatement` (aliased as `Statement`)
- **FlexStatement** has: `trades`, `cashTransactions`, `corporateActions`, `openPositions`, `securitiesInfo`
- **ECB rates** stored as `Map<date, Map<currency, rate>>` where rate = EUR per 1 FCY
- **FifoEngine** processes trades + corporate actions chronologically, returns `FifoDisposal[]`
- **Web UI** is vanilla TS with Vite, no framework. All state in module-level variables
- **Modelo 720** is fixed-width 500 bytes/record, ISO-8859-15. Record type 1 = summary, type 2 = detail
- **D-6** generates an AFORIX guide (text cheat sheet), not a file upload
- **Modelo 721** has the generator but no crypto parsers to feed it
- **CSS** uses CSS custom properties for theming (dark/light), responsive breakpoints at 1024/768/480
- **CI** runs: typecheck, lint, test:coverage, build:lib on Node 20+22

---

## Work Objectives

1. **Complete all remaining Phase 3 fiscal model items** (D-6 negativa, 720 improvements, crypto parsers, multi-currency)
2. **Build the full Phase 4 web UI** (wizard, casilla detail, charts, year comparison, PWA, a11y, i18n)
3. **Deploy to GitHub Pages** with custom domain `declarenta.es`
4. **Maintain 100% CI green** (typecheck, lint, tests pass throughout)

---

## Guardrails

### Must Have
- `Decimal.js` for ALL monetary calculations (zero raw `Number` for amounts)
- Every new module has corresponding test file with meaningful coverage
- `npm run lint`, `npm run typecheck`, `npm test` pass at every commit
- Zero network calls from web except ECB API
- Spanish as default UI language; all user-facing strings through i18n system
- GPL-3.0 license header awareness (no incompatible deps)
- Keyboard navigable, screen-reader compatible UI elements

### Must NOT Have
- No server-side processing or data upload
- No analytics, tracking, or telemetry
- No `Number` type for monetary values
- No new dependencies with GPL-incompatible licenses (check before adding)
- No breaking changes to CLI interface or public API exports
- No `any` types (strict TypeScript throughout)

---

## Task Flow (Dependency Graph)

```
[1] i18n infrastructure ──────────────────────────────┐
                                                       │
[2] Phase 3: Engine/Generator improvements ────────────┤
    ├─ 2a. D-6 declaracion negativa                    │
    ├─ 2b. 720 threshold per category                  │
    ├─ 2c. 720 Q4 average valuation                    │
    ├─ 2d. 720 BOE record validation                   │
    ├─ 2e. Multi-currency fix (USD bought with GBP)    │
    └─ 2f. Crypto parsers (Coinbase, Binance, Kraken)  │
                                                       │
[3] Web UI: Wizard + Casilla Detail ───────────────────┤ (depends on 1)
                                                       │
[4] Web UI: Charts ────────────────────────────────────┤ (depends on 3)
                                                       │
[5] Web UI: Year-over-year comparison ─────────────────┤ (depends on 3)
                                                       │
[6] PWA + Accessibility + GitHub Pages ────────────────┘ (depends on 1, 3)
```

Steps 2 and 1 can be done in parallel. Steps 3-6 depend on i18n (1) being in place. Step 4 and 5 depend on the wizard (3) being done. Step 6 is the final polish layer.

---

## Detailed TODOs

### Step 1: i18n Infrastructure

**Complexity:** MEDIUM
**New files:**
- `src/i18n/index.ts` -- `t(key, params?)` function, locale detection, locale switching
- `src/i18n/locales/es.ts` -- Spanish strings (default, extracted from current HTML/TS)
- `src/i18n/locales/en.ts` -- English
- `src/i18n/locales/ca.ts` -- Catalan
- `src/i18n/locales/eu.ts` -- Basque
- `src/i18n/locales/gl.ts` -- Galician
- `tests/i18n/i18n.test.ts`

**Modified files:**
- `src/web/main.ts` -- replace all hardcoded Spanish strings with `t()` calls
- `src/web/index.html` -- add language selector in header, `lang` attribute dynamic
- `src/web/style.css` -- style for language selector
- `src/index.ts` -- export i18n module
- `tsconfig.json` -- ensure `src/i18n/` is included

**Design decisions:**
- Simple key-value approach with nested keys: `t("wizard.step1.title")`. No heavy i18n library needed for this scope.
- Locale files are plain TypeScript objects (tree-shakeable, type-safe).
- `t()` function returns string, accepts `Record<string, string>` for interpolation: `t("results.operations_count", { count: "42" })`.
- Default to `es`. Detect from `navigator.language`. Store preference in `localStorage`.
- All 5 locales must have complete key coverage. Type system enforces this: each locale file satisfies the same interface.

**Acceptance criteria:**
- [ ] `t("key")` returns correct string for current locale
- [ ] Switching locale re-renders all visible text
- [ ] All 5 locales compile and have identical key sets (enforced by TypeScript)
- [ ] Existing Spanish UI text is identical after refactor (no regressions)
- [ ] Language preference persists across page reloads

---

### Step 2: Phase 3 Engine and Generator Improvements

**Complexity:** HIGH (6 sub-tasks, each touching different modules)

#### 2a. D-6 Declaracion Negativa

**Modified files:**
- `src/generators/d6.ts` -- add `previousYearPositions` parameter to `generateD6Report()`, generate cancellation entries for ISINs that were held last year but not this year
- `src/types/ibkr.ts` -- no changes needed (uses existing `OpenPosition`)
- `src/cli/index.ts` -- add `--previous-d6 <file>` option to `d6` command
- `tests/generators/d6.test.ts` -- add tests for cancellation records

**Implementation approach:**
- Mirror the 720's A/M/C pattern: accept `previousYearIsins?: string[]` in the D-6 generator.
- Add a new section to the AFORIX guide: "CANCELACIONES" listing ISINs no longer held.
- Add a `cancelled: D6Position[]` field to `D6Report` interface.

**Acceptance criteria:**
- [ ] D-6 report includes cancellation entries for ISINs from previous year not in current positions
- [ ] Guide text clearly marks which positions are cancellations
- [ ] CLI accepts `--previous-d6` flag with JSON of previous year's ISINs
- [ ] Tests cover: no prior positions (all new), mixed (some new, some cancelled), all cancelled

#### 2b. 720 Auto-detect 50,000 EUR Threshold Per Category

**Modified files:**
- `src/generators/modelo720.ts` -- refactor threshold check to work per-category (values, accounts, real estate), not just total. Currently only handles "values" category.

**Implementation approach:**
- Modelo 720 has 3 categories: B (bank accounts), V (values/securities), I (real estate). DeclaRenta only handles V currently.
- The existing threshold check already filters by STK/FUND/BOND (category V). The change is to make this explicit in the API: accept a `category` parameter and return which categories exceed the threshold.
- Add a `checkModelo720Thresholds()` helper function that returns `{ values: boolean, accounts: boolean, realEstate: boolean }` with amounts.

**Acceptance criteria:**
- [ ] `checkModelo720Thresholds()` returns per-category threshold status
- [ ] Generator only includes records for categories exceeding 50K
- [ ] Web UI displays which categories trigger the 720 obligation
- [ ] Tests verify threshold boundary (49,999.99 = no, 50,000.00 = yes)

#### 2c. 720 Q4 Average Valuation

**Modified files:**
- `src/generators/modelo720.ts` -- add `valuationMethod` parameter; for STK, use average of last quarter prices instead of Dec 31 close
- `src/engine/ecb.ts` -- add helper `getQ4AverageRate()` to compute average rate for Oct-Dec

**Implementation approach:**
- Per Ley 19/1991 del Impuesto sobre el Patrimonio Art. 15: listed shares use the average of the last quarter (Q4: Oct 1 - Dec 31).
- ETFs/funds use the NAV at Dec 31 (liquidation value, not market average).
- Need daily Q4 closing prices -- but DeclaRenta does NOT have price data, only the broker's `positionValue` at year-end. The ECB rate conversion is the only rate we control.
- **Practical approach:** For the ECB FX rate component, compute the Q4 average FX rate (average of all daily rates Oct-Dec). For the actual stock price, this requires the user to provide Q4 average prices or accept the broker's Dec 31 value as an approximation.
- Add a `q4AverageRates` parameter computed from the existing rate map. Generate `modelo720` with Q4-averaged EUR values for STK, Dec 31 values for FUND.
- Document the limitation: stock prices are still Dec 31 from the broker; only the FX conversion uses Q4 average.

**Acceptance criteria:**
- [ ] `getQ4AverageRate(rateMap, currency)` returns average of Oct-Dec daily rates
- [ ] STK positions in 720 use Q4 average FX rate for EUR conversion
- [ ] FUND positions still use Dec 31 rate
- [ ] Tests verify Q4 average calculation with known rates
- [ ] Limitation documented in code comments

#### 2d. 720 BOE Record Format Validation

**New files:**
- `src/generators/modelo720-validator.ts` -- validate record structure against BOE spec
- `tests/generators/modelo720-validator.test.ts`

**Implementation approach:**
- Validate each record is exactly 500 bytes
- Validate register type (1 or 2)
- Validate model number (720)
- Validate NIF format (8 digits + letter, or X/Y/Z + 7 digits + letter)
- Validate numeric fields are all digits
- Validate country codes are ISO 3166-1 alpha-2
- Validate ISIN checksum (Luhn on the numeric conversion)
- Return array of validation errors/warnings

**Acceptance criteria:**
- [ ] Validator catches: wrong record length, invalid NIF, bad ISIN checksum, non-numeric in numeric fields
- [ ] Valid records pass with zero errors
- [ ] CLI prints validation results before writing file
- [ ] Web UI shows validation pass/fail when generating 720

#### 2e. Multi-currency Fix

**Modified files:**
- `src/engine/fifo.ts` -- handle case where `trade.currency` differs from the lot's currency (e.g., buy in USD, lot tracked in GBP settlement)
- `src/engine/ecb.ts` -- ensure cross-rate calculation works (GBP -> EUR -> USD)

**Implementation approach:**
- Current code converts everything to EUR using ECB rates, so cross-currency is already implicitly handled at the ECB level. The issue is when a single trade involves paying in GBP for a USD-denominated stock.
- The fix is in `FifoEngine.addLot()`: use the trade's `currency` field for the ECB rate, not the stock's listing currency. The broker reports the trade in the settlement currency.
- Add explicit test cases for: buy AAPL (USD) settled in GBP, then sell in USD.

**Acceptance criteria:**
- [ ] A trade settled in GBP for a USD stock uses GBP ECB rate for cost basis
- [ ] Sale in USD uses USD ECB rate for proceeds
- [ ] Gain/loss correctly reflects both FX conversions
- [ ] Test with synthetic cross-currency scenario

#### 2f. Crypto Parsers (Coinbase, Binance, Kraken)

**New files:**
- `src/parsers/coinbase.ts` -- Coinbase CSV parser
- `src/parsers/binance.ts` -- Binance CSV parser
- `src/parsers/kraken.ts` -- Kraken CSV/ledger parser
- `tests/parsers/coinbase.test.ts`
- `tests/parsers/binance.test.ts`
- `tests/parsers/kraken.test.ts`

**Modified files:**
- `src/parsers/index.ts` -- register 3 new parsers in `brokerParsers` array
- `src/index.ts` -- export new parsers
- `src/cli/index.ts` -- update `modelo721` command to accept crypto exchange CSVs directly
- `src/web/index.html` -- add Coinbase/Binance/Kraken to broker selector dropdown
- `src/web/main.ts` -- handle new parsers in file processing

**Implementation approach:**
- Each crypto parser implements `BrokerParser` and outputs `Modelo721Entry[]` (not `FlexStatement` trades, since crypto doesn't go through FIFO for 721 -- it's a position-at-year-end declaration).
- Need to extend `BrokerParser` interface or add a separate `CryptoParser` interface that returns `Modelo721Entry[]`. **Decision:** Add an optional `parseCrypto?(input: string): Modelo721Entry[]` method to `BrokerParser` to keep it backward-compatible.
- **Coinbase CSV format:** `Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes`
- **Binance CSV format:** Trade History CSV with columns: `Date(UTC),Pair,Side,Price,Executed,Amount,Fee`
- **Kraken CSV format:** Ledger CSV with columns: `txid,refid,time,type,subtype,aclass,asset,amount,fee,balance`
- For 721 purposes: aggregate holdings at Dec 31 by asset, compute EUR value using ECB rates (for fiat pairs) or market prices (which the user must provide for crypto/EUR -- limitation to document).

**Acceptance criteria:**
- [ ] Each parser detects its format via `detect()` and returns parsed data
- [ ] Coinbase parser handles buy, sell, send, receive transaction types
- [ ] Binance parser handles spot trades from Trade History CSV
- [ ] Kraken parser handles ledger entries (deposit, withdrawal, trade, staking)
- [ ] All three produce `Modelo721Entry[]` for the 721 generator
- [ ] CLI `modelo721` command works end-to-end with each exchange's CSV
- [ ] Web UI shows crypto exchanges in broker selector
- [ ] Tests use synthetic fixtures (no real user data)

---

### Step 3: Web UI Wizard + Casilla Detail View

**Complexity:** HIGH
**Modified files:**
- `src/web/main.ts` -- major refactor: extract rendering into modules, implement wizard state machine
- `src/web/index.html` -- restructure into wizard steps with navigation
- `src/web/style.css` -- wizard step indicators, progress bar, casilla expandable rows, transitions

**New files:**
- `src/web/wizard.ts` -- wizard state machine (steps, navigation, validation per step)
- `src/web/render-results.ts` -- extract result rendering from main.ts
- `src/web/render-casillas.ts` -- casilla detail view with expandable breakdown
- `src/web/render-tables.ts` -- extract table rendering (operations, dividends)

**Implementation approach:**

**Wizard flow (6 steps):**
1. **Choose broker(s)** -- broker selector cards (instead of dropdown), multi-select allowed
2. **Upload files** -- drop zone with per-broker file expectations, file validation
3. **Review data** -- summary of detected trades/dividends/positions before processing
4. **Configure** -- NIF, year, name, prior losses file, 720 previous year ISINs
5. **Results** -- casillas, operations table, dividends table, charts
6. **Download** -- JSON, CSV, PDF, 720 file, D-6 guide, 721 file (whichever apply)

**Casilla detail view:**
- Each casilla row in the results section becomes expandable (click to expand)
- Casilla 0327 expands to show all sell operations that compose it
- Casilla 0328 expands to show all cost basis entries
- Casilla 0029 expands to show all dividend entries
- Casilla 0588 expands to show double taxation breakdown by country
- Use `<details>/<summary>` for progressive disclosure (semantic, accessible)

**State management:**
- Simple state object: `{ step: number, brokers: string[], files: File[], config: {...}, report: TaxSummary | null }`
- Each step renders its own section, hides others
- "Siguiente" / "Anterior" buttons with validation before advancing

**Acceptance criteria:**
- [ ] Wizard navigates forward/backward through all 6 steps
- [ ] Cannot advance past upload step without at least one file
- [ ] Cannot advance past configure step without year selected
- [ ] Results step shows all casilla data identical to current flat view
- [ ] Each casilla row is expandable with operation-level breakdown
- [ ] All text uses `t()` from i18n system
- [ ] Responsive: wizard works on mobile (stacked layout)
- [ ] Back button preserves entered data (no data loss on navigation)

---

### Step 4: Charts

**Complexity:** MEDIUM
**New files:**
- `src/web/charts.ts` -- chart rendering module

**Modified files:**
- `src/web/render-results.ts` -- integrate charts section
- `src/web/style.css` -- chart container styles
- `package.json` -- no new dependency (use Canvas API or lightweight SVG)

**Implementation approach:**
- **No heavy charting library.** Use inline SVG generation for:
  1. **Asset distribution** -- donut/pie chart by asset category (STK, FUND, OPT)
  2. **G/P by month** -- bar chart, one bar per month, green/red
  3. **Currency composition** -- donut chart by currency (USD, EUR, GBP, etc.)
  4. **Withholdings by country** -- horizontal bar chart
- Each chart is a function that takes data and returns an SVG string
- Charts section sits between casillas and operations table in results step
- All chart labels use `t()` for i18n

**Acceptance criteria:**
- [ ] 4 charts render correctly with sample data
- [ ] Charts are responsive (SVG viewBox scales)
- [ ] Charts use theme colors (CSS custom properties)
- [ ] Zero external dependencies for charting
- [ ] Charts handle edge cases: single asset, no dividends, single currency

---

### Step 5: Year-over-Year Comparison

**Complexity:** LOW-MEDIUM
**New files:**
- `src/web/comparison.ts` -- comparison rendering module

**Modified files:**
- `src/web/wizard.ts` -- allow processing multiple years (upload files for different years)
- `src/web/render-results.ts` -- add comparison tab/section
- `src/web/style.css` -- comparison table styles

**Implementation approach:**
- If the user processes multiple years (e.g., upload 2024 + 2025 files), show a comparison table:
  - Side-by-side casilla values
  - Delta column (absolute + percentage change)
  - Color coding: green for improvement, red for deterioration
- Store previous year's `TaxSummary` in memory (not persisted -- privacy)
- Simple table layout, no complex visualization needed

**Acceptance criteria:**
- [ ] When 2+ years are processed, comparison section appears
- [ ] Shows key metrics side by side: net gain/loss, dividends, double taxation
- [ ] Delta column shows both absolute and percentage change
- [ ] Works with any combination of years (not just consecutive)

---

### Step 6: PWA + Accessibility + GitHub Pages Deploy

**Complexity:** MEDIUM

#### 6a. PWA (Service Worker)

**New files:**
- `src/web/sw.ts` -- service worker for offline caching
- `src/web/manifest.json` -- PWA manifest

**Modified files:**
- `src/web/index.html` -- register service worker, add manifest link, meta tags
- `vite.config.ts` -- configure service worker build

**Implementation approach:**
- Cache-first strategy for static assets (HTML, CSS, JS)
- Network-first for ECB API calls (with stale fallback)
- Simple service worker using the Cache API directly (no Workbox needed for this scope)
- Manifest with `display: standalone`, Spanish locale, DeclaRenta icons
- Note: need to create icon assets (SVG + PNG at 192px and 512px)

**Acceptance criteria:**
- [ ] App loads offline after first visit (all static assets cached)
- [ ] ECB rates fall back to cached version if offline
- [ ] "Install app" prompt appears on supported browsers
- [ ] Lighthouse PWA score >= 90

#### 6b. WCAG 2.1 AA Accessibility

**Modified files:**
- `src/web/index.html` -- ARIA landmarks, roles, labels
- `src/web/style.css` -- focus indicators, contrast ratios, skip-to-content link
- `src/web/main.ts` (and extracted modules) -- keyboard navigation, aria-live regions for dynamic content
- `src/web/wizard.ts` -- focus management on step transitions

**Implementation approach:**
- Add `role="main"`, `role="navigation"`, `aria-label` to all sections
- Ensure all interactive elements are keyboard-reachable (tab order)
- Add visible focus indicators (outline) that respect theme
- Use `aria-live="polite"` for dynamic content updates (processing status, results)
- Ensure all form controls have associated `<label>` elements
- Check color contrast ratios meet 4.5:1 for text, 3:1 for large text
- Add skip-to-content link
- Wizard steps announced via `aria-current="step"`

**Acceptance criteria:**
- [ ] Tab through entire wizard without getting stuck
- [ ] Screen reader announces step changes and results updates
- [ ] All form inputs have visible labels
- [ ] Focus visible on all interactive elements
- [ ] Color contrast passes WCAG 2.1 AA (4.5:1 minimum)
- [ ] Skip-to-content link present

#### 6c. GitHub Pages Deploy

**New files:**
- `.github/workflows/deploy.yml` -- GitHub Actions workflow for Pages deploy
- `CNAME` file in web build output for custom domain

**Modified files:**
- `vite.config.ts` -- set `base` for GitHub Pages path

**Implementation approach:**
- GitHub Actions workflow: on push to main, build web, deploy to `gh-pages` branch
- Custom domain `declarenta.es` via CNAME file in build output
- Vite `base: '/'` since custom domain is root
- DNS: user must configure `declarenta.es` A record to GitHub Pages IPs (185.199.108-111.153) and CNAME `www` -> `geiserx.github.io`

**Acceptance criteria:**
- [ ] Push to main triggers automatic deploy
- [ ] `declarenta.es` serves the web UI
- [ ] HTTPS works (GitHub Pages auto-cert for custom domains)
- [ ] All routes work (SPA fallback if needed -- but this is a single page, so not an issue)

---

## Suggested Commit Strategy

These are logical commits within the single PR, ordered by dependency:

| # | Commit | Files touched | Tests added |
|---|--------|---------------|-------------|
| 1 | `feat(i18n): add internationalization infrastructure with 5 locales` | i18n/, web/main.ts, web/index.html | i18n.test.ts |
| 2 | `feat(d6): support declaracion negativa (position cancellations)` | generators/d6.ts, cli/index.ts | d6.test.ts |
| 3 | `feat(720): per-category 50K threshold detection` | generators/modelo720.ts | modelo720.test.ts |
| 4 | `feat(720): Q4 average FX rate for stock valuation` | generators/modelo720.ts, engine/ecb.ts | modelo720.test.ts, ecb.test.ts |
| 5 | `feat(720): BOE record format validation` | generators/modelo720-validator.ts | modelo720-validator.test.ts |
| 6 | `fix(fifo): handle multi-currency trades (USD stock settled in GBP)` | engine/fifo.ts | fifo.test.ts |
| 7 | `feat(parsers): add Coinbase CSV parser for Modelo 721` | parsers/coinbase.ts | coinbase.test.ts |
| 8 | `feat(parsers): add Binance CSV parser for Modelo 721` | parsers/binance.ts | binance.test.ts |
| 9 | `feat(parsers): add Kraken CSV/ledger parser for Modelo 721` | parsers/kraken.ts | kraken.test.ts |
| 10 | `feat(web): refactor UI into wizard multi-step flow` | web/wizard.ts, web/main.ts, web/index.html, web/style.css | -- |
| 11 | `feat(web): add casilla detail view with expandable breakdowns` | web/render-casillas.ts, web/style.css | -- |
| 12 | `feat(web): add SVG charts (asset dist, G/P by month, currency, withholdings)` | web/charts.ts, web/style.css | -- |
| 13 | `feat(web): add year-over-year comparison view` | web/comparison.ts | -- |
| 14 | `feat(web): add PWA support (service worker, manifest, offline)` | web/sw.ts, web/manifest.json, vite.config.ts | -- |
| 15 | `feat(web): WCAG 2.1 AA accessibility improvements` | web/*.ts, web/index.html, web/style.css | -- |
| 16 | `feat(deploy): GitHub Pages with custom domain declarenta.es` | .github/workflows/deploy.yml, vite.config.ts | -- |

---

## Risk Areas and Mitigations

### HIGH RISK

1. **Web UI wizard refactor is the biggest risk.** `src/web/main.ts` is 461 lines of tightly coupled rendering. Extracting into modules while maintaining all current functionality requires careful testing.
   - **Mitigation:** Extract rendering functions first (commit 10), then add wizard on top. Test manually at each sub-step. Keep the old flat rendering as a fallback path initially.

2. **i18n retrofitting all hardcoded strings.** Missing a string or breaking interpolation silently produces broken UI.
   - **Mitigation:** TypeScript-enforced locale interface ensures all keys exist. Extract strings methodically from HTML first, then from TS.

3. **Crypto parsers without real data.** Exchange CSV formats change frequently and may have undocumented variations.
   - **Mitigation:** Document known CSV column layouts in code comments. Build parsers defensively with clear error messages for unexpected formats. Mark as "beta" in UI.

### MEDIUM RISK

4. **720 Q4 average valuation limitation.** We can average the FX rate but NOT the stock prices (we lack historical price data).
   - **Mitigation:** Document this clearly. The FX average is the main value-add. Stock prices from the broker's year-end report are the best available without adding a price API.

5. **Service worker caching can cause stale deployments.**
   - **Mitigation:** Version the service worker cache name. Use `skipWaiting()` + `clients.claim()` pattern. Cache bust on new deployments.

6. **GitHub Pages custom domain DNS propagation** -- out of our control.
   - **Mitigation:** Deploy workflow works with both `geiserx.github.io/DeclaRenta` and `declarenta.es`. Document DNS setup in README.

### LOW RISK

7. **Multi-currency fix** is a targeted change in the FIFO engine. Well-covered by existing test infrastructure.

8. **D-6 negativa** mirrors the existing 720 A/M/C pattern closely. Low risk of breakage.

9. **720 BOE validator** is a pure function with no side effects. Easy to test.

---

## New Dependencies Assessment

| Package | Purpose | License | Needed? |
|---------|---------|---------|---------|
| None | Charts via inline SVG | -- | No library needed |
| None | i18n via plain TS objects | -- | No library needed |
| None | PWA via raw Service Worker API | -- | No library needed |

**Zero new runtime dependencies.** This is deliberate to keep the bundle small and avoid license complications.

---

## Success Criteria

- [ ] All 228+ existing tests still pass
- [ ] 40+ new tests added (targeting 270+ total)
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] Web UI wizard flow works end-to-end: upload file -> review -> configure -> results -> download
- [ ] Each casilla is expandable with operation breakdown
- [ ] 4 charts render in results view
- [ ] All 5 locales work and can be switched
- [ ] Tab/keyboard navigation works through entire wizard
- [ ] PWA installs and works offline (after initial load)
- [ ] GitHub Pages deploy workflow passes
- [ ] D-6 negativa generates cancellation entries correctly
- [ ] 720 validates against BOE format spec
- [ ] At least one crypto parser works end-to-end with modelo721 command
