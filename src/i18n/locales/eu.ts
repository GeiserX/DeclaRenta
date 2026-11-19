// BETA: Itzulpen automatikoa, hiztun natiboak berrikusi behar du
/** Euskara */
import type { TranslationKeys } from "./es.js";

const eu: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Atzerriko brokerra → Espainiako errenta",

  "upload.title": "Igo zure brokerraren txostena",
  "upload.broker_question": "Zein broker(ak) erabiltzen d(it)uzu?",
  "upload.broker_hint": "Hautatu bat edo gehiago. Pausoz pauso gidatuko zaitugu.",
  "upload.broker_label": "Brokerra:",
  "upload.auto_detect": "Auto-detektatu",
  "upload.drop_text": "Arrastatu zure fitxategia hona edo egin klik hautatzeko",
  "upload.formats_help":
    "Formatuak: XML (IBKR Flex), CSV (Degiro, Flatex, Trade Republic, Scalable, Lightyear, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro, Revolut)",
  "upload.autodetect_note": "Brokerra automatikoki detektatzen da kasu gehienetan.",
  "upload.detecting": "Fitxategia aztertzen...",
  "upload.detected": "Brokerra detektatu da:",
  "upload.detection_failed": "Ezin izan da brokerra detektatu. Hautatu eskuz.",
  "upload.broker_not_detected": "Ez al da zure brokerra detektatu?",
  "upload.guide_how": "Nola deskargatu nire brokerraren txostena?",
  "upload.guide_select_broker": "Hautatu zure brokerra:",
  "upload.choose_broker": "— hautatu brokerra —",
  "upload.guide_unavailable": "Gida oraindik ez dago erabilgarri broker honetarako.",
  "upload.chip_group_label": "Broker eskuzko hautapena",

  "config.title": "Konfiguratu",
  "config.process_btn": "Prozesatu",
  "config.processing": "Prozesatzen...",

  "results.title": "Emaitzak 100 Eredurako",
  "results.operations": "Eragiketak",
  "results.dividends": "Dibidenduak",
  "results.no_dividends": "Dibidendurik ez",
  "results.search_placeholder": "Bilatu ISIN edo sinboloz...",
  "results.search_placeholder_brokers": "Bilatu ISIN, sinbolo edo brokerrez...",
  "results.filter_all": "Denak",
  "results.filter_gains": "Irabaziak",
  "results.filter_losses": "Galerak",
  "results.export_json": "Esportatu JSON",
  "results.export_csv": "Esportatu CSV",
  "results.export_csv_title": "«,» bereizlea eta puntudun hamartarrak: programetarako eta ingelesezko kalkulu-orrietarako",
  "results.export_csv_excel": "Esportatu CSV Excelerako (ES)",
  "results.export_csv_excel_title": "«;» bereizlea eta komadun hamartarrak: zutabetan irekitzen da klik bikoitzarekin Excel espainieraz dagoenean",
  "results.export_pdf": "Esportatu PDF",
  "results.operations_count": "{{count}} eragiketa",
  "results.dividends_count": "{{count}} dibidendu",
  "results.newer_years_notice": "{{year}} erakusten da; zure datuek {{years}} ere hartzen dute.",
  "results.year_mismatch":
    "Fitxategiak {{available}} ekitaldietako datuak ditu, baina hautatutako ekitaldia {{year}} da. Hautatu beste urte bat goiko zerrendan.",
  "results.setting_yes": "bai",
  "results.setting_no": "ez",

  "table.isin": "ISIN",
  "table.symbol": "Sinboloa",
  "table.buy_date": "Erosketa D.",
  "table.sell_date": "Salmenta D.",
  "table.buy_broker": "Erosketa brokerra",
  "table.sell_broker": "Salmenta brokerra",
  "table.units": "Ud.",
  "table.cost_eur": "Kostua EUR",
  "table.proceeds_eur": "Salmenta EUR",
  "table.gain_loss_eur": "I/G EUR",
  "table.days": "Egunak",
  "table.date": "Data",
  "table.gross_eur": "Gordina EUR",
  "table.withholding_eur": "Atxikipena EUR",
  "table.country": "Herrialdea",
  "table.payments": "Ordainketak",
  "casilla.dividends_by_issuer": "Dibidenduak jaulkitzaileka",
  "casilla.dividends_per_payment": "Banakako ordainketak",
  "casilla.dividends_withholding_note": "<strong>Atzerriko</strong> atxikipena ez da hemen aitortzen: Renta Web-eko «Alta Capital mobiliario» formularioan, utzi 0 balioan eta kendu 0588 gelaxkan (nazioarteko zergapetze bikoitza, IRPF Legearen 80. art.). Baina <strong>espainiar</strong> jaulkitzaileen gaineko atxikipen espainiarra (ISIN ES…) konturako ordainketa da eta 0597 laukira doa.",
  "table.casilla": "Laukia",
  "table.concept": "Kontzeptua",
  "table.amount_eur": "Zenbatekoa (EUR)",
  "table.currency": "Moneta",
  "table.fx_origin": "Jatorria",
  "table.fx_lot": "FIFO lotea",
  "fx.trigger.conversion": "Dibisa-bihurketa",
  "fx.trigger.dividend": "Dibidendua",
  "fx.trigger.interest": "Interesak",
  "fx.trigger.commission": "Komisioa",
  "fx.trigger.stock_purchase": "Balore-erosketa",
  "fx.trigger.stock_sale": "Galerak dituen salmenta batean galdutako dibisa",
  "fx.trigger.stock_sale_guard": "Dibisaren aldaketa akzioak erosi arte",
  "fx.trigger.stock_sale_cross": "Beste moneta batean saldutako akzioetan inbertitutako dibisa",
  "fx.trigger.loan_repayment": "Brokerraren dibisa-mailegu baten itzulketa",

  "casilla.listed_transmission_value": "Transmisio-balioa (negoziatutako akzioak)",
  "casilla.listed_acquisition_value": "Eskuratze-balioa (negoziatutako akzioak)",
  "casilla.acquisition_sale_rate_note":
    "Eskuratze-balioa SALMENTA-dataren BCE kanbio-tasan erakusten da, eskualdaketa − eskuratzea irabazi edo galerarekin zehazki bat etor dadin (DGT V2422-20: irabazia akzioaren monetan kalkulatzen da eta diferentzia bakarrik bihurtzen da eurotara). Atzerriko monetako baloreetan zenbateko hau erosketa-datako euro-kostu historikotik desberdina da eta baliteke aurreko bertsioetan gordetako zifrekin bat ez etortzea.",
  "casilla.other_transmission_value": "Transmisio-balioa (beste elementuak: opzioak/kripto/funtsak/dibisa)",
  "casilla.other_acquisition_value": "Eskuratze-balioa (beste elementuak: opzioak/kripto/funtsak/dibisa)",
  "casilla.fx_transmission_value": "FX transmisio-balioa (atzerriko moneta)",
  "casilla.fx_acquisition_value": "FX eskuratze-balioa (atzerriko moneta)",
  "casilla.fx_cost_split": "{{fx}} € dibisaren kostua eta {{shift}} € akzioan lehendik aitortutako aldaketa",
  "casilla.fx_net_gain_loss": "FX irabazi/galera garbia (atzerriko moneta)",
  "casilla.net_gain_loss": "Irabazi/Galera garbia (transmisioak)",
  "casilla.gross_dividends": "Dibidendu gordinak",
  "casilla.interest_earned": "Jasotako interesak",
  "casilla.interest_paid": "Brokerrari ordaindutako interesak (marjina, ez kengarria — informatiboa)",
  "casilla.general_gains":
    "Transmisiotik eratortzen ez diren ondare-irabaziak (airdropak, lagunak gomendatzeagatiko komisioak)",
  "casilla.spanish_withholding": "Kapital higigarriaren atxikipenak (0597 laukia)",
  "casilla.spanish_withholding_detail":
    "Espainiako jaulkitzaileen dibidendu edo interesen gainean jatorrian egindako PFEZ atxikipena (adib. IBEX akzioak), atzerriko artekari batean egon arren. Kuotatik kentzeko konturako ordainketa da; EZ da nazioarteko zergapetze bikoitzaren kenkaria (0588 laukia), atzerriko zergari soilik aplikatzen zaiona.",
  "casilla.double_taxation": "Zergapetze bikoitzaren kenkaria",
  "casilla.dt_foreign_income_total": "Atzerriko errendimenduak guztira",
  "casilla.reintegrated_losses":
    "Orain integratzen diren galera atzeratuak (epean berrerosketarik gabe saldutako akzioak, «behin betiko eskualdaketa»; kriptoetan, berrerositako unitateen salmenta): {{amount}} EUR",
  "casilla.blocked_losses":
    "Anti-churning arauagatik blokeatutako galerak (2 hilabete merkatu arautu edo baliokidean / 1 urte gainerakoetan; kriptoetan, salmentaren ondorengo urtea): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} abisu",
  "messages.errors_title": "{{count}} errore — arreta behar du",
  "messages.warnings_title": "{{count}} abisu — berrikusi",
  "messages.info_title": "{{count}} ohar informatibo",
  "pdf.severity_error": "Errorea",
  "pdf.severity_warning": "Abisua",
  "pdf.severity_info": "Oharra",
  "pdf.section_messages": "Mezuak",

  "chart.asset_distribution": "Aktibo motaren araberako banaketa",
  "chart.monthly_gl": "Hileko irabazi/galera",
  "chart.currency_composition": "Dibisa konposizioa",
  "chart.withholdings_country": "Atxikipenak herrialdearen arabera",
  "chart.month_1": "Urt",
  "chart.month_2": "Ots",
  "chart.month_3": "Mar",
  "chart.month_4": "Api",
  "chart.month_5": "Mai",
  "chart.month_6": "Eka",
  "chart.month_7": "Uzt",
  "chart.month_8": "Abu",
  "chart.month_9": "Ira",
  "chart.month_10": "Urr",
  "chart.month_11": "Aza",
  "chart.month_12": "Abe",
  "asset.stk": "Akzioak",
  "asset.fund": "Funtsak / ETFak",
  "asset.opt": "Opzioak",
  "asset.fop": "Etorkizunen gaineko opzioak",
  "asset.crypto": "Kriptomonetak",
  "asset.bond": "Bonuak",
  "option.expiration": "Iraungitzea",
  "option.close": "Aurretiazko itxiera",
  "option.exercise": "Erabilera/Esleipena",

  "footer.docs": "Dokumentazioa",
  "footer.privacy": "Self-hosted · Pribatutasun osoa",
  "footer.disclaimer": "Lege-oharra",

  "disclaimer.title": "Lege-oharra",
  "disclaimer.text":
    "Tresna hau informazio-helburuetarako soilik da eta ez du zerga- edo lege-aholkularitza osatzen. Sortutako emaitzak erabiltzaileak eta/edo profesional kualifikatu batek egiaztatu behar ditu edozein zerga-aitorpenean erabili aurretik.\n\nDeclaRenta ez da informazio honen erabileratik eratorritako akats, omisio edo ondorioen erantzulea. Erabiltzailea da sartutako datuen eta Zerga Agentzian aurkeztutako aitorpenen zehaztasunaren erantzule bakarra.\n\nTruke-tasak Europako Banku Zentraletik (EBZ) datoz. Zerga-kalkuluak indarrean dagoen araudian oinarritzen dira (LIRPF, Ondare Zerga, EHA/3290/2008 Agindua) baina baliteke supostu guztiak ez estaltzea edo softwarearen azken eguneratzearen ondorengo arau-aldaketak ez islatzea.",
  "disclaimer.accept": "Ulertuta",

  "a11y.skip_link": "Edukira salto egin",
  "a11y.nav_label": "Ezarpenak",
  "a11y.lang_label": "Hizkuntza",
  "a11y.theme_toggle": "Gaia aldatu",
  "a11y.drop_zone": "Fitxategiak igotzeko eremua",
  "a11y.file_input": "Fitxategiak hautatu",
  "a11y.ops_search": "Bilatu eragiketak ISIN edo sinboloz",
  "a11y.ops_search_brokers": "Bilatu eragiketak ISIN, sinbolo edo brokerrez",
  "a11y.ops_filter": "Iragazi eragiketak emaitzaren arabera",
  "a11y.remove_file": "Kendu {{name}}",

  "theme.toggle": "Gaia aldatu",

  // Wizard steps
  "wizard.step1": "Fitxategiak igo",
  "wizard.step2": "Berrikusi eta metodoa aukeratu",
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
  "casilla.copy": "Kopiatu zenbatekoa",
  "casilla.copied": "Kopiatuta!",

  // Year comparison
  "compare.title": "Urteko konparazioa",
  "compare.no_data": "Prozesatu gutxienez 2 ekitaldi konparazioa ikusteko.",
  "compare.year": "Ekitaldia",
  "compare.variation": "Aldakuntza",
  "compare.saved_reports": "Gordetako txostenak",
  "compare.clear_history": "Historiala ezabatu",
  "compare.clear_confirm": "Gordetako txosten guztiak ezabatu?",
  "compare.transmission_value": "Transmisio-balioa (transmisioak, dibisarik gabe)",
  "compare.acquisition_value": "Eskuratze-balioa (transmisioak, dibisarik gabe)",
  "compare.net_gain_loss": "Irabazi/Galera garbia (transmisioak, dibisarik gabe)",

  "error.no_broker_detected":
    'Ezin izan da "{{filename}}" fitxategiaren brokerra detektatu. Broker baten txostena bada, hautatu brokerra eskuz; bestela, kendu zerrendatik.',
  "error.empty_file":
    '"{{filename}}" fitxategia hutsik dago. Kendu zerrendatik edo esportatu berriro zure brokerretik.',
  "error.file_too_large":
    '"{{filename}}" fitxategiak {{limit}} MB-ko muga gainditzen du eta baztertu egin da. Esportatu epe laburragoa edo zatitu fitxategia.',
  "error.prefix": "Errorea: ",

  "status.fetching_rates": "EBZ tasak lortzen {{currencies}} monetetarako...",
  "status.files_processed": "{{count}} fitxategi prozesatu — {{brokers}} — {{trades}} eragiketa",

  "sidebar.profile": "Profil fiskala",
  "sidebar.renta": "100 Eredua (Errenta)",
  "sidebar.m720": "720 Eredua",
  "sidebar.m721": "721 Eredua",
  "sidebar.d6": "D-6 Eredua",
  "sidebar.toggle": "Menua ireki/itxi",

  "profile.title": "Profil fiskala",
  "profile.description": "Datu hauek 720 eta D-6 ereduen fitxategiak sortzeko erabiltzen dira. Nabigatzaile honetan bakarrik gordetzen dira, inoiz ez zerbitzari batean.",
  "profile.section_personal": "Datu pertsonalak",
  "profile.nif_label": "NIF/NIE:",
  "profile.nif_placeholder": "12345678Z",
  "profile.nif_invalid": "NIF/NIE hau ez da baliozkoa: egiaztatu digituak eta kontrol-letra.",
  "profile.surname_label": "Abizenak:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Izena:",
  "profile.name_placeholder": "Jon",
  "profile.ccaa_label": "Autonomia Erkidegoa:",
  "profile.phone_label": "Telefonoa:",
  "profile.phone_placeholder": "600123456",
  "review.autoconvert_label": "Prozesatu artekariaren auto-bihurketak (AFx/FXCONV)",
  "review.autoconvert_detail":
    "Lehenetsita aktibatuta. Interactive Brokersek ez du eurotara berriz bihurtzen akzio bat saltzean, beraz dibisa-saldoa erreala da eta gero bihurtzeak ondare-irabazi edo -galera sortzen du (LIRPF 33.1 art.). Desaktibatu soilik zure artekariak EUR↔dibisa round-trip osoa egiten badu eta dibisaren eragina alde batera utzi nahi baduzu.",
  "review.titulares_label": "Titular kopurua:",
  "review.titulares_detail":
    "Kontuak hainbat titular baditu (adib. kontu bateratua edo irabazpidezkoa), DeclaRentak zenbateko guztiak zati berdinetan banatzen ditu zergadun bakoitzari dagokion partea erakusteko (LIRPF 11.3 art.). Titular bakoitzak bere aitorpen indibiduala aurkezten du bere partearengatik.",
  "profile.saved": "Profila gordeta",
  "profile.clear_btn": "Ezabatu nire datuak nabigatzaile honetatik",
  "profile.clear_confirm": "Nabigatzaile honetatik ezabatu zure profil fiskala, gordetako txostenak eta eskuz sartutako balioak?",
  "profile.incomplete_banner": "Osatu zure profil fiskala 720 eta D-6 ereduak sortzeko.",
  "profile.go_to_profile": "Profilara joan",

  // FX method (#434): review step, results header, comparison
  "method.multidivisa.sub": "Irabazia akzioaren dibisan kalkulatzen da",
  "method.multidivisa.text": "Akzio bakoitzaren irabazia bere dibisan kalkulatzen du, eta salmenta-eguneko tasan eurotara pasatzen du. Daukazun dibisak eurotan zenbat kostatu zitzaizun gordetzen du. Haren kanbio-diferentzia eurotara edo beste dibisa batera aldatzen duzunean ateratzen da.",
  "method.multidivisa.basis": "Lege-oinarria: Ogasunaren irizpidea akzioetarako (DGT V1740-17, V2422-20, V0282-22).",
  "method.tradicional_divisa.sub": "Erosketa eta salmenta bakoitza bere tasan, eta zure dibisa FIFO bidez",
  "method.tradicional_divisa.text": "Akzioak erosketa-eguneko eta salmenta-eguneko EBZren tasan balioesten dira. Dibisak zure kontutik irteten denean bakarrik tributatzen du: eurotara edo beste dibisa batera aldatzen duzunean, komisioak ordaintzean edo galerak dituen salmenta batean galtzen duzunean. Akzioen barruan aitortu duzuna ez da berriro zenbatzen.",
  "method.tradicional_divisa.basis": "Akzioen balioespena: DGTren irizpidea dibisako funts-partaidetzetarako (V2324-10, V0775-21), akzioei aplikatua. Dibisa: aldatzen duzunean aitortzen da (V2466-08), edo galerak dituen salmenta batean galtzen duzunean (V0775-21, V2324-10).",
  "method.tradicional_divisa.risk": "Ogasunak «DGTren irizpidea (multidibisa)» aplikatzen die akzioei (V1740-17). 2025ean kalkulu bera baztertu zuen dolarretan erosi eta saldutako pisu baterako (V1615-25). Zure aitorpena berrikusten badu, irizpide horrekin berriro kalkula dezake. Galerak dituen salmentarik gabe, ziklo oso baten guztizkoa ia berdina izaten da; zati bakoitza zein urtetan eta zein laukitan ateratzen den aldatzen da.",
  "method.monodivisa.sub": "Erosketa eta salmenta bakarrik, bakoitza bere tasan",
  "method.monodivisa.text": "Erosketa erosketa-eguneko tasan eta salmenta salmenta-eguneko tasan balioesten ditu. Ez du dibisa-emaitzarik batere kalkulatzen, ez zure euro-aldaketetan, ez artekariaren aldaketa automatikoetan.",
  "method.monodivisa.basis": "Lege-oinarria: PFEZLren 35.1 art., 14.2.e art.-ko dibisarik gabe. Dibisa eurotara aldatzen baduzu, emaitza distortsiona dezake.",
  "method.monodivisa.risk": "Metodo honek ez du zure dibisa-aldaketen emaitza aitortzen. Erabili dibisarik aldatzen ez baduzu bakarrik.",
  "method.unknown": "ezezaguna",
  "review.method_title": "Nola kalkulatu zure dibisako akzioak?",
  "review.method_lead": "Eragiketak dituzu dibisa hauetan: {{currencies}}. Metodoak zure errentaren zifrak aldatzen ditu. Aukeratu bat eta mantendu urte guztietan.",
  "review.method_recommended": "Gomendatua",
  "review.method_last_year": "{{year}}. urtean «{{method}}» erabili zenuen.",
  "review.method_last_year_switch": "{{year}}. urtean «{{method}}» erabili zenuen. Metodoz aldatzen baduzu eta orduko dibisa oraindik baduzu, emaitzaren zati bat bi aldiz atera edo gal daiteke. Erabili metodo bera urte guztietan.",
  "review.other_settings": "Kalkuluaren beste ezarpen batzuk",
  "review.autoconvert_off_mono": "Ez da aplikatzen «Tradizionala dibisarik gabe (monodibisa)» metodoarekin, metodo horrek ez baitu dibisarik kalkulatzen.",
  "review.calculate": "Kalkulatu",
  "review.calculate_with": "Kalkulatu «{{method}}» metodoarekin",
  "review.show_details": "Xehetasunak ikusi",
  "results.method_chip": "Metodoa: {{method}}",
  "results.method_change": "Aldatu",
  "results.method_change_aria": "Kalkulu-metodoa aldatu",
  "results.titulares_one": "Titular 1",
  "results.titulares_many": "{{count}} titular",
  "results.autoconvert_chip": "Auto-bihurketak: {{value}}",
  "results.how_title": "Nola kalkulatu den",
  "results.split_shares": "Akzioak",
  "results.split_shares_sub": "0328 eta 0331 laukiak",
  "results.split_securities": "Akzioak eta beste balore batzuk",
  "results.split_securities_sub": "0328 eta 0331 laukiak, eta 1633 eta 1637 laukien zati bat",
  "results.split_fx": "Dibisa",
  "results.split_fx_sub": "1633 eta 1637 laukietan sartuta",
  "results.split_fx_off": "ez da kalkulatzen metodo honekin",
  "results.split_total": "Guztira",
  "results.split_total_sub": "aurrezki-oinarrira · kuota estimatua {{tax}} €",
  "results.compare_title": "Beste metodoekin alderatu (beste tresna batekin bat etortzeko)",
  "results.compare_in_use": "Erabiltzen",
  "results.compare_tax": "Kuota estimatua",
  "results.compare_note": "Informazio gisa bakarrik. Metodoa aldatzeko, itzuli «Berrikusi eta metodoa aukeratu» urratsera.",
  "results.compare_loading": "Kalkulatzen…",
  "results.compare_error": "Ezin izan da alderaketa kalkulatu.",
  "casilla.acquisition_buy_rate_note_fx": "Eskuratze-balioa EROSKETA-eguneko EBZren kanbio-tasan erakusten da, «Tradizionala dibisarekin» metodoak eskatzen duen bezala. Eskualdatzea − eskuratzea akzioaren irabazia edo galera da eurotan. Dibisaren emaitza aparte doa, 1633 eta 1637 laukietan.",
  "casilla.acquisition_buy_rate_note_mono": "Eskuratze-balioa EROSKETA-eguneko EBZren kanbio-tasan erakusten da, «Tradizionala dibisarik gabe (monodibisa)» metodoak eskatzen duen bezala. Eskualdatzea − eskuratzea akzioaren irabazia edo galera da eurotan. Metodo honek ez du dibisa-emaitzarik kalkulatzen.",
  "casilla.no_other_elements_fx_below": "Ez dago beste elementurik. Dibisaren emaitza behean dago.",
  "compare.method": "Metodoa",
  "compare.method_mismatch": "Urte hauek metodo desberdinak erabiltzen dituzte. Metodoz aldatzen baduzu eta aurreko urte bateko dibisa oraindik baduzu, emaitzaren zati bat bi aldiz atera edo gal daiteke.",
  "profile.autosave": "Aldaketak automatikoki gordetzen dira nabigatzaile honetan.",
  "profile.method_moved": "Dibisa-metodoa, titularrak eta auto-bihurketak 100 Ereduan aukeratzen dira orain, «Berrikusi eta metodoa aukeratu» urratsean.",
  "profile.go_to_renta": "100 Eredura joan",

  "guide.title": "Nola lortu txostena?",
  "guide.tip_fifo": "Historial osoa sartu — DeclaRentak aurreko eragiketak behar ditu FIFO kalkulu zuzenera.",
  "guide.select_broker_hint": "Hautatu zure brokerra txostenaren deskarga-argibideak ikusteko.",
  "guide.heading": "Nola lortu zure brokerraren txostena?",
  "guide.ibkr.title": "Interactive Brokers (Flex Query XML)",
  "guide.ibkr.step1": "Hasi saioa IBKRren <strong>Bezero Atarian</strong>",
  "guide.ibkr.step2": "Joan <strong>Errendimendua eta informeak</strong> → <strong>Flex kontsultak</strong> fitxara",
  "guide.ibkr.step3":
    "<strong>Jarduera flex kontsulta</strong> atalean, egin klik <strong>+</strong> kontsulta berria sortzeko",
  "guide.ibkr.step4":
    "Konfigurazioan, gaitu atal hauek:<ul><li><strong>Trades</strong> (nahitaezkoa)</li><li><strong>Cash Transactions</strong> — dibidenduak eta atxikipenak (nahitaezkoa)</li><li><strong>Open Positions</strong> — 720 Eredu/D-6-rako (gomendatua)</li><li><strong>Financial Instrument Information</strong> (gomendatua)</li></ul>",
  "guide.ibkr.step5":
    "Atal bakoitzean, <strong>hautatu eremu guztiak</strong> (markatu lauki guztiak). Zenbat eta datu gehiago sartu, orduan eta kalkulua zehatzagoa. Gutxienez, ziurtatu <strong>Notes</strong> eremua Trades atalean sartzen duzula — dibisa bihurtzeen detekziorako beharrezkoa da.",
  "guide.ibkr.step6": "Irteera-formatua: <strong>XML</strong>. <em>Date Format</em> aukeran, utzi <strong>yyyyMMdd</strong>",
  "guide.ibkr.step7": "Sartu <strong>eskuragarri dauden urte guztiak</strong> FIFO kalkulu zuzenerako",
  "guide.ibkr.step8": "Gorde kontsulta, exekutatu eta deskargatu <code>.xml</code> fitxategia",
  "guide.degiro.title": "Degiro (CSV)",
  "guide.degiro.step1": "Hasi saioa <strong>Degiroren webean</strong> (ez aplikazioan)",
  "guide.degiro.step2": "Ireki <strong>Sarrera-ontzia</strong> alboko panela (gutun-azalaren ikonoa)",
  "guide.degiro.step3": "Egin klik <strong>Transakzioak</strong> (zure produktuen transakzio-historia)",
  "guide.degiro.step4": "Hautatu nahi duzun data-tartea (<strong>historia osoa</strong> sartu FIFO-rako)",
  "guide.degiro.step5": "Egin klik <strong>Esportatu</strong> botoian eta deskargatu CSV fitxategia",
  "guide.degiro.step6":
    "Dibidenduetarako: itzuli <strong>Sarrera-ontzira</strong> \u2192 <strong>Kontua</strong> (kontuaren mugimendu-historia) \u2192 data-tarte bera \u2192 <strong>Esportatu</strong> CSV",
  "guide.flatex.title": "Flatex (CSV)",
  "guide.flatex.step1": "Hasi saioa <strong>Flatex webgunean</strong>",
  "guide.flatex.step2":
    "Joan <strong>Mugimenduak</strong> \u2192 <strong>Depotums\u00e4tze</strong> (zorroaren mugimenduak) atalera",
  "guide.flatex.step3": "Hautatu <strong>historia osoa</strong> (FIFOrako beharrezkoa) eta esportatu CSV fitxategia",
  "guide.flatex.step4":
    "Dibidenduetarako: joan <strong>Kontoums\u00e4tze</strong> (kontuaren mugimenduak) atalera, data-tarte bera, eta esportatu CSVa. Kontuz: han dibidenduak zenbateko garbiarekin agertzen dira, atxikipena kenduta; hartu zenbateko osoa eta atxikipena dibidendu bakoitzaren PDF egiaztagiritik",
  "guide.flatex.step5":
    "Igo <strong>bi CSV fitxategiak</strong> (Depotums\u00e4tze eragiketetarako eta Kontoums\u00e4tze dibidenduetarako)",
  "guide.etoro.title": "eToro (XLSX)",
  "guide.etoro.step1": "Hasi saioa <strong>eToro</strong>-n",
  "guide.etoro.step2": "Joan <strong>Ezarpenak → Kontu-laburpena</strong> atalera",
  "guide.etoro.step3": "Hautatu ekitaldi fiskalaren aldia",
  "guide.etoro.step4": "Deskargatu <strong>XLSX</strong> (Excel) fitxategia",
  "guide.scalable.title": "Scalable Capital (CSV)",
  "guide.scalable.step1": "Hasi saioa <strong>Scalable Capital</strong>-en",
  "guide.scalable.step2": "Joan <strong>Profila → Zerga-dokumentuak</strong> atalera",
  "guide.scalable.step3": "Deskargatu transakzio-txostena <strong>CSV</strong> formatuan",
  "guide.freedom24.title": "Freedom24 (JSON)",
  "guide.freedom24.step1": "Hasi saioa <strong>Freedom24 web plataforman</strong>",
  "guide.freedom24.step2": "Joan <strong>Txostenak → Eragiketa-txostena</strong> atalera",
  "guide.freedom24.step3": "Hautatu aldia eta <strong>JSON</strong> formatua",
  "guide.freedom24.step4": "Deskargatu fitxategia",
  "guide.coinbase.title": "Coinbase (CSV)",
  "guide.coinbase.step1": "Hasi saioa <strong>Coinbase</strong>-n",
  "guide.coinbase.step2": "Joan <strong>Zergak → Dokumentuak</strong> atalera",
  "guide.coinbase.step3": "Egin klik <strong>Txostena sortu</strong> botoian",
  "guide.coinbase.step4": "Deskargatu transakzio-historiala CSV formatuan",
  "guide.binance.title": "Binance (CSV)",
  "guide.binance.step1": "Hasi saioa <strong>Binance</strong>-n",
  "guide.binance.step2":
    "<strong>Spot eragiketa-historiala:</strong> Aginduak → Spot agindua → Eragiketa-historiala esportatu (↑) → Spot - Eragiketa Historiala → Denbora pertsonalizatu (UTC+1) → CSV",
  "guide.binance.step3":
    "<strong>Transakzio-historiala:</strong> Aginduak → Aktiboen Historiala → Transakzio-erregistroak esportatu (↑) → Transakzio Historiala → Denbora pertsonalizatu (UTC+1) → CSV",
  "guide.binance.step4": "Fitxategi bat edo biak igo ditzakezu — gaztelaniaz/euskaraz nahiz ingelesez onartzen dira",
  "guide.kraken.title": "Kraken (CSV)",
  "guide.kraken.step1": "Hasi saioa <strong>Kraken</strong>-en",
  "guide.kraken.step2": "Joan <strong>History → Export</strong> atalera",
  "guide.kraken.step3": "Hautatu <strong>Trades</strong> eta data-tartea",
  "guide.kraken.step4": "Formatua: <strong>CSV</strong>, deskargatu fitxategia",

  // Trade Republic
  "guide.trade_republic.title": "Trade Republic (CSV)",
  "guide.trade_republic.step1": "Ireki <strong>Trade Republic</strong> aplikazioa",
  "guide.trade_republic.step2": "Joan <strong>Profila → Jarduera</strong> atalera",
  "guide.trade_republic.step3": "Sakatu hiru puntuak (⋯) eta hautatu <strong>Esportatu</strong>",
  "guide.trade_republic.step4": "Hautatu data-tartea eta <strong>CSV</strong> formatua",
  "guide.trade_republic.step5": "Deskargatu fitxategia eta bidali zure ordenagailura",

  // Revolut
  "guide.revolut.title": "Revolut (XLSX)",
  "guide.revolut.step1": "Hasi saioa <strong>Revolut web</strong>ean (app.revolut.com edo app mugikorra)",
  "guide.revolut.step2": "Joan <strong>Trading/Kripto → Laburpenak</strong> atalera",
  "guide.revolut.step3": "Hautatu <strong>Trading Account Statement</strong> ekitaldi fiskalerako",
  "guide.revolut.step4": "Deskargatu <strong>XLSX</strong> (Excel) formatuan",

  // Trading 212
  "guide.trading212.title": "Trading 212 (CSV)",
  "guide.trading212.step1": "Hasi saioa <strong>Trading 212 webgunean</strong>",
  "guide.trading212.step2": "Joan <strong>Historiala → Transakzioak</strong> atalera",
  "guide.trading212.step3": "Iragazi nahi duzun data-tartearen arabera",
  "guide.trading212.step4": "Egin klik <strong>CSV deskargatu</strong> botoian",

  // Lightyear
  "guide.lightyear.title": "Lightyear (CSV)",
  "guide.lightyear.step1": "Ireki <strong>Lightyear</strong> aplikazioa",
  "guide.lightyear.step2": "Joan <strong>Profila → Txostenak</strong> atalera",
  "guide.lightyear.step3": "Hautatu <strong>Transaction report</strong> eta aldia",
  "guide.lightyear.step4": "Deskargatu CSV fitxategia eta bidali zure ordenagailura",

  // MEXEM
  "guide.mexem.title": "MEXEM (Flex Query XML)",
  "guide.mexem.step1": "Hasi saioa <strong>MEXEM Bezero Atarian</strong> (IBKR interfaze berdina)",
  "guide.mexem.step2": "Joan <strong>Errendimendua eta informeak</strong> → <strong>Flex kontsultak</strong> fitxara",
  "guide.mexem.step3":
    "Sortu <strong>Activity Flex Query</strong> bat Trades, Cash Transactions eta Open Positions barne",
  "guide.mexem.step4": "Irteera-formatua: <strong>XML</strong>",
  "guide.mexem.step5": "Exekutatu kontsulta eta deskargatu <code>.xml</code> fitxategia",

  // Swissquote
  "guide.swissquote.title": "Swissquote (CSV)",
  "guide.swissquote.step1": "Hasi saioa <strong>Swissquote eBanking</strong>-en",
  "guide.swissquote.step2": "Joan <strong>Trading → Transakzio-historiala</strong> atalera",
  "guide.swissquote.step3": "Hautatu ekitaldi fiskalaren data-tartea",
  "guide.swissquote.step4": "Egin klik <strong>Esportatu → CSV</strong> botoian",

  "m720.title": "720 Eredua — Atzerriko ondasunak",
  "m720.description": "Atzerrian dauden ondasun eta eskubideei buruzko aitorpen informatiboa.",
  "m720.threshold_exceeded": "Zure posizioen arabera ({{amount}} €), 720 Eredua aurkeztera behartuta zaude.",
  "m720.obliged_by_changes": "720 Eredua aurkeztu behar duzu azken aitorpenetik izandako aldaketengatik: goiko kategoria bakoitzak arrazoia adierazten du.",
  "m720.declared_account_missing": "Aitortu zenuen kontu batek ez du saldorik aurten ({{accounts}}): itxi baduzu, haren ezeztapena eskuz aitortu behar duzu (RGATaren 42 bis.5 art.).",
  "m720.threshold_not_exceeded":
    "Ez duzu 50.000 €-ko atalasea gainditzen (guztira: {{amount}} €). Ez zaude aurkeztera behartuta.",
  "m720.category_v": "Balore-paperak (akzioak, funtsak, bonuak)",
  "m720.category_c": "Kontuak (eskudiruzko saldoak)",
  "m720.category_exceeded": "50.000 € gainditzen du — aitorpena derrigorrezkoa",
  "m720.category_not_exceeded": "Atalasearen azpitik",
  "m720.category_undetermined": "Ezin da zehaztu: {{count}} posizio baloratu gabe",
  "m720.no_positions": "Igo posizio irekiak dituen txostena 100 Ereduan 720 Eredua aztertzeko.",
  "m720.brokers_without_holdings": "Igo dituzun {{brokers}}(r)en datuek ez dituzte abenduaren 31ko posizioak eta saldoak jasotzen, eta, beraz, ez dira hemen batzen. Egiaztatu {{brokers}}(r)en urte amaierako laburpenean atzerriko kontuen saldoak edo atzerriko akzio eta funtsen balioak 50.000 € gainditzen dituen.",
  "m720.positions_title": "Aitortu beharreko posizioak",
  "m720.positions_unvalued":
    "{{count}} posizio ezin izan dira eurotan baloratu (ez dago merkatu-preziorik edo kanbio-tasarik haien monetarako ekitaldi-amaieran) eta totaletik kanpo utzi dira. Kalkulatu haien euro-balioa eta sartu eskuz.",
  "m720.cash_title": "Eskudiruzko saldoak (Kontuak)",
  "m720.q4_average": "Q4 batez bestekoa",
  "m720.cash_missing_average":
    "Saldo batzuek ez dute 720 Ereduko kontuetarako beharrezkoa den laugarren hiruhilekoko batez bestekoa. Abenduaren 31ko saldoa 50.000 €-ko atalaserako kontatzen da, baina kontu horiek ez dira sortutako fitxategian sartzen: gehitu itzazu eskuz, laugarren hiruhilekoko batez besteko saldoarekin, aurkeztu aurretik.",
  "m720.omitted_title":
    "Ondasun hauek ez dira fitxategian sartzen, eta eskuz aitortu behar dituzu 720 Ereduaren inprimakian:",
  "m720.omitted_no_isin":
    "ez du ISINik; inprimakian «Z» eta jaulkitzailearen herrialde-kodea erabiliz identifikatzen da",
  "m720.omitted_no_country":
    "gordailuan edo kokatuta dagoen herrialdea falta da",
  "m720.omitted_no_account":
    "kontu-zenbakia falta da",
  "m720.omitted_invalid_code":
    "aurten saldua; aurreko 720 Ereduak fitxategiak onartzen ez duen gako edo herrialde batekin aitortu zuen",
  "m720.not_generated_left_out":
    "Ez da fitxategirik sortu: aitortu behar duzunetik ezer ezin da fitxategian idatzi. Aitortu eskuz 720 Ereduaren inprimakian, goiko oharrei jarraituz.",
  "m720.successive_years_note":
    "Aurreko urte batean 720 Eredua aurkeztu bazenuen, berriro aurkeztea derrigorrezkoa da soilik kategoria baten balio bateratua azken aitorpenarekiko 20.000 € baino gehiago igo denean, edo aitortu zenuen ondasun bat saldu edo ezeztatu duzunean (1065/2007 EDaren 42 bis.5 eta 42 ter.5 artikuluak). Bestela, aurkeztea aukerakoa da.",
  "m720.previous_title": "Zure azken 720 Eredua",
  "m720.previous_help": "720 Eredua lehendik aurkeztu baduzu, igo zure azken aitorpenaren .txt fitxategia. Lehendik aitortutakoak M jatorria izango du, saldutakoak C jatorria (baja), eta 20.000 €-ko araua aplikatuko da. Fitxategia zure nabigatzailean irakurtzen da eta ez da gordetzen.",
  "m720.previous_loaded": "Kargatuta: {{name}} ({{year}} ekitaldia): {{securities}} balore eta {{accounts}} kontu aitortuta.",
  "m720.previous_clear": "Kendu",
  "m720.previous_invalid": "Fitxategi hau ez da 720 Eredua: ez du xehetasun-erregistrorik.",
  "m720.previous_same_year": "Fitxategi hau {{fileYear}} ekitaldikoa da. Igo {{year}} baino lehenagoko ekitaldi baten 720 Eredua.",
  "m720.origin": "Jatorria",
  "m720.origin_a": "A (alta)",
  "m720.origin_m": "M (lehendik aitortua)",
  "m720.successive_last": "Azken aitorpena: {{previous}} €. Aldaketa: {{change}} €.",
  "m720.successive_increase": "20.000 € baino gehiago igo da: berriro aitortu behar da",
  "m720.successive_sold": "Aitortutako baloreak saldu dituzu: horien bajak aitortu behar dira",
  "m720.successive_optional": "Ez da 20.000 € baino gehiago igo: berriro aitortzea aukerakoa da",
  "m720.successive_not_required": "Zure azken 720 Ereduaren arabera, aurten ez zaude aurkeztera behartuta: kategoria bakar bat ere ez da 20.000 € baino gehiago igo eta ez duzu aitortutakorik saldu. Nahi baduzu, aurkez dezakezu.",
  "m720.sold_title": "Bajak: zure azken 720 Eredutik saldutako baloreak",
  "m720.sold_help": "Fitxategiak C jatorriarekin jasotzen ditu, azken salmentaren data eta zenbatekoarekin.",
  "m720.sold_no_date": "{{year}} ekitaldian ez dago aitortutako akzioen salmentarik: baja iraungitze-datarik gabe eta 0 balorazioarekin ateratzen da; osatu aurkeztu aurretik",
  "m720.sold_no_acquisition": "datuek ez dute erosketa jasotzen: baja eskuratze-datarik gabe ateratzen da; osatu aurkeztu aurretik",
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
  "d6.no_minimum":
    "ICT/1408/2021 Aginduaz geroztik, D-6 soilik nahitaezkoa da zure partaidetza atzerriko enpresa kotizatu baten kapitalaren edo boto-eskubideen <strong>%10 edo gehiago</strong> bada. Txikizkako inbertitzaile gehienak salbuetsita daude.",
  "d6.no_positions": "Igo posizio irekiak dituen txostena 100 Ereduan D-6 aztertzeko.",
  "d6.brokers_without_holdings": "Igo dituzun {{brokers}}(r)en datuek ez dituzte abenduaren 31ko baloreak jasotzen, eta, beraz, ez dira hemen agertzen. Kontsultatu {{brokers}}(r)en urte amaierako laburpenean.",
  "d6.positions_title": "Aitortu beharreko posizioak",
  "d6.positions_unvalued":
    "{{count}} posizio ezin izan dira eurotan baloratu (ez dago merkatu-preziorik edo kanbio-tasarik haien monetarako ekitaldi-amaieran) eta totaletik kanpo utzi dira. Kalkulatu haien euro-balioa eta sartu eskuz.",
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

  // 721 Eredua
  "m721.title": "721 Eredua — Atzerriko kriptomonedak",
  "m721.description": "Atzerrian dauden moneta birtualei buruzko aitorpen informatiboa.",
  "m721.threshold_exceeded": "Zure posizioen arabera ({{amount}} €), 721 Eredua aurkeztera behartuta zaude.",
  "m721.threshold_not_exceeded":
    "Ez duzu 50.000 €-ko atalasea gainditzen (guztira: {{amount}} €). Ez zaude aurkeztera behartuta.",
  "m721.threshold_undetermined":
    "Ezin da zehaztu 50.000 €-ko atalasea gainditzen duzun: guztirakoak ({{amount}} €) ez ditu barne hartzen baloratu gabeko {{count}} posizio. Baloratu itzazu aurkeztu behar ez duzula ondorioztatu aurretik.",
  "m721.no_positions": "Igo kriptomoneda posizioak dituen txostena 100 Ereduan 721 Eredua aztertzeko.",
  "m721.brokers_without_holdings": "Igo dituzun {{brokers}}(r)en datuek ez dituzte abenduaren 31ko kriptomonetak jasotzen, eta, beraz, ez dira hemen batzen. Egiaztatu {{brokers}}(r)en urte amaierako laburpenean atzerrian dituzun kriptomonetek 50.000 € gainditzen dituzten.",
  "m721.positions_title": "Aitortu beharreko posizioak",
  "m721.generate_btn": "721 Ereduaren fitxategia sortu",
  "m721.deadline": "Epea: urtarrilaren 1etik martxoaren 31ra hurrengo urtean",
  "m721.total_value": "Balio osoa: {{amount}} €",
  "m721.filing_title": "Nola aurkeztu?",
  "m721.rates_title": "Aplikatutako truke-tasak (BZE)",
  "m721.deadline_short": "Epea: urtarrilak 1 – martxoak 31",
  "m721.filing_step1": "Sartu AEATen Egoitza Elektronikoan",
  "m721.filing_step2": "Bilatu «Modelo 721»",
  "m721.filing_step3": "Bete aitorpena taulako datuekin (formatu ofiziala: XML, HFP/886/2023 Agindua)",
  "m721.filing_step4": "Berrikusi eta sinatu ziurtagiri digitalarekin edo Cl@ve-rekin",
  "m721.exchange": "Exchange",
  "m721.format_notice":
    "AEATen formatu ofiziala XML da (HFP/886/2023 Agindua). DeclaRentak berrikuspen orientagarria bakarrik erakusten du: sorrera ofiziala desgaituta dago balioztatutako XMLa inplementatu arte.",
  "m721.positions_unvalued":
    "{{count}} posizio ezin izan dira eurotan baloratu (ez dago merkatu-preziorik edo kanbio-tasarik haien monetarako ekitaldi-amaieran) eta totaletik kanpo utzi dira. Kalkulatu haien euro-balioa eta sartu eskuz.",
  "m721.empty_title": "Ez dago kriptomoneda posiziorik kargatuta",
  "m721.empty_description":
    "721 Eredua aitorpen informatibo nahitaezkoa da atzerriko exchange-etan 50.000 € baino gehiagoko kriptomonedak badituzu. Igo zure brokerraren txostena 100 Ereduaren atalean, DeclaRentak automatikoki kalkulatu dezan atalasea gainditzen duzun. Epea: urtarrilaren 1etik martxoaren 31ra.",
  "m721.empty_cta": "100 Eredura joan",
  "m721.profile_required": "Osatu zure profil fiskala 721 Ereduaren fitxategia sortu aurretik.",

  "section.year_label": "Ekitaldia",
  "section.profile_source": '<a href="#perfil">Profil fiskaleko</a> datuak',
  "section.positions_date_mismatch":
    "Zure fitxategiko posizioak {{date}} datakoak dira, ez 31/12/{{year}} datakoak. Eredu hauek abenduaren 31n zenuena aitortzen dute, beraz, ez da fitxategirik sortzen haiekin. Deskargatu 31/12/{{year}} egunean amaitzen den txosten bat (IBKRn, amaiera-data 31/12/{{year}} duen Flex Query bat) eta igo berriro.",
  "section.positions_date_unknown":
    "Zure brokerrak ez du adierazten posizioak zein datatakoak diren. Egiaztatu txostenak 31/12/{{year}} egunean zenuena islatzen duela: geroago deskargatu bazenuen, posizioak eta haien balioak ez dira bat etorriko agian.",
  "merge.holdings_other_date":
    "{{account}} kontuaren {{date}} datako posizioak eta saldoak 720, 721 eta D-6 ereduetatik kanpo geratu dira: ez dira 31/12/{{year}} egunekoak.",
  "merge.holdings_other_date.hint":
    "Fitxategi hori beste data batean amaitzen da. Haren eragiketak eta mugimenduak kontuan hartzen dira, baina eredu hauek abenduaren 31n zenuena aitortzen dute, beraz, haren posizioak eta saldoak ez dira batzen. 31/12/{{year}} eguneko kontu horren txostena falta bazaizu, igo hori ere.",

  "badge.complete": "Osatuta",
  "badge.pending": "Zain",
  "badge.not_applicable": "Ez da aplikagarri",
  "badge.generated": "Sortuta",

  // Empty states
  "m720.empty_title": "Ez dago posiziorik kargatuta",
  "m720.empty_description":
    "720 Eredua aitorpen informatibo nahitaezkoa da atzerrian 50.000 € baino gehiagoko ondasunak badituzu. Igo zure brokerraren txostena 100 Ereduaren atalean, DeclaRentak automatikoki kalkulatu dezan atalasea gainditzen duzun eta fitxategia sortzeko. Epea: urtarrilaren 1etik martxoaren 31ra.",
  "m720.empty_cta": "100 Eredura joan",
  "d6.empty_title": "Ez dago posiziorik kargatuta",
  "d6.empty_description":
    "D-6 Ereduak atzerriko baloreetan dituzun inbertsioak aitortzen ditu Ekonomia Ministerioan. 2021eko erreformatik (ICT/1408/2021 Agindua), soilik nahitaezkoa da zure partaidetza atzerriko enpresa kotizatu baten kapitalaren edo boto-eskubideen %10 edo gehiago bada. Igo zure brokerraren txostena 100 Ereduaren atalean eta DeclaRentak pausoz pausoko gida sortuko du. Epea: urtarrilaren 1etik 31ra.",
  "d6.empty_cta": "100 Eredura joan",

  // Profile required warnings
  "m720.profile_required": "Osatu zure profil fiskala 720 Ereduaren fitxategia sortu aurretik.",
  "d6.profile_required": "Osatu zure profil fiskala D-6 gida sortu aurretik.",

  // Trust signal
  "footer.open_source": "100% kode irekia",
  "footer.verify_source": "Iturburu-kodea egiaztatu",

  // Splash screen
  "splash.tagline": "Doako zerga-tresna nazioarteko broker-ekin inbertitzaileentzat",
  "splash.feature_free": "100% doakoa",
  "splash.feature_selfhosted": "Self-hosted",
  "splash.feature_privacy": "Pribatutasun osoa",
  "splash.feature_opensource": "Kode irekia",
  "splash.cta": "Hasi",

  // Validation
  "validation.future_date": "{{symbol}} eragiketak etorkizuneko data du ({{date}}). Egiaztatu datuak.",
  "validation.no_cash_transactions":
    "Ez da eskudiru-transakziorik aurkitu (dibidenduak/atxikipenak). IBKR erabiltzen baduzu, gaitu Cash Transactions atala zure Flex Query-n.",
  "validation.no_cash_degiro":
    "Ez da dibidendurik edo atxikipenik aurkitu. Degirok fitxategi bereizi batean sartzen ditu: deskargatu Kontuaren CSV-a (Account) ere Sarrera-ontzitik.",
  "validation.no_cash_generic":
    "Ez da eskudiru-transakziorik aurkitu (dibidenduak/atxikipenak). Zure brokerrak bereizita esportatzen baditu, igo fitxategi gehigarri gisa.",
  "validation.no_trades_in_year":
    "Ez dago eragiketarik {{year}} ekitaldian. Aurreko eragiketak FIFO kalkulurako erabiltzen dira.",
  "validation.very_old_data":
    "Datuek {{year}}(e)tik aurrerako eragiketak dituzte (10 urte baino gehiago). Egiaztatu fitxategia zuzena dela.",
  "validation.duplicate_trades":
    "{{count}} eragiketa bikoiztu detektatu d(ir)a. Egiaztatu fitxategi bera bi aldiz igo duzun.",

  // Operations annex
  "annex.title": "Eragiketen eranskina (Anexo C1)",
  "annex.subtitle": "Eragiketen banakako xehetasuna aktibo motaren arabera taldekatuta.",
  "annex.operations": "eragiketa",
  "annex.wash_blocked": "Berrerosketagatik blokeatutako galera: {{amount}} EUR (LIRPF 33.5 art.)",
  "annex.wash_dates": "Galera blokeatzen duten balio bereko erosketak: {{dates}}",
  "annex.wash_hint":
    "Renta Web-en, markatu salmenta hau «Egotzi ezin diren ondare-galerak» gisa. Galera zain geratzen da, eta integratu egiten da, galera zaharrenak lehenik, aurreko edo ondorengo 2 hilabeteetan (urtebete, balioa Europako Esparru Ekonomikoko merkatu arautu batean edo baliokide batean, hala nola NYSE edo Nasdaq, kotizatzen ez bada; kriptomonetetan, salmentaren ondorengo urtea bakarrik, 33.5.e art.) inolako berrerosketak estaltzen ez dituen balio honen akzioak saltzen dituzun heinean; zati bat berrerosten baduzu, berrerosi gabeko akzioek bakarrik balio dute. Kriptomonetetan, berrerositako unitateak saltzen dituzunean integratzen da, kriptomoneta bera berriro erosten baduzu ere (33.5.e art.); beste unitate batzuk saltzeak ez du integratzen.",
  "annex.wash_released": "Balio honen {{amount}} EUR galera atzeratu askatzen ditu (behin betiko eskualdaketa, LIRPF 33.5 art.)",
  "annex.wash_released_dates": "Data hauetako salmenten galerak: {{dates}}",
  "annex.wash_released_hint": "Salmenta honetako akzioetatik, epean inolako berrerosketak estaltzen ez dituenak behin betiko eskualdaketa dira: balio horren zain dauden galerak integratzen dituzte orain, akzio bakoitzeko akzio baten galera, zaharrenak lehenik (salmentak posizioa ixten badu eta epean inolako berrerosketak estaltzen ez badu, geratzen diren guztiak). Renta Web-en, egotzi ekitaldi honetan.",
  "annex.wash_released_crypto": "Kriptomoneta honen {{amount}} EUR galera atzeratu askatzen ditu (berrerositako unitateen salmenta, LIRPF 33.5.e art.)",
  "annex.wash_released_hint_crypto":
    "Salmenta honek galera bat blokeatu zuen berrerosketaren unitateak eskualdatzen ditu: saldutako unitateei dagokien galera zatia integratzen du orain, kriptomoneta hau berriro erosten baduzu ere (33.5.e art.). Beste unitate batzuk saltzeak ez du integratzen. Renta Web-en, egotzi ekitaldi honetan.",

  // Tax bracket estimation
  "chart.tax_estimate": "Zerga-estimazioa (aurrezki-oinarria)",
  "tax.bracket_range": "Tartea",
  "tax.bracket_base": "Oinarria",
  "tax.bracket_rate": "Tasa",
  "tax.bracket_tax": "Kuota",
  "tax.total_estimated": "Guztira estimatua",
  "tax.effective_rate": "Tasa efektiboa",
  "tax.double_tax_deduction": "Zergapetze bikoitzaren kenkaria",
  "tax.disclaimer":
    "Orientazio-estimazioa. Tarteak indarrean dagoen PFEZaren aurrezki-oinarriari dagozkio. Kontsultatu zerga-aholkulari batekin.",
  "tax.breakdown_capital_gains": "Ondare-irabaziak",
  "tax.breakdown_fx_gains": "FX irabaziak (kanbio-mota)",
  "tax.breakdown_dividends": "Dibidenduak",
  "tax.breakdown_interest": "Interesak",
  "tax.breakdown_blocked_losses": "Blokeatutako galerak (atzeratuak)",
  "tax.breakdown_reintegrated_losses": "Orain integratzen diren galera atzeratuak",

  // Sidebar - guide
  "sidebar.guia": "Renta Web Gida",

  // Guía de cumplimentación (Renta Web)
  "guide_rw.title": "Betetzeko gida — Renta Web",
  "guide_rw.description": "Nola bete Renta Web-eko gelaxka bakoitza DeclaRenta-ren datuekin.",
  "guide_rw.intro":
    "Gida honek azaltzen du nola transferitu DeclaRenta-ren emaitzak Renta Web-era (AEAT). Atal bakoitzeko, helmugako gelaxka, zer balio sartu eta zer aukera hautatu adierazten da.",
  "guide_rw.capital_gains_title": "Ondare irabaziak eta galerak (eskualdaketak)",
  "guide_rw.fx_title": "Kanbio-tasagatiko irabaziak (atzerriko moneta)",
  "guide_rw.dividends_title": "Kapital higigarriaren errendimenduak — Dibidenduak",
  "guide_rw.interest_title": "Kapital higigarriaren errendimenduak — Interesak",
  "guide_rw.double_taxation_title": "Nazioarteko zergapetze bikoitzagatiko kenkaria",
  "guide_rw.entidad_emisora_label": "Entitate jaulkitzailea",
  "guide_rw.entidad_emisora_value":
    "Saltzen duzun enpresaren edo baloreren izena (adib. Apple Inc.), ez broker-arena. Dibisetan, moneta (adib. USD). Eragiketa bat baino gehiago lerro batean konsolidatzen badituzu, adierazi balore nagusia.",
  "guide_rw.tipo_elemento_label": "Ondare elementu mota",
  "guide_rw.tipo_elemento_value_capital":
    "Hautatu <strong>«Negoziaziora onartutako akzioak»</strong> kotizatutako akzioetarako. Funts-etarako: «IIC-eko partaidetzak». Deribatu/opsioetarako: «Beste ondare elementu batzuk».",
  "guide_rw.tipo_elemento_value_fx": "Hautatu <strong>«Beste ondare elementu batzuk — Dibisak»</strong>.",
  "guide_rw.clave_prereq_title": "Transmisio-balioaren laukia blokeatuta dago?",
  "guide_rw.clave_prereq_hint":
    "Renta Web-en, <strong>1633</strong> (transmisio-balioa) eta <strong>1637</strong> (eskuratze-balioa) laukiak <strong>desgaituta agertzen dira aurretik eremu hauek ordena honetan bete arte</strong>:<br>1) <strong>1626 «Ondare elementu mota. Gakoa»</strong> laukia → dibisak eta aukerak izanez gero, normalean <strong>4</strong> gakoa da («Jarduera ekonomikoei lotu gabeko beste ondare elementu batzuk»); kriptoetarako, begiratu ekitaldiak moneta birtualei esleitzen dien gakoa. Inbertsio-funtsek (IIC) <strong>ez</strong> dute 4 gakoa erabiltzen: «Participaciones en IIC» gisa aitortzen dira.<br>2) <strong>«Transmisio mota»</strong> → <strong>«Transmisión intervivos onerosa (salmenta, trukea, etab.)»</strong> — <strong>onerosa</strong> da, ez doakoa/lukratiboa.<br>3) <strong>Transmisio data</strong> (<strong>1631/1632</strong> laukiak) → salmentaren eguna/hilabetea/urtea.<br>4) <strong>Eskuratze data</strong> (<strong>1932</strong> laukia) → erosketaren eguna/hilabetea/urtea.<br>Bete ondoren, 1633 eta 1637 laukiak aktibatu eta zenbatekoak idatzi ahal izango dituzu. <em>Lauki-zenbaki zehatza ekitaldiaren arabera alda daiteke.</em>",
  "guide_rw.gastos_transmision_label": "Eskualdaketaren gastuak",
  "guide_rw.gastos_adquisicion_label": "Eskuraketaren gastuak",
  "guide_rw.gastos_zero":
    "<strong>0</strong> — DeclaRenta-k dagoeneko komisioak eskualdaketa/eskuraketa balioetan sartzen ditu. Ez gehitu gastuak bereizita.",
  "guide_rw.gastos_label": "Administrazio eta gordailu gastuak",
  "guide_rw.valor_transmision_label": "Eskualdaketa balioa",
  "guide_rw.valor_adquisicion_label": "Eskuraketa balioa",
  "guide_rw.valor_transmision_hint":
    "DeclaRenta-ren <strong>0328</strong> gelaxkako zenbatekoa (EUR, komisioak sartuta).",
  "guide_rw.valor_adquisicion_hint":
    "DeclaRenta-ren <strong>0331</strong> gelaxkako zenbatekoa (EUR, komisioak sartuta).",
  "guide_rw.fx_valor_transmision_hint": "DeclaRenta-ren <strong>1633</strong> gelaxkako zenbatekoa.",
  "guide_rw.fx_valor_adquisicion_hint": "DeclaRenta-ren <strong>1637</strong> gelaxkako zenbatekoa.",
  "guide_rw.fecha_transmision_label": "Eskualdaketa data",
  "guide_rw.fecha_adquisicion_label": "Eskuraketa data",
  "guide_rw.fecha_hint_individual":
    "Eragiketa banaka sartzen baduzu, erabili txosteneko data zehatza. Guztiak lerro batean konsolidatzen badituzu, erabili <strong>31/12/UUUU</strong> (eskualdaketa) eta <strong>01/01/UUUU</strong> (eskuraketa).",
  "guide_rw.fx_fecha_hint":
    "FX konsolidaziorako: <strong>01/01/UUUU</strong> (eskuraketa) eta <strong>31/12/UUUU</strong> (eskualdaketa). Banaka sartzen baduzu, erabili txosteneko benetako datak.",
  "guide_rw.retenciones_label": "Atxikipenak",
  "guide_rw.retenciones_zero": "Normalean <strong>0</strong> atzerriko jaulkitzaileentzat (haien atzerriko atxikipena 0588 gelaxkara doa). BAINA atzerriko artekari batean akzio <strong>espainiarrak</strong> (ISIN ES…) badituzu, haien %19ko atxikipena konturako ordainketa espainiarra DA eta <strong>0597 laukira</strong> doa.",
  "guide_rw.importe_label": "Diru-sarrera osoak",
  "guide_rw.dividends_importe_hint": "DeclaRenta-ren <strong>0029</strong> gelaxkako zenbateko gordina (EUR).",
  "guide_rw.interest_importe_hint": "DeclaRenta-ren <strong>0027</strong> gelaxkako zenbatekoa (EUR).",
  "guide_rw.dt_pais_label": "Jatorrizko herrialdea",
  "guide_rw.dt_pais_hint":
    "Hautatu atxikipena egin zen herrialdea (adib. Ameriketako Estatu Batuak, Irlanda, Alemania…). Hainbat herrialdeetako atxikipenak badituzu, gehitu lerro bat bakoitzeko.",
  "guide_rw.dt_importe_label": "Kenkariaren zenbatekoa",
  "guide_rw.dt_importe_hint":
    "DeclaRenta-ren <strong>0588</strong> gelaxkako zenbatekoa. Atzerrian ordaindutako zergaren eta Espainiako kuota dagokionaren arteko txikiena da (80. art. LIRPF).",
  "guide_rw.dt_campo_label": "Zein eremutan koadroan?",
  "guide_rw.dt_campo_hint":
    "Zergapetze bikoitzaren koadroan, bete BI lerro herrialde bakoitzeko:<br>• <strong>«Atzerrian lortutako beste errendimendu garbi murriztuak»</strong> (2. lerroa) → herrialde horren «Gordina EUR» zutabea, DeclaRenta-ren 0588 gelaxkaren xehetasunean. Herrialde bakarra baduzu, xehetasun horretako «Atzerriko errendimenduak guztira» lerroa da. Ez ditu barne hartzen Espainiako dibidenduak, ezta atxikipenik gabeko herrialdeetakoak ere.<br>• <strong>«Atzerrian ordaindutako zerga»</strong> (azken lerroa) → herrialde horren kenkaria, xehetasun berean (herrialde bakarrarekin, 0588 gelaxkako zenbatekoa).<br>2. lerroa hutsik uzten baduzu, Renta Web-ek abisu bat erakusten du errentak falta direlako. 1. eta 3. lerroak 0-n geratzen dira.",
  "guide_rw.capital_gains_note":
    "Eragiketa asko badituzu, lerro bakarrean konsolidatu ditzakezu aktibo mota bakoitzeko 01/01 eta 31/12 data generikoak erabiliz. Renta Web-ek zenbateko agregatuak onartzen ditu.",
  "guide_rw.fx_note":
    "Kanbio-tasagatiko irabaziak balore irabazietatik bereizita aitortzen dira. Dibisa euro edo beste dibisa batera bihurtzen duzunean agertzen dira (adib. USD→GBP) —zure brokerraren bihurketa automatikoak barne (adib. AFx/FXCONV IBKR-n)—, eta ez eskuzko bihurketetan soilik. «DGTren irizpidea (multidibisa)» metodoarekin, dibisa daukazun bitartean (adib. USD akzioak erosi eta saldu euro bihurtu gabe), kanbio-diferentzia atzeratuta geratzen da benetan bihurtu arte, euro edo beste dibisa batera (Art. 14.2.e LIRPF). «Tradizionala dibisarik gabe (monodibisa)» metodoarekin atal hau ez da aplikagarria. «Tradizionala dibisarekin» metodoarekin, akzioak dauzkazun bitarteko kanbio-tasaren aldaketa haien irabazi edo galeraren barruan doa jada (0328/0331 laukiak). Dibisa eskudirutan daukazun bitarteko aldaketa bakarrik geratzen da atzeratuta. Dibisa komisioak ordaintzen dituzunean edo galerak dituen salmenta batean galtzen duzunean ere ateratzen da.",
  "guide_rw.dividends_note":
    "Atzerriko broker-en dibidenduek ez dute Espainiako atxikipenik. Atzerriko atxikipena (withholding tax) EZ da hemen jartzen: 0588 gelaxkan kentzen da bereizita (zergapetze bikoitza).",
  "guide_rw.interest_note":
    "Broker-aren interesak (saldoaren ordainketa) kapital higigarriaren errendimendu gisa aitortzen dira. Ordaindutako marjina interesak EZ dira kengarriak (26.1.a art. LIRPF).",
  "guide_rw.double_taxation_note":
    "Zergapetze bikoitzagatiko kenkariak dibidendo berberengatik bi aldiz zerga ordaintzea ekiditen du. Atzerrian ordaindutakoaren eta Espainiako kuotaren arteko txikienera mugatzen da. Zergapetze bikoitza saihesteko hitzarmenak tasa maximo txikiagoa baimentzen badu (adib. %15 AEB), kopuru horretaraino bakarrik da kengarria.",
  "guide_rw.blocked_losses_title": "Blokeatutako galerak (anti-churning)",
  "guide_rw.blocked_losses_hint":
    "DeclaRenta-k blokeatutako galerak erakusten baditu, markatu <strong>«Egotzi ezin diren ondare-galerak»</strong> gelaxka Renta Web-en. Blokeatu egiten dira balio bera salmentaren aurreko edo ondorengo 2 hilabeteetan berrerosi zenuelako (urtebete, balioa Europako Esparru Ekonomikoko merkatu arautu batean edo baliokide batean, hala nola NYSE edo Nasdaq, kotizatzen ez bada). Kriptomonetetan, kriptomoneta bera salmentaren ondorengo urtean berrerosten baduzu bakarrik blokeatzen dira (33.5.e art.); salmentaren aurreko erosketek ez dute balio. DeclaRenta-k 2 hilabete aplikatzen dizkio ISIN duen balio orori, salbu eta IBKR-k baliokidetasunik gabeko merkatu batean bakarrik erakusten badu (Londres 2021etik aurrera, SIX 2019ko uztailetik aurrera, OTC Markets…) edo zuk urtebetearekin markatzen baduzu emaitzetako «Anti-churning epea balio bakoitzeko» panelean (komando-lerroan, --antichurning-1y). Torontok, Tokiok eta Singapurrek baliokidetasun-erabaki bat dute, eta DeclaRenta-k 2 hilabete aplikatzen dizkie, nahiz eta DGTren kontsultarik ez den hori akzioetarako berresten. Zure balioa baliokidetasunik gabeko merkatu batean bakarrik kotizatzen bada eta DeclaRenta-k ez badaki, markatu urtebetearekin; Europako Esparru Ekonomikoko merkatu arautu batean edo baliokide batean ere kotizatzen bada, markatu 2 hilabeterekin. Aurreko 2 hilabeteetako erosketa batek ez du blokeatzen, epe horretan balio horren erosketa bakarra izan bazen eta epea hastean balio horren akziorik ez bazenuen (erosketa bakarraren salbuespena, DGT V3282-18); ondorengo 2 hilabeteetako erosketek blokeatzen jarraitzen dute, posizio motz bat soilik ixten duena izan ezik, ez baita berrerosketa. 0.66.13 bertsiora arte, DeclaRenta-k ez zuen salbuespen hori aplikatzen: galera hori blokeatuta zuela urte bat aurkeztu bazenuen, urte hori zuzen dezakezu galera kentzeko (2024 eta ondorengoak: autolikidazio zuzentzailea, «autoliquidación rectificativa»; 2023 eta aurrekoak: autolikidazioaren zuzenketa-eskaera). Ez zaizkio posizio berriaren kostuari gehitzen: zain geratzen dira, eta integratu egiten dira, zaharrenak lehenik, epe horretan inolako berrerosketak estaltzen ez dituen balio horren akzioak saltzen dituzun heinean (behin betiko eskualdaketa); zati bat berrerosten baduzu, berrerosi gabeko akzioek bakarrik balio dute. Kriptomonetetan, berrerositako unitateak saltzen dituzunean integratzen da, kriptomoneta bera berriro erosten baduzu ere (33.5.e art.); beste unitate batzuk saltzeak ez du integratzen. Urte bat DeclaRenta 0.66.5 edo aurreko bertsio batekin aitortu bazenuen, bertsio horiek galera askatzen zuten berrerositako akzioak saltzean, berriro berrerosi arren: galera hori dagoeneko kendu bazenuen, ez kendu berriro DeclaRenta-k orain askatzen duenean, edo zuzendu urte hori (2024 eta ondorengoak: autolikidazio zuzentzailea, «autoliquidación rectificativa»; 2023 eta aurrekoak: autolikidazio osagarria). Eta alderantziz: DeclaRenta-k orain galera bat askatzen badu 0.66.5 edo aurreko bertsio batekin dagoeneko aurkeztu zenuen urte batean, urte hori zuzen dezakezu galera hori kentzeko (2024 eta ondorengoak: autolikidazio zuzentzailea, «autoliquidación rectificativa»; 2023 eta aurrekoak: autolikidazioaren zuzenketa-eskaera). Kriptomonetetan, urte bat DeclaRenta 0.66.13 edo aurreko bertsio batekin aitortu bazenuen, salmentaren aurreko erosketa batek galera blokeatu zezakeen: DeclaRenta-k orain kriptomoneten galera bat kentzen edo askatzen badu dagoeneko aurkeztu zenuen urte batean, zuzendu urte hori galera hori kentzeko (2024 eta ondorengoak: autolikidazio zuzentzailea, «autoliquidación rectificativa»; 2023 eta aurrekoak: autolikidazioaren zuzenketa-eskaera); bestela, ez da inoiz kentzen. Urte bat galera bat kentzeko zuzentzen duzun bakoitzean, berrikusi dagoeneko aurkeztu dituzun ondorengo urteak ere: horietako batean galera bera kendu bazenuen bertsio zaharrak urte hartan askatu zuelako, zuzendu urte hori ere eta atera bertatik galera hori (2024 eta ondorengoak: autolikidazio zuzentzailea, «autoliquidación rectificativa»; 2023 eta aurrekoak: autolikidazio osagarria), bi aldiz ez kentzeko: galera bat behin bakarrik kentzen da.",
  "guide_rw.closing_tip": "Datu guztiak sartu ondoren, erabili Renta Web-eko «Aitorpena egiaztatu» botoia akatsak egiaztatzeko. Beste tresna batek ondare irabazietan zenbateko desberdina erakusten badu, baliteke dibisako akzioetarako beste metodo bat erabiltzea. 100 Ereduko emaitzetan, ireki «Beste metodoekin alderatu» hiru metodoen zifrak ikusteko. Metodoa aldatzeko, itzuli «Berrikusi eta metodoa aukeratu» urratsera. Erabili metodo bera urte guztietan.",

  // PDF report
  "pdf.subtitle": "Zerga txostena — Ekitaldia",
  "pdf.generated": "Sortua",
  "pdf.informative": "Informatibo",
  "pdf.blocked_losses": "Anti-churning blokeatutako galerak",
  "pdf.interest_margin": "Marjina interesak (ez kengarria)",
  "pdf.section_casillas": "1. Laukien Laburpena — 100 Eredua",
  "pdf.section_operations": "2. Eragiketen Xehetasuna",
  "pdf.section_dividends": "3. Dibidenduak",
  "pdf.section_dt": "4. Nazioarteko Zerga Bikoitzaren Kenkaria",
  "pdf.section_warnings": "Abisuak",
  "pdf.reintegrated_losses": "Berreskuratutako galerak (anti-churning)",
  "pdf.dt_paid": "Ordaindutako zerga",
  "pdf.dt_allowed": "Baimendutako kenkaria",
  "pdf.ecb_note":
    "ECB tasa: Europako Banku Zentralaren truke-tasa ofiziala (EUR 1 atzerriko moneta-unitate bakoitzeko) eragiketa-datan. Iturria: ECB SDMX API.",
  "pdf.footer":
    "DeclaRenta — https://declarenta.com — Txosten hau informatiboa da eta ez du zerga-aholkularitza profesionala ordezten.",

  // Manual crypto valuation
  "crypto_rates.title": "Kriptomoneten eskuzko balioespena",
  "crypto_rates.description":
    "Kriptomoneten arteko trukaketa batzuk ezin izan dira automatikoki baloratu, bi monetatako batek ere ez baitu BZEren truke-tasa ofizialik. Sartu eragiketaren dataren araberako balioa euroetan unitateko, haiek sartzeko.",
  "crypto_rates.help":
    "Inoiz ez ditugu kriptomoneten prezioak interneten kontsultatzen: zure zorroa pribatu mantentzen da. Bilatu zuk zeuk euroetako balioa (adib. zure exchange-aren historian edo prezio-webgune batean) eta sartu hemen.",
  "crypto_rates.col_asset": "Aktiboa",
  "crypto_rates.col_date": "Data",
  "crypto_rates.col_quantity": "Kantitatea",
  "crypto_rates.col_currency": "Moneta",
  "crypto_rates.col_eur_per_unit": "EUR unitateko",
  "crypto_rates.placeholder": "adib. 142,50",
  "crypto_rates.save_btn": "Gorde eta birkalkulatu",
  "crypto_rates.saved": "Gordeta",
  "crypto_rates.recalculate_hint": "Balioak zure nabigatzailean gordetzen dira eta txostena birkalkulatzen da.",
  "crypto_rates.stored_title": "Gordetako eskuzko prezioak",
  "crypto_rates.stored_description":
    "Euro prezio hauek zure nabigatzailean gordeta daude eta fitxategi bat prozesatzen duzun bakoitzean aplikatzen dira. Zuzendu balio bat eta gorde, edo ezabatu guztiak bat okerra bada.",
  "crypto_rates.clear_btn": "Ezabatu gordetako prezioak",

  // Manual opening lots for transferred positions
  "opening_lots.title": "Eskuzko loteak transferitutako posizioentzat",
  "opening_lots.description":
    "Salmenta bat beste broker batetik transferitutako akzioei badagokie, hemen sar ditzakezu jatorrizko erosketa-loteak FIFO-k kostu-oinarria ondo kalkula dezan.",
  "opening_lots.help":
    "Gehitu behar adina lote. Lerro bakoitzak aurreko erosketa desberdin bat adierazten du, bere data, kantitatea eta akzio bakoitzeko prezioarekin. Datuak zure nabigatzailean bakarrik gordetzen dira.",
  "opening_lots.effect_hint":
    "Emaitza lote hauek sartu ondoren jaisten bada, normala da: lehen salmenta hori kostu-oinarria = 0-rekin kalkulatzen ari zen.",
  "opening_lots.group_intro":
    "{{date}} egunean egindako salmentarako {{quantity}} titulu falta dira. Sartu transferitutako posizio hori estaltzen duten aurreko loteak.",
  "opening_lots.group_intro_saved":
    "Eskuzko lote hauek zure nabigatzailean gordeta daude eta ezabatu arte aplikatzen jarraituko dute.",
  "opening_lots.col_acquire_date": "Erosketa-data",
  "opening_lots.col_quantity": "Kantitatea",
  "opening_lots.col_price": "Akzio bakoitzeko prezioa",
  "opening_lots.col_actions": "Ekintzak",
  "opening_lots.placeholder_quantity": "adib. 14",
  "opening_lots.placeholder_price": "adib. 100,00",
  "opening_lots.add_row": "Gehitu lotea",
  "opening_lots.remove_row": "Kendu",
  "opening_lots.save_btn": "Gorde loteak eta birkalkulatu",
  "opening_lots.clear_btn": "Ezabatu gordetako loteak",
  "opening_lots.saved": "Gordeta",
  "opening_lots.row_invalid":
    "Berrikusi markatutako errenkadak: adierazi erosketa-data eta zero baino handiagoak diren kantitatea eta prezioa (adib. 1.234,56). Ez da ezer gorde.",
  "opening_lots.recalculate_hint": "Eskuzko loteak zure nabigatzailean gordetzen dira eta txostena birkalkulatzen da.",

  // Motorraren eta analizatzaileen mezuak (TaxMessage id → testu lokalizatua)
  "fx.missing_prior_lots":
    "⚠ {{currency}} dibisaren {{count}} xedapen aurreko lote nahikorik gabe (guztira: {{totalQuantity}} {{currency}}). Litekeena da deklaratutako epea baino lehenagoko eskuratzea — kanbio-irabazia 0 dela suposatzen da.",
  "fx.missing_prior_lots.hint":
    "Dibisa hau Flex Query-aren epea baino lehen eskuratu zen. Kanbio-irabazia = 0 dela suposatzen da (tratamendu kontserbadorea).",
  "fx.conservation_mismatch":
    "⚠ Barneko desoreka dibisa-motorrarentzat {{currency}}: {{mismatch}} unitate koadratu gabe. 1633/1637 laukiek baliteke ez bateratzea.",
  "fx.conservation_mismatch.hint":
    "Hau barneko egiaztapen bat da (ez litzateke gertatu behar). Ikusten baduzu, jakinarazi GitHub-en txostena erantsita; dibisa-zenbatekoek eskuzko berrikuspena behar izan dezakete.",
  "fifo.unknown_category":
    '⚠ Aktibo-kategoria ezezaguna: "{{assetCategory}}" {{symbol}} baliorako. FIFO generikoarekin prozesatuko da.',
  "fifo.unknown_category.hint":
    "Berdin prozesatzen da FIFO generikoarekin. IBKR-ren aktibo berri bat bada, baliteke etorkizuneko bertsioetan gehitzea.",
  "fifo.scrip_dividend": "📈 Scrip dividend: {{symbol}} +{{quantity}} akzio {{date}} egunean",
  "fifo.scrip_dividend.hint": "Scrip dividend-a lote gisa gehitu da, dibidenduaren balioaren berdina den kostuarekin.",
  "fifo.roll_operation": "⚠ C;O eragiketa (roll): {{symbol}} {{date}} egunean. Itxiera + irekiera gisa prozesatzen da.",
  "fifo.roll_operation.hint":
    "Roll eragiketa zuzen prozesatu da, aurreko posizioaren itxiera eta berriaren irekiera gisa.",
  "fifo.unknown_direction": '⚠ Norabide ezezaguneko eragiketa ("{{buySell}}"): {{symbol}} {{date}} egunean. Ez da prozesatu.',
  "fifo.unknown_direction.hint": "Erosketak (BUY) eta salmentak (SELL) bakarrik prozesatzen dira. Berrikusi errenkada hau brokerraren fitxategian eta, benetako eragiketa bada, zuzendu haren norabidea.",
  "fifo.split_applied": "⚡ Split {{isin}} {{ratio}} ({{direction}}) aplikatua ({{date}})",
  "fifo.split_applied.hint":
    "Split-a lote guztiei aplikatu zaie. Kostu osoa mantentzen da — akzio kopurua bakarrik aldatzen da.",
  "fifo.split_unresolved": "⚠ {{symbol}}-ren split-a ({{date}}) ez da aplikatu: ez dago aurreko akziorik proportzioa kalkulatzeko.",
  "fifo.split_unresolved.hint":
    "Igo aurreko urteetako laburpenak ere, kontua ireki zenetik. Bestela, akzio kopurua eta balio honen ondorengo salmenten kostua ez dira zuzenak izango.",
  "fifo.merger_applied":
    "🔄 Bat-egitea: {{oldIsin}} → {{newIsin}} (ratioa {{ratio}}, {{lotsTransferred}} lote transferituak, {{date}})",
  "fifo.merger_applied.hint":
    "Zerga-neutroa den bat-egitea: loteak ISIN berrira transferitzen dira jatorrizko kostu-oinarria mantenduz.",
  "fifo.cash_merger_disposal":
    "💶 Eskudiruzko erosketa: {{symbol}} ({{isin}}) × {{quantity}} {{date}} egunean. Salmenta gisa aitortzen da.",
  "fifo.cash_merger_disposal.hint":
    "Eskudirutan ordaindutako bat-egitea edo erosketa eskualdaketa bat da: irabazia edo galera salmenta batean bezala kalkulatzen da, jasotako eskudirua eskualdaketa-balio gisa hartuta.",
  "fifo.spinoff_applied":
    "🔀 Spin-off: {{parentIsin}} → {{newIsin}} (ratioa {{ratio}}, kostuaren {{costPercent}}% spin-off-era, {{date}})",
  "fifo.spinoff_applied.hint": "Kostua proportzionalki banatzen da matrizearen eta enpresa eskindituaren artean.",
  "fifo.corporate_action_unhandled":
    "ℹ {{symbol}} ({{isin}}) balioaren {{type}} ekintza korporatiboa ({{date}}): ez da FIFO kalkuluan aplikatzen.",
  "fifo.corporate_action_unhandled.hint":
    "Posizioaren akzio kopurua edo ISINa aldatu bazen, berrikusi balio honen ondorengo salmenten kostua.",
  "fifo.sell_without_lots":
    "⚠ Saltzea loterik gabe: {{symbol}}{{isinSuffix}} × {{quantity}} {{date}} egunean. Kostu-oinarria = 0 (litekeena da posizio laburra edo aurreko datu osatugabeak).",
  "fifo.sell_without_lots.hint":
    "Zure esportazioak aurreko urteak barne hartzen ditu? Deskargatu zure brokerretik balio honen lehen erosketatik hasten den epe bat.",
  "fifo.cover_without_lots":
    "⚠ Posizio laburraren itxiera loterik gabe: {{symbol}} ({{isin}}) × {{quantity}} {{date}} egunean. Irabazia ez da kalkulatu (posizio laburra epetik kanpo irekia edo aurreko datu osatugabeak).",
  "fifo.cover_without_lots.hint":
    "Aurreko urteak sartu dituzu zure Flex Query-an? Hautatu posizio labur hau ireki zuen salmentatik estaltzen duen epe bat.",
  "fifo.insufficient_lots":
    "⚠ Lote nahikorik ez: {{symbol}}{{isinSuffix}} × {{quantity}} {{date}} egunean. Kostu-oinarria = 0.",
  "fifo.insufficient_lots.hint":
    "Fitxategiak ez ditu balio honen aurreko erosketa guztiak estaltzen. Esportatu epe luzeago bat zure brokerretik.",
  "fifo.option_invalid_date": "⚠ OptionEAE gertaera data baliodunik gabe {{symbol}} baliorako. Baztertua.",
  "fifo.option_invalid_date.hint":
    "Aukera-gertaera baztertua data baliogabeagatik. Egiaztatu Flex Query-ak 'Option Exercises, Assignments & Expirations' atala duela.",
  "fifo.option_zero_quantity": "⚠ OptionEAE gertaera 0 kopuruarekin {{symbol}} baliorako {{date}} egunean. Baztertua.",
  "fifo.option_zero_quantity.hint": "Aukera-gertaera 0 kopuruarekin — ziurrenik IBKR-ren erregistro bikoiztua.",
  "fifo.option_invalid_strike":
    '⚠ Strike baliogabea "{{strike}}" {{symbol}} baliorako {{date}} egunean. Egikaritzea baztertzen.',
  "fifo.option_invalid_strike.hint":
    "Ezin izan da aukera honen egikaritzea kalkulatu. Azpiko balioaren kostuak ez du prima barne hartuko.",
  "fifo.option_expiry_no_lots": "⚠ Aukeraren iraungitzea loterik gabe: {{symbol}} × {{quantity}} {{date}} egunean.",
  "fifo.option_expiry_no_lots.hint":
    "Aukera iraungi zen baina ez da erosketa-loterik aurkitu. Erosketa-urtea sartu zenuen Flex Query-an?",
  "fifo.option_exercise_no_lots":
    "⚠ Egikaritzea/esleipena aukera-loterik gabe: {{symbol}} × {{quantity}} {{date}} egunean. Primaren kostua = 0.",
  "fifo.option_exercise_no_lots.hint":
    "Egikaritzea prima = 0-rekin erregistratua aukeraren erosketa aurkitu ez delako. Zabaldu Flex Query-aren epea.",
  "fifo.exercise_no_underlying_lots":
    "⚠ Aukeraren egikaritzea azpiko balioaren loterik gabe: {{symbol}} × {{quantity}} {{date}} egunean. Kostu-oinarria = 0.",
  "fifo.exercise_no_underlying_lots.hint":
    "PUT esleipena azpiko balioaren kostu-oinarria = 0-rekin erregistratua. Flex Query-ak baliteke jatorrizko eskuratzea ez estaltzea.",
  "fifo.insufficient_underlying_lots":
    "⚠ Azpiko balioaren lote nahikorik ez: {{symbol}} × {{quantity}} {{date}} egunean. Kostu-oinarria = 0.",
  "fifo.insufficient_underlying_lots.hint": "Ez dago azpiko balioaren lote nahikorik esleipen osoa estaltzeko.",
  "report.crypto_valuation_unresolved":
    "{{count}} kriptomonetako eragiketa daude eurotan duten balioa automatikoki zehaztu ezin izan dena eta kalkuluetatik kanpo utzi direnak.",
  "report.crypto_valuation_unresolved.hint":
    "Kripto-kripto permutetan gertatzen da (adib. Binance Convert) bi monetetako batek ere ez duenean BCEren kanbio-tasa ofizialik. Sartu eskuz moneta bakoitzaren unitateko balioa eurotan adierazitako datan eragiketa hauek sartzeko.",
  "report.crypto_commission_neutralized":
    "{{count}} eragiketaren komisioa ezikusi egin da kanbio-tasarik gabeko kriptomoneta batean adierazita dagoelako.",
  "report.crypto_commission_neutralized.hint":
    "Eragiketaren balio nagusia kalkulatu egin da; komisio txikia bakarrik baztertzen da, eta haren zerga-eragina minimoa da.",
  "report.crypto_income_unvalued":
    "{{count}} kriptomonetako diru-sarrera daude (adib. staking sariak) automatikoki baloratu ezin izan direnak eta kalkulatutako zenbatekoetan sartzen ez direnak.",
  "report.crypto_income_unvalued.hint":
    "Diru-sarrera hauek kripto berean ordaintzen dira eta ez dute BCEren kanbio-tasa ofizialik. Kalkulatu eurotako balioa kobratze-datan eta deklaratu eskuz kapital higigarriaren etekin gisa (0027 kasila).",
  "report.dividend_unvalued":
    "{{currencies}} dibisako {{count}} dibidendu daude automatikoki baloratu ezin izan direnak eta kalkulatutako zenbatekoetan sartzen ez direnak.",
  "report.dividend_unvalued.hint":
    "BCEk ez du dibisa horren kanbio-tasa ofizialik argitaratzen kobratze-datan. Kalkulatu zenbatekoa eurotan data horretan, gehitu eskuz 0029 laukian eta kontuan hartu haren atxikipena nazioarteko zergapetze bikoitzaren kenkarian (0588 laukia).",
  "report.withholding_corrected_prior_year":
    "Fitxategi honek {{year}} urteko jatorriko atxikipenen zuzenketak ditu, {{reportYear}} urtean erregistratuak: {{year}} urteko atxikipena {{amount}} € jaisten da. {{year}} urteko aitorpena jatorrizko atxikipenarekin aurkeztu bazenuen, urte horretako 0588 laukia altuegia atera zitekeen.",
  "report.withholding_corrected_prior_year.hint":
    "Nazioarteko zergapetze bikoitzaren kenkariak (0588 laukia, 80. art. LIRPF) atzerrian benetan ordaindutako zerga baino ez du onartzen. Igo {{year}} urteko fitxategia honekin batera eta kalkulatu {{year}} urtea: DeclaRentak zuzenketa bere dibidenduaren atxikipenari gehitzen dio. 0588 laukia aurkeztu zenuena baino txikiagoa bada, zuzendu {{year}} urteko aitorpena (2024 eta ondorengoak: autolikidazio zuzentzailea, «autoliquidación rectificativa»; 2023 eta aurrekoak: autolikidazio osagarria, «autoliquidación complementaria»). {{reportYear}} urteko laukiak ez dira aldatzen.",
  "report.spanish_withholding_corrected_prior_year":
    "Fitxategi honek {{year}} urteko Espainiako atxikipenen zuzenketak ditu, {{reportYear}} urtean erregistratuak: {{year}} urteko atxikipena {{amount}} € jaisten da. {{year}} urteko aitorpena jatorrizko atxikipenarekin aurkeztu bazenuen, urte horretako 0597 laukia altuegia atera zitekeen.",
  "report.spanish_withholding_corrected_prior_year.hint":
    "Espainiako jaulkitzaileen dibidenduen Espainiako atxikipena konturako ordainketa da (0597 laukia, kapital higigarriaren atxikipenak), eta benetan atxikitakoa baino ez da kontatzen. Igo {{year}} urteko fitxategia honekin batera eta kalkulatu {{year}} urtea: DeclaRentak zuzenketa bere dibidenduaren atxikipenari gehitzen dio. 0597 laukia aurkeztu zenuena baino txikiagoa bada, zuzendu {{year}} urteko aitorpena (2024 eta ondorengoak: autolikidazio zuzentzailea, «autoliquidación rectificativa»; 2023 eta aurrekoak: autolikidazio osagarria, «autoliquidación complementaria»). {{reportYear}} urteko laukiak ez dira aldatzen.",
  "report.crypto_general_gain_unvalued":
    "{{count}} kriptomonetako ondare-irabazi daude (adib. airdropak edo gomendio-komisioak) automatikoki baloratu ezin izan direnak eta kalkulatutako zenbatekoetan sartzen ez direnak.",
  "report.crypto_general_gain_unvalued.hint":
    "Errenta hauek kripto berean jasotzen dira eta ez dute BCEren kanbio-tasa ofizialik. Kalkulatu eurotako balioa kobratze-datan eta deklaratu eskuz transmisiotik ez datorren ondare-irabazi gisa (oinarri orokorra).",
  "report.antichurning_window_past_data":
    "{{year}} urteko {{count}} salmentaren berrerosketa-epea (anti-churning araua: 2 hilabete; urtebete, balioa Europako Esparru Ekonomikoko merkatu arautu batean edo baliokide batean kotizatzen ez bada; kriptomonetetan, salmentaren ondorengo urtea bakarrik) broker horren igotako fitxategiek hartzen duten azken dataren ({{lastDate}}) ondoren amaitzen da. DeclaRenta-k ez ditu data horren ondorengo erosketak ikusten.",
  "report.antichurning_window_past_data.hint":
    "Balio bera {{lastDate}} ondoren eta salmenta horien epearen barruan erosi bazenuen ({{windowEnd}} arte gehienez), haien galeraren zati bat blokeatuta gera daiteke, edo salmenta ez da behin betiko eskualdaketa izango eta ez ditu zain dauden galerak askatuko. Igo {{windowEnd}} arteko eragiketak dituen fitxategia ere honekin batera, eta kalkulatu berriro. Epe hori urtebetekoa da DeclaRenta-k urtebete aplikatzen dien balioetan (IBKR-k baliokidetasunik gabeko merkatu batean bakarrik erakusten dituelako, hala nola Londres 2021etik aurrera, SIX edo OTC Markets, edo zuk markatu dituzulako), eta 2 hilabetekoa ISIN duten gainerako balioetan. Balio bat horrelako merkatu batean bakarrik kotizatzen bada eta DeclaRenta-k 2 hilabete aplikatzen badizkio, markatu urtebetearekin «Anti-churning epea balio bakoitzeko» panelean (komando-lerroan, --antichurning-1y) eta kalkulatu berriro. Kriptomonetetan, kriptomoneta beraren erosketek bakarrik balio dute, edozein exchangetan, salmentaren ondoren eta {{windowEnd}} arte gehienez eginak; salmentaren aurrekoek ez dute balio. Erosi ez bazenuen, kalkulua zuzena da.",
  "report.antichurning_window_open_at_filing":
    "{{year}} urteko {{count}} salmentaren berrerosketa-epea (anti-churning araua) {{windowEnd}} arte luzatzen da gehienez: aitorpena aurkezteko azken eguna ({{deadline}}) igaro ondoren, eta broker horren igotako fitxategiek hartzen duten azken dataren ({{lastDate}}) ondoren. Aitorpena aurkezten duzunean, epe hori irekita egongo da oraindik.",
  "report.antichurning_window_open_at_filing.hint":
    "Aurkeztu aurretik, igo {{lastDate}} ondorengo eragiketak dituen fitxategia ere, eta kalkulatu berriro. Balio bera edo kriptomoneta bera {{windowEnd}} arte, egun hori barne, erosten baduzu, salmenta horien galeraren zati bat blokeatuta gera daiteke, edo salmenta ez da behin betiko eskualdaketa izango eta ez ditu zain dauden galerak askatuko. Kasu horretan, zuzendu aurkeztutako aitorpena autolikidazio zuzentzaile batekin («autoliquidación rectificativa»).",
  "report.antichurning_one_year_ibkr":
    "DeclaRenta-k anti-churning arauaren urtebeteko epea aplikatzen die {{count}} balioren salmentei (PFEZaren Legearen 33.5.g art.), IBKR-k salmenta-egun horietan Europako Esparru Ekonomikoko merkatu arautua ez den eta Europako Batzordeak baliokidetzat jo ez duen merkatu batean bakarrik erakusten dituelako: {{list}}.",
  "report.antichurning_one_year_ibkr.hint":
    "IBKR-k eragiketak egin dituzun lerroen merkatua bakarrik erakusten du. Balioa Europako Esparru Ekonomikoko merkatu arautu batean ere negoziatzeko onartuta badago (ez da nahikoa hazkunde-merkatu bat edo beste negoziazio-sistema aldeaniztun bat) edo NYSEn, Nasdaqen, ASXen edo Hong Kongeko Burtsan, 2 hilabete dagozkio: markatu 2 hilabeterekin «Anti-churning epea balio bakoitzeko» panelean (komando-lerroan, --antichurning-2m) eta kalkulatu berriro.",
  "report.antichurning_listing_open":
    "DeclaRenta-k 2 hilabete aplikatzen dizkie {{count}} balioren salmentei, IBKR-k salmenta-egun horietan Toronton, TSX Venturen, Aequitas Neon, Tokion edo Singapurren erakusten dituelako: {{list}}. Europako Batzordearen erabaki batek merkatu hori merkatu arautu baten baliokidetzat jotzen du, eta DGTk erabaki mota hori onartzen du (V0778-25 kontsulta), baina kontsultarik ez da akzioetarako berresten.",
  "report.antichurning_listing_open.hint":
    "Irizpide zuhurra nahiago baduzu, markatu urtebetearekin «Anti-churning epea balio bakoitzeko» panelean (komando-lerroan, --antichurning-1y) eta kalkulatu berriro.",
  "report.antichurning_window_user":
    "Eskuz finkatu duzu anti-churning arauaren epea {{count}} baliotan. Urtebete: {{oneYear}}. 2 hilabete, IBKR-k ematen zuen urtebetearen ordez: {{twoMonths}}.",
  "report.antichurning_window_user.hint":
    "DeclaRenta-k zure epea erabiltzen du automatikoaren ordez galerak blokeatzeko, behin betiko eskualdaketaren proban eta epe-oharretan. «Anti-churning epea balio bakoitzeko» panelean alda dezakezu (komando-lerroan, --antichurning-1y edo --antichurning-2m).",
  "antichurning_window.title":
    "Anti-churning epea balio bakoitzeko",
  "antichurning_window.description":
    "Anti-churning arauak galera bat blokeatzen du balio bera salmentaren aurreko edo ondorengo 2 hilabeteetan berrerosten baduzu (PFEZaren Legearen 33.5.f art.). Balioa Europako Esparru Ekonomikoko merkatu arautu batean edo baliokidetzat jotako merkatu batean negoziatzeko onartuta ez badago, epea urtebetekoa da (33.5.g art.). DeclaRenta-k IBKR-k erakusten duen merkatuaren arabera aukeratzen du epea, eta ez badaki, 2 hilabete aplikatzen ditu. Hemen balio bakoitzarentzat finka dezakezu.",
  "antichurning_window.col_security":
    "Balioa",
  "antichurning_window.col_listing":
    "Merkatua IBKR-ren arabera",
  "antichurning_window.col_window":
    "Epea",
  "antichurning_window.months_2":
    "2 hilabete",
  "antichurning_window.months_12":
    "Urtebete",
  "antichurning_window.opt_auto":
    "Automatikoa ({{window}})",
  "antichurning_window.opt_2m":
    "2 hilabete: EEEko merkatu arautu batean edo baliokide batean onartua",
  "antichurning_window.opt_1y":
    "Urtebete: ez dago onartuta EEEko merkatu arautu batean ezta baliokide batean ere (adib. Londresen bakarrik 2021etik aurrera, SIX, OTC edo BME Growth)",
  "antichurning_window.no_listing":
    "daturik ez",
  "antichurning_window.open_note":
    "{{decision}} Erabakiaren araberako baliokidetasuna, akzioetarako berretsi gabea",
  "antichurning_window.save_btn":
    "Gorde eta birkalkulatu",
  "antichurning_window.clear_btn":
    "Ezabatu gordetako epeak",
  "antichurning_window.saved":
    "Gordeta",
  "antichurning_window.recalculate_hint":
    "Epeak zure nabigatzailean gordetzen dira eta txostena birkalkulatzen da.",
  "antichurning_window.save_error":
    "Nabigatzaileak ez du utzi epeak gordetzen: haren biltegia beteta edo blokeatuta egon daiteke. Txostena ez da aldatu.",
  "antichurning_window.clear_error":
    "Nabigatzaileak ez du utzi gordetako epeak ezabatzen: haren biltegia blokeatuta egon daiteke. Txostena ez da aldatu.",
  "report.antichurning_single_purchase":
    "{{year}} urteko {{count}} salmentatan, aurreko 2 hilabeteetako erosketa ez da berrerosketatzat hartzen: epe horretan balio horren erosketa bakarra izan zen, eta epea hastean ez zenuen balio horren akziorik (erosketa bakarraren salbuespena, DGT V3282-18). Erosketa horrek ez du galera blokeatzen, eta ez du eragozten salmentak zain dauden galerak askatzea.",
  "report.antichurning_single_purchase.hint":
    "DeclaRenta-k igotako fitxategiak bakarrik ikusten ditu. Epea hastean (lehena {{windowStart}} egunean hasten da) balio horren akziorik bazenuen igo ez duzun beste broker edo kontu batean, edo gero beste erakunde batera eraman bazenituen, salbuespena ez da aplikatzen: igo fitxategi horiek ere, eta kalkulatu berriro. Salmentaren ondorengo 2 hilabeteetako erosketa batek galera blokeatzen jarraitzen du.",
  "report.antichurning_single_purchase_unverified":
    "{{year}} urteko {{count}} salmentatan 2 hilabeteko arauaren erosketa bakarraren salbuespena aplika daiteke, baina DeclaRenta-k ez du aplikatzen: igotako fitxategiek ez dute frogatzen epea hastean (lehena {{windowStart}} egunean hasten da) balio horren akziorik ez zenuela. Aurreko 2 hilabeteetako erosketa berrerosketatzat hartzen da.",
  "report.antichurning_single_purchase_unverified.hint":
    "Epea hastean balio horren akziorik ez bazenuen inongo brokerretan, eta salmentaren aurreko 2 hilabeteetan erosketa hori bakarrik egin bazenuen, erosketa hori ez da berrerosketatzat hartzen (DGT V3282-18). DeclaRenta-k zure fitxategiek kontu bakoitzean frogatzen dutenean bakarrik aplikatzen du: balio hori duen edo erabiltzen duen kontu bakoitzaren fitxategiek kontuaren eragiketak hutsunerik eta errepikatutako egunik gabe estali behar dituzte {{windowStart}} egunetik salmenta-egunean edo geroago datatutako aldi-amaierako posizioetaraino (IBKR-n, Flex Query-ko Trades eta Open Positions atalak, ISIN eremuarekin), kantitate guztiak irakurtzeko moduan eta kontu horren eragiketek uzten dituzten akzio berberekin. Aldi horretan ISINik gabeko akzio-eragiketa batek, edo aldia hastean oraindik zenituen ISINik gabeko akzioek (adibidez, Revoluteko akzioek), edozein kontutan, hori ere eragozten dute, balio horretakoak izan daitezkeelako. Eragiketak bakarrik dituen fitxategi bat ez da nahikoa, eta epe horretako kontuen arteko transferentzia bat edo eskuzko lote bat ezin da egiaztatu.",
  "report.titularidad_compartida":
    "Erakutsitako zenbatekoak {{titulares}} titularren artean banatuta daude (zergadun bakoitzari dagokion zatia). Txosten honek titular BAKAR baten aitorpena islatzen du: {{titulares}} titularretako bakoitzak bere aitorpena aurkeztu behar du zati berberarekin. Ez ezazu zenbatekoa osoa aitorpen bakar batean deklaratu, ezta hainbat titularren zatiak zurean batu ere.",
  "report.titularidad_compartida.hint":
    "Zati berdinetako banaketak ({{titulares}} × {{percent}} %) titulartasun berdina suposatzen du. Titulartasun-ehunekoak desberdinak badira (adib. 70/30), doitu zenbatekoak eskuz. Irabazpidezko kontuetan esleipena 50/50 da (11.3 art. LIRPF). Titular kopurua «Berrikusi eta metodoa aukeratu» urratsean alda dezakezu (komando-lerroan, --titulares).",
  "report.competitor_reconciliation":
    "Beste tresna batek zenbateko desberdina erakusten badu, baliteke kanbio-tasagatiko irabaziak ez kalkulatzea izatea (33.1 art. LIRPF).",
  "report.competitor_reconciliation.hint":
    "Beste metodo batekin alderatu dezakezu «Berrikusi eta metodoa aukeratu» urratsean (komando-lerroan, --fx-method). «Tradizionala dibisarekin» metodoak akzioak erosketa-eguneko eta salmenta-eguneko tasan balioesten ditu, eta zure dibisa ere kalkulatzen du. «Tradizionala dibisarik gabe (monodibisa)» metodoak akzioak berdin balioesten ditu, baina ez du dibisa-emaitzarik batere kalkulatzen, ezta USD→EUR bihurketetan ere.",
  "report.monodivisa_conversions_skipped":
    "«Tradizionala dibisarik gabe (monodibisa)» metodoak ekitaldi honetako {{count}} dibisa-bihurketa kalkulatu gabe utzi ditu (eskuzkoak edo brokerraren automatikoak). Metodo honek ez du dibisa-emaitzarik batere kalkulatzen (1633/1637 laukiak).",
  "report.monodivisa_conversions_skipped.hint":
    "Dibisa bihurtu baduzu (adibidez, USDtik EURera), aukeratu «Tradizionala dibisarekin» «Berrikusi eta metodoa aukeratu» urratsean (komando-lerroan, --fx-method tradicional-divisa). Akzioak berdin balioesten ditu eta zure bihurketak kalkulatzen ditu. «DGTren irizpidea (multidibisa)» metodoak ere kalkulatzen ditu.",
  "report.fx_method_consistency":
    "DeclaRentak «DGTren irizpidea (multidibisa)» erabiliz kalkulatzen du: dibisa-irabazia atzeratu egiten da atzerriko moneta euro bihurtu arte (14.2.e art. LIRPF; DGT V0152-26). Beste bi metodo daude: «Tradizionala dibisarekin» eta «Tradizionala dibisarik gabe (monodibisa)».",
  "report.fx_method_consistency.hint":
    "Ez nahastu metodoak ekitaldien artean: urte batean beste irizpide batekin (edo beste tresna batekin) aitortu bazenuen, eramandako dibisa-oinarria bikoiztu edo kanpoan gera daiteke. Zure txostenaren aldia baino lehen eskuratutako dibisarako, sartu aurreko urteak brokerraren esportazioan.",
  "report.fx_deferred_no_conversion":
    "Ekitaldi honetan ez duzu dibisarik euro bihurtu, beraz, ez dago kanbio-tasagatiko irabazirik aitortzeko (ez zaie dibisa-zenbatekorik gehitzen 1633/1637 laukiei). Moneta mantentzen duzun bitarteko kanbio-diferentzia atzeratuta geratzen da, benetan euro bihurtu arte (14.2.e art. LIRPF; DGT V0152-26).",
  "report.fx_deferred_no_conversion.hint":
    "Zure brokerrak (adib. IBKR) «realized forex gain» bat erakuts dezake euro bihurtu ez baduzu ere: AEBko zerga-irizpidea erabiltzen du, ez Espainiakoa. «DGTren irizpidea (multidibisa)» metodoarekin, dibisa-irabazia euro edo beste dibisa batera bihurtzean bakarrik aitortzen da.",
  "report.fx_traditional_method":
    "«Tradizionala dibisarekin» metodoa. Dibisako akzioak EBZren erosketa-eguneko tasan (kostua) eta salmenta-eguneko tasan (salmenta) balioesten dira. Dibisak FIFO bidez tributatzen du zure kontutik irteten denean: euro edo beste dibisa bat bihurtzean, komisioak edo interesak ordaintzean, edo galerak dituen salmenta batean galtzean. Salmenta batek inbertitutako dibisa itzultzen dizu eta, irabazten baduzu, irabazia. Inbertitutako dibisak kostatu zitzaizuna balio du, gehi akzioak erosi eta saldu bitarteko truke-tasaren aldaketa, salmenta horren emaitzan dagoeneko sartuta dagoena. Irabazia salmenta-eguneko tasan sartzen da. Berreskuratzen ez duzun dibisa inbertituak bereiz tributatzen du, salmenta horretan. Horrela, dibisaren aldaketa bakoitza behin bakarrik aitortzen da.",
  "report.fx_traditional_method.hint":
    "DGTk horrela balioesten ditu dibisako inbertsio-funtsen partaidetzak (V2324-10, V0775-21). Akzioetarako, Ogasunak irabazia dibisan kalkulatzen du eta salmenta-eguneko tasan pasatzen du eurotara (V1740-17, V2422-20, V0152-26): hori da «DGTren irizpidea (multidibisa)». Bi metodoetan, bihurtzen duzun dibisak bihurtzean tributatzen du (V2466-08). Galerak dituen salmenta batean galdutako dibisak salmentaren urtean tributatzen du, funtsetan bezala (V0775-21, V2324-10). Autodeclarok akzioen balioespen bera deskribatzen du, zure brokerraren kontu-estraktuko kanbio-tasekin, baina ez du argitaratzen nola kalkulatzen duen dibisa. Erabili metodo bera urtero.",
  "report.fx_traditional_risk":
    "Ogasunak «DGTren irizpidea (multidibisa)» aplikatzen die akzioei (V1740-17). 2025ean kalkulu bera baztertu zuen dolarretan erositako pisu baterako (V1615-25). Zure aitorpena berrikusten badu, irizpide horrekin berriro kalkula dezake.",
  "report.fx_traditional_risk.hint":
    "Ziklo osoan (euroak → dibisa → akzioak → dibisa → euroak) galerak dituen salmentarik ez badago, bi metodoek ia guztizko bera ematen dute normalean. Aldatzen dena da zati bakoitza zein urtetan eta zein laukitan ateratzen den, eta nazioarteko zergapetze bikoitzagatiko kenkaria (0588 laukia) ere alda daiteke. Galerak dituzten salmentekin, metodo honek galdutako dibisa ere aitortzen du eta guztizkoa desberdina da. DGTren kontsultarik ez dago metodo hau akzioetarako babesten duenik. Ogasunak berriro kalkulatzen badu, berandutze-interesak kobra ditzake metodo honek geroko urte batera eramaten duen zergagatik.",
  "report.fx_traditional_no_conversion":
    "Aurten ez duzu dibisarik bihurtu. Akzioak zenituen bitartean {{ccy}}-k izandako aldaketa haien irabazian edo galeran dago jada. {{ccy}} eskudirutan dituzun bitarteko aldaketa bihurtzen dituzunean aitortuko da.",
  "report.fx_traditional_no_conversion.hint":
    "Metodo honekin, dibisa zure kontutik irteten denean bakarrik gehitzen zaie 1633/1637 laukiei: euro edo beste dibisa batera bihurketak, komisioak, ordaindutako interesak eta galerak dituzten salmentetan galdutako dibisa.",
  "report.fx_traditional_lost_dollars":
    "Galerak dituzten {{n}} salmentatan inbertitu zenituen baino {{ccy}} gutxiago berreskuratu zenituen. Galdutako {{ccy}} horiek zure kontutik irteten dira. Haien kanbio-diferentzia, erosi zenituenetik akzioak erosi zenituen arte ({{amount}} €), aurten aitortzen da 1633/1637 laukietan.",
  "report.fx_traditional_lost_dollars.hint":
    "«DGTren irizpidea (multidibisa)» metodoak ez du ezer aitortzen kasu honetan, {{ccy}} horiek ez zirelako inoiz euro bihurtu. Metodo honek aitortu egiten du, DGTk dibisako funtsetan egiten duen bezala (V0775-21, V2324-10): erosketaren aurreko dibisaren aldaketak salmentaren urtean tributatzen du. FIFO ordenak erabakitzen du zein {{ccy}} galdu ziren. 1633/1637 laukien xehetasunean ikusiko duzu, «Galerak dituen salmenta batean galdutako dibisa» gisa.",
  "report.fx_traditional_guard":
    "{{n}} salmentatan, akzioak erosi zirenetik {{ccy}} dibisaren jaitsiera dibisa horrek kostatu zizuna baino handiagoa da. Haren kanbio-diferentzia akzioak erosi arte ({{amount}} €) aurten aitortzen da 1633/1637 laukietan, eta {{ccy}} horiek salmenta-eguneko tasan itzultzen dira.",
  "report.fx_traditional_guard.hint":
    "Kanbio-tasa asko mugitzen denean gertatzen da (gutxi gorabehera bikoitza) dibisa erosten denetik akzioak saltzen diren arte. Arau hau gabe, {{ccy}} horiek kostu negatiboa izango lukete. 1633/1637 laukien xehetasunean ikusiko duzu, «Dibisaren aldaketa akzioak erosi arte» gisa.",
  "report.fx_traditional_inflight":
    "Aurten {{years}} urteko akzio-salmentetatik datozen {{qty}} {{ccy}} bihurtu dituzu. Metodo honek ematen du akzio horiek zenituen bitartean {{ccy}}-k izandako aldaketa ({{amount}} €) urte hartako irabazian edo galeran aitortu zela jada.",
  "report.fx_traditional_inflight.hint":
    "Hala da urte hartan «Tradizionala dibisarekin» edo «Tradizionala dibisarik gabe (monodibisa)» erabili bazenuen. «DGTren irizpidea (multidibisa)» erabili bazenuen, aurtengo zure dibisa-emaitza kopuru horretan desbideratuta dago. Erabili orduko metodo bera.",
  "report.fx_traditional_uncovered":
    "Akzio-erosketetan erabilitako {{qty}} {{ccy}}-k ez dute jatorririk euroetan zure fitxategietan (gordailuak, aurreko saldoak, igo ez dituzun urteak, edo saldo negatibo bat edo brokerraren marjina-mailegu bat). Erosketa-eguneko tasan hartzen dira, aurreko kanbio-diferentziarik gabe.",
  "report.fx_traditional_uncovered.hint":
    "Erosketaren ondorengo 7 egunetan euroak {{ccy}} bihurtu bazenituen, bihurketa horren tasa erabiltzen da. Haien jatorria ezagutzen baduzu, igo aurreko urteak ere.",
  "report.fx_traditional_uncovered_ibkr":
    "Akzio-erosketetan erabilitako {{qty}} {{ccy}}-k ez dute jatorririk euroetan zure fitxategietan (gordailuak, aurreko saldoak, igo ez dituzun urteak, edo saldo negatibo bat edo brokerraren marjina-mailegu bat). Erosketa-eguneko tasan hartzen dira, aurreko kanbio-diferentziarik gabe.",
  "report.fx_traditional_uncovered_ibkr.hint":
    "Erosketaren ondorengo 7 egunetan euroak {{ccy}} bihurtu bazenituen, bihurketa horren tasa erabiltzen da. Haien jatorria ezagutzen baduzu, igo aurreko urteak ere. Zure {{ccy}} saldoa negatiboan geratu bazen (saldo negatiboa edo marjina), igo IBKRren laburpena «Cash Report» atalarekin. DeclaRentak saldo negatibo hori {{ccy}}-ko mailegu gisa tratatzen du soilik Cash Report-a zure eragiketekin bat badator, kontu bakarrekoa bada eta {{ccy}}-tan ez badago gordailurik, erretiratzerik, transferentziarik, aukerarik edo posizio laburrik.",
  "report.fx_traditional_opening":
    "Zure kontuaren hasierako saldoko {{qty}} {{ccy}} (IBKRren «Cash Report»-a) akzio-erosketetan erabili ziren, eta ez dute jatorririk euroetan zure fitxategietan. Erosketa-eguneko tasan hartzen dira, aurreko kanbio-diferentziarik gabe.",
  "report.fx_traditional_opening.hint":
    "Saldo hori kontuan zegoen igo duzun lehen aldia hasi zenean. Haren jatorria ezagutzen baduzu, igo aurreko urteak ere.",
  "report.fx_traditional_orphan":
    "{{security}}-n inbertitutako {{qty}} {{ccy}}-ren kanbio-diferentzia ezin izan da inongo salmentari esleitu (ISIN aldaketa, bat-egitea edo zatiketa izan daiteke). Berrikusi eskuz.",
  "report.fx_traditional_orphan.hint":
    "{{ccy}} horiek {{security}} erosteko erabili ziren. Abenduaren 31n ez dituzu akzio horiek eta ez du inongo salmentak berreskuratu. {{ccy}} erosi zenituenetik akzioak erosi zenituen arteko aldaketa ({{amount}} €) ez da aitortu.",
  "report.fx_loan_repayment":
    "Aurten brokerrak utzi zizkizun {{ccy}} itzuli dituzu (zure {{ccy}} saldoa negatiboan egon zen). DeclaRentak {{amount}} € aitortzen ditu itzulketa horiengatik 1633/1637 laukietan. Zorraren beraren aldaketa, ireki zenetik itzuli zenuen arte, {{gain}} €-ko irabazia eta {{loss}} €-ko galera da.",
  "report.fx_loan_repayment.hint":
    "Auzitegi Gorenak (STS 71/2021, ECLI:ES:TS:2021:345) atzerriko monetako mailegu baten aldaketa oinarri orokorrera eramaten du. DGTk aurrezkiaren oinarrira eramaten du (V2414-12), DeclaRentak bezala. Auzitegi Gorenari jarraitzen badiozu, aitortu irabazia 0304 laukian eta galera 0305 laukian, eta kendu 1633/1637 laukietatik: jaitsi transmisio-balioa (1633) irabaziaren zenbatekoan eta igo galeraren zenbatekoan. DeclaRentak saldo negatiboa mailegutzat hartzen du soilik IBKRren eskudiru-txostena (Cash Report) zure eragiketekin bat datorrenean.",
  "report.fx_loan_repayment_manual":
    "Aurten brokerrak utzi zizkizun {{ccy}} itzuli dituzu (zure {{ccy}} saldoa negatiboan egon zen). DeclaRentak {{amount}} € aitortzen ditu itzulketa horiengatik 1633/1637 laukietan. Zorraren beraren aldaketa, ireki zenetik itzuli zenuen arte, {{gain}} €-ko irabazia eta {{loss}} €-ko galera da.",
  "report.fx_loan_repayment_manual.hint":
    "Auzitegi Gorenak (STS 71/2021, ECLI:ES:TS:2021:345) atzerriko monetako mailegu baten aldaketa oinarri orokorrera eramaten du. DGTk aurrezkiaren oinarrira eramaten du (V2414-12), DeclaRentak bezala. Auzitegi Gorenari jarraitzen badiozu, aitortu irabazia 0304 laukian eta galera 0305 laukian. Zifra horietatik, {{boxGain}} €-ko irabazia eta {{boxLoss}} €-ko galera baino ez daude 1633/1637 laukietan: jaitsi transmisio-balioa (1633) irabazi horren zenbatekoan eta igo galera horren zenbatekoan. Gainerakoa ez dago 1633/1637 laukietan, beste eragiketa batzuen emaitzaren barruan baizik (adibidez, maileguarekin erosi zenituen akzioen salmentan), eta DeclaRentak ezin dizu esan zein lauki zuzendu: egin kontuak eskuz aitorpena aurkeztu aurretik. DeclaRentak saldo negatiboa mailegutzat hartzen du soilik IBKRren eskudiru-txostena (Cash Report) zure eragiketekin bat datorrenean.",
  "report.fx_method_name.multidivisa":
    "DGTren irizpidea (multidibisa)",
  "report.fx_method_name.tradicional-divisa":
    "Tradizionala dibisarekin",
  "report.fx_method_name.monodivisa":
    "Tradizionala dibisarik gabe (monodibisa)",
  "report.settings_line":
    "Kalkuluaren ezarpenak: metodoa {{method}}, titularrak {{titulares}}, auto-bihurketak {{autoconvert}}",
  "report.non_finite_total":
    "Balio ez-finitu bat (NaN/Infinitua) detektatu da kalkulatutako total batean; berrikusi inportatutako fitxategiak.",
  "report.non_finite_total.hint":
    "Litekeena da broker baten fitxategi batek zenbateko hondatu bat edo ustekabeko zenbaki-formatu bat izatea. Berrikusi jatorrizko eragiketak.",
  "flatex.lagerstellenwechsel.unmatched":
    "Kustodia-transferentzia (Lagerstellenwechsel) kontrapartidarik gabe {{isin}} baliorako: {{netQuantity}} titulu.",
  "flatex.lagerstellenwechsel.unmatched.hint":
    "Bikoterik gabeko transferentzia bat sartu edo atera zen gordailutik eskuratze-preziorik gabe. Geroago titulu hauek saltzen badituzu, egiaztatu jatorrizko erosketa-balioa sartuta dagoela irabazi fiktizio bat ez deklaratzeko.",
  "flatex.commission.unmatched_trades":
    "Ezin izan dira Flatex-en komisio guztiak parekatu: dagozkien kutxa-idazpenak falta dira.",
  "flatex.commission.unmatched_trades.hint":
    "Igo ezazu Kontoumsätze (kontu-mugimenduak) CSVa ere Depotumsätze-rekin batera, eragiketa bakoitzaren komisioa kontuan har dadin (erosketetan eskuratze-kostuari gehituz eta salmentetan transmisio-baliotik kenduz).",
  "flatex.commission.cross_currency":
    "Komisio kalkulaturik gabeko Flatex eragiketak: {{trades}}. Kutxa-idazpena eragiketarena ez den beste txanpon batean dago.",
  "flatex.commission.cross_currency.hint":
    "Eragiketa horien komisioa 0an utzi da. Kontsultatu haren zenbatekoa Flatex-eko aginduaren likidazioan eta kontuan hartu aitorpena berrikustean: erosketetan eskuratze-balioari gehitzen zaio eta salmentetan transmisio-baliotik kentzen da.",
  "flatex.commission.multi_fill_prorated":
    "Hainbat zatitan exekutatutako Flatex aginduak: {{orders}}. Haien komisioa exekuzioen artean banatu da, bakoitzaren zenbatekoaren arabera.",
  "flatex.commission.multi_fill_prorated.hint":
    "Flatex-ek agindu horiek exekuzio kopuruaren desberdina den kutxa-idazpen kopuru batekin likidatu zituen, beraz ezin da jakin zein komisio dagokion bakoitzari. Agindu bakoitzaren komisioen guztizkoa zehatza da; exekuzioen arteko banaketa soilik da gutxi gorabeherakoa.",
  "flatex.depot.repeated_fills":
    "Errepikatutako Flatex eragiketak, behin bakarrik zenbatuak: {{fills}}. Kargatuta zegoen beste baten agindu-zenbaki eta idazpen-zenbaki (TA-Nr.) bera zuten.",
  "flatex.depot.repeated_fills.hint":
    "Depotumsätze CSV bera bi aldiz igotzean gertatu ohi da, edo datak gainjartzen dituzten bi esportazio igotzean. Benetan eragiketa desberdinak badira, berrikusi fitxategia: Flatex-ek exekuzio bakoitzari bere TA-Nr. ematen dio.",
  "flatex.dividends.net_amounts":
    "Flatex-ek dibidenduak jasotako zenbateko garbiarekin erregistratzen ditu, atxikipena kenduta, eta Kontoumsätze CSVak ez du atxikipena jasotzen.",
  "flatex.dividends.net_amounts.hint":
    "Hartu kobrantza bakoitzaren zenbateko osoa eta atxikipena Flatex-ek zure dokumentu-postontzian uzten duen PDF egiaztagiritik, eta zuzendu eskuz 0029 laukia (zenbateko osoa), 0588 laukia (atzerriko atxikipena) eta 0597 laukia (atxikipen espainiarra).",
  "degiro.rows_skipped": "{{count}} errenkada baztertu dira ISINik/zenbatekorik gabe.",
  "degiro.rows_skipped.hint":
    "Errenkada hauek kopurua edo prezioa zuten baina ISINa edo zenbatekoa falta zuten, eta, beraz, ezin izan dira eragiketa gisa sartu. Normalean CSVaren zutabeak ondo ez direla ezagutu adierazten du: esportatu berriro Degiro-ren Transakzioen CSVa goiburuak aldatu gabe.",
  "degiro.corporate_action_pair":
    "Baliteke {{date}} egunean eragiketa korporatibo bat egotea: {{oldProduct}} ({{oldIsin}}) → {{newProduct}} ({{newIsin}}). Degirok salmenta eta erosketa gisa erregistratzen du.",
  "degiro.corporate_action_pair.hint":
    "Degirok ISIN aldaketak, splitak eta akzio-trukeak balore zaharraren salmenta eta berriaren erosketa gisa erregistratzen ditu, agindu-zenbakirik eta kosturik gabe. DeclaRentak horrela kalkulatzen ditu: egun horretan irabazi edo galera bat aitortzen du, eta akzio berriek prezio hori eta data hori hartzen dituzte kostu gisa. Berrikusi Degiroren edo jaulkitzailearen jakinarazpena. ISIN aldaketa hutsa, split bat edo fiskalki neutroa den truke bat izan bazen (Sozietateen gaineko Zergaren Legearen araubide berezia), ez zen salmentarik egon: akzio berriek zaharren kostua eta erosketa-data gordetzen dituzte, beraz, zuzendu eragiketa hori zure aitorpenean. Zergapean dagoen truke bat izan bazen (LIRPFren 37.1.e art.), kalkulua zuzena da.",
  "degiro.transaction_tax": "Finantza-transakzioen gaineko zerga ordaindua {{product}} baloreagatik ({{isin}}): {{amount}} {{currency}}.",
  "degiro.transaction_tax.hint":
    "Degirok zerga hau kobratzen du Espainiako, Frantziako edo Italiako akzioak erostean, eta Kontuaren CSVan bakarrik erakusten du. Eskuratze-balioaren parte da (PFEZL 35.1.b art.): gehitu balore horren erosketen kostuari, DeclaRentak ez baitu automatikoki gehitzen.",
  "binance.unparseable_timestamp":
    "Binance-ren CSVaren {{count}} errenkada baztertu dira data/ordu (UTC_Time) ezezagun bat izateagatik.",
  "binance.unparseable_timestamp.hint":
    "Normalean eskuz aldatutako edo modu osatugabean esportatutako fitxategi bati zor zaio. Deskargatu berriro jatorrizko txostena Binance-tik editatu gabe eragiketa horiek sar daitezen.",
  "binance.unhandled_operation":
    "Binance-ren CSVko {{count}} mugimendu baztertu dira, eragiketa ezezagunak dituztelako: {{operations}}.",
  "binance.unhandled_operation.hint":
    "Mugimendu horiek ez dira kalkuluan sartu. Erosketak, salmentak edo diru-sarrerak badira (adib. futuroak, Binance Card bidezko ordainketak, Auto-Invest edo cashback), gehitu eskuz zure aitorpenean eta jakinarazi eragiketaren izena, sar dadin.",
  "binance.unsupported_pair":
    "Binance-ren CSVko {{count}} eragiketa baztertu dira, pare ezezagun bat dutelako: {{pairs}}.",
  "binance.unsupported_pair.hint":
    "Eragiketa horiek ez dira kalkuluan sartu. Gehitu eskuz zure aitorpenean eta jakinarazi parea, sar dadin.",
  "etoro.closed_types_skipped":
    "eToro-ren {{count}} posizio itxi baztertu dira, onartzen ez den mota batekoak direlako: {{types}}.",
  "etoro.closed_types_skipped.hint":
    "DeclaRentak oraindik ez ditu eToro-ren posizio mota horiek inportatzen (adib. kriptomonetak). Haien irabazia edo galera ez dago kalkuluan sartuta: gehitu eskuz zure aitorpenean, eToro-k erakusten dituen inbertitutako zenbatekoarekin eta irabaziarekin.",
  "lightyear.unknown_types":
    "Lightyear-en CSVko {{count}} errenkada baztertu dira, mugimendu mota ezezaguna dutelako: {{types}}.",
  "lightyear.unknown_types.hint":
    "Mugimendu horiek ez dira kalkuluan sartu. Akzio-zatiketak (splits), akzio-transferentziak edo beste eragiketa korporatibo batzuk badira, berrikusi eskuz: geroko salmenten akzio kopurua edo eskuratze-kostua alda dezakete.",
  "coinbase.rewards_income_classification":
    'Coinbase-ren "Rewards Income" motako {{count}} diru-sarrera kapital higigarriaren etekin gisa sailkatu dira (aurrezki-oinarria).',
  "coinbase.rewards_income_classification.hint":
    "Zenbateko horietako batzuk sari promozionalak edo txartelaren cashback-a badira (ez kripto mantentzeagatiko edo lagatzeagatiko etekinak), tratamendu zuzena transmisiotik ez datorren ondare-irabazia litzateke (oinarri orokorra). Berrikusi haien izaera kopurua esanguratsua bada.",
  "coinbase.unknown_types_skipped":
    "Coinbase-ren {{count}} errenkada baztertu d(ir)a, eragiketa-mota ezezaguna dutelako: {{types}}.",
  "coinbase.unknown_types_skipped.hint":
    "Errenkada horiek ez dira kalkuluan kontuan hartu. Horietako bat salmenta, erosketa, kriptoz egindako ordainketa edo sari bat bada, gehitu eskuz, haren irabazia, eskuratze-kostua edo etekina kontuan har daitezen.",
  "coinbase.advanced_trade_quote_leg_missing":
    "Coinbase-ren Advanced Trade-ko {{count}} eragiketa balorazio-monetaz bestelako moneta batean ordaindu edo kobratu d(ir)a ({{pairs}}); erositako edo saldutako kriptomoneta soilik erregistratu da, ez kontrapartidako moneta.",
  "coinbase.advanced_trade_quote_leg_missing.hint":
    "Bikote horietan kotizazio-moneta ere eskualdatzen duzu (erostean) edo eskuratzen duzu (saltzean), beste kriptomoneta bat edo dibisa bat izan, eta eragiketa horrek ere tributatzen du. Gehitu eskuz moneta horren salmenta edo erosketa, eragiketaren euro-balio berberarekin, haren irabazia eta eskuratze-kostua bat etor daitezen.",
  "trade_republic.trade_skipped_no_amount":
    "Trade Republic-en erosketa-salmentako {{count}} eragiketa baztertu d(ir)a zenbateko erabilgarririk gabe.",
  "trade_republic.trade_skipped_no_amount.hint":
    'Normalean esportazioan errenkada osatugabeei zor zaie ("amount" zutabea hutsik edo zenbakizkoa ez dena). Eragiketak falta badira, deskargatu berriro transakzioen CSV osoa Trade Republic-etik.',
  "trade_republic.corporate_action_not_applied":
    "Trade Republic: ez dira aplikatu {{isins}} baloreen ekintza korporatiboko {{count}} mugimendu (fusioa, trukea, split-a).",
  "trade_republic.corporate_action_not_applied.hint":
    "Titulu zaharren kostua ez da berrietara pasatzen, beraz balore berriaren ondorengo salmenta batek loterik gabe eta 0 kostuarekin atera daiteke. Fusioa edo trukea izan bazen, gehitu jatorrizko eskuratze-kostua «Eskuzko loteak transferitutako posizioentzat» atalean.",
  "trade_republic.delivery_not_applied":
    "Trade Republic: ez dira inportatu {{isins}} baloreen salerosketarik gabeko {{count}} titulu-entrega (doako akzioak, lekualdaketak).",
  "trade_republic.delivery_not_applied.hint":
    "Promozio bateko doako akzioak zerga-oinarri orokorreko ondare-irabazia dira, entrega-eguneko merkatu-balioaren arabera: aitortu itzazu bereiz eta gehitu balio hori kostu gisa «Eskuzko loteak transferitutako posizioentzat» atalean. Beste broker batetik egindako lekualdaketa bada, gehitu bertan jatorrizko erosketa-kostua.",
  "parser.trading212.unresolved_price_skipped":
    "{{skipped}} eragiketa baztertu dira akzioko preziorik gabe eta zenbatekoa beste dibisa batean dutela.",
  "parser.trading212.unresolved_price_skipped.hint":
    'Errenkada hauek ez zuten akzioko preziorik eta haien zenbatekoa (Total) instrumentuarenetik desberdina den dibisa batean zegoen, eta, beraz, ezin izan da eragiketaren balioa kalkulatu. Esportatu berriro historiala Trading 212-tik "Price / share" zutabea sartzen duzula ziurtatuz.',
  "parser.cash_summary_duplicates": "{{skipped}} laburpen-errenkada bikoiztu baztertu dira efektiboko transakzioetan.",
  "parser.cash_summary_duplicates.hint":
    'Zure Flex Query-ak "Summary" aukera aktibatuta du Cash Transactions atalean, eta horrek mugimendu bakoitza bikoizten du. Desaktiba dezakezu, baina ez da beharrezkoa: errenkada hauek automatikoki ezikusi dira dibidenduak, atxikipenak eta komisioak ez bikoizteko.',
  "parser.executions_merged": "{{sourceFillCount}} egikaritze partzial {{mergedGroupCount}} agindutan multzokatu dira.",
  "parser.executions_merged.hint":
    "Hainbat egikaritze partzial dituzten aginduak eragiketa bakarrean konbinatu dira, Ogasunari informatzen dioten brokerrek egiten duten bezala. Zerga-kalkulua ez da aldatzen: kopuru osoa, batez besteko prezio haztatua eta komisioak berdin batzen dira.",
  "parser.order_level_duplicates": "{{skipped}} ORDER motako errenkada agregatu bikoiztu baztertu dira eragiketetan.",
  "parser.order_level_duplicates.hint":
    'Zure Flex Query-ak "Orders" xehetasun-maila aktibatuta du "Executions"-ez gain Trades atalean, eta horrek eragiketa bakoitza bikoizten du. "Orders" desaktiba dezakezu Flex Query-aren konfigurazioan, baina ez da beharrezkoa: errenkada hauek automatikoki ezikusi dira kopuruak, zenbatekoak eta komisioak ez bikoizteko.',
  "parser.cancelled_trades": "IBKRk ezeztatutako {{count}} eragiketa baztertu dira, beren ezeztapenarekin batera.",
  "parser.cancelled_trades.hint": 'IBKRk ezeztatutako egikaritze bat ezeztapen-errenkada batekin markatzen du ("(Ca.)"). Jatorrizko eragiketa eta haren ezeztapena baztertu dira: ez ziren inoiz benetako erosketa edo salmenta izan.',
  "parser.cancelled_trades_unmatched": "IBKRren {{count}} ezeztapen baztertu dira, jatorrizko eragiketa fitxategi honetan ez dagoelako.",
  "parser.cancelled_trades_unmatched.hint": "Ezeztatutako eragiketa Flex Query honen alditik kanpo dago. Beste fitxategi batetik kargatzen baduzu, benetakotzat hartzen jarraituko du: esportatu eragiketa eta haren ezeztapena fitxategi berean biltzen dituen aldi bat.",
  "parser.cancelled_trades_unreadable": "IBKRren {{count}} ezeztapen baztertu dira, ezeztatzen duten eragiketarekin parekatu ezinik: kopuru edo prezio irakurgarri bat falta da ezeztapenean edo fitxategi honetako eragiketa batean.",
  "parser.cancelled_trades_unreadable.hint": "Ezeztatutako eragiketa fitxategi honetan badago, DeclaRentak benetako erosketa edo salmentatzat hartzen jarraitzen du. Egiaztatu Flex Queryak eragiketa bakoitzaren kopurua, prezioa eta exekuzio IDa (IB Execution ID) esportatzen dituela eta esportatu berriro.",
  "parser.open_position_quantity_unknown": "IBKRk ez du akzio kopuru irakurgarririk ematen {{count}} posizio irekitarako: {{holdings}}.",
  "parser.open_position_quantity_unknown.hint": "DeclaRentak 0 akziorekin zenbatzen ditu: 720 ereduak bere balioarekin sartzen ditu, baina «Número de valores» eremuan 0rekin, eta D-6ak ez ditu sartzen. Berrikusi eskuz posizio horiek 720an eta D-6an, edo egiaztatu Flex Queryko Open Positions atalak kopurua duela eta esportatu berriro.",
  "parser.trade_quantity_unknown": "{{broker}} brokerraren fitxategiak ez du akzio kopuru edo prezio irakurgarririk ematen {{count}} eragiketatarako: {{trades}}.",
  "parser.trade_quantity_unknown.hint": "DeclaRentak ez du akziorik gehitzen edo kentzen haiengatik; beraz, balio horren irabaziak eta galerak ez dira fidagarriak, eta ez da aplikatzen 2 hilabeteko arauaren erosketa bakarraren salbuespena. Egiaztatu esportatutako fitxategiak eragiketa bakoitzaren kopurua eta prezioa dituela eta esportatu berriro.",
  "parser.crypto_quantity_unknown": "{{broker}} brokerraren fitxategiak ez du unitate kopuru edo prezio irakurgarririk ematen kriptomonetekin egindako {{count}} eragiketatarako: {{trades}}.",
  "parser.crypto_quantity_unknown.hint": "DeclaRentak ez du unitaterik gehitzen edo kentzen haiengatik; beraz, kriptomoneta horren irabaziak eta galerak ez dira fidagarriak. Horietako bat galerak izan zituen salmenta baten hurrengo urtean egindako berrerosketa bada, galera horrek zain geratu beharko du agian (LIRPF 33.5.e art.), eta DeclaRentak ez du blokeatzen, ez dakielako zenbat unitate berrerosi dituzun. Egiaztatu esportatutako fitxategiak eragiketa bakoitzaren kopurua eta prezioa dituela eta esportatu berriro.",
  "revolut.bad_fx_rate": "Revoluteko laburpeneko {{count}} diru-sarrera edo diru-erretiratze baztertu dira, haien truke-tasa (FX Rate) baliozkoa ez delako: {{rows}}.",
  "revolut.bad_fx_rate.hint": "Diru-sarrerek eta diru-erretiratzeek bakarrik erabiltzen dute zutabe hori; erosketak, salmentak eta dibidenduak EBZren truke-tasarekin kalkulatzen dira, eta ez dira baztertzen. Normalean esportazioko truke-tasaren gelaxka zenbakia ez delako, negatiboa delako edo zero delako gertatzen da. Deskargatu berriro Trading Account Statement osoa Revolut aplikaziotik, mugimendu horiek sar daitezen.",
};

export default eu;
