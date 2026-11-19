// BETA: Tradución automática, pendente de revisión por falante nativo
/** Galego */
import type { TranslationKeys } from "./es.js";

const gl: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker estranxeiro → Renda española",

  "upload.title": "Sube o teu informe do broker",
  "upload.broker_question": "Que broker(s) utilizas?",
  "upload.broker_hint": "Selecciona un ou varios. Guiarémoste paso a paso.",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrastra o teu ficheiro aquí ou fai clic para seleccionar",
  "upload.formats_help":
    "Formatos: XML (IBKR Flex), CSV (Degiro, Flatex, Trade Republic, Scalable, Lightyear, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro, Revolut)",
  "upload.autodetect_note": "O broker detéctase automaticamente na maioría dos casos.",
  "upload.detecting": "Analizando ficheiro...",
  "upload.detected": "Broker detectado:",
  "upload.detection_failed": "Non se puido detectar o broker. Selecciónao manualmente.",
  "upload.broker_not_detected": "Non se detectou o teu broker?",
  "upload.guide_how": "Como descargar o meu informe do broker?",
  "upload.guide_select_broker": "Selecciona o teu broker:",
  "upload.choose_broker": "— escolle broker —",
  "upload.guide_unavailable": "Guía non dispoñible aínda para este broker.",
  "upload.chip_group_label": "Selección manual de broker",

  "config.title": "Configura",
  "config.process_btn": "Procesar",
  "config.processing": "Procesando...",

  "results.title": "Resultados para o Modelo 100",
  "results.operations": "Operacións",
  "results.dividends": "Dividendos",
  "results.no_dividends": "Sen dividendos",
  "results.search_placeholder": "Buscar por ISIN ou símbolo...",
  "results.search_placeholder_brokers": "Buscar por ISIN, símbolo ou broker...",
  "results.filter_all": "Todas",
  "results.filter_gains": "Ganancias",
  "results.filter_losses": "Perdas",
  "results.export_json": "Exportar JSON",
  "results.export_csv": "Exportar CSV",
  "results.export_csv_title": "Separador «,» e decimais con punto: para programas e follas de cálculo en inglés",
  "results.export_csv_excel": "Exportar CSV para Excel (ES)",
  "results.export_csv_excel_title": "Separador «;» e decimais con coma: ábrese por columnas con dobre clic no Excel en español",
  "results.export_pdf": "Exportar PDF",
  "results.operations_count": "{{count}} operación(s)",
  "results.dividends_count": "{{count}} dividendo(s)",
  "results.newer_years_notice": "Amosando {{year}}; os teus datos tamén cobren {{years}}.",
  "results.year_mismatch":
    "O ficheiro contén datos dos exercicios {{available}}, pero o exercicio seleccionado é {{year}}. Selecciona outro ano no despregable superior.",
  "results.setting_yes": "si",
  "results.setting_no": "non",

  "table.isin": "ISIN",
  "table.symbol": "Símbolo",
  "table.buy_date": "D. Compra",
  "table.sell_date": "D. Venda",
  "table.buy_broker": "Broker compra",
  "table.sell_broker": "Broker venda",
  "table.units": "Uds.",
  "table.cost_eur": "Custo EUR",
  "table.proceeds_eur": "Venda EUR",
  "table.gain_loss_eur": "G/P EUR",
  "table.days": "Días",
  "table.date": "Data",
  "table.gross_eur": "Bruto EUR",
  "table.withholding_eur": "Retención EUR",
  "table.country": "País",
  "table.payments": "Pagamentos",
  "casilla.dividends_by_issuer": "Dividendos por emisor",
  "casilla.dividends_per_payment": "Pagamentos individuais",
  "casilla.dividends_withholding_note": "A retención <strong>estranxeira</strong> non se declara aquí: no formulario «Alta Capital mobiliario» de Renta Web, déixaa en 0 e dedúcea na casilla 0588 (dobre imposición internacional, Art. 80 LIRPF). Pero a retención <strong>española</strong> sobre emisores españois (ISIN ES…) si é un pagamento a conta e vai na casilla 0597.",
  "table.casilla": "Casilla",
  "table.concept": "Concepto",
  "table.amount_eur": "Importe (EUR)",
  "table.currency": "Divisa",
  "table.fx_origin": "Orixe",
  "table.fx_lot": "Lote FIFO",
  "fx.trigger.conversion": "Conversión de divisa",
  "fx.trigger.dividend": "Dividendo",
  "fx.trigger.interest": "Xuros",
  "fx.trigger.commission": "Comisión",
  "fx.trigger.stock_purchase": "Compra de valores",
  "fx.trigger.stock_sale": "Divisa perdida nunha venda con perdas",
  "fx.trigger.stock_sale_guard": "Variación da divisa ata a compra das accións",
  "fx.trigger.stock_sale_cross": "Divisa investida en accións vendidas noutra moeda",
  "fx.trigger.loan_repayment": "Devolución dun préstamo en divisa do bróker",

  "casilla.listed_transmission_value": "Valor de transmisión (accións negociadas)",
  "casilla.listed_acquisition_value": "Valor de adquisición (accións negociadas)",
  "casilla.acquisition_sale_rate_note":
    "O valor de adquisición móstrase ao tipo de cambio do BCE da data de VENDA, de xeito que transmisión − adquisición coincide exactamente coa ganancia ou perda (DGT V2422-20: a ganancia calcúlase na moeda da acción e só a diferenza se converte a euros). En valores en moeda estranxeira este importe difire do custo histórico en euros da data de compra e pode non coincidir con cifras gardadas en versións anteriores.",
  "casilla.other_transmission_value": "Valor de transmisión (outros elementos: opcións/cripto/fondos/divisa)",
  "casilla.other_acquisition_value": "Valor de adquisición (outros elementos: opcións/cripto/fondos/divisa)",
  "casilla.fx_transmission_value": "Valor de transmisión FX (moeda estranxeira)",
  "casilla.fx_acquisition_value": "Valor de adquisición FX (moeda estranxeira)",
  "casilla.fx_cost_split": "{{fx}} € de custo da divisa e {{shift}} € de variación xa declarada na acción",
  "casilla.fx_net_gain_loss": "Ganancia/Perda neta FX (moeda estranxeira)",
  "casilla.net_gain_loss": "Ganancia/Perda neta (transmisións)",
  "casilla.gross_dividends": "Dividendos brutos",
  "casilla.interest_earned": "Xuros gañados",
  "casilla.interest_paid": "Xuros pagados ao broker (marxe, non deducible — informativo)",
  "casilla.general_gains": "Ganancias patrimoniais non derivadas de transmisión (airdrops, comisións de referidos)",
  "casilla.spanish_withholding": "Retencións do capital mobiliario (casilla 0597)",
  "casilla.spanish_withholding_detail":
    "Retención a conta do IRPF practicada na orixe sobre dividendos ou xuros de emisores españois (p. ex. accións do IBEX), aínda que estean nun bróker estranxeiro. É un pagamento a conta deducible da cota; NON é a dedución por dobre imposición (casilla 0588), que só se aplica a imposto estranxeiro.",
  "casilla.double_taxation": "Dedución dobre imposición",
  "casilla.dt_foreign_income_total": "Total rendementos estranxeiros",
  "casilla.reintegrated_losses":
    "Perdas diferidas que agora se integran (accións vendidas sen recompra no seu prazo, «transmisión definitiva»; en cripto, venda das unidades recompradas): {{amount}} EUR",
  "casilla.blocked_losses":
    "Perdas bloqueadas pola regra anti-churning (2 meses en mercado regulado ou equivalente / 1 ano o resto; en cripto, o ano seguinte á venda): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} advertencia(s)",
  "messages.errors_title": "{{count}} erro(s) — require atención",
  "messages.warnings_title": "{{count}} aviso(s) — revisa",
  "messages.info_title": "{{count}} nota(s) informativa(s)",
  "pdf.severity_error": "Erro",
  "pdf.severity_warning": "Aviso",
  "pdf.severity_info": "Nota",
  "pdf.section_messages": "Mensaxes",

  "chart.asset_distribution": "Distribución por tipo de activo",
  "chart.monthly_gl": "Ganancia/Perda por mes",
  "chart.currency_composition": "Composición por divisa",
  "chart.withholdings_country": "Retencións por país",
  "chart.month_1": "Xan",
  "chart.month_2": "Feb",
  "chart.month_3": "Mar",
  "chart.month_4": "Abr",
  "chart.month_5": "Mai",
  "chart.month_6": "Xuñ",
  "chart.month_7": "Xul",
  "chart.month_8": "Ago",
  "chart.month_9": "Set",
  "chart.month_10": "Out",
  "chart.month_11": "Nov",
  "chart.month_12": "Dec",
  "asset.stk": "Accións",
  "asset.fund": "Fondos / ETF",
  "asset.opt": "Opcións",
  "asset.fop": "Opcións sobre futuros",
  "asset.crypto": "Criptomoedas",
  "asset.bond": "Bonos",
  "option.expiration": "Vencemento",
  "option.close": "Peche anticipado",
  "option.exercise": "Exercicio/Asignación",

  "footer.docs": "Documentación",
  "footer.privacy": "Self-hosted · Privacidade total",
  "footer.disclaimer": "Aviso legal",

  "disclaimer.title": "Aviso legal",
  "disclaimer.text":
    "Esta ferramenta é meramente informativa e non constitúe asesoramento fiscal nin xurídico. Os resultados xerados deben ser verificados polo usuario e/ou un profesional cualificado antes de ser utilizados en calquera declaración tributaria.\n\nDeclaRenta non se responsabiliza de erros, omisións nin das consecuencias derivadas do uso desta información. O usuario é o único responsable da veracidade e exactitude dos datos introducidos e das declaracións presentadas ante a Axencia Tributaria.\n\nOs tipos de cambio proceden do Banco Central Europeo (BCE). Os cálculos fiscais baséanse na normativa vixente (LIRPF, Lei do Patrimonio, Orde EHA/3290/2008) pero poden non cubrir todos os supostos nin reflectir cambios normativos posteriores á última actualización do software.",
  "disclaimer.accept": "Entendido",

  "a11y.skip_link": "Saltar ao contido",
  "a11y.nav_label": "Axustes",
  "a11y.lang_label": "Idioma",
  "a11y.theme_toggle": "Cambiar tema",
  "a11y.drop_zone": "Zona de carga de ficheiros",
  "a11y.file_input": "Seleccionar ficheiros",
  "a11y.ops_search": "Buscar operacións por ISIN ou símbolo",
  "a11y.ops_search_brokers": "Buscar operacións por ISIN, símbolo ou broker",
  "a11y.ops_filter": "Filtrar operacións por resultado",
  "a11y.remove_file": "Quitar {{name}}",

  "theme.toggle": "Cambiar tema",

  // Wizard steps
  "wizard.step1": "Subir ficheiros",
  "wizard.step2": "Revisar e escoller método",
  "wizard.step3": "Resultados",
  "wizard.next": "Seguinte",
  "wizard.back": "Atrás",

  // Review step
  "review.title": "Resumo de datos cargados",
  "review.broker": "Broker",
  "review.trades_count": "Operacións",
  "review.dividends_count": "Dividendos",
  "review.date_range": "Rango de datas",
  "review.currencies": "Divisas",
  "review.no_data": "Non se detectaron operacións nos ficheiros subidos.",
  "review.file": "Ficheiro",

  // Config step
  "config.nif_label": "NIF (para Modelo 720/D-6):",
  "config.nif_placeholder": "12345678A",
  "config.generate_720": "Xerar ficheiro Modelo 720",
  "config.generate_d6": "Xerar guía D-6",

  // Expandable casillas
  "casilla.expand": "Ver detalle",
  "casilla.collapse": "Agochar detalle",
  "casilla.operations_in": "Operacións nesta casilla",
  "casilla.no_operations": "Sen operacións",
  "casilla.copy": "Copiar importe",
  "casilla.copied": "Copiado!",

  // Year comparison
  "compare.title": "Comparativa anual",
  "compare.no_data": "Procesa polo menos 2 exercicios para ver a comparativa.",
  "compare.year": "Exercicio",
  "compare.variation": "Variación",
  "compare.saved_reports": "Informes gardados",
  "compare.clear_history": "Borrar historial",
  "compare.clear_confirm": "Borrar todos os informes gardados?",
  "compare.transmission_value": "Valor de transmisión (transmisións, sen divisas)",
  "compare.acquisition_value": "Valor de adquisición (transmisións, sen divisas)",
  "compare.net_gain_loss": "Ganancia/Perda neta (transmisións, sen divisas)",

  "error.no_broker_detected":
    'Non se puido detectar o broker de "{{filename}}". Se é un informe de broker, selecciona o broker manualmente; se non o é, quítao da lista.',
  "error.empty_file":
    'O ficheiro "{{filename}}" está baleiro. Quítao da lista ou volve exportalo desde o teu broker.',
  "error.file_too_large":
    'O ficheiro "{{filename}}" supera o límite de {{limit}} MB e descartouse. Exporta un período máis curto ou divide o ficheiro.',
  "error.prefix": "Erro: ",

  "status.fetching_rates": "Obtendo tipos BCE para {{currencies}}...",
  "status.files_processed": "{{count}} ficheiro(s) procesado(s) — {{brokers}} — {{trades}} operacións",

  "sidebar.profile": "Perfil fiscal",
  "sidebar.renta": "Modelo 100 (Renda)",
  "sidebar.m720": "Modelo 720",
  "sidebar.m721": "Modelo 721",
  "sidebar.d6": "Modelo D-6",
  "sidebar.toggle": "Abrir/pechar menú",

  "profile.title": "Perfil fiscal",
  "profile.description": "Estes datos utilízanse para xerar os ficheiros dos modelos 720 e D-6. Gárdanse só neste navegador, nunca nun servidor.",
  "profile.section_personal": "Datos persoais",
  "profile.nif_label": "NIF/NIE:",
  "profile.nif_placeholder": "12345678Z",
  "profile.nif_invalid": "O NIF/NIE non é válido: revisa os díxitos e a letra de control.",
  "profile.surname_label": "Apelidos:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Nome:",
  "profile.name_placeholder": "Xoán",
  "profile.ccaa_label": "Comunidade Autónoma:",
  "profile.phone_label": "Teléfono:",
  "profile.phone_placeholder": "600123456",
  "review.autoconvert_label": "Procesar as autoconversións do bróker (AFx/FXCONV)",
  "review.autoconvert_detail":
    "Activado por defecto. Interactive Brokers non reconverte a euros ao vender unha acción, así que o saldo en divisa é real e convertelo despois xera unha ganancia ou perda patrimonial (art. 33.1 LIRPF). Desactívao só se o teu bróker fai un round-trip completo EUR↔divisa e queres ignorar o efecto da divisa.",
  "review.titulares_label": "Número de titulares:",
  "review.titulares_detail":
    "Se a conta ten varios titulares (p. ex. conta conxunta ou de gananciais), DeclaRenta divide todos os importes a partes iguais para amosar a parte que corresponde a cada contribuínte (Art. 11.3 LIRPF). Cada titular presenta a súa declaración individual pola súa parte.",
  "profile.saved": "Perfil gardado",
  "profile.clear_btn": "Borrar os meus datos deste navegador",
  "profile.clear_confirm": "Borrar deste navegador o teu perfil fiscal, os informes gardados e os valores introducidos a man?",
  "profile.incomplete_banner": "Completa o teu perfil fiscal para xerar os modelos 720 e D-6.",
  "profile.go_to_profile": "Ir ao perfil",

  // FX method (#434): review step, results header, comparison
  "method.multidivisa.sub": "A ganancia calcúlase na divisa da acción",
  "method.multidivisa.text": "Calcula a ganancia de cada acción na súa divisa e pásaa a euros ao tipo do día da venda. A divisa que tes garda o que che custou en euros. A súa diferenza de cambio sae cando a cambias a euros ou a outra divisa.",
  "method.multidivisa.basis": "Base legal: criterio de Facenda para accións (DGT V1740-17, V2422-20, V0282-22).",
  "method.tradicional_divisa.sub": "Compra e venda ao seu tipo, e a túa divisa por FIFO",
  "method.tradicional_divisa.text": "As accións valóranse ao tipo do BCE do día de compra e do día de venda. A divisa tributa só cando sae da túa conta: ao cambiala a euros ou a outra divisa, ao pagar comisións ou cando a perdes nunha venda con perdas. O que xa declaraches dentro das accións non se volve contar.",
  "method.tradicional_divisa.basis": "Valoración de accións: criterio da DGT para participacións de fondos en divisa (V2324-10, V0775-21), aplicado a accións. Divisa: declárase ao cambiala (V2466-08) ou ao perdela nunha venda con perdas (V0775-21, V2324-10).",
  "method.tradicional_divisa.risk": "Facenda aplica ás accións o «Criterio DGT (multidivisa)» (V1740-17). En 2025 rexeitou este mesmo cálculo para un piso comprado e vendido en dólares (V1615-25). Se revisa a túa declaración, pode recalculala con ese criterio. Sen vendas con perdas, o total dun ciclo completo adoita ser case o mesmo; cambia en que ano e en que casilla sae cada parte.",
  "method.monodivisa.sub": "Só compra e venda ao seu tipo",
  "method.monodivisa.text": "Valora a compra ao tipo do día de compra e a venda ao do día de venda. Non calcula ningún resultado de divisa, nin nos teus cambios a euros nin nos automáticos do bróker.",
  "method.monodivisa.basis": "Base legal: art. 35.1 LIRPF, sen a divisa do art. 14.2.e. Se cambias divisa a euros, pode distorsionar o resultado.",
  "method.monodivisa.risk": "Este método non declara o resultado dos teus cambios de divisa a euros. Úsao só se non cambias divisa.",
  "method.unknown": "descoñecido",
  "review.method_title": "Como calculamos as túas accións en divisa?",
  "review.method_lead": "Tes operacións en {{currencies}}. O método cambia as cifras da túa renda. Escolle un e mantéñeo todos os anos.",
  "review.method_recommended": "Recomendado",
  "review.method_last_year": "En {{year}} calculaches con «{{method}}».",
  "review.method_last_year_switch": "En {{year}} calculaches con «{{method}}». Se cambias de método e aínda tes divisa de entón, parte do resultado pode saír dúas veces ou perderse. Usa o mesmo método todos os anos.",
  "review.other_settings": "Outros axustes do cálculo",
  "review.autoconvert_off_mono": "Non se aplica con «Tradicional sen divisa (monodivisa)», porque ese método non calcula divisa.",
  "review.calculate": "Calcular",
  "review.calculate_with": "Calcular con «{{method}}»",
  "review.show_details": "Ver detalle",
  "results.method_chip": "Método: {{method}}",
  "results.method_change": "Cambiar",
  "results.method_change_aria": "Cambiar o método de cálculo",
  "results.titulares_one": "1 titular",
  "results.titulares_many": "{{count}} titulares",
  "results.autoconvert_chip": "Autoconversións: {{value}}",
  "results.how_title": "Como se calculou",
  "results.split_shares": "Accións",
  "results.split_shares_sub": "casillas 0328 e 0331",
  "results.split_securities": "Accións e outros valores",
  "results.split_securities_sub": "casillas 0328 e 0331, e parte de 1633 e 1637",
  "results.split_fx": "Divisa",
  "results.split_fx_sub": "incluída en 1633 e 1637",
  "results.split_fx_off": "non se calcula con este método",
  "results.split_total": "Total",
  "results.split_total_sub": "á base do aforro · cota estimada {{tax}} €",
  "results.compare_title": "Comparar cos outros métodos (para cadrar con outra ferramenta)",
  "results.compare_in_use": "En uso",
  "results.compare_tax": "Cota estimada",
  "results.compare_note": "Só informativo. Para cambiar de método, volve a «Revisar e escoller método».",
  "results.compare_loading": "Calculando…",
  "results.compare_error": "Non se puido calcular a comparación.",
  "casilla.acquisition_buy_rate_note_fx": "O valor de adquisición amósase ao tipo de cambio do BCE da data de COMPRA, como pide o método «Tradicional con divisa». Transmisión − adquisición é a ganancia ou perda da acción en euros. O resultado da divisa vai aparte, nas casillas 1633 e 1637.",
  "casilla.acquisition_buy_rate_note_mono": "O valor de adquisición amósase ao tipo de cambio do BCE da data de COMPRA, como pide o método «Tradicional sen divisa (monodivisa)». Transmisión − adquisición é a ganancia ou perda da acción en euros. Este método non calcula ningún resultado de divisa.",
  "casilla.no_other_elements_fx_below": "Sen outros elementos. O resultado de divisa está debaixo.",
  "compare.method": "Método",
  "compare.method_mismatch": "Estes anos usan métodos distintos. Se cambias de método e aínda tes divisa dun ano anterior, parte do resultado pode saír dúas veces ou perderse.",
  "profile.autosave": "Os cambios gárdanse sós neste navegador.",
  "profile.method_moved": "O método de divisa, os titulares e as autoconversións escóllense agora en Modelo 100, no paso «Revisar e escoller método».",
  "profile.go_to_renta": "Ir a Modelo 100",

  "guide.title": "Como obter o informe?",
  "guide.tip_fifo": "Inclúe todo o histórico — DeclaRenta necesita operacións anteriores para o cálculo FIFO correcto.",
  "guide.select_broker_hint": "Selecciona o teu broker para ver as instrucións de descarga do informe.",
  "guide.heading": "Como obter o informe do teu broker?",
  "guide.ibkr.title": "Interactive Brokers (Flex Query XML)",
  "guide.ibkr.step1": "Inicia sesión no <strong>Portal do Cliente</strong> de IBKR",
  "guide.ibkr.step2": "Vai a <strong>Rendemento e informes</strong> → pestana <strong>Consultas Flex</strong>",
  "guide.ibkr.step3":
    "En <strong>Consulta flex de actividade</strong>, fai clic no <strong>+</strong> para crear unha nova consulta",
  "guide.ibkr.step4":
    "Na configuración, activa as seccións:<ul><li><strong>Trades</strong> (obrigatorio)</li><li><strong>Cash Transactions</strong> — dividendos e retencións (obrigatorio)</li><li><strong>Open Positions</strong> — para Modelo 720/D-6 (recomendado)</li><li><strong>Financial Instrument Information</strong> (recomendado)</li></ul>",
  "guide.ibkr.step5":
    "En cada sección, <strong>selecciona todos os campos dispoñibles</strong> (marca todas as casillas). Cantos máis datos inclúas, máis preciso será o cálculo. Como mínimo asegúrate de incluír o campo <strong>Notes</strong> en Trades — é necesario para detectar conversións automáticas de divisa.",
  "guide.ibkr.step6": "Formato de saída: <strong>XML</strong>. En <em>Date Format</em>, deixa <strong>yyyyMMdd</strong>",
  "guide.ibkr.step7": "Inclúe <strong>todos os anos dispoñibles</strong> para o cálculo FIFO correcto",
  "guide.ibkr.step8": "Garda a consulta, execútaa e descarga o ficheiro <code>.xml</code>",
  "guide.degiro.title": "Degiro (CSV)",
  "guide.degiro.step1": "Inicia sesión na <strong>web de Degiro</strong> (non a app)",
  "guide.degiro.step2": "Abre o panel lateral <strong>Caixa de entrada</strong> (icona de sobre)",
  "guide.degiro.step3": "Fai clic en <strong>Transaccións</strong> (historial de transaccións dos teus produtos)",
  "guide.degiro.step4": "Selecciona o rango de datas desexado (inclúe <strong>todo o histórico</strong> para FIFO)",
  "guide.degiro.step5": "Fai clic en <strong>Exportar</strong> e descarga o ficheiro CSV",
  "guide.degiro.step6":
    "Para dividendos: volve ao <strong>Buz\u00f3n</strong> \u2192 <strong>Conta</strong> (historial de movementos da t\u00faa conta) \u2192 mesmo rango de datas \u2192 <strong>Exportar</strong> CSV",
  "guide.flatex.title": "Flatex (CSV)",
  "guide.flatex.step1": "Inicia sesi\u00f3n na <strong>web de Flatex</strong>",
  "guide.flatex.step2":
    "Vai a <strong>Movementos</strong> \u2192 <strong>Depotums\u00e4tze</strong> (movementos da carteira)",
  "guide.flatex.step3":
    "Selecciona <strong>todo o hist\u00f3rico</strong> (necesario para o c\u00e1lculo FIFO) e exporta o ficheiro CSV",
  "guide.flatex.step4":
    "Para dividendos: vai a <strong>Kontoums\u00e4tze</strong> (movementos da conta), mesmo rango de datas, e exporta o CSV. Ollo: aí os dividendos aparecen polo importe neto, xa descontada a retención; toma o importe íntegro e a retención do xustificante en PDF de cada dividendo",
  "guide.flatex.step5":
    "Sube <strong>ambos ficheiros</strong> CSV (Depotums\u00e4tze para operaci\u00f3ns e Kontoums\u00e4tze para dividendos)",
  "guide.etoro.title": "eToro (XLSX)",
  "guide.etoro.step1": "Inicia sesión en <strong>eToro</strong>",
  "guide.etoro.step2": "Vai a <strong>Axustes → Extracto de conta</strong>",
  "guide.etoro.step3": "Selecciona o período do exercicio fiscal",
  "guide.etoro.step4": "Descarga o ficheiro <strong>XLSX</strong> (Excel)",
  "guide.scalable.title": "Scalable Capital (CSV)",
  "guide.scalable.step1": "Inicia sesión en <strong>Scalable Capital</strong>",
  "guide.scalable.step2": "Vai a <strong>Perfil → Documentos fiscais</strong>",
  "guide.scalable.step3": "Descarga o informe de transaccións en formato <strong>CSV</strong>",
  "guide.freedom24.title": "Freedom24 (JSON)",
  "guide.freedom24.step1": "Inicia sesión na <strong>plataforma web de Freedom24</strong>",
  "guide.freedom24.step2": "Vai a <strong>Informes → Informe de operacións</strong>",
  "guide.freedom24.step3": "Selecciona o período e formato <strong>JSON</strong>",
  "guide.freedom24.step4": "Descarga o ficheiro",
  "guide.coinbase.title": "Coinbase (CSV)",
  "guide.coinbase.step1": "Inicia sesión en <strong>Coinbase</strong>",
  "guide.coinbase.step2": "Vai a <strong>Impostos → Documentos</strong>",
  "guide.coinbase.step3": "Fai clic en <strong>Xerar informe</strong>",
  "guide.coinbase.step4": "Descarga o historial de transaccións en formato CSV",
  "guide.binance.title": "Binance (CSV)",
  "guide.binance.step1": "Inicia sesión en <strong>Binance</strong>",
  "guide.binance.step2":
    "<strong>Historial de operacións spot:</strong> Pedidos → Orde spot → Exportar historial de operacións (↑) → Spot - Historial de Operacións → Personalizar tempo (UTC+1) → CSV",
  "guide.binance.step3":
    "<strong>Historial de transaccións:</strong> Pedidos → Historial de Activos → Exportar rexistros de transaccións (↑) → Historial de Transaccións → Personalizar tempo (UTC+1) → CSV",
  "guide.binance.step4": "Podes subir un ou ambos ficheiros — acéptanse tanto en castelán/galego como en inglés",
  "guide.kraken.title": "Kraken (CSV)",
  "guide.kraken.step1": "Inicia sesión en <strong>Kraken</strong>",
  "guide.kraken.step2": "Vai a <strong>History → Export</strong>",
  "guide.kraken.step3": "Selecciona <strong>Trades</strong> e o rango de datas",
  "guide.kraken.step4": "Formato: <strong>CSV</strong>, descarga o ficheiro",

  // Trade Republic
  "guide.trade_republic.title": "Trade Republic (CSV)",
  "guide.trade_republic.step1": "Abre a app de <strong>Trade Republic</strong>",
  "guide.trade_republic.step2": "Vai a <strong>Perfil → Actividade</strong>",
  "guide.trade_republic.step3": "Preme os tres puntos (⋯) e selecciona <strong>Exportar</strong>",
  "guide.trade_republic.step4": "Selecciona o rango de datas e formato <strong>CSV</strong>",
  "guide.trade_republic.step5": "Descarga o ficheiro e envíao ao teu ordenador",

  // Revolut
  "guide.revolut.title": "Revolut (XLSX)",
  "guide.revolut.step1": "Inicia sesión na <strong>web de Revolut</strong> (app.revolut.com ou app móbil)",
  "guide.revolut.step2": "Vai a <strong>Trading/Cripto → Extractos</strong>",
  "guide.revolut.step3": "Selecciona <strong>Trading Account Statement</strong> do exercicio fiscal",
  "guide.revolut.step4": "Descarga en formato <strong>XLSX</strong> (Excel)",

  // Trading 212
  "guide.trading212.title": "Trading 212 (CSV)",
  "guide.trading212.step1": "Inicia sesión na <strong>web de Trading 212</strong>",
  "guide.trading212.step2": "Vai a <strong>Historial → Transaccións</strong>",
  "guide.trading212.step3": "Filtra polo rango de datas desexado",
  "guide.trading212.step4": "Fai clic en <strong>Descargar CSV</strong>",

  // Lightyear
  "guide.lightyear.title": "Lightyear (CSV)",
  "guide.lightyear.step1": "Abre a app de <strong>Lightyear</strong>",
  "guide.lightyear.step2": "Vai a <strong>Perfil → Informes</strong>",
  "guide.lightyear.step3": "Selecciona <strong>Transaction report</strong> e o período",
  "guide.lightyear.step4": "Descarga o ficheiro CSV e envíao ao teu ordenador",

  // MEXEM
  "guide.mexem.title": "MEXEM (Flex Query XML)",
  "guide.mexem.step1": "Inicia sesión no <strong>Portal do Cliente</strong> de MEXEM (mesma interface que IBKR)",
  "guide.mexem.step2": "Vai a <strong>Rendemento e informes</strong> → pestana <strong>Consultas Flex</strong>",
  "guide.mexem.step3":
    "Crea unha <strong>Activity Flex Query</strong> incluíndo Trades, Cash Transactions e Open Positions",
  "guide.mexem.step4": "Formato de saída: <strong>XML</strong>",
  "guide.mexem.step5": "Executa a consulta e descarga o ficheiro <code>.xml</code>",

  // Swissquote
  "guide.swissquote.title": "Swissquote (CSV)",
  "guide.swissquote.step1": "Inicia sesión en <strong>Swissquote eBanking</strong>",
  "guide.swissquote.step2": "Vai a <strong>Trading → Historial de transaccións</strong>",
  "guide.swissquote.step3": "Selecciona o rango de datas do exercicio fiscal",
  "guide.swissquote.step4": "Fai clic en <strong>Exportar → CSV</strong>",

  "m720.title": "Modelo 720 — Bens no estranxeiro",
  "m720.description": "Declaración informativa sobre bens e dereitos situados no estranxeiro.",
  "m720.threshold_exceeded": "Segundo as túas posicións ({{amount}} €), estás obrigado a presentar o Modelo 720.",
  "m720.obliged_by_changes": "Estás obrigado a presentar o Modelo 720 polos cambios desde a túa última declaración: cada categoría de arriba indica o motivo.",
  "m720.declared_account_missing": "Unha conta que declaraches non ten saldo este ano ({{accounts}}): se a cancelaches, debes declarar a súa cancelación a man (art. 42 bis.5 RGAT).",
  "m720.threshold_not_exceeded":
    "Non superas o limiar de 50.000 € (total: {{amount}} €). Non estás obrigado a presentar.",
  "m720.category_v": "Valores (accións, fondos, bonos)",
  "m720.category_c": "Contas (saldos en efectivo)",
  "m720.category_exceeded": "Supera 50.000 € — obrigatorio declarar",
  "m720.category_not_exceeded": "Por debaixo do limiar",
  "m720.category_undetermined": "Non se pode determinar: {{count}} posición(s) sen valorar",
  "m720.no_positions": "Sube un informe con posicións abertas no Modelo 100 para analizar o Modelo 720.",
  "m720.brokers_without_holdings": "Os datos de {{brokers}} que subiches non inclúen as túas posicións nin saldos a 31 de decembro, así que non se suman aquí. Comproba no extracto de fin de ano de {{brokers}} se o saldo das túas contas ou o valor das túas accións e fondos no estranxeiro supera os 50.000 €.",
  "m720.positions_title": "Posicións declarables",
  "m720.positions_unvalued":
    "{{count}} posición(s) non se puideron valorar en euros (sen prezo de mercado ou sen tipo de cambio para a súa moeda ao peche do exercicio) e excluíronse do total. Calcula o seu valor en euros e inclúeas manualmente.",
  "m720.cash_title": "Saldos en efectivo (Contas)",
  "m720.q4_average": "Media Q4",
  "m720.cash_missing_average":
    "Algúns saldos non inclúen a media do cuarto trimestre obrigatoria para as contas do Modelo 720. O seu saldo a 31 de decembro si conta para o limiar de 50.000 €, pero esas contas non se inclúen no ficheiro xerado: engádeas a man, co seu saldo medio do cuarto trimestre, antes de presentar.",
  "m720.omitted_title":
    "Estes bens non caben no ficheiro e debes declaralos a man no formulario do Modelo 720:",
  "m720.omitted_no_isin":
    "non ten ISIN; no formulario identifícase con «Z» máis o código do país do emisor",
  "m720.omitted_no_country":
    "falta o país onde está depositado ou situado",
  "m720.omitted_no_account":
    "falta o número de conta",
  "m720.omitted_invalid_code":
    "vendido este ano; o Modelo 720 anterior declarouno cunha clave ou un país que o ficheiro non admite",
  "m720.not_generated_left_out":
    "Non se xerou ningún ficheiro: nada do que debes declarar pode escribirse no ficheiro. Decláralo a man no formulario do Modelo 720, seguindo os avisos de arriba.",
  "m720.successive_years_note":
    "Se xa presentaches o Modelo 720 nun ano anterior, só é obrigatorio volver presentalo cando o valor conxunto dunha categoría aumentou máis de 20.000 € respecto da última declaración, ou cando vendiches ou cancelaches un ben que declaraches (arts. 42 bis.5 e 42 ter.5 do RD 1065/2007). Se non, presentalo é opcional.",
  "m720.previous_title": "O teu último Modelo 720",
  "m720.previous_help": "Se xa presentaches o Modelo 720, sube o ficheiro .txt da túa última declaración. O que xa declaraches sairá con orixe M, o que vendiches con orixe C (baixa) e aplicarase a regra dos 20.000 €. O ficheiro lese no teu navegador e non se garda.",
  "m720.previous_loaded": "Cargado {{name}} (exercicio {{year}}): {{securities}} valores e {{accounts}} contas declarados.",
  "m720.previous_clear": "Quitar",
  "m720.previous_invalid": "Este ficheiro non é un Modelo 720: non ten ningún rexistro de detalle.",
  "m720.previous_same_year": "Este ficheiro é do exercicio {{fileYear}}. Sube o Modelo 720 dun exercicio anterior a {{year}}.",
  "m720.origin": "Orixe",
  "m720.origin_a": "A (alta)",
  "m720.origin_m": "M (xa declarado)",
  "m720.successive_last": "Última declaración: {{previous}} €. Variación: {{change}} €.",
  "m720.successive_increase": "Aumentou máis de 20.000 €: é obrigatorio volver declarar",
  "m720.successive_sold": "Vendiches valores que declaraches: é obrigatorio declarar as súas baixas",
  "m720.successive_optional": "Non aumentou máis de 20.000 €: volver declarala é opcional",
  "m720.successive_not_required": "Co teu último Modelo 720, este ano non estás obrigado a presentalo: ningunha categoría aumentou máis de 20.000 € e non vendiches nada do que declaraches. Podes presentalo se queres.",
  "m720.sold_title": "Baixas: valores vendidos desde o teu último Modelo 720",
  "m720.sold_help": "O ficheiro inclúeos con orixe C, coa data e o importe da última venda.",
  "m720.sold_no_date": "non hai ningunha venda en {{year}} das accións declaradas: a baixa sae sen data de extinción e con valoración 0; complétaa antes de presentar",
  "m720.sold_no_acquisition": "os datos non inclúen a súa compra: a baixa sae sen data de adquisición; complétaa antes de presentar",
  "m720.generate_btn": "Xerar ficheiro Modelo 720",
  "m720.deadline": "Prazo: 1 xaneiro – 31 marzo do ano seguinte",
  "m720.total_value": "Valor total: {{amount}} €",
  "m720.filing_title": "Como presentalo?",
  "m720.rates_title": "Tipos de cambio aplicados (BCE)",
  "m720.deadline_short": "Prazo: 1 xaneiro – 31 marzo",
  "m720.filing_step1": "Accede á Sede Electrónica da AEAT",
  "m720.filing_step2": "Busca «Modelo 720»",
  "m720.filing_step3": "Importa o ficheiro xerado (TGVI Online)",
  "m720.filing_step4": "Revisa e asina con certificado dixital ou Cl@ve",

  "d6.title": "Modelo D-6 — Investimentos no exterior",
  "d6.description": "Declaración ao Rexistro de Investimentos do Ministerio de Economía.",
  "d6.no_minimum":
    "Desde a Orde ICT/1408/2021, o D-6 só é obrigatorio se a túa participación representa o <strong>10% ou máis</strong> do capital ou dereitos de voto dunha empresa cotizada estranxeira. A maioría dos investidores minoristas están exentos.",
  "d6.no_positions": "Sube un informe con posicións abertas no Modelo 100 para analizar o D-6.",
  "d6.brokers_without_holdings": "Os datos de {{brokers}} que subiches non inclúen os teus valores a 31 de decembro, así que non aparecen aquí. Consúltaos no extracto de fin de ano de {{brokers}}.",
  "d6.positions_title": "Posicións a declarar",
  "d6.positions_unvalued":
    "{{count}} posición(s) non se puideron valorar en euros (sen prezo de mercado ou sen tipo de cambio para a súa moeda ao peche do exercicio) e excluíronse do total. Calcula o seu valor en euros e inclúeas manualmente.",
  "d6.cancellations_title": "Cancelacións",
  "d6.generate_btn": "Xerar guía D-6",
  "d6.deadline": "Prazo: 1 – 31 xaneiro do ano seguinte",
  "d6.total_value": "Valor total: {{amount}} €",
  "d6.aforix_title": "Guía AFORIX paso a paso",
  "d6.copy_btn": "Copiar",
  "d6.copied": "Copiado",
  "d6.rates_title": "Tipos de cambio aplicados (BCE)",
  "d6.deadline_short": "Prazo: 1 – 31 xaneiro",
  "d6.copy_failed": "Erro ao copiar",
  "d6.aforix_position_of": "Posición {{index}} de {{total}}",

  // Modelo 721 section
  "m721.title": "Modelo 721 — Criptomoedas no estranxeiro",
  "m721.description": "Declaración informativa sobre moedas virtuais situadas no estranxeiro.",
  "m721.threshold_exceeded": "Segundo as túas posicións ({{amount}} €), estás obrigado a presentar o Modelo 721.",
  "m721.threshold_not_exceeded":
    "Non superas o limiar de 50.000 € (total: {{amount}} €). Non estás obrigado a presentar.",
  "m721.threshold_undetermined":
    "Non se pode determinar se superas o limiar de 50.000 €: o total ({{amount}} €) non inclúe {{count}} posición(s) sen valorar. Valóraas antes de concluír que non debes presentar.",
  "m721.no_positions": "Sube un informe con posicións de criptomoedas no Modelo 100 para analizar o Modelo 721.",
  "m721.brokers_without_holdings": "Os datos de {{brokers}} que subiches non inclúen as túas criptomoedas a 31 de decembro, así que non se suman aquí. Comproba no extracto de fin de ano de {{brokers}} se as túas criptomoedas no estranxeiro superan os 50.000 €.",
  "m721.positions_title": "Posicións declarables",
  "m721.generate_btn": "Xerar ficheiro Modelo 721",
  "m721.deadline": "Prazo: 1 xaneiro – 31 marzo do ano seguinte",
  "m721.total_value": "Valor total: {{amount}} €",
  "m721.filing_title": "Como presentalo?",
  "m721.rates_title": "Tipos de cambio aplicados (BCE)",
  "m721.deadline_short": "Prazo: 1 xaneiro – 31 marzo",
  "m721.filing_step1": "Accede á Sede Electrónica da AEAT",
  "m721.filing_step2": "Busca «Modelo 721»",
  "m721.filing_step3": "Enche a declaración cos datos da táboa (formato oficial: XML, Orde HFP/886/2023)",
  "m721.filing_step4": "Revisa e asina con certificado dixital ou Cl@ve",
  "m721.exchange": "Exchange",
  "m721.format_notice":
    "O formato oficial da AEAT é XML (Orde HFP/886/2023). DeclaRenta só mostra unha revisión orientativa: a xeración oficial está desactivada ata implementar XML validado.",
  "m721.positions_unvalued":
    "{{count}} posición(s) non se puideron valorar en euros (sen prezo de mercado ou sen tipo de cambio para a súa moeda ao peche do exercicio) e excluíronse do total. Calcula o seu valor en euros e inclúeas manualmente.",
  "m721.empty_title": "Non hai posicións de criptomoedas",
  "m721.empty_description":
    "O Modelo 721 é unha declaración informativa obrigatoria se posúes criptomoedas en exchanges estranxeiros valoradas en máis de 50.000 €. Sube o teu informe do broker na sección Modelo 100 para que DeclaRenta calcule automaticamente se superas o limiar. Prazo: 1 de xaneiro – 31 de marzo.",
  "m721.empty_cta": "Ir a Modelo 100",
  "m721.profile_required": "Completa o teu perfil fiscal antes de xerar o ficheiro do Modelo 721.",

  "section.year_label": "Exercicio",
  "section.profile_source": 'Datos do <a href="#perfil">Perfil fiscal</a>',
  "section.positions_date_mismatch":
    "As posicións do teu ficheiro son a data {{date}}, non a 31/12/{{year}}. Estes modelos declaran o que tiñas a 31 de decembro, así que non se xera ningún ficheiro con elas. Descarga un informe que remate o 31/12/{{year}} (en IBKR, un Flex Query con data final 31/12/{{year}}) e súbeo de novo.",
  "section.positions_date_unknown":
    "O teu broker non indica a que data corresponden as posicións. Comproba que o informe reflicta o que tiñas a 31/12/{{year}}: se o descargaches máis tarde, as posicións e os seus valores poden non coincidir.",
  "merge.holdings_other_date":
    "Posicións e saldos da conta {{account}} a data {{date}} fóra dos modelos 720, 721 e D-6: non son os de 31/12/{{year}}.",
  "merge.holdings_other_date.hint":
    "Ese ficheiro remata noutra data. As súas operacións e movementos si se teñen en conta, pero estes modelos declaran o que tiñas a 31 de decembro, así que as súas posicións e saldos non se suman. Se che falta o informe desa conta a 31/12/{{year}}, súbeo tamén.",

  "badge.complete": "Completo",
  "badge.pending": "Pendente",
  "badge.not_applicable": "Non aplica",
  "badge.generated": "Xerado",

  // Empty states
  "m720.empty_title": "Non hai posicións cargadas",
  "m720.empty_description":
    "O Modelo 720 é unha declaración informativa obrigatoria se posúes bens no estranxeiro valorados en máis de 50.000 €. Sube o teu informe do broker na sección Modelo 100 para que DeclaRenta calcule automaticamente se superas o limiar e xere o ficheiro. Prazo: 1 de xaneiro – 31 de marzo.",
  "m720.empty_cta": "Ir a Modelo 100",
  "d6.empty_title": "Non hai posicións cargadas",
  "d6.empty_description":
    "O Modelo D-6 declara investimentos en valores estranxeiros ante o Ministerio de Economía. Desde a reforma de 2021 (Orde ICT/1408/2021), só é obrigatorio se a túa participación representa o 10% ou máis do capital ou dereitos de voto dunha empresa cotizada estranxeira. Sube o teu informe do broker na sección Modelo 100 e DeclaRenta xerará a guía paso a paso. Prazo: 1 – 31 de xaneiro.",
  "d6.empty_cta": "Ir a Modelo 100",

  // Profile required warnings
  "m720.profile_required": "Completa o teu perfil fiscal antes de xerar o ficheiro do Modelo 720.",
  "d6.profile_required": "Completa o teu perfil fiscal antes de xerar a guía D-6.",

  // Trust signal
  "footer.open_source": "100% código aberto",
  "footer.verify_source": "Verificar código fonte",

  // Splash screen
  "splash.tagline": "Ferramenta fiscal gratu\u00edta para investidores con brokers internacionais",
  "splash.feature_free": "100% gratuíto",
  "splash.feature_selfhosted": "Self-hosted",
  "splash.feature_privacy": "Privacidade total",
  "splash.feature_opensource": "Código aberto",
  "splash.cta": "Comezar",

  // Validation
  "validation.future_date": "A operaci\u00f3n de {{symbol}} ten data futura ({{date}}). Verifica os datos.",
  "validation.no_cash_transactions":
    "Non se atoparon transacci\u00f3ns de efectivo (dividendos/retenci\u00f3ns). Se usas IBKR, activa a secci\u00f3n Cash Transactions na t\u00faa Flex Query.",
  "validation.no_cash_degiro":
    "Non se atoparon dividendos nin retenci\u00f3ns. Degiro incl\u00faeos nun ficheiro separado: descarga tam\u00e9n o CSV de Conta (Account) desde o Buz\u00f3n.",
  "validation.no_cash_generic":
    "Non se atoparon transacci\u00f3ns de efectivo (dividendos/retenci\u00f3ns). Se o teu broker as exporta por separado, s\u00fabeas como ficheiro adicional.",
  "validation.no_trades_in_year":
    "Non hai operaci\u00f3ns no exercicio {{year}}. As operaci\u00f3ns anteriores \u00fasanse para o c\u00e1lculo FIFO.",
  "validation.very_old_data":
    "Os datos incl\u00faen operaci\u00f3ns desde {{year}} (m\u00e1is de 10 anos). Verifica que o ficheiro \u00e9 correcto.",
  "validation.duplicate_trades":
    "Detect\u00e1ronse {{count}} operaci\u00f3n(s) duplicada(s). Revisa se subiches o mesmo ficheiro d\u00faas veces.",

  // Operations annex
  "annex.title": "Anexo de operaci\u00f3ns (Anexo C1)",
  "annex.subtitle": "Detalle individual de operaci\u00f3ns agrupadas por tipo de activo.",
  "annex.operations": "operaci\u00f3n(s)",
  "annex.wash_blocked": "Perda bloqueada por recompra: {{amount}} EUR (art. 33.5 LIRPF)",
  "annex.wash_dates": "Compras do mesmo valor que a bloquean: {{dates}}",
  "annex.wash_hint":
    "En Renta Web, marca esta venda como «Perdas patrimoniais non imputables». A perda queda pendente: intégrase, primeiro as perdas máis antigas, a medida que vendas accións deste valor que ningunha recompra nos 2 meses anteriores ou posteriores (1 ano se o valor non cotiza nun mercado regulado do Espazo Económico Europeo nin noutro equivalente, como NYSE ou Nasdaq; nas criptomoedas, só o ano seguinte á venda, art. 33.5.e) cobre; se recompras parte, só contan as accións non recompradas. Nas criptomoedas, intégrase cando vendas as unidades recompradas, aínda que volvas comprar esa criptomoeda (art. 33.5.e); vender outras unidades non a integra.",
  "annex.wash_released": "Libera {{amount}} EUR de perdas diferidas deste valor (transmisión definitiva, art. 33.5 LIRPF)",
  "annex.wash_released_dates": "Perdas pendentes das vendas do: {{dates}}",
  "annex.wash_released_hint": "As accións desta venda que ningunha recompra no seu prazo cobre son unha transmisión definitiva: integran agora as perdas pendentes dese valor, a dunha acción por cada acción, primeiro as máis antigas (se a venda pecha a posición e ningunha recompra no seu prazo a cobre, todas as que queden). En Renta Web, impútaas neste exercicio.",
  "annex.wash_released_crypto": "Libera {{amount}} EUR de perdas diferidas desta criptomoeda (venda das unidades recompradas, art. 33.5.e LIRPF)",
  "annex.wash_released_hint_crypto":
    "Esta venda transmite unidades da recompra que bloqueou unha perda: integra agora a parte desa perda que corresponde ás unidades vendidas, aínda que volvas comprar esta criptomoeda (art. 33.5.e). Vender outras unidades non a integra. En Renta Web, impútaa neste exercicio.",

  // Tax bracket estimation
  "chart.tax_estimate": "Estimaci\u00f3n fiscal (base do aforro)",
  "tax.bracket_range": "Tramo",
  "tax.bracket_base": "Base",
  "tax.bracket_rate": "Tipo",
  "tax.bracket_tax": "Cota",
  "tax.total_estimated": "Total estimado",
  "tax.effective_rate": "Tipo efectivo",
  "tax.double_tax_deduction": "Deduci\u00f3n dobre imposici\u00f3n",
  "tax.disclaimer":
    "Estimaci\u00f3n orientativa. Os tramos corresponden \u00e1 base do aforro do IRPF vixente. Consulta cun asesor fiscal.",
  "tax.breakdown_capital_gains": "Ganancias patrimoniais",
  "tax.breakdown_fx_gains": "Ganancias por tipo de cambio",
  "tax.breakdown_dividends": "Dividendos",
  "tax.breakdown_interest": "Xuros",
  "tax.breakdown_blocked_losses": "Perdas bloqueadas (diferidas)",
  "tax.breakdown_reintegrated_losses": "Perdas diferidas que agora se integran",

  // Sidebar - guide
  "sidebar.guia": "Guía Renta Web",

  // Guía de cumplimentación (Renta Web)
  "guide_rw.title": "Guía de cumprimentación — Renta Web",
  "guide_rw.description": "Como cubrir cada casilla en Renta Web cos datos de DeclaRenta.",
  "guide_rw.intro":
    "Esta guía explica como trasladar os resultados de DeclaRenta a Renta Web (AEAT). Para cada apartado, indícase a casilla destino, que valor introducir e que opcións seleccionar nos despregables.",
  "guide_rw.capital_gains_title": "Ganancias e perdas patrimoniais (transmisións)",
  "guide_rw.fx_title": "Ganancias por tipo de cambio (moeda estranxeira)",
  "guide_rw.dividends_title": "Rendementos do capital mobiliario — Dividendos",
  "guide_rw.interest_title": "Rendementos do capital mobiliario — Xuros",
  "guide_rw.double_taxation_title": "Dedución por dobre imposición internacional",
  "guide_rw.entidad_emisora_label": "Entidade emisora",
  "guide_rw.entidad_emisora_value":
    "Nome da empresa ou do valor que vendes (ex. Apple Inc.), non o do broker. En divisas, a moeda (ex. USD). Se consolidas varias operacións nunha soa liña, indica o valor principal.",
  "guide_rw.tipo_elemento_label": "Tipo de elemento patrimonial",
  "guide_rw.tipo_elemento_value_capital":
    "Selecciona <strong>«Accións admitidas a negociación»</strong> para accións cotizadas. Para fondos: «Participacións en IIC». Para derivados/opcións: «Outros elementos patrimoniais».",
  "guide_rw.tipo_elemento_value_fx": "Selecciona <strong>«Outros elementos patrimoniais — Divisas»</strong>.",
  "guide_rw.clave_prereq_title": "A casa do valor de transmisión está bloqueada?",
  "guide_rw.clave_prereq_hint":
    "En Renta Web, as casas <strong>1633</strong> (valor de transmisión) e <strong>1637</strong> (valor de adquisición) <strong>aparecen deshabilitadas ata que enchas antes estes campos, nesta orde</strong>:<br>1) Casa <strong>1626 «Tipo de elemento patrimonial. Clave»</strong> → para divisas e opcións adoita ser a clave <strong>4</strong> («Outros elementos patrimoniais non afectos a actividades económicas»); para cripto, revisa a clave que o exercicio asigne ás moedas virtuais. Os fondos de investimento (IIC) <strong>non</strong> usan a clave 4: decláranse como «Participaciones en IIC».<br>2) <strong>«Tipo de transmisión»</strong> → <strong>«Transmisión intervivos onerosa (venda, permuta, etc.)»</strong> — é <strong>onerosa</strong>, non lucrativa/gratuíta.<br>3) <strong>Data de transmisión</strong> (casas <strong>1631/1632</strong>) → día/mes/ano da venda.<br>4) <strong>Data de adquisición</strong> (casa <strong>1932</strong>) → día/mes/ano da compra.<br>Unha vez enchidos, as casas 1633 e 1637 actívanse e poderás escribir os importes. <em>O número exacto de casa pode variar segundo o exercicio.</em>",
  "guide_rw.gastos_transmision_label": "Gastos da transmisión",
  "guide_rw.gastos_adquisicion_label": "Gastos da adquisición",
  "guide_rw.gastos_zero":
    "<strong>0</strong> — DeclaRenta xa inclúe as comisións nos valores de transmisión/adquisición. Non engadas gastos por separado.",
  "guide_rw.gastos_label": "Gastos de administración e depósito",
  "guide_rw.valor_transmision_label": "Valor de transmisión",
  "guide_rw.valor_adquisicion_label": "Valor de adquisición",
  "guide_rw.valor_transmision_hint":
    "O importe da casilla <strong>0328</strong> de DeclaRenta (EUR, comisións xa incluídas).",
  "guide_rw.valor_adquisicion_hint":
    "O importe da casilla <strong>0331</strong> de DeclaRenta (EUR, comisións xa incluídas).",
  "guide_rw.fx_valor_transmision_hint": "O importe da casilla <strong>1633</strong> de DeclaRenta.",
  "guide_rw.fx_valor_adquisicion_hint": "O importe da casilla <strong>1637</strong> de DeclaRenta.",
  "guide_rw.fecha_transmision_label": "Data de transmisión",
  "guide_rw.fecha_adquisicion_label": "Data de adquisición",
  "guide_rw.fecha_hint_individual":
    "Se introduces operación a operación, usa a data exacta do informe. Se consolidas todas nunha liña, usa <strong>31/12/AAAA</strong> (transmisión) e <strong>01/01/AAAA</strong> (adquisición).",
  "guide_rw.fx_fecha_hint":
    "Para a consolidación de FX: <strong>01/01/AAAA</strong> (adquisición) e <strong>31/12/AAAA</strong> (transmisión). Se introduces operación a operación, usa as datas reais do informe.",
  "guide_rw.retenciones_label": "Retencións",
  "guide_rw.retenciones_zero": "Normalmente <strong>0</strong> para emisores estranxeiros (a súa retención estranxeira vai na casilla 0588). PERO se tes accións <strong>españolas</strong> (ISIN ES…) nun bróker estranxeiro, a súa retención do 19% SI é un pagamento a conta español e vai na <strong>casilla 0597</strong>.",
  "guide_rw.importe_label": "Ingresos íntegros",
  "guide_rw.dividends_importe_hint": "O importe bruto da casilla <strong>0029</strong> de DeclaRenta (EUR).",
  "guide_rw.interest_importe_hint": "O importe da casilla <strong>0027</strong> de DeclaRenta (EUR).",
  "guide_rw.dt_pais_label": "País de orixe",
  "guide_rw.dt_pais_hint":
    "Selecciona o país onde se practicou a retención (ex. Estados Unidos, Irlanda, Alemaña…). Se tes retencións de varios países, engade unha liña por cada un.",
  "guide_rw.dt_importe_label": "Importe da dedución",
  "guide_rw.dt_importe_hint":
    "O importe da casilla <strong>0588</strong> de DeclaRenta. É o menor entre a retención estranxeira pagada e a cota española correspondente (Art. 80 LIRPF).",
  "guide_rw.dt_campo_label": "En que campo do cadro?",
  "guide_rw.dt_campo_hint":
    "No cadro de dobre imposición, cubre DÚAS filas por cada país:<br>• <strong>«Outros rendementos netos reducidos obtidos no estranxeiro»</strong> (2ª fila) → a columna «Bruto EUR» dese país no detalle da casilla 0588 de DeclaRenta. Se só hai un país, é a fila «Total rendementos estranxeiros» dese detalle. Non inclúe os dividendos españois nin os de países sen retención.<br>• <strong>«Imposto satisfeito no estranxeiro»</strong> (última fila) → a dedución dese país no mesmo detalle (cun só país, o importe da casilla 0588).<br>Se deixas a 2ª fila baleira, Renta Web amosa o aviso «Reflectiu o imposto sen facer constar as rendas». As filas 1 e 3 quedan a 0.",
  "guide_rw.capital_gains_note":
    "Se tes moitas operacións, podes consolidalas nunha soa liña por tipo de activo usando as datas xenéricas 01/01 e 31/12. Renta Web acepta importes agregados.",
  "guide_rw.fx_note":
    "As ganancias por tipo de cambio decláranse aparte das ganancias de valores. Aparecen cando convertes divisa a euros ou a outra divisa (p. ex. USD→GBP) —incluídas as conversións automáticas do teu bróker (p. ex. AFx/FXCONV en IBKR)—, non só nas conversións manuais. Co «Criterio DGT (multidivisa)», mentres manteñas a divisa (p. ex. compras e vendes accións en USD sen pasar a euros), a diferenza de cambio queda diferida ata que a convertes efectivamente, a euros ou a outra divisa (Art. 14.2.e LIRPF). Con «Tradicional sen divisa (monodivisa)» esta sección non aplica. Con «Tradicional con divisa», a variación do tipo de cambio mentres tes as accións xa vai dentro da súa ganancia ou perda (casillas 0328/0331). Só queda diferida a variación mentres tes a divisa en efectivo. A divisa tamén sae cando pagas comisións ou a perdes nunha venda con perdas.",
  "guide_rw.dividends_note":
    "Os dividendos de brokers estranxeiros non levan retención española. A retención estranxeira (withholding tax) NON se pon aquí: dedúcese aparte na casilla 0588 (dobre imposición).",
  "guide_rw.interest_note":
    "Os xuros do broker (remuneración de saldo) decláranse como rendementos do capital mobiliario. Os xuros de marxe pagados NON son deducibles (Art. 26.1.a LIRPF).",
  "guide_rw.double_taxation_note":
    "A dedución por dobre imposición evita pagar dúas veces impostos sobre os mesmos dividendos. Limítase ao menor entre o pagado na orixe e a cota española. Se o convenio de dobre imposición permite un tipo máximo inferior (ex. 15% EUA), só é deducible ata ese límite.",
  "guide_rw.blocked_losses_title": "Perdas bloqueadas (anti-churning)",
  "guide_rw.blocked_losses_hint":
    "Se DeclaRenta amosa perdas bloqueadas, marca a casilla <strong>«Perdas patrimoniais non imputables»</strong> en Renta Web. Bloquéanse porque recompraches o mesmo valor nos 2 meses anteriores ou posteriores á venda (1 ano se o valor non cotiza nun mercado regulado do Espazo Económico Europeo nin noutro equivalente, como NYSE ou Nasdaq). Nas criptomoedas, só se bloquean se recompras a mesma criptomoeda no ano seguinte á venda (art. 33.5.e); as compras anteriores á venda non contan. DeclaRenta aplica 2 meses a todo valor con ISIN, agás que IBKR só o mostre nun mercado sen equivalencia (Londres desde 2021, SIX desde xullo de 2019, OTC Markets…) ou que ti o marques con 1 ano no panel «Prazo anti-churning por valor» dos resultados (na liña de comandos, --antichurning-1y). Toronto, Tokio e Singapur teñen unha decisión de equivalencia e DeclaRenta aplícalles 2 meses, aínda que ningunha consulta da DGT o confirma para accións. Se o teu valor só cotiza nun mercado sen equivalencia e DeclaRenta non o sabe, márcao con 1 ano; se tamén cotiza nun mercado regulado do Espazo Económico Europeo ou nun equivalente, márcao con 2 meses. Unha compra dos 2 meses anteriores non bloquea se foi a única compra dese valor nese prazo e ao comezalo non tiñas accións dese valor (excepción de compra única, DGT V3282-18); as compras dos 2 meses posteriores seguen bloqueando, agás a que só pecha unha posición curta, que non é unha recompra. Ata a 0.66.13, DeclaRenta non aplicaba esta excepción: se presentaches un ano con esa perda bloqueada, podes corrixir aquel ano para deducila (2024 e posteriores: autoliquidación rectificativa; 2023 e anteriores: solicitude de rectificación). Non se suman ao custo da nova posición: quedan pendentes e intégranse, primeiro as máis antigas, a medida que vendas accións dese valor que ningunha recompra nese prazo cobre (transmisión definitiva); se recompras parte, só contan as accións non recompradas. Nas criptomoedas, intégrase cando vendas as unidades recompradas, aínda que volvas comprar esa criptomoeda (art. 33.5.e); vender outras unidades non a integra. Se declaraches un ano con DeclaRenta 0.66.5 ou anterior, esas versións liberaban unha perda ao vender as accións recompradas aínda que volveses recomprar: se xa deduciches esa perda, non a deduzas outra vez cando DeclaRenta a libere agora, ou corrixe aquel ano (2024 e posteriores: autoliquidación rectificativa; 2023 e anteriores: autoliquidación complementaria). E ao revés: se DeclaRenta libera agora unha perda nun ano que xa presentaches coa 0.66.5 ou anterior, podes corrixir aquel ano para deducila (2024 e posteriores: autoliquidación rectificativa; 2023 e anteriores: solicitude de rectificación). Nas criptomoedas, se declaraches un ano con DeclaRenta 0.66.13 ou anterior, unha compra anterior á venda podía bloquear a perda: se DeclaRenta deduce ou libera agora unha perda de criptomoedas nun ano que xa presentaches, corrixe aquel ano para deducila (2024 e posteriores: autoliquidación rectificativa; 2023 e anteriores: solicitude de rectificación); se non, non se deduce nunca. Sempre que corrixas un ano para deducir unha perda, revisa tamén os anos posteriores que xa presentaches: se nalgún deduciches esa mesma perda porque a versión anterior a liberaba nese ano, corrixe tamén ese ano para quitala (2024 e posteriores: autoliquidación rectificativa; 2023 e anteriores: autoliquidación complementaria), para non deducila dúas veces: unha perda só se deduce unha vez.",
  "guide_rw.closing_tip": "Tras introducir todos os datos, usa o botón «Verificar declaración» de Renta Web para comprobar erros. Se outra ferramenta amosa un importe distinto en ganancias patrimoniais, pode usar outro método para as accións en divisa. Nos resultados do Modelo 100, abre «Comparar cos outros métodos» para ver as cifras dos tres. Para cambiar de método, volve ao paso «Revisar e escoller método». Usa o mesmo método todos os anos.",

  // PDF report
  "pdf.subtitle": "Informe fiscal — Exercicio",
  "pdf.generated": "Xerado o",
  "pdf.informative": "Informativo",
  "pdf.blocked_losses": "Perdas bloqueadas anti-churning",
  "pdf.interest_margin": "Xuros marxe (non deducible)",
  "pdf.section_casillas": "1. Resumo de Caixas — Modelo 100",
  "pdf.section_operations": "2. Detalle de Operacións",
  "pdf.section_dividends": "3. Dividendos",
  "pdf.section_dt": "4. Dedución por Dobre Imposición Internacional",
  "pdf.section_warnings": "Advertencias",
  "pdf.reintegrated_losses": "Perdas reintegradas (anti-churning)",
  "pdf.dt_paid": "Imposto pagado",
  "pdf.dt_allowed": "Dedución permitida",
  "pdf.ecb_note":
    "Tipo ECB: tipo de cambio oficial do Banco Central Europeo (EUR por 1 unidade de divisa estranxeira) na data da operación. Fonte: ECB SDMX API.",
  "pdf.footer":
    "DeclaRenta — https://declarenta.com — Este informe é orientativo e non substitúe o asesoramento fiscal profesional.",

  // Manual crypto valuation
  "crypto_rates.title": "Valoración manual de criptomoedas",
  "crypto_rates.description":
    "Algúns intercambios entre criptomoedas non se puideron valorar automaticamente porque ningunha das dúas divisas ten un tipo de cambio oficial do BCE. Introduce o valor en euros por unidade na data da operación para incluílos.",
  "crypto_rates.help":
    "Nunca consultamos prezos de criptomoedas en internet: a túa carteira mantense privada. Busca ti mesmo o valor en euros (p. ex. no historial do teu exchange ou nunha web de prezos) e introdúceo aquí.",
  "crypto_rates.col_asset": "Activo",
  "crypto_rates.col_date": "Data",
  "crypto_rates.col_quantity": "Cantidade",
  "crypto_rates.col_currency": "Moeda",
  "crypto_rates.col_eur_per_unit": "EUR por unidade",
  "crypto_rates.placeholder": "p. ex. 142,50",
  "crypto_rates.save_btn": "Gardar e recalcular",
  "crypto_rates.saved": "Gardado",
  "crypto_rates.recalculate_hint": "Os valores gárdanse no teu navegador e o informe recalcúlase.",
  "crypto_rates.stored_title": "Prezos manuais gardados",
  "crypto_rates.stored_description":
    "Estes prezos en euros están gardados no teu navegador e aplícanse cada vez que procesas un ficheiro. Corrixe un valor e garda, ou bórraos todos se algún é erróneo.",
  "crypto_rates.clear_btn": "Borrar prezos gardados",

  // Manual opening lots for transferred positions
  "opening_lots.title": "Lotes manuais para posicións transferidas",
  "opening_lots.description":
    "Se unha venda corresponde a accións transferidas desde outro broker, podes introducir aquí os lotes de compra orixinais para que o FIFO calcule correctamente o custo base.",
  "opening_lots.help":
    "Engade tantos lotes como necesites. Cada fila representa unha compra previa distinta coa súa propia data, cantidade e prezo por acción. Os datos gárdanse só no teu navegador.",
  "opening_lots.effect_hint":
    "Se o resultado baixa despois de introducir estes lotes, é normal: antes esa venda estaba a calcularse con custo base = 0.",
  "opening_lots.group_intro":
    "Faltan {{quantity}} títulos para a venda do {{date}}. Introduce os lotes previos que cobren esa posición transferida.",
  "opening_lots.group_intro_saved":
    "Estes lotes manuais están gardados no teu navegador e seguirán aplicándose mentres non os borres.",
  "opening_lots.col_acquire_date": "Data de compra",
  "opening_lots.col_quantity": "Cantidade",
  "opening_lots.col_price": "Prezo por acción",
  "opening_lots.col_actions": "Accións",
  "opening_lots.placeholder_quantity": "p. ex. 14",
  "opening_lots.placeholder_price": "p. ex. 100,00",
  "opening_lots.add_row": "Engadir lote",
  "opening_lots.remove_row": "Quitar",
  "opening_lots.save_btn": "Gardar lotes e recalcular",
  "opening_lots.clear_btn": "Borrar lotes gardados",
  "opening_lots.saved": "Gardado",
  "opening_lots.row_invalid":
    "Revisa as filas marcadas: indica a data de compra e unha cantidade e un prezo maiores ca cero (p. ex. 1.234,56). Non se gardou nada.",
  "opening_lots.recalculate_hint": "Os lotes manuais gárdanse no teu navegador e o informe recalcúlase.",

  // Mensaxes do motor e dos analizadores (TaxMessage id → texto localizado)
  "fx.missing_prior_lots":
    "⚠ {{count}} disposicións de {{currency}} sen lotes previos suficientes (total: {{totalQuantity}} {{currency}}). Posible adquisición anterior ao período declarado — ganancia de cambio asumida = 0.",
  "fx.missing_prior_lots.hint":
    "A adquisición desta divisa foi anterior ao período do Flex Query. Asúmese unha ganancia de cambio = 0 (tratamento conservador).",
  "fx.conservation_mismatch":
    "⚠ Descadre interno do motor de divisa para {{currency}}: {{mismatch}} unidades sen cadrar. As casas 1633/1637 poden non reconciliar.",
  "fx.conservation_mismatch.hint":
    "Isto é unha comprobación interna (non debería ocorrer). Se o ves, repórtao en GitHub achegando o informe; os importes de divisa poden necesitar revisión manual.",
  "fifo.unknown_category":
    '⚠ Categoría de activo descoñecida: "{{assetCategory}}" para {{symbol}}. Procesarase con FIFO xenérico.',
  "fifo.unknown_category.hint":
    "Procésase igualmente con FIFO xenérico. Se é un activo novo de IBKR, pode que se engada en versións futuras.",
  "fifo.scrip_dividend": "📈 Scrip dividend: {{symbol}} +{{quantity}} accións o {{date}}",
  "fifo.scrip_dividend.hint": "O scrip dividend engadiuse como lote cun custo igual ao valor do dividendo.",
  "fifo.roll_operation": "⚠ Operación C;O (roll): {{symbol}} o {{date}}. Procésase como peche + apertura.",
  "fifo.roll_operation.hint":
    "Operación roll procesada correctamente como peche da posición anterior e apertura da nova.",
  "fifo.unknown_direction": '⚠ Operación con dirección descoñecida ("{{buySell}}"): {{symbol}} o {{date}}. Non se procesou.',
  "fifo.unknown_direction.hint": "Só se procesan compras (BUY) e vendas (SELL). Revisa esta fila no ficheiro do broker e, se é unha operación real, corrixe a súa dirección.",
  "fifo.split_applied": "⚡ Split {{isin}} {{ratio}} ({{direction}}) aplicado ({{date}})",
  "fifo.split_applied.hint": "Split aplicado a todos os lotes. O custo total mantense — só cambia o número de accións.",
  "fifo.split_unresolved": "⚠ Split de {{symbol}} o {{date}} sen aplicar: non hai accións anteriores coas que calcular a proporción.",
  "fifo.split_unresolved.hint":
    "Sube tamén os extractos de anos anteriores, dende a apertura da conta. Se non, o número de accións e o custo das vendas posteriores deste valor non serán correctos.",
  "fifo.merger_applied":
    "🔄 Fusión: {{oldIsin}} → {{newIsin}} (ratio {{ratio}}, {{lotsTransferred}} lotes transferidos, {{date}})",
  "fifo.merger_applied.hint":
    "Fusión fiscalmente neutra: os lotes transfírense ao novo ISIN conservando o custo base orixinal.",
  "fifo.cash_merger_disposal":
    "💶 Compra en efectivo: {{symbol}} ({{isin}}) × {{quantity}} o {{date}}. Declárase como unha venda.",
  "fifo.cash_merger_disposal.hint":
    "Unha fusión ou adquisición pagada en efectivo é unha transmisión: a ganancia ou perda calcúlase como nunha venda, co efectivo recibido como valor de transmisión.",
  "fifo.spinoff_applied":
    "🔀 Spin-off: {{parentIsin}} → {{newIsin}} (ratio {{ratio}}, custo {{costPercent}}% ao spin-off, {{date}})",
  "fifo.spinoff_applied.hint": "O custo repártese proporcionalmente entre a matriz e a empresa escindida.",
  "fifo.corporate_action_unhandled":
    "ℹ Acción corporativa {{type}} de {{symbol}} ({{isin}}) o {{date}}: non se aplica ao cálculo FIFO.",
  "fifo.corporate_action_unhandled.hint":
    "Se cambiou o número de accións ou o ISIN da posición, revisa o custo das vendas posteriores deste valor.",
  "fifo.sell_without_lots":
    "⚠ Venda sen lotes: {{symbol}}{{isinSuffix}} × {{quantity}} o {{date}}. Custo base = 0 (posible posición curta ou datos previos incompletos).",
  "fifo.sell_without_lots.hint":
    "A túa exportación inclúe os anos anteriores? Descarga do teu broker un período que cubra desde a primeira compra deste valor.",
  "fifo.cover_without_lots":
    "⚠ Peche de curto sen lotes: {{symbol}} ({{isin}}) × {{quantity}} o {{date}}. Ganancia non calculada (posición curta aberta fóra do período ou datos previos incompletos).",
  "fifo.cover_without_lots.hint":
    "Incluíches os anos anteriores no teu Flex Query? Selecciona un período que cubra desde a venda que abriu esta posición curta.",
  "fifo.insufficient_lots": "⚠ Lotes insuficientes: {{symbol}}{{isinSuffix}} × {{quantity}} o {{date}}. Custo base = 0.",
  "fifo.insufficient_lots.hint":
    "O ficheiro non cobre todas as compras previas deste valor. Exporta desde o teu broker un período máis amplo.",
  "fifo.option_invalid_date": "⚠ Evento OptionEAE sen data válida para {{symbol}}. Omitido.",
  "fifo.option_invalid_date.hint":
    "Evento de opción omitido por data inválida. Revisa que o Flex Query inclúe a sección 'Option Exercises, Assignments & Expirations'.",
  "fifo.option_zero_quantity": "⚠ Evento OptionEAE con cantidade 0 para {{symbol}} o {{date}}. Omitido.",
  "fifo.option_zero_quantity.hint": "Evento de opción con cantidade 0 — probablemente un rexistro duplicado de IBKR.",
  "fifo.option_invalid_strike": '⚠ Strike inválido "{{strike}}" para {{symbol}} o {{date}}. Omitindo o exercicio.',
  "fifo.option_invalid_strike.hint":
    "Non se puido calcular o exercicio desta opción. O custo do subxacente non incluirá a prima.",
  "fifo.option_expiry_no_lots": "⚠ Expiración de opción sen lotes: {{symbol}} × {{quantity}} o {{date}}.",
  "fifo.option_expiry_no_lots.hint":
    "A opción expirou pero non se atoparon lotes de compra. Incluíches o ano de compra no Flex Query?",
  "fifo.option_exercise_no_lots":
    "⚠ Exercicio/asignación sen lotes de opción: {{symbol}} × {{quantity}} o {{date}}. Custo de prima = 0.",
  "fifo.option_exercise_no_lots.hint":
    "Exercicio rexistrado con prima = 0 porque non se atopou a compra da opción. Amplía o período do Flex Query.",
  "fifo.exercise_no_underlying_lots":
    "⚠ Exercicio de opción sen lotes do subxacente: {{symbol}} × {{quantity}} o {{date}}. Custo base = 0.",
  "fifo.exercise_no_underlying_lots.hint":
    "Asignación de PUT rexistrada con custo base = 0 do subxacente. O Flex Query pode non cubrir a adquisición orixinal.",
  "fifo.insufficient_underlying_lots":
    "⚠ Lotes insuficientes do subxacente: {{symbol}} × {{quantity}} o {{date}}. Custo base = 0.",
  "fifo.insufficient_underlying_lots.hint":
    "Non hai lotes suficientes do subxacente para cubrir a asignación completa.",
  "report.crypto_valuation_unresolved":
    "Hai {{count}} operación(s) en criptomoeda cuxo valor en euros non se puido determinar automaticamente e excluíronse dos cálculos.",
  "report.crypto_valuation_unresolved.hint":
    "Ocorre en permutas cripto-cripto (p. ex. Binance Convert) cando ningunha das dúas moedas ten tipo de cambio oficial do BCE. Introduce manualmente o valor en euros por unidade de cada moeda na data indicada para incluír estas operacións.",
  "report.crypto_commission_neutralized":
    "Ignorouse a comisión de {{count}} operación(s) por estar denominada nunha criptomoeda sen tipo de cambio dispoñible.",
  "report.crypto_commission_neutralized.hint":
    "O valor principal da operación si se calculou; só se omite a pequena comisión, cuxo impacto fiscal é mínimo.",
  "report.crypto_income_unvalued":
    "Hai {{count}} ingreso(s) en criptomoeda (p. ex. recompensas de staking) que non se puideron valorar automaticamente e non se inclúen nos importes calculados.",
  "report.crypto_income_unvalued.hint":
    "Estes ingresos páganse na propia cripto e non teñen tipo de cambio oficial do BCE. Calcula o seu valor en euros na data de cobramento e decláraos manualmente como rendementos do capital mobiliario (Casa 0027).",
  "report.dividend_unvalued":
    "Hai {{count}} dividendo(s) en {{currencies}} que non se puideron valorar automaticamente e non se inclúen nos importes calculados.",
  "report.dividend_unvalued.hint":
    "O BCE non publica un tipo de cambio oficial para esa divisa na data de cobramento. Calcula o importe en euros nesa data, súmao a man á casilla 0029 e ten en conta a súa retención na dedución por dobre imposición internacional (casilla 0588).",
  "report.withholding_corrected_prior_year":
    "Este ficheiro trae correccións de retencións na orixe de {{year}} anotadas en {{reportYear}}: a retención de {{year}} baixa {{amount}} €. Se presentaches {{year}} coa retención orixinal, a casilla 0588 dese ano puido saír alta.",
  "report.withholding_corrected_prior_year.hint":
    "A dedución por dobre imposición internacional (casilla 0588, art. 80 LIRPF) só admite o imposto pagado de verdade no estranxeiro. Sube o ficheiro de {{year}} xunto con este e calcula {{year}}: DeclaRenta suma a corrección á retención do seu dividendo. Se a casilla 0588 baixa respecto da que presentaches, corrixe a declaración de {{year}} (2024 e posteriores: autoliquidación rectificativa; 2023 e anteriores: autoliquidación complementaria). As casillas de {{reportYear}} non cambian.",
  "report.spanish_withholding_corrected_prior_year":
    "Este ficheiro trae correccións de retencións españolas de {{year}} anotadas en {{reportYear}}: a retención de {{year}} baixa {{amount}} €. Se presentaches {{year}} coa retención orixinal, a casilla 0597 dese ano puido saír alta.",
  "report.spanish_withholding_corrected_prior_year.hint":
    "A retención española sobre dividendos de emisores españois é un pagamento a conta (casilla 0597, retencións do capital mobiliario) e só conta o retido de verdade. Sube o ficheiro de {{year}} xunto con este e calcula {{year}}: DeclaRenta suma a corrección á retención do seu dividendo. Se a casilla 0597 baixa respecto da que presentaches, corrixe a declaración de {{year}} (2024 e posteriores: autoliquidación rectificativa; 2023 e anteriores: autoliquidación complementaria). As casillas de {{reportYear}} non cambian.",
  "report.crypto_general_gain_unvalued":
    "Hai {{count}} ganancia(s) patrimonial(is) en criptomoeda (p. ex. airdrops ou comisións de referidos) que non se puideron valorar automaticamente e non se inclúen nos importes calculados.",
  "report.crypto_general_gain_unvalued.hint":
    "Estas rendas recíbense na propia cripto e non teñen tipo de cambio oficial do BCE. Calcula o seu valor en euros na data de cobramento e decláraas manualmente como ganancia patrimonial non derivada de transmisión (base xeral).",
  "report.antichurning_window_past_data":
    "Hai {{count}} venda(s) de {{year}} cuxo prazo de recompra da regra anti-churning (2 meses; 1 ano se o valor non cotiza nun mercado regulado do Espazo Económico Europeo nin noutro equivalente; nas criptomoedas, só o ano seguinte á venda) remata despois da última data que cobren os ficheiros subidos dese bróker ({{lastDate}}). DeclaRenta non ve as compras posteriores a esa data.",
  "report.antichurning_window_past_data.hint":
    "Se compraches o mesmo valor despois do {{lastDate}} e dentro do prazo desas vendas (como moi tarde, ata o {{windowEnd}}), parte da súa perda pode quedar bloqueada, ou a venda deixa de ser unha transmisión definitiva e non libera perdas pendentes. Sube tamén o ficheiro coas operacións ata o {{windowEnd}} xunto con este e calcula de novo. Ese prazo é de 1 ano nos valores aos que DeclaRenta aplica 1 ano (porque IBKR só os mostra nun mercado sen equivalencia, como Londres desde 2021, SIX ou OTC Markets, ou porque ti os marcaches) e de 2 meses nos demais valores con ISIN. Se un valor só cotiza nun mercado así e DeclaRenta lle aplica 2 meses, márcao con 1 ano no panel «Prazo anti-churning por valor» (na liña de comandos, --antichurning-1y) e calcula de novo. Nas criptomoedas só contan as compras da mesma criptomoeda, en calquera exchange, feitas despois da venda e, como moi tarde, ata o {{windowEnd}}; as anteriores á venda non contan. Se non compraches, o cálculo xa é correcto.",
  "report.antichurning_window_open_at_filing":
    "Hai {{count}} venda(s) de {{year}} cuxo prazo de recompra da regra anti-churning remata o {{windowEnd}} como moi tarde: despois do {{deadline}}, último día para presentar a declaración, e despois da última data que cobren os ficheiros subidos dese bróker ({{lastDate}}). Cando presentes a declaración, ese prazo seguirá aberto.",
  "report.antichurning_window_open_at_filing.hint":
    "Antes de presentala, sube tamén o ficheiro coas túas operacións posteriores ao {{lastDate}} e calcula de novo. Se compras o mesmo valor ou a mesma criptomoeda ata o {{windowEnd}} incluído, parte da perda desas vendas pode quedar bloqueada, ou a venda deixa de ser unha transmisión definitiva e non libera perdas pendentes. Nese caso, corrixe a declaración presentada cunha autoliquidación rectificativa.",
  "report.antichurning_one_year_ibkr":
    "DeclaRenta aplica a {{count}} valor(es) o prazo de 1 ano da regra anti-churning (art. 33.5.g LIRPF), porque IBKR só os mostra nun mercado que non é un mercado regulado do Espazo Económico Europeo nin un mercado declarado equivalente pola Comisión Europea: {{list}}.",
  "report.antichurning_one_year_ibkr.hint":
    "IBKR só mostra o mercado das liñas que operaches. Se o valor tamén está admitido a negociación nun mercado regulado do Espazo Económico Europeo (non abonda un mercado de crecemento nin outro sistema multilateral de negociación) ou en NYSE, Nasdaq, ASX ou a Bolsa de Hong Kong, correspóndenlle 2 meses: márcao con 2 meses no panel «Prazo anti-churning por valor» (na liña de comandos, --antichurning-2m) e calcula de novo.",
  "report.antichurning_listing_open":
    "DeclaRenta aplica 2 meses a {{count}} valor(es) que IBKR mostra en Toronto, TSX Venture, Aequitas Neo, Tokio ou Singapur: {{list}}. Unha decisión da Comisión Europea declara ese mercado equivalente a un mercado regulado, e a DGT acepta ese tipo de decisión (consulta V0778-25), pero ningunha consulta o confirma para accións.",
  "report.antichurning_listing_open.hint":
    "Se prefires o criterio prudente, márcao con 1 ano no panel «Prazo anti-churning por valor» (na liña de comandos, --antichurning-1y) e calcula de novo.",
  "report.antichurning_window_user":
    "Fixaches a man o prazo da regra anti-churning de {{count}} valor(es). 1 ano: {{oneYear}}. 2 meses, en lugar do ano que daba IBKR: {{twoMonths}}.",
  "report.antichurning_window_user.hint":
    "DeclaRenta usa o teu prazo en lugar do automático no bloqueo de perdas, na proba de transmisión definitiva e nos avisos de prazo. Podes cambialo no panel «Prazo anti-churning por valor» (na liña de comandos, --antichurning-1y ou --antichurning-2m).",
  "antichurning_window.title":
    "Prazo anti-churning por valor",
  "antichurning_window.description":
    "A regra anti-churning bloquea unha perda se recompras o mesmo valor nos 2 meses anteriores ou posteriores á venda (art. 33.5.f LIRPF). Se o valor non está admitido a negociación nun mercado regulado do Espazo Económico Europeo nin nun mercado declarado equivalente, o prazo é de 1 ano (art. 33.5.g). DeclaRenta escolle o prazo co mercado que mostra IBKR e, se non o sabe, aplica 2 meses. Aquí podes fixalo para cada valor.",
  "antichurning_window.col_security":
    "Valor",
  "antichurning_window.col_listing":
    "Mercado segundo IBKR",
  "antichurning_window.col_window":
    "Prazo",
  "antichurning_window.months_2":
    "2 meses",
  "antichurning_window.months_12":
    "1 ano",
  "antichurning_window.opt_auto":
    "Automático ({{window}})",
  "antichurning_window.opt_2m":
    "2 meses: admitido nun mercado regulado do EEE ou nun equivalente",
  "antichurning_window.opt_1y":
    "1 ano: non admitido nun mercado regulado do EEE nin nun equivalente (p. ex. só en Londres desde 2021, SIX, OTC ou BME Growth)",
  "antichurning_window.no_listing":
    "sen dato",
  "antichurning_window.open_note":
    "Equivalencia pola Decisión {{decision}}, sen confirmar para accións",
  "antichurning_window.save_btn":
    "Gardar e recalcular",
  "antichurning_window.clear_btn":
    "Borrar os prazos gardados",
  "antichurning_window.saved":
    "Gardado",
  "antichurning_window.recalculate_hint":
    "Os prazos gárdanse no teu navegador e o informe recalcúlase.",
  "antichurning_window.save_error":
    "O navegador non deixou gardar os prazos: o seu almacenamento pode estar cheo ou bloqueado. O informe non cambiou.",
  "antichurning_window.clear_error":
    "O navegador non deixou borrar os prazos gardados: o seu almacenamento pode estar bloqueado. O informe non cambiou.",
  "report.antichurning_single_purchase":
    "En {{count}} venda(s) de {{year}}, a compra dos 2 meses anteriores non conta como recompra: foi a única compra dese valor nese prazo e ao comezar o prazo non tiñas accións dese valor (excepción de compra única, DGT V3282-18). Esa compra non bloquea a súa perda nin impide que a venda libere perdas pendentes.",
  "report.antichurning_single_purchase.hint":
    "DeclaRenta só ve os ficheiros subidos. Se ao comezar o prazo (o primeiro comeza o {{windowStart}}) tiñas accións dese valor noutro bróker ou conta que non subiches, ou despois as traspasaches a outra entidade, a excepción non se aplica: sube tamén eses ficheiros e calcula de novo. Unha compra nos 2 meses posteriores á venda segue bloqueando a perda.",
  "report.antichurning_single_purchase_unverified":
    "En {{count}} venda(s) de {{year}} pode aplicarse a excepción de compra única da regra dos 2 meses, pero DeclaRenta non a aplica: os ficheiros subidos non demostran que ao comezar o prazo (o primeiro comeza o {{windowStart}}) non tiveses accións dese valor. A compra dos 2 meses anteriores conta como recompra.",
  "report.antichurning_single_purchase_unverified.hint":
    "Se ao comezar o prazo non tiñas accións dese valor en ningún bróker, e nos 2 meses anteriores á venda só fixeches esa compra, esa compra non conta como recompra (DGT V3282-18). DeclaRenta só a aplica cando os teus ficheiros o demostran, conta por conta: os ficheiros de cada conta que ten ou move ese valor deben cubrir as súas operacións sen ocos nin días repetidos desde o {{windowStart}} ata unhas posicións a fin de período con data igual ou posterior á venda (en IBKR, as seccións Trades e Open Positions da Flex Query, co campo ISIN), con todas as cantidades lexibles e coas mesmas accións que deixan as operacións desa conta. Unha operación de accións sen ISIN nese período, ou unhas accións sen ISIN que aínda tiveses ao comezalo (por exemplo, de Revolut), en calquera conta, tamén o impiden, porque poden ser dese valor. Un ficheiro que só inclúe operacións non abonda, e un traspaso entre contas ou un lote manual dentro dese prazo non se pode comprobar.",
  "report.titularidad_compartida":
    "Os importes amosados están divididos entre {{titulares}} titulares (a parte que corresponde a cada contribuínte). Este informe reflicte a declaración dun SÓ titular: cada un dos {{titulares}} titulares debe presentar a súa propia declaración con esta mesma parte. Non declares o total nunha soa declaración nin sumes as partes de varios titulares na túa.",
  "report.titularidad_compartida.hint":
    "O reparto a partes iguais ({{titulares}} × {{percent}} %) presupón titularidade por igual. Se as porcentaxes de titularidade son distintas (p. ex. 70/30), axusta os importes manualmente. En contas de gananciais a atribución é 50/50 (Art. 11.3 LIRPF). Podes cambiar o número de titulares no paso «Revisar e escoller método» (na liña de comandos, --titulares).",
  "report.competitor_reconciliation":
    "Se outra ferramenta amosa un importe distinto, pode deberse a que non calcula as ganancias por tipo de cambio (Art. 33.1 LIRPF).",
  "report.competitor_reconciliation.hint":
    "Podes comparar con outro método no paso «Revisar e escoller método» (na liña de comandos, --fx-method). «Tradicional con divisa» valora as accións ao tipo do día de compra e ao do día de venda, e tamén calcula a túa divisa. «Tradicional sen divisa (monodivisa)» valora as accións igual, pero non calcula ningún resultado de divisa, tampouco nas conversións USD→EUR.",
  "report.monodivisa_conversions_skipped":
    "O método «Tradicional sen divisa (monodivisa)» deixou sen calcular {{count}} conversión(s) de divisa deste exercicio (manuais ou automáticas do bróker). Este método non calcula ningún resultado de divisa (casillas 1633/1637).",
  "report.monodivisa_conversions_skipped.hint":
    "Se convertiches divisa (por exemplo, de USD a EUR), escolle «Tradicional con divisa» no paso «Revisar e escoller método» (na liña de comandos, --fx-method tradicional-divisa). Valora as accións igual e si calcula as túas conversións. O «Criterio DGT (multidivisa)» tamén as calcula.",
  "report.fx_method_consistency":
    "DeclaRenta calcula co «Criterio DGT (multidivisa)»: a ganancia de divisa difírese ata que convertes a moeda estranxeira a euros (Art. 14.2.e LIRPF; DGT V0152-26). Hai outros dous métodos: «Tradicional con divisa» e «Tradicional sen divisa (monodivisa)».",
  "report.fx_method_consistency.hint":
    "Non mestures métodos entre exercicios: se un ano declaraches con outro criterio (ou con outra ferramenta), a base de divisa arrastrada pode duplicarse ou omitirse. Para a divisa adquirida antes do período do teu informe, inclúe os anos anteriores na exportación do bróker.",
  "report.fx_deferred_no_conversion":
    "Non convertiches divisa a euros este exercicio, polo que non hai ganancia por tipo de cambio que declarar (non se suma ningún importe de divisa ás casillas 1633/1637). A diferenza de cambio mentres mantés a moeda queda diferida ata que a convertas efectivamente a euros (Art. 14.2.e LIRPF; DGT V0152-26).",
  "report.fx_deferred_no_conversion.hint":
    "O teu bróker (p. ex. IBKR) pode amosar unha «realized forex gain» aínda que non pasaras a euros: usa o criterio fiscal dos EUA, non o español. Co «Criterio DGT (multidivisa)», a ganancia de divisa só se declara ao cambiala a euros ou a outra divisa.",
  "report.fx_traditional_method":
    "Método «Tradicional con divisa». As accións en divisa valóranse ao tipo do BCE do día de compra (custo) e do día de venda (venda). A divisa tributa por FIFO cando sae da túa conta: ao cambiala a euros ou a outra divisa, ao pagar comisións ou xuros, ou ao perdela nunha venda con perdas. Unha venda devólveche a divisa investida e, se gañas, a ganancia. A divisa investida custa o que che custou, máis a variación do tipo de cambio entre a compra e a venda das accións, que xa vai no resultado desa venda. A ganancia entra ao tipo do día da venda. A divisa investida que non recuperas tributa á parte, nesa venda. Así cada variación da divisa declárase unha soa vez.",
  "report.fx_traditional_method.hint":
    "A DGT valora así as participacións de fondos en divisa (V2324-10, V0775-21). Para accións, Facenda calcula a ganancia en divisa e pásaa a euros ao tipo do día da venda (V1740-17, V2422-20, V0152-26): é o «Criterio DGT (multidivisa)». Nos dous métodos, a divisa que cambias tributa ao cambiala (V2466-08). A divisa perdida nunha venda con perdas tributa o ano da venda, como nos fondos (V0775-21, V2324-10). Autodeclaro describe a mesma valoración de accións, cos tipos de cambio do extracto do teu bróker, pero non publica como calcula a divisa. Usa o mesmo método todos os anos.",
  "report.fx_traditional_risk":
    "Facenda aplica ás accións o «Criterio DGT (multidivisa)» (V1740-17). En 2025 rexeitou este mesmo cálculo para un piso en dólares (V1615-25). Se revisa a túa declaración, pode recalculala con ese criterio.",
  "report.fx_traditional_risk.hint":
    "Se no ciclo completo (euros → divisa → accións → divisa → euros) non hai vendas con perdas, os dous métodos adoitan dar case o mesmo total. Cambia en que ano e en que casilla sae cada parte, e tamén pode cambiar a dedución por dobre imposición (casilla 0588). Con vendas con perdas, este método declara tamén a divisa perdida e o total é distinto. Ningunha consulta da DGT avala este método para accións. Se Facenda recalcula, pode cobrar xuros de demora polo imposto que este método leva a un ano posterior.",
  "report.fx_traditional_no_conversion":
    "Este ano non cambiaches divisa. A variación do {{ccy}} mentres tiñas as accións xa está na súa ganancia ou perda. A variación mentres tes os {{ccy}} en efectivo declararase cando os cambies.",
  "report.fx_traditional_no_conversion.hint":
    "Con este método, a divisa só se suma ás casillas 1633/1637 cando sae da túa conta: cambios a euros ou a outra divisa, comisións, xuros pagados e divisa perdida en vendas con perdas.",
  "report.fx_traditional_lost_dollars":
    "En {{n}} venda(s) con perdas recuperaches menos {{ccy}} dos que investiras. Eses {{ccy}} perdidos saen da túa conta. A súa diferenza de cambio, desde que os compraches ata que compraches as accións ({{amount}} €), declárase este ano nas casillas 1633/1637.",
  "report.fx_traditional_lost_dollars.hint":
    "O «Criterio DGT (multidivisa)» non declara nada neste caso, porque eses {{ccy}} nunca se cambiaron a euros. Este método si o declara, como a DGT nos fondos en divisa (V0775-21, V2324-10): a variación da divisa antes da compra tributa o ano da venda. A orde FIFO decide que {{ccy}} se perderon. Verás isto no detalle das casillas 1633/1637 como «Divisa perdida nunha venda con perdas».",
  "report.fx_traditional_guard":
    "En {{n}} venda(s), a caída do {{ccy}} desde a compra das accións supera o que che custou esa divisa. A súa diferenza de cambio ata a compra das accións ({{amount}} €) declárase este ano nas casillas 1633/1637, e eses {{ccy}} volven ao tipo do día da venda.",
  "report.fx_traditional_guard.hint":
    "Pasa cando o tipo de cambio se move moito (máis ou menos o dobre) entre a compra da divisa e a venda das accións. Sen esta regra, eses {{ccy}} terían un custo negativo. Verás isto no detalle das casillas 1633/1637 como «Variación da divisa ata a compra das accións».",
  "report.fx_traditional_inflight":
    "Este ano cambiaches {{qty}} {{ccy}} que veñen de vendas de accións de {{years}}. Este método dá por feito que a variación do {{ccy}} mentres tiñas esas accións ({{amount}} €) xa se declarou dentro da ganancia ou perda daquel ano.",
  "report.fx_traditional_inflight.hint":
    "É así se aquel ano usaches «Tradicional con divisa» ou «Tradicional sen divisa (monodivisa)». Se usaches o «Criterio DGT (multidivisa)», o teu resultado de divisa deste ano está desviado nesa cantidade. Usa o mesmo método ca entón.",
  "report.fx_traditional_uncovered":
    "{{qty}} {{ccy}} usados en compras de accións non teñen orixe en euros nos teus ficheiros (depósitos, saldos anteriores, anos que non subiches, ou un descuberto ou préstamo de marxe do bróker). Tómanse ao tipo do día de compra, sen diferenza de cambio anterior.",
  "report.fx_traditional_uncovered.hint":
    "Se cambiaches euros a {{ccy}} ata 7 días despois da compra, úsase o tipo dese cambio. Se coñeces a súa orixe, sube tamén os anos anteriores.",
  "report.fx_traditional_uncovered_ibkr":
    "{{qty}} {{ccy}} usados en compras de accións non teñen orixe en euros nos teus ficheiros (depósitos, saldos anteriores, anos que non subiches, ou un descuberto ou préstamo de marxe do bróker). Tómanse ao tipo do día de compra, sen diferenza de cambio anterior.",
  "report.fx_traditional_uncovered_ibkr.hint":
    "Se cambiaches euros a {{ccy}} ata 7 días despois da compra, úsase o tipo dese cambio. Se coñeces a súa orixe, sube tamén os anos anteriores. Se o teu saldo en {{ccy}} quedou en negativo (descuberto ou marxe), sube o extracto de IBKR coa sección «Cash Report». DeclaRenta trata ese saldo negativo como un préstamo en {{ccy}} só se o Cash Report cadra coas túas operacións, é dunha soa conta e non hai en {{ccy}} depósitos, retiradas, transferencias, opcións nin posicións curtas.",
  "report.fx_traditional_opening":
    "{{qty}} {{ccy}} do saldo inicial da túa conta (o «Cash Report» de IBKR) usáronse en compras de accións e non teñen orixe en euros nos teus ficheiros. Tómanse ao tipo do día de compra, sen diferenza de cambio anterior.",
  "report.fx_traditional_opening.hint":
    "Ese saldo xa estaba na conta ao comezar o primeiro período que subiches. Se coñeces a súa orixe, sube tamén os anos anteriores.",
  "report.fx_traditional_orphan":
    "A diferenza de cambio de {{qty}} {{ccy}} investidos en {{security}} non se puido asignar a ningunha venda (posible cambio de ISIN, fusión ou escisión). Revísaa a man.",
  "report.fx_traditional_orphan.hint":
    "Eses {{ccy}} usáronse para comprar {{security}}. A 31 de decembro xa non tes esas accións e ningunha venda os recuperou. A súa variación desde que compraches os {{ccy}} ata que compraches as accións ({{amount}} €) non se declarou.",
  "report.fx_loan_repayment":
    "Este ano devolviches {{ccy}} que che prestou o bróker (o teu saldo en {{ccy}} estivo en negativo). DeclaRenta declara {{amount}} € por esas devolucións nas casillas 1633/1637. A variación da propia débeda, desde que se abriu ata que a devolviches, é de {{gain}} € de ganancia e {{loss}} € de perda.",
  "report.fx_loan_repayment.hint":
    "O Tribunal Supremo (STS 71/2021, ECLI:ES:TS:2021:345) leva a variación dun préstamo en moeda estranxeira á base xeral. A DGT lévaa á base do aforro (V2414-12), como fai DeclaRenta. Se segues o Supremo, declara a ganancia na casilla 0304 e a perda na casilla 0305, e quítaas das casillas 1633/1637: baixa o valor de transmisión (1633) na ganancia e súbeo na perda. DeclaRenta só trata o saldo negativo como préstamo cando o informe de efectivo (Cash Report) de IBKR cadra coas túas operacións.",
  "report.fx_loan_repayment_manual":
    "Este ano devolviches {{ccy}} que che prestou o bróker (o teu saldo en {{ccy}} estivo en negativo). DeclaRenta declara {{amount}} € por esas devolucións nas casillas 1633/1637. A variación da propia débeda, desde que se abriu ata que a devolviches, é de {{gain}} € de ganancia e {{loss}} € de perda.",
  "report.fx_loan_repayment_manual.hint":
    "O Tribunal Supremo (STS 71/2021, ECLI:ES:TS:2021:345) leva a variación dun préstamo en moeda estranxeira á base xeral. A DGT lévaa á base do aforro (V2414-12), como fai DeclaRenta. Se segues o Supremo, declara a ganancia na casilla 0304 e a perda na casilla 0305. Desas cifras, só {{boxGain}} € de ganancia e {{boxLoss}} € de perda están nas casillas 1633/1637: baixa o valor de transmisión (1633) nesa ganancia e súbeo nesa perda. O resto non está nas casillas 1633/1637, senón dentro do resultado doutras operacións (por exemplo, a venda das accións que compraches co préstamo), e DeclaRenta non pode dicirche que casilla corrixir: cádrao a man antes de presentar a declaración. DeclaRenta só trata o saldo negativo como préstamo cando o informe de efectivo (Cash Report) de IBKR cadra coas túas operacións.",
  "report.fx_method_name.multidivisa":
    "Criterio DGT (multidivisa)",
  "report.fx_method_name.tradicional-divisa":
    "Tradicional con divisa",
  "report.fx_method_name.monodivisa":
    "Tradicional sen divisa (monodivisa)",
  "report.settings_line":
    "Axustes do cálculo: método {{method}}, titulares {{titulares}}, autoconversións {{autoconvert}}",
  "report.non_finite_total":
    "Detectouse un valor non finito (NaN/Infinito) nun total calculado; revisa os arquivos importados.",
  "report.non_finite_total.hint":
    "É posible que un arquivo dun bróker teña un importe corrupto ou un formato numérico inesperado. Revisa as operacións de orixe.",
  "flatex.lagerstellenwechsel.unmatched":
    "Traspaso de custodia (Lagerstellenwechsel) sen contrapartida para {{isin}}: {{netQuantity}} títulos.",
  "flatex.lagerstellenwechsel.unmatched.hint":
    "Un traspaso sen parella entrou ou saíu do depósito sen prezo de adquisición. Se máis tarde vendes estes títulos, revisa que o valor de compra orixinal estea incluído para non declarar unha ganancia ficticia.",
  "flatex.commission.unmatched_trades":
    "Non se puideron emparellar todas as comisións de Flatex: faltan os apuntamentos de caixa correspondentes.",
  "flatex.commission.unmatched_trades.hint":
    "Sobe tamén o CSV de Kontoumsätze (movementos de conta) xunto co de Depotumsätze para que a comisión de cada operación se teña en conta (sumándose ao custo de adquisición nas compras e restándose do valor de transmisión nas vendas).",
  "flatex.commission.cross_currency":
    "Operacións de Flatex sen comisión calculada: {{trades}}. O apuntamento de caixa está nunha moeda distinta á da operación.",
  "flatex.commission.cross_currency.hint":
    "A comisión desas operacións deixouse en 0. Consulta o seu importe na liquidación da orde en Flatex e tena en conta ao revisar a declaración: súmase ao valor de adquisición nas compras e réstase do valor de transmisión nas vendas.",
  "flatex.commission.multi_fill_prorated":
    "Ordes de Flatex executadas en varias partes: {{orders}}. A súa comisión repartiuse entre as execucións en proporción ao seu importe.",
  "flatex.commission.multi_fill_prorated.hint":
    "Flatex liquidou esas ordes cun número de apuntamentos de caixa distinto ao de execucións, polo que non se pode saber que comisión corresponde a cada unha. O total de comisións de cada orde é exacto; só o reparto entre execucións é aproximado.",
  "flatex.depot.repeated_fills":
    "Operacións de Flatex repetidas e contadas unha soa vez: {{fills}}. Tiñan o mesmo número de orde e de apuntamento (TA-Nr.) que outra xa cargada.",
  "flatex.depot.repeated_fills.hint":
    "Adoita pasar ao subir o mesmo CSV de Depotumsätze dúas veces, ou dúas exportacións con datas que se solapan. Se de verdade son operacións distintas, revisa o ficheiro: Flatex dá a cada execución o seu propio TA-Nr.",
  "flatex.dividends.net_amounts":
    "Flatex anota os dividendos polo importe neto cobrado, xa descontada a retención, e o CSV de Kontoumsätze non inclúe a retención.",
  "flatex.dividends.net_amounts.hint":
    "Toma o importe íntegro e a retención de cada cobro do xustificante en PDF que Flatex deixa na túa caixa de documentos, e corrixe a man as casillas 0029 (importe íntegro), 0588 (retención estranxeira) e 0597 (retención española).",
  "degiro.rows_skipped": "Omitíronse {{count}} filas sen ISIN/sen importe.",
  "degiro.rows_skipped.hint":
    "Estas filas tiñan cantidade ou prezo pero faltáballes o ISIN ou o importe, polo que non se puideron incluír como operacións. Adoita indicar que as columnas do CSV non se recoñeceron ben: volve exportar o CSV de Transaccións de Degiro sen modificar as cabeceiras.",
  "degiro.corporate_action_pair":
    "Posible operación societaria o {{date}}: {{oldProduct}} ({{oldIsin}}) → {{newProduct}} ({{newIsin}}). Degiro anótaa como unha venda e unha compra.",
  "degiro.corporate_action_pair.hint":
    "Degiro anota os cambios de ISIN, os splits e os canxes de accións como unha venda do valor antigo e unha compra do novo, sen número de orde nin custos. DeclaRenta calcúlaos así: declara unha ganancia ou perda ese día, e as accións novas toman ese prezo e esa data como custo. Revisa a comunicación de Degiro ou do emisor. Se foi un simple cambio de ISIN, un split ou un canxe fiscalmente neutro (réxime especial da Lei do Imposto sobre Sociedades), non houbo venda: as accións novas conservan o custo e a data de compra das antigas, así que corrixe esa operación na túa declaración. Se foi un canxe que tributa (art. 37.1.e LIRPF), o cálculo é correcto.",
  "degiro.transaction_tax": "Imposto sobre as transaccións financeiras pagado en {{product}} ({{isin}}): {{amount}} {{currency}}.",
  "degiro.transaction_tax.hint":
    "Degiro cobra este imposto ao comprar accións españolas, francesas ou italianas e só o mostra no CSV de Conta. Forma parte do valor de adquisición (art. 35.1.b LIRPF): súmao ao custo das compras dese valor, porque DeclaRenta non o engade automaticamente.",
  "binance.unparseable_timestamp":
    "Omitíronse {{count}} fila(s) do CSV de Binance por ter unha data/hora (UTC_Time) non recoñecible.",
  "binance.unparseable_timestamp.hint":
    "Adoita deberse a un ficheiro modificado manualmente ou exportado de forma incompleta. Volve descargar o informe orixinal desde Binance sen editalo para que esas operacións se inclúan.",
  "binance.unhandled_operation":
    "Omitíronse {{count}} movemento(s) do CSV de Binance con operacións non recoñecidas: {{operations}}.",
  "binance.unhandled_operation.hint":
    "Estes movementos non se incluíron no cálculo. Se son compras, vendas ou ingresos (p. ex. futuros, pagamentos con Binance Card, Auto-Invest ou cashback), engádeos á man na túa declaración e comunica o nome da operación para que se poida incorporar.",
  "binance.unsupported_pair":
    "Omitíronse {{count}} operación(s) do CSV de Binance cun par non recoñecido: {{pairs}}.",
  "binance.unsupported_pair.hint":
    "Estas operacións non se incluíron no cálculo. Engádeas á man na túa declaración e comunica o par para que se poida incorporar.",
  "etoro.closed_types_skipped":
    "Omitíronse {{count}} posición(s) pechada(s) de eToro dun tipo non admitido: {{types}}.",
  "etoro.closed_types_skipped.hint":
    "DeclaRenta aínda non importa estes tipos de posición de eToro (p. ex. criptomoedas). A súa ganancia ou perda non está incluída no cálculo: engádea á man na túa declaración co importe investido e o beneficio que mostra eToro.",
  "lightyear.unknown_types":
    "Omitíronse {{count}} fila(s) do CSV de Lightyear cun tipo de movemento non recoñecido: {{types}}.",
  "lightyear.unknown_types.hint":
    "Estes movementos non se incluíron no cálculo. Se son desdobramentos (splits), traspasos de accións ou outras operacións societarias, revísaos á man: poden cambiar o número de accións ou o custo de adquisición de vendas posteriores.",
  "coinbase.rewards_income_classification":
    'Clasificáronse {{count}} ingreso(s) de tipo "Rewards Income" de Coinbase como rendementos do capital mobiliario (base do aforro).',
  "coinbase.rewards_income_classification.hint":
    "Se parte deses importes son recompensas promocionais ou cashback de tarxeta (non rendementos por manter ou ceder cripto), o seu tratamento correcto sería ganancia patrimonial non derivada de transmisión (base xeral). Revisa a súa natureza se a cantidade é significativa.",
  "coinbase.unknown_types_skipped":
    "Omitíronse {{count}} fila(s) de Coinbase cun tipo de operación non recoñecido: {{types}}.",
  "coinbase.unknown_types_skipped.hint":
    "Estas filas non se tiveron en conta no cálculo. Se algunha é unha venda, unha compra, un pagamento con cripto ou unha recompensa, engádea manualmente para que a súa ganancia, o seu custo de adquisición ou o seu rendemento conten.",
  "coinbase.advanced_trade_quote_leg_missing":
    "{{count}} operación(s) de Advanced Trade de Coinbase pagáronse ou cobráronse nunha moeda distinta da de valoración ({{pairs}}); só se rexistrou a criptomoeda comprada ou vendida, non a moeda de contrapartida.",
  "coinbase.advanced_trade_quote_leg_missing.hint":
    "Nestes pares tamén transmites (ao comprar) ou adquires (ao vender) a moeda de cotización, sexa outra criptomoeda ou unha divisa, e esa operación tamén tributa. Engade manualmente a venda ou a compra desa moeda polo mesmo valor en euros da operación para que a súa ganancia e o seu custo de adquisición cadren.",
  "trade_republic.trade_skipped_no_amount":
    "Omitiuse(ronse) {{count}} operación(s) de compravenda de Trade Republic sen importe utilizable.",
  "trade_republic.trade_skipped_no_amount.hint":
    'Adoita deberse a filas incompletas na exportación (columna "amount" baleira ou non numérica). Se faltan operacións, volve descargar o CSV de transaccións completo desde Trade Republic.',
  "trade_republic.corporate_action_not_applied":
    "Trade Republic: non se aplicaron {{count}} movemento(s) de acción corporativa (fusión, canxe, split) de {{isins}}.",
  "trade_republic.corporate_action_not_applied.hint":
    "O custo dos títulos antigos non pasa aos novos, así que unha venda posterior do novo valor pode saír sen lotes e con custo 0. Se foi unha fusión ou un canxe, engade o custo de adquisición orixinal en «Lotes manuais para posicións transferidas».",
  "trade_republic.delivery_not_applied":
    "Trade Republic: non se importaron {{count}} entrega(s) de títulos sen compravenda (accións gratuítas, traspasos) de {{isins}}.",
  "trade_republic.delivery_not_applied.hint":
    "As accións gratuítas dunha promoción son unha ganancia patrimonial da base xeral polo seu valor de mercado o día da entrega: declaraas á parte e engade ese valor como custo en «Lotes manuais para posicións transferidas». Se é un traspaso desde outro bróker, engade alí o custo de compra orixinal.",
  "parser.trading212.unresolved_price_skipped":
    "Omitíronse {{skipped}} operacións sen prezo por acción e con importe noutra divisa.",
  "parser.trading212.unresolved_price_skipped.hint":
    'Estas filas non tiñan prezo por acción e o seu importe (Total) estaba nunha divisa distinta á do instrumento, polo que non se puido calcular o valor da operación. Volve exportar o histórico desde Trading 212 asegurándote de incluír a columna "Price / share".',
  "parser.cash_summary_duplicates": "Omitíronse {{skipped}} filas resumo duplicadas nas transaccións de efectivo.",
  "parser.cash_summary_duplicates.hint":
    'O teu Flex Query ten activada a opción "Summary" na sección Cash Transactions, o que duplica cada movemento. Podes desactivala, pero non é necesario: estas filas ignoráronse automaticamente para evitar duplicar dividendos, retencións e comisións.',
  "parser.executions_merged": "Agrupáronse {{sourceFillCount}} execucións parciais en {{mergedGroupCount}} ordes.",
  "parser.executions_merged.hint":
    "As ordes con varias execucións parciais combináronse nunha soa operación, igual que fan os brókers que informan a Facenda. O cálculo fiscal non cambia: cantidade total, prezo medio ponderado e comisións suman o mesmo.",
  "parser.order_level_duplicates": "Omitíronse {{skipped}} filas agregadas de tipo ORDER duplicadas nas operacións.",
  "parser.order_level_duplicates.hint":
    'O teu Flex Query ten activado o nivel de detalle "Orders" ademais de "Executions" na sección Trades, o que duplica cada operación. Podes desactivar "Orders" na configuración do Flex Query, pero non é necesario: estas filas ignoráronse automaticamente para evitar duplicar cantidades, importes e comisións.',
  "parser.cancelled_trades": "Omitíronse {{count}} operacións canceladas por IBKR xunto coa súa anulación.",
  "parser.cancelled_trades.hint": 'IBKR marca unha execución cancelada cunha fila de anulación ("(Ca.)"). A operación orixinal e a súa anulación descartáronse: nunca chegaron a ser unha compra ou venda real.',
  "parser.cancelled_trades_unmatched": "Omitíronse {{count}} anulacións de IBKR sen a operación orixinal neste ficheiro.",
  "parser.cancelled_trades_unmatched.hint": "A operación cancelada queda fóra do período deste Flex Query. Se a cargas desde outro ficheiro, seguirá contando como real: exporta un período que inclúa a operación e a súa anulación no mesmo ficheiro.",
  "parser.open_position_quantity_unknown": "IBKR non dá un número de accións lexible para {{count}} posición(s) aberta(s): {{holdings}}.",
  "parser.open_position_quantity_unknown.hint": "DeclaRenta cóntaas con 0 accións: o Modelo 720 inclúeas co seu valor, pero con 0 en «Número de valores», e o D-6 non as inclúe. Revisa a man esas posicións no 720 e no D-6, ou comproba que a sección Open Positions da Flex Query inclúe a cantidade e volve exportala.",
};

export default gl;
