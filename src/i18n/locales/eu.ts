// BETA: Itzulpen automatikoa, hiztun natiboak berrikusi behar du
/** Euskara */
import type { TranslationKeys } from "./es.js";

const eu: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Atzerriko brokerra → Espainiako errenta",


  "upload.title": "1. Igo zure brokerraren txostena",
  "upload.broker_label": "Brokerra:",
  "upload.auto_detect": "Auto-detektatu",
  "upload.drop_text": "Arrastatu zure fitxategia hona edo egin klik hautatzeko",
  "upload.formats_help": "Formatuak: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "2. Konfiguratu",
  "config.year_label": "Ekitaldi fiskala:",
  "config.process_btn": "Prozesatu",
  "config.processing": "Prozesatzen...",

  "results.title": "3. Emaitzak 100 Eredurako",
  "results.operations": "Eragiketak",
  "results.dividends": "Dibidenduak",
  "results.no_dividends": "Dibidendurik ez",
  "results.search_placeholder": "Bilatu ISIN edo sinboloz...",
  "results.filter_all": "Denak",
  "results.filter_gains": "Irabaziak",
  "results.filter_losses": "Galerak",
  "results.export_json": "Esportatu JSON",
  "results.export_csv": "Esportatu CSV",
  "results.operations_count": "{{count}} eragiketa",
  "results.dividends_count": "{{count}} dibidendu",

  "table.isin": "ISIN",
  "table.symbol": "Sinboloa",
  "table.buy_date": "Erosketa D.",
  "table.sell_date": "Salmenta D.",
  "table.units": "Ud.",
  "table.cost_eur": "Kostua EUR",
  "table.proceeds_eur": "Salmenta EUR",
  "table.gain_loss_eur": "I/G EUR",
  "table.days": "Egunak",
  "table.date": "Data",
  "table.gross_eur": "Gordina EUR",
  "table.withholding_eur": "Atxikipena EUR",
  "table.country": "Herrialdea",
  "table.casilla": "Laukia",
  "table.concept": "Kontzeptua",
  "table.amount_eur": "Zenbatekoa (EUR)",

  "casilla.transmission_value": "Transmisio-balioa",
  "casilla.acquisition_value": "Eskuratze-balioa",
  "casilla.net_gain_loss": "Irabazi/Galera garbia",
  "casilla.gross_dividends": "Dibidendu gordinak",
  "casilla.interest_earned": "Jasotako interesak",
  "casilla.interest_paid": "Ordaindutako interesak (marjina)",
  "casilla.double_taxation": "Zergapetze bikoitzaren kenkaria",
  "casilla.blocked_losses": "Anti-churning arauagatik blokeatutako galerak (2 hilabete): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} abisu",

  "chart.asset_distribution": "Aktibo motaren araberako banaketa",
  "chart.monthly_gl": "Hileko irabazi/galera",
  "chart.currency_composition": "Dibisa konposizioa",
  "chart.withholdings_country": "Atxikipenak herrialdearen arabera",

  "footer.privacy": "Self-hosted · Pribatutasun osoa",
  "footer.disclaimer": "Lege-oharra",

  "disclaimer.title": "Lege-oharra",
  "disclaimer.text": "Tresna hau informazio-helburuetarako soilik da eta ez du zerga- edo lege-aholkularitza osatzen. Sortutako emaitzak erabiltzaileak eta/edo profesional kualifikatu batek egiaztatu behar ditu edozein zerga-aitorpenean erabili aurretik.\n\nDeclaRenta ez da informazio honen erabileratik eratorritako akats, omisio edo ondorioen erantzulea. Erabiltzailea da sartutako datuen eta Zerga Agentzian aurkeztutako aitorpenen zehaztasunaren erantzule bakarra.\n\nTruke-tasak Europako Banku Zentraletik (EBZ) datoz. Zerga-kalkuluak indarrean dagoen araudian oinarritzen dira (LIRPF, Ondare Zerga, EHA/3290/2008 Agindua) baina baliteke supostu guztiak ez estaltzea edo softwarearen azken eguneratzearen ondorengo arau-aldaketak ez islatzea.",
  "disclaimer.accept": "Ulertuta",

  "a11y.skip_link": "Edukira salto egin",
  "a11y.nav_label": "Ezarpenak",
  "a11y.lang_label": "Hizkuntza",
  "a11y.theme_toggle": "Gaia aldatu",
  "a11y.drop_zone": "Fitxategiak igotzeko eremua",
  "a11y.file_input": "Fitxategiak hautatu",

  "theme.toggle": "Gaia aldatu",

  "error.no_broker_detected": "Ezin izan da \"{{filename}}\" fitxategiaren brokerra detektatu. Hautatu brokerra eskuz.",
  "error.prefix": "Errorea: ",

  "status.fetching_rates": "EBZ tasak lortzen {{currencies}} monetetarako...",
  "status.files_processed": "{{count}} fitxategi prozesatu — {{brokers}} — {{trades}} eragiketa",
};

export default eu;
