/** English */
import type { TranslationKeys } from "./es.js";

const en: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Foreign broker → Spanish tax return",

  "upload.title": "Upload your broker report",
  "upload.broker_question": "Which broker(s) do you use?",
  "upload.broker_hint": "Select one or more. We'll guide you step by step.",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detect",
  "upload.drop_text": "Drag your file here or click to select",
  "upload.formats_help":
    "Formats: XML (IBKR Flex), CSV (Degiro, Flatex, Trade Republic, Scalable, Lightyear, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro, Revolut)",
  "upload.autodetect_note": "The broker is detected automatically in most cases.",
  "upload.detecting": "Analysing file...",
  "upload.detected": "Broker detected:",
  "upload.detection_failed": "Could not detect the broker. Please select it manually.",
  "upload.broker_not_detected": "Broker not detected?",
  "upload.guide_how": "How to download my broker report?",
  "upload.guide_select_broker": "Select your broker:",
  "upload.choose_broker": "— choose broker —",
  "upload.guide_unavailable": "Guide not yet available for this broker.",
  "upload.chip_group_label": "Manual broker selection",

  "config.title": "Configure",
  "config.process_btn": "Process",
  "config.processing": "Processing...",

  "results.title": "Results for Modelo 100",
  "results.operations": "Transactions",
  "results.dividends": "Dividends",
  "results.no_dividends": "No dividends",
  "results.search_placeholder": "Search by ISIN or symbol...",
  "results.search_placeholder_brokers": "Search by ISIN, symbol or broker...",
  "results.filter_all": "All",
  "results.filter_gains": "Gains",
  "results.filter_losses": "Losses",
  "results.export_json": "Export JSON",
  "results.export_csv": "Export CSV",
  "results.export_csv_title": "Comma separator and point decimals: for scripts and English-locale spreadsheets",
  "results.export_csv_excel": "Export CSV for Excel (ES)",
  "results.export_csv_excel_title": "Semicolon separator and comma decimals: opens in columns with a double-click in Spanish-locale Excel",
  "results.export_pdf": "Export PDF",
  "results.operations_count": "{{count}} transaction(s)",
  "results.dividends_count": "{{count}} dividend(s)",
  "results.newer_years_notice": "Showing {{year}}; your data also covers {{years}}.",
  "results.year_mismatch":
    "The file contains data for tax years {{available}}, but the selected year is {{year}}. Select another year from the dropdown above.",
  "results.setting_yes": "yes",
  "results.setting_no": "no",

  "table.isin": "ISIN",
  "table.symbol": "Symbol",
  "table.buy_date": "Buy Date",
  "table.sell_date": "Sell Date",
  "table.buy_broker": "Buy Broker",
  "table.sell_broker": "Sell Broker",
  "table.units": "Units",
  "table.cost_eur": "Cost EUR",
  "table.proceeds_eur": "Proceeds EUR",
  "table.gain_loss_eur": "G/L EUR",
  "table.days": "Days",
  "table.date": "Date",
  "table.gross_eur": "Gross EUR",
  "table.withholding_eur": "WHT EUR",
  "table.country": "Country",
  "table.payments": "Payments",
  "casilla.dividends_by_issuer": "Dividends by issuer",
  "casilla.dividends_per_payment": "Individual payments",
  "casilla.dividends_withholding_note": "<strong>Foreign</strong> withholding tax is not declared here: in the AEAT Renta Web \"Alta Capital mobiliario\" form, leave it at 0 and deduct it in box 0588 (international double taxation, Art. 80 LIRPF). But <strong>Spanish</strong> withholding on Spanish issuers (ISIN ES…) is a prepayment and goes in box 0597.",
  "table.casilla": "Box",
  "table.concept": "Concept",
  "table.amount_eur": "Amount (EUR)",
  "table.currency": "Currency",
  "table.fx_origin": "Source",
  "table.fx_lot": "FIFO lot",
  "fx.trigger.conversion": "Currency conversion",
  "fx.trigger.dividend": "Dividend",
  "fx.trigger.interest": "Interest",
  "fx.trigger.commission": "Commission",
  "fx.trigger.stock_purchase": "Securities purchase",
  "fx.trigger.stock_sale": "Currency lost in a losing sale",
  "fx.trigger.stock_sale_guard": "Currency change up to the share purchase",
  "fx.trigger.stock_sale_cross": "Currency invested in shares sold in another currency",
  "fx.trigger.loan_repayment": "Repayment of a currency loan from the broker",

  "casilla.listed_transmission_value": "Transmission value (listed shares)",
  "casilla.listed_acquisition_value": "Acquisition value (listed shares)",
  "casilla.acquisition_sale_rate_note":
    "The acquisition value is shown at the ECB rate on the SALE date, so transmission − acquisition equals the gain or loss exactly (DGT V2422-20: the gain is computed in the share's currency and only the difference is converted to euros). For foreign-currency holdings this differs from the historical euro cost at the purchase date and may not match figures saved in earlier versions.",
  "casilla.other_transmission_value": "Transmission value (other elements: options/crypto/funds/FX)",
  "casilla.other_acquisition_value": "Acquisition value (other elements: options/crypto/funds/FX)",
  "casilla.fx_transmission_value": "FX transmission value (foreign currency)",
  "casilla.fx_acquisition_value": "FX acquisition value (foreign currency)",
  "casilla.fx_cost_split": "{{fx}} € currency cost and {{shift}} € of drift already declared in the share",
  "casilla.fx_net_gain_loss": "FX net gain/loss (foreign currency)",
  "casilla.net_gain_loss": "Net gain/loss (asset disposals)",
  "casilla.gross_dividends": "Gross dividends",
  "casilla.interest_earned": "Interest earned",
  "casilla.interest_paid": "Interest paid to broker (margin, not deductible — informational)",
  "casilla.general_gains": "Capital gains not arising from transmission (airdrops, referral commissions)",
  "casilla.spanish_withholding": "Capital-income withholdings (box 0597)",
  "casilla.spanish_withholding_detail":
    "Spanish IRPF withholding applied at source on dividends or interest from Spanish issuers (e.g. IBEX shares), even when held at a foreign broker. It is a prepayment deductible from the tax due; it is NOT the double-taxation deduction (box 0588), which applies only to foreign tax.",
  "casilla.double_taxation": "Double taxation deduction",
  "casilla.dt_foreign_income_total": "Total foreign income",
  "casilla.reintegrated_losses":
    "Deferred losses now deductible (shares sold with no repurchase in their window, «transmisión definitiva»; for crypto, sale of the coins bought back): {{amount}} EUR",
  "casilla.blocked_losses": "Losses blocked by anti-churning rule (2 months on a regulated or equivalent market / 1 year otherwise; for crypto, the year after the sale): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} warning(s)",
  "messages.errors_title": "{{count}} error(s) — action required",
  "messages.warnings_title": "{{count}} warning(s) — please review",
  "messages.info_title": "{{count}} informational note(s)",
  "pdf.severity_error": "Error",
  "pdf.severity_warning": "Warning",
  "pdf.severity_info": "Note",
  "pdf.section_messages": "Messages",

  "chart.asset_distribution": "Asset distribution",
  "chart.monthly_gl": "Monthly gain/loss",
  "chart.currency_composition": "Currency composition",
  "chart.withholdings_country": "Withholdings by country",
  "chart.month_1": "Jan",
  "chart.month_2": "Feb",
  "chart.month_3": "Mar",
  "chart.month_4": "Apr",
  "chart.month_5": "May",
  "chart.month_6": "Jun",
  "chart.month_7": "Jul",
  "chart.month_8": "Aug",
  "chart.month_9": "Sep",
  "chart.month_10": "Oct",
  "chart.month_11": "Nov",
  "chart.month_12": "Dec",
  "asset.stk": "Stocks",
  "asset.fund": "Funds / ETFs",
  "asset.opt": "Options",
  "asset.fop": "Futures options",
  "asset.crypto": "Cryptocurrencies",
  "asset.bond": "Bonds",
  "option.expiration": "Expiration",
  "option.close": "Early close",
  "option.exercise": "Exercise/Assignment",

  "footer.docs": "Documentation",
  "footer.privacy": "Self-hosted · Total privacy",
  "footer.disclaimer": "Legal notice",

  "disclaimer.title": "Legal notice",
  "disclaimer.text":
    "This tool is for informational purposes only and does not constitute tax or legal advice. The generated results must be verified by the user and/or a qualified professional before being used in any tax filing.\n\nDeclaRenta is not responsible for errors, omissions, or the consequences arising from the use of this information. The user is solely responsible for the accuracy of the data entered and the declarations filed with the Spanish Tax Agency (AEAT).\n\nExchange rates are sourced from the European Central Bank (ECB). Tax calculations are based on current legislation (LIRPF, Wealth Tax Act, Order EHA/3290/2008) but may not cover all scenarios or reflect regulatory changes after the last software update.",
  "disclaimer.accept": "Understood",

  "a11y.skip_link": "Skip to content",
  "a11y.nav_label": "Settings",
  "a11y.lang_label": "Language",
  "a11y.theme_toggle": "Toggle theme",
  "a11y.drop_zone": "File upload area",
  "a11y.file_input": "Select files",
  "a11y.ops_search": "Search operations by ISIN or symbol",
  "a11y.ops_search_brokers": "Search operations by ISIN, symbol or broker",
  "a11y.ops_filter": "Filter operations by result",
  "a11y.remove_file": "Remove {{name}}",

  "theme.toggle": "Toggle theme",

  // Wizard steps
  "wizard.step1": "Upload files",
  "wizard.step2": "Review and choose method",
  "wizard.step3": "Results",
  "wizard.next": "Next",
  "wizard.back": "Back",

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
  "casilla.copy": "Copy amount",
  "casilla.copied": "Copied!",

  // Year comparison
  "compare.title": "Annual comparison",
  "compare.no_data": "Process at least 2 tax years to see the comparison.",
  "compare.year": "Tax year",
  "compare.variation": "Variation",
  "compare.saved_reports": "Saved reports",
  "compare.clear_history": "Clear history",
  "compare.clear_confirm": "Delete all saved reports?",
  "compare.transmission_value": "Transmission value (disposals, excl. FX)",
  "compare.acquisition_value": "Acquisition value (disposals, excl. FX)",
  "compare.net_gain_loss": "Net gain/loss (disposals, excl. FX)",

  "error.no_broker_detected":
    'Could not detect the broker for "{{filename}}". If it is a broker report, select the broker manually; if not, remove it from the list.',
  "error.empty_file":
    'The file "{{filename}}" is empty. Remove it from the list or export it again from your broker.',
  "error.file_too_large":
    'File "{{filename}}" exceeds the {{limit}} MB limit and was discarded. Export a shorter period or split the file.',
  "error.prefix": "Error: ",

  "status.fetching_rates": "Fetching ECB rates for {{currencies}}...",
  "status.files_processed": "{{count}} file(s) processed — {{brokers}} — {{trades}} transactions",

  // Sidebar navigation
  "sidebar.profile": "Tax profile",
  "sidebar.renta": "Modelo 100 (Income tax)",
  "sidebar.m720": "Modelo 720",
  "sidebar.m721": "Modelo 721",
  "sidebar.d6": "Modelo D-6",
  "sidebar.toggle": "Toggle menu",

  // Fiscal profile
  "profile.title": "Tax profile",
  "profile.description": "This data is used to generate the Modelo 720 and D-6 files. It is stored only in this browser, never on a server.",
  "profile.section_personal": "Personal details",
  "profile.nif_label": "NIF/NIE:",
  "profile.nif_placeholder": "12345678Z",
  "profile.nif_invalid": "This NIF/NIE is not valid: check the digits and the control letter.",
  "profile.surname_label": "Surname:",
  "profile.surname_placeholder": "Smith Jones",
  "profile.name_label": "First name:",
  "profile.name_placeholder": "John",
  "profile.ccaa_label": "Autonomous Community:",
  "profile.phone_label": "Phone:",
  "profile.phone_placeholder": "600123456",
  "review.autoconvert_label": "Process broker auto-conversions (AFx/FXCONV)",
  "review.autoconvert_detail":
    "On by default. Interactive Brokers does not convert back to euros when you sell a stock, so the currency balance is real and converting it later produces a capital gain or loss (Art. 33.1 LIRPF). Turn it off only if your broker does a full EUR↔currency round-trip and you want to ignore the currency effect.",
  "review.titulares_label": "Number of account holders:",
  "review.titulares_detail":
    "If the account has several holders (e.g. a joint or community-property account), DeclaRenta divides every amount equally to show each taxpayer's share (Art. 11.3 LIRPF). Each holder files their own individual return for their share.",
  "profile.saved": "Profile saved",
  "profile.clear_btn": "Delete my data from this browser",
  "profile.clear_confirm": "Delete your fiscal profile, saved reports and manually entered values from this browser?",
  "profile.incomplete_banner": "Complete your tax profile to generate Modelo 720 and D-6 files.",
  "profile.go_to_profile": "Go to profile",

  // FX method (#434): review step, results header, comparison
  "method.multidivisa.sub": "The gain is computed in the share's currency",
  "method.multidivisa.text": "Computes each share's gain in its currency and converts it to euros at the sale-date rate. The currency you hold keeps what it cost you in euros. Its exchange difference appears when you convert it to euros or to another currency.",
  "method.multidivisa.basis": "Legal basis: the tax authority's criterion for shares (DGT V1740-17, V2422-20, V0282-22).",
  "method.tradicional_divisa.sub": "Buy and sale at their own rates, and your currency by FIFO",
  "method.tradicional_divisa.text": "Shares are valued at the ECB rate of the purchase date and of the sale date. Currency is taxed only when it leaves your account: when you convert it to euros or to another currency, pay fees, or lose it in a losing sale. What you already declared inside the shares is not counted again.",
  "method.tradicional_divisa.basis": "Share valuation: the DGT criterion for foreign-currency fund units (V2324-10, V0775-21), applied to shares. Currency: declared when you convert it (V2466-08) or lose it in a losing sale (V0775-21, V2324-10).",
  "method.tradicional_divisa.risk": "The tax authority applies the «DGT criterion (multi-currency)» to shares (V1740-17). In 2025 it rejected this same calculation for a flat bought and sold in dollars (V1615-25). If it reviews your return, it may recompute it with that criterion. With no losing sales, the total of a full cycle is usually almost the same; what changes is the year and the box where each part appears.",
  "method.monodivisa.sub": "Only buy and sale at their own rates",
  "method.monodivisa.text": "Values the purchase at the purchase-date rate and the sale at the sale-date rate. Computes no currency result at all, neither for your conversions to euros nor for the broker's automatic ones.",
  "method.monodivisa.basis": "Legal basis: Art. 35.1 LIRPF, without the currency rule of Art. 14.2.e. If you convert currency to euros, it can distort the result.",
  "method.monodivisa.risk": "This method does not declare the result of your currency conversions to euros. Use it only if you do not convert currency.",
  "method.unknown": "unknown",
  "review.method_title": "How should we compute your foreign-currency shares?",
  "review.method_lead": "You have operations in {{currencies}}. The method changes the figures of your return. Choose one and keep it every year.",
  "review.method_recommended": "Recommended",
  "review.method_last_year": "In {{year}} you used «{{method}}».",
  "review.method_last_year_switch": "In {{year}} you used «{{method}}». If you switch methods while you still hold currency from then, part of the result may be counted twice or lost. Use the same method every year.",
  "review.other_settings": "Other calculation settings",
  "review.autoconvert_off_mono": "Does not apply with «Traditional without currency (single-currency)», because that method computes no currency.",
  "review.calculate": "Calculate",
  "review.calculate_with": "Calculate with «{{method}}»",
  "review.show_details": "Show details",
  "results.method_chip": "Method: {{method}}",
  "results.method_change": "Change",
  "results.method_change_aria": "Change the calculation method",
  "results.titulares_one": "1 holder",
  "results.titulares_many": "{{count}} holders",
  "results.autoconvert_chip": "Auto-conversions: {{value}}",
  "results.how_title": "How it was calculated",
  "results.split_shares": "Shares",
  "results.split_shares_sub": "boxes 0328 and 0331",
  "results.split_securities": "Shares and other assets",
  "results.split_securities_sub": "boxes 0328 and 0331, and part of 1633 and 1637",
  "results.split_fx": "Currency",
  "results.split_fx_sub": "included in 1633 and 1637",
  "results.split_fx_off": "not computed with this method",
  "results.split_total": "Total",
  "results.split_total_sub": "to the savings base · estimated tax {{tax}} €",
  "results.compare_title": "Compare with the other methods (to match another tool)",
  "results.compare_in_use": "In use",
  "results.compare_tax": "Estimated tax",
  "results.compare_note": "For information only. To change the method, go back to «Review and choose method».",
  "results.compare_loading": "Calculating…",
  "results.compare_error": "The comparison could not be calculated.",
  "casilla.acquisition_buy_rate_note_fx": "The acquisition value is shown at the ECB exchange rate of the PURCHASE date, as the «Traditional with currency» method requires. Transmission − acquisition is the share's gain or loss in euros. The currency result is separate, in boxes 1633 and 1637.",
  "casilla.acquisition_buy_rate_note_mono": "The acquisition value is shown at the ECB exchange rate of the PURCHASE date, as the «Traditional without currency (single-currency)» method requires. Transmission − acquisition is the share's gain or loss in euros. This method computes no currency result.",
  "casilla.no_other_elements_fx_below": "No other assets. The currency result is below.",
  "compare.method": "Method",
  "compare.method_mismatch": "These years use different methods. If you switch methods while you still hold currency from an earlier year, part of the result may be counted twice or lost.",
  "profile.autosave": "Changes are saved automatically in this browser.",
  "profile.method_moved": "The currency method, the account holders and the auto-conversions are now chosen in Modelo 100, at the «Review and choose method» step.",
  "profile.go_to_renta": "Go to Modelo 100",

  // Broker guides
  "guide.title": "How to get the report?",
  "guide.tip_fifo": "Include the full history — DeclaRenta needs past trades for correct FIFO calculation.",
  "guide.select_broker_hint": "Select your broker to see report download instructions.",
  "guide.heading": "How to get your broker report",
  "guide.ibkr.title": "Interactive Brokers (Flex Query XML)",
  "guide.ibkr.step1": "Log in to the IBKR <strong>Client Portal</strong>",
  "guide.ibkr.step2": "Go to <strong>Performance & Reports</strong> → <strong>Flex Queries</strong> tab",
  "guide.ibkr.step3": "In <strong>Activity Flex Query</strong>, click the <strong>+</strong> to create a new query",
  "guide.ibkr.step4":
    "In the configuration, enable:<ul><li>Trades (required)</li><li>Cash Transactions — dividends and withholdings (required)</li><li>Open Positions — for Modelo 720/D-6 (recommended)</li><li>Financial Instrument Information / Securities Info (recommended)</li></ul>",
  "guide.ibkr.step5":
    "In each section, <strong>select all available fields</strong> (check every box). The more data you include, the more accurate the calculation. At minimum, ensure the <strong>Notes</strong> field is included in Trades — it's needed to detect automatic currency conversions.",
  "guide.ibkr.step6": "Output format: <strong>XML</strong>. Under <em>Date Format</em>, keep <strong>yyyyMMdd</strong>",
  "guide.ibkr.step7": "Include <strong>all available years</strong> for correct FIFO calculation",
  "guide.ibkr.step8": "Save the query, run it and download the <code>.xml</code> file",
  "guide.degiro.title": "Degiro (CSV)",
  "guide.degiro.step1": "Log in to the <strong>Degiro website</strong> (not the app)",
  "guide.degiro.step2": "Open the <strong>Inbox</strong> side panel (envelope icon)",
  "guide.degiro.step3": "Click <strong>Transactions</strong> (transaction history for your products)",
  "guide.degiro.step4": "Select the desired date range (include <strong>all history</strong> for FIFO)",
  "guide.degiro.step5": "Click <strong>Export</strong> and download the CSV file",
  "guide.degiro.step6":
    "For dividends: go back to <strong>Inbox</strong> → <strong>Account</strong> (account movement history) → same date range → <strong>Export</strong> CSV",
  "guide.flatex.title": "Flatex (CSV)",
  "guide.flatex.step1": "Log in to the <strong>Flatex website</strong>",
  "guide.flatex.step2": "Go to <strong>Transactions</strong> → <strong>Depotumsätze</strong> (portfolio movements)",
  "guide.flatex.step3": "Select <strong>the full history</strong> (needed for FIFO) and export the CSV file",
  "guide.flatex.step4":
    "For dividends: go to <strong>Kontoumsätze</strong> (account movements), same date range, and export the CSV. Note: dividends there show the net amount, after withholding; take the gross amount and the withholding from each dividend's PDF statement",
  "guide.flatex.step5":
    "Upload <strong>both CSV files</strong> (Depotumsätze for trades and Kontoumsätze for dividends)",
  "guide.etoro.title": "eToro (XLSX)",
  "guide.etoro.step1": "Log in to <strong>eToro</strong>",
  "guide.etoro.step2": "Go to <strong>Settings → Account Statement</strong>",
  "guide.etoro.step3": "Select the tax year period",
  "guide.etoro.step4": "Download the <strong>XLSX</strong> (Excel) file",
  "guide.scalable.title": "Scalable Capital (CSV)",
  "guide.scalable.step1": "Log in to <strong>Scalable Capital</strong>",
  "guide.scalable.step2": "Go to <strong>Profile → Tax Documents</strong>",
  "guide.scalable.step3": "Download the transaction report in <strong>CSV</strong> format",
  "guide.freedom24.title": "Freedom24 (JSON)",
  "guide.freedom24.step1": "Log in to the <strong>Freedom24 web platform</strong>",
  "guide.freedom24.step2": "Go to <strong>Reports → Operations Report</strong>",
  "guide.freedom24.step3": "Select the period and <strong>JSON</strong> format",
  "guide.freedom24.step4": "Download the file",
  "guide.coinbase.title": "Coinbase (CSV)",
  "guide.coinbase.step1": "Log in to <strong>Coinbase</strong>",
  "guide.coinbase.step2": "Go to <strong>Taxes → Documents</strong>",
  "guide.coinbase.step3": "Click <strong>Generate report</strong>",
  "guide.coinbase.step4": "Download the transaction history in CSV format",
  "guide.binance.title": "Binance (CSV)",
  "guide.binance.step1": "Log in to <strong>Binance</strong>",
  "guide.binance.step2":
    "<strong>Spot trade history:</strong> Orders → Spot Order → Export Trade History (↑) → Spot - Trade History → Custom time (UTC+1) → CSV",
  "guide.binance.step3":
    "<strong>Transaction history:</strong> Orders → Asset History → Export Transaction Records (↑) → Transaction History → Custom time (UTC+1) → CSV",
  "guide.binance.step4": "You can upload one or both files — both English and Spanish exports are supported",
  "guide.kraken.title": "Kraken (CSV)",
  "guide.kraken.step1": "Log in to <strong>Kraken</strong>",
  "guide.kraken.step2": "Go to <strong>History → Export</strong>",
  "guide.kraken.step3": "Select <strong>Trades</strong> and the date range",
  "guide.kraken.step4": "Format: <strong>CSV</strong>, download the file",

  // Trade Republic
  "guide.trade_republic.title": "Trade Republic (CSV)",
  "guide.trade_republic.step1": "Open the <strong>Trade Republic</strong> app",
  "guide.trade_republic.step2": "Go to <strong>Profile → Activity</strong>",
  "guide.trade_republic.step3": "Tap the three dots (⋯) and select <strong>Export</strong>",
  "guide.trade_republic.step4": "Select the date range and <strong>CSV</strong> format",
  "guide.trade_republic.step5": "Download the file and transfer it to your computer",

  // Revolut
  "guide.revolut.title": "Revolut (XLSX)",
  "guide.revolut.step1": "Log in to the <strong>Revolut web app</strong> (app.revolut.com or mobile app)",
  "guide.revolut.step2": "Go to <strong>Trading/Crypto → Statements</strong>",
  "guide.revolut.step3": "Select <strong>Trading Account Statement</strong> for the tax year",
  "guide.revolut.step4": "Download in <strong>XLSX</strong> (Excel) format",

  // Trading 212
  "guide.trading212.title": "Trading 212 (CSV)",
  "guide.trading212.step1": "Log in to the <strong>Trading 212 website</strong>",
  "guide.trading212.step2": "Go to <strong>History → Transactions</strong>",
  "guide.trading212.step3": "Filter by the desired date range",
  "guide.trading212.step4": "Click <strong>Download CSV</strong>",

  // Lightyear
  "guide.lightyear.title": "Lightyear (CSV)",
  "guide.lightyear.step1": "Open the <strong>Lightyear</strong> app",
  "guide.lightyear.step2": "Go to <strong>Profile → Reports</strong>",
  "guide.lightyear.step3": "Select <strong>Transaction report</strong> and the period",
  "guide.lightyear.step4": "Download the CSV file and transfer it to your computer",

  // MEXEM
  "guide.mexem.title": "MEXEM (Flex Query XML)",
  "guide.mexem.step1": "Log in to the <strong>MEXEM Client Portal</strong> (same interface as IBKR)",
  "guide.mexem.step2": "Go to <strong>Performance & Reports</strong> → <strong>Flex Queries</strong> tab",
  "guide.mexem.step3":
    "Create an <strong>Activity Flex Query</strong> including Trades, Cash Transactions and Open Positions",
  "guide.mexem.step4": "Output format: <strong>XML</strong>",
  "guide.mexem.step5": "Run the query and download the <code>.xml</code> file",

  // Swissquote
  "guide.swissquote.title": "Swissquote (CSV)",
  "guide.swissquote.step1": "Log in to <strong>Swissquote eBanking</strong>",
  "guide.swissquote.step2": "Go to <strong>Trading → Transaction History</strong>",
  "guide.swissquote.step3": "Select the date range for the tax year",
  "guide.swissquote.step4": "Click <strong>Export → CSV</strong>",

  // Modelo 720 section
  "m720.title": "Modelo 720 — Foreign assets declaration",
  "m720.description": "Informative declaration on assets and rights located abroad.",
  "m720.threshold_exceeded": "Based on your positions ({{amount}} EUR), you are required to file Modelo 720.",
  "m720.obliged_by_changes": "You must file Modelo 720 because of what changed since your last filing: each category above gives the reason.",
  "m720.declared_account_missing": "An account you declared has no balance this year ({{accounts}}): if you closed it, you must declare the closing by hand (art. 42 bis.5 RGAT).",
  "m720.threshold_not_exceeded":
    "You are below the 50,000 EUR threshold (total: {{amount}} EUR). Filing is not required.",
  "m720.category_v": "Securities (stocks, funds, bonds)",
  "m720.category_c": "Accounts (cash balances)",
  "m720.category_exceeded": "Exceeds 50,000 EUR — filing required",
  "m720.category_not_exceeded": "Below threshold",
  "m720.category_undetermined": "Cannot be determined: {{count}} position(s) not valued",
  "m720.no_positions": "Upload a report with open positions in Modelo 100 to analyze Modelo 720.",
  "m720.brokers_without_holdings": "The {{brokers}} data you uploaded has no positions or balances at 31 December, so they are not counted here. Check the year-end statement from {{brokers}} to see whether your foreign account balances or your foreign shares and funds exceed €50,000.",
  "m720.positions_title": "Declarable positions",
  "m720.positions_unvalued":
    "{{count}} position(s) could not be valued in euros (no market price, or no exchange rate for their currency at year-end) and were excluded from the total. Compute their euro value and include them manually.",
  "m720.cash_title": "Cash balances (Accounts)",
  "m720.q4_average": "Q4 average",
  "m720.cash_missing_average":
    "Some balances do not include the Q4 average required for Modelo 720 account records. Their 31 December balance does count toward the 50,000 EUR threshold, but those accounts are left out of the generated file: add them by hand, with their Q4 average balance, before filing.",
  "m720.omitted_title":
    "These assets do not fit in the file, so declare them by hand in the Modelo 720 form:",
  "m720.omitted_no_isin":
    "it has no ISIN; the form identifies it with “Z” plus the issuer's country code",
  "m720.omitted_no_country":
    "the country where it is deposited or located is missing",
  "m720.omitted_no_account":
    "the account number is missing",
  "m720.omitted_invalid_code":
    "sold this year; last year's Modelo 720 declared it with a code or country the file does not accept",
  "m720.not_generated_left_out":
    "No file was generated: nothing you have to declare can be written to the file. Declare it by hand in the Modelo 720 form, following the notices above.",
  "m720.successive_years_note":
    "If you already filed Modelo 720 in an earlier year, filing again is only required when a category's joint value has risen by more than 20,000 EUR since your last declaration, or when you sold or closed an asset you declared (arts. 42 bis.5 and 42 ter.5 RD 1065/2007). Otherwise filing is optional.",
  "m720.previous_title": "Your last Modelo 720",
  "m720.previous_help": "If you have filed Modelo 720 before, upload the .txt file of your last return. What you already declared gets origin M, what you sold gets origin C (extinction), and the 20,000 EUR rule is applied. The file is read in your browser and is not stored.",
  "m720.previous_loaded": "Loaded {{name}} (tax year {{year}}): {{securities}} securities and {{accounts}} accounts declared.",
  "m720.previous_clear": "Remove",
  "m720.previous_invalid": "This file is not a Modelo 720: it has no detail records.",
  "m720.previous_same_year": "This file is for tax year {{fileYear}}. Upload the Modelo 720 of a year before {{year}}.",
  "m720.origin": "Origin",
  "m720.origin_a": "A (new)",
  "m720.origin_m": "M (already declared)",
  "m720.successive_last": "Last return: {{previous}} EUR. Change: {{change}} EUR.",
  "m720.successive_increase": "Up more than 20,000 EUR: you must declare it again",
  "m720.successive_sold": "You sold securities you declared: you must declare their extinction",
  "m720.successive_optional": "Not up more than 20,000 EUR: declaring it again is optional",
  "m720.successive_not_required": "Based on your last Modelo 720, you do not have to file this year: no category is up more than 20,000 EUR and you sold nothing you declared. You can still file it if you want.",
  "m720.sold_title": "Extinctions: securities sold since your last Modelo 720",
  "m720.sold_help": "The file includes them with origin C, dated and valued by the last sale.",
  "m720.sold_no_date": "no sale of the declared shares in {{year}}: the record has no extinction date and a value of 0; complete it before filing",
  "m720.sold_no_acquisition": "the data does not include its purchase: the record has no acquisition date; complete it before filing",
  "m720.generate_btn": "Generate Modelo 720 file",
  "m720.deadline": "Deadline: January 1 – March 31 of the following year",
  "m720.total_value": "Total value: {{amount}} EUR",
  "m720.filing_title": "How to file?",
  "m720.rates_title": "Applied exchange rates (ECB)",
  "m720.deadline_short": "Deadline: Jan 1 – Mar 31",
  "m720.filing_step1": "Access the AEAT Electronic Office",
  "m720.filing_step2": "Search for «Modelo 720»",
  "m720.filing_step3": "Import the generated file (TGVI Online)",
  "m720.filing_step4": "Review and sign with digital certificate or Cl@ve",

  // Modelo D-6 section
  "d6.title": "Modelo D-6 — Foreign investments declaration",
  "d6.description": "Declaration to the Investment Registry of the Ministry of Economy.",
  "d6.no_minimum":
    "Since Orden ICT/1408/2021, the D-6 is only required if your stake represents <strong>10% or more</strong> of the capital or voting rights of a listed foreign company. Most retail investors are exempt.",
  "d6.no_positions": "Upload a report with open positions in Modelo 100 to analyze D-6.",
  "d6.brokers_without_holdings": "The {{brokers}} data you uploaded has no securities positions at 31 December, so they do not appear here. Look them up in the year-end statement from {{brokers}}.",
  "d6.positions_title": "Positions to declare",
  "d6.positions_unvalued":
    "{{count}} position(s) could not be valued in euros (no market price, or no exchange rate for their currency at year-end) and were excluded from the total. Compute their euro value and include them manually.",
  "d6.cancellations_title": "Cancellations",
  "d6.generate_btn": "Generate D-6 guide",
  "d6.deadline": "Deadline: January 1 – 31 of the following year",
  "d6.total_value": "Total value: {{amount}} EUR",
  "d6.aforix_title": "AFORIX step-by-step guide",
  "d6.copy_btn": "Copy",
  "d6.copied": "Copied",
  "d6.rates_title": "Applied exchange rates (ECB)",
  "d6.deadline_short": "Deadline: Jan 1 – 31",
  "d6.copy_failed": "Copy error",
  "d6.aforix_position_of": "Position {{index}} of {{total}}",

  // Modelo 721 section
  "m721.title": "Modelo 721 — Foreign crypto assets declaration",
  "m721.description": "Informative declaration on virtual currencies held on foreign exchanges.",
  "m721.threshold_exceeded": "Based on your positions ({{amount}} EUR), you are required to file Modelo 721.",
  "m721.threshold_not_exceeded":
    "You are below the 50,000 EUR threshold (total: {{amount}} EUR). Filing is not required.",
  "m721.threshold_undetermined":
    "Cannot tell whether you exceed the 50,000 EUR threshold: the total ({{amount}} EUR) leaves out {{count}} position(s) that could not be valued. Value them before concluding that you do not need to file.",
  "m721.no_positions": "Upload a report with crypto positions in Modelo 100 to analyze Modelo 721.",
  "m721.brokers_without_holdings": "The {{brokers}} data you uploaded has no crypto holdings at 31 December, so they are not counted here. Check the year-end statement from {{brokers}} to see whether your crypto held abroad exceeds €50,000.",
  "m721.positions_title": "Declarable positions",
  "m721.generate_btn": "Generate Modelo 721 file",
  "m721.deadline": "Deadline: January 1 – March 31 of the following year",
  "m721.total_value": "Total value: {{amount}} EUR",
  "m721.filing_title": "How to file?",
  "m721.rates_title": "Applied exchange rates (ECB)",
  "m721.deadline_short": "Deadline: Jan 1 – Mar 31",
  "m721.filing_step1": "Access the AEAT Electronic Office",
  "m721.filing_step2": "Search for «Modelo 721»",
  "m721.filing_step3":
    "Fill in the declaration using the data from the table (official format: XML, Orden HFP/886/2023)",
  "m721.filing_step4": "Review and sign with digital certificate or Cl@ve",
  "m721.exchange": "Exchange",
  "m721.format_notice":
    "The official AEAT format is XML (Orden HFP/886/2023). DeclaRenta only shows an advisory review: official generation is disabled until validated XML output is implemented.",
  "m721.positions_unvalued":
    "{{count}} position(s) could not be valued in euros (no market price, or no exchange rate for their currency at year-end) and were excluded from the total. Compute their euro value and include them manually.",
  "m721.empty_title": "No crypto positions loaded",
  "m721.empty_description":
    "Modelo 721 is a mandatory informative declaration if you hold cryptocurrencies on foreign exchanges valued over 50,000 EUR. Upload your broker report in the Modelo 100 section so DeclaRenta can automatically check if you exceed the threshold. Deadline: January 1 – March 31.",
  "m721.empty_cta": "Go to Modelo 100",
  "m721.profile_required": "Complete your tax profile before generating the Modelo 721 file.",

  "section.year_label": "Tax year",
  "section.profile_source": 'Data from <a href="#perfil">Fiscal profile</a>',
  "section.positions_date_mismatch":
    "The positions in your file are dated {{date}}, not 31/12/{{year}}. These models declare what you held on 31 December, so no file is generated from them. Download a report that ends on 31/12/{{year}} (in IBKR, a Flex Query with end date 31/12/{{year}}) and upload it again.",
  "section.positions_date_unknown":
    "Your broker does not say which date the positions are from. Check that the report shows what you held on 31/12/{{year}}: if you downloaded it later, the positions and their values may not match.",
  "merge.holdings_other_date":
    "Positions and balances of account {{account}} dated {{date}} left out of Modelo 720, 721 and D-6: they are not the ones at 31/12/{{year}}.",
  "merge.holdings_other_date.hint":
    "That file ends on another date. Its trades and transactions still count, but these models declare what you held on 31 December, so its positions and balances are not added. If you are missing that account's report at 31/12/{{year}}, upload it too.",

  "badge.complete": "Complete",
  "badge.pending": "Pending",
  "badge.not_applicable": "N/A",
  "badge.generated": "Generated",

  // Empty states
  "m720.empty_title": "No positions loaded",
  "m720.empty_description":
    "Modelo 720 is a mandatory informative declaration if you hold foreign assets valued over 50,000 EUR. Upload your broker report in the Modelo 100 section so DeclaRenta can automatically check if you exceed the threshold and generate the file. Deadline: January 1 – March 31.",
  "m720.empty_cta": "Go to Modelo 100",
  "d6.empty_title": "No positions loaded",
  "d6.empty_description":
    "Modelo D-6 declares your foreign securities investments to the Ministry of Economy. Since the 2021 reform (Orden ICT/1408/2021), it is only required if your stake represents 10% or more of the capital or voting rights of a listed foreign company. Upload your broker report in the Modelo 100 section and DeclaRenta will generate a step-by-step guide. Deadline: January 1–31.",
  "d6.empty_cta": "Go to Modelo 100",

  // Profile required warnings
  "m720.profile_required": "Complete your tax profile before generating the Modelo 720 file.",
  "d6.profile_required": "Complete your tax profile before generating the D-6 guide.",

  // Trust signal
  "footer.open_source": "100% open source",
  "footer.verify_source": "Verify source code",

  // Splash screen
  "splash.tagline": "Free tax tool for investors with international brokers",
  "splash.feature_free": "100% free",
  "splash.feature_selfhosted": "Self-hosted",
  "splash.feature_privacy": "Total privacy",
  "splash.feature_opensource": "Open source",
  "splash.cta": "Get Started",

  // Validation
  "validation.future_date": "Trade for {{symbol}} has a future date ({{date}}). Please verify your data.",
  "validation.no_cash_transactions":
    "No cash transactions (dividends/withholdings) found. If using IBKR, enable the Cash Transactions section in your Flex Query.",
  "validation.no_cash_degiro":
    "No dividends or withholdings found. Degiro includes them in a separate file: also download the Account CSV from the Inbox.",
  "validation.no_cash_generic":
    "No cash transactions (dividends/withholdings) found. If your broker exports them separately, upload them as an additional file.",
  "validation.no_trades_in_year": "No trades found for tax year {{year}}. Prior trades are used for FIFO calculation.",
  "validation.very_old_data": "Data includes trades from {{year}} (over 10 years ago). Verify the file is correct.",
  "validation.duplicate_trades": "{{count}} duplicate trade(s) detected. Check if you uploaded the same file twice.",

  // Operations annex
  "annex.title": "Operations Annex (Anexo C1)",
  "annex.subtitle": "Individual operations detail grouped by asset type.",
  "annex.operations": "operation(s)",
  "annex.wash_blocked": "Loss blocked by repurchase: {{amount}} EUR (art. 33.5 LIRPF)",
  "annex.wash_dates": "Purchases of the same security that block it: {{dates}}",
  "annex.wash_hint":
    "In Renta Web, mark this sale as \"Non-attributable capital losses\". The loss stays pending: it counts, oldest losses first, as you sell shares of this security that no repurchase within 2 months before or after (1 year if the security is not traded on a regulated market of the European Economic Area or an equivalent one such as NYSE or Nasdaq; for crypto, only the year after the sale, art. 33.5.e) covers; if you buy some back, only the shares not bought back count. For crypto, it counts when you sell the coins you bought back, even if you buy that coin again (art. 33.5.e); selling other coins does not release it.",
  "annex.wash_released": "Releases {{amount}} EUR of deferred losses of this security («transmisión definitiva», art. 33.5 LIRPF)",
  "annex.wash_released_dates": "Pending losses from the sales of: {{dates}}",
  "annex.wash_released_hint": "The shares of this sale that no repurchase in its window covers are a definitive transmission («transmisión definitiva»): they now release the pending losses of this security, one share's loss for each share, oldest first (all that remain if the sale closes the position and no repurchase in its window covers it). In Renta Web, include them in this year.",
  "annex.wash_released_crypto": "Releases {{amount}} EUR of deferred losses of this coin (sale of the coins bought back, art. 33.5.e LIRPF)",
  "annex.wash_released_hint_crypto":
    "This sale transmits coins of the repurchase that blocked a loss: it now releases the part of that loss that matches the coins sold, even if you buy this coin again (art. 33.5.e). Selling other coins does not release it. In Renta Web, include it in this year.",

  // Tax bracket estimation
  "chart.tax_estimate": "Tax estimate (savings tax base)",
  "tax.bracket_range": "Bracket",
  "tax.bracket_base": "Base",
  "tax.bracket_rate": "Rate",
  "tax.bracket_tax": "Tax",
  "tax.total_estimated": "Estimated total",
  "tax.effective_rate": "Effective rate",
  "tax.double_tax_deduction": "Double taxation deduction",
  "tax.disclaimer":
    "Indicative estimate. Brackets correspond to the current Spanish IRPF savings tax base. Consult a tax advisor.",
  "tax.breakdown_capital_gains": "Capital gains",
  "tax.breakdown_fx_gains": "FX gains (currency exchange)",
  "tax.breakdown_dividends": "Dividends",
  "tax.breakdown_interest": "Interest",
  "tax.breakdown_blocked_losses": "Blocked losses (deferred)",
  "tax.breakdown_reintegrated_losses": "Deferred losses now deductible",

  // Sidebar - guide
  "sidebar.guia": "Renta Web Guide",

  // Guía de cumplimentación (Renta Web)
  "guide_rw.title": "Filing Guide — Renta Web",
  "guide_rw.description": "How to fill each box in Renta Web with DeclaRenta's results.",
  "guide_rw.intro":
    "This guide explains how to transfer DeclaRenta's results into Renta Web (AEAT). For each section, we indicate the target box (casilla), what value to enter, and which options to select in the dropdowns.",
  "guide_rw.capital_gains_title": "Capital gains and losses (disposals)",
  "guide_rw.fx_title": "Foreign currency exchange gains",
  "guide_rw.dividends_title": "Investment income — Dividends",
  "guide_rw.interest_title": "Investment income — Interest",
  "guide_rw.double_taxation_title": "International double taxation deduction",
  "guide_rw.entidad_emisora_label": "Issuing entity",
  "guide_rw.entidad_emisora_value":
    "Name of the company or security you sold (e.g. Apple Inc.), not the broker's. For currencies, the currency (e.g. USD). If consolidating several operations in one line, use the main security.",
  "guide_rw.tipo_elemento_label": "Asset type",
  "guide_rw.tipo_elemento_value_capital":
    'Select <strong>"Listed shares"</strong> for quoted stocks. For funds: "Collective investment shares". For derivatives/options: "Other assets".',
  "guide_rw.tipo_elemento_value_fx": 'Select <strong>"Other assets — Foreign currency"</strong>.',
  "guide_rw.clave_prereq_title": "Is the transmission-value field greyed out?",
  "guide_rw.clave_prereq_hint":
    'In Renta Web, boxes <strong>1633</strong> (transmission value) and <strong>1637</strong> (acquisition value) <strong>stay disabled until you first fill these fields, in this order</strong>:<br>1) Box <strong>1626 "Type of asset — Code"</strong> → for foreign currency and options this is usually code <strong>4</strong> ("Other assets not linked to economic activities"); for crypto, check the code that year assigns to virtual currencies. Investment funds (IIC) do <strong>not</strong> use code 4 — they are declared as "Participaciones en IIC".<br>2) <strong>"Type of transfer"</strong> → <strong>"Transmisión intervivos onerosa"</strong> (sale, swap, etc.) — it is <strong>onerosa</strong> (for consideration), not lucrativa/gratuita.<br>3) <strong>Transmission date</strong> (boxes <strong>1631/1632</strong>) → day/month/year of the sale.<br>4) <strong>Acquisition date</strong> (box <strong>1932</strong>) → day/month/year of the purchase.<br>Once filled, boxes 1633 and 1637 unlock and you can type the amounts. <em>The exact box number may vary by tax year.</em>',
  "guide_rw.gastos_transmision_label": "Disposal expenses",
  "guide_rw.gastos_adquisicion_label": "Acquisition expenses",
  "guide_rw.gastos_zero":
    "<strong>0</strong> — DeclaRenta already includes commissions in the disposal/acquisition values. Do not add expenses separately.",
  "guide_rw.gastos_label": "Custody/administration fees",
  "guide_rw.valor_transmision_label": "Disposal value",
  "guide_rw.valor_adquisicion_label": "Acquisition value",
  "guide_rw.valor_transmision_hint":
    "The amount from DeclaRenta's box <strong>0328</strong> (EUR, commissions already included).",
  "guide_rw.valor_adquisicion_hint":
    "The amount from DeclaRenta's box <strong>0331</strong> (EUR, commissions already included).",
  "guide_rw.fx_valor_transmision_hint": "The amount from DeclaRenta's box <strong>1633</strong>.",
  "guide_rw.fx_valor_adquisicion_hint": "The amount from DeclaRenta's box <strong>1637</strong>.",
  "guide_rw.fecha_transmision_label": "Disposal date",
  "guide_rw.fecha_adquisicion_label": "Acquisition date",
  "guide_rw.fecha_hint_individual":
    "If entering operations individually, use the exact date from the report. If consolidating all in one line, use <strong>31/12/YYYY</strong> (disposal) and <strong>01/01/YYYY</strong> (acquisition).",
  "guide_rw.fx_fecha_hint":
    "For consolidated FX: <strong>01/01/YYYY</strong> (acquisition) and <strong>31/12/YYYY</strong> (disposal). If entering individually, use the actual dates from the report.",
  "guide_rw.retenciones_label": "Withholdings",
  "guide_rw.retenciones_zero": "Usually <strong>0</strong> for foreign issuers (their foreign withholding goes in box 0588). BUT if you hold <strong>Spanish</strong> shares (ISIN ES…) at a foreign broker, their 19% withholding IS a Spanish prepayment and goes in <strong>box 0597</strong>.",
  "guide_rw.importe_label": "Gross income",
  "guide_rw.dividends_importe_hint": "The gross amount from DeclaRenta's box <strong>0029</strong> (EUR).",
  "guide_rw.interest_importe_hint": "The amount from DeclaRenta's box <strong>0027</strong> (EUR).",
  "guide_rw.dt_pais_label": "Country of origin",
  "guide_rw.dt_pais_hint":
    "Select the country where withholding was applied (e.g. United States, Ireland, Germany…). If you have withholdings from multiple countries, add one line per country.",
  "guide_rw.dt_importe_label": "Deduction amount",
  "guide_rw.dt_importe_hint":
    "The amount from DeclaRenta's box <strong>0588</strong>. This is the lesser of the foreign tax paid and the corresponding Spanish tax (Art. 80 LIRPF).",
  "guide_rw.dt_campo_label": "Which field in the dialog?",
  "guide_rw.dt_campo_hint":
    'In the double taxation dialog, fill TWO rows for each country:<br>• <strong>"Other net reduced income obtained abroad"</strong> (2nd row) → that country\'s "Gross EUR" in the box 0588 detail in DeclaRenta. With a single country, it is the "Total foreign income" row of that detail. It leaves out Spanish dividends and countries with no tax withheld.<br>• <strong>"Tax paid abroad"</strong> (last row) → that country\'s deduction in the same detail (with a single country, the amount of box 0588).<br>If you leave the 2nd row empty, Renta Web shows a warning about missing income. Rows 1 and 3 stay at 0.',
  "guide_rw.capital_gains_note":
    "If you have many operations, you can consolidate them in one line per asset type using generic dates 01/01 and 31/12. Renta Web accepts aggregated amounts.",
  "guide_rw.fx_note":
    "FX gains are declared separately from securities gains. They appear when you convert foreign currency to euros or to another currency (e.g. USD→GBP) — including your broker's automatic conversions (e.g. AFx/FXCONV in IBKR) — not only manual conversions. With the «DGT criterion (multi-currency)», while you hold the currency (e.g. buying and selling stocks in USD without converting to euros), the exchange difference stays deferred until you actually convert it, to euros or to another currency (Art. 14.2.e LIRPF). With «Traditional without currency (single-currency)» this section does not apply. With «Traditional with currency», the exchange-rate change while you hold the shares is already inside their gain or loss (boxes 0328/0331). Only the change while you hold the currency in cash stays deferred. The currency also counts when you pay fees or lose it in a losing sale.",
  "guide_rw.dividends_note":
    "Dividends from foreign brokers have no Spanish withholding. Foreign withholding tax is NOT entered here: it is deducted separately in box 0588 (double taxation).",
  "guide_rw.interest_note":
    "Broker interest (cash remuneration) is declared as investment income. Margin interest paid is NOT deductible (Art. 26.1.a LIRPF).",
  "guide_rw.double_taxation_note":
    "The double taxation deduction prevents paying tax twice on the same dividends. It is limited to the lesser of the amount paid abroad and the Spanish tax due. If the tax treaty allows a lower maximum rate (e.g. 15% USA), only that amount is deductible.",
  "guide_rw.blocked_losses_title": "Blocked losses (anti-churning)",
  "guide_rw.blocked_losses_hint":
    "If DeclaRenta shows blocked losses, tick the <strong>\"Non-attributable capital losses\"</strong> box in Renta Web. They are blocked because you bought the same security back within 2 months before or after the sale (1 year if the security is not traded on a regulated market of the European Economic Area or an equivalent one such as NYSE or Nasdaq). For crypto, they are blocked only if you buy the same coin back in the year after the sale (art. 33.5.e); purchases before the sale do not count. DeclaRenta applies 2 months to every security with an ISIN, because it does not know where it is listed: if yours is listed only in London, on SIX, in Toronto, in Tokyo or on OTC Markets, check by hand any repurchase between 2 months and 1 year before or after the sale, because that loss is blocked too (issue #452). A purchase in the 2 months before does not block if it was your only purchase of that security in that window and you held none of it when the window began (the one-purchase exception, DGT V3282-18); purchases in the 2 months after still block, except one that only closes a short position, which is no repurchase. Up to 0.66.13 DeclaRenta did not apply this exception: if you filed a year with that loss blocked, you can correct that year to deduct it (2024 and later: «autoliquidación rectificativa»; 2023 and earlier: a rectification request, «solicitud de rectificación»). They are not added to the cost of the new position: they stay pending and count, oldest first, as you sell shares of that security that no repurchase in that window covers («transmisión definitiva»); if you buy some back, only the shares not bought back count. For crypto, it counts when you sell the coins you bought back, even if you buy that coin again (art. 33.5.e); selling other coins does not release it. If you filed a year with DeclaRenta 0.66.5 or earlier, those versions released a loss when you sold the repurchased shares even if you bought back again: if you already deducted that loss, do not deduct it again when DeclaRenta releases it now, or correct that year (2024 and later: a corrective return, «autoliquidación rectificativa»; 2023 and earlier: a supplementary return, «autoliquidación complementaria»). The other way round: if DeclaRenta now releases a loss in a year you already filed with 0.66.5 or earlier, you can correct that year to deduct it (2024 and later: «autoliquidación rectificativa»; 2023 and earlier: a rectification request, «solicitud de rectificación»). For crypto, if you filed a year with DeclaRenta 0.66.13 or earlier, a purchase before the sale could block the loss: if DeclaRenta now deducts or releases a crypto loss in a year you already filed, correct that year to deduct it (2024 and later: «autoliquidación rectificativa»; 2023 and earlier: «solicitud de rectificación»); otherwise it is never deducted. Whenever you correct a year to deduct a loss, also check the later years you already filed: if you deducted that same loss in one of them because the older version released it there, correct that year too to remove it (2024 and later: «autoliquidación rectificativa»; 2023 and earlier: a supplementary return, «autoliquidación complementaria»), so you do not deduct it twice: a loss is deducted only once.",
  "guide_rw.closing_tip": "After entering all data, use the \"Verify declaration\" button in Renta Web to check for errors. If another tool shows a different capital gains amount, it may use another method for foreign-currency shares. In the Modelo 100 results, open «Compare with the other methods» to see the figures of all three. To change the method, go back to the «Review and choose method» step. Use the same method every year.",

  // PDF report
  "pdf.subtitle": "Tax report — Year",
  "pdf.generated": "Generated on",
  "pdf.informative": "Info",
  "pdf.blocked_losses": "Anti-churning blocked losses",
  "pdf.interest_margin": "Margin interest (non-deductible)",
  "pdf.section_casillas": "1. Tax Boxes Summary — Modelo 100",
  "pdf.section_operations": "2. Transactions Detail",
  "pdf.section_dividends": "3. Dividends",
  "pdf.section_dt": "4. International Double Taxation Deduction",
  "pdf.section_warnings": "Warnings",
  "pdf.reintegrated_losses": "Reintegrated losses (anti-churning)",
  "pdf.dt_paid": "Tax paid",
  "pdf.dt_allowed": "Deduction allowed",
  "pdf.ecb_note":
    "ECB rate: official European Central Bank exchange rate (EUR per 1 unit of foreign currency) on the transaction date. Source: ECB SDMX API.",
  "pdf.footer":
    "DeclaRenta — https://declarenta.com — This report is informational only and does not replace professional tax advice.",

  // Manual crypto valuation
  "crypto_rates.title": "Manual crypto valuation",
  "crypto_rates.description":
    "Some crypto-to-crypto swaps could not be valued automatically because neither currency has an official ECB exchange rate. Enter the value in euros per unit on the trade date to include them.",
  "crypto_rates.help":
    "We never look up crypto prices online — your portfolio stays private. Find the EUR value yourself (e.g. from your exchange's history or a price site) and enter it here.",
  "crypto_rates.col_asset": "Asset",
  "crypto_rates.col_date": "Date",
  "crypto_rates.col_quantity": "Quantity",
  "crypto_rates.col_currency": "Currency",
  "crypto_rates.col_eur_per_unit": "EUR per unit",
  "crypto_rates.placeholder": "e.g. 142.50",
  "crypto_rates.save_btn": "Save and recalculate",
  "crypto_rates.saved": "Saved",
  "crypto_rates.recalculate_hint": "Values are saved in your browser and the report is recalculated.",
  "crypto_rates.stored_title": "Saved manual prices",
  "crypto_rates.stored_description":
    "These euro prices are saved in your browser and are applied every time you process a file. Correct a value and save, or clear them all if one is wrong.",
  "crypto_rates.clear_btn": "Clear saved prices",

  // Manual opening lots for transferred positions
  "opening_lots.title": "Manual lots for transferred positions",
  "opening_lots.description":
    "If a sale comes from shares transferred from another broker, you can enter the original purchase lots here so FIFO can compute the correct cost basis.",
  "opening_lots.help":
    "Add as many lots as needed. Each row represents a different prior purchase with its own date, quantity, and price per share. Data is stored only in your browser.",
  "opening_lots.effect_hint":
    "If the result goes down after entering these lots, that is normal: before, that sale was being calculated with cost basis = 0.",
  "opening_lots.group_intro":
    "{{quantity}} shares are missing for the sale on {{date}}. Enter the prior lots that cover that transferred position.",
  "opening_lots.group_intro_saved":
    "These manual lots are saved in your browser and will keep being applied until you clear them.",
  "opening_lots.col_acquire_date": "Purchase date",
  "opening_lots.col_quantity": "Quantity",
  "opening_lots.col_price": "Price per share",
  "opening_lots.col_actions": "Actions",
  "opening_lots.placeholder_quantity": "e.g. 14",
  "opening_lots.placeholder_price": "e.g. 100.00",
  "opening_lots.add_row": "Add lot",
  "opening_lots.remove_row": "Remove",
  "opening_lots.save_btn": "Save lots and recalculate",
  "opening_lots.clear_btn": "Clear saved lots",
  "opening_lots.saved": "Saved",
  "opening_lots.row_invalid":
    "Check the highlighted rows: enter the purchase date and a quantity and price above zero (e.g. 1,234.56). Nothing was saved.",
  "opening_lots.recalculate_hint": "Manual lots are saved in your browser and the report is recalculated.",

  // Engine & parser messages (TaxMessage id → localized text)
  "fx.missing_prior_lots":
    "⚠ {{count}} disposals of {{currency}} without sufficient prior lots (total: {{totalQuantity}} {{currency}}). Possible acquisition before the reported period — FX gain assumed = 0.",
  "fx.missing_prior_lots.hint":
    "This currency was acquired before the Flex Query period. An FX gain of 0 is assumed (conservative treatment).",
  "fx.conservation_mismatch":
    "⚠ Internal foreign-exchange engine mismatch for {{currency}}: {{mismatch}} unbalanced units. Boxes 1633/1637 may fail to reconcile.",
  "fx.conservation_mismatch.hint":
    "This is an internal consistency check and should not happen. If you see it, report it on GitHub and attach the report; the foreign-exchange amounts may need manual review.",
  "fifo.unknown_category":
    '⚠ Unknown asset category: "{{assetCategory}}" for {{symbol}}. It will be processed with generic FIFO.',
  "fifo.unknown_category.hint":
    "It is still processed with generic FIFO. If it is a new IBKR asset type, it may be added in future versions.",
  "fifo.scrip_dividend": "📈 Scrip dividend: {{symbol}} +{{quantity}} shares on {{date}}",
  "fifo.scrip_dividend.hint": "The scrip dividend was added as a lot with cost equal to the dividend value.",
  "fifo.roll_operation": "⚠ C;O (roll) operation: {{symbol}} on {{date}}. Processed as close + open.",
  "fifo.roll_operation.hint":
    "Roll operation processed correctly as a close of the previous position and an open of the new one.",
  "fifo.unknown_direction": '⚠ Trade with unknown direction ("{{buySell}}"): {{symbol}} on {{date}}. It was not processed.',
  "fifo.unknown_direction.hint": "Only purchases (BUY) and sales (SELL) are processed. Check this row in the broker file and, if it is a real trade, correct its direction.",
  "fifo.split_applied": "⚡ Split {{isin}} {{ratio}} ({{direction}}) applied ({{date}})",
  "fifo.split_applied.hint":
    "Split applied to all lots. The total cost is unchanged — only the number of shares changes.",
  "fifo.split_unresolved": "⚠ Split of {{symbol}} on {{date}} not applied: no earlier shares to size the ratio from.",
  "fifo.split_unresolved.hint":
    "Also upload the statements for earlier years, back to when the account was opened. Otherwise the share count and the cost of later sales of this security will be wrong.",
  "fifo.merger_applied":
    "🔄 Merger: {{oldIsin}} → {{newIsin}} (ratio {{ratio}}, {{lotsTransferred}} lots transferred, {{date}})",
  "fifo.merger_applied.hint":
    "Tax-neutral merger: the lots are transferred to the new ISIN keeping the original cost basis.",
  "fifo.cash_merger_disposal":
    "💶 Cash buyout: {{symbol}} ({{isin}}) × {{quantity}} on {{date}}. Declared as a sale.",
  "fifo.cash_merger_disposal.hint":
    "A merger or acquisition paid in cash is a disposal: the gain or loss is computed as for a sale, with the cash received as the transfer value.",
  "fifo.spinoff_applied":
    "🔀 Spin-off: {{parentIsin}} → {{newIsin}} (ratio {{ratio}}, {{costPercent}}% of cost to the spin-off, {{date}})",
  "fifo.spinoff_applied.hint": "The cost is split proportionally between the parent and the spun-off company.",
  "fifo.corporate_action_unhandled":
    "ℹ Corporate action {{type}} for {{symbol}} ({{isin}}) on {{date}}: not applied to the FIFO calculation.",
  "fifo.corporate_action_unhandled.hint":
    "If it changed the number of shares or the ISIN of the position, check the cost of later sales of this security.",
  "fifo.sell_without_lots":
    "⚠ Sale without lots: {{symbol}}{{isinSuffix}} × {{quantity}} on {{date}}. Cost basis = 0 (possible short position or incomplete prior data).",
  "fifo.sell_without_lots.hint":
    "Does your export include earlier years? Download from your broker a period that starts at the first purchase of this security.",
  "fifo.cover_without_lots":
    "⚠ Short cover without lots: {{symbol}} ({{isin}}) × {{quantity}} on {{date}}. Gain not calculated (short position opened outside the period or incomplete prior data).",
  "fifo.cover_without_lots.hint":
    "Did you include earlier years in your Flex Query? Select a period covering from the sale that opened this short position.",
  "fifo.insufficient_lots": "⚠ Insufficient lots: {{symbol}}{{isinSuffix}} × {{quantity}} on {{date}}. Cost basis = 0.",
  "fifo.insufficient_lots.hint":
    "The file does not cover all earlier purchases of this security. Export a longer period from your broker.",
  "fifo.option_invalid_date": "⚠ OptionEAE event without a valid date for {{symbol}}. Skipped.",
  "fifo.option_invalid_date.hint":
    "Option event skipped due to an invalid date. Check that the Flex Query includes the 'Option Exercises, Assignments & Expirations' section.",
  "fifo.option_zero_quantity": "⚠ OptionEAE event with quantity 0 for {{symbol}} on {{date}}. Skipped.",
  "fifo.option_zero_quantity.hint": "Option event with quantity 0 — probably a duplicate IBKR record.",
  "fifo.option_invalid_strike": '⚠ Invalid strike "{{strike}}" for {{symbol}} on {{date}}. Skipping exercise.',
  "fifo.option_invalid_strike.hint":
    "This option's exercise could not be computed. The underlying's cost will not include the premium.",
  "fifo.option_expiry_no_lots": "⚠ Option expiration without lots: {{symbol}} × {{quantity}} on {{date}}.",
  "fifo.option_expiry_no_lots.hint":
    "The option expired but no purchase lots were found. Did you include the purchase year in the Flex Query?",
  "fifo.option_exercise_no_lots":
    "⚠ Exercise/assignment without option lots: {{symbol}} × {{quantity}} on {{date}}. Premium cost = 0.",
  "fifo.option_exercise_no_lots.hint":
    "Exercise recorded with premium = 0 because the option purchase was not found. Extend the Flex Query period.",
  "fifo.exercise_no_underlying_lots":
    "⚠ Option exercise without underlying lots: {{symbol}} × {{quantity}} on {{date}}. Cost basis = 0.",
  "fifo.exercise_no_underlying_lots.hint":
    "PUT assignment recorded with cost basis = 0 for the underlying. The Flex Query may not cover the original acquisition.",
  "fifo.insufficient_underlying_lots":
    "⚠ Insufficient underlying lots: {{symbol}} × {{quantity}} on {{date}}. Cost basis = 0.",
  "fifo.insufficient_underlying_lots.hint": "There are not enough underlying lots to cover the full assignment.",
  "report.crypto_valuation_unresolved":
    "There are {{count}} crypto operation(s) whose value in euros could not be determined automatically and have been excluded from the calculations.",
  "report.crypto_valuation_unresolved.hint":
    "This happens in crypto-to-crypto swaps (e.g. Binance Convert) when neither currency has an official ECB rate. Manually enter the value in euros per unit of each currency on the indicated date to include these operations.",
  "report.crypto_commission_neutralized":
    "The commission of {{count}} operation(s) was ignored because it is denominated in a cryptocurrency with no available exchange rate.",
  "report.crypto_commission_neutralized.hint":
    "The main value of the operation was calculated; only the small commission is omitted, and its tax impact is minimal.",
  "report.crypto_income_unvalued":
    "There are {{count}} crypto income item(s) (e.g. staking rewards) that could not be valued automatically and are not included in the calculated amounts.",
  "report.crypto_income_unvalued.hint":
    "This income is paid in the crypto itself and has no official ECB rate. Compute its value in euros on the receipt date and declare it manually as investment income (Box 0027).",
  "report.dividend_unvalued":
    "There are {{count}} dividend(s) in {{currencies}} that could not be valued automatically and are not included in the calculated amounts.",
  "report.dividend_unvalued.hint":
    "The ECB publishes no official rate for that currency on the payment date. Compute the amount in euros on that date, add it by hand to box 0029, and include its withholding in the international double-taxation deduction (box 0588).",
  "report.withholding_corrected_prior_year":
    "This file has corrections to {{year}} foreign withholding tax, posted in {{reportYear}}: the {{year}} withholding goes down by {{amount}} €. If you filed {{year}} with the original withholding, that year's box 0588 may have come out too high.",
  "report.withholding_corrected_prior_year.hint":
    "The international double-taxation deduction (box 0588, art. 80 LIRPF) only allows the tax you really paid abroad. Upload the {{year}} file together with this one and calculate {{year}}: DeclaRenta adds the correction to its dividend's withholding. If box 0588 comes out lower than the one you filed, correct your {{year}} return (2024 and later: a corrective return, «autoliquidación rectificativa»; 2023 and earlier: a supplementary return, «autoliquidación complementaria»). The {{reportYear}} boxes do not change.",
  "report.spanish_withholding_corrected_prior_year":
    "This file has corrections to {{year}} Spanish withholding tax, posted in {{reportYear}}: the {{year}} withholding goes down by {{amount}} €. If you filed {{year}} with the original withholding, that year's box 0597 may have come out too high.",
  "report.spanish_withholding_corrected_prior_year.hint":
    "Spanish withholding on dividends from Spanish issuers is a payment on account (box 0597, capital-income withholdings), and only what was really withheld counts. Upload the {{year}} file together with this one and calculate {{year}}: DeclaRenta adds the correction to its dividend's withholding. If box 0597 comes out lower than the one you filed, correct your {{year}} return (2024 and later: a corrective return, «autoliquidación rectificativa»; 2023 and earlier: a supplementary return, «autoliquidación complementaria»). The {{reportYear}} boxes do not change.",
  "report.crypto_general_gain_unvalued":
    "There are {{count}} crypto capital gain(s) (e.g. airdrops or referral commissions) that could not be valued automatically and are not included in the calculated amounts.",
  "report.crypto_general_gain_unvalued.hint":
    "This income is received in the crypto itself and has no official ECB rate. Compute its value in euros on the receipt date and declare it manually as a capital gain not arising from a transfer (general tax base).",
  "report.antichurning_window_past_data":
    "There are {{count}} sale(s) of {{year}} whose anti-churning repurchase window (2 months; 1 year if the security is not traded on a regulated market of the European Economic Area or an equivalent one; for crypto, only the year after the sale) ends after the last date covered by the uploaded files of that broker ({{lastDate}}). DeclaRenta cannot see purchases after that date.",
  "report.antichurning_window_past_data.hint":
    "If you bought the same security after {{lastDate}} and within the window of those sales (on {{windowEnd}} at the latest), part of their loss may be blocked, or the sale stops being a definitive transmission («transmisión definitiva») and releases no pending losses. Also upload the file with your trades up to {{windowEnd}} together with this one and calculate again. That window uses 2 months: if the security is listed only in London, on SIX, in Toronto, in Tokyo or on OTC Markets, the law gives 1 year, so also check your purchases up to one year after each sale (issue #452). For crypto, only purchases of the same coin, on any exchange, made after the sale and on or before {{windowEnd}} count; purchases before the sale do not. If you did not buy, the result is already correct.",
  "report.antichurning_window_open_at_filing":
    "There are {{count}} sale(s) of {{year}} whose anti-churning repurchase window ends on {{windowEnd}} at the latest: after {{deadline}}, the last day to file the return, and after the last date covered by the uploaded files of that broker ({{lastDate}}). When you file the return, that window will still be open.",
  "report.antichurning_window_open_at_filing.hint":
    "Before you file, also upload the file with your trades after {{lastDate}} and calculate again. If you buy the same security or the same coin up to and including {{windowEnd}}, part of the loss on those sales may be blocked, or the sale stops being a definitive transmission («transmisión definitiva») and releases no pending losses. In that case, correct the filed return with a corrective return («autoliquidación rectificativa»).",
  "report.antichurning_single_purchase":
    "In {{count}} sale(s) of {{year}}, the purchase in the 2 months before does not count as a repurchase: it was the only purchase of that security in that window and you held none of it when the window began (the one-purchase exception, DGT V3282-18). That purchase does not block the loss and does not stop the sale from releasing pending losses.",
  "report.antichurning_single_purchase.hint":
    "DeclaRenta only sees the uploaded files. If you held shares of that security when the window began (the first window begins on {{windowStart}}) at another broker or account you did not upload, or you later transferred them to another institution, the exception does not apply: upload those files too and calculate again. A purchase in the 2 months after the sale still blocks the loss.",
  "report.antichurning_single_purchase_unverified":
    "In {{count}} sale(s) of {{year}} the one-purchase exception of the 2-month rule may apply, but DeclaRenta does not apply it: the uploaded files do not prove that you held no shares of that security when the window began (the first window begins on {{windowStart}}). The purchase in the 2 months before counts as a repurchase.",
  "report.antichurning_single_purchase_unverified.hint":
    "If you held no shares of that security at any broker when the window began, and that was your only purchase in the 2 months before the sale, it does not count as a repurchase (DGT V3282-18). DeclaRenta applies it only when your files prove it, account by account: the files of every account that holds or trades that security must cover its trades with no gap and no day twice from {{windowStart}} to period-end positions dated on or after the sale (in IBKR, the Trades and Open Positions sections of the Flex Query, with the ISIN field), with every quantity readable and the same shares that account's trades leave. A share trade with no ISIN in that period, or shares with no ISIN you still held when it began (from Revolut, for example), in any account, also prevent it, because they may be of that security. A file that only includes trades is not enough, and a transfer between accounts or a manual lot inside that window cannot be checked.",
  "report.titularidad_compartida":
    "The amounts shown are split between {{titulares}} holders (the share corresponding to each taxpayer). This report reflects the return of a SINGLE holder: each of the {{titulares}} holders must file their own return with this same share. Do not declare the total in a single return, nor add several holders' shares into yours.",
  "report.titularidad_compartida.hint":
    "The equal split ({{titulares}} × {{percent}} %) assumes equal ownership. If the ownership percentages differ (e.g. 70/30), adjust the amounts manually. For community-property accounts the attribution is 50/50 (Art. 11.3 LIRPF). You can change the number of holders at the «Review and choose method» step (on the command line, --titulares).",
  "report.competitor_reconciliation":
    "If another tool shows a different amount, it may be because it does not calculate foreign-exchange gains (Art. 33.1 LIRPF).",
  "report.competitor_reconciliation.hint":
    "You can compare with another method in the «Review and choose method» step (on the command line, --fx-method). «Traditional with currency» values shares at the buy-date rate and the sale-date rate, and also computes your currency. «Traditional without currency (single-currency)» values shares the same way, but computes no currency result at all, not even for USD→EUR conversions.",
  "report.monodivisa_conversions_skipped":
    "The «Traditional without currency (single-currency)» method left {{count}} currency conversion(s) from this tax year uncalculated (manual or automatic broker conversions). This method computes no currency result at all (boxes 1633/1637).",
  "report.monodivisa_conversions_skipped.hint":
    "If you converted currency (for example, from USD to EUR), choose «Traditional with currency» in the «Review and choose method» step (on the command line, --fx-method tradicional-divisa). It values shares the same way and does compute your conversions. The «DGT criterion (multi-currency)» computes them too.",
  "report.fx_method_consistency":
    "DeclaRenta computes with the «DGT criterion (multi-currency)»: the currency gain is deferred until you convert the foreign currency to euros (Art. 14.2.e LIRPF; DGT V0152-26). There are two other methods: «Traditional with currency» and «Traditional without currency (single-currency)».",
  "report.fx_method_consistency.hint":
    "Do not mix methods across tax years: if you filed one year with another criterion (or another tool), the carried currency basis may be counted twice or left out. For currency acquired before your report's period, include the earlier years in the broker export.",
  "report.fx_deferred_no_conversion":
    "You did not convert currency to euros this tax year, so there is no exchange-rate gain to declare (no currency amount is added to boxes 1633/1637). The exchange difference while you hold the currency is deferred until you actually convert it to euros (Art. 14.2.e LIRPF; DGT V0152-26).",
  "report.fx_deferred_no_conversion.hint":
    "Your broker (e.g. IBKR) may show a «realized forex gain» even if you did not convert to euros: it uses the US tax criterion, not the Spanish one. With the «DGT criterion (multi-currency)», the currency gain is only declared when you convert it to euros or to another currency.",
  "report.fx_traditional_method":
    "«Traditional with currency» method. Shares in a foreign currency are valued at the ECB rate of the buy date (cost) and of the sale date (sale). The currency is taxed FIFO when it leaves your account: when you convert it to euros or to another currency, pay fees or interest, or lose it in a losing sale. A sale gives back the currency you invested and, if you made a profit, the profit. The invested currency costs what it cost you, plus the rate change between buying and selling the shares, which is already in the result of that sale. The profit enters at the sale-date rate. The invested currency you do not get back is taxed on its own, at that sale. So each change in the currency is declared only once.",
  "report.fx_traditional_method.hint":
    "The DGT values units of investment funds in a foreign currency this way (V2324-10, V0775-21). For shares, the tax agency computes the gain in the foreign currency and converts it to euros at the sale-date rate (V1740-17, V2422-20, V0152-26): that is the «DGT criterion (multi-currency)». In both methods, the currency you convert is taxed when you convert it (V2466-08). Currency lost in a losing sale is taxed in the year of the sale, as with funds (V0775-21, V2324-10). Autodeclaro describes the same share valuation, with the exchange rates from your broker's statement, but does not publish how it computes the currency. Use the same method every year.",
  "report.fx_traditional_risk":
    "The tax agency applies the «DGT criterion (multi-currency)» to shares (V1740-17). In 2025 it rejected this same calculation for a flat bought in dollars (V1615-25). If it reviews your return, it can recompute it with that criterion.",
  "report.fx_traditional_risk.hint":
    "If the full cycle (euros → currency → shares → currency → euros) has no losing sales, both methods usually give almost the same total. What changes is the year and the box where each part appears, and the double-taxation deduction (box 0588) can change too. With losing sales, this method also declares the lost currency and the total is different. No DGT ruling backs this method for shares. If the tax agency recomputes, it can charge late-payment interest on the tax this method moves to a later year.",
  "report.fx_traditional_no_conversion":
    "You did not convert currency this year. The change in {{ccy}} while you held the shares is already in their gain or loss. The change while you hold the {{ccy}} in cash will be declared when you convert it.",
  "report.fx_traditional_no_conversion.hint":
    "With this method, currency is only added to boxes 1633/1637 when it leaves your account: conversions to euros or to another currency, fees, interest paid and currency lost in losing sales.",
  "report.fx_traditional_lost_dollars":
    "In {{n}} losing sale(s) you got back fewer {{ccy}} than you invested. Those lost {{ccy}} leave your account. Their exchange difference, from when you bought them to when you bought the shares ({{amount}} €), is declared this year in boxes 1633/1637.",
  "report.fx_traditional_lost_dollars.hint":
    "The «DGT criterion (multi-currency)» declares nothing in this case, because those {{ccy}} were never converted to euros. This method does declare it, as the DGT does for funds in a foreign currency (V0775-21, V2324-10): the change in the currency before the purchase is taxed in the year of the sale. FIFO order decides which {{ccy}} were lost. You will see it in the detail of boxes 1633/1637 as «Currency lost in a losing sale».",
  "report.fx_traditional_guard":
    "In {{n}} sale(s), the fall of the {{ccy}} since the share purchase is larger than what that currency cost you. Its exchange difference up to the share purchase ({{amount}} €) is declared this year in boxes 1633/1637, and those {{ccy}} come back at the sale-date rate.",
  "report.fx_traditional_guard.hint":
    "This happens when the exchange rate moves a lot (about double) between buying the currency and selling the shares. Without this rule, those {{ccy}} would have a negative cost. You will see it in the detail of boxes 1633/1637 as «Currency change up to the share purchase».",
  "report.fx_traditional_inflight":
    "This year you converted {{qty}} {{ccy}} that come from share sales in {{years}}. This method assumes that the change in {{ccy}} while you held those shares ({{amount}} €) was already declared in that year's gain or loss.",
  "report.fx_traditional_inflight.hint":
    "That holds if that year you used «Traditional with currency» or «Traditional without currency (single-currency)». If you used the «DGT criterion (multi-currency)», this year's currency result is off by that amount. Use the same method as then.",
  "report.fx_traditional_uncovered":
    "{{qty}} {{ccy}} used to buy shares have no euro origin in your files (deposits, earlier balances, years you have not uploaded, or an overdraft or margin loan from the broker). They are taken at the buy-date rate, with no earlier exchange difference.",
  "report.fx_traditional_uncovered.hint":
    "If you converted euros to {{ccy}} up to 7 days after the purchase, the rate of that conversion is used. If you know where they came from, upload the earlier years too.",
  "report.fx_traditional_uncovered_ibkr":
    "{{qty}} {{ccy}} used to buy shares have no euro origin in your files (deposits, earlier balances, years you have not uploaded, or an overdraft or margin loan from the broker). They are taken at the buy-date rate, with no earlier exchange difference.",
  "report.fx_traditional_uncovered_ibkr.hint":
    "If you converted euros to {{ccy}} up to 7 days after the purchase, the rate of that conversion is used. If you know where they came from, upload the earlier years too. If your {{ccy}} balance went below zero (overdraft or margin), upload the IBKR statement with its «Cash Report» section. DeclaRenta treats that negative balance as a loan in {{ccy}} only if the Cash Report matches your trades, covers a single account and there are no {{ccy}} deposits, withdrawals, transfers, options or short positions.",
  "report.fx_traditional_opening":
    "{{qty}} {{ccy}} of your account's opening balance (the IBKR «Cash Report») were used to buy shares and have no euro origin in your files. They are taken at the buy-date rate, with no earlier exchange difference.",
  "report.fx_traditional_opening.hint":
    "That balance was already in the account when the first period you uploaded began. If you know where it came from, upload the earlier years too.",
  "report.fx_traditional_orphan":
    "The exchange difference of {{qty}} {{ccy}} invested in {{security}} could not be assigned to any sale (possible ISIN change, merger or spin-off). Review it by hand.",
  "report.fx_traditional_orphan.hint":
    "Those {{ccy}} were used to buy {{security}}. At 31 December you no longer hold those shares and no sale has brought them back. Their change from when you bought the {{ccy}} to when you bought the shares ({{amount}} €) has not been declared.",
  "report.fx_loan_repayment":
    "This year you repaid {{ccy}} the broker lent you (your {{ccy}} balance was below zero). DeclaRenta declares {{amount}} € for those repayments in boxes 1633/1637. The change of the debt itself, from when it opened to when you repaid it, is a {{gain}} € gain and a {{loss}} € loss.",
  "report.fx_loan_repayment.hint":
    "The Spanish Supreme Court (STS 71/2021, ECLI:ES:TS:2021:345) puts the change of a foreign-currency loan in the general base. The DGT puts it in the savings base (V2414-12), as DeclaRenta does. If you follow the Supreme Court, declare the gain in box 0304 and the loss in box 0305, and take them out of boxes 1633/1637: lower the transmission value (1633) by the gain and raise it by the loss. DeclaRenta treats the negative balance as a loan only when the IBKR cash statement (Cash Report) matches your trades.",
  "report.fx_loan_repayment_manual":
    "This year you repaid {{ccy}} the broker lent you (your {{ccy}} balance was below zero). DeclaRenta declares {{amount}} € for those repayments in boxes 1633/1637. The change of the debt itself, from when it opened to when you repaid it, is a {{gain}} € gain and a {{loss}} € loss.",
  "report.fx_loan_repayment_manual.hint":
    "The Spanish Supreme Court (STS 71/2021, ECLI:ES:TS:2021:345) puts the change of a foreign-currency loan in the general base. The DGT puts it in the savings base (V2414-12), as DeclaRenta does. If you follow the Supreme Court, declare the gain in box 0304 and the loss in box 0305. Of those amounts, only a {{boxGain}} € gain and a {{boxLoss}} € loss are in boxes 1633/1637: lower the transmission value (1633) by that gain and raise it by that loss. The rest is not in 1633/1637 but inside the result of other operations (for example, the sale of the shares you bought with the loan), and DeclaRenta cannot tell you which box to correct: reconcile it by hand before you file the return. DeclaRenta treats the negative balance as a loan only when the IBKR cash statement (Cash Report) matches your trades.",
  "report.fx_method_name.multidivisa":
    "DGT criterion (multi-currency)",
  "report.fx_method_name.tradicional-divisa":
    "Traditional with currency",
  "report.fx_method_name.monodivisa":
    "Traditional without currency (single-currency)",
  "report.settings_line":
    "Calculation settings: method {{method}}, holders {{titulares}}, auto-conversions {{autoconvert}}",
  "report.non_finite_total":
    "A non-finite value (NaN/Infinity) was detected in a calculated total; please review the imported files.",
  "report.non_finite_total.hint":
    "A broker file may have a corrupt amount or an unexpected number format. Review the source operations.",
  "flatex.lagerstellenwechsel.unmatched":
    "Custody transfer (Lagerstellenwechsel) without a counterpart for {{isin}}: {{netQuantity}} units.",
  "flatex.lagerstellenwechsel.unmatched.hint":
    "An unmatched transfer entered or left the deposit without an acquisition price. If you later sell these units, check that the original purchase value is included so you do not declare a fictitious gain.",
  "flatex.commission.unmatched_trades":
    "Not all Flatex commissions could be matched: the corresponding cash entries are missing.",
  "flatex.commission.unmatched_trades.hint":
    "Also upload the Kontoumsätze (account movements) CSV together with the Depotumsätze one so that each operation's commission is taken into account (added to the acquisition cost on purchases and subtracted from the transfer value on sales).",
  "flatex.commission.cross_currency":
    "Flatex trades without a calculated commission: {{trades}}. The cash entry is in a different currency from the trade.",
  "flatex.commission.cross_currency.hint":
    "The commission of those trades has been left at 0. Look up its amount in the order's settlement note in Flatex and take it into account when reviewing the return: it is added to the acquisition value on purchases and subtracted from the transfer value on sales.",
  "flatex.commission.multi_fill_prorated":
    "Flatex orders executed in several parts: {{orders}}. Their commission has been split across the executions in proportion to their amount.",
  "flatex.commission.multi_fill_prorated.hint":
    "Flatex settled those orders with a number of cash entries different from the number of executions, so it is not possible to tell which commission belongs to each one. The total commission of each order is exact; only the split between executions is approximate.",
  "flatex.depot.repeated_fills":
    "Repeated Flatex trades counted only once: {{fills}}. They had the same order number and booking number (TA-Nr.) as one already loaded.",
  "flatex.depot.repeated_fills.hint":
    "This usually happens when the same Depotumsätze CSV is uploaded twice, or two exports with overlapping dates. If they really are different trades, check the file: Flatex gives each execution its own TA-Nr.",
  "flatex.dividends.net_amounts":
    "Flatex books dividends at the net amount received, after withholding, and the Kontoumsätze CSV does not include the withholding.",
  "flatex.dividends.net_amounts.hint":
    "Take the gross amount and the withholding of each payment from the PDF statement Flatex puts in your document inbox, and correct boxes 0029 (gross amount), 0588 (foreign withholding) and 0597 (Spanish withholding) by hand.",
  "degiro.rows_skipped": "{{count}} rows without ISIN/without amount were skipped.",
  "degiro.rows_skipped.hint":
    "These rows had a quantity or price but were missing the ISIN or the amount, so they could not be included as operations. This usually means the CSV columns were not recognized correctly: re-export the Degiro Transactions CSV without modifying the headers.",
  "degiro.corporate_action_pair":
    "Possible corporate action on {{date}}: {{oldProduct}} ({{oldIsin}}) → {{newProduct}} ({{newIsin}}). Degiro records it as a sale and a purchase.",
  "degiro.corporate_action_pair.hint":
    "Degiro records ISIN changes, splits and share exchanges as a sale of the old security and a purchase of the new one, with no order ID and no costs. DeclaRenta computes them that way: it declares a gain or loss on that day, and the new shares take that price and that date as their cost. Check the notice from Degiro or the issuer. If it was a plain ISIN change, a split or a tax-neutral share exchange (special regime of the Spanish Corporate Income Tax Act), there was no sale: the new shares keep the cost and purchase date of the old ones, so correct that operation in your return. If it was a taxable exchange (art. 37.1.e LIRPF), the calculation is correct.",
  "degiro.transaction_tax": "Financial transaction tax paid on {{product}} ({{isin}}): {{amount}} {{currency}}.",
  "degiro.transaction_tax.hint":
    "Degiro charges this tax when you buy Spanish, French or Italian shares and only shows it in the Account CSV. It is part of the acquisition value (art. 35.1.b LIRPF): add it to the cost of your purchases of that security, because DeclaRenta does not add it automatically.",
  "binance.unparseable_timestamp":
    "{{count}} row(s) of the Binance CSV were skipped because they had an unrecognizable date/time (UTC_Time).",
  "binance.unparseable_timestamp.hint":
    "This is usually caused by a manually edited or incompletely exported file. Re-download the original report from Binance without editing it so those operations are included.",
  "binance.unhandled_operation":
    "{{count}} Binance CSV movement(s) with unrecognized operations were skipped: {{operations}}.",
  "binance.unhandled_operation.hint":
    "These movements are not included in the calculation. If they are purchases, sales or income (e.g. futures, Binance Card payments, Auto-Invest or cashback), add them to your return by hand and report the operation name so it can be supported.",
  "binance.unsupported_pair":
    "{{count}} Binance CSV trade(s) with an unrecognized pair were skipped: {{pairs}}.",
  "binance.unsupported_pair.hint":
    "These trades are not included in the calculation. Add them to your return by hand and report the pair so it can be supported.",
  "etoro.closed_types_skipped":
    "{{count}} eToro closed position(s) of an unsupported type were skipped: {{types}}.",
  "etoro.closed_types_skipped.hint":
    "DeclaRenta does not import these eToro position types yet (e.g. crypto). Their gain or loss is not included in the calculation: add it to your return by hand using the invested amount and the profit eToro shows.",
  "lightyear.unknown_types":
    "{{count}} Lightyear CSV row(s) with an unrecognized transaction type were skipped: {{types}}.",
  "lightyear.unknown_types.hint":
    "These movements are not included in the calculation. If they are stock splits, share transfers or other corporate actions, check them by hand: they can change the share count or the acquisition cost of later sales.",
  "coinbase.rewards_income_classification":
    '{{count}} "Rewards Income" item(s) from Coinbase were classified as investment income (savings tax base).',
  "coinbase.rewards_income_classification.hint":
    "If some of those amounts are promotional rewards or card cashback (not income from holding or lending crypto), their correct treatment would be a capital gain not arising from a transfer (general tax base). Review their nature if the amount is significant.",
  "coinbase.unknown_types_skipped":
    "{{count}} Coinbase row(s) with an unrecognised transaction type were skipped: {{types}}.",
  "coinbase.unknown_types_skipped.hint":
    "These rows were left out of the calculation. If any of them is a sale, a purchase, a payment made with crypto or a reward, add it manually so its gain, acquisition cost or income is counted.",
  "coinbase.advanced_trade_quote_leg_missing":
    "{{count}} Coinbase Advanced Trade fill(s) were paid or received in a currency other than the valuation currency ({{pairs}}); only the crypto bought or sold was recorded, not the counterpart currency.",
  "coinbase.advanced_trade_quote_leg_missing.hint":
    "In these pairs you also dispose of (when buying) or acquire (when selling) the quote currency, whether another crypto or a fiat currency, and that is taxable too. Add the sale or purchase of that currency manually, for the same euro value as the trade, so its gain and acquisition cost add up.",
  "trade_republic.trade_skipped_no_amount":
    "{{count}} Trade Republic buy/sell operation(s) without a usable amount were skipped.",
  "trade_republic.trade_skipped_no_amount.hint":
    'This is usually caused by incomplete rows in the export (an empty or non-numeric "amount" column). If operations are missing, re-download the full transactions CSV from Trade Republic.',
  "trade_republic.corporate_action_not_applied":
    "Trade Republic: {{count}} corporate action row(s) (merger, exchange, split) for {{isins}} were not applied.",
  "trade_republic.corporate_action_not_applied.hint":
    "The cost of the old securities is not carried over to the new ones, so a later sale of the new security may show no lots and a cost of 0. If it was a merger or an exchange, add the original acquisition cost under “Manual lots for transferred positions”.",
  "trade_republic.delivery_not_applied":
    "Trade Republic: {{count}} securities delivery row(s) without a trade (free shares, transfers) for {{isins}} were not imported.",
  "trade_republic.delivery_not_applied.hint":
    "Free shares from a promotion are a capital gain in the general tax base at their market value on the delivery date: declare them separately and add that value as the cost under “Manual lots for transferred positions”. If it is a transfer from another broker, add the original purchase cost there.",
  "parser.trading212.unresolved_price_skipped":
    "{{skipped}} operations without a price per share and with an amount in another currency were skipped.",
  "parser.trading212.unresolved_price_skipped.hint":
    'These rows had no price per share and their amount (Total) was in a currency different from the instrument\'s, so the operation value could not be calculated. Re-export the history from Trading 212 making sure to include the "Price / share" column.',
  "parser.cash_summary_duplicates": "{{skipped}} duplicate summary rows were skipped in the cash transactions.",
  "parser.cash_summary_duplicates.hint":
    'Your Flex Query has the "Summary" option enabled in the Cash Transactions section, which duplicates every movement. You can disable it, but it is not necessary: these rows were ignored automatically to avoid duplicating dividends, withholdings and commissions.',
  "parser.executions_merged": "{{sourceFillCount}} partial executions were grouped into {{mergedGroupCount}} orders.",
  "parser.executions_merged.hint":
    "Orders with several partial executions were combined into a single operation, just as brokers reporting to the tax authority do. The tax calculation does not change: total quantity, weighted average price and commissions add up to the same.",
  "parser.order_level_duplicates": "{{skipped}} duplicate aggregated ORDER-type rows were skipped in the operations.",
  "parser.order_level_duplicates.hint":
    'Your Flex Query has the "Orders" detail level enabled in addition to "Executions" in the Trades section, which duplicates every operation. You can disable "Orders" in the Flex Query configuration, but it is not necessary: these rows were ignored automatically to avoid duplicating quantities, amounts and commissions.',
  "parser.cancelled_trades": "{{count}} trades cancelled by IBKR were skipped together with their cancellation rows.",
  "parser.cancelled_trades.hint": 'IBKR marks a cancelled execution with a reversing row ("(Ca.)"). The original trade and its cancellation were discarded: they never became a real purchase or sale.',
  "parser.cancelled_trades_unmatched": "{{count}} IBKR cancellation rows were skipped because the original trade is not in this file.",
  "parser.cancelled_trades_unmatched.hint": "The cancelled trade falls outside this Flex Query's period. If you load it from another file, it will still count as real: export a period that includes both the trade and its cancellation in the same file.",
  "parser.open_position_quantity_unknown": "IBKR gives no readable share count for {{count}} open position(s): {{holdings}}.",
  "parser.open_position_quantity_unknown.hint": "DeclaRenta counts them as 0 shares: the Modelo 720 includes them with their value, but with 0 in «Número de valores», and the D-6 leaves them out. Check these holdings in the 720 and the D-6 by hand, or make sure the Open Positions section of your Flex Query includes the quantity and export it again.",
};

export default en;
