# CLAUDE.md - DeclaRenta

## Project Overview

DeclaRenta converts foreign broker reports into Spanish tax declarations (Modelo 100, 720, 721, D-6). Browser-first, privacy-focused. All financial data stays on the user's machine.

- **Domain**: [declarenta.com](https://declarenta.com)
- **Alt URL**: [geiserx.github.io/DeclaRenta](https://geiserx.github.io/DeclaRenta/)
- **Docker**: `drumsergio/declarenta` on Docker Hub

### Supported Brokers (13)

IBKR (XML), Degiro (CSV), Flatex (CSV), eToro (XLSX), Scalable Capital (CSV), Freedom24 (JSON), Revolut (XLSX), Lightyear (CSV), Coinbase (CSV), Binance (CSV), Kraken (CSV), Trade Republic (CSV), Trading 212 (CSV)

## Architecture

```
src/
  types/         TypeScript interfaces (broker, tax, ECB, IBKR)
  parsers/       Broker-specific parsers (13 brokers + auto-detect)
    index.ts     detectBroker() auto-detection, brokerParsers registry
    ibkr.ts      IBKR Flex Query XML
    degiro.ts    Degiro CSV (auto-detect delimiter)
    flatex.ts    Flatex CSV (German, 2 files: Depotumsätze trades + Kontoumsätze cash)
    etoro.ts     eToro XLSX (6+ header variants)
    scalable.ts  Scalable Capital CSV
    freedom24.ts Freedom24 JSON
    revolut.ts   Revolut XLSX (Trading Account Statement)
    lightyear.ts Lightyear CSV (Transaction Report)
    coinbase.ts  Coinbase CSV
    binance.ts   Binance CSV
    kraken.ts    Kraken CSV
  engine/        Core calculation modules
    fifo.ts      FIFO cost basis engine (Art. 37.2 LIRPF)
    ecb.ts       ECB exchange rate fetcher (SDMX API)
    wash-sale.ts Anti-churning rule detector (Art. 33.5.f LIRPF, 2 months listed / 1 year unlisted)
    dividends.ts Dividend + withholding tax processor
    double-taxation.ts  Double taxation deduction (Art. 80 LIRPF, Casilla 0588)
    dates.ts     Date normalization utilities
  generators/    Output generators
    report.ts    Modelo 100 casilla mapper
    modelo720.ts AEAT 720 fixed-width file (500 bytes/record, ISO-8859-15)
    modelo721.ts Modelo 721 stub (real format is XML per Orden HFP/886/2023)
    d6.ts        D-6 report generator (AFORIX format)
    csv.ts       CSV export
  cli/           CLI entry point (commander)
  web/           Browser UI (Vite, vanilla TS)
    main.ts        Entry point, splash screen, wizard orchestration, file upload
    sidebar.ts     Hash-based routing (#perfil, #renta, #m720, #d6), mobile toggle
    profile.ts     Fiscal profile form (NIF, name, CCAA, phone, year → localStorage)
    broker-guides.ts  Visual broker card grid + step-by-step download guides
    section-720.ts    Modelo 720 section (threshold bar, positions, filing guide)
    section-721.ts    Modelo 721 section (crypto threshold, positions, filing guide)
    section-d6.ts     Modelo D-6 section (positions, AFORIX guide, copy-to-clipboard)
    wizard.ts      3-step wizard within Renta section (Upload → Review → Results)
    charts.ts      Donut, bar, monthly G/L charts (pure SVG, no libs)
    casilla-detail.ts  Expandable casilla cards with legal references
    year-compare.ts    Year-over-year comparison (localStorage persistence)
    disclaimer.ts  Legal disclaimer modal
    style.css      Full CSS (dark/light themes, sidebar layout, splash, responsive)
  i18n/          Internationalization
    index.ts     t() function, locale management, localechange event
    locales/     es.ts, en.ts, ca.ts, eu.ts, gl.ts (5 languages)
tests/           Vitest tests mirroring src/ structure
```

## Tech Stack

- **Language**: TypeScript (strict mode, ES2022)
- **XML parsing**: `fast-xml-parser` (IBKR Flex Query XML)
- **XLSX parsing**: `xlsx` (eToro)
- **Decimal math**: `decimal.js` (financial precision, never raw Number)
- **CLI**: `commander`
- **Build**: `tsup` (library/CLI), `vite` (web)
- **Test**: `vitest`
- **CI**: GitHub Actions (Node 20 + 22)
- **Docker**: Multi-stage Dockerfile.web (node build → nginx:1.27-alpine)

## Web UI Architecture

### Layout
- **Sidebar + content area** grid layout (`grid-template-columns: 260px 1fr`)
- 5 sections: Perfil fiscal, Modelo 100 (Renta), Modelo 720, Modelo 721, Modelo D-6
- Hash-based routing (`location.hash`): `#perfil`, `#renta`, `#m720`, `#m721`, `#d6`
- Mobile (≤768px): sidebar collapses, hamburger toggle with backdrop

### Splash Screen
- Full-screen landing shown on every page load (no localStorage skip)
- Positioned below top-bar (`top: var(--topbar-h)`) so language/theme toggles stay accessible
- **GOTCHA**: `.splash { display: flex }` overrides the `hidden` attribute. Use `splash.style.display = "none"` (inline style), never `splash.hidden = true`
- Logo click in top-bar returns to splash via `showSplash()`

### i18n System
- 5 locales: es, en, ca, eu, gl
- Static text: `data-i18n` attributes updated by `updateStaticText()`
- Dynamic content (broker guides, profile form, 720/D-6 sections): rendered with `t()` calls, must re-render on `localechange` event
- **GOTCHA**: Any module that renders HTML with `t()` must listen for `localechange` and re-render, otherwise switching language leaves stale text

### Data Persistence
- **localStorage only** — no cookies, no server-side storage
- `declarenta_profile`: fiscal profile (NIF, name, CCAA, phone, year)
- `declarenta_reports_*`: saved reports for year comparison
- No data ever leaves the browser (except ECB rate API calls)

### Theming
- CSS custom properties with `[data-theme="light"]` / `[data-theme="dark"]`
- `auto` mode: follows `prefers-color-scheme`
- System font stack (no Google Fonts — privacy policy)

## Deployment

**Production is GitHub Pages only.** DeclaRenta is a static web app — there is NO self-hosted/Docker deployment. Do not deploy a container to geiserback (or any server); it has been fully removed. Test live only at declarenta.com.

### Release Flow
1. Merge PR to main
2. Auto Release workflow creates semver tag (e.g. `v0.15.6`)
3. `Deploy to GitHub Pages` workflow auto-runs → site live at declarenta.com

### Production (GitHub Pages)
- Auto-deploys on merge to main via `Deploy to GitHub Pages` workflow (Vite build → `dist/web` → Pages artifact)
- **declarenta.com** (custom domain, Cloudflare DNS) — the canonical production URL
- **geiserx.github.io/DeclaRenta** — same Pages deploy, alternative URL
- No Docker, no Portainer, no geiserback. The `drumsergio/declarenta` Docker image still builds in CI but is not deployed anywhere.

## Critical Rules

### Financial Precision
- **ALWAYS** use `Decimal` from `decimal.js` for any monetary calculation
- **NEVER** use JavaScript `Number` for amounts, rates, or prices
- **ALWAYS** use ECB official rates (via `getEcbRate()`), never IBKR's `fxRateToBase`

### Privacy
- **NEVER** add network calls that transmit user financial data
- **NEVER** log financial amounts, NIF, or personal information
- The only permitted outbound request is to the ECB SDMX API for exchange rates

### Crypto Permuta Valuation (Art. 37.1.h LIRPF)
- Crypto↔crypto swaps (permutas) are valued via three mechanisms only:
  - **(A) Skip-and-warn**: trades we cannot value are skipped, the user is warned.
  - **(D) Cross-leg inference**: the EUR value is inferred from the resolvable side of the swap.
  - **(B) Manual entry**: the user types an EUR-per-unit value in the crypto-rates panel.
- We DELIBERATELY do NOT call any live external crypto price API/oracle (this would be "option C"). The set of {coins, dates, amounts} a user holds is a portfolio fingerprint that must never leave their machine.
- The ONLY permitted outbound call remains the ECB SDMX fiat-rate API.
- **Shared parsing**: `src/engine/manual-rates.ts` is the single source of truth for turning raw `{currency,date,eurPerUnit}` quotes into an `EcbRateMap` (date→YYYY-MM-DD, currency upper-cased + stablecoin-normalized, rate validated with Decimal). Both the web localStorage path and the CLI `--crypto-rates` flag consume it — never re-implement the validation inline.
- **Known limitation (cross-date phantom gain)**: dropping an unresolvable BUY leg creates no FIFO lot, so a later *resolvable* SELL of that coin taxes full proceeds as gain (costBasis=0). This is conservative (never understates tax) and the dropped leg is always surfaced for manual entry (B). Intentionally not worked around.

### Spanish Tax Law References
- **Art. 37.2 LIRPF**: FIFO mandatory for homogeneous securities
- **Art. 33.5.f LIRPF**: Anti-churning rule — losses blocked if same security repurchased within 2 calendar months (listed on regulated markets) or 1 year (unlisted, including most crypto)
- **Art. 80 LIRPF**: Double taxation deduction — lesser of foreign tax paid or Spanish tax due
- **Art. 26.1.a LIRPF**: Only custody/administration fees are deductible from capital income. Margin interest is NOT deductible — shown as informational only.
- **Casillas**: 0327-0328 (capital gains), 0029 (dividends), 0027 (interest income), 0588 (double taxation). Real casilla 0032 = insurance income (Art. 25.3), not broker margin interest.
- **Savings brackets (2025+, Ley 7/2024)**: 19% (0–6k), 21% (6k–50k), 23% (50k–200k), 27% (200k–300k), 30% (>300k)

### AEAT Formats
- **Modelo 100**: No file import in Renta Web. Tool generates casilla values for manual entry. XSD published annually (`Renta20XX.xsd`).
- **Modelo 720**: Fixed-width text file, 500 bytes/record, ISO-8859-15 encoding. Submitted via TGVI.
- **Modelo 721**: Real AEAT format is XML with schemas (Orden HFP/886/2023). Current stub uses fixed-width for prototyping only.
- **Modelo D-6**: Similar fixed-width format. Deadline: January 31.

### Adding a New Broker Parser
1. Create `src/parsers/<broker>.ts`
2. Implement a function that returns `FlexStatement`-compatible output (reuse the same types)
3. Add tests in `tests/parsers/<broker>.test.ts` with anonymized fixture data
4. Export from `src/index.ts`

### IBKR DateTime Format (Hard Trace)
- IBKR Flex Query dateTime fields use `YYYYMMDD;HHMMSS` format (e.g. `"20190916;130630"`), NOT `YYYY-MM-DD` or plain `YYYYMMDD`
- **Symptom**: `Error: Invalid time value` when processing dividends/interest, or silently wrong ECB rate lookups
- **Root cause**: Code using `dateTime.slice(0, 10)` gets `"20190916;1"` instead of a valid date — the semicolon is at position 8, not position 10
- **Fix**: Always use `normalizeDate()` from `dates.ts` which strips the `;HHMMSS` time component. Never use raw `slice()` on dateTime fields.
- **Safe pattern**: `slice(0, 8)` also works (extracts `"20190916"`) but `normalizeDate()` is preferred as it handles all formats
- **Files affected**: `dividends.ts`, `report.ts` used `slice(0, 10)` — `fifo.ts` was safe because it used `slice(0, 8)` + `normalizeDate()`

### IBKR Multi-Account Flex Queries
- When users export a Flex Query covering multiple IBKR accounts, the XML contains multiple `<FlexStatement>` elements inside `<FlexStatements count="N">`
- The parser merges all accounts' trades, cashTransactions, corporateActions, openPositions, and securitiesInfo into a single combined FlexStatement
- `accountId` in the merged result is comma-separated (e.g., `"U1111111,U2222222"`)
- The `isArray` config in fast-xml-parser must include `FlexQueryResponse.FlexStatements.FlexStatement` to handle both single and multi-account XMLs

### Adding a New Web Section
When adding a new section (like 721), follow this checklist:
1. Create `src/web/section-<name>.ts` with `initSection*()`, `renderSection*()`, `rerenderSection*()` exports
2. `rerenderSection*()` must call `initSection*()` in the `else` branch (for locale changes on empty state)
3. Add sidebar entry in `src/web/index.html` (SVG icon + `data-i18n` label + badge span)
4. Add section container in `src/web/index.html` (`<section id="section-<name>" class="app-section" hidden>`)
5. Add section ID to `SECTIONS` array in `src/web/sidebar.ts`
6. Add `initSection*()`, `renderSection*()`, `rerenderSection*()` calls in `src/web/main.ts`
7. Add all i18n keys in ALL 5 locales (es, en, ca, eu, gl) — never leave any locale behind
8. Use section-specific `profile_required` key in the profile warning banner, not the generic one

### Modelo 721 Crypto Filtering
- Only positions with `assetCategory === "CRYPTO"` count for Modelo 721
- **NEVER** include `CASH` (fiat currency) — fiat on exchanges belongs in Modelo 720, not 721
- Crypto positions often have no ISIN — handle empty `p.isin` gracefully (fallback to description/symbol)
- Do NOT derive exchange/country from ISIN prefix for crypto — use fallback values

### Blob Encoding in Web Generators
- JavaScript `Blob` constructor ALWAYS encodes strings as UTF-8 regardless of `charset` in MIME type
- Use `charset=utf-8` in MIME type for prototypes/stubs
- For real AEAT submission (Modelo 720 fixed-width, ISO-8859-15), proper byte encoding would need a TextEncoder or library — current implementation is a known limitation

### FOP/FSFOP Asset Category (Hard Trace)
- IBKR reports futures options on MEFF (Spanish derivatives exchange) as `assetCategory="FOP"` or `"FSFOP"`
- These must be added to `KNOWN_CATEGORIES` in fifo.ts, `WASH_SALE_EXEMPT` in wash-sale.ts, and `ASSET_LABELS` in charts.ts/operations-annex.ts
- FOP/FSFOP are derivatives → exempt from anti-churning (Art. 33.5.f only applies to homogeneous securities)
- They share option-like metadata (strike, expiry, putCall) — extend OPT spreads in fifo.ts to also match FOP/FSFOP
- **Symptom**: massive false blocked losses (~22K EUR) and 75+ "categoría desconocida" warnings
- **ISIN guard**: FOP trades on MEFF often have empty ISIN. The wash-sale matcher must skip disposals with empty ISIN to avoid false matches against unrelated securities

### FX Phantom Gains from Missing Prior-Year Lots (Hard Trace)
- If a user's Flex Query only covers the declaration year, prior-year FCY acquisitions are missing → no lots exist when the engine tries to consume them
- **Old behavior**: `costBasisEur = 0` → fabricated huge phantom profits (e.g. 48K EUR)
- **Fix**: When lots are missing (both "sin lotes previos" and "insuficientes" paths in fx-fifo.ts), set `costBasisEur = proceedsEur` → zero gain. The warning still fires so users know data is incomplete.
- **FX event sources**: Only explicit CASH trades (non-FXCONV/AFx) generate FX events. Securities trades do NOT generate implicit FX events — this avoids double-counting and phantom gains entirely.
- FXCONV/AFx trades are filtered per-trade by `isFxconv()`. No global auto-convert detection.

### Logo vs Favicon (Hard Trace)
- `src/web/public/logo.png` = the realistic bull app logo (1.9MB, 1024×1024). Used for splash screen and top-bar branding.
- `src/web/public/favicon.svg` / `favicon-16.png` / `favicon-32.png` = small icon for browser tabs only.
- **NEVER** use `favicon.svg` as the `src` for `.splash-logo` or `.brand-logo` in index.html. Those must reference `logo.png`.
- `docs/images/logo.png` and `src/web/assets/logo.png` are copies of the same logo for docs/README.

### CLI Build Gotcha
- `tsup` config produces both lib and CLI entries to `dist/` — CLI entry `dist/index.js` collides with lib entry
- `package.json` `bin.declarenta` points to `./dist/cli.js` which doesn't exist
- **Workaround**: Use `npx tsx src/cli/index.ts` to run CLI directly during development

### ECB Rate Handling
- ECB publishes rates as "1 EUR = X FCY"
- We store the inverse: "1 FCY = X EUR" for direct multiplication with broker amounts
- Weekends/holidays: walk backward up to 10 business days
- Rate source: `https://data-api.ecb.europa.eu/service/data/EXR`
- **Early-January lookback (Hard Trace)**: `fetchEcbRates(year)` only fetches rates for that calendar year. Trades on Jan 1-2 trigger a 10-day lookback into late December of the *previous* year, but those rates won't exist in the map unless `year - 1` is also fetched. **Both `main.ts` and `cli/index.ts` must add `minYear - 1` to the years set** before the fetch loop. This bug surfaces every time a new parser is added with sample data containing early-January trades.

### Monodivisa Mode
- Optional toggle in fiscal profile (`monodivisa: boolean`) + CLI `--monodivisa` flag
- When active: skips the FX FIFO engine entirely (`skipFx: true` in `ReportOptions`)
- Capital gains still computed correctly in EUR via ECB rates — only separate FX lot tracking is skipped
- Matches behavior of Autodeclaro/Taxdown (competitors don't calculate Art. 37.1.l FX gains)
- Warning text must say "distorsionar" not "infraestimar" — monodivisa can both understate (miss FX gains) and overstate (miss FX losses)
- Art. 80 double taxation deduction is subtly affected (lower `totalSavingsBase` when FX gains are skipped) — accepted known limitation matching competitors
- DGT V2324-10 is the specific consulta vinculante confirming FIFO for currency — cite specifically, not generic "consultas vinculantes"

### FX Engine Simplification (Hard Trace — v0.39.2)
- `detectAutoConvert()` was REMOVED — it produced false positives on hybrid accounts (mix of manual + AFx trades), causing ALL operations to disappear
- **Root cause**: A binary global flag can't represent accounts that mix manual conversions and auto-convert. One AFx trade anywhere → entire account classified as auto-convert → all manual CASH trades skipped
- **New approach**: Per-trade filtering only. `isFxconv()` skips FXCONV/AFx-marked trades individually. Manual CASH trades always generate FX events regardless of what other trades exist.
- Securities trades (STK, OPT, etc.) NEVER generate implicit FX events — this matches competitor behavior and avoids phantom gains from missing prior-year lots
- `extractCashFxEvents()` always processes dividends/interest (no `autoConvert` param) — FCY income creates acquisition lots
- **Impact**: Pure auto-convert accounts still correct (all CASH trades have AFx → all skipped). Hybrid accounts now correct (manual conversions processed, AFx skipped). The only "loss" is theoretical implicit FX from holding FCY across stock trades — but that was phantom gains anyway due to missing lots.

## Project Philosophy

### Correctness with User Comfort
- DeclaRenta must be 100% fiscally correct by default
- BUT users should not be alarmed by non-critical warnings or confusing technical output
- "UNKNOWN" lot IDs and multi-line FX warnings for zero-gain events are inelegant — users don't need to worry about these
- **Planned: Three-tier message system** (info/warn/error) to replace flat warnings:
  - **Error**: Blocks report validity — missing data that affects tax amounts
  - **Warning**: User should review but report is still usable — e.g. wash-sale applied, large FX gains
  - **Info**: Informational only, no action needed — e.g. prior-year lots assumed, auto-convert detected
- Current "sin lotes previos suficientes" with gain=0 should be INFO (not warning) — it's handled correctly and needs no user action
- Goal: users who upload their file and see green results should feel confident, not anxious

### Actionable Explanations (Every Tier)
- Every message (error, warning, info) MUST include a brief, localized explanation of **what likely caused it** and **what the user can try**
- Common root causes to suggest: missing columns in the export, incomplete date range (doesn't cover prior years' acquisitions), wrong report type selected from broker
- Example: "Venta sin lotes previos — ¿has incluido los años anteriores en tu Flex Query? Selecciona un periodo que cubra desde la primera compra."
- These hints are rendered in the user's active locale (use `t()` keys, never hardcoded Spanish)
- The tone is helpful ("try this"), never blaming ("you forgot to...")

### Competitor Reconciliation Hint
- When the final results page is shown, include a subtle note (not a warning) explaining:
  - If other tools (Autodeclaro, Taxdown, etc.) show a different amount, it's likely because they use "monodivisa" mode (they don't calculate FX gains per Art. 37.1.l LIRPF)
  - Point the user to the monodivisa toggle in their fiscal profile to compare
  - Wording: "Si otra herramienta muestra un importe distinto, puede deberse a que no calcula las ganancias por tipo de cambio. Puedes activar el modo monodivisa en tu perfil fiscal para comparar."
- This hint should appear near the capital gains total, rendered as a collapsible "info" note (not a warning)
- It validates the user's concern ("your numbers are correct, here's why they differ") rather than creating doubt

## Development

```bash
npm test          # Run all tests
npm run typecheck # TypeScript strict check
npm run dev       # Vite dev server for web UI
npm run cli -- convert --input test.xml --year 2025
```

## License

GPL-3.0 — the core is free and always will be.

*Generated by [LynxPrompt](https://lynxprompt.com) CLI*
