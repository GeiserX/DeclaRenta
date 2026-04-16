/** English */
import type { TranslationKeys } from "./es.js";

const en: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Foreign broker → Spanish tax return",
  "app.privacy": "Self-hosted. Your data never leaves your device.",

  "upload.title": "1. Upload your broker report",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detect",
  "upload.drop_text": "Drag your file here or click to select",
  "upload.formats_help": "Formats: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "2. Configure",
  "config.year_label": "Tax year:",
  "config.process_btn": "Process",
  "config.processing": "Processing...",

  "results.title": "3. Results for Modelo 100",
  "results.operations": "Transactions",
  "results.dividends": "Dividends",
  "results.no_dividends": "No dividends",
  "results.search_placeholder": "Search by ISIN or symbol...",
  "results.filter_all": "All",
  "results.filter_gains": "Gains",
  "results.filter_losses": "Losses",
  "results.export_json": "Export JSON",
  "results.export_csv": "Export CSV",
  "results.operations_count": "{{count}} transaction(s)",
  "results.dividends_count": "{{count}} dividend(s)",

  "table.isin": "ISIN",
  "table.symbol": "Symbol",
  "table.buy_date": "Buy Date",
  "table.sell_date": "Sell Date",
  "table.units": "Units",
  "table.cost_eur": "Cost EUR",
  "table.proceeds_eur": "Proceeds EUR",
  "table.gain_loss_eur": "G/L EUR",
  "table.days": "Days",
  "table.date": "Date",
  "table.gross_eur": "Gross EUR",
  "table.withholding_eur": "WHT EUR",
  "table.country": "Country",
  "table.casilla": "Box",
  "table.concept": "Concept",
  "table.amount_eur": "Amount (EUR)",

  "casilla.transmission_value": "Transmission value",
  "casilla.acquisition_value": "Acquisition value",
  "casilla.net_gain_loss": "Net gain/loss",
  "casilla.gross_dividends": "Gross dividends",
  "casilla.interest_earned": "Interest earned",
  "casilla.interest_paid": "Interest paid (margin)",
  "casilla.double_taxation": "Double taxation deduction",
  "casilla.blocked_losses": "Losses blocked by anti-churning rule (2 months): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} warning(s)",

  "chart.asset_distribution": "Asset distribution",
  "chart.monthly_gl": "Monthly gain/loss",
  "chart.currency_composition": "Currency composition",
  "chart.withholdings_country": "Withholdings by country",

  "footer.privacy": "Self-hosted · Total privacy",
  "footer.disclaimer": "Legal notice",

  "disclaimer.title": "Legal notice",
  "disclaimer.text": "This tool is for informational purposes only and does not constitute tax or legal advice. The generated results must be verified by the user and/or a qualified professional before being used in any tax filing.\n\nDeclaRenta is not responsible for errors, omissions, or the consequences arising from the use of this information. The user is solely responsible for the accuracy of the data entered and the declarations filed with the Spanish Tax Agency (AEAT).\n\nExchange rates are sourced from the European Central Bank (ECB). Tax calculations are based on current legislation (LIRPF, Wealth Tax Act, Order EHA/3290/2008) but may not cover all scenarios or reflect regulatory changes after the last software update.",
  "disclaimer.accept": "Understood",

  "a11y.skip_link": "Skip to content",
  "a11y.nav_label": "Settings",
  "a11y.lang_label": "Language",
  "a11y.theme_toggle": "Toggle theme",
  "a11y.drop_zone": "File upload area",
  "a11y.file_input": "Select files",

  "theme.toggle": "Toggle theme",

  "error.no_broker_detected": "Could not detect broker for \"{{filename}}\". Select the broker manually.",
  "error.prefix": "Error: ",

  "status.fetching_rates": "Fetching ECB rates for {{currencies}}...",
  "status.files_processed": "{{count}} file(s) processed — {{brokers}} — {{trades}} transactions",
};

export default en;
