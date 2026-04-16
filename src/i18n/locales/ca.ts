// BETA: Traducció automàtica, pendent de revisió per parlant natiu
/** Català */
import type { TranslationKeys } from "./es.js";

const ca: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker estranger → Renda espanyola",


  "upload.title": "1. Puja el teu informe del broker",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrossega el teu fitxer aquí o fes clic per seleccionar",
  "upload.formats_help": "Formats: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "2. Configura",
  "config.year_label": "Exercici fiscal:",
  "config.process_btn": "Processar",
  "config.processing": "Processant...",

  "results.title": "3. Resultats per al Model 100",
  "results.operations": "Operacions",
  "results.dividends": "Dividends",
  "results.no_dividends": "Sense dividends",
  "results.search_placeholder": "Cercar per ISIN o símbol...",
  "results.filter_all": "Totes",
  "results.filter_gains": "Guanys",
  "results.filter_losses": "Pèrdues",
  "results.export_json": "Exportar JSON",
  "results.export_csv": "Exportar CSV",
  "results.operations_count": "{{count}} operació(ns)",
  "results.dividends_count": "{{count}} dividend(s)",

  "table.isin": "ISIN",
  "table.symbol": "Símbol",
  "table.buy_date": "D. Compra",
  "table.sell_date": "D. Venda",
  "table.units": "Uds.",
  "table.cost_eur": "Cost EUR",
  "table.proceeds_eur": "Venda EUR",
  "table.gain_loss_eur": "G/P EUR",
  "table.days": "Dies",
  "table.date": "Data",
  "table.gross_eur": "Brut EUR",
  "table.withholding_eur": "Retenció EUR",
  "table.country": "País",
  "table.casilla": "Casella",
  "table.concept": "Concepte",
  "table.amount_eur": "Import (EUR)",

  "casilla.transmission_value": "Valor de transmissió",
  "casilla.acquisition_value": "Valor d'adquisició",
  "casilla.net_gain_loss": "Guany/Pèrdua net",
  "casilla.gross_dividends": "Dividends bruts",
  "casilla.interest_earned": "Interessos guanyats",
  "casilla.interest_paid": "Interessos pagats (marge)",
  "casilla.double_taxation": "Deducció doble imposició",
  "casilla.blocked_losses": "Pèrdues bloquejades per regla anti-churning (2 mesos): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} advertència(es)",

  "chart.asset_distribution": "Distribució per tipus d'actiu",
  "chart.monthly_gl": "Guany/Pèrdua per mes",
  "chart.currency_composition": "Composició per divisa",
  "chart.withholdings_country": "Retencions per país",

  "footer.privacy": "Self-hosted · Privacitat total",
  "footer.disclaimer": "Avís legal",

  "disclaimer.title": "Avís legal",
  "disclaimer.text": "Aquesta eina és merament informativa i no constitueix assessorament fiscal ni jurídic. Els resultats generats han de ser verificats per l'usuari i/o un professional qualificat abans de ser utilitzats en qualsevol declaració tributària.\n\nDeclaRenta no es responsabilitza d'errors, omissions ni de les conseqüències derivades de l'ús d'aquesta informació. L'usuari és l'únic responsable de la veracitat i exactitud de les dades introduïdes i de les declaracions presentades davant l'Agència Tributària.\n\nEls tipus de canvi procedeixen del Banc Central Europeu (BCE). Els càlculs fiscals es basen en la normativa vigent (LIRPF, Llei del Patrimoni, Ordre EHA/3290/2008) però poden no cobrir tots els supòsits ni reflectir canvis normatius posteriors a l'última actualització del programari.",
  "disclaimer.accept": "Entès",

  "a11y.skip_link": "Saltar al contingut",
  "a11y.nav_label": "Ajustos",
  "a11y.lang_label": "Idioma",
  "a11y.theme_toggle": "Canviar tema",
  "a11y.drop_zone": "Zona de càrrega de fitxers",
  "a11y.file_input": "Seleccionar fitxers",

  "theme.toggle": "Canviar tema",

  // Wizard steps
  "wizard.step1": "Pujar fitxers",
  "wizard.step2": "Revisar dades",
  "wizard.step3": "Configurar",
  "wizard.step4": "Resultats",
  "wizard.next": "Següent",
  "wizard.back": "Enrere",
  "wizard.step_indicator": "Pas {{current}} de {{total}}",

  // Review step
  "review.title": "Resum de dades carregades",
  "review.broker": "Broker",
  "review.trades_count": "Operacions",
  "review.dividends_count": "Dividends",
  "review.date_range": "Rang de dates",
  "review.currencies": "Divises",
  "review.no_data": "No s'han detectat operacions als fitxers pujats.",
  "review.file": "Fitxer",

  // Config step
  "config.nif_label": "NIF (per al Model 720/D-6):",
  "config.nif_placeholder": "12345678A",
  "config.generate_720": "Generar fitxer Model 720",
  "config.generate_d6": "Generar guia D-6",

  // Expandable casillas
  "casilla.expand": "Veure detall",
  "casilla.collapse": "Amagar detall",
  "casilla.operations_in": "Operacions en aquesta casella",
  "casilla.no_operations": "Sense operacions",

  // Year comparison
  "compare.title": "Comparativa anual",
  "compare.no_data": "Processa almenys 2 exercicis per veure la comparativa.",
  "compare.year": "Exercici",
  "compare.variation": "Variació",
  "compare.saved_reports": "Informes desats",
  "compare.clear_history": "Esborrar historial",
  "compare.clear_confirm": "Esborrar tots els informes desats?",

  "error.no_broker_detected": "No s'ha pogut detectar el broker de \"{{filename}}\". Selecciona el broker manualment.",
  "error.prefix": "Error: ",

  "status.fetching_rates": "Obtenint tipus BCE per a {{currencies}}...",
  "status.files_processed": "{{count}} fitxer(s) processat(s) — {{brokers}} — {{trades}} operacions",
};

export default ca;
