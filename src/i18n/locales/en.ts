/** English */
import type { TranslationKeys } from "./es.js";

const en: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Foreign broker → Spanish tax return",


  "upload.title": "Upload your broker report",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detect",
  "upload.drop_text": "Drag your file here or click to select",
  "upload.formats_help": "Formats: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "2. Configure",
  "config.year_label": "Tax year:",
  "config.process_btn": "Process",
  "config.processing": "Processing...",

  "results.title": "Results for Modelo 100",
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

  "footer.docs": "Documentation",
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

  // Wizard steps
  "wizard.step1": "Upload files",
  "wizard.step2": "Review data",
  "wizard.step3": "Configure",
  "wizard.step4": "Results",
  "wizard.next": "Next",
  "wizard.back": "Back",
  "wizard.step_indicator": "Step {{current}} of {{total}}",

  // Review step
  "review.title": "Loaded data summary",
  "review.broker": "Broker",
  "review.trades_count": "Trades",
  "review.dividends_count": "Dividends",
  "review.date_range": "Date range",
  "review.currencies": "Currencies",
  "review.no_data": "No transactions detected in the uploaded files.",
  "review.file": "File",

  // Config step
  "config.nif_label": "NIF (for Modelo 720/D-6):",
  "config.nif_placeholder": "12345678A",
  "config.generate_720": "Generate Modelo 720 file",
  "config.generate_d6": "Generate D-6 guide",

  // Expandable casillas
  "casilla.expand": "Show detail",
  "casilla.collapse": "Hide detail",
  "casilla.operations_in": "Transactions in this box",
  "casilla.no_operations": "No transactions",

  // Year comparison
  "compare.title": "Annual comparison",
  "compare.no_data": "Process at least 2 tax years to see the comparison.",
  "compare.year": "Tax year",
  "compare.variation": "Variation",
  "compare.saved_reports": "Saved reports",
  "compare.clear_history": "Clear history",
  "compare.clear_confirm": "Delete all saved reports?",

  "error.no_broker_detected": "Could not detect broker for \"{{filename}}\". Select the broker manually.",
  "error.prefix": "Error: ",

  "status.fetching_rates": "Fetching ECB rates for {{currencies}}...",
  "status.files_processed": "{{count}} file(s) processed — {{brokers}} — {{trades}} transactions",

  // Sidebar navigation
  "sidebar.profile": "Tax profile",
  "sidebar.renta": "Modelo 100 (Income tax)",
  "sidebar.m720": "Modelo 720",
  "sidebar.d6": "Modelo D-6",
  "sidebar.toggle": "Toggle menu",

  // Fiscal profile
  "profile.title": "Tax profile",
  "profile.description": "This data is used to generate the Modelo 720 and D-6 files.",
  "profile.nif_label": "NIF/NIE:",
  "profile.surname_label": "Surname:",
  "profile.surname_placeholder": "Smith Jones",
  "profile.name_label": "First name:",
  "profile.name_placeholder": "John",
  "profile.ccaa_label": "Autonomous Community:",
  "profile.phone_label": "Phone:",
  "profile.phone_placeholder": "600123456",
  "profile.saved": "Profile saved",
  "profile.incomplete_banner": "Complete your tax profile to generate Modelo 720 and D-6 files.",
  "profile.go_to_profile": "Go to profile",

  // Broker guides
  "guide.title": "How to get the report?",
  "guide.tip_fifo": "Include the full history — DeclaRenta needs past trades for correct FIFO calculation.",

  // Modelo 720 section
  "m720.title": "Modelo 720 — Foreign assets declaration",
  "m720.description": "Informative declaration on assets and rights located abroad.",
  "m720.threshold_exceeded": "Based on your positions ({{amount}} EUR), you are required to file Modelo 720.",
  "m720.threshold_not_exceeded": "You are below the 50,000 EUR threshold (total: {{amount}} EUR). Filing is not required.",
  "m720.no_positions": "Upload a report with open positions in Modelo 100 to analyze Modelo 720.",
  "m720.positions_title": "Declarable positions",
  "m720.generate_btn": "Generate Modelo 720 file",
  "m720.deadline": "Deadline: January 1 – March 31 of the following year",
  "m720.total_value": "Total value: {{amount}} EUR",
  "m720.filing_title": "How to file?",

  // Modelo D-6 section
  "d6.title": "Modelo D-6 — Foreign investments declaration",
  "d6.description": "Declaration to the Investment Registry of the Ministry of Economy.",
  "d6.no_minimum": "D-6 is mandatory for ANY amount. There is no minimum threshold.",
  "d6.no_positions": "Upload a report with open positions in Modelo 100 to analyze D-6.",
  "d6.positions_title": "Positions to declare",
  "d6.cancellations_title": "Cancellations",
  "d6.generate_btn": "Generate D-6 guide",
  "d6.deadline": "Deadline: January 1 – 31 of the following year",
  "d6.total_value": "Total value: {{amount}} EUR",
  "d6.aforix_title": "AFORIX step-by-step guide",
  "d6.copy_btn": "Copy",
  "d6.copied": "Copied",

  // Badge statuses
  "badge.complete": "Complete",
  "badge.pending": "Pending",
  "badge.not_applicable": "N/A",
  "badge.generated": "Generated",
};

export default en;
