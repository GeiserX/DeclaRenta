// BETA: Traducció automàtica, pendent de revisió per parlant natiu
/** Català */
import type { TranslationKeys } from "./es.js";

const ca: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker estranger → Renda espanyola",

  "upload.title": "Puja el teu informe del broker",
  "upload.broker_question": "Quin(s) broker(s) fas servir?",
  "upload.broker_hint": "Selecciona un o diversos. Et guiarem pas a pas.",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrossega el teu fitxer aquí o fes clic per seleccionar",
  "upload.formats_help":
    "Formats: XML (IBKR Flex), CSV (Degiro, Flatex, Trade Republic, Scalable, Lightyear, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro, Revolut)",
  "upload.autodetect_note": "El broker es detecta automàticament en la majoria dels casos.",
  "upload.detecting": "Analitzant fitxer...",
  "upload.detected": "Broker detectat:",
  "upload.detection_failed": "No s'ha pogut detectar el broker. Selecciona'l manualment.",
  "upload.broker_not_detected": "No s'ha detectat el teu broker?",
  "upload.guide_how": "Com descarregar el meu informe del broker?",
  "upload.guide_select_broker": "Selecciona el teu broker:",
  "upload.choose_broker": "— tria broker —",
  "upload.guide_unavailable": "Guia no disponible encara per a aquest broker.",
  "upload.chip_group_label": "Selecció manual de broker",

  "config.title": "Configura",
  "config.process_btn": "Processar",
  "config.processing": "Processant...",

  "results.title": "Resultats per al Model 100",
  "results.operations": "Operacions",
  "results.dividends": "Dividends",
  "results.no_dividends": "Sense dividends",
  "results.search_placeholder": "Cercar per ISIN o símbol...",
  "results.search_placeholder_brokers": "Cercar per ISIN, símbol o broker...",
  "results.filter_all": "Totes",
  "results.filter_gains": "Guanys",
  "results.filter_losses": "Pèrdues",
  "results.export_json": "Exportar JSON",
  "results.export_csv": "Exportar CSV",
  "results.export_csv_title": "Separador «,» i decimals amb punt: per a programes i fulls de càlcul en anglès",
  "results.export_csv_excel": "Exportar CSV per a Excel (ES)",
  "results.export_csv_excel_title": "Separador «;» i decimals amb coma: s'obre per columnes amb doble clic a l'Excel en espanyol",
  "results.export_pdf": "Exportar PDF",
  "results.operations_count": "{{count}} operació(ns)",
  "results.dividends_count": "{{count}} dividend(s)",
  "results.newer_years_notice": "Es mostra {{year}}; les teves dades també cobreixen {{years}}.",
  "results.year_mismatch":
    "El fitxer conté dades dels exercicis {{available}}, però l'exercici seleccionat és {{year}}. Selecciona un altre any al desplegable superior.",
  "results.setting_yes": "sí",
  "results.setting_no": "no",

  "table.isin": "ISIN",
  "table.symbol": "Símbol",
  "table.buy_date": "D. Compra",
  "table.sell_date": "D. Venda",
  "table.buy_broker": "Broker compra",
  "table.sell_broker": "Broker venda",
  "table.units": "Uds.",
  "table.cost_eur": "Cost EUR",
  "table.proceeds_eur": "Venda EUR",
  "table.gain_loss_eur": "G/P EUR",
  "table.days": "Dies",
  "table.date": "Data",
  "table.gross_eur": "Brut EUR",
  "table.withholding_eur": "Retenció EUR",
  "table.country": "País",
  "table.payments": "Pagaments",
  "casilla.dividends_by_issuer": "Dividends per emissor",
  "casilla.dividends_per_payment": "Pagaments individuals",
  "casilla.dividends_withholding_note": "La retenció <strong>estrangera</strong> no es declara aquí: en el formulari «Alta Capital mobiliario» de Renta Web, deixa-la a 0 i dedueix-la a la casella 0588 (doble imposició internacional, Art. 80 LIRPF). Però la retenció <strong>espanyola</strong> sobre emissors espanyols (ISIN ES…) sí és un pagament a compte i va a la casella 0597.",
  "table.casilla": "Casella",
  "table.concept": "Concepte",
  "table.amount_eur": "Import (EUR)",
  "table.currency": "Divisa",
  "table.fx_origin": "Origen",
  "table.fx_lot": "Lot FIFO",
  "fx.trigger.conversion": "Conversió de divisa",
  "fx.trigger.dividend": "Dividend",
  "fx.trigger.interest": "Interessos",
  "fx.trigger.commission": "Comissió",
  "fx.trigger.stock_purchase": "Compra de valors",
  "fx.trigger.stock_sale": "Divisa perduda en una venda amb pèrdues",
  "fx.trigger.stock_sale_guard": "Variació de la divisa fins a la compra de les accions",
  "fx.trigger.stock_sale_cross": "Divisa invertida en accions venudes en una altra moneda",
  "fx.trigger.loan_repayment": "Devolució d'un préstec en divisa del bróker",

  "casilla.listed_transmission_value": "Valor de transmissió (accions negociades)",
  "casilla.listed_acquisition_value": "Valor d'adquisició (accions negociades)",
  "casilla.acquisition_sale_rate_note":
    "El valor d'adquisició es mostra al tipus de canvi del BCE de la data de VENDA, de manera que transmissió − adquisició coincideix exactament amb el guany o la pèrdua (DGT V2422-20: el guany es calcula en la moneda de l'acció i només la diferència es converteix a euros). En valors en moneda estrangera aquest import difereix del cost històric en euros de la data de compra i pot no coincidir amb xifres desades en versions anteriors.",
  "casilla.other_transmission_value": "Valor de transmissió (altres elements: opcions/cripto/fons/divisa)",
  "casilla.other_acquisition_value": "Valor d'adquisició (altres elements: opcions/cripto/fons/divisa)",
  "casilla.fx_transmission_value": "Valor de transmissió FX (moneda estrangera)",
  "casilla.fx_acquisition_value": "Valor d'adquisició FX (moneda estrangera)",
  "casilla.fx_cost_split": "{{fx}} € de cost de la divisa i {{shift}} € de variació ja declarada en l'acció",
  "casilla.fx_net_gain_loss": "Guany/Pèrdua net FX (moneda estrangera)",
  "casilla.net_gain_loss": "Guany/Pèrdua net (transmissions)",
  "casilla.gross_dividends": "Dividends bruts",
  "casilla.interest_earned": "Interessos guanyats",
  "casilla.interest_paid": "Interessos pagats al broker (marge, no deduïble — informatiu)",
  "casilla.general_gains": "Guanys patrimonials no derivats de transmissió (airdrops, comissions de referits)",
  "casilla.spanish_withholding": "Retencions del capital mobiliari (casella 0597)",
  "casilla.spanish_withholding_detail":
    "Retenció a compte de l'IRPF practicada en origen sobre dividends o interessos d'emissors espanyols (p. ex. accions de l'IBEX), encara que estiguin en un bróker estranger. És un pagament a compte deduïble de la quota; NO és la deducció per doble imposició (casella 0588), que només s'aplica a impost estranger.",
  "casilla.double_taxation": "Deducció doble imposició",
  "casilla.dt_foreign_income_total": "Total rendiments estrangers",
  "casilla.reintegrated_losses":
    "Pèrdues diferides que ara s'integren (accions venudes sense recompra en el seu termini, «transmissió definitiva»; en cripto, venda de les unitats recomprades): {{amount}} EUR",
  "casilla.blocked_losses":
    "Pèrdues bloquejades per regla anti-churning (2 mesos en mercat regulat o equivalent / 1 any la resta; en cripto, l'any següent a la venda): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} advertència(es)",
  "messages.errors_title": "{{count}} error(s) — requereix atenció",
  "messages.warnings_title": "{{count}} avís(os) — revisa",
  "messages.info_title": "{{count}} nota/es informativa/es",
  "pdf.severity_error": "Error",
  "pdf.severity_warning": "Avís",
  "pdf.severity_info": "Nota",
  "pdf.section_messages": "Missatges",

  "chart.asset_distribution": "Distribució per tipus d'actiu",
  "chart.monthly_gl": "Guany/Pèrdua per mes",
  "chart.currency_composition": "Composició per divisa",
  "chart.withholdings_country": "Retencions per país",
  "chart.month_1": "Gen",
  "chart.month_2": "Febr",
  "chart.month_3": "Març",
  "chart.month_4": "Abr",
  "chart.month_5": "Maig",
  "chart.month_6": "Juny",
  "chart.month_7": "Jul",
  "chart.month_8": "Ag",
  "chart.month_9": "Set",
  "chart.month_10": "Oct",
  "chart.month_11": "Nov",
  "chart.month_12": "Des",
  "asset.stk": "Accions",
  "asset.fund": "Fons / ETF",
  "asset.opt": "Opcions",
  "asset.fop": "Opcions sobre futurs",
  "asset.crypto": "Criptomonedes",
  "asset.bond": "Bons",
  "option.expiration": "Venciment",
  "option.close": "Tancament anticipat",
  "option.exercise": "Exercici/Assignació",

  "footer.docs": "Documentació",
  "footer.privacy": "Self-hosted · Privacitat total",
  "footer.disclaimer": "Avís legal",

  "disclaimer.title": "Avís legal",
  "disclaimer.text":
    "Aquesta eina és merament informativa i no constitueix assessorament fiscal ni jurídic. Els resultats generats han de ser verificats per l'usuari i/o un professional qualificat abans de ser utilitzats en qualsevol declaració tributària.\n\nDeclaRenta no es responsabilitza d'errors, omissions ni de les conseqüències derivades de l'ús d'aquesta informació. L'usuari és l'únic responsable de la veracitat i exactitud de les dades introduïdes i de les declaracions presentades davant l'Agència Tributària.\n\nEls tipus de canvi procedeixen del Banc Central Europeu (BCE). Els càlculs fiscals es basen en la normativa vigent (LIRPF, Llei del Patrimoni, Ordre EHA/3290/2008) però poden no cobrir tots els supòsits ni reflectir canvis normatius posteriors a l'última actualització del programari.",
  "disclaimer.accept": "Entès",

  "a11y.skip_link": "Saltar al contingut",
  "a11y.nav_label": "Ajustos",
  "a11y.lang_label": "Idioma",
  "a11y.theme_toggle": "Canviar tema",
  "a11y.drop_zone": "Zona de càrrega de fitxers",
  "a11y.file_input": "Seleccionar fitxers",
  "a11y.ops_search": "Cercar operacions per ISIN o símbol",
  "a11y.ops_search_brokers": "Cercar operacions per ISIN, símbol o broker",
  "a11y.ops_filter": "Filtrar operacions per resultat",
  "a11y.remove_file": "Treure {{name}}",

  "theme.toggle": "Canviar tema",

  // Wizard steps
  "wizard.step1": "Pujar fitxers",
  "wizard.step2": "Revisar i triar mètode",
  "wizard.step3": "Resultats",
  "wizard.next": "Següent",
  "wizard.back": "Enrere",

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
  "casilla.copy": "Copiar import",
  "casilla.copied": "Copiat!",

  // Year comparison
  "compare.title": "Comparativa anual",
  "compare.no_data": "Processa almenys 2 exercicis per veure la comparativa.",
  "compare.year": "Exercici",
  "compare.variation": "Variació",
  "compare.saved_reports": "Informes desats",
  "compare.clear_history": "Esborrar historial",
  "compare.clear_confirm": "Esborrar tots els informes desats?",
  "compare.transmission_value": "Valor de transmissió (transmissions, sense divises)",
  "compare.acquisition_value": "Valor d'adquisició (transmissions, sense divises)",
  "compare.net_gain_loss": "Guany/Pèrdua net (transmissions, sense divises)",

  "error.no_broker_detected":
    'No s\'ha pogut detectar el broker de "{{filename}}". Si és un informe de broker, selecciona el broker manualment; si no ho és, treu-lo de la llista.',
  "error.empty_file":
    'El fitxer "{{filename}}" és buit. Treu-lo de la llista o torna\'l a exportar des del teu broker.',
  "error.file_too_large":
    'El fitxer "{{filename}}" supera el límit de {{limit}} MB i s\'ha descartat. Exporta un període més curt o divideix el fitxer.',
  "error.prefix": "Error: ",

  "status.fetching_rates": "Obtenint tipus BCE per a {{currencies}}...",
  "status.files_processed": "{{count}} fitxer(s) processat(s) — {{brokers}} — {{trades}} operacions",

  "sidebar.profile": "Perfil fiscal",
  "sidebar.renta": "Model 100 (Renda)",
  "sidebar.m720": "Model 720",
  "sidebar.m721": "Model 721",
  "sidebar.d6": "Model D-6",
  "sidebar.toggle": "Obrir/tancar menú",

  "profile.title": "Perfil fiscal",
  "profile.description": "Aquestes dades s'utilitzen per generar els fitxers dels models 720 i D-6. Només es desen en aquest navegador, mai en un servidor.",
  "profile.section_personal": "Dades personals",
  "profile.nif_label": "NIF/NIE:",
  "profile.nif_placeholder": "12345678Z",
  "profile.nif_invalid": "El NIF/NIE no és vàlid: revisa els dígits i la lletra de control.",
  "profile.surname_label": "Cognoms:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Nom:",
  "profile.name_placeholder": "Joan",
  "profile.ccaa_label": "Comunitat Autònoma:",
  "profile.phone_label": "Telèfon:",
  "profile.phone_placeholder": "600123456",
  "review.autoconvert_label": "Processar les autoconversions del bróker (AFx/FXCONV)",
  "review.autoconvert_detail":
    "Activat per defecte. Interactive Brokers no reconverteix a euros en vendre una acció, així que el saldo en divisa és real i convertir-lo després genera un guany o pèrdua patrimonial (art. 33.1 LIRPF). Desactiva-ho només si el teu bróker fa un round-trip complet EUR↔divisa i vols ignorar l'efecte de la divisa.",
  "review.titulares_label": "Nombre de titulars:",
  "review.titulares_detail":
    "Si el compte té diversos titulars (p. ex. compte conjunt o de guanys), DeclaRenta divideix tots els imports a parts iguals per mostrar la part que correspon a cada contribuent (Art. 11.3 LIRPF). Cada titular presenta la seva declaració individual per la seva part.",
  "profile.saved": "Perfil desat",
  "profile.clear_btn": "Esborrar les meves dades d'aquest navegador",
  "profile.clear_confirm": "Vols esborrar d'aquest navegador el teu perfil fiscal, els informes desats i els valors introduïts a mà?",
  "profile.incomplete_banner": "Completa el teu perfil fiscal per generar els models 720 i D-6.",
  "profile.go_to_profile": "Anar al perfil",

  // FX method (#434): review step, results header, comparison
  "method.multidivisa.sub": "El guany es calcula en la divisa de l'acció",
  "method.multidivisa.text": "Calcula el guany de cada acció en la seva divisa i el passa a euros al tipus del dia de la venda. La divisa que tens guarda el que et va costar en euros. La seva diferència de canvi surt quan la canvies a euros o a una altra divisa.",
  "method.multidivisa.basis": "Base legal: criteri d'Hisenda per a accions (DGT V1740-17, V2422-20, V0282-22).",
  "method.tradicional_divisa.sub": "Compra i venda al seu tipus, i la teva divisa per FIFO",
  "method.tradicional_divisa.text": "Les accions es valoren al tipus del BCE del dia de compra i del dia de venda. La divisa tributa només quan surt del teu compte: quan la canvies a euros o a una altra divisa, quan pagues comissions o quan la perds en una venda amb pèrdues. El que ja vas declarar dins de les accions no es torna a comptar.",
  "method.tradicional_divisa.basis": "Valoració d'accions: criteri de la DGT per a participacions de fons en divisa (V2324-10, V0775-21), aplicat a accions. Divisa: es declara quan la canvies (V2466-08) o quan la perds en una venda amb pèrdues (V0775-21, V2324-10).",
  "method.tradicional_divisa.risk": "Hisenda aplica a les accions el «Criteri DGT (multidivisa)» (V1740-17). El 2025 va rebutjar aquest mateix càlcul per a un pis comprat i venut en dòlars (V1615-25). Si revisa la teva declaració, la pot recalcular amb aquest criteri. Sense vendes amb pèrdues, el total d'un cicle complet sol ser gairebé el mateix; canvia en quin any i en quina casella surt cada part.",
  "method.monodivisa.sub": "Només compra i venda al seu tipus",
  "method.monodivisa.text": "Valora la compra al tipus del dia de compra i la venda al del dia de venda. No calcula cap resultat de divisa, ni en els teus canvis a euros ni en els automàtics del bróker.",
  "method.monodivisa.basis": "Base legal: art. 35.1 LIRPF, sense la divisa de l'art. 14.2.e. Si canvies divisa a euros, pot distorsionar el resultat.",
  "method.monodivisa.risk": "Aquest mètode no declara el resultat dels teus canvis de divisa a euros. Fes-lo servir només si no canvies divisa.",
  "method.unknown": "desconegut",
  "review.method_title": "Com calculem les teves accions en divisa?",
  "review.method_lead": "Tens operacions en {{currencies}}. El mètode canvia les xifres de la teva renda. Tria'n un i mantén-lo tots els anys.",
  "review.method_recommended": "Recomanat",
  "review.method_last_year": "El {{year}} vas calcular amb «{{method}}».",
  "review.method_last_year_switch": "El {{year}} vas calcular amb «{{method}}». Si canvies de mètode i encara tens divisa d'aleshores, part del resultat pot sortir dues vegades o perdre's. Fes servir el mateix mètode tots els anys.",
  "review.other_settings": "Altres ajustos del càlcul",
  "review.autoconvert_off_mono": "No s'aplica amb «Tradicional sense divisa (monodivisa)», perquè aquest mètode no calcula divisa.",
  "review.calculate": "Calcular",
  "review.calculate_with": "Calcular amb «{{method}}»",
  "review.show_details": "Veure el detall",
  "results.method_chip": "Mètode: {{method}}",
  "results.method_change": "Canviar",
  "results.method_change_aria": "Canviar el mètode de càlcul",
  "results.titulares_one": "1 titular",
  "results.titulares_many": "{{count}} titulars",
  "results.autoconvert_chip": "Autoconversions: {{value}}",
  "results.how_title": "Com s'ha calculat",
  "results.split_shares": "Accions",
  "results.split_shares_sub": "caselles 0328 i 0331",
  "results.split_securities": "Accions i altres valors",
  "results.split_securities_sub": "caselles 0328 i 0331, i part de 1633 i 1637",
  "results.split_fx": "Divisa",
  "results.split_fx_sub": "inclosa a 1633 i 1637",
  "results.split_fx_off": "no es calcula amb aquest mètode",
  "results.split_total": "Total",
  "results.split_total_sub": "a la base de l'estalvi · quota estimada {{tax}} €",
  "results.compare_title": "Comparar amb els altres mètodes (per quadrar amb una altra eina)",
  "results.compare_in_use": "En ús",
  "results.compare_tax": "Quota estimada",
  "results.compare_note": "Només informatiu. Per canviar de mètode, torna a «Revisar i triar mètode».",
  "results.compare_loading": "Calculant…",
  "results.compare_error": "No s'ha pogut calcular la comparació.",
  "casilla.acquisition_buy_rate_note_fx": "El valor d'adquisició es mostra al tipus de canvi del BCE de la data de COMPRA, com demana el mètode «Tradicional amb divisa». Transmissió − adquisició és el guany o la pèrdua de l'acció en euros. El resultat de la divisa va a part, a les caselles 1633 i 1637.",
  "casilla.acquisition_buy_rate_note_mono": "El valor d'adquisició es mostra al tipus de canvi del BCE de la data de COMPRA, com demana el mètode «Tradicional sense divisa (monodivisa)». Transmissió − adquisició és el guany o la pèrdua de l'acció en euros. Aquest mètode no calcula cap resultat de divisa.",
  "casilla.no_other_elements_fx_below": "Sense altres elements. El resultat de divisa és a sota.",
  "compare.method": "Mètode",
  "compare.method_mismatch": "Aquests anys fan servir mètodes diferents. Si canvies de mètode i encara tens divisa d'un any anterior, part del resultat pot sortir dues vegades o perdre's.",
  "profile.autosave": "Els canvis es desen sols en aquest navegador.",
  "profile.method_moved": "El mètode de divisa, els titulars i les autoconversions es trien ara al Model 100, al pas «Revisar i triar mètode».",
  "profile.go_to_renta": "Anar al Model 100",

  "guide.title": "Com obtenir l'informe?",
  "guide.tip_fifo": "Inclou tot l'històric — DeclaRenta necessita operacions anteriors per al càlcul FIFO correcte.",
  "guide.select_broker_hint": "Selecciona el teu broker per veure les instruccions de descàrrega de l'informe.",
  "guide.heading": "Com obtenir l'informe del teu broker?",
  "guide.ibkr.title": "Interactive Brokers (Flex Query XML)",
  "guide.ibkr.step1": "Inicia sessió al <strong>Portal del Client</strong> d'IBKR",
  "guide.ibkr.step2": "Ves a <strong>Rendiment i informes</strong> → pestanya <strong>Consultes Flex</strong>",
  "guide.ibkr.step3":
    "A <strong>Consulta flex d'activitat</strong>, fes clic al <strong>+</strong> per crear una nova consulta",
  "guide.ibkr.step4":
    "A la configuració, activa les seccions:<ul><li><strong>Trades</strong> (obligatori)</li><li><strong>Cash Transactions</strong> — dividends i retencions (obligatori)</li><li><strong>Open Positions</strong> — per al Model 720/D-6 (recomanat)</li><li><strong>Financial Instrument Information</strong> (recomanat)</li></ul>",
  "guide.ibkr.step5":
    "A cada secció, <strong>selecciona tots els camps disponibles</strong> (marca totes les caselles). Com més dades incloguis, més precís serà el càlcul. Com a mínim, assegura't d'incloure el camp <strong>Notes</strong> a Trades — és necessari per detectar conversions automàtiques de divisa.",
  "guide.ibkr.step6": "Format de sortida: <strong>XML</strong>. A <em>Date Format</em>, deixa <strong>yyyyMMdd</strong>",
  "guide.ibkr.step7": "Inclou <strong>tots els anys disponibles</strong> per al càlcul FIFO correcte",
  "guide.ibkr.step8": "Desa la consulta, executa-la i descarrega el fitxer <code>.xml</code>",
  "guide.degiro.title": "Degiro (CSV)",
  "guide.degiro.step1": "Inicia sessió al <strong>web de Degiro</strong> (no l'app)",
  "guide.degiro.step2": "Obre el panell lateral <strong>Bústia</strong> (icona de sobre)",
  "guide.degiro.step3": "Fes clic a <strong>Transaccions</strong> (historial de transaccions dels teus productes)",
  "guide.degiro.step4": "Selecciona el rang de dates desitjat (inclou <strong>tot l'històric</strong> per al FIFO)",
  "guide.degiro.step5": "Fes clic a <strong>Exportar</strong> i descarrega el fitxer CSV",
  "guide.degiro.step6":
    "Per a dividends: torna a la <strong>B\u00fastia</strong> \u2192 <strong>Compte</strong> (historial de moviments del teu compte) \u2192 mateix rang de dates \u2192 <strong>Exportar</strong> CSV",
  "guide.flatex.title": "Flatex (CSV)",
  "guide.flatex.step1": "Inicia sessi\u00f3 a la <strong>web de Flatex</strong>",
  "guide.flatex.step2":
    "Ves a <strong>Moviments</strong> \u2192 <strong>Depotums\u00e4tze</strong> (moviments de la cartera)",
  "guide.flatex.step3":
    "Selecciona <strong>tot l'hist\u00f2ric</strong> (necessari per al c\u00e0lcul FIFO) i exporta el fitxer CSV",
  "guide.flatex.step4":
    "Per a dividends: ves a <strong>Kontoums\u00e4tze</strong> (moviments del compte), mateix rang de dates, i exporta el CSV. Compte: allà els dividends apareixen per l'import net, ja descomptada la retenció; pren l'import íntegre i la retenció del justificant en PDF de cada dividend",
  "guide.flatex.step5":
    "Puja <strong>els dos fitxers</strong> CSV (Depotums\u00e4tze per a operacions i Kontoums\u00e4tze per a dividends)",
  "guide.etoro.title": "eToro (XLSX)",
  "guide.etoro.step1": "Inicia sessió a <strong>eToro</strong>",
  "guide.etoro.step2": "Ves a <strong>Configuració → Extracte de compte</strong>",
  "guide.etoro.step3": "Selecciona el període de l'exercici fiscal",
  "guide.etoro.step4": "Descarrega el fitxer <strong>XLSX</strong> (Excel)",
  "guide.scalable.title": "Scalable Capital (CSV)",
  "guide.scalable.step1": "Inicia sessió a <strong>Scalable Capital</strong>",
  "guide.scalable.step2": "Ves a <strong>Perfil → Documents fiscals</strong>",
  "guide.scalable.step3": "Descarrega l'informe de transaccions en format <strong>CSV</strong>",
  "guide.freedom24.title": "Freedom24 (JSON)",
  "guide.freedom24.step1": "Inicia sessió a la <strong>plataforma web de Freedom24</strong>",
  "guide.freedom24.step2": "Ves a <strong>Informes → Informe d'operacions</strong>",
  "guide.freedom24.step3": "Selecciona el període i format <strong>JSON</strong>",
  "guide.freedom24.step4": "Descarrega el fitxer",
  "guide.coinbase.title": "Coinbase (CSV)",
  "guide.coinbase.step1": "Inicia sessió a <strong>Coinbase</strong>",
  "guide.coinbase.step2": "Ves a <strong>Impostos → Documents</strong>",
  "guide.coinbase.step3": "Fes clic a <strong>Generar informe</strong>",
  "guide.coinbase.step4": "Descarrega l'historial de transaccions en format CSV",
  "guide.binance.title": "Binance (CSV)",
  "guide.binance.step1": "Inicia sessió a <strong>Binance</strong>",
  "guide.binance.step2":
    "<strong>Historial d'operacions spot:</strong> Comandes → Ordre spot → Exportar historial d'operacions (↑) → Spot - Historial d'Operacions → Personalitzar temps (UTC+1) → CSV",
  "guide.binance.step3":
    "<strong>Historial de transaccions:</strong> Comandes → Historial d'Actius → Exportar registres de transaccions (↑) → Historial de Transaccions → Personalitzar temps (UTC+1) → CSV",
  "guide.binance.step4": "Pots pujar un o ambdós fitxers — s'accepten tant en castellà/català com en anglès",
  "guide.kraken.title": "Kraken (CSV)",
  "guide.kraken.step1": "Inicia sessió a <strong>Kraken</strong>",
  "guide.kraken.step2": "Ves a <strong>History → Export</strong>",
  "guide.kraken.step3": "Selecciona <strong>Trades</strong> i el rang de dates",
  "guide.kraken.step4": "Format: <strong>CSV</strong>, descarrega el fitxer",

  // Trade Republic
  "guide.trade_republic.title": "Trade Republic (CSV)",
  "guide.trade_republic.step1": "Obre l'app de <strong>Trade Republic</strong>",
  "guide.trade_republic.step2": "Ves a <strong>Perfil → Activitat</strong>",
  "guide.trade_republic.step3": "Toca els tres punts (⋯) i selecciona <strong>Exportar</strong>",
  "guide.trade_republic.step4": "Selecciona el rang de dates i format <strong>CSV</strong>",
  "guide.trade_republic.step5": "Descarrega el fitxer i envia'l al teu ordinador",

  // Revolut
  "guide.revolut.title": "Revolut (XLSX)",
  "guide.revolut.step1": "Inicia sessió a la <strong>web de Revolut</strong> (app.revolut.com o app mòbil)",
  "guide.revolut.step2": "Ves a <strong>Trading/Cripto → Extractes</strong>",
  "guide.revolut.step3": "Selecciona <strong>Trading Account Statement</strong> de l'exercici fiscal",
  "guide.revolut.step4": "Descarrega en format <strong>XLSX</strong> (Excel)",

  // Trading 212
  "guide.trading212.title": "Trading 212 (CSV)",
  "guide.trading212.step1": "Inicia sessió a la <strong>web de Trading 212</strong>",
  "guide.trading212.step2": "Ves a <strong>Historial → Transaccions</strong>",
  "guide.trading212.step3": "Filtra pel rang de dates desitjat",
  "guide.trading212.step4": "Fes clic a <strong>Descarregar CSV</strong>",

  // Lightyear
  "guide.lightyear.title": "Lightyear (CSV)",
  "guide.lightyear.step1": "Obre l'app de <strong>Lightyear</strong>",
  "guide.lightyear.step2": "Ves a <strong>Perfil → Informes</strong>",
  "guide.lightyear.step3": "Selecciona <strong>Transaction report</strong> i el període",
  "guide.lightyear.step4": "Descarrega el fitxer CSV i envia'l al teu ordinador",

  // MEXEM
  "guide.mexem.title": "MEXEM (Flex Query XML)",
  "guide.mexem.step1": "Inicia sessió al <strong>Portal del Client</strong> de MEXEM (mateixa interfície que IBKR)",
  "guide.mexem.step2": "Ves a <strong>Rendiment i informes</strong> → pestanya <strong>Consultes Flex</strong>",
  "guide.mexem.step3":
    "Crea una <strong>Activity Flex Query</strong> incloent Trades, Cash Transactions i Open Positions",
  "guide.mexem.step4": "Format de sortida: <strong>XML</strong>",
  "guide.mexem.step5": "Executa la consulta i descarrega el fitxer <code>.xml</code>",

  // Swissquote
  "guide.swissquote.title": "Swissquote (CSV)",
  "guide.swissquote.step1": "Inicia sessió a <strong>Swissquote eBanking</strong>",
  "guide.swissquote.step2": "Ves a <strong>Trading → Historial de transaccions</strong>",
  "guide.swissquote.step3": "Selecciona el rang de dates de l'exercici fiscal",
  "guide.swissquote.step4": "Fes clic a <strong>Exportar → CSV</strong>",

  "m720.title": "Model 720 — Béns a l'estranger",
  "m720.description": "Declaració informativa sobre béns i drets situats a l'estranger.",
  "m720.threshold_exceeded": "Segons les teves posicions ({{amount}} €), estàs obligat a presentar el Model 720.",
  "m720.obliged_by_changes": "Estàs obligat a presentar el Model 720 pels canvis des de la teva última declaració: cada categoria de dalt n'indica el motiu.",
  "m720.declared_account_missing": "Un compte que vas declarar no té saldo aquest any ({{accounts}}): si el vas cancel·lar, has de declarar-ne la cancel·lació a mà (art. 42 bis.5 RGAT).",
  "m720.threshold_not_exceeded":
    "No superes el llindar de 50.000 € (total: {{amount}} €). No estàs obligat a presentar.",
  "m720.category_v": "Valors (accions, fons, bons)",
  "m720.category_c": "Comptes (saldos en efectiu)",
  "m720.category_exceeded": "Supera 50.000 € — obligatori declarar",
  "m720.category_not_exceeded": "Per sota del llindar",
  "m720.category_undetermined": "No es pot determinar: {{count}} posició(ns) sense valorar",
  "m720.no_positions": "Puja un informe amb posicions obertes al Model 100 per analitzar el Model 720.",
  "m720.brokers_without_holdings": "Les dades de {{brokers}} que has pujat no inclouen les teves posicions ni saldos a 31 de desembre, així que no se sumen aquí. Comprova a l'extracte de final d'any de {{brokers}} si el saldo dels teus comptes o el valor de les teves accions i fons a l'estranger supera els 50.000 €.",
  "m720.positions_title": "Posicions declarables",
  "m720.positions_unvalued":
    "{{count}} posició(ns) no s'han pogut valorar en euros (sense preu de mercat o sense tipus de canvi per a la seva moneda al tancament de l'exercici) i s'han exclòs del total. Calcula el seu valor en euros i inclou-les manualment.",
  "m720.cash_title": "Saldos en efectiu (Comptes)",
  "m720.q4_average": "Mitjana Q4",
  "m720.cash_missing_average":
    "Alguns saldos no inclouen la mitjana del quart trimestre obligatòria per als comptes del Model 720. El seu saldo a 31 de desembre sí que compta per al llindar de 50.000 €, però aquests comptes no s'inclouen al fitxer generat: afegeix-los a mà, amb el seu saldo mitjà del quart trimestre, abans de presentar.",
  "m720.omitted_title":
    "Aquests béns no caben al fitxer i els has de declarar a mà al formulari del Model 720:",
  "m720.omitted_no_isin":
    "no té ISIN; al formulari s'identifica amb «Z» més el codi del país de l'emissor",
  "m720.omitted_no_country":
    "falta el país on està dipositat o situat",
  "m720.omitted_no_account":
    "falta el número de compte",
  "m720.omitted_invalid_code":
    "venut aquest any; el Model 720 anterior el va declarar amb una clau o un país que el fitxer no admet",
  "m720.not_generated_left_out":
    "No s'ha generat cap fitxer: res del que has de declarar no es pot escriure al fitxer. Declara-ho a mà al formulari del Model 720, seguint els avisos de dalt.",
  "m720.successive_years_note":
    "Si ja vas presentar el Model 720 en un any anterior, només és obligatori tornar-lo a presentar quan el valor conjunt d'una categoria ha augmentat més de 20.000 € respecte de l'última declaració, o quan has venut o cancel·lat un bé que vas declarar (arts. 42 bis.5 i 42 ter.5 del RD 1065/2007). Si no, presentar-lo és opcional.",
  "m720.previous_title": "El teu últim Model 720",
  "m720.previous_help": "Si ja vas presentar el Model 720, puja el fitxer .txt de la teva última declaració. El que ja vas declarar sortirà amb origen M, el que has venut amb origen C (baixa) i s'aplicarà la regla dels 20.000 €. El fitxer es llegeix al teu navegador i no es desa.",
  "m720.previous_loaded": "Carregat {{name}} (exercici {{year}}): {{securities}} valors i {{accounts}} comptes declarats.",
  "m720.previous_clear": "Treure",
  "m720.previous_invalid": "Aquest fitxer no és un Model 720: no té cap registre de detall.",
  "m720.previous_same_year": "Aquest fitxer és de l'exercici {{fileYear}}. Puja el Model 720 d'un exercici anterior a {{year}}.",
  "m720.origin": "Origen",
  "m720.origin_a": "A (alta)",
  "m720.origin_m": "M (ja declarat)",
  "m720.successive_last": "Última declaració: {{previous}} €. Variació: {{change}} €.",
  "m720.successive_increase": "Ha augmentat més de 20.000 €: és obligatori tornar a declarar",
  "m720.successive_sold": "Has venut valors que vas declarar: és obligatori declarar-ne les baixes",
  "m720.successive_optional": "No ha augmentat més de 20.000 €: tornar-la a declarar és opcional",
  "m720.successive_not_required": "Amb el teu últim Model 720, aquest any no estàs obligat a presentar-lo: cap categoria ha augmentat més de 20.000 € i no has venut res del que vas declarar. Pots presentar-lo si vols.",
  "m720.sold_title": "Baixes: valors venuts des del teu últim Model 720",
  "m720.sold_help": "El fitxer els inclou amb origen C, amb la data i l'import de l'última venda.",
  "m720.sold_no_date": "no hi ha cap venda el {{year}} de les accions declarades: la baixa surt sense data d'extinció i amb valoració 0; completa-la abans de presentar",
  "m720.sold_no_acquisition": "les dades no n'inclouen la compra: la baixa surt sense data d'adquisició; completa-la abans de presentar",
  "m720.generate_btn": "Generar fitxer Model 720",
  "m720.deadline": "Termini: 1 gener – 31 març de l'any següent",
  "m720.total_value": "Valor total: {{amount}} €",
  "m720.filing_title": "Com presentar-lo?",
  "m720.rates_title": "Tipus de canvi aplicats (BCE)",
  "m720.deadline_short": "Termini: 1 gener – 31 març",
  "m720.filing_step1": "Accedeix a la Seu Electrònica de l'AEAT",
  "m720.filing_step2": "Cerca «Modelo 720»",
  "m720.filing_step3": "Importa el fitxer generat (TGVI Online)",
  "m720.filing_step4": "Revisa i signa amb certificat digital o Cl@ve",

  "d6.title": "Model D-6 — Inversions a l'exterior",
  "d6.description": "Declaració al Registre d'Inversions del Ministeri d'Economia.",
  "d6.no_minimum":
    "Des de l'Orden ICT/1408/2021, el D-6 només és obligatori si la teva participació representa el <strong>10% o més</strong> del capital o drets de vot d'una empresa cotitzada estrangera. La majoria d'inversors minoristes estan exempts.",
  "d6.no_positions": "Puja un informe amb posicions obertes al Model 100 per analitzar el D-6.",
  "d6.brokers_without_holdings": "Les dades de {{brokers}} que has pujat no inclouen els teus valors a 31 de desembre, així que no apareixen aquí. Consulta'ls a l'extracte de final d'any de {{brokers}}.",
  "d6.positions_title": "Posicions a declarar",
  "d6.positions_unvalued":
    "{{count}} posició(ns) no s'han pogut valorar en euros (sense preu de mercat o sense tipus de canvi per a la seva moneda al tancament de l'exercici) i s'han exclòs del total. Calcula el seu valor en euros i inclou-les manualment.",
  "d6.cancellations_title": "Cancel·lacions",
  "d6.generate_btn": "Generar guia D-6",
  "d6.deadline": "Termini: 1 – 31 gener de l'any següent",
  "d6.total_value": "Valor total: {{amount}} €",
  "d6.aforix_title": "Guia AFORIX pas a pas",
  "d6.copy_btn": "Copiar",
  "d6.copied": "Copiat",
  "d6.rates_title": "Tipus de canvi aplicats (BCE)",
  "d6.deadline_short": "Termini: 1 – 31 gener",
  "d6.copy_failed": "Error en copiar",
  "d6.aforix_position_of": "Posició {{index}} de {{total}}",

  // Modelo 721 section
  "m721.title": "Model 721 — Criptomonedes a l'estranger",
  "m721.description": "Declaració informativa sobre monedes virtuals situades a l'estranger.",
  "m721.threshold_exceeded": "Segons les teves posicions ({{amount}} €), estàs obligat a presentar el Model 721.",
  "m721.threshold_not_exceeded":
    "No superes el llindar de 50.000 € (total: {{amount}} €). No estàs obligat a presentar.",
  "m721.threshold_undetermined":
    "No es pot determinar si superes el llindar de 50.000 €: el total ({{amount}} €) no inclou {{count}} posició(ns) sense valorar. Valora-les abans de concloure que no has de presentar.",
  "m721.no_positions": "Puja un informe amb posicions de criptomonedes al Model 100 per analitzar el Model 721.",
  "m721.brokers_without_holdings": "Les dades de {{brokers}} que has pujat no inclouen les teves criptomonedes a 31 de desembre, així que no se sumen aquí. Comprova a l'extracte de final d'any de {{brokers}} si les teves criptomonedes a l'estranger superen els 50.000 €.",
  "m721.positions_title": "Posicions declarables",
  "m721.generate_btn": "Generar fitxer Model 721",
  "m721.deadline": "Termini: 1 gener – 31 març de l'any següent",
  "m721.total_value": "Valor total: {{amount}} €",
  "m721.filing_title": "Com presentar-lo?",
  "m721.rates_title": "Tipus de canvi aplicats (BCE)",
  "m721.deadline_short": "Termini: 1 gener – 31 març",
  "m721.filing_step1": "Accedeix a la Seu Electrònica de l'AEAT",
  "m721.filing_step2": "Cerca «Modelo 721»",
  "m721.filing_step3": "Omple la declaració amb les dades de la taula (format oficial: XML, Ordre HFP/886/2023)",
  "m721.filing_step4": "Revisa i signa amb certificat digital o Cl@ve",
  "m721.exchange": "Exchange",
  "m721.format_notice":
    "El format oficial de l'AEAT és XML (Ordre HFP/886/2023). DeclaRenta només mostra una revisió orientativa: la generació oficial està desactivada fins que s'implementi l'XML validat.",
  "m721.positions_unvalued":
    "{{count}} posició(ns) no s'han pogut valorar en euros (sense preu de mercat o sense tipus de canvi per a la seva moneda al tancament de l'exercici) i s'han exclòs del total. Calcula el seu valor en euros i inclou-les manualment.",
  "m721.empty_title": "No hi ha posicions de criptomonedes",
  "m721.empty_description":
    "El Model 721 és una declaració informativa obligatòria si posseeixes criptomonedes en exchanges estrangers valorades en més de 50.000 €. Puja el teu informe del broker a la secció Model 100 perquè DeclaRenta calculi automàticament si superes el llindar. Termini: 1 de gener – 31 de març.",
  "m721.empty_cta": "Anar a Model 100",
  "m721.profile_required": "Completa el teu perfil fiscal abans de generar el fitxer del Model 721.",

  "section.year_label": "Exercici",
  "section.profile_source": 'Dades del <a href="#perfil">Perfil fiscal</a>',
  "section.positions_date_mismatch":
    "Les posicions del teu fitxer són a data {{date}}, no a 31/12/{{year}}. Aquests models declaren el que tenies a 31 de desembre, així que no es genera cap fitxer amb elles. Descarrega un informe que acabi el 31/12/{{year}} (a IBKR, un Flex Query amb data final 31/12/{{year}}) i torna'l a pujar.",
  "section.positions_date_unknown":
    "El teu broker no indica a quina data corresponen les posicions. Comprova que l'informe reflecteixi el que tenies a 31/12/{{year}}: si el vas descarregar més tard, les posicions i els seus valors poden no coincidir.",
  "merge.holdings_other_date":
    "Posicions i saldos del compte {{account}} a data {{date}} fora dels models 720, 721 i D-6: no són els de 31/12/{{year}}.",
  "merge.holdings_other_date.hint":
    "Aquest fitxer acaba en una altra data. Les seves operacions i moviments sí que es tenen en compte, però aquests models declaren el que tenies a 31 de desembre, així que les seves posicions i saldos no se sumen. Si et falta l'informe d'aquest compte a 31/12/{{year}}, puja'l també.",

  "badge.complete": "Complet",
  "badge.pending": "Pendent",
  "badge.not_applicable": "No aplica",
  "badge.generated": "Generat",

  // Empty states
  "m720.empty_title": "No hi ha posicions carregades",
  "m720.empty_description":
    "El Model 720 és una declaració informativa obligatòria si posseeixes béns a l'estranger valorats en més de 50.000 €. Puja el teu informe del broker a la secció Model 100 perquè DeclaRenta calculi automàticament si superes el llindar i generi el fitxer. Termini: 1 de gener – 31 de març.",
  "m720.empty_cta": "Anar a Model 100",
  "d6.empty_title": "No hi ha posicions carregades",
  "d6.empty_description":
    "El Model D-6 declara les teves inversions en valors estrangers davant el Ministeri d'Economia. Des de la reforma de 2021 (Orden ICT/1408/2021), només és obligatori si la teva participació representa el 10% o més del capital o drets de vot d'una empresa cotitzada estrangera. Puja el teu informe del broker a la secció Model 100 i DeclaRenta generarà la guia pas a pas. Termini: 1 – 31 de gener.",
  "d6.empty_cta": "Anar a Model 100",

  // Profile required warnings
  "m720.profile_required": "Completa el teu perfil fiscal abans de generar el fitxer del Model 720.",
  "d6.profile_required": "Completa el teu perfil fiscal abans de generar la guia D-6.",

  // Trust signal
  "footer.open_source": "100% codi obert",
  "footer.verify_source": "Verificar codi font",

  // Splash screen
  "splash.tagline": "Eina fiscal gratu\u00efta per a inversors amb brokers internacionals",
  "splash.feature_free": "100% gratu\u00eft",
  "splash.feature_selfhosted": "Self-hosted",
  "splash.feature_privacy": "Privacitat total",
  "splash.feature_opensource": "Codi obert",
  "splash.cta": "Comen\u00e7ar",

  // Validation
  "validation.future_date": "L'operaci\u00f3 de {{symbol}} t\u00e9 data futura ({{date}}). Verifica les dades.",
  "validation.no_cash_transactions":
    "No s'han trobat transaccions d'efectiu (dividends/retencions). Si fas servir IBKR, activa la secci\u00f3 Cash Transactions a la teva Flex Query.",
  "validation.no_cash_degiro":
    "No s'han trobat dividends ni retencions. Degiro els inclou en un fitxer separat: descarrega tamb\u00e9 el CSV de Compte (Account) des de la B\u00fastia.",
  "validation.no_cash_generic":
    "No s'han trobat transaccions d'efectiu (dividends/retencions). Si el teu broker les exporta per separat, puja-les com a fitxer addicional.",
  "validation.no_trades_in_year":
    "No hi ha operacions a l'exercici {{year}}. Les operacions anteriors s'utilitzen per al c\u00e0lcul FIFO.",
  "validation.very_old_data":
    "Les dades inclouen operacions des de {{year}} (m\u00e9s de 10 anys). Verifica que el fitxer \u00e9s correcte.",
  "validation.duplicate_trades":
    "S'han detectat {{count}} operaci\u00f3(ns) duplicada(es). Revisa si has pujat el mateix fitxer dues vegades.",

  // Operations annex
  "annex.title": "Annex d'operacions (Anexo C1)",
  "annex.subtitle": "Detall individual d'operacions agrupades per tipus d'actiu.",
  "annex.operations": "operaci\u00f3(ns)",
  "annex.wash_blocked": "Pèrdua bloquejada per recompra: {{amount}} EUR (art. 33.5 LIRPF)",
  "annex.wash_dates": "Compres del mateix valor que la bloquegen: {{dates}}",
  "annex.wash_hint":
    "A Renta Web, marca aquesta venda com a «Pèrdues patrimonials no imputables». La pèrdua queda pendent: s'integra, primer les pèrdues més antigues, a mesura que venguis accions d'aquest valor que cap recompra en els 2 mesos anteriors o posteriors (1 any si el valor no cotitza en un mercat regulat de l'Espai Econòmic Europeu ni en un d'equivalent, com NYSE o Nasdaq; en les criptomonedes, només l'any següent a la venda, art. 33.5.e) no cobreix; si en recompres una part, només compten les accions no recomprades. En les criptomonedes, s'integra quan venguis les unitats recomprades, encara que tornis a comprar aquesta criptomoneda (art. 33.5.e); vendre'n altres unitats no la integra.",
  "annex.wash_released": "Allibera {{amount}} EUR de pèrdues diferides d'aquest valor (transmissió definitiva, art. 33.5 LIRPF)",
  "annex.wash_released_dates": "Pèrdues pendents de les vendes del: {{dates}}",
  "annex.wash_released_hint": "Les accions d'aquesta venda que cap recompra en el seu termini no cobreix són una transmissió definitiva: integren ara les pèrdues pendents d'aquest valor, la d'una acció per cada acció, primer les més antigues (si la venda tanca la posició i cap recompra en el seu termini no la cobreix, totes les que quedin). A Renta Web, imputa-les en aquest exercici.",
  "annex.wash_released_crypto": "Allibera {{amount}} EUR de pèrdues diferides d'aquesta criptomoneda (venda de les unitats recomprades, art. 33.5.e LIRPF)",
  "annex.wash_released_hint_crypto":
    "Aquesta venda transmet unitats de la recompra que va bloquejar una pèrdua: integra ara la part d'aquesta pèrdua que correspon a les unitats venudes, encara que tornis a comprar aquesta criptomoneda (art. 33.5.e). Vendre'n altres unitats no la integra. A Renta Web, imputa-la en aquest exercici.",

  // Tax bracket estimation
  "chart.tax_estimate": "Estimaci\u00f3 fiscal (base de l'estalvi)",
  "tax.bracket_range": "Tram",
  "tax.bracket_base": "Base",
  "tax.bracket_rate": "Tipus",
  "tax.bracket_tax": "Quota",
  "tax.total_estimated": "Total estimat",
  "tax.effective_rate": "Tipus efectiu",
  "tax.double_tax_deduction": "Deducci\u00f3 doble imposici\u00f3",
  "tax.disclaimer":
    "Estimaci\u00f3 orientativa. Els trams corresponen a la base de l'estalvi de l'IRPF vigent. Consulta amb un assessor fiscal.",
  "tax.breakdown_capital_gains": "Guanys patrimonials",
  "tax.breakdown_fx_gains": "Guanys per tipus de canvi",
  "tax.breakdown_dividends": "Dividends",
  "tax.breakdown_interest": "Interessos",
  "tax.breakdown_blocked_losses": "Pèrdues bloquejades (diferides)",
  "tax.breakdown_reintegrated_losses": "Pèrdues diferides que ara s'integren",

  // Sidebar - guide
  "sidebar.guia": "Guia Renta Web",

  // Guía de cumplimentación (Renta Web)
  "guide_rw.title": "Guia de complimentació — Renta Web",
  "guide_rw.description": "Com omplir cada casella a Renta Web amb les dades de DeclaRenta.",
  "guide_rw.intro":
    "Aquesta guia explica com traslladar els resultats de DeclaRenta a Renta Web (AEAT). Per a cada apartat, s'indica la casella destí, quin valor introduir i quines opcions seleccionar als desplegables.",
  "guide_rw.capital_gains_title": "Guanys i pèrdues patrimonials (transmissions)",
  "guide_rw.fx_title": "Guanys per tipus de canvi (moneda estrangera)",
  "guide_rw.dividends_title": "Rendiments del capital mobiliari — Dividends",
  "guide_rw.interest_title": "Rendiments del capital mobiliari — Interessos",
  "guide_rw.double_taxation_title": "Deducció per doble imposició internacional",
  "guide_rw.entidad_emisora_label": "Entitat emissora",
  "guide_rw.entidad_emisora_value":
    "Nom de l'empresa o del valor que vens (ex. Apple Inc.), no el del broker. En divises, la moneda (ex. USD). Si consolides diverses operacions en una sola línia, indica el valor principal.",
  "guide_rw.tipo_elemento_label": "Tipus d'element patrimonial",
  "guide_rw.tipo_elemento_value_capital":
    "Selecciona <strong>«Accions admeses a negociació»</strong> per a accions cotitzades. Per a fons: «Participacions en IIC». Per a derivats/opcions: «Altres elements patrimonials».",
  "guide_rw.tipo_elemento_value_fx": "Selecciona <strong>«Altres elements patrimonials — Divises»</strong>.",
  "guide_rw.clave_prereq_title": "La casella del valor de transmissió està bloquejada?",
  "guide_rw.clave_prereq_hint":
    "A Renta Web, les caselles <strong>1633</strong> (valor de transmissió) i <strong>1637</strong> (valor d'adquisició) <strong>apareixen deshabilitades fins que omplis abans aquests camps, en aquest ordre</strong>:<br>1) Casella <strong>1626 «Tipus d'element patrimonial. Clau»</strong> → per a divises i opcions sol ser la clau <strong>4</strong> («Altres elements patrimonials no afectes a activitats econòmiques»); per a cripto, revisa la clau que l'exercici assigni a les monedes virtuals. Els fons d'inversió (IIC) <strong>no</strong> fan servir la clau 4: es declaren com a «Participaciones en IIC».<br>2) <strong>«Tipus de transmissió»</strong> → <strong>«Transmissió intervivos onerosa (venda, permuta, etc.)»</strong> — és <strong>onerosa</strong>, no lucrativa/gratuïta.<br>3) <strong>Data de transmissió</strong> (caselles <strong>1631/1632</strong>) → dia/mes/any de la venda.<br>4) <strong>Data d'adquisició</strong> (casella <strong>1932</strong>) → dia/mes/any de la compra.<br>Un cop emplenats, les caselles 1633 i 1637 s'activen i hi podràs escriure els imports. <em>El número exacte de casella pot variar segons l'exercici.</em>",
  "guide_rw.gastos_transmision_label": "Despeses de la transmissió",
  "guide_rw.gastos_adquisicion_label": "Despeses de l'adquisició",
  "guide_rw.gastos_zero":
    "<strong>0</strong> — DeclaRenta ja inclou les comissions en els valors de transmissió/adquisició. No afegeixis despeses per separat.",
  "guide_rw.gastos_label": "Despeses d'administració i dipòsit",
  "guide_rw.valor_transmision_label": "Valor de transmissió",
  "guide_rw.valor_adquisicion_label": "Valor d'adquisició",
  "guide_rw.valor_transmision_hint":
    "L'import de la casella <strong>0328</strong> de DeclaRenta (EUR, comissions ja incloses).",
  "guide_rw.valor_adquisicion_hint":
    "L'import de la casella <strong>0331</strong> de DeclaRenta (EUR, comissions ja incloses).",
  "guide_rw.fx_valor_transmision_hint": "L'import de la casella <strong>1633</strong> de DeclaRenta.",
  "guide_rw.fx_valor_adquisicion_hint": "L'import de la casella <strong>1637</strong> de DeclaRenta.",
  "guide_rw.fecha_transmision_label": "Data de transmissió",
  "guide_rw.fecha_adquisicion_label": "Data d'adquisició",
  "guide_rw.fecha_hint_individual":
    "Si introdueixes operació a operació, usa la data exacta de l'informe. Si consolides totes en una línia, usa <strong>31/12/AAAA</strong> (transmissió) i <strong>01/01/AAAA</strong> (adquisició).",
  "guide_rw.fx_fecha_hint":
    "Per a la consolidació de FX: <strong>01/01/AAAA</strong> (adquisició) i <strong>31/12/AAAA</strong> (transmissió). Si introdueixes operació a operació, usa les dates reals de l'informe.",
  "guide_rw.retenciones_label": "Retencions",
  "guide_rw.retenciones_zero": "Normalment <strong>0</strong> per a emissors estrangers (la seva retenció estrangera va a la casella 0588). PERÒ si tens accions <strong>espanyoles</strong> (ISIN ES…) en un bróker estranger, la seva retenció del 19% SÍ és un pagament a compte espanyol i va a la <strong>casella 0597</strong>.",
  "guide_rw.importe_label": "Ingressos íntegres",
  "guide_rw.dividends_importe_hint": "L'import brut de la casella <strong>0029</strong> de DeclaRenta (EUR).",
  "guide_rw.interest_importe_hint": "L'import de la casella <strong>0027</strong> de DeclaRenta (EUR).",
  "guide_rw.dt_pais_label": "País d'origen",
  "guide_rw.dt_pais_hint":
    "Selecciona el país on es va practicar la retenció (ex. Estats Units, Irlanda, Alemanya…). Si tens retencions de diversos països, afegeix una línia per cadascun.",
  "guide_rw.dt_importe_label": "Import de la deducció",
  "guide_rw.dt_importe_hint":
    "L'import de la casella <strong>0588</strong> de DeclaRenta. És el menor entre la retenció estrangera pagada i la quota espanyola corresponent (Art. 80 LIRPF).",
  "guide_rw.dt_campo_label": "En quin camp del quadre?",
  "guide_rw.dt_campo_hint":
    "Al quadre de doble imposició, omple DUES files per cada país:<br>• <strong>«Altres rendiments nets reduïts obtinguts a l'estranger»</strong> (2a fila) → la columna «Brut EUR» d'aquest país al detall de la casella 0588 de DeclaRenta. Si només hi ha un país, és la fila «Total rendiments estrangers» d'aquest detall. No inclou els dividends espanyols ni els de països sense retenció.<br>• <strong>«Impost satisfet a l'estranger»</strong> (última fila) → la deducció d'aquest país al mateix detall (amb un sol país, l'import de la casella 0588).<br>Si deixes la 2a fila buida, Renta Web mostra l'avís «Ha reflectit l'impost sense fer constar les rendes». Les files 1 i 3 queden a 0.",
  "guide_rw.capital_gains_note":
    "Si tens moltes operacions, pots consolidar-les en una sola línia per tipus d'actiu usant les dates genèriques 01/01 i 31/12. Renta Web accepta imports agregats.",
  "guide_rw.fx_note":
    "Els guanys per tipus de canvi es declaren a part dels guanys de valors. Apareixen quan converteixes divisa a euros o a una altra divisa (p. ex. USD→GBP) —incloses les conversions automàtiques del teu bróker (p. ex. AFx/FXCONV a IBKR)—, no només en les conversions manuals. Amb el «Criteri DGT (multidivisa)», mentre mantens la divisa (p. ex. compres i vens accions en USD sense passar a euros), la diferència de canvi queda diferida fins que la converteixes efectivament, a euros o a una altra divisa (Art. 14.2.e LIRPF). Amb «Tradicional sense divisa (monodivisa)» aquesta secció no s'aplica. Amb «Tradicional amb divisa», la variació del tipus de canvi mentre tens les accions ja va dins del seu guany o pèrdua (caselles 0328/0331). Només queda diferida la variació mentre tens la divisa en efectiu. La divisa també surt quan pagues comissions o la perds en una venda amb pèrdues.",
  "guide_rw.dividends_note":
    "Els dividends de brokers estrangers no porten retenció espanyola. La retenció estrangera (withholding tax) NO es posa aquí: es dedueix apart a la casella 0588 (doble imposició).",
  "guide_rw.interest_note":
    "Els interessos del broker (remuneració de saldo) es declaren com a rendiments del capital mobiliari. Els interessos de marge pagats NO són deduïbles (Art. 26.1.a LIRPF).",
  "guide_rw.double_taxation_note":
    "La deducció per doble imposició evita pagar dues vegades impostos sobre els mateixos dividends. Es limita al menor entre el pagat a l'origen i la quota espanyola. Si el conveni de doble imposició permet un tipus màxim inferior (ex. 15% EUA), només és deduïble fins a aquest límit.",
  "guide_rw.blocked_losses_title": "Pèrdues bloquejades (anti-churning)",
  "guide_rw.blocked_losses_hint":
    "Si DeclaRenta mostra pèrdues bloquejades, marca la casella <strong>«Pèrdues patrimonials no imputables»</strong> a Renta Web. Es bloquegen perquè vas recomprar el mateix valor en els 2 mesos anteriors o posteriors a la venda (1 any si el valor no cotitza en un mercat regulat de l'Espai Econòmic Europeu ni en un d'equivalent, com NYSE o Nasdaq). En les criptomonedes, només es bloquegen si recompres la mateixa criptomoneda l'any següent a la venda (art. 33.5.e); les compres anteriors a la venda no compten. DeclaRenta aplica 2 mesos a tot valor amb ISIN, tret que IBKR només el mostri en un mercat sense equivalència (Londres des del 2021, SIX des del juliol del 2019, OTC Markets…) o que tu el marquis amb 1 any al tauler «Termini anti-churning per valor» dels resultats (a la línia d'ordres, --antichurning-1y). Toronto, Tòquio i Singapur tenen una decisió d'equivalència i DeclaRenta els aplica 2 mesos, tot i que cap consulta de la DGT ho confirma per a accions. Si el teu valor només cotitza en un mercat sense equivalència i DeclaRenta no ho sap, marca'l amb 1 any; si també cotitza en un mercat regulat de l'Espai Econòmic Europeu o en un d'equivalent, marca'l amb 2 mesos. Una compra dels 2 mesos anteriors no bloqueja si va ser l'única compra d'aquest valor en aquest termini i en començar-lo no tenies accions d'aquest valor (excepció de compra única, DGT V3282-18); les compres dels 2 mesos posteriors continuen bloquejant, excepte la que només tanca una posició curta, que no és una recompra. Fins a la 0.66.13, DeclaRenta no aplicava aquesta excepció: si vas presentar un any amb aquesta pèrdua bloquejada, pots corregir aquell any per deduir-la (2024 i posteriors: autoliquidació rectificativa; 2023 i anteriors: sol·licitud de rectificació). No se sumen al cost de la nova posició: queden pendents i s'integren, primer les més antigues, a mesura que venguis accions d'aquest valor que cap recompra en aquest termini no cobreix (transmissió definitiva); si en recompres una part, només compten les accions no recomprades. En les criptomonedes, s'integra quan venguis les unitats recomprades, encara que tornis a comprar aquesta criptomoneda (art. 33.5.e); vendre'n altres unitats no la integra. Si vas declarar un any amb DeclaRenta 0.66.5 o anterior, aquelles versions alliberaven una pèrdua en vendre les accions recomprades encara que tornessis a recomprar: si ja vas deduir aquesta pèrdua, no la tornis a deduir quan DeclaRenta l'alliberi ara, o corregeix aquell any (2024 i posteriors: autoliquidació rectificativa; 2023 i anteriors: autoliquidació complementària). I a l'inrevés: si DeclaRenta allibera ara una pèrdua en un any que ja vas presentar amb la 0.66.5 o anterior, pots corregir aquell any per deduir-la (2024 i posteriors: autoliquidació rectificativa; 2023 i anteriors: sol·licitud de rectificació). En les criptomonedes, si vas declarar un any amb DeclaRenta 0.66.13 o anterior, una compra anterior a la venda podia bloquejar la pèrdua: si DeclaRenta dedueix o allibera ara una pèrdua de criptomonedes en un any que ja vas presentar, corregeix aquell any per deduir-la (2024 i posteriors: autoliquidació rectificativa; 2023 i anteriors: sol·licitud de rectificació); si no, no es dedueix mai. Sempre que corregeixis un any per deduir una pèrdua, revisa també els anys posteriors que ja vas presentar: si en algun vas deduir aquesta mateixa pèrdua perquè la versió anterior l'alliberava aquell any, corregeix també aquell any per treure-la (2024 i posteriors: autoliquidació rectificativa; 2023 i anteriors: autoliquidació complementària), per no deduir-la dues vegades: una pèrdua només es dedueix una vegada.",
  "guide_rw.closing_tip": "Després d'introduir totes les dades, usa el botó «Verificar declaració» de Renta Web per comprovar errors. Si una altra eina mostra un import diferent en guanys patrimonials, potser fa servir un altre mètode per a les accions en divisa. Als resultats del Model 100, obre «Comparar amb els altres mètodes» per veure les xifres dels tres. Per canviar de mètode, torna al pas «Revisar i triar mètode». Fes servir el mateix mètode tots els anys.",

  // PDF report
  "pdf.subtitle": "Informe fiscal — Exercici",
  "pdf.generated": "Generat el",
  "pdf.informative": "Informatiu",
  "pdf.blocked_losses": "Pèrdues bloquejades anti-churning",
  "pdf.interest_margin": "Interessos marge (no deduïble)",
  "pdf.section_casillas": "1. Resum de Caselles — Model 100",
  "pdf.section_operations": "2. Detall d'Operacions",
  "pdf.section_dividends": "3. Dividends",
  "pdf.section_dt": "4. Deducció per Doble Imposició Internacional",
  "pdf.section_warnings": "Advertències",
  "pdf.reintegrated_losses": "Pèrdues reintegrades (anti-churning)",
  "pdf.dt_paid": "Impost pagat",
  "pdf.dt_allowed": "Deducció permesa",
  "pdf.ecb_note":
    "Tipus ECB: tipus de canvi oficial del Banc Central Europeu (EUR per 1 unitat de divisa estrangera) en la data de l'operació. Font: ECB SDMX API.",
  "pdf.footer":
    "DeclaRenta — https://declarenta.com — Aquest informe és orientatiu i no substitueix l'assessorament fiscal professional.",

  // Manual crypto valuation
  "crypto_rates.title": "Valoració manual de criptomonedes",
  "crypto_rates.description":
    "Alguns intercanvis entre criptomonedes no s'han pogut valorar automàticament perquè cap de les dues divises té un tipus de canvi oficial del BCE. Introdueix el valor en euros per unitat en la data de l'operació per incloure'ls.",
  "crypto_rates.help":
    "Mai consultem preus de criptomonedes a internet: la teva cartera es manté privada. Cerca tu mateix el valor en euros (p. ex. a l'historial del teu exchange o en una web de preus) i introdueix-lo aquí.",
  "crypto_rates.col_asset": "Actiu",
  "crypto_rates.col_date": "Data",
  "crypto_rates.col_quantity": "Quantitat",
  "crypto_rates.col_currency": "Moneda",
  "crypto_rates.col_eur_per_unit": "EUR per unitat",
  "crypto_rates.placeholder": "p. ex. 142,50",
  "crypto_rates.save_btn": "Desa i recalcula",
  "crypto_rates.saved": "Desat",
  "crypto_rates.recalculate_hint": "Els valors es desen al teu navegador i l'informe es recalcula.",
  "crypto_rates.stored_title": "Preus manuals desats",
  "crypto_rates.stored_description":
    "Aquests preus en euros estan desats al teu navegador i s'apliquen cada vegada que processes un fitxer. Corregeix un valor i desa, o esborra'ls tots si n'hi ha algun d'erroni.",
  "crypto_rates.clear_btn": "Esborra els preus desats",

  // Manual opening lots for transferred positions
  "opening_lots.title": "Lots manuals per a posicions transferides",
  "opening_lots.description":
    "Si una venda correspon a accions transferides des d'un altre broker, pots introduir aquí els lots de compra originals perquè el FIFO calculi correctament el cost base.",
  "opening_lots.help":
    "Afegeix tants lots com calgui. Cada fila representa una compra prèvia diferent amb la seva pròpia data, quantitat i preu per acció. Les dades només es desen al teu navegador.",
  "opening_lots.effect_hint":
    "Si el resultat baixa després d'introduir aquests lots, és normal: abans aquesta venda s'estava calculant amb cost base = 0.",
  "opening_lots.group_intro":
    "Falten {{quantity}} títols per a la venda del {{date}}. Introdueix els lots previs que cobreixen aquesta posició transferida.",
  "opening_lots.group_intro_saved":
    "Aquests lots manuals estan desats al teu navegador i es continuaran aplicant mentre no els esborris.",
  "opening_lots.col_acquire_date": "Data de compra",
  "opening_lots.col_quantity": "Quantitat",
  "opening_lots.col_price": "Preu per acció",
  "opening_lots.col_actions": "Accions",
  "opening_lots.placeholder_quantity": "p. ex. 14",
  "opening_lots.placeholder_price": "p. ex. 100,00",
  "opening_lots.add_row": "Afegeix lot",
  "opening_lots.remove_row": "Treu",
  "opening_lots.save_btn": "Desa els lots i recalcula",
  "opening_lots.clear_btn": "Esborra els lots desats",
  "opening_lots.saved": "Desat",
  "opening_lots.row_invalid":
    "Revisa les files marcades: indica la data de compra i una quantitat i un preu més grans que zero (p. ex. 1.234,56). No s'ha desat res.",
  "opening_lots.recalculate_hint": "Els lots manuals es desen al teu navegador i l'informe es recalcula.",

  // Missatges del motor i els analitzadors (TaxMessage id → text localitzat)
  "fx.missing_prior_lots":
    "⚠ {{count}} disposicions de {{currency}} sense lots previs suficients (total: {{totalQuantity}} {{currency}}). Possible adquisició anterior al període declarat — guany de canvi assumit = 0.",
  "fx.missing_prior_lots.hint":
    "L'adquisició d'aquesta divisa va ser anterior al període del Flex Query. S'assumeix un guany de canvi = 0 (tractament conservador).",
  "fx.conservation_mismatch":
    "⚠ Desquadrament intern del motor de divisa per a {{currency}}: {{mismatch}} unitats sense quadrar. Les caselles 1633/1637 poden no reconciliar-se.",
  "fx.conservation_mismatch.hint":
    "Això és una comprovació interna (no hauria de passar). Si ho veus, informa'n a GitHub adjuntant l'informe; els imports de divisa poden necessitar revisió manual.",
  "fifo.unknown_category":
    '⚠ Categoria d\'actiu desconeguda: "{{assetCategory}}" per a {{symbol}}. Es processarà amb FIFO genèric.',
  "fifo.unknown_category.hint":
    "Es processa igualment amb FIFO genèric. Si és un actiu nou d'IBKR, és possible que s'afegeixi en versions futures.",
  "fifo.scrip_dividend": "📈 Scrip dividend: {{symbol}} +{{quantity}} accions el {{date}}",
  "fifo.scrip_dividend.hint": "El scrip dividend s'ha afegit com a lot amb un cost igual al valor del dividend.",
  "fifo.roll_operation": "⚠ Operació C;O (roll): {{symbol}} el {{date}}. Es processa com a tancament + obertura.",
  "fifo.roll_operation.hint":
    "Operació roll processada correctament com a tancament de la posició anterior i obertura de la nova.",
  "fifo.unknown_direction": "⚠ Operació amb direcció desconeguda (\"{{buySell}}\"): {{symbol}} el {{date}}. No s'ha processat.",
  "fifo.unknown_direction.hint": "Només es processen compres (BUY) i vendes (SELL). Revisa aquesta fila al fitxer del broker i, si és una operació real, corregeix-ne la direcció.",
  "fifo.zero_quantity_buy": "⚠ Compra amb quantitat 0: {{symbol}}{{isinSuffix}} el {{date}}. No s'ha processat.",
  "fifo.zero_quantity_buy.hint": "La fila del fitxer no compra cap unitat, així que no crea cap lot i la seva comissió no es compta. Si realment vas comprar, revisa la quantitat d'aquesta fila al fitxer del broker.",
  "fifo.zero_quantity_sell": "⚠ Venda amb quantitat 0: {{symbol}}{{isinSuffix}} el {{date}}. No s'ha processat.",
  "fifo.zero_quantity_sell.hint": "La fila del fitxer no ven cap unitat, així que no consumeix cap lot i la seva comissió no es compta. Si realment vas vendre, revisa la quantitat d'aquesta fila al fitxer del broker.",
  "fifo.split_applied": "⚡ Split {{isin}} {{ratio}} ({{direction}}) aplicat ({{date}})",
  "fifo.split_applied.hint":
    "Split aplicat a tots els lots. El cost total es manté — només canvia el nombre d'accions.",
  "fifo.split_unresolved": "⚠ Split de {{symbol}} el {{date}} sense aplicar: no hi ha accions anteriors amb què calcular la proporció.",
  "fifo.split_unresolved.hint":
    "Puja també els extractes d'anys anteriors, des de l'obertura del compte. Si no, el nombre d'accions i el cost de les vendes posteriors d'aquest valor no seran correctes.",
  "fifo.merger_applied":
    "🔄 Fusió: {{oldIsin}} → {{newIsin}} (ràtio {{ratio}}, {{lotsTransferred}} lots transferits, {{date}})",
  "fifo.merger_applied.hint":
    "Fusió fiscalment neutra: els lots es transfereixen al nou ISIN conservant el cost base original.",
  "fifo.cash_merger_disposal":
    "💶 Compra en efectiu: {{symbol}} ({{isin}}) × {{quantity}} el {{date}}. Es declara com una venda.",
  "fifo.cash_merger_disposal.hint":
    "Una fusió o adquisició pagada en efectiu és una transmissió: el guany o la pèrdua es calcula com en una venda, amb l'efectiu rebut com a valor de transmissió.",
  "fifo.spinoff_applied":
    "🔀 Spin-off: {{parentIsin}} → {{newIsin}} (ràtio {{ratio}}, cost {{costPercent}}% al spin-off, {{date}})",
  "fifo.spinoff_applied.hint": "El cost es reparteix proporcionalment entre la matriu i l'empresa escindida.",
  "fifo.corporate_action_unhandled":
    "ℹ Acció corporativa {{type}} de {{symbol}} ({{isin}}) el {{date}}: no s'aplica al càlcul FIFO.",
  "fifo.corporate_action_unhandled.hint":
    "Si va canviar el nombre d'accions o l'ISIN de la posició, revisa el cost de les vendes posteriors d'aquest valor.",
  "fifo.sell_without_lots":
    "⚠ Venda sense lots: {{symbol}}{{isinSuffix}} × {{quantity}} el {{date}}. Cost base = 0 (possible posició curta o dades prèvies incompletes).",
  "fifo.sell_without_lots.hint":
    "La teva exportació inclou els anys anteriors? Descarrega del teu broker un període que cobreixi des de la primera compra d'aquest valor.",
  "fifo.cover_without_lots":
    "⚠ Tancament de curt sense lots: {{symbol}} ({{isin}}) × {{quantity}} el {{date}}. Guany no calculat (posició curta oberta fora del període o dades prèvies incompletes).",
  "fifo.cover_without_lots.hint":
    "Has inclòs els anys anteriors al teu Flex Query? Selecciona un període que cobreixi des de la venda que va obrir aquesta posició curta.",
  "fifo.insufficient_lots": "⚠ Lots insuficients: {{symbol}}{{isinSuffix}} × {{quantity}} el {{date}}. Cost base = 0.",
  "fifo.insufficient_lots.hint":
    "El fitxer no cobreix totes les compres prèvies d'aquest valor. Exporta des del teu broker un període més ampli.",
  "fifo.option_invalid_date": "⚠ Esdeveniment OptionEAE sense data vàlida per a {{symbol}}. Omès.",
  "fifo.option_invalid_date.hint":
    "Esdeveniment d'opció omès per data no vàlida. Revisa que el Flex Query inclou la secció 'Option Exercises, Assignments & Expirations'.",
  "fifo.option_zero_quantity": "⚠ Esdeveniment OptionEAE amb quantitat 0 per a {{symbol}} el {{date}}. Omès.",
  "fifo.option_zero_quantity.hint": "Esdeveniment d'opció amb quantitat 0 — probablement un registre duplicat d'IBKR.",
  "fifo.option_invalid_strike": '⚠ Strike no vàlid "{{strike}}" per a {{symbol}} el {{date}}. Ometent l\'exercici.',
  "fifo.option_invalid_strike.hint":
    "No s'ha pogut calcular l'exercici d'aquesta opció. El cost del subjacent no inclourà la prima.",
  "fifo.option_expiry_no_lots": "⚠ Expiració d'opció sense lots: {{symbol}} × {{quantity}} el {{date}}.",
  "fifo.option_expiry_no_lots.hint":
    "L'opció va expirar però no s'han trobat lots de compra. Vas incloure l'any de compra al Flex Query?",
  "fifo.option_exercise_no_lots":
    "⚠ Exercici/assignació sense lots d'opció: {{symbol}} × {{quantity}} el {{date}}. Cost de prima = 0.",
  "fifo.option_exercise_no_lots.hint":
    "Exercici registrat amb prima = 0 perquè no s'ha trobat la compra de l'opció. Amplia el període del Flex Query.",
  "fifo.exercise_no_underlying_lots":
    "⚠ Exercici d'opció sense lots del subjacent: {{symbol}} × {{quantity}} el {{date}}. Cost base = 0.",
  "fifo.exercise_no_underlying_lots.hint":
    "Assignació de PUT registrada amb cost base = 0 del subjacent. El Flex Query pot no cobrir l'adquisició original.",
  "fifo.insufficient_underlying_lots":
    "⚠ Lots insuficients del subjacent: {{symbol}} × {{quantity}} el {{date}}. Cost base = 0.",
  "fifo.insufficient_underlying_lots.hint": "No hi ha prou lots del subjacent per cobrir l'assignació completa.",
  "report.crypto_valuation_unresolved":
    "Hi ha {{count}} operació(ns) en criptomoneda el valor de les quals en euros no s'ha pogut determinar automàticament i s'han exclòs dels càlculs.",
  "report.crypto_valuation_unresolved.hint":
    "Passa en permutes cripto-cripto (p. ex. Binance Convert) quan cap de les dues monedes no té tipus de canvi oficial del BCE. Introdueix manualment el valor en euros per unitat de cada moneda a la data indicada per incloure aquestes operacions.",
  "report.crypto_commission_neutralized":
    "S'ha ignorat la comissió de {{count}} operació(ns) per estar denominada en una criptomoneda sense tipus de canvi disponible.",
  "report.crypto_commission_neutralized.hint":
    "El valor principal de l'operació sí que s'ha calculat; només s'omet la petita comissió, l'impacte fiscal de la qual és mínim.",
  "report.crypto_income_unvalued":
    "Hi ha {{count}} ingrés(os) en criptomoneda (p. ex. recompenses de staking) que no s'han pogut valorar automàticament i no s'inclouen en els imports calculats.",
  "report.crypto_income_unvalued.hint":
    "Aquests ingressos es paguen en la mateixa cripto i no tenen tipus de canvi oficial del BCE. Calcula'n el valor en euros a la data de cobrament i declara'ls manualment com a rendiments del capital mobiliari (Casella 0027).",
  "report.dividend_unvalued":
    "Hi ha {{count}} dividend(s) en {{currencies}} que no s'han pogut valorar automàticament i no s'inclouen en els imports calculats.",
  "report.dividend_unvalued.hint":
    "El BCE no publica cap tipus de canvi oficial per a aquesta divisa a la data de cobrament. Calcula l'import en euros a aquesta data, suma'l a mà a la casella 0029 i tingues en compte la seva retenció en la deducció per doble imposició internacional (casella 0588).",
  "report.withholding_corrected_prior_year":
    "Aquest fitxer porta correccions de retencions en origen de {{year}} anotades l'any {{reportYear}}: la retenció de {{year}} baixa {{amount}} €. Si vas presentar la declaració de {{year}} amb la retenció original, la casella 0588 d'aquell any pot haver sortit alta.",
  "report.withholding_corrected_prior_year.hint":
    "La deducció per doble imposició internacional (casella 0588, art. 80 LIRPF) només admet l'impost pagat de debò a l'estranger. Puja el fitxer de {{year}} juntament amb aquest i calcula {{year}}: DeclaRenta suma la correcció a la retenció del seu dividend. Si la casella 0588 baixa respecte de la que vas presentar, corregeix la declaració de {{year}} (2024 i posteriors: autoliquidació rectificativa; 2023 i anteriors: autoliquidació complementària). Les caselles de {{reportYear}} no canvien.",
  "report.spanish_withholding_corrected_prior_year":
    "Aquest fitxer porta correccions de retencions espanyoles de {{year}} anotades l'any {{reportYear}}: la retenció de {{year}} baixa {{amount}} €. Si vas presentar la declaració de {{year}} amb la retenció original, la casella 0597 d'aquell any pot haver sortit alta.",
  "report.spanish_withholding_corrected_prior_year.hint":
    "La retenció espanyola sobre dividends d'emissors espanyols és un pagament a compte (casella 0597, retencions del capital mobiliari) i només compta el que s'ha retingut de debò. Puja el fitxer de {{year}} juntament amb aquest i calcula {{year}}: DeclaRenta suma la correcció a la retenció del seu dividend. Si la casella 0597 baixa respecte de la que vas presentar, corregeix la declaració de {{year}} (2024 i posteriors: autoliquidació rectificativa; 2023 i anteriors: autoliquidació complementària). Les caselles de {{reportYear}} no canvien.",
  "report.crypto_general_gain_unvalued":
    "Hi ha {{count}} guany(s) patrimonial(s) en criptomoneda (p. ex. airdrops o comissions de referits) que no s'han pogut valorar automàticament i no s'inclouen en els imports calculats.",
  "report.crypto_general_gain_unvalued.hint":
    "Aquestes rendes es reben en la mateixa cripto i no tenen tipus de canvi oficial del BCE. Calcula'n el valor en euros a la data de cobrament i declara-les manualment com a guany patrimonial no derivat de transmissió (base general).",
  "report.antichurning_window_past_data":
    "Hi ha {{count}} venda(es) de {{year}} el termini de recompra de les quals per la regla anti-churning (2 mesos; 1 any si el valor no cotitza en un mercat regulat de l'Espai Econòmic Europeu ni en un d'equivalent; en les criptomonedes, només l'any següent a la venda) acaba després de l'última data que cobreixen els fitxers pujats d'aquest broker ({{lastDate}}). DeclaRenta no veu les compres posteriors a aquesta data.",
  "report.antichurning_window_past_data.hint":
    "Si vas comprar el mateix valor després del {{lastDate}} i dins del termini d'aquestes vendes (com a molt tard, fins al {{windowEnd}}), part de la seva pèrdua pot quedar bloquejada, o la venda deixa de ser una transmissió definitiva i no allibera pèrdues pendents. Puja també el fitxer amb les operacions fins al {{windowEnd}} juntament amb aquest i torna a calcular. Aquest termini és d'1 any en els valors als quals DeclaRenta aplica 1 any (perquè IBKR només els mostra en un mercat sense equivalència, com Londres des del 2021, SIX o OTC Markets, o perquè tu els vas marcar) i de 2 mesos en els altres valors amb ISIN. Si un valor només cotitza en un mercat així i DeclaRenta li aplica 2 mesos, marca'l amb 1 any al tauler «Termini anti-churning per valor» (a la línia d'ordres, --antichurning-1y) i torna a calcular. En les criptomonedes només compten les compres de la mateixa criptomoneda, en qualsevol exchange, fetes després de la venda i, com a molt tard, fins al {{windowEnd}}; les anteriors a la venda no compten. Si no vas comprar, el càlcul ja és correcte.",
  "report.antichurning_window_open_at_filing":
    "Hi ha {{count}} venda(es) de {{year}} el termini de recompra de les quals per la regla anti-churning acaba el {{windowEnd}} com a molt tard: després del {{deadline}}, últim dia per presentar la declaració, i després de l'última data que cobreixen els fitxers pujats d'aquest broker ({{lastDate}}). Quan presentis la declaració, aquest termini encara estarà obert.",
  "report.antichurning_window_open_at_filing.hint":
    "Abans de presentar-la, puja també el fitxer amb les teves operacions posteriors al {{lastDate}} i torna a calcular. Si compres el mateix valor o la mateixa criptomoneda fins al {{windowEnd}} inclòs, part de la pèrdua d'aquestes vendes pot quedar bloquejada, o la venda deixa de ser una transmissió definitiva i no allibera pèrdues pendents. En aquest cas, corregeix la declaració presentada amb una autoliquidació rectificativa.",
  "report.antichurning_one_year_ibkr":
    "DeclaRenta aplica el termini d'1 any de la regla anti-churning (art. 33.5.g LIRPF) a les vendes de {{count}} valor(s) fetes en dies en què IBKR només els mostra en un mercat que no és un mercat regulat de l'Espai Econòmic Europeu ni un mercat declarat equivalent per la Comissió Europea: {{list}}.",
  "report.antichurning_one_year_ibkr.hint":
    "IBKR només mostra el mercat de les línies que has operat. Si el valor també està admès a negociació en un mercat regulat de l'Espai Econòmic Europeu (no n'hi ha prou amb un mercat de creixement ni amb un altre sistema multilateral de negociació) o a NYSE, Nasdaq, ASX o la Borsa de Hong Kong, li corresponen 2 mesos: marca'l amb 2 mesos al tauler «Termini anti-churning per valor» (a la línia d'ordres, --antichurning-2m) i torna a calcular.",
  "report.antichurning_listing_open":
    "DeclaRenta aplica 2 mesos a les vendes de {{count}} valor(s) fetes en dies en què IBKR els mostra a Toronto, TSX Venture, Aequitas Neo, Tòquio o Singapur: {{list}}. Una decisió de la Comissió Europea declara aquest mercat equivalent a un mercat regulat, i la DGT accepta aquest tipus de decisió (consulta V0778-25), però cap consulta ho confirma per a accions.",
  "report.antichurning_listing_open.hint":
    "Si prefereixes el criteri prudent, marca'l amb 1 any al tauler «Termini anti-churning per valor» (a la línia d'ordres, --antichurning-1y) i torna a calcular.",
  "report.antichurning_window_user":
    "Has fixat a mà el termini de la regla anti-churning de {{count}} valor(s). 1 any: {{oneYear}}. 2 mesos, en lloc de l'any que donava IBKR: {{twoMonths}}.",
  "report.antichurning_window_user.hint":
    "DeclaRenta fa servir el teu termini en lloc de l'automàtic en el bloqueig de pèrdues, en la prova de transmissió definitiva i en els avisos de termini. El pots canviar al tauler «Termini anti-churning per valor» (a la línia d'ordres, --antichurning-1y o --antichurning-2m).",
  "antichurning_window.title":
    "Termini anti-churning per valor",
  "antichurning_window.description":
    "La regla anti-churning bloqueja una pèrdua si recompres el mateix valor en els 2 mesos anteriors o posteriors a la venda (art. 33.5.f LIRPF). Si el valor no està admès a negociació en un mercat regulat de l'Espai Econòmic Europeu ni en un mercat declarat equivalent, el termini és d'1 any (art. 33.5.g). DeclaRenta tria el termini amb el mercat que mostra IBKR i, si no el sap, aplica 2 mesos. Aquí el pots fixar per a cada valor.",
  "antichurning_window.col_security":
    "Valor",
  "antichurning_window.col_listing":
    "Mercat segons IBKR",
  "antichurning_window.col_window":
    "Termini",
  "antichurning_window.months_2":
    "2 mesos",
  "antichurning_window.months_12":
    "1 any",
  "antichurning_window.opt_auto":
    "Automàtic ({{window}})",
  "antichurning_window.opt_2m":
    "2 mesos: admès en un mercat regulat de l'EEE o en un d'equivalent",
  "antichurning_window.opt_1y":
    "1 any: no admès en un mercat regulat de l'EEE ni en un d'equivalent (p. ex. només a Londres des del 2021, SIX, OTC o BME Growth)",
  "antichurning_window.no_listing":
    "sense dada",
  "antichurning_window.open_note":
    "Equivalència per la Decisió {{decision}}, sense confirmar per a accions",
  "antichurning_window.save_btn":
    "Desa i recalcula",
  "antichurning_window.clear_btn":
    "Esborra els terminis desats",
  "antichurning_window.saved":
    "Desat",
  "antichurning_window.recalculate_hint":
    "Els terminis es desen al teu navegador i l'informe es recalcula.",
  "antichurning_window.save_error":
    "El navegador no ha deixat desar els terminis: el seu emmagatzematge pot estar ple o bloquejat. L'informe no ha canviat.",
  "antichurning_window.clear_error":
    "El navegador no ha deixat esborrar els terminis desats: el seu emmagatzematge pot estar bloquejat. L'informe no ha canviat.",
  "report.antichurning_single_purchase":
    "En {{count}} venda(es) de {{year}}, la compra dels 2 mesos anteriors no compta com a recompra: va ser l'única compra d'aquest valor en aquest termini i en començar el termini no tenies accions d'aquest valor (excepció de compra única, DGT V3282-18). Aquesta compra no bloqueja la pèrdua ni impedeix que la venda alliberi pèrdues pendents.",
  "report.antichurning_single_purchase.hint":
    "DeclaRenta només veu els fitxers pujats. Si en començar el termini (el primer comença el {{windowStart}}) tenies accions d'aquest valor en un altre broker o compte que no has pujat, o després les vas traspassar a una altra entitat, l'excepció no s'aplica: puja també aquests fitxers i torna a calcular. Una compra en els 2 mesos posteriors a la venda continua bloquejant la pèrdua.",
  "report.antichurning_single_purchase_unverified":
    "En {{count}} venda(es) de {{year}} es pot aplicar l'excepció de compra única de la regla dels 2 mesos, però DeclaRenta no l'aplica: els fitxers pujats no demostren que en començar el termini (el primer comença el {{windowStart}}) no tinguessis accions d'aquest valor. La compra dels 2 mesos anteriors compta com a recompra.",
  "report.antichurning_single_purchase_unverified.hint":
    "Si en començar el termini no tenies accions d'aquest valor en cap broker, i en els 2 mesos anteriors a la venda només vas fer aquella compra, aquesta compra no compta com a recompra (DGT V3282-18). DeclaRenta només l'aplica quan els teus fitxers ho demostren, compte per compte: els fitxers de cada compte que té o mou aquest valor n'han de cobrir les operacions sense buits ni dies repetits des del {{windowStart}} fins a unes posicions a final de període amb data igual o posterior a la venda (a IBKR, les seccions Trades i Open Positions de la Flex Query, amb el camp ISIN), amb totes les quantitats llegibles i amb les mateixes accions que deixen les operacions d'aquest compte. Una operació d'accions sense ISIN en aquest període, o unes accions sense ISIN que encara tinguessis en començar-lo (per exemple, de Revolut), en qualsevol compte, també ho impedeixen, perquè poden ser d'aquest valor. Un fitxer que només inclou operacions no és suficient, i un traspàs entre comptes o un lot manual dins d'aquest termini no es pot comprovar.",
  "report.titularidad_compartida":
    "Els imports mostrats estan dividits entre {{titulares}} titulars (la part que correspon a cada contribuent). Aquest informe reflecteix la declaració d'UN sol titular: cadascun dels {{titulares}} titulars ha de presentar la seva pròpia declaració amb aquesta mateixa part. No declaris el total en una sola declaració ni sumis les parts de diversos titulars a la teva.",
  "report.titularidad_compartida.hint":
    "El repartiment a parts iguals ({{titulares}} × {{percent}} %) pressuposa titularitat per igual. Si els percentatges de titularitat són diferents (p. ex. 70/30), ajusta els imports manualment. En comptes de guanys la atribució és 50/50 (Art. 11.3 LIRPF). Pots canviar el nombre de titulars al pas «Revisar i triar mètode» (a la línia d'ordres, --titulares).",
  "report.competitor_reconciliation":
    "Si una altra eina mostra un import diferent, pot ser perquè no calcula els guanys per tipus de canvi (Art. 33.1 LIRPF).",
  "report.competitor_reconciliation.hint":
    "Pots comparar amb un altre mètode al pas «Revisar i triar mètode» (a la línia d'ordres, --fx-method). «Tradicional amb divisa» valora les accions al tipus del dia de compra i al del dia de venda, i també calcula la teva divisa. «Tradicional sense divisa (monodivisa)» valora les accions igual, però no calcula cap resultat de divisa, tampoc en les conversions USD→EUR.",
  "report.monodivisa_conversions_skipped":
    "El mètode «Tradicional sense divisa (monodivisa)» ha deixat sense calcular {{count}} conversió(ns) de divisa d'aquest exercici (manuals o automàtiques del bróker). Aquest mètode no calcula cap resultat de divisa (caselles 1633/1637).",
  "report.monodivisa_conversions_skipped.hint":
    "Si has convertit divisa (per exemple, d'USD a EUR), tria «Tradicional amb divisa» al pas «Revisar i triar mètode» (a la línia d'ordres, --fx-method tradicional-divisa). Valora les accions igual i sí que calcula les teves conversions. El «Criteri DGT (multidivisa)» també les calcula.",
  "report.fx_method_consistency":
    "DeclaRenta calcula amb el «Criteri DGT (multidivisa)»: el guany de divisa es difereix fins que converteixes la moneda estrangera a euros (Art. 14.2.e LIRPF; DGT V0152-26). Hi ha dos mètodes més: «Tradicional amb divisa» i «Tradicional sense divisa (monodivisa)».",
  "report.fx_method_consistency.hint":
    "No barregis mètodes entre exercicis: si un any vas declarar amb un altre criteri (o amb una altra eina), la base de divisa arrossegada es pot duplicar o ometre. Per a la divisa adquirida abans del període del teu informe, inclou els anys anteriors a l'exportació del bróker.",
  "report.fx_deferred_no_conversion":
    "No has convertit divisa a euros aquest exercici, de manera que no hi ha guany per tipus de canvi a declarar (no s'afegeix cap import de divisa a les caselles 1633/1637). La diferència de canvi mentre mantens la moneda queda diferida fins que la converteixis efectivament a euros (Art. 14.2.e LIRPF; DGT V0152-26).",
  "report.fx_deferred_no_conversion.hint":
    "El teu bróker (p. ex. IBKR) pot mostrar un «realized forex gain» encara que no hagis passat a euros: fa servir el criteri fiscal dels EUA, no l'espanyol. Amb el «Criteri DGT (multidivisa)», el guany de divisa només es declara en canviar-la a euros o a una altra divisa.",
  "report.fx_traditional_method":
    "Mètode «Tradicional amb divisa». Les accions en divisa es valoren al tipus del BCE del dia de compra (cost) i del dia de venda (venda). La divisa tributa per FIFO quan surt del teu compte: en canviar-la a euros o a una altra divisa, en pagar comissions o interessos, o en perdre-la en una venda amb pèrdues. Una venda et retorna la divisa invertida i, si hi guanyes, el guany. La divisa invertida costa el que et va costar, més la variació del tipus de canvi entre la compra i la venda de les accions, que ja és en el resultat d'aquesta venda. El guany entra al tipus del dia de la venda. La divisa invertida que no recuperes tributa a part, en aquesta venda. Així cada variació de la divisa es declara una sola vegada.",
  "report.fx_traditional_method.hint":
    "La DGT valora així les participacions de fons en divisa (V2324-10, V0775-21). Per a accions, Hisenda calcula el guany en divisa i el passa a euros al tipus del dia de la venda (V1740-17, V2422-20, V0152-26): és el «Criteri DGT (multidivisa)». En els dos mètodes, la divisa que canvies tributa en canviar-la (V2466-08). La divisa perduda en una venda amb pèrdues tributa l'any de la venda, com en els fons (V0775-21, V2324-10). Autodeclaro descriu la mateixa valoració d'accions, amb els tipus de canvi de l'extracte del teu bróker, però no publica com calcula la divisa. Fes servir el mateix mètode cada any.",
  "report.fx_traditional_risk":
    "Hisenda aplica a les accions el «Criteri DGT (multidivisa)» (V1740-17). El 2025 va rebutjar aquest mateix càlcul per a un pis en dòlars (V1615-25). Si revisa la teva declaració, la pot recalcular amb aquest criteri.",
  "report.fx_traditional_risk.hint":
    "Si en el cicle complet (euros → divisa → accions → divisa → euros) no hi ha vendes amb pèrdues, els dos mètodes solen donar gairebé el mateix total. Canvia en quin any i en quina casella surt cada part, i també pot canviar la deducció per doble imposició (casella 0588). Amb vendes amb pèrdues, aquest mètode declara també la divisa perduda i el total és diferent. Cap consulta de la DGT avala aquest mètode per a accions. Si Hisenda recalcula, pot cobrar interessos de demora per l'impost que aquest mètode porta a un any posterior.",
  "report.fx_traditional_no_conversion":
    "Aquest any no has canviat divisa. La variació del {{ccy}} mentre tenies les accions ja és al seu guany o pèrdua. La variació mentre tens els {{ccy}} en efectiu es declararà quan els canviïs.",
  "report.fx_traditional_no_conversion.hint":
    "Amb aquest mètode, la divisa només s'afegeix a les caselles 1633/1637 quan surt del teu compte: canvis a euros o a una altra divisa, comissions, interessos pagats i divisa perduda en vendes amb pèrdues.",
  "report.fx_traditional_lost_dollars":
    "En {{n}} venda(es) amb pèrdues vas recuperar menys {{ccy}} dels que vas invertir. Aquests {{ccy}} perduts surten del teu compte. La seva diferència de canvi, des que els vas comprar fins que vas comprar les accions ({{amount}} €), es declara aquest any a les caselles 1633/1637.",
  "report.fx_traditional_lost_dollars.hint":
    "El «Criteri DGT (multidivisa)» no declara res en aquest cas, perquè aquests {{ccy}} no es van canviar mai a euros. Aquest mètode sí que ho declara, com la DGT en els fons en divisa (V0775-21, V2324-10): la variació de la divisa abans de la compra tributa l'any de la venda. L'ordre FIFO decideix quins {{ccy}} es van perdre. Ho veuràs al detall de les caselles 1633/1637 com a «Divisa perduda en una venda amb pèrdues».",
  "report.fx_traditional_guard":
    "En {{n}} venda(es), la caiguda del {{ccy}} des de la compra de les accions supera el que et va costar aquesta divisa. La seva diferència de canvi fins a la compra de les accions ({{amount}} €) es declara aquest any a les caselles 1633/1637, i aquests {{ccy}} tornen al tipus del dia de la venda.",
  "report.fx_traditional_guard.hint":
    "Passa quan el tipus de canvi es mou molt (més o menys el doble) entre la compra de la divisa i la venda de les accions. Sense aquesta regla, aquests {{ccy}} tindrien un cost negatiu. Ho veuràs al detall de les caselles 1633/1637 com a «Variació de la divisa fins a la compra de les accions».",
  "report.fx_traditional_inflight":
    "Aquest any has canviat {{qty}} {{ccy}} que vénen de vendes d'accions de {{years}}. Aquest mètode dona per fet que la variació del {{ccy}} mentre tenies aquestes accions ({{amount}} €) ja es va declarar dins del guany o la pèrdua d'aquell any.",
  "report.fx_traditional_inflight.hint":
    "És així si aquell any vas fer servir «Tradicional amb divisa» o «Tradicional sense divisa (monodivisa)». Si vas fer servir el «Criteri DGT (multidivisa)», el teu resultat de divisa d'aquest any està desviat en aquesta quantitat. Fes servir el mateix mètode que llavors.",
  "report.fx_traditional_uncovered":
    "{{qty}} {{ccy}} usats en compres d'accions no tenen origen en euros als teus fitxers (dipòsits, saldos anteriors, anys que no has pujat, o un descobert o préstec de marge del bróker). Es prenen al tipus del dia de compra, sense diferència de canvi anterior.",
  "report.fx_traditional_uncovered.hint":
    "Si vas canviar euros a {{ccy}} fins a 7 dies després de la compra, es fa servir el tipus d'aquest canvi. Si en coneixes l'origen, puja també els anys anteriors.",
  "report.fx_traditional_uncovered_ibkr":
    "{{qty}} {{ccy}} usats en compres d'accions no tenen origen en euros als teus fitxers (dipòsits, saldos anteriors, anys que no has pujat, o un descobert o préstec de marge del bróker). Es prenen al tipus del dia de compra, sense diferència de canvi anterior.",
  "report.fx_traditional_uncovered_ibkr.hint":
    "Si vas canviar euros a {{ccy}} fins a 7 dies després de la compra, es fa servir el tipus d'aquest canvi. Si en coneixes l'origen, puja també els anys anteriors. Si el teu saldo en {{ccy}} va quedar en negatiu (descobert o marge), puja l'extracte d'IBKR amb la secció «Cash Report». DeclaRenta tracta aquest saldo negatiu com un préstec en {{ccy}} només si el Cash Report quadra amb les teves operacions, és d'un sol compte i no hi ha en {{ccy}} dipòsits, retirades, transferències, opcions ni posicions curtes.",
  "report.fx_traditional_opening":
    "{{qty}} {{ccy}} del saldo inicial del teu compte (el «Cash Report» d'IBKR) es van fer servir en compres d'accions i no tenen origen en euros als teus fitxers. Es prenen al tipus del dia de compra, sense diferència de canvi anterior.",
  "report.fx_traditional_opening.hint":
    "Aquest saldo ja era al compte en començar el primer període que has pujat. Si en coneixes l'origen, puja també els anys anteriors.",
  "report.fx_traditional_orphan":
    "La diferència de canvi de {{qty}} {{ccy}} invertits en {{security}} no s'ha pogut assignar a cap venda (possible canvi d'ISIN, fusió o escissió). Revisa-la a mà.",
  "report.fx_traditional_orphan.hint":
    "Aquests {{ccy}} es van fer servir per comprar {{security}}. A 31 de desembre ja no tens aquestes accions i cap venda no els ha recuperat. La seva variació des que vas comprar els {{ccy}} fins que vas comprar les accions ({{amount}} €) no s'ha declarat.",
  "report.fx_loan_repayment":
    "Aquest any has retornat {{ccy}} que et va prestar el bróker (el teu saldo en {{ccy}} va estar en negatiu). DeclaRenta declara {{amount}} € per aquests retorns a les caselles 1633/1637. La variació del mateix deute, des que es va obrir fins que el vas retornar, és de {{gain}} € de guany i {{loss}} € de pèrdua.",
  "report.fx_loan_repayment.hint":
    "El Tribunal Suprem (STS 71/2021, ECLI:ES:TS:2021:345) porta la variació d'un préstec en moneda estrangera a la base general. La DGT la porta a la base de l'estalvi (V2414-12), com fa DeclaRenta. Si segueixes el Suprem, declara el guany a la casella 0304 i la pèrdua a la casella 0305, i treu-los de les caselles 1633/1637: baixa el valor de transmissió (1633) en el guany i puja'l en la pèrdua. DeclaRenta només tracta el saldo negatiu com a préstec quan l'informe d'efectiu (Cash Report) d'IBKR quadra amb les teves operacions.",
  "report.fx_loan_repayment_manual":
    "Aquest any has retornat {{ccy}} que et va prestar el bróker (el teu saldo en {{ccy}} va estar en negatiu). DeclaRenta declara {{amount}} € per aquests retorns a les caselles 1633/1637. La variació del mateix deute, des que es va obrir fins que el vas retornar, és de {{gain}} € de guany i {{loss}} € de pèrdua.",
  "report.fx_loan_repayment_manual.hint":
    "El Tribunal Suprem (STS 71/2021, ECLI:ES:TS:2021:345) porta la variació d'un préstec en moneda estrangera a la base general. La DGT la porta a la base de l'estalvi (V2414-12), com fa DeclaRenta. Si segueixes el Suprem, declara el guany a la casella 0304 i la pèrdua a la casella 0305. D'aquestes xifres, només {{boxGain}} € de guany i {{boxLoss}} € de pèrdua són a les caselles 1633/1637: baixa el valor de transmissió (1633) en aquest guany i puja'l en aquesta pèrdua. La resta no és a les caselles 1633/1637, sinó dins del resultat d'altres operacions (per exemple, la venda de les accions que vas comprar amb el préstec), i DeclaRenta no et pot dir quina casella has de corregir: quadra-ho a mà abans de presentar la declaració. DeclaRenta només tracta el saldo negatiu com a préstec quan l'informe d'efectiu (Cash Report) d'IBKR quadra amb les teves operacions.",
  "report.fx_method_name.multidivisa":
    "Criteri DGT (multidivisa)",
  "report.fx_method_name.tradicional-divisa":
    "Tradicional amb divisa",
  "report.fx_method_name.monodivisa":
    "Tradicional sense divisa (monodivisa)",
  "report.settings_line":
    "Configuració del càlcul: mètode {{method}}, titulars {{titulares}}, autoconversions {{autoconvert}}",
  "report.non_finite_total":
    "S'ha detectat un valor no finit (NaN/Infinit) en un total calculat; revisa els fitxers importats.",
  "report.non_finite_total.hint":
    "És possible que un fitxer d'un bróker tingui un import corrupte o un format numèric inesperat. Revisa les operacions d'origen.",
  "flatex.lagerstellenwechsel.unmatched":
    "Traspàs de custòdia (Lagerstellenwechsel) sense contrapartida per a {{isin}}: {{netQuantity}} títols.",
  "flatex.lagerstellenwechsel.unmatched.hint":
    "Un traspàs sense parella va entrar o sortir del dipòsit sense preu d'adquisició. Si més endavant vens aquests títols, revisa que el valor de compra original estigui inclòs per no declarar un guany fictici.",
  "flatex.commission.unmatched_trades":
    "No s'han pogut emparellar totes les comissions de Flatex: falten els apunts de caixa corresponents.",
  "flatex.commission.unmatched_trades.hint":
    "Puja també el CSV de Kontoumsätze (moviments de compte) juntament amb el de Depotumsätze perquè la comissió de cada operació es tingui en compte (sumant-se al cost d'adquisició en les compres i restant-se del valor de transmissió en les vendes).",
  "flatex.commission.cross_currency":
    "Operacions de Flatex sense comissió calculada: {{trades}}. L'apunt de caixa és en una moneda diferent de la de l'operació.",
  "flatex.commission.cross_currency.hint":
    "La comissió d'aquestes operacions s'ha deixat a 0. Consulta'n l'import a la liquidació de l'ordre a Flatex i tingues-lo en compte en revisar la declaració: es suma al valor d'adquisició en les compres i es resta del valor de transmissió en les vendes.",
  "flatex.commission.multi_fill_prorated":
    "Ordres de Flatex executades en diverses parts: {{orders}}. La seva comissió s'ha repartit entre les execucions en proporció al seu import.",
  "flatex.commission.multi_fill_prorated.hint":
    "Flatex va liquidar aquestes ordres amb un nombre d'apunts de caixa diferent del d'execucions, de manera que no es pot saber quina comissió correspon a cadascuna. El total de comissions de cada ordre és exacte; només el repartiment entre execucions és aproximat.",
  "flatex.depot.repeated_fills":
    "Operacions de Flatex repetides i comptades una sola vegada: {{fills}}. Tenien el mateix número d'ordre i d'apunt (TA-Nr.) que una altra ja carregada.",
  "flatex.depot.repeated_fills.hint":
    "Sol passar en pujar el mateix CSV de Depotumsätze dues vegades, o dues exportacions amb dates que se solapen. Si de debò són operacions diferents, revisa el fitxer: Flatex dona a cada execució el seu propi TA-Nr.",
  "flatex.dividends.net_amounts":
    "Flatex anota els dividends per l'import net cobrat, ja descomptada la retenció, i el CSV de Kontoumsätze no inclou la retenció.",
  "flatex.dividends.net_amounts.hint":
    "Pren l'import íntegre i la retenció de cada cobrament del justificant en PDF que Flatex deixa a la teva bústia de documents, i corregeix a mà les caselles 0029 (import íntegre), 0588 (retenció estrangera) i 0597 (retenció espanyola).",
  "degiro.rows_skipped": "S'han omès {{count}} files sense ISIN/sense import.",
  "degiro.rows_skipped.hint":
    "Aquestes files tenien quantitat o preu però els faltava l'ISIN o l'import, per la qual cosa no s'han pogut incloure com a operacions. Sol indicar que les columnes del CSV no s'han reconegut bé: torna a exportar el CSV de Transaccions de Degiro sense modificar les capçaleres.",
  "degiro.corporate_action_pair":
    "Possible operació societària el {{date}}: {{oldProduct}} ({{oldIsin}}) → {{newProduct}} ({{newIsin}}). Degiro l'anota com una venda i una compra.",
  "degiro.corporate_action_pair.hint":
    "Degiro anota els canvis d'ISIN, els splits i els bescanvis d'accions com una venda del valor antic i una compra del nou, sense número d'ordre ni costos. DeclaRenta els calcula així: declara un guany o una pèrdua aquell dia, i les accions noves prenen aquest preu i aquesta data com a cost. Revisa la comunicació de Degiro o de l'emissor. Si va ser un simple canvi d'ISIN, un split o un bescanvi fiscalment neutre (règim especial de la Llei de l'Impost sobre Societats), no hi va haver venda: les accions noves conserven el cost i la data de compra de les antigues, així que corregeix aquesta operació a la teva declaració. Si va ser un bescanvi que tributa (art. 37.1.e LIRPF), el càlcul és correcte.",
  "degiro.transaction_tax": "Impost sobre les transaccions financeres pagat en {{product}} ({{isin}}): {{amount}} {{currency}}.",
  "degiro.transaction_tax.hint":
    "Degiro cobra aquest impost en comprar accions espanyoles, franceses o italianes i només el mostra al CSV de Compte. Forma part del valor d'adquisició (art. 35.1.b LIRPF): suma'l al cost de les compres d'aquest valor, perquè DeclaRenta no l'afegeix automàticament.",
  "binance.unparseable_timestamp":
    "S'han omès {{count}} fila(es) del CSV de Binance per tenir una data/hora (UTC_Time) no reconeixible.",
  "binance.unparseable_timestamp.hint":
    "Sol deure's a un fitxer modificat manualment o exportat de forma incompleta. Torna a descarregar l'informe original des de Binance sense editar-lo perquè aquestes operacions s'incloguin.",
  "binance.unhandled_operation":
    "S'han omès {{count}} moviment(s) del CSV de Binance amb operacions no reconegudes: {{operations}}.",
  "binance.unhandled_operation.hint":
    "Aquests moviments no s'han inclòs en el càlcul. Si són compres, vendes o ingressos (p. ex. futurs, pagaments amb Binance Card, Auto-Invest o cashback), afegeix-los a mà a la teva declaració i comunica el nom de l'operació perquè es pugui incorporar.",
  "binance.unsupported_pair":
    "S'han omès {{count}} operació(ns) del CSV de Binance amb un parell no reconegut: {{pairs}}.",
  "binance.unsupported_pair.hint":
    "Aquestes operacions no s'han inclòs en el càlcul. Afegeix-les a mà a la teva declaració i comunica el parell perquè es pugui incorporar.",
  "etoro.closed_types_skipped":
    "S'han omès {{count}} posició(ns) tancada(es) d'eToro d'un tipus no admès: {{types}}.",
  "etoro.closed_types_skipped.hint":
    "DeclaRenta encara no importa aquests tipus de posició d'eToro (p. ex. criptomonedes). El seu guany o pèrdua no està inclòs en el càlcul: afegeix-lo a mà a la teva declaració amb l'import invertit i el benefici que mostra eToro.",
  "lightyear.unknown_types":
    "S'han omès {{count}} fila(es) del CSV de Lightyear amb un tipus de moviment no reconegut: {{types}}.",
  "lightyear.unknown_types.hint":
    "Aquests moviments no s'han inclòs en el càlcul. Si són desdoblaments (splits), traspassos d'accions o altres operacions societàries, revisa'ls a mà: poden canviar el nombre d'accions o el cost d'adquisició de vendes posteriors.",
  "coinbase.rewards_income_classification":
    "S'han classificat {{count}} ingrés(os) de tipus \"Rewards Income\" de Coinbase com a rendiments del capital mobiliari (base de l'estalvi).",
  "coinbase.rewards_income_classification.hint":
    "Si part d'aquests imports són recompenses promocionals o cashback de targeta (no rendiments per mantenir o cedir cripto), el seu tractament correcte seria guany patrimonial no derivat de transmissió (base general). Revisa'n la naturalesa si la quantitat és significativa.",
  "coinbase.unknown_types_skipped":
    "S'han omès {{count}} fila(es) de Coinbase amb un tipus d'operació no reconegut: {{types}}.",
  "coinbase.unknown_types_skipped.hint":
    "Aquestes files no s'han tingut en compte en el càlcul. Si alguna és una venda, una compra, un pagament amb cripto o una recompensa, afegeix-la manualment perquè el seu guany, el seu cost d'adquisició o el seu rendiment comptin.",
  "coinbase.advanced_trade_quote_leg_missing":
    "{{count}} operació(ns) d'Advanced Trade de Coinbase es van pagar o cobrar en una moneda diferent de la de valoració ({{pairs}}); només s'ha registrat la criptomoneda comprada o venuda, no la moneda de contrapartida.",
  "coinbase.advanced_trade_quote_leg_missing.hint":
    "En aquests parells també transmets (en comprar) o adquireixes (en vendre) la moneda de cotització, sigui una altra criptomoneda o una divisa, i aquesta operació també tributa. Afegeix manualment la venda o la compra d'aquesta moneda pel mateix valor en euros de l'operació perquè el seu guany i el seu cost d'adquisició quadrin.",
  "trade_republic.trade_skipped_no_amount":
    "S'ha(n) omès {{count}} operació(ns) de compravenda de Trade Republic sense import utilitzable.",
  "trade_republic.trade_skipped_no_amount.hint":
    "Sol deure's a files incompletes a l'exportació (columna \"amount\" buida o no numèrica). Si falten operacions, torna a descarregar el CSV de transaccions complet des de Trade Republic.",
  "trade_republic.corporate_action_not_applied":
    "Trade Republic: no s'han aplicat {{count}} moviment(s) d'acció corporativa (fusió, bescanvi, split) de {{isins}}.",
  "trade_republic.corporate_action_not_applied.hint":
    "El cost dels títols antics no passa als nous, així que una venda posterior del nou valor pot sortir sense lots i amb cost 0. Si va ser una fusió o un bescanvi, afegeix el cost d'adquisició original a «Lots manuals per a posicions transferides».",
  "trade_republic.delivery_not_applied":
    "Trade Republic: no s'han importat {{count}} entrega(s) de títols sense compravenda (accions gratuïtes, traspassos) de {{isins}}.",
  "trade_republic.delivery_not_applied.hint":
    "Les accions gratuïtes d'una promoció són un guany patrimonial de la base general pel seu valor de mercat el dia de l'entrega: declara-les a part i afegeix aquest valor com a cost a «Lots manuals per a posicions transferides». Si és un traspàs des d'un altre bròquer, afegeix-hi el cost de compra original.",
  "parser.trading212.unresolved_price_skipped":
    "S'han omès {{skipped}} operacions sense preu per acció i amb import en una altra divisa.",
  "parser.trading212.unresolved_price_skipped.hint":
    "Aquestes files no tenien preu per acció i el seu import (Total) estava en una divisa diferent de la de l'instrument, per la qual cosa no s'ha pogut calcular el valor de l'operació. Torna a exportar l'historial des de Trading 212 assegurant-te d'incloure la columna \"Price / share\".",
  "parser.cash_summary_duplicates": "S'han omès {{skipped}} files resum duplicades a les transaccions d'efectiu.",
  "parser.cash_summary_duplicates.hint":
    "El teu Flex Query té activada l'opció \"Summary\" a la secció Cash Transactions, la qual cosa duplica cada moviment. Pots desactivar-la, però no és necessari: aquestes files s'han ignorat automàticament per evitar duplicar dividends, retencions i comissions.",
  "parser.executions_merged": "S'han agrupat {{sourceFillCount}} execucions parcials en {{mergedGroupCount}} ordres.",
  "parser.executions_merged.hint":
    "Les ordres amb diverses execucions parcials s'han combinat en una sola operació, igual que fan els brókers que informen a Hisenda. El càlcul fiscal no canvia: quantitat total, preu mitjà ponderat i comissions sumen el mateix.",
  "parser.order_level_duplicates": "S'han omès {{skipped}} files agregades de tipus ORDER duplicades a les operacions.",
  "parser.order_level_duplicates.hint":
    'El teu Flex Query té activat el nivell de detall "Orders" a més d\'"Executions" a la secció Trades, la qual cosa duplica cada operació. Pots desactivar "Orders" a la configuració del Flex Query, però no és necessari: aquestes files s\'han ignorat automàticament per evitar duplicar quantitats, imports i comissions.',
  "parser.cancelled_trades": "S'han omès {{count}} operacions cancel·lades per IBKR juntament amb la seva anul·lació.",
  "parser.cancelled_trades.hint": "IBKR marca una execució cancel·lada amb una fila d'anul·lació (\"(Ca.)\"). L'operació original i la seva anul·lació s'han descartat: mai no van ser una compra o venda real.",
  "parser.cancelled_trades_unmatched": "S'han omès {{count}} anul·lacions d'IBKR sense l'operació original en aquest fitxer.",
  "parser.cancelled_trades_unmatched.hint": "L'operació cancel·lada queda fora del període d'aquest Flex Query. Si la carregues des d'un altre fitxer, es continuarà comptant com a real: exporta un període que inclogui l'operació i la seva anul·lació en el mateix fitxer.",
  "parser.cancelled_trades_unreadable": "S'han omès {{count}} anul·lacions d'IBKR sense poder aparellar-les amb l'operació que anul·len: falta una quantitat o un preu llegible a l'anul·lació o a una operació d'aquest fitxer.",
  "parser.cancelled_trades_unreadable.hint": "Si l'operació anul·lada és en aquest fitxer, DeclaRenta la continua comptant com una compra o venda real. Comprova que la Flex Query exporta la quantitat, el preu i l'ID d'execució (IB Execution ID) de cada operació i torna-la a exportar.",
  "parser.open_position_quantity_unknown": "IBKR no dona un nombre d'accions llegible per a {{count}} posició(ns) oberta(es): {{holdings}}.",
  "parser.open_position_quantity_unknown.hint": "DeclaRenta les compta amb 0 accions: el Model 720 les inclou amb el seu valor, però amb 0 a «Número de valores», i el D-6 no les inclou. Revisa a mà aquestes posicions al 720 i al D-6, o comprova que la secció Open Positions de la Flex Query inclou la quantitat i torna-la a exportar.",
  "parser.trade_quantity_unknown": "{{broker}} no dona un nombre d'accions o un preu llegible per a {{count}} operació(ns): {{trades}}.",
  "parser.trade_quantity_unknown.hint": "DeclaRenta no suma ni resta accions per elles, així que els guanys i les pèrdues d'aquest valor no són fiables i no s'aplica l'excepció de compra única de la regla dels 2 mesos. Comprova que el fitxer exportat porta la quantitat i el preu de cada operació i torna'l a exportar.",
  "parser.crypto_quantity_unknown": "{{broker}} no dona un nombre d'unitats o un preu llegible per a {{count}} operació(ns) amb criptomonedes: {{trades}}.",
  "parser.crypto_quantity_unknown.hint": "DeclaRenta no suma ni resta unitats per elles, així que els guanys i les pèrdues d'aquesta criptomoneda no són fiables. Si una d'elles és una recompra en l'any següent a una venda amb pèrdues, aquesta pèrdua pot haver de quedar pendent (art. 33.5.e LIRPF), i DeclaRenta no la bloqueja perquè no sap quantes unitats vas recomprar. Comprova que el fitxer exportat porta la quantitat i el preu de cada operació i torna'l a exportar.",
};

export default ca;
