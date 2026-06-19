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

### Anti-Churning Total-Sale Carve-Out (Hard Trace — issue #249)
- **DGT V3282-18 situation 1**: when a loss sale leaves **zero** homogeneous shares in the taxpayer's patrimony, the loss is fully deductible. The engine must not count the very pre-sale lots FIFO just sold as surviving "repurchases".
- **Implementation invariant** (`src/engine/wash-sale.ts`): post-sale repurchases remain uncapped and block normally; pre-sale absorption is capped by `holdingAfter = max(0, net BUY/SELL position after the sale date)`. Same-day FIFO disposal splits share one `holdingAfter` budget, so a single SELL split across lots cannot over-block. Forward/reverse splits must be applied to this cap and to later deferred-loss release proration so pre-split buys, post-split disposals, and replacement-lot releases are all compared in the relevant sale's share units.
- **Do NOT replace this with a naive total-sale shortcut**. `buy 100 → sell 100 at a loss → rebuy 100 within the window` is still a genuine wash sale because the post-sale rebuy remains after the loss sale.
- **Single-year limitation**: if prior-year holdings are absent from the input, `holdingAfter` can understate the real position and is clamped at zero. This is the same data-window limitation as other FIFO paths; do not invent prior holdings inside the anti-churning detector.

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
- **FX event sources**: explicit CASH conversions generate FX events, AND — since #239 — IBKR auto-convert (FXCONV/AFx) conversions are processed BY DEFAULT (they are real FCY→EUR conversions; IBKR does not round-trip on a stock sale, so the taxpayer genuinely holds the FCY). Securities trades do NOT generate implicit FX events — this avoids double-counting and phantom gains entirely.
- `isFxconv()` is RETAINED as the per-trade AFx detector and now drives an OPT-OUT (`ReportOptions.trackAutoConvert=false` / CLI `--skip-auto-convert` / web profile checkbox) that restores the old skip for accounts that genuinely round-trip. No global auto-convert detection (`detectAutoConvert()` stays removed, #171).

### Logo vs Favicon (Hard Trace)
- `src/web/public/logo.png` = the realistic bull app logo (1.9MB, 1024×1024). Used for splash screen and top-bar branding.
- `src/web/public/favicon.svg` / `favicon-16.png` / `favicon-32.png` = small icon for browser tabs only.
- **NEVER** use `favicon.svg` as the `src` for `.splash-logo` or `.brand-logo` in index.html. Those must reference `logo.png`.
- `docs/images/logo.png` and `src/web/assets/logo.png` are copies of the same logo for docs/README.

### ECB Rate Handling
- ECB publishes rates as "1 EUR = X FCY"
- We store the inverse: "1 FCY = X EUR" for direct multiplication with broker amounts
- Weekends/holidays: walk backward up to 10 business days
- Rate source: `https://data-api.ecb.europa.eu/service/data/EXR`
- **Early-January lookback (Hard Trace)**: `fetchEcbRates(year)` only fetches rates for that calendar year. Trades on Jan 1-2 trigger a 10-day lookback into late December of the *previous* year, but those rates won't exist in the map unless `year - 1` is also fetched. **Both `main.ts` and `cli/index.ts` must add `minYear - 1` to the years set** before the fetch loop. This bug surfaces every time a new parser is added with sample data containing early-January trades.

### Monodivisa Mode
- Optional toggle in fiscal profile (`monodivisa: boolean`) + CLI `--monodivisa` flag
- When active: skips the FX FIFO engine entirely (`skipFx: true` in `ReportOptions`)
- `skipFx` ALSO sets `FifoEngine({traditionalCostBasis:true})` → a same-fiat FCY security's cost converts at the ACQUISITION-date rate (Art. 35.1), embedding the buy→sale FX drift in the stock line (the FX engine being off). Drift counted exactly once (stock line here, FX engine in default); capital gains deliberately DIFFER from the FX-on case — don't "fix" back to sale-date cost. Also affects option-exercise delivery + same-stablecoin permutas.
- Matches behavior of Autodeclaro/Taxdown (competitors don't calculate Art. 37.1.l FX gains)
- Warning text must say "distorsionar" not "infraestimar" — monodivisa can both understate (miss FX gains) and overstate (miss FX losses)
- Art. 80 double taxation deduction is subtly affected (lower `totalSavingsBase` when FX gains are skipped) — accepted known limitation matching competitors
- DGT V2324-10 is the specific consulta vinculante confirming FIFO for currency — cite specifically, not generic "consultas vinculantes"

### FX Engine Simplification (Hard Trace — v0.39.2)
- `detectAutoConvert()` was REMOVED — it produced false positives on hybrid accounts (mix of manual + AFx trades), causing ALL operations to disappear
- **Root cause**: A binary global flag can't represent accounts that mix manual conversions and auto-convert. One AFx trade anywhere → entire account classified as auto-convert → all manual CASH trades skipped
- **Approach**: per-trade only, no global flag. `isFxconv()` classifies FXCONV/AFx-marked trades individually; manual CASH trades always generate FX events regardless of what other trades exist. (Per #239, AFx is PROCESSED by default and the `isFxconv()` skip is now opt-out — see the #239 bullet below; this section's point is only that there is no GLOBAL classifier.)
- Securities trades (STK, OPT, etc.) NEVER generate implicit FX events — this matches competitor behavior and avoids phantom gains from missing prior-year lots
- `extractCashFxEvents()` always processes dividends/interest (no `autoConvert` param) — FCY income creates acquisition lots

### IBKR auto-convert (AFx) processed by default; skip is opt-out (Hard Trace — #239)
- **Symptom**: silently SKIPPING FXCONV/AFx conversions dropped REAL divisa gains. IBKR does NOT round-trip FCY→EUR when you sell a stock — the taxpayer genuinely holds the foreign currency, and its later auto-conversion is a taxable divisa gain. Proof: fund $10000@0.90 then auto-convert @1.00 gave **€0** instead of the correct **€1000**.
- **Fix**: the engine now PROCESSES auto-conversions by DEFAULT (`ReportOptions.trackAutoConvert`, default `true`). `isFxconv()` is RETAINED — it is the per-trade detector that the OPT-OUT uses to restore the old skip for accounts that genuinely round-trip: `trackAutoConvert=false` / CLI `--skip-auto-convert` / web profile checkbox. The missing-prior-year-lot floor (`costBasisEur = proceedsEur` → gain 0) still applies, so processing an AFx conversion can never fabricate a phantom gain.
- **Legal basis**: divisa is a patrimonial element (**Art. 33.1**), timing = the conversion (**Art. 14.2.e**, "se imputará en el momento del cobro o del pago"); **DGT V2422-20** — a held FCY's conversion is a gain regardless of how the currency was acquired ("cuando lo recibido sean divisas… se imputará en el momento del cobro o pago"). There is NO de-minimis, so even tiny sweeps are processed.
- **Not a phantom re-arm**: this is purely the PER-TRADE default; the GLOBAL `detectAutoConvert()` flag stays removed (#171). The carry-basis model means a stock BUY emits no disposal, so nothing re-arms the missing-prior-year-lots phantom-gain bug.
- **Posture**: rigorous-by-default + opt-out checkbox, consistent with monodivisa.

### FX dividend/interest withholding = pago a cuenta, NOT a disposal (Hard Trace — issue #225)
- **Symptom**: a FCY dividend with withholding created a GROSS acquisition lot AND a separate WITHHOLDING disposal that FIFO-consumed the OLDEST FCY lot (often a prior conversion at a different rate), fabricating a phantom Art. 33 FX gain into casillas 1633/1637 on currency the taxpayer never converted to EUR.
- **Why wrong**: withholding (retención en origen) is a **pago a cuenta** — deducted at source, the withheld FCY never enters the taxpayer's spendable balance, and it is **not a conversión a euros**. The DGT FX-timing doctrine (V2422-20, V1613-25, V0463-21) crystallizes an FX gain ONLY on the effective conversion to euros (cobro/pago, Art. 14.2.e). No competitor/tool (Taxdown/Autodeclaro run monodivisa; IBKR's Forex worksheet covers only completed conversions) books an FX gain on withholding. No binding consulta is squarely on point — this is a reasoned, conservative position (removes a phantom disposal of money never received).
- **Fix** (`extractCashFxEvents`): a pre-pass sums withholding per `(currency, date)`; each `Dividends`/`Payment In Lieu`/`Interest Received` inflow is emitted as a lot for the **NET** (gross − matched withholding) FCY actually received; the `Withholding Tax` row emits **no disposal**. FX lots are fungible per currency, so (currency,date) netting equals exact issuer pairing. Guards: a **positive** withholding (refund) is FCY *received* (acquire, not dispose); an **orphan** withholding (no same-(currency,date) income — cross-date reclaim) is dropped, never a disposal; interest withholding nets too.
- **Income path is untouched**: gross dividend → 0029 and withholding → 0588 are computed in `dividends.ts`/`double-taxation.ts` from the raw cashTransactions, never from FX events. Only 1633/1637 (and marginally `totalSavingsBase`'s positive-FX term) change.
- **Citation correction**: the FX engine tracks divisa under **Art. 33.1** (transmisión − adquisición), NOT Art. 37.1.l (which is "incorporaciones que no derivan de transmisión" — unrelated). Header comment + this section corrected. This closes the Art.37.1.l→Art.33/V2466-08 follow-up deferred in #220.

### FX from foreign-currency stock round-trips = carry-basis defer (issue #230 → follow-up; supersedes the full-proceeds model)
- **What it does**: a foreign-currency stock BUY now SILENTLY CONSUMES the FCY it spends from the FX pool and PARKS the carried EUR basis of those dollars; a foreign-currency stock SELL pulls that principal back into the spendable pool at its CARRIED (original-acquisition) basis plus the trading profit at the sale-date rate. Neither emits an `FxDisposal` — only a real FCY→EUR conversion realizes an FX gain (deferred per Art. 14.2.e LIRPF, unchanged). Wired in `report.ts` inside the `skipFx` block alongside CASH conversions (`extractFxEvents`) and dividend/interest inflows (`extractCashFxEvents`); the stock-event producer lives in `fx-fifo.ts` and is fed both the BUY and SELL legs from `fifo.ts` (`getDisposals` plus the buy ledger), not the sell-only `extractStockProceedsFxEvents` of the old model.
- **Hard-Trace symptom that killed the previous (full-proceeds) model — the €450-vs-€320 drift**: the v0.49.0 model pushed each SALE's full net `proceedsFcy` into the FX FIFO as a pure acquisition lot and did NO buy-side accounting. Because a stock BUY never removed the FCY it spent, the FX FIFO balance DIVERGED from the real spendable balance across multiple same-currency round-trips, and a later conversion consumed the WRONG "oldest" dollars. Numerical proof on a two-round-trip account: the engine reported **€450** of FX gain where the correct figure is **€320** — off by **€130**. The old section's claim that the no-buy-side model "matches the V2324-10 symmetric criterion" and that "over-accumulated sell-proceeds lots sit unconsumed at the tail and are never taxed" was therefore PROVEN FALSE: those orphan lots do not sit harmlessly at the tail, they shift the FIFO frontier and mis-rate a real conversion. That model is gone.
- **Parked-FIFO mechanism (the fix)**: per currency the engine keeps the normal spendable FIFO PLUS a "parked" FIFO holding the principal locked inside open foreign-stock positions. A **BUY** removes `costBasisFcy` worth of dollars from the spendable pool and parks them carrying their EUR acquisition basis (no disposal, no realized gain). A **SELL** removes the matching principal from the parked FIFO and re-adds it to the spendable pool at its CARRIED basis, then adds the profit (`proceeds − cost`, when positive) at the sale-date rate as fresh dollars. The buy↔sale FX drift on the principal is thus deferred inside the carried basis until a conversion realizes it, instead of being lost (old decoupled engine) or double-injected (old full-proceeds engine). On the €320 two-round-trip case the carry-basis engine now reports exactly **€320**.
- **4-phase same-day ordering in `processEvents`**: events on the same date are processed pool-acquisitions → stock-buys/park → stock-sells/re-add → disposals (conversions), so a buy parks its dollars BEFORE a same-day sell of the same position re-adds them, and BEFORE a same-day conversion can consume them. With no stock events present this collapses to the prior acquisitions-before-disposals order — so CASH-only, dividend-only, and interest-only flows are byte-for-byte unchanged.
- **Funding-absent no-op = the dominant-case safety property (BYTE-IDENTICAL to the old behavior)**: when the FCY a buy spends has NO tracked acquisition lot in the data — the common real-file case: IBKR auto-convert (AFx) settlement, single-year Flex exports, or (under the #239 opt-out) FXCONV-skipped conversions — the buy parks "uncovered" (nothing to remove from an empty pool) and the matching sell re-adds at the SALE rate, which reproduces the previous full-proceeds result exactly. So nothing changes for the overwhelming majority of files; the carry-basis correction only bites on accounts that hold TRACKED FCY across multiple same-currency stock round-trips AND then convert to EUR.
- **Loss-sell carried-principal: un-converted dollars correctly produce ZERO in the casillas (NOT a residual that ever reaches a declared box — confirmed with issue #230's reporter)**: any SELL that realizes a LOSS discards the carried principal it pulls back from the parked FIFO (the leg re-adds principal at its CARRIED basis only up to `min(cost, proceeds)`; the rest is drained from the parked queue and pushed to NO pool lot). A loss-sell emits **no `FxDisposal`** and books **nothing** into casillas 1633/1637 — only a real FCY→EUR conversion (`consumeLots`) ever emits a disposal, and the casillas sum only those (`report.ts`: `fxDisposals` filtered by conversion `disposeDate`). This is **fiscally correct and is exactly the reporter's principle** (issue #230, 2026-06-17): the dollars spent inside a losing position never reached a EUR conversión, so under **Art. 14.2.e** ("se imputará en el momento del cobro o del pago") there is no divisa gain/loss to compute — *"como si te hubieras comprado una hamburguesa en dólares"*. The €-loss lands entirely in the stock line at the sale-date rate (V2422-20). Pinned by `tests/integration/fx-carry-basis-e2e.test.ts` ("FCY stock loss-sell with NO EUR conversion → divisa 1633/1637 = 0").
- **The so-called "residual" is a gap-vs-raw-economic, never a casilla error**: `residual = Σ over loss-sells of [ discardedPrincipalQty × (saleRate − carriedBasisRate) ]` is the difference between the engine's (correct) casilla figure and a *raw-economic reconciliation* — a benchmark the engine deliberately does NOT compute, because forcing it would **DOUBLE-COUNT** the FX drift against the already-recognized stock loss. That gap is unbounded in magnitude and rate-path-dependent in sign (under-states the raw-economic FX when the rate rose between buy and sale, over-states when it fell), but it lives only in the V2422-20 "two-element" seam — it **never lands in 1633/1637**. The discard is also *clean*: it mutates only the per-position parked FIFO, never the spendable pool, so it cannot shift the FIFO frontier for a later conversion. The earlier framing of this as an "unbounded residual / NOT a bug" was anxious about the wrong benchmark; the casilla output is simply the only-real-conversions figure, which is the right one.
- **Re-added principal keeps its ORIGINAL acquisition date for FIFO ordering (issue #230, comment 4729376344 — wrong-YEAR attribution fix)**: the spendable pool is consumed oldest-first BY ARRAY POSITION (`consumeLots` takes `lots[0]`/`shift`). A SELL re-adds its carried principal to that pool. The first cut stamped the re-add with the SALE date and APPENDED it at the tail (`pushPoolLot` with `event.date`) — so a funding lot acquired BETWEEN the buy and the sale sat AHEAD of the (genuinely-older) re-added principal, and a PARTIAL conversion consumed that NEWER funding first → mis-rated the conversion and shifted an FX gain into the WRONG TAX YEAR. Numerical proof (reproduced by the maintainer): fund $1000@0.80 (Jan) → buy → fund $1000@1.10 (Mar) → sell USD-flat (re-adds @0.80) → convert $1000 in year N, $1000 in N+1 gave **€100 / €500** when correct origin-FIFO is **€400 / €200** — same €600 lifetime, but €300 in the wrong year. **Fix**: each parked slice now carries its consumed pool lot's ORIGINAL `acquireDate` (`null` for an uncovered slice), and the SELL re-adds the principal stamped with THAT date (uncovered → sale date); `pushPoolLot` SPLICES the lot into date-sorted pool position (not the tail), so the pool stays FIFO-ordered by genuine age and `consumeLots` is untouched. Only the carried PRINCIPAL keeps its original date — the trading PROFIT and uncovered/unmatched re-adds correctly stay at the sale date (DGT V0282-22: returned principal keeps its acquisition; profit is newly-acquired). Lifetime total is unchanged; only the per-year split (and the trace's `acquireDate`/`lotId`) moves. Pinned by `tests/integration/fx-carry-basis-e2e.test.ts` ("re-added principal keeps its original acquisition date (FIFO order across years)"), which fails €100/€500 on the pre-fix engine. The dominant funding-absent/uncovered case is unaffected (no tracked origin → sale-date re-add, as before).
- **Doctrine — V2324-10 "symmetric" achieved via DEFERRAL, not realize-at-buy**: this delivers the DGT V2324-10 carry/symmetric result (currency FX captured across the full holding period) WITHOUT realizing any FX at the buy — Art. 14.2.e. The buy CONSUMES (parks) but does NOT realize, so it does NOT re-arm the missing-prior-year-lots phantom GAIN bug that PR #143 / PR #171 removed (a buy emits no disposal, and an uncovered buy is a safe no-op against an empty pool). The genuinely-unsettled V0282-22 "realize-at-buy" variant (older symmetric V2324-10 vs newer defer V0282-22 / V0152-26 on the BUY axis) is explicitly NOT what this implements — that variant needs buy-side disposal emission and would re-introduce the phantom; it remains a documented FUTURE follow-up only.
- **Legal-citation (corrected, retained)**: divisa is **Art. 33.1** (transmisión − adquisición), timing **Art. 14.2.e** ("se imputará en el momento del cobro o del pago"), FIFO-for-currency rationale **DGT V2324-10**; NOT Art. 37.1.l (which governs "incorporaciones que no derivan de transmisión"). The stale "Art. 37.1.l" comment in `report.ts`'s FX block was corrected alongside this work (see the #225 citation correction above).
- **Scope/filter (unchanged)**: only `assetCategory` STK/FUND/BOND, `currency ≠ EUR`, ecb-resolvable; crypto permutas (proceeds in a coin, not fiat — crypto valuation path), options/FOP/FSFOP, and the CASH conversions already handled by `extractFxEvents` are excluded; SHORT legs are skipped (inflow at open, outflow at close — the long-side carry model can't represent them). Gated by monodivisa (`skipFx`), like the rest of the FX engine.

### FX-FIFO movement trace (opt-in audit ledger — issue #230)
- **What**: an opt-in `ReportOptions.fxTrace` flag on `generateTaxReport`; when true, `TaxSummary.fxTrace` is populated with an `FxTraceEvent[]` — the full all-year FX-FIFO movement ledger (kinds `acquire`/`dispose`/`park`/`unpark`/`discard`/`profit`, each carrying the running pool and parked FCY balances after the event). Produced by the engine itself: `FxFifoEngine.enableTrace()` records every movement, `getTrace()` returns it. Serialize the array with `serializeFxTrace(trace, "jsonl" | "csv")` (type `FxTraceFormat`) in `src/generators/fx-trace.ts`.
- **Why**: lets a developer/advisor audit exactly how a 1633/1637 figure was built and reconcile it by hand, and makes the carry-basis engine mechanically testable via golden-ledger tests. Born from issue #230 — the reporter was keeping a hand `console.log` ledger to verify the FX math; this turns that into a first-class, lossless artifact.
- **Reconciling to the casillas (load-bearing caveat)**: the trace is the FULL all-year ledger but the casillas are YEAR-FILTERED (`report.ts` keeps disposals whose `disposeDate` ∈ declaration year). So the golden-ledger identity is `Σ dispose.gainLossEur WHERE date∈year === fxGains.netGainLoss` — summing ALL `dispose` rows across years over/under-states the box on any account that converts a tracked currency in more than one year. Pinned by both a single-year and a MULTI-year reconciliation test in `tests/integration/fx-trace-e2e.test.ts`.
- **Where it's exposed**: CLI `--fx-trace [file]` / `--fx-trace-format jsonl|csv`; web offers a download gated behind `#debug` (or `localStorage.declarenta_debug`). **NEVER in the standard UI** — the FX-FIFO is not shown to normal users (the reporter's explicit ask). **Zero-cost when off**: every engine `record()` returns immediately unless `enableTrace()` was called, and the whole thing is skipped under monodivisa (`skipFx`).
- **The `discard` kind is the audit-visible proof of the loss-sell principle**: dollars spent inside a losing position that never converted to EUR appear in the ledger as `discard` (no FX realized), never as `dispose` — the mechanical evidence that an un-converted loss-sell books nothing into 1633/1637 (see the loss-sell bullet above, Art. 14.2.e).

## Project Philosophy

### Rigorous by default, with an opt-out checkbox when warranted (product posture)
- **Default = maximum fiscal rigor.** When Spanish law/DGT doctrine supports computing something (e.g. the divisa/FX element under Art. 33.1), DeclaRenta computes it by default — even when it is legally soft (inferred from general norms, no binding consulta) and even when no competitor does it. Being the most correct tool is the point.
- **BUT** when a computation is (a) not strictly needed for a correct return, (b) rests on genuinely-unsettled doctrine, or (c) is something other tools (Taxdown/Autodeclaro/etc.) deliberately omit — provide a **profile checkbox** to turn it off, exactly like the **monodivisa toggle** does for the FX engine (`profile.monodivisa` → `skipFx`). Rigorous on, but one click to match the simpler/market-standard treatment and reconcile with other tools.
- Pattern to follow for any future "should we compute this aggressive/contested thing?" question: ship it ON by default, expose an OFF checkbox in the fiscal profile (persisted in localStorage, threaded as a `ReportOptions` flag), and add a Competitor-Reconciliation-style note explaining when to use it. Never silently drop rigor; never force a contested computation with no escape hatch.

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
