// BETA: Itzulpen automatikoa, hiztun natiboak berrikusi behar du
/** Euskara */
import type { TranslationKeys } from "./es.js";

const eu: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Atzerriko brokerra → Espainiako errenta",


  "upload.title": "Igo zure brokerraren txostena",
  "upload.broker_label": "Brokerra:",
  "upload.auto_detect": "Auto-detektatu",
  "upload.drop_text": "Arrastatu zure fitxategia hona edo egin klik hautatzeko",
  "upload.formats_help": "Formatuak: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "Konfiguratu",
  "config.year_label": "Ekitaldi fiskala:",
  "config.process_btn": "Prozesatu",
  "config.processing": "Prozesatzen...",

  "results.title": "Emaitzak 100 Eredurako",
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

  "footer.docs": "Dokumentazioa",
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

  // Wizard steps
  "wizard.step1": "Fitxategiak igo",
  "wizard.step2": "Datuak berrikusi",
  "wizard.step3": "Emaitzak",
  "wizard.next": "Hurrengoa",
  "wizard.back": "Atzera",

  // Review step
  "review.title": "Kargatutako datuen laburpena",
  "review.broker": "Brokerra",
  "review.trades_count": "Eragiketak",
  "review.dividends_count": "Dibidenduak",
  "review.date_range": "Data-tartea",
  "review.currencies": "Dibisak",
  "review.no_data": "Ez da eragiketarik detektatu igotako fitxategietan.",
  "review.file": "Fitxategia",

  // Config step
  "config.nif_label": "NIF (720 Eredu/D-6-rako):",
  "config.nif_placeholder": "12345678A",
  "config.generate_720": "720 Ereduaren fitxategia sortu",
  "config.generate_d6": "D-6 gida sortu",

  // Expandable casillas
  "casilla.expand": "Xehetasuna ikusi",
  "casilla.collapse": "Xehetasuna ezkutatu",
  "casilla.operations_in": "Lauki honetako eragiketak",
  "casilla.no_operations": "Eragiketarik ez",

  // Year comparison
  "compare.title": "Urteko konparazioa",
  "compare.no_data": "Prozesatu gutxienez 2 ekitaldi konparazioa ikusteko.",
  "compare.year": "Ekitaldia",
  "compare.variation": "Aldakuntza",
  "compare.saved_reports": "Gordetako txostenak",
  "compare.clear_history": "Historiala ezabatu",
  "compare.clear_confirm": "Gordetako txosten guztiak ezabatu?",

  "error.no_broker_detected": "Ezin izan da \"{{filename}}\" fitxategiaren brokerra detektatu. Hautatu brokerra eskuz.",
  "error.prefix": "Errorea: ",

  "status.fetching_rates": "EBZ tasak lortzen {{currencies}} monetetarako...",
  "status.files_processed": "{{count}} fitxategi prozesatu — {{brokers}} — {{trades}} eragiketa",

  "sidebar.profile": "Profil fiskala",
  "sidebar.renta": "100 Eredua (Errenta)",
  "sidebar.m720": "720 Eredua",
  "sidebar.d6": "D-6 Eredua",
  "sidebar.toggle": "Menua ireki/itxi",

  "profile.title": "Profil fiskala",
  "profile.description": "Datu hauek 720 eta D-6 ereduen fitxategiak sortzeko erabiltzen dira.",
  "profile.nif_label": "NIF/NIE:",
  "profile.surname_label": "Abizenak:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Izena:",
  "profile.name_placeholder": "Jon",
  "profile.ccaa_label": "Autonomia Erkidegoa:",
  "profile.phone_label": "Telefonoa:",
  "profile.phone_placeholder": "600123456",
  "profile.saved": "Profila gordeta",
  "profile.incomplete_banner": "Osatu zure profil fiskala 720 eta D-6 ereduak sortzeko.",
  "profile.go_to_profile": "Profilara joan",

  "guide.title": "Nola lortu txostena?",
  "guide.tip_fifo": "Historial osoa sartu — DeclaRentak aurreko eragiketak behar ditu FIFO kalkulu zuzenera.",

  "m720.title": "720 Eredua — Atzerriko ondasunak",
  "m720.description": "Atzerrian dauden ondasun eta eskubideei buruzko aitorpen informatiboa.",
  "m720.threshold_exceeded": "Zure posizioen arabera ({{amount}} €), 720 Eredua aurkeztera behartuta zaude.",
  "m720.threshold_not_exceeded": "Ez duzu 50.000 €-ko atalasea gainditzen (guztira: {{amount}} €). Ez zaude aurkeztera behartuta.",
  "m720.no_positions": "Igo posizio irekiak dituen txostena 100 Ereduan 720 Eredua aztertzeko.",
  "m720.positions_title": "Aitortu beharreko posizioak",
  "m720.generate_btn": "720 Ereduaren fitxategia sortu",
  "m720.deadline": "Epea: urtarrilaren 1etik martxoaren 31ra hurrengo urtean",
  "m720.total_value": "Balio osoa: {{amount}} €",
  "m720.filing_title": "Nola aurkeztu?",
  "m720.rates_title": "Aplikatutako truke-tasak (BZE)",
  "m720.deadline_short": "Epea: urtarrilak 1 – martxoak 31",
  "m720.filing_step1": "Sartu AEATen Egoitza Elektronikoan",
  "m720.filing_step2": "Bilatu «Modelo 720»",
  "m720.filing_step3": "Inportatu sortutako fitxategia (TGVI Online)",
  "m720.filing_step4": "Berrikusi eta sinatu ziurtagiri digitalarekin edo Cl@ve-rekin",

  "d6.title": "D-6 Eredua — Atzerriko inbertsioak",
  "d6.description": "Ekonomia Ministerioko Inbertsio Erregistroko aitorpena.",
  "d6.no_minimum": "D-6 EDOZEIN zenbatekorako da nahitaezkoa. Ez du gutxieneko atalaserik.",
  "d6.no_positions": "Igo posizio irekiak dituen txostena 100 Ereduan D-6 aztertzeko.",
  "d6.positions_title": "Aitortu beharreko posizioak",
  "d6.cancellations_title": "Baliogabetzeak",
  "d6.generate_btn": "D-6 gida sortu",
  "d6.deadline": "Epea: urtarrilaren 1etik 31ra hurrengo urtean",
  "d6.total_value": "Balio osoa: {{amount}} €",
  "d6.aforix_title": "AFORIX gida pausoz pauso",
  "d6.copy_btn": "Kopiatu",
  "d6.copied": "Kopiatuta",
  "d6.rates_title": "Aplikatutako truke-tasak (BZE)",
  "d6.deadline_short": "Epea: urtarrilak 1 – 31",
  "d6.copy_failed": "Errorea kopiatzean",
  "d6.aforix_position_of": "{{index}}. posizioa {{total}}(e)tik",

  "section.year_label": "Ekitaldia",

  "badge.complete": "Osatuta",
  "badge.pending": "Zain",
  "badge.not_applicable": "Ez da aplikagarri",
  "badge.generated": "Sortuta",
};

export default eu;
