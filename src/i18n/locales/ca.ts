// BETA: Traducció automàtica, pendent de revisió per parlant natiu
/** Català */
import type { TranslationKeys } from "./es.js";

const ca: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker estranger → Renda espanyola",


  "upload.title": "Puja el teu informe del broker",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrossega el teu fitxer aquí o fes clic per seleccionar",
  "upload.formats_help": "Formats: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "2. Configura",
  "config.year_label": "Exercici fiscal:",
  "config.process_btn": "Processar",
  "config.processing": "Processant...",

  "results.title": "Resultats per al Model 100",
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

  "footer.docs": "Documentació",
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

  "sidebar.profile": "Perfil fiscal",
  "sidebar.renta": "Model 100 (Renda)",
  "sidebar.m720": "Model 720",
  "sidebar.d6": "Model D-6",
  "sidebar.toggle": "Obrir/tancar menú",

  "profile.title": "Perfil fiscal",
  "profile.description": "Aquestes dades s'utilitzen per generar els fitxers dels models 720 i D-6.",
  "profile.nif_label": "NIF/NIE:",
  "profile.surname_label": "Cognoms:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Nom:",
  "profile.name_placeholder": "Joan",
  "profile.ccaa_label": "Comunitat Autònoma:",
  "profile.phone_label": "Telèfon:",
  "profile.phone_placeholder": "600123456",
  "profile.saved": "Perfil desat",
  "profile.incomplete_banner": "Completa el teu perfil fiscal per generar els models 720 i D-6.",
  "profile.go_to_profile": "Anar al perfil",

  "guide.title": "Com obtenir l'informe?",
  "guide.tip_fifo": "Inclou tot l'històric — DeclaRenta necessita operacions anteriors per al càlcul FIFO correcte.",

  "m720.title": "Model 720 — Béns a l'estranger",
  "m720.description": "Declaració informativa sobre béns i drets situats a l'estranger.",
  "m720.threshold_exceeded": "Segons les teves posicions ({{amount}} €), estàs obligat a presentar el Model 720.",
  "m720.threshold_not_exceeded": "No superes el llindar de 50.000 € (total: {{amount}} €). No estàs obligat a presentar.",
  "m720.no_positions": "Puja un informe amb posicions obertes al Model 100 per analitzar el Model 720.",
  "m720.positions_title": "Posicions declarables",
  "m720.generate_btn": "Generar fitxer Model 720",
  "m720.deadline": "Termini: 1 gener – 31 març de l'any següent",
  "m720.total_value": "Valor total: {{amount}} €",
  "m720.filing_title": "Com presentar-lo?",
  "m720.rates_title": "Tipus de canvi aplicats (BCE)",
  "m720.deadline_short": "Termini: 1 gener – 31 març",

  "d6.title": "Model D-6 — Inversions a l'exterior",
  "d6.description": "Declaració al Registre d'Inversions del Ministeri d'Economia.",
  "d6.no_minimum": "El D-6 és obligatori per a QUALSEVOL import. No té llindar mínim.",
  "d6.no_positions": "Puja un informe amb posicions obertes al Model 100 per analitzar el D-6.",
  "d6.positions_title": "Posicions a declarar",
  "d6.cancellations_title": "Cancel·lacions",
  "d6.generate_btn": "Generar guia D-6",
  "d6.deadline": "Termini: 1 – 31 gener de l'any següent",
  "d6.total_value": "Valor total: {{amount}} €",
  "d6.aforix_title": "Guia AFORIX pas a pas",
  "d6.copy_btn": "Copiar",
  "d6.copied": "Copiat",
  "d6.rates_title": "Tipus de canvi aplicats (BCE)",
  "d6.deadline_short": "Termini: 1 – 31 gener",

  "badge.complete": "Complet",
  "badge.pending": "Pendent",
  "badge.not_applicable": "No aplica",
  "badge.generated": "Generat",
};

export default ca;
