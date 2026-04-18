# Open Questions

## mega-pr-phases-2-3-4 - 2026-04-16

- [ ] **720 Q4 stock price data:** The Q4 average valuation per Ley del Patrimonio requires average closing prices for Oct-Dec. DeclaRenta only has Dec 31 position values from the broker. Should we add a price data source (would break zero-network-call principle), accept the broker's year-end value as approximation, or require users to input Q4 averages manually? -- Impacts accuracy of 720 filings for large portfolios.

- [ ] **Crypto pricing for Modelo 721:** Crypto exchange CSVs contain trade history but not Dec 31 valuations. Users would need to manually provide year-end EUR prices per asset, or we need a price API call (CoinGecko etc.). This conflicts with the zero-external-API principle. -- Determines whether 721 generation can be fully automated or requires manual input.

- [ ] **DNS for declarenta.es:** The custom domain needs A records pointing to GitHub Pages IPs (185.199.108-111.153) and a CNAME for www. Is this domain already registered and configured in Cloudflare? -- Blocks the final deploy step.

- [ ] **PWA icons:** Need DeclaRenta logo as SVG, 192x192 PNG, and 512x512 PNG for the PWA manifest. Do these assets already exist, or should they be created as part of this PR? -- Required for PWA installability and Lighthouse score.

- [ ] **i18n translation quality for ca/eu/gl:** Machine-translated Catalan, Basque, and Galician strings may have errors. Should we ship them as-is (marked beta) or defer those 3 locales until native speakers review? -- Impacts whether we ship 5 locales or just es+en initially.

- [ ] **Crypto parser format stability:** Coinbase, Binance, and Kraken occasionally change their CSV export formats. The parsers will be built against current known formats. Should we add format version detection and clear error messages for unrecognized formats? -- Impacts user experience when exchanges update their exports.

## wizard-ui-refactor - 2026-04-16

- [ ] **Step transition animation approach:** Plan specifies CSS opacity+transform fade (~200ms). Should we add a slight slide direction (left-to-right for Next, right-to-left for Back) or keep it as a simple fade? -- Affects polish level; slide is more work but feels more natural for a wizard.
- [ ] **Year comparator: Decimal serialization round-trip:** Decimal.js values are lost when JSON.stringify'd to localStorage. The plan specifies string serialization + re-hydration. Need to verify that toFixed(10) precision is sufficient for round-trip without drift across all casilla values. -- Could cause phantom deltas in the comparison table if precision is lost.
- [ ] **Review step preview table: which 10 trades?** Plan says "first 10 trades" but after chronological sort. Should it show the 10 most recent (likely most relevant to the selected tax year) or the 10 earliest (FIFO order)? -- Minor UX decision, but affects what the user sees as their data preview.
- [ ] **localStorage quota:** A typical TaxSummary with 1000+ disposals serializes to ~500KB. Storing 5 years = ~2.5MB. localStorage limit is 5MB in most browsers. For power users with 3000+ trades per year, this could hit the limit. Should we add a quota check + warning, or truncate stored data (e.g., omit individual disposals, keep only aggregates)? -- Impacts whether year comparator works reliably for heavy users.
