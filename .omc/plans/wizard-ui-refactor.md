# Plan: Multi-Step Wizard UI + Expandable Casillas + Year Comparator

> Created: 2026-04-16
> Scope: Web UI professional refactor (ROADMAP Phase 4)
> Estimated complexity: HIGH (6 tasks, ~15 files touched/created)

---

## Context

The current web UI (`src/web/main.ts`, 530 lines) is a monolithic single-page app with three hidden sections that reveal progressively. The ROADMAP Phase 4 calls for a "wizard multi-paso" experience. This plan refactors the UI into a true multi-step wizard where only one step is visible at a time, adds expandable casilla cards with drill-down, and introduces a year-over-year comparison feature backed by localStorage persistence.

**Current state:**
- `src/web/main.ts` (530 lines) — all upload, config, processing, rendering logic in one file
- `src/web/index.html` (104 lines) — all sections defined statically
- `src/web/style.css` (692 lines) — flat styling, no wizard/step concepts
- `src/web/charts.ts` (252 lines) — SVG chart generators (standalone, clean API)
- `src/web/disclaimer.ts` (50 lines) — modal component (standalone)
- i18n: 5 locales, ~90 keys each in `src/i18n/locales/{es,en,ca,eu,gl}.ts`

**Target state:**
- Wizard with 4 steps: Upload -> Review -> Configure -> Results
- Each step is a standalone module in `src/web/steps/`
- Shared wizard shell with progress indicator and back/forward navigation
- Expandable casilla cards (click to drill down into contributing operations)
- Year comparator (localStorage persistence, comparison view for 2+ years)
- `main.ts` reduced to ~80 lines (wizard bootstrap + theme/i18n init)

---

## Guardrails

### Must Have
- All existing functionality preserved (no regression)
- Only one step visible at a time; back/forward navigation between steps
- Step indicator at top showing current position (1 of 4)
- Keyboard navigation (Enter/Tab) works on step transitions
- All new UI text added to all 5 locale files
- Charts, disclaimer, theme toggle, language selector continue working
- Existing tests pass without modification

### Must NOT Have
- No new npm dependencies (use vanilla TS + existing Decimal.js)
- No router library or URL hash routing (keep it simple, single-page)
- No breaking changes to the engine, parsers, generators, or types
- No changes to CLI behavior
- No removal of existing export buttons (JSON, CSV)

---

## Task Flow

```
Task 1 (wizard shell + step modules)
  |
  v
Task 2 (step 1: upload + step 2: review)
  |
  v
Task 3 (step 3: configure + step 4: results with expandable casillas)
  |
  v
Task 4 (year comparator with localStorage)
  |
  v
Task 5 (i18n: add new keys to all 5 locales)
  |
  v
Task 6 (CSS: wizard styles, step transitions, expandable cards)
```

Tasks 5 and 6 can partially overlap with Tasks 2-4 (add keys/styles as each step is built), but final pass ensures completeness.

---

## Detailed TODOs

### Task 1: Wizard Shell + Module Skeleton

**Goal:** Create the wizard infrastructure that manages step navigation, then stub out each step module.

**Files to create:**
- `src/web/steps/types.ts` — shared WizardStep interface and WizardState type
- `src/web/wizard.ts` — WizardController class (manages current step, navigation, progress indicator rendering)
- `src/web/steps/step-upload.ts` — stub (step 1)
- `src/web/steps/step-review.ts` — stub (step 2)
- `src/web/steps/step-config.ts` — stub (step 3)
- `src/web/steps/step-results.ts` — stub (step 4)

**Files to modify:**
- `src/web/index.html` — replace the 3 static sections with a single `<div id="wizard-container">` and a `<div id="step-content">`. Keep header, footer, top-bar (theme/lang) unchanged.
- `src/web/main.ts` — gut the monolith. Keep only: i18n init, theme toggle, locale change listener, wizard bootstrap (`new WizardController().start()`). Target: ~80 lines.

**WizardStep interface:**
```ts
interface WizardStep {
  readonly id: string;
  readonly titleKey: string;  // i18n key for step label in progress bar
  render(container: HTMLElement): void;
  destroy(): void;
  canAdvance(): boolean;      // validation gate before moving forward
}
```

**WizardController responsibilities:**
- Maintains array of WizardStep instances and current index
- Renders progress indicator: `[1 Upload] --- [2 Review] --- [3 Configure] --- [4 Results]`
- Renders back/next buttons (back hidden on step 1, next becomes "Process" on step 3, hidden on step 4)
- Calls `currentStep.destroy()` before transition, then `nextStep.render(container)`
- Passes shared state object between steps (files, parsed statement, report)

**WizardState (shared mutable context):**
```ts
interface WizardState {
  files: File[];
  brokerOverride: string;      // "auto" or specific broker
  parsedStatement: Statement | null;
  detectedBrokers: string[];
  year: number;
  report: TaxSummary | null;
  rateMap: EcbRateMap | null;
}
```

**Acceptance criteria:**
- [ ] `WizardController` renders progress indicator and step content area
- [ ] Clicking Next/Back swaps visible step (stubs show placeholder text)
- [ ] `main.ts` is under 100 lines
- [ ] `npm run dev` shows the wizard shell with 4 labeled steps
- [ ] All existing tests pass (engine/parser/generator tests untouched)

---

### Task 2: Step 1 (Upload) + Step 2 (Review)

**Goal:** Extract file upload logic into step-upload and create the new review step.

**Step 1 — Upload (`src/web/steps/step-upload.ts`):**
- Move from `main.ts`: drop zone, file input, broker selector, file list rendering, addFiles(), renderFileList()
- The `esc()` HTML escape helper moves to a shared `src/web/utils.ts`
- `canAdvance()` returns `state.files.length > 0`
- Next button label: i18n key `wizard.next` ("Siguiente")

**Step 2 — Review (`src/web/steps/step-review.ts`):**
- NEW step (does not exist today). On `render()`:
  1. Parse all files from `state.files` (move parsing logic from `processFiles()`)
  2. Show summary card: detected broker(s), trade count, dividend count, date range, currencies found
  3. Show a preview table: first 10 trades (date, symbol, buy/sell, qty, price, currency) — read-only
  4. If parse fails, show error message with option to go back
- `canAdvance()` returns `state.parsedStatement !== null`
- This step handles the parsing but NOT the ECB rate fetch (that happens in step 3's "Process" action)

**Files to create:**
- `src/web/utils.ts` — `esc()`, `formatDate()`, `downloadBlob()` (shared helpers extracted from main.ts)

**Acceptance criteria:**
- [ ] Dragging files onto step 1 shows file tags; removing all files disables Next
- [ ] Clicking Next on step 1 triggers parsing and shows step 2 with summary
- [ ] Step 2 shows: broker name(s), N trades detected, N dividends detected, date range, currencies
- [ ] Parse errors display in step 2 with a "Back" button to return to upload
- [ ] Going back from step 2 to step 1 preserves the file list

---

### Task 3: Step 3 (Configure) + Step 4 (Results with Expandable Casillas)

**Goal:** Extract config into step-config, move results rendering into step-results, and add expandable casilla drill-down.

**Step 3 — Configure (`src/web/steps/step-config.ts`):**
- Move from `main.ts`: year selector
- Next button becomes "Procesar" (i18n key `wizard.process`)
- On click: fetch ECB rates, call `generateTaxReport()`, store result in `state.report`
- Show a processing spinner/message while fetching rates
- `canAdvance()` returns `state.report !== null`

**Step 4 — Results (`src/web/steps/step-results.ts`):**
- Move from `main.ts`: `renderResults()`, `renderOperationsTable()`, `renderDividendsTable()`, sort state, search/filter logic, export buttons
- Charts integration: call existing `extractChartData()` + render functions from `charts.ts`
- Back button returns to step 3 (re-configure year)
- No "Next" button on step 4

**Expandable Casillas (NEW — within step-results):**
- Replace the static casillas `<table>` with clickable card components
- Each casilla card shows: casilla number, concept name, amount (same as today)
- Clicking a card expands it to show contributing operations:
  - **0327 (Valor de transmision):** table of all sell transactions with proceedsEur
  - **0328 (Valor de adquisicion):** table of all sell transactions with costBasisEur
  - **0029 (Dividendos brutos):** table of all dividend entries with grossAmountEur
  - **0033 (Intereses ganados):** table of interest entries (type=earned)
  - **0032 (Intereses pagados):** table of interest entries (type=paid)
  - **0588 (Doble imposicion):** table by country showing taxPaid vs deductionAllowed
- Expand/collapse uses `<details><summary>` for accessibility (no JS toggle needed)
- Net gain/loss row is NOT expandable (it is derived, not a casilla)

**Files to create:**
- `src/web/steps/casilla-card.ts` — `renderCasillaCard(casilla, concept, amount, detailRows)` returns HTML string

**Acceptance criteria:**
- [ ] Step 3 shows year selector; clicking "Procesar" shows spinner then advances to step 4
- [ ] Step 4 shows casilla cards, operations table, dividends table, charts, export buttons
- [ ] Clicking casilla 0327 expands to show all sell transactions contributing to transmission value
- [ ] Clicking casilla 0029 expands to show all dividend entries
- [ ] All sort/filter/search functionality on operations table works identically to current behavior
- [ ] Export JSON and CSV buttons produce identical output to current version

---

### Task 4: Year Comparator with localStorage

**Goal:** Persist processed reports in localStorage and show comparison when 2+ years available.

**Storage design:**
- Key: `declarenta_report_{year}` (e.g., `declarenta_report_2025`)
- Value: JSON-serialized TaxSummary (Decimal values stored as strings, re-hydrated on load)
- Max stored: 5 years (oldest purged on overflow)
- New utility: `src/web/storage.ts` — `saveReport(report)`, `loadReport(year)`, `listStoredYears()`, `deleteReport(year)`, `serializeReport()`, `deserializeReport()`

**Comparison view (within step 4):**
- Below the main results, if 2+ years stored, show a "Comparar con ejercicio anterior" section
- Renders a side-by-side table: casilla | current year value | previous year value | delta | delta %
- Highlight positive deltas in green, negative in red
- A selector lets the user pick which stored year to compare against

**Files to create:**
- `src/web/storage.ts` — localStorage wrapper with Decimal serialization
- `src/web/steps/year-comparator.ts` — comparison table renderer

**Acceptance criteria:**
- [ ] Processing a report auto-saves it to localStorage
- [ ] Processing a second year shows the comparison section in step 4
- [ ] Comparison table shows all casilla values side-by-side with deltas
- [ ] Stored reports survive page reload (can re-view without re-uploading)
- [ ] `listStoredYears()` correctly lists available years; delete works

---

### Task 5: i18n — Add New Keys to All 5 Locales

**Goal:** Add translation keys for all new wizard UI text.

**New keys needed (approximate, finalize during implementation):**

| Key | ES | EN |
|-----|----|----|
| `wizard.step_upload` | Subir ficheros | Upload files |
| `wizard.step_review` | Revisar datos | Review data |
| `wizard.step_config` | Configurar | Configure |
| `wizard.step_results` | Resultados | Results |
| `wizard.next` | Siguiente | Next |
| `wizard.back` | Anterior | Back |
| `wizard.process` | Procesar | Process |
| `review.title` | Datos detectados | Detected data |
| `review.broker` | Broker(s) | Broker(s) |
| `review.trades_count` | {{count}} operacion(es) | {{count}} trade(s) |
| `review.dividends_count` | {{count}} dividendo(s) | {{count}} dividend(s) |
| `review.date_range` | Rango de fechas | Date range |
| `review.currencies` | Divisas | Currencies |
| `review.preview` | Vista previa (primeras 10) | Preview (first 10) |
| `review.parse_error` | Error al procesar | Parse error |
| `casilla.expand_detail` | Ver detalle | View detail |
| `comparator.title` | Comparar con ejercicio anterior | Compare with previous year |
| `comparator.select_year` | Comparar con: | Compare with: |
| `comparator.delta` | Diferencia | Difference |
| `comparator.no_data` | No hay datos de otros ejercicios | No data from other years |
| `config.processing_rates` | Obteniendo tipos de cambio... | Fetching exchange rates... |

**Files to modify:**
- `src/i18n/locales/es.ts` — add ~20 new keys
- `src/i18n/locales/en.ts` — add ~20 new keys
- `src/i18n/locales/ca.ts` — add ~20 new keys (Catalan translations)
- `src/i18n/locales/eu.ts` — add ~20 new keys (Basque translations)
- `src/i18n/locales/gl.ts` — add ~20 new keys (Galician translations)

**Acceptance criteria:**
- [ ] All new UI strings use `t()` calls, never hardcoded text
- [ ] Switching language in the selector updates all wizard text including step labels
- [ ] i18n test suite passes (if existing tests validate key completeness)
- [ ] No missing keys when switching to any of the 5 locales

---

### Task 6: CSS — Wizard Styles, Step Transitions, Expandable Cards

**Goal:** Style the wizard progress bar, step transitions, and expandable casilla cards.

**File to modify:**
- `src/web/style.css` — add new sections (do NOT remove existing styles that other components use)

**New CSS concepts:**

1. **Wizard progress bar** (`.wizard-progress`):
   - Horizontal bar at top of main content
   - Steps shown as numbered circles connected by lines
   - Current step: accent color, filled circle
   - Completed steps: success color, checkmark
   - Future steps: muted color, hollow circle
   - Responsive: on mobile, show only step numbers (not labels)

2. **Step content area** (`.step-content`):
   - Smooth fade transition between steps (CSS `opacity` + `transform` animation, ~200ms)
   - Consistent padding matching current section padding

3. **Navigation buttons** (`.wizard-nav`):
   - Flex row with Back (left) and Next/Process (right)
   - Back button: secondary style (outline)
   - Next button: primary style (filled accent)
   - Process button: same as Next but distinct label

4. **Expandable casilla cards** (`.casilla-card`):
   - Card layout replacing the current flat table
   - Each card: casilla number badge, concept text, amount (right-aligned)
   - Uses native `<details>` — no JS animation needed
   - `<summary>` shows the card header; expanded content shows contributing operations mini-table
   - Gain/loss color coding preserved
   - On mobile: cards stack vertically, full width

5. **Year comparator table** (`.comparator-table`):
   - Side-by-side columns with delta highlighting
   - Responsive: on mobile, switch to stacked layout

6. **Review step** (`.review-summary`):
   - Card grid showing broker, counts, date range, currencies
   - Preview table: compact, read-only, first 10 rows

**Acceptance criteria:**
- [ ] Wizard progress bar renders correctly on desktop, tablet, and mobile
- [ ] Step transitions have a subtle fade (not jarring instant swap)
- [ ] Casilla cards look professional with clear expand/collapse affordance
- [ ] All existing styles (theme toggle, charts, tables, footer) are preserved
- [ ] Dark and light themes both render the new components correctly

---

## File Impact Summary

### New files (10):
```
src/web/wizard.ts              — WizardController
src/web/utils.ts               — shared helpers (esc, formatDate, downloadBlob)
src/web/storage.ts             — localStorage wrapper
src/web/steps/types.ts         — WizardStep interface, WizardState
src/web/steps/step-upload.ts   — Step 1
src/web/steps/step-review.ts   — Step 2
src/web/steps/step-config.ts   — Step 3
src/web/steps/step-results.ts  — Step 4
src/web/steps/casilla-card.ts  — Expandable casilla component
src/web/steps/year-comparator.ts — Year comparison renderer
```

### Modified files (8):
```
src/web/main.ts                — gutted to ~80 lines (wizard bootstrap only)
src/web/index.html             — replace sections with wizard container
src/web/style.css              — add wizard, card, comparator styles
src/i18n/locales/es.ts         — +20 keys
src/i18n/locales/en.ts         — +20 keys
src/i18n/locales/ca.ts         — +20 keys
src/i18n/locales/eu.ts         — +20 keys
src/i18n/locales/gl.ts         — +20 keys
```

### Untouched (all engine, parsers, generators, types, CLI, tests):
```
src/engine/*                   — no changes
src/parsers/*                  — no changes
src/generators/*               — no changes
src/types/*                    — no changes
src/cli/*                      — no changes
src/web/charts.ts              — no changes (consumed by step-results)
src/web/disclaimer.ts          — no changes (consumed by main.ts footer)
src/web/sw.ts                  — no changes
src/web/manifest.json          — no changes
tests/*                        — no changes (all existing tests pass)
```

---

## Success Criteria

1. **User flow:** A non-technical user can upload files, review detected data, configure year, and see results in a clear 4-step flow in under 3 minutes
2. **No regressions:** All existing tests pass; engine/parser/generator output identical
3. **Expandable casillas:** Each casilla card drills down into its contributing operations
4. **Year comparison:** Processing 2+ years shows a side-by-side delta table
5. **Responsive:** Works on mobile (360px), tablet (768px), and desktop (1100px+)
6. **i18n complete:** All text translatable in all 5 locales
7. **Accessibility:** Keyboard navigation through wizard steps, `<details>` for expandable cards, ARIA labels on progress bar
8. **Maintainability:** `main.ts` under 100 lines; each step is a self-contained module under 200 lines
