# AGENTS.md - DeclaRenta

## Project Overview

DeclaRenta converts foreign broker reports into Spanish tax declarations (Modelo 100, 720, 721, D-6). Browser-first, privacy-focused. All financial data stays on the user's machine.

- **Domain**: [declarenta.com](https://declarenta.com) (Cloudflare, Namecheap registrar)
- **Alt URL**: [geiserx.github.io/DeclaRenta](https://geiserx.github.io/DeclaRenta/)
- **Docker**: `drumsergio/declarenta` on Docker Hub
- **Prod**: geiserback:3080 (manual `docker run`, NOT Portainer)

### Supported Brokers (8)

IBKR (XML), Degiro (CSV), eToro (XLSX), Scalable Capital (CSV), Freedom24 (JSON), Coinbase (CSV), Binance (CSV), Kraken (CSV)

## Architecture

```
src/
  types/         TypeScript interfaces (broker, tax, ECB, IBKR)
  parsers/       Broker-specific parsers (8 brokers + auto-detect)
    index.ts     detectBroker() auto-detection, brokerParsers registry
    ibkr.ts      IBKR Flex Query XML
    degiro.ts    Degiro CSV (auto-detect delimiter)
    etoro.ts     eToro XLSX (6+ header variants)
    scalable.ts  Scalable Capital CSV
    freedom24.ts Freedom24 JSON
    coinbase.ts  Coinbase CSV
    binance.ts   Binance CSV
    kraken.ts    Kraken CSV
  engine/        Core calculation modules
    fifo.ts      FIFO cost basis engine (Art. 37.2 LIRPF)
    ecb.ts       ECB exchange rate fetcher (SDMX API)
    wash-sale.ts Anti-churning rule detector (Art. 33.5.f LIRPF, 2 months)
    dividends.ts Dividend + withholding tax processor
    double-taxation.ts  Double taxation deduction (Art. 80 LIRPF, Casilla 0588)
    dates.ts     Date normalization utilities
  generators/    Output generators
    report.ts    Modelo 100 casilla mapper
    modelo720.ts AEAT 720 fixed-width file (500 bytes/record, ISO-8859-15)
    d6.ts        D-6 report generator (AFORIX format)
    csv.ts       CSV export
  cli/           CLI entry point (commander)
  web/           Browser UI (Vite, vanilla TS)
    main.ts        Entry point, splash screen, wizard orchestration, file upload
    sidebar.ts     Hash-based routing (#perfil, #renta, #m720, #d6), mobile toggle
    profile.ts     Fiscal profile form (NIF, name, CCAA, phone, year → localStorage)
    broker-guides.ts  Visual broker card grid + step-by-step download guides
    section-720.ts    Modelo 720 section (threshold bar, positions, filing guide)
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
- 4 sections: Perfil fiscal, Modelo 100 (Renta), Modelo 720, Modelo D-6
- Hash-based routing (`location.hash`): `#perfil`, `#renta`, `#m720`, `#d6`
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

### Release Flow
1. Merge PR to main
2. Auto Release workflow creates semver tag (e.g. `v0.15.6`)
3. Docker workflow does NOT auto-trigger on tags — must manually trigger: `gh workflow run docker.yml --ref <tag>`
4. Deploy: `ssh root@geiserback.mango-alpha.ts.net "docker pull drumsergio/declarenta:<version> && docker stop declarenta-web && docker rm declarenta-web && docker run -d --name declarenta-web -p 3080:80 --restart unless-stopped drumsergio/declarenta:<version>"`

### Docker Tag Format
- Tags are version without `v` prefix and without `web-` prefix: `drumsergio/declarenta:0.15.6`
- Container name on geiserback: `declarenta-web`

### GitHub Pages
- Auto-deploys on merge to main via `Deploy to GitHub Pages` workflow
- Serves at geiserx.github.io/DeclaRenta and declarenta.com (Cloudflare CNAME)

## Critical Rules

### Financial Precision
- **ALWAYS** use `Decimal` from `decimal.js` for any monetary calculation
- **NEVER** use JavaScript `Number` for amounts, rates, or prices
- **ALWAYS** use ECB official rates (via `getEcbRate()`), never IBKR's `fxRateToBase`

### Privacy
- **NEVER** add network calls that transmit user financial data
- **NEVER** log financial amounts, NIF, or personal information
- The only permitted outbound request is to the ECB SDMX API for exchange rates

### Spanish Tax Law References
- **Art. 37.2 LIRPF**: FIFO mandatory for homogeneous securities
- **Art. 33.5.f LIRPF**: Anti-churning rule — losses blocked if same security repurchased within 2 months
- **Art. 80 LIRPF**: Double taxation deduction — lesser of foreign tax paid or Spanish tax due
- **Casillas**: 0327-0328 (capital gains), 0029 (dividends), 0032-0033 (interest), 0588 (double taxation)

### AEAT Formats
- **Modelo 100**: No file import in Renta Web. Tool generates casilla values for manual entry. XSD published annually (`Renta20XX.xsd`).
- **Modelo 720**: Fixed-width text file, 500 bytes/record, ISO-8859-15 encoding. Submitted via TGVI.
- **Modelo D-6**: Similar fixed-width format. Deadline: January 31.

### Adding a New Broker Parser
1. Create `src/parsers/<broker>.ts`
2. Implement a function that returns `FlexStatement`-compatible output (reuse the same types)
3. Add tests in `tests/parsers/<broker>.test.ts` with anonymized fixture data
4. Export from `src/index.ts`

### ECB Rate Handling
- ECB publishes rates as "1 EUR = X FCY"
- We store the inverse: "1 FCY = X EUR" for direct multiplication with broker amounts
- Weekends/holidays: walk backward up to 10 business days
- Rate source: `https://data-api.ecb.europa.eu/service/data/EXR`

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
