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
- **Build**: `tsup` (library/CLI), `vite` 8 (web — Rolldown/Oxc bundler; `build.target: es2022`)
- **Test**: `vitest`
- **CI**: GitHub Actions (Node 22)
- **Docker**: Multi-stage Dockerfile.web (node:22.12-alpine build → nginx:1.31-alpine)
- **Node**: requires `^20.19.0 || >=22.12.0` (Vite 8 floor)

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
- **Cross-currency cost-basis conversion (Hard Trace — the €35M bug)**: a permuta's two legs are in DIFFERENT currencies — you acquire a coin paying coin X and dispose of it receiving coin Y (e.g. buy USDC paying EUR, sell USDC for BTC). The #219/V2422-20 FCY rule (`fifo.ts:disposalEur`) converts a disposal's cost AND proceeds at the SALE-date rate — correct ONLY for a same-currency security (buy USD stock, sell USD stock), where it strips the buy↔sale FX drift into the FX engine. For a permuta `lot.currency !== trade.currency`, so converting the (EUR-denominated) `costBasisFcy` by the SELL coin's rate multiplies a €277 cost by BTC's €78,890 price → a €21.9M phantom cost basis (real file: total adquisición €35,138,417, fake −€35,089,048 loss). **Fix**: `disposalEur()` keys on `lot.currency === trade.currency` — same → sale-date rate on both legs (V2422-20, unchanged); different → cost at the LOT's own acquisition rate (`lot.ecbRate` = real EUR paid, Art. 35.1), proceeds at sale rate, gain = their difference. **This was unmasked, not caused, by the v0.48.5 "Buy Crypto With Fiat" fix**: before it, those coins had no lot and hit the cost-basis-0 "sin lotes" path (couldn't explode); giving them lots surfaced the latent #219 mismatch. Only the two lot-consuming paths (long disposal + option-exercise underlying delivery) carry a non-zero cross-currency cost; short/expiration paths have one zero leg so they're already rate-correct.

### Binance "Transaction History" CSV — operation taxonomy (Hard Trace)
The Binance "Generate all statements" export (`User_ID,UTC_Time,Account,Operation,Coin,Change,Remark`) is a balance-change journal, NOT a trade list. `src/parsers/binance.ts` (`parseBinanceTxCsv`) classifies each `Operation`:
- **Trades (permutas / buys / sells)**: `Binance Convert`, `Buy Crypto With Fiat`, `Transaction Sold`+`Revenue`, `Transaction Buy`+`Spend`, `Small Assets Exchange BNB` (dust). Each crypto↔crypto leg-pair emits BOTH a SELL (given-up coin) and a BUY (received coin) so the received coin gets a FIFO lot. **Fiat-leg fix**: if one leg is genuine FIAT (`isFiat()` — EUR/USD/etc, NOT stablecoins), emit a single normal trade in that fiat currency, never a CRYPTO disposal of EUR (that caused "Venta sin lotes: EUR"). Stablecoins (USDT/USDC) ARE crypto → still permutas.
- **`Buy Crypto With Fiat` (Hard Trace)**: the EUR/USD-funded card/balance purchase (crypto leg + negative fiat leg, ±1s apart). It is a paired-leg swap exactly like `Binance Convert` → both live in `TX_CONVERT_OPS` and route through `netLegs`→`pairAndEmit`→`emitCryptoSwap` (which emits a single fiat-priced BUY). **Symptom if unhandled**: the op fell through every handler, so the acquired coin got NO FIFO lot while later disposals still fired → a burst of phantom `fifo.sell_without_lots` ("Venta sin lotes: BTC … coste base = 0"). Real file: one `Buy Crypto With Fiat,BTC,0.0269` (€2499) caused 25 phantom BTC errors. Window grouping keys on `r.operation === start.operation` so a Convert and a fiat-buy in the same second never cross-mix. **Per-Remark sub-grouping (load-bearing)**: fiat-buys are ALL funded in the same coin (EUR/USD), so two buys in one second would net into a single fiat leg → `pairAndEmit` sees 1 sell vs N buys and silently DROPS all but one coin's lot (re-creating the phantom error). Each purchase carries a unique funding-wallet `Remark` (`Via CashBalance - Wallet/N…`) shared by both legs, so step 4 sub-groups fiat-buy windows by `Remark` before netting. `Binance Convert` legs have an EMPTY remark → its whole-window netting is deliberately left on the original path (NOT sub-grouped), provably unchanged — never route Convert through the per-Remark split (some Convert exports may carry mismatched remarks that would wrongly split a single conversion).
- **Plain SPOT trades (Hard Trace — the ~€200-cost bug)**: the OLDER "Generate all statements" vocabulary uses bare `Buy`/`Sell`/`Fee` (the spot-market trade legs) and `Sell Crypto to Fiat` (the cash-out), DISTINCT from the `Transaction *` Strategy vocabulary. A spot trade is a same-timestamp group: `Buy <received +>` + `Sell <given-up −>` + optional `Fee`; a `Referral Commission` may share the timestamp but is income (consumed by phase 2 first). **Symptom if unhandled**: these ops were in NO op-set → dropped; a user's 2021 spot buys created no FIFO lot, so 2025 sells fired `fifo.sell_without_lots` and the acquisition cost collapsed (real file: ~€200 vs ~€2000+ real, 4 "sin lotes" on one day). **Fix (phase 6, `SPOT_TRADE_OPS` + `emitSpotTrades`)**: pair by SIGN (NOT op name — `Sell` is the given-up leg of both a buy and a sale), via `netLegs`→`pairAndEmit`→`emitCryptoSwap` (same path as Convert: fiat leg → single fiat-priced trade; crypto-only → permuta). Runs AFTER income so same-second commissions aren't swept. `Commission History` added to `TX_INCOME_GENERAL_OPS` (base general 0304). `Sell Crypto to Fiat` carries a unique wallet `Remark` per cash-out → sub-grouped by a namespaced Remark key (`scf:<remark>`) so two same-second cash-outs of different coins don't net their EUR together, and an empty cash-out remark can never collide with bare Buy/Sell (`spot:`). **Lot-drop guard (load-bearing — the real file HAS this case, e.g. ADA+BTC bought in one second both paying EUR)**: bare Buy/Sell have an empty remark, so two DIFFERENT coins bought in the same second sharing one fiat would let `netLegs` merge the two EUR sells → 1 sell vs N buys → `pairAndEmit` silently DROPS a coin's lot (the very phantom this parser prevents). `emitBareSpotGroup` therefore detects >1 distinct received coin against a single fiat leg and pairs each bought coin with its own fiat row BY ORDER (the export lists N buys against N sells), never dropping; same-coin multi-fills still net cleanly into one lot. The per-coin fiat split is approximate only when order-to-order linkage is absent (rare), but the aggregate is exact and no coin ends with cost basis 0. **Fees**: a fee in an ECB-resolvable coin (fiat/stablecoin) is attached as commission (Art. 35: buy fee→cost, sell fee→proceeds); a fee in a non-resolvable coin (third-coin BNB, or the bought alt itself) has no rate and is sub-cent → dropped as dust (BNB-fee precedent). Exact-string matching keeps `buy`/`sell`/`fee` distinct from `transaction buy`/`transaction sell`/`transaction fee` — never use `includes()`.
- **±1s grouping window**: Convert-style legs are frequently 1 second apart (≈half in real data). Rows are grouped within a ±1s window with a single-consume `parsed` flag; net per-coin to cancel intra-account split rows.
- **Income** → `CashTransaction{type:"Crypto Reward Income"}` with `taxBucket`:
  - `"ahorro"` (rendimiento capital mobiliario, Casilla 0027): `Simple Earn Flexible Interest`, staking rewards. DGT V1766-22, Art. 25.2/43.1.
  - `"general"` (ganancia patrimonial NO derivada de transmisión, base general, Casilla 0304): airdrops (`HODLer`/`Launchpool`/`Token Swap`/`Crypto Box`), `Referral Commission`, `Strategy Trading Fee Rebate`. Art. 33.1; DGT V1948-21. **MUST NOT** go through interest/0027 (wrong base & rate) nor into `totalSavingsBase`/casillas.ts.
  - Each income reward valued at receipt-date EUR ALSO creates a tax-neutral synthetic BUY lot (`synthesizeRewardLots` in report.ts) at that EUR value, so a later sale isn't double-taxed (Art. 35.1). A BUY is never taxed by FIFO (only SELLs create disposals).
- **Skipped (non-taxable)**: `Simple Earn * Subscription/Redemption` (principal moves, not disposals — only the Interest is income), all `Transfer Between *`, `Deposit`/`Withdraw`, margin loan/repayment, `Copy Portfolio (Spot) - Create/Close` (principal moves between Spot and the "Spot Copy" sub-account — each coin nets to zero across the two legs; the lead trader's mirrored fills, if any, arrive as their own `Transaction *` rows — the skip assumes the legs are balanced, which holds in real same-timestamp exports), `BNB Fee Deduction` (sub-cent BNB fee dust). In `TX_SKIP_OPS`. **Accepted tradeoff**: paying a fee in BNB is strictly a micro-disposal of BNB (tiny Art. 33/37 gain/loss) — we omit it as immaterial dust, so the BNB lot balance is negligibly overstated. Valuing it would need a BNB price the tool deliberately never fetches (no-oracle/privacy policy), so skipping is the pragmatic call.
- **EUR_Value column** (optional, e.g. user-added): read into `FlexStatement.manualRateHints` and merged UNDER explicit user manual rates in report.ts (`mergeManualRateHints`). An explicit broker EUR value is authoritative even when `0` (Binance reports sub-cent micro-rewards as `0.0` — value at zero, don't warn). `merge.ts` must carry `manualRateHints` through (it's easy to forget — both web and CLI route through `mergeStatement`).
- **Validated** against a real 6000-row file: 44 FIFO errors + 66 unvalued → 0 unvalued, full capital-gains/income computed. Remaining "lotes insuficientes" are genuine data-window gaps (coin acquired before the export's date range) + Simple-Earn compounding dust (≈1e-7 units), both immaterial and conservatively warned.

### Dividend Grouping by Issuer (presentation-only)
- `groupDividendsByIssuer(entries)` in `generators/casillas.ts` aggregates per-payment `DividendEntry[]` into one `IssuerDividendGroup` per **issuer + source country** — the layout of brokers' fiscal certificates and the AEAT "Alta Capital mobiliario" form (one record per company with annual totals). Used by the Casilla 0029 detail card (web, with collapsible per-payment drill-down), CSV (a separate `# DIVIDENDOS POR EMISOR` section — the per-payment `# DIVIDENDOS` section is kept unchanged so neither is double-summed), and both PDFs.
- **PRESENTATION-ONLY, load-bearing invariant**: it is a pure render-layer helper (like `computeCasillaBlocksWithFx`), never stored on `TaxSummary`. `grossIncome` (Casilla 0029) and `calculateDoubleTaxation` (Casilla 0588) are computed from the raw per-payment `entries` independently, so `Σ group.grossTotalEur === grossIncome` exactly. Do NOT re-derive tax figures from the groups, and do NOT touch `dividends.ts`/`double-taxation.ts`/`report.ts` reduce.
- **Key** = `(isin || symbol || description) + withholdingCountry`. Country is in the key so each group maps 1:1 to a 0588 country line (a rare same-ISIN/two-country case shows as two blocks — honest and reconcilable, never a single block mixing countries). Empty-ISIN issuers fall back to symbol/description so distinct coins don't merge. Mixed currencies within a group → `currency: "—"`. Grouping runs on the already-titulares-split `report.dividends.entries`.

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

### FX dividend/interest withholding = pago a cuenta, NOT a disposal (Hard Trace — issue #225)
- **Symptom**: a FCY dividend with withholding created a GROSS acquisition lot AND a separate WITHHOLDING disposal that FIFO-consumed the OLDEST FCY lot (often a prior conversion at a different rate), fabricating a phantom Art. 33 FX gain into casillas 1633/1637 on currency the taxpayer never converted to EUR.
- **Why wrong**: withholding (retención en origen) is a **pago a cuenta** — deducted at source, the withheld FCY never enters the taxpayer's spendable balance, and it is **not a conversión a euros**. The DGT FX-timing doctrine (V2422-20, V1613-25, V0463-21) crystallizes an FX gain ONLY on the effective conversion to euros (cobro/pago, Art. 14.2.e). No competitor/tool (Taxdown/Autodeclaro run monodivisa; IBKR's Forex worksheet covers only completed conversions) books an FX gain on withholding. No binding consulta is squarely on point — this is a reasoned, conservative position (removes a phantom disposal of money never received).
- **Fix** (`extractCashFxEvents`): a pre-pass sums withholding per `(currency, date)`; each `Dividends`/`Payment In Lieu`/`Interest Received` inflow is emitted as a lot for the **NET** (gross − matched withholding) FCY actually received; the `Withholding Tax` row emits **no disposal**. FX lots are fungible per currency, so (currency,date) netting equals exact issuer pairing. Guards: a **positive** withholding (refund) is FCY *received* (acquire, not dispose); an **orphan** withholding (no same-(currency,date) income — cross-date reclaim) is dropped, never a disposal; interest withholding nets too.
- **Income path is untouched**: gross dividend → 0029 and withholding → 0588 are computed in `dividends.ts`/`double-taxation.ts` from the raw cashTransactions, never from FX events. Only 1633/1637 (and marginally `totalSavingsBase`'s positive-FX term) change.
- **Citation correction**: the FX engine tracks divisa under **Art. 33.1** (transmisión − adquisición), NOT Art. 37.1.l (which is "incorporaciones que no derivan de transmisión" — unrelated). Header comment + this section corrected. This closes the Art.37.1.l→Art.33/V2466-08 follow-up deferred in #220.

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
