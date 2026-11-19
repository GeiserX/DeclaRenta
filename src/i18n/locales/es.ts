/** Spanish (default, source of truth) */
const es = {
  // App
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker extranjero → Renta española",

  // Upload
  "upload.title": "Sube tu informe del broker",
  "upload.broker_question": "¿Qué broker(s) utilizas?",
  "upload.broker_hint": "Selecciona uno o varios. Te guiaremos paso a paso.",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrastra tu fichero aquí o haz clic para seleccionar",
  "upload.formats_help":
    "Formatos: XML (IBKR Flex), CSV (Degiro, Flatex, Trade Republic, Scalable, Lightyear, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro, Revolut)",
  "upload.autodetect_note": "El broker se detecta automáticamente en la mayoría de los casos.",
  "upload.detecting": "Analizando fichero...",
  "upload.detected": "Broker detectado:",
  "upload.detection_failed": "No se pudo detectar el broker. Selecciónalo manualmente.",
  "upload.broker_not_detected": "¿No se detectó tu broker?",
  "upload.guide_how": "¿Cómo descargar mi informe del broker?",
  "upload.guide_select_broker": "Selecciona tu broker:",
  "upload.choose_broker": "— elige broker —",
  "upload.guide_unavailable": "Guía no disponible todavía para este broker.",
  "upload.chip_group_label": "Selección manual de broker",

  // Config
  "config.title": "Configura",
  "config.process_btn": "Procesar",
  "config.processing": "Procesando...",

  // Results
  "results.title": "Resultados para Modelo 100",
  "results.operations": "Operaciones",
  "results.dividends": "Dividendos",
  "results.no_dividends": "Sin dividendos",
  "results.search_placeholder": "Buscar por ISIN o símbolo...",
  "results.search_placeholder_brokers": "Buscar por ISIN, símbolo o broker...",
  "results.filter_all": "Todas",
  "results.filter_gains": "Ganancias",
  "results.filter_losses": "Pérdidas",
  "results.export_json": "Exportar JSON",
  "results.export_csv": "Exportar CSV",
  "results.export_csv_title": "Separador «,» y decimales con punto: para programas y hojas de cálculo en inglés",
  "results.export_csv_excel": "Exportar CSV para Excel (ES)",
  "results.export_csv_excel_title": "Separador «;» y decimales con coma: se abre por columnas con doble clic en Excel en español",
  "results.export_pdf": "Exportar PDF",
  "results.operations_count": "{{count}} operación(es)",
  "results.dividends_count": "{{count}} dividendo(s)",
  "results.newer_years_notice": "Mostrando {{year}}; tus datos también cubren {{years}}.",
  "results.year_mismatch":
    "El fichero contiene datos de los ejercicios {{available}}, pero el ejercicio seleccionado es {{year}}. Selecciona otro año en el desplegable superior.",
  "results.setting_yes": "sí",
  "results.setting_no": "no",

  // Table headers
  "table.isin": "ISIN",
  "table.symbol": "Símbolo",
  "table.buy_date": "F. Compra",
  "table.sell_date": "F. Venta",
  "table.buy_broker": "Broker compra",
  "table.sell_broker": "Broker venta",
  "table.units": "Uds.",
  "table.cost_eur": "Coste EUR",
  "table.proceeds_eur": "Venta EUR",
  "table.gain_loss_eur": "G/P EUR",
  "table.days": "Días",
  "table.date": "Fecha",
  "table.gross_eur": "Bruto EUR",
  "table.withholding_eur": "Retención EUR",
  "table.country": "País",
  "table.payments": "Pagos",
  "casilla.dividends_by_issuer": "Dividendos por emisor",
  "casilla.dividends_per_payment": "Pagos individuales",
  "casilla.dividends_withholding_note": "La retención <strong>extranjera</strong> no se declara aquí: en el formulario «Alta Capital mobiliario» de Renta Web déjala en 0 y dedúcela en la casilla 0588 (doble imposición internacional, Art. 80 LIRPF). Pero la retención <strong>española</strong> sobre emisores españoles (ISIN ES…) sí es una retención a cuenta y va en la casilla 0597.",
  "table.casilla": "Casilla",
  "table.concept": "Concepto",
  "table.amount_eur": "Importe (EUR)",
  "table.currency": "Divisa",
  "table.fx_origin": "Origen",
  "table.fx_lot": "Lote FIFO",
  "fx.trigger.conversion": "Conversión de divisa",
  "fx.trigger.dividend": "Dividendo",
  "fx.trigger.interest": "Intereses",
  "fx.trigger.commission": "Comisión",
  "fx.trigger.stock_purchase": "Compra de valores",
  "fx.trigger.stock_sale": "Divisa perdida en una venta con pérdidas",
  "fx.trigger.stock_sale_guard": "Variación de la divisa hasta la compra de las acciones",
  "fx.trigger.stock_sale_cross": "Divisa invertida en acciones vendidas en otra moneda",
  "fx.trigger.loan_repayment": "Devolución de un préstamo en divisa del bróker",

  // Casillas
  "casilla.listed_transmission_value": "Valor de transmisión (acciones negociadas)",
  "casilla.listed_acquisition_value": "Valor de adquisición (acciones negociadas)",
  "casilla.acquisition_sale_rate_note":
    "El valor de adquisición se muestra al tipo de cambio del BCE de la fecha de VENTA, de modo que transmisión − adquisición coincide exactamente con la ganancia o pérdida (DGT V2422-20: la ganancia se calcula en la moneda de la acción y solo la diferencia se convierte a euros). En valores en moneda extranjera este importe difiere del coste histórico en euros de la fecha de compra y puede no coincidir con cifras guardadas en versiones anteriores.",
  "casilla.other_transmission_value": "Valor de transmisión (otros elementos: opciones/cripto/fondos/divisa)",
  "casilla.other_acquisition_value": "Valor de adquisición (otros elementos: opciones/cripto/fondos/divisa)",
  "casilla.fx_transmission_value": "Valor de transmisión FX (moneda extranjera)",
  "casilla.fx_acquisition_value": "Valor de adquisición FX (moneda extranjera)",
  "casilla.fx_cost_split": "{{fx}} € de coste de la divisa y {{shift}} € de variación ya declarada en la acción",
  "casilla.fx_net_gain_loss": "Ganancia/Pérdida neta FX (moneda extranjera)",
  "casilla.net_gain_loss": "Ganancia/Pérdida neta (transmisiones)",
  "casilla.gross_dividends": "Dividendos brutos",
  "casilla.interest_earned": "Intereses ganados",
  "casilla.interest_paid": "Intereses pagados al broker (margen, no deducible — informativo)",
  "casilla.general_gains": "Ganancias patrimoniales no derivadas de transmisión (airdrops, comisiones de referidos)",
  "casilla.spanish_withholding": "Retenciones del capital mobiliario (casilla 0597)",
  "casilla.spanish_withholding_detail":
    "Retención a cuenta del IRPF practicada en origen sobre dividendos o intereses de emisores españoles (p. ej. acciones del IBEX), aunque estén en un bróker extranjero. Es un pago a cuenta deducible de la cuota; NO es la deducción por doble imposición (casilla 0588), que solo aplica a impuesto extranjero.",
  "casilla.double_taxation": "Deducción doble imposición",
  "casilla.dt_foreign_income_total": "Total rendimientos extranjeros",
  "casilla.reintegrated_losses":
    "Pérdidas diferidas que ahora se integran (acciones vendidas sin recompra en su plazo, «transmisión definitiva»; en cripto, venta de las unidades recompradas): {{amount}} EUR",
  "casilla.blocked_losses":
    "Pérdidas bloqueadas por regla anti-churning (2 meses en mercado regulado o equivalente / 1 año el resto; en cripto, el año siguiente a la venta): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} advertencia(s)",
  "messages.errors_title": "{{count}} error(es) — requiere atención",
  "messages.warnings_title": "{{count}} aviso(s) — revisa",
  "messages.info_title": "{{count}} nota(s) informativa(s)",
  "pdf.severity_error": "Error",
  "pdf.severity_warning": "Aviso",
  "pdf.severity_info": "Nota",
  "pdf.section_messages": "Mensajes",

  // Charts
  "chart.asset_distribution": "Distribución por tipo de activo",
  "chart.monthly_gl": "Ganancia/Pérdida por mes",
  "chart.currency_composition": "Composición por divisa",
  "chart.withholdings_country": "Retenciones por país",
  "chart.month_1": "Ene",
  "chart.month_2": "Feb",
  "chart.month_3": "Mar",
  "chart.month_4": "Abr",
  "chart.month_5": "May",
  "chart.month_6": "Jun",
  "chart.month_7": "Jul",
  "chart.month_8": "Ago",
  "chart.month_9": "Sep",
  "chart.month_10": "Oct",
  "chart.month_11": "Nov",
  "chart.month_12": "Dic",
  "asset.stk": "Acciones",
  "asset.fund": "Fondos / ETFs",
  "asset.opt": "Opciones",
  "asset.fop": "Opciones sobre futuros",
  "asset.crypto": "Criptomonedas",
  "asset.bond": "Bonos",
  "option.expiration": "Expiración",
  "option.close": "Cierre anticipado",
  "option.exercise": "Ejercicio/Asignación",

  // Footer
  "footer.docs": "Documentación",
  "footer.privacy": "Self-hosted · Privacidad total",
  "footer.disclaimer": "Aviso legal",

  // Disclaimer
  "disclaimer.title": "Aviso legal",
  "disclaimer.text":
    "Esta herramienta es meramente informativa y no constituye asesoramiento fiscal ni jurídico. Los resultados generados deben ser verificados por el usuario y/o un profesional cualificado antes de ser utilizados en cualquier declaración tributaria.\n\nDeclaRenta no se responsabiliza de errores, omisiones ni de las consecuencias derivadas del uso de esta información. El usuario es el único responsable de la veracidad y exactitud de los datos introducidos y de las declaraciones presentadas ante la Agencia Tributaria.\n\nLos tipos de cambio proceden del Banco Central Europeo (BCE). Los cálculos fiscales se basan en la normativa vigente (LIRPF, Ley del Patrimonio, Orden EHA/3290/2008) pero pueden no cubrir todos los supuestos ni reflejar cambios normativos posteriores a la última actualización del software.",
  "disclaimer.accept": "Entendido",

  // Accessibility
  "a11y.skip_link": "Saltar al contenido",
  "a11y.nav_label": "Ajustes",
  "a11y.lang_label": "Idioma",
  "a11y.theme_toggle": "Cambiar tema",
  "a11y.drop_zone": "Zona de carga de ficheros",
  "a11y.file_input": "Seleccionar ficheros",
  "a11y.ops_search": "Buscar operaciones por ISIN o símbolo",
  "a11y.ops_search_brokers": "Buscar operaciones por ISIN, símbolo o broker",
  "a11y.ops_filter": "Filtrar operaciones por resultado",
  "a11y.remove_file": "Quitar {{name}}",

  // Theme
  "theme.toggle": "Cambiar tema",

  // Wizard steps
  "wizard.step1": "Subir ficheros",
  "wizard.step2": "Revisar y elegir método",
  "wizard.step3": "Resultados",
  "wizard.next": "Siguiente",
  "wizard.back": "Atrás",

  // Review step
  "review.title": "Resumen de datos cargados",
  "review.broker": "Broker",
  "review.trades_count": "Operaciones",
  "review.dividends_count": "Dividendos",
  "review.date_range": "Rango de fechas",
  "review.currencies": "Divisas",
  "review.no_data": "No se han detectado operaciones en los ficheros subidos.",
  "review.file": "Fichero",

  // Config step
  "config.nif_label": "NIF (para Modelo 720/D-6):",
  "config.nif_placeholder": "12345678A",
  "config.generate_720": "Generar fichero Modelo 720",
  "config.generate_d6": "Generar guía D-6",

  // Expandable casillas
  "casilla.expand": "Ver detalle",
  "casilla.collapse": "Ocultar detalle",
  "casilla.operations_in": "Operaciones en esta casilla",
  "casilla.no_operations": "Sin operaciones",
  "casilla.copy": "Copiar importe",
  "casilla.copied": "¡Copiado!",

  // Year comparison
  "compare.title": "Comparativa anual",
  "compare.no_data": "Procesa al menos 2 ejercicios para ver la comparativa.",
  "compare.year": "Ejercicio",
  "compare.variation": "Variación",
  "compare.saved_reports": "Informes guardados",
  "compare.clear_history": "Borrar historial",
  "compare.clear_confirm": "¿Borrar todos los informes guardados?",
  "compare.transmission_value": "Valor de transmisión (transmisiones, sin divisas)",
  "compare.acquisition_value": "Valor de adquisición (transmisiones, sin divisas)",
  "compare.net_gain_loss": "Ganancia/Pérdida neta (transmisiones, sin divisas)",

  // Errors
  "error.no_broker_detected":
    'No se pudo detectar el broker de "{{filename}}". Si es un informe de broker, selecciona el broker manualmente; si no lo es, quítalo de la lista.',
  "error.empty_file":
    'El fichero "{{filename}}" está vacío. Quítalo de la lista o vuelve a exportarlo desde tu broker.',
  "error.file_too_large":
    'El fichero "{{filename}}" supera el límite de {{limit}} MB y se ha descartado. Exporta un periodo más corto o divide el fichero.',
  "error.prefix": "Error: ",

  // Status
  "status.fetching_rates": "Obteniendo tipos ECB para {{currencies}}...",
  "status.files_processed": "{{count}} fichero(s) procesado(s) — {{brokers}} — {{trades}} operaciones",

  // Sidebar navigation
  "sidebar.profile": "Perfil fiscal",
  "sidebar.renta": "Modelo 100 (Renta)",
  "sidebar.m720": "Modelo 720",
  "sidebar.m721": "Modelo 721",
  "sidebar.d6": "Modelo D-6",
  "sidebar.toggle": "Abrir/cerrar menú",

  // Fiscal profile
  "profile.title": "Perfil fiscal",
  "profile.description": "Estos datos se utilizan para generar los ficheros de los modelos 720 y D-6. Se guardan solo en este navegador, nunca en un servidor.",
  "profile.section_personal": "Datos personales",
  "profile.nif_label": "NIF/NIE:",
  "profile.nif_placeholder": "12345678Z",
  "profile.nif_invalid": "El NIF/NIE no es válido: revisa los dígitos y la letra de control.",
  "profile.surname_label": "Apellidos:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Nombre:",
  "profile.name_placeholder": "Juan",
  "profile.ccaa_label": "Comunidad Autónoma:",
  "profile.phone_label": "Teléfono:",
  "profile.phone_placeholder": "600123456",
  "review.autoconvert_label": "Procesar autoconversiones del bróker (AFx/FXCONV)",
  "review.autoconvert_detail":
    "Activado por defecto. Interactive Brokers no reconvierte a euros al vender una acción, así que el saldo en divisa es real y su conversión posterior genera ganancia o pérdida patrimonial (Art. 33.1 LIRPF). Desactívalo solo si tu bróker hace un round-trip completo EUR↔divisa y quieres ignorar el efecto de la divisa.",
  "review.titulares_label": "Número de titulares:",
  "review.titulares_detail":
    "Si la cuenta tiene varios titulares (p. ej. cuenta conjunta o de gananciales), DeclaRenta divide todos los importes a partes iguales para mostrar la parte que corresponde a cada contribuyente (Art. 11.3 LIRPF). Cada titular presenta su declaración individual por su parte.",
  "profile.saved": "Perfil guardado",
  "profile.clear_btn": "Borrar mis datos de este navegador",
  "profile.clear_confirm": "¿Borrar de este navegador tu perfil fiscal, los informes guardados y los valores introducidos a mano?",
  "profile.incomplete_banner": "Completa tu perfil fiscal para generar los modelos 720 y D-6.",
  "profile.go_to_profile": "Ir al perfil",

  // FX method (#434): review step, results header, comparison
  "method.multidivisa.sub": "La ganancia se calcula en la divisa de la acción",
  "method.multidivisa.text": "Calcula la ganancia de cada acción en su divisa y la pasa a euros al tipo del día de la venta. La divisa que tienes guarda lo que te costó en euros. Su diferencia de cambio sale cuando la cambias a euros o a otra divisa.",
  "method.multidivisa.basis": "Base legal: criterio de Hacienda para acciones (DGT V1740-17, V2422-20, V0282-22).",
  "method.tradicional_divisa.sub": "Compra y venta a su tipo, y tu divisa por FIFO",
  "method.tradicional_divisa.text": "Las acciones se valoran al tipo del BCE del día de compra y del día de venta. La divisa tributa solo cuando sale de tu cuenta: al cambiarla a euros o a otra divisa, al pagar comisiones o cuando la pierdes en una venta con pérdidas. Lo que ya declaraste dentro de las acciones no se vuelve a contar.",
  "method.tradicional_divisa.basis": "Valoración de acciones: criterio de la DGT para participaciones de fondos en divisa (V2324-10, V0775-21), aplicado a acciones. Divisa: se declara al cambiarla (V2466-08) o al perderla en una venta con pérdidas (V0775-21, V2324-10).",
  "method.tradicional_divisa.risk": "Hacienda aplica a las acciones el «Criterio DGT (multidivisa)» (V1740-17). En 2025 rechazó este mismo cálculo para un piso comprado y vendido en dólares (V1615-25). Si revisa tu declaración, puede recalcularla con ese criterio. Sin ventas con pérdidas, el total de un ciclo completo suele ser casi el mismo; cambia en qué año y en qué casilla sale cada parte.",
  "method.monodivisa.sub": "Solo compra y venta a su tipo",
  "method.monodivisa.text": "Valora la compra al tipo del día de compra y la venta al del día de venta. No calcula ningún resultado de divisa, ni en tus cambios a euros ni en los automáticos del bróker.",
  "method.monodivisa.basis": "Base legal: art. 35.1 LIRPF, sin la divisa del art. 14.2.e. Si cambias divisa a euros, puede distorsionar el resultado.",
  "method.monodivisa.risk": "Este método no declara el resultado de tus cambios de divisa a euros. Úsalo solo si no cambias divisa.",
  "method.unknown": "desconocido",
  "review.method_title": "¿Cómo calculamos tus acciones en divisa?",
  "review.method_lead": "Tienes operaciones en {{currencies}}. El método cambia las cifras de tu renta. Elige uno y mantenlo todos los años.",
  "review.method_recommended": "Recomendado",
  "review.method_last_year": "En {{year}} calculaste con «{{method}}».",
  "review.method_last_year_switch": "En {{year}} calculaste con «{{method}}». Si cambias de método y aún tienes divisa de entonces, parte del resultado puede salir dos veces o perderse. Usa el mismo método todos los años.",
  "review.other_settings": "Otros ajustes del cálculo",
  "review.autoconvert_off_mono": "No se aplica con «Tradicional sin divisa (monodivisa)», porque ese método no calcula divisa.",
  "review.calculate": "Calcular",
  "review.calculate_with": "Calcular con «{{method}}»",
  "review.show_details": "Ver detalle",
  "results.method_chip": "Método: {{method}}",
  "results.method_change": "Cambiar",
  "results.method_change_aria": "Cambiar el método de cálculo",
  "results.titulares_one": "1 titular",
  "results.titulares_many": "{{count}} titulares",
  "results.autoconvert_chip": "Autoconversiones: {{value}}",
  "results.how_title": "Cómo se ha calculado",
  "results.split_shares": "Acciones",
  "results.split_shares_sub": "casillas 0328 y 0331",
  "results.split_securities": "Acciones y otros valores",
  "results.split_securities_sub": "casillas 0328 y 0331, y parte de 1633 y 1637",
  "results.split_fx": "Divisa",
  "results.split_fx_sub": "incluida en 1633 y 1637",
  "results.split_fx_off": "no se calcula en este método",
  "results.split_total": "Total",
  "results.split_total_sub": "a la base del ahorro · cuota estimada {{tax}} €",
  "results.compare_title": "Comparar con los otros métodos (para cuadrar con otra herramienta)",
  "results.compare_in_use": "En uso",
  "results.compare_tax": "Cuota estimada",
  "results.compare_note": "Solo informativo. Para cambiar de método, vuelve a «Revisar y elegir método».",
  "results.compare_loading": "Calculando…",
  "results.compare_error": "No se ha podido calcular la comparación.",
  "casilla.acquisition_buy_rate_note_fx": "El valor de adquisición se muestra al tipo de cambio del BCE de la fecha de COMPRA, como pide el método «Tradicional con divisa». Transmisión − adquisición es la ganancia o pérdida de la acción en euros. El resultado de la divisa va aparte, en las casillas 1633 y 1637.",
  "casilla.acquisition_buy_rate_note_mono": "El valor de adquisición se muestra al tipo de cambio del BCE de la fecha de COMPRA, como pide el método «Tradicional sin divisa (monodivisa)». Transmisión − adquisición es la ganancia o pérdida de la acción en euros. Este método no calcula ningún resultado de divisa.",
  "casilla.no_other_elements_fx_below": "Sin otros elementos. El resultado de divisa está debajo.",
  "compare.method": "Método",
  "compare.method_mismatch": "Estos años usan métodos distintos. Si cambias de método y aún tienes divisa de un año anterior, parte del resultado puede salir dos veces o perderse.",
  "profile.autosave": "Los cambios se guardan solos en este navegador.",
  "profile.method_moved": "El método de divisa, los titulares y las autoconversiones se eligen ahora en Modelo 100, en el paso «Revisar y elegir método».",
  "profile.go_to_renta": "Ir a Modelo 100",

  // Broker guides
  "guide.title": "¿Cómo obtener el informe?",
  "guide.tip_fifo":
    "Incluye todo el histórico — DeclaRenta necesita operaciones anteriores para el cálculo FIFO correcto.",
  "guide.select_broker_hint": "Selecciona tu broker para ver las instrucciones de descarga del informe.",
  "guide.heading": "¿Cómo obtener el informe de tu broker?",

  // IBKR
  "guide.ibkr.title": "Interactive Brokers (Flex Query XML)",
  "guide.ibkr.step1": "Inicia sesión en el <strong>Portal del Cliente</strong> de IBKR",
  "guide.ibkr.step2": "Ve a <strong>Rendimiento e informes</strong> → pestaña <strong>Consultas Flex</strong>",
  "guide.ibkr.step3":
    "En <strong>Consulta flex de actividad</strong>, haz clic en el <strong>+</strong> para crear una nueva consulta",
  "guide.ibkr.step4":
    "En la configuración, activa las secciones:<ul><li><strong>Trades</strong> (obligatorio)</li><li><strong>Cash Transactions</strong> — dividendos y retenciones (obligatorio)</li><li><strong>Open Positions</strong> — para Modelo 720/D-6 (recomendado)</li><li><strong>Financial Instrument Information</strong> (recomendado)</li></ul>",
  "guide.ibkr.step5":
    "En cada sección, <strong>selecciona todos los campos disponibles</strong> (marca todas las casillas). Cuantos más datos incluyas, más preciso será el cálculo. Como mínimo asegúrate de incluir el campo <strong>Notes</strong> en Trades — es necesario para detectar conversiones automáticas de divisa.",
  "guide.ibkr.step6": "Formato de salida: <strong>XML</strong>. En <em>Date Format</em>, deja <strong>yyyyMMdd</strong>",
  "guide.ibkr.step7": "Incluye <strong>todos los años disponibles</strong> para cálculo FIFO correcto",
  "guide.ibkr.step8": "Guarda la consulta, ejecútala y descarga el fichero <code>.xml</code>",

  // Degiro
  "guide.degiro.title": "Degiro (CSV)",
  "guide.degiro.step1": "Inicia sesión en la <strong>web de Degiro</strong> (no la app)",
  "guide.degiro.step2": "Abre el panel lateral <strong>Buzón</strong> (icono de sobre)",
  "guide.degiro.step3": "Haz clic en <strong>Transacciones</strong> (historial de transacciones de tus productos)",
  "guide.degiro.step4": "Selecciona el rango de fechas deseado (incluye <strong>todo el histórico</strong> para FIFO)",
  "guide.degiro.step5": "Haz clic en <strong>Exportar</strong> y descarga el fichero CSV",
  "guide.degiro.step6":
    "Para dividendos: vuelve al <strong>Buzón</strong> → <strong>Cuenta</strong> (historial de movimientos de tu cuenta) → misma fecha → <strong>Exportar</strong> CSV",
  "guide.flatex.title": "Flatex (CSV)",
  "guide.flatex.step1": "Inicia sesión en la <strong>web de Flatex</strong>",
  "guide.flatex.step2": "Ve a <strong>Movimientos</strong> → <strong>Depotumsätze</strong> (movimientos de la cartera)",
  "guide.flatex.step3":
    "Selecciona <strong>todo el histórico</strong> (necesario para el cálculo FIFO) y exporta el fichero CSV",
  "guide.flatex.step4":
    "Para dividendos: ve a <strong>Kontoumsätze</strong> (movimientos de la cuenta), mismo rango de fechas, y exporta el CSV. Ojo: ahí los dividendos aparecen por el importe neto, ya descontada la retención; toma el importe íntegro y la retención del justificante en PDF de cada dividendo",
  "guide.flatex.step5":
    "Sube <strong>ambos ficheros</strong> CSV (Depotumsätze para operaciones y Kontoumsätze para dividendos)",

  // eToro
  "guide.etoro.title": "eToro (XLSX)",
  "guide.etoro.step1": "Inicia sesión en <strong>eToro</strong>",
  "guide.etoro.step2": "Ve a <strong>Ajustes → Extracto de cuenta</strong>",
  "guide.etoro.step3": "Selecciona el período del ejercicio fiscal",
  "guide.etoro.step4": "Descarga el fichero <strong>XLSX</strong> (Excel)",

  // Scalable
  "guide.scalable.title": "Scalable Capital (CSV)",
  "guide.scalable.step1": "Inicia sesión en <strong>Scalable Capital</strong>",
  "guide.scalable.step2": "Ve a <strong>Perfil → Documentos fiscales</strong>",
  "guide.scalable.step3": "Descarga el informe de transacciones en formato <strong>CSV</strong>",

  // Freedom24
  "guide.freedom24.title": "Freedom24 (JSON)",
  "guide.freedom24.step1": "Inicia sesión en la <strong>plataforma web de Freedom24</strong>",
  "guide.freedom24.step2": "Ve a <strong>Informes → Informe de operaciones</strong>",
  "guide.freedom24.step3": "Selecciona el período y formato <strong>JSON</strong>",
  "guide.freedom24.step4": "Descarga el fichero",

  // Coinbase
  "guide.coinbase.title": "Coinbase (CSV)",
  "guide.coinbase.step1": "Inicia sesión en <strong>Coinbase</strong>",
  "guide.coinbase.step2": "Ve a <strong>Impuestos → Documentos</strong>",
  "guide.coinbase.step3": "Haz clic en <strong>Generar informe</strong>",
  "guide.coinbase.step4": "Descarga el historial de transacciones en formato CSV",

  // Binance
  "guide.binance.title": "Binance (CSV)",
  "guide.binance.step1": "Inicia sesión en <strong>Binance</strong>",
  "guide.binance.step2":
    "<strong>Historial de operaciones spot:</strong> Órdenes → Orden spot → Exportar historial de operaciones (↑) → Spot - Historial de Operaciones → Personalizar tiempo (UTC+1) → CSV",
  "guide.binance.step3":
    "<strong>Historial de transacciones:</strong> Órdenes → Historial de Activos → Exportar registros de transacciones (↑) → Historial de Transacciones → Personalizar tiempo (UTC+1) → CSV",
  "guide.binance.step4": "Puedes subir uno o ambos ficheros — se aceptan tanto en español como en inglés",

  // Kraken
  "guide.kraken.title": "Kraken (CSV)",
  "guide.kraken.step1": "Inicia sesión en <strong>Kraken</strong>",
  "guide.kraken.step2": "Ve a <strong>History → Export</strong>",
  "guide.kraken.step3": "Selecciona <strong>Trades</strong> y el rango de fechas",
  "guide.kraken.step4": "Formato: <strong>CSV</strong>, descarga el fichero",

  // Trade Republic
  "guide.trade_republic.title": "Trade Republic (CSV)",
  "guide.trade_republic.step1": "Abre la app de <strong>Trade Republic</strong>",
  "guide.trade_republic.step2": "Ve a <strong>Perfil → Actividad</strong>",
  "guide.trade_republic.step3": "Pulsa los tres puntos (⋯) y selecciona <strong>Exportar</strong>",
  "guide.trade_republic.step4": "Selecciona el rango de fechas y formato <strong>CSV</strong>",
  "guide.trade_republic.step5": "Descarga el fichero y envíalo a tu ordenador",

  // Revolut
  "guide.revolut.title": "Revolut (XLSX)",
  "guide.revolut.step1": "Inicia sesión en la <strong>web de Revolut</strong> (app.revolut.com o app móvil)",
  "guide.revolut.step2": "Ve a <strong>Trading/Cripto → Extractos</strong>",
  "guide.revolut.step3": "Selecciona <strong>Trading Account Statement</strong> del ejercicio fiscal",
  "guide.revolut.step4": "Descarga en formato <strong>XLSX</strong> (Excel)",

  // Trading 212
  "guide.trading212.title": "Trading 212 (CSV)",
  "guide.trading212.step1": "Inicia sesión en la <strong>web de Trading 212</strong>",
  "guide.trading212.step2": "Ve a <strong>Historial → Transacciones</strong>",
  "guide.trading212.step3": "Filtra por el rango de fechas deseado",
  "guide.trading212.step4": "Haz clic en <strong>Descargar CSV</strong>",

  // Lightyear
  "guide.lightyear.title": "Lightyear (CSV)",
  "guide.lightyear.step1": "Abre la app de <strong>Lightyear</strong>",
  "guide.lightyear.step2": "Ve a <strong>Perfil → Informes</strong>",
  "guide.lightyear.step3": "Selecciona <strong>Transaction report</strong> y el período",
  "guide.lightyear.step4": "Descarga el fichero CSV y envíalo a tu ordenador",

  // MEXEM
  "guide.mexem.title": "MEXEM (Flex Query XML)",
  "guide.mexem.step1": "Inicia sesión en el <strong>Portal del Cliente</strong> de MEXEM (misma interfaz que IBKR)",
  "guide.mexem.step2": "Ve a <strong>Rendimiento e informes</strong> → pestaña <strong>Consultas Flex</strong>",
  "guide.mexem.step3":
    "Crea una <strong>Activity Flex Query</strong> incluyendo Trades, Cash Transactions y Open Positions",
  "guide.mexem.step4": "Formato de salida: <strong>XML</strong>",
  "guide.mexem.step5": "Ejecuta la consulta y descarga el fichero <code>.xml</code>",

  // Swissquote
  "guide.swissquote.title": "Swissquote (CSV)",
  "guide.swissquote.step1": "Inicia sesión en <strong>Swissquote eBanking</strong>",
  "guide.swissquote.step2": "Ve a <strong>Trading → Historial de transacciones</strong>",
  "guide.swissquote.step3": "Selecciona el rango de fechas del ejercicio fiscal",
  "guide.swissquote.step4": "Haz clic en <strong>Exportar → CSV</strong>",

  // Modelo 720 section
  "m720.title": "Modelo 720 — Bienes en el extranjero",
  "m720.description": "Declaración informativa sobre bienes y derechos situados en el extranjero.",
  "m720.threshold_exceeded": "Según tus posiciones ({{amount}} €), estás obligado a presentar el Modelo 720.",
  "m720.obliged_by_changes": "Estás obligado a presentar el Modelo 720 por los cambios desde tu última declaración: cada categoría de arriba indica el motivo.",
  "m720.declared_account_missing": "Una cuenta que declaraste no tiene saldo este año ({{accounts}}): si la cancelaste, debes declarar su cancelación a mano (art. 42 bis.5 RGAT).",
  "m720.threshold_not_exceeded":
    "No superas el umbral de 50.000 € (total: {{amount}} €). No estás obligado a presentar.",
  "m720.category_v": "Valores (acciones, fondos, bonos)",
  "m720.category_c": "Cuentas (saldos en efectivo)",
  "m720.category_exceeded": "Supera 50.000 € — obligatorio declarar",
  "m720.category_not_exceeded": "Por debajo del umbral",
  "m720.category_undetermined": "No se puede determinar: {{count}} posición(es) sin valorar",
  "m720.no_positions": "Sube un informe con posiciones abiertas en Modelo 100 para analizar el Modelo 720.",
  "m720.brokers_without_holdings": "Los datos de {{brokers}} que has subido no incluyen tus posiciones ni saldos a 31 de diciembre, así que no se suman aquí. Comprueba en el extracto de fin de año de {{brokers}} si el saldo de tus cuentas o el valor de tus acciones y fondos en el extranjero supera los 50.000 €.",
  "m720.positions_title": "Posiciones declarables",
  "m720.positions_unvalued":
    "{{count}} posición(es) no se han podido valorar en euros (sin precio de mercado o sin tipo de cambio para su moneda al cierre del ejercicio) y se han excluido del total. Calcula su valor en euros e inclúyelas manualmente.",
  "m720.cash_title": "Saldos en efectivo (Cuentas)",
  "m720.q4_average": "Media Q4",
  "m720.cash_missing_average":
    "Algunos saldos no incluyen la media del cuarto trimestre, obligatoria para cuentas en el Modelo 720. Su saldo a 31 de diciembre sí cuenta para el umbral de 50.000 €, pero esas cuentas no se incluyen en el fichero generado: añádelas a mano, con su saldo medio del cuarto trimestre, antes de presentar.",
  "m720.omitted_title":
    "Estos bienes no caben en el fichero y debes declararlos a mano en el formulario del Modelo 720:",
  "m720.omitted_no_isin":
    "no tiene ISIN; en el formulario se identifica con «Z» más el código del país del emisor",
  "m720.omitted_no_country":
    "falta el país donde está depositado o situado",
  "m720.omitted_no_account":
    "falta el número de cuenta",
  "m720.omitted_invalid_code":
    "vendido este año; el Modelo 720 anterior lo declaró con una clave o un país que el fichero no admite",
  "m720.not_generated_left_out":
    "No se ha generado ningún fichero: nada de lo que debes declarar puede escribirse en el fichero. Decláralo a mano en el formulario del Modelo 720, siguiendo los avisos de arriba.",
  "m720.successive_years_note":
    "Si ya presentaste el Modelo 720 en un año anterior, solo es obligatorio volver a presentarlo cuando el valor conjunto de una categoría ha aumentado más de 20.000 € respecto de la última declaración, o cuando has vendido o cancelado un bien que declaraste (arts. 42 bis.5 y 42 ter.5 del RD 1065/2007). Si no, presentarlo es opcional.",
  "m720.previous_title": "Tu último Modelo 720",
  "m720.previous_help": "Si ya presentaste el Modelo 720, sube el fichero .txt de tu última declaración. Lo que ya declaraste saldrá con origen M, lo que has vendido con origen C (baja) y se aplicará la regla de los 20.000 €. El fichero se lee en tu navegador y no se guarda.",
  "m720.previous_loaded": "Cargado {{name}} (ejercicio {{year}}): {{securities}} valores y {{accounts}} cuentas declarados.",
  "m720.previous_clear": "Quitar",
  "m720.previous_invalid": "Este fichero no es un Modelo 720: no tiene ningún registro de detalle.",
  "m720.previous_same_year": "Este fichero es del ejercicio {{fileYear}}. Sube el Modelo 720 de un ejercicio anterior a {{year}}.",
  "m720.origin": "Origen",
  "m720.origin_a": "A (alta)",
  "m720.origin_m": "M (ya declarado)",
  "m720.successive_last": "Última declaración: {{previous}} €. Variación: {{change}} €.",
  "m720.successive_increase": "Ha aumentado más de 20.000 €: obligatorio volver a declarar",
  "m720.successive_sold": "Has vendido valores que declaraste: obligatorio declarar sus bajas",
  "m720.successive_optional": "No ha aumentado más de 20.000 €: volver a declararla es opcional",
  "m720.successive_not_required": "Con tu último Modelo 720, este año no estás obligado a presentarlo: ninguna categoría ha aumentado más de 20.000 € y no has vendido nada de lo que declaraste. Puedes presentarlo si quieres.",
  "m720.sold_title": "Bajas: valores vendidos desde tu último Modelo 720",
  "m720.sold_help": "El fichero los incluye con origen C, con la fecha y el importe de la última venta.",
  "m720.sold_no_date": "no hay ninguna venta en {{year}} de las acciones declaradas: la baja sale sin fecha de extinción y con valoración 0; complétala antes de presentar",
  "m720.sold_no_acquisition": "los datos no incluyen su compra: la baja sale sin fecha de adquisición; complétala antes de presentar",
  "m720.generate_btn": "Generar fichero Modelo 720",
  "m720.deadline": "Plazo: 1 enero – 31 marzo del año siguiente",
  "m720.total_value": "Valor total: {{amount}} €",
  "m720.filing_title": "¿Cómo presentarlo?",
  "m720.rates_title": "Tipos de cambio aplicados (BCE)",
  "m720.deadline_short": "Plazo: 1 enero – 31 marzo",
  "m720.filing_step1": "Accede a la Sede Electrónica de la AEAT",
  "m720.filing_step2": "Busca «Modelo 720»",
  "m720.filing_step3": "Importa el fichero generado (TGVI Online)",
  "m720.filing_step4": "Revisa y firma con certificado digital o Cl@ve",

  // Modelo D-6 section
  "d6.title": "Modelo D-6 — Inversiones en el exterior",
  "d6.description": "Declaración al Registro de Inversiones del Ministerio de Economía.",
  "d6.no_minimum":
    "Desde la Orden ICT/1408/2021, el D-6 solo es obligatorio si tu participación representa el <strong>10% o más</strong> del capital o derechos de voto de una empresa cotizada extranjera. La mayoría de inversores minoristas están exentos.",
  "d6.no_positions": "Sube un informe con posiciones abiertas en Modelo 100 para analizar el D-6.",
  "d6.brokers_without_holdings": "Los datos de {{brokers}} que has subido no incluyen tus valores a 31 de diciembre, así que no aparecen aquí. Consúltalos en el extracto de fin de año de {{brokers}}.",
  "d6.positions_title": "Posiciones a declarar",
  "d6.positions_unvalued":
    "{{count}} posición(es) no se han podido valorar en euros (sin precio de mercado o sin tipo de cambio para su moneda al cierre del ejercicio) y se han excluido del total. Calcula su valor en euros e inclúyelas manualmente.",
  "d6.cancellations_title": "Cancelaciones",
  "d6.generate_btn": "Generar guía D-6",
  "d6.deadline": "Plazo: 1 – 31 enero del año siguiente",
  "d6.total_value": "Valor total: {{amount}} €",
  "d6.aforix_title": "Guía AFORIX paso a paso",
  "d6.copy_btn": "Copiar",
  "d6.copied": "Copiado",
  "d6.rates_title": "Tipos de cambio aplicados (BCE)",
  "d6.deadline_short": "Plazo: 1 – 31 enero",
  "d6.copy_failed": "Error al copiar",
  "d6.aforix_position_of": "Posición {{index}} de {{total}}",

  // Modelo 721 section
  "m721.title": "Modelo 721 — Criptomonedas en el extranjero",
  "m721.description": "Declaración informativa sobre monedas virtuales situadas en el extranjero.",
  "m721.threshold_exceeded": "Según tus posiciones ({{amount}} €), estás obligado a presentar el Modelo 721.",
  "m721.threshold_not_exceeded":
    "No superas el umbral de 50.000 € (total: {{amount}} €). No estás obligado a presentar.",
  "m721.threshold_undetermined":
    "No se puede determinar si superas el umbral de 50.000 €: el total ({{amount}} €) no incluye {{count}} posición(es) sin valorar. Valóralas antes de concluir que no debes presentar.",
  "m721.no_positions": "Sube un informe con posiciones de criptomonedas en Modelo 100 para analizar el Modelo 721.",
  "m721.brokers_without_holdings": "Los datos de {{brokers}} que has subido no incluyen tus criptomonedas a 31 de diciembre, así que no se suman aquí. Comprueba en el extracto de fin de año de {{brokers}} si tus criptomonedas en el extranjero superan los 50.000 €.",
  "m721.positions_title": "Posiciones declarables",
  "m721.generate_btn": "Generar fichero Modelo 721",
  "m721.deadline": "Plazo: 1 enero – 31 marzo del año siguiente",
  "m721.total_value": "Valor total: {{amount}} €",
  "m721.filing_title": "¿Cómo presentarlo?",
  "m721.rates_title": "Tipos de cambio aplicados (BCE)",
  "m721.deadline_short": "Plazo: 1 enero – 31 marzo",
  "m721.filing_step1": "Accede a la Sede Electrónica de la AEAT",
  "m721.filing_step2": "Busca «Modelo 721»",
  "m721.filing_step3": "Rellena la declaración con los datos de la tabla (formato oficial: XML, Orden HFP/886/2023)",
  "m721.filing_step4": "Revisa y firma con certificado digital o Cl@ve",
  "m721.exchange": "Exchange",
  "m721.format_notice":
    "El formato oficial de la AEAT es XML (Orden HFP/886/2023). DeclaRenta solo muestra una revisión orientativa: la generación oficial está desactivada hasta implementar el XML validado.",
  "m721.positions_unvalued":
    "{{count}} posición(es) no se han podido valorar en euros (sin precio de mercado o sin tipo de cambio para su moneda al cierre del ejercicio) y se han excluido del total. Calcula su valor en euros e inclúyelas manualmente.",
  "m721.empty_title": "No hay posiciones de criptomonedas",
  "m721.empty_description":
    "El Modelo 721 es una declaración informativa obligatoria si posees criptomonedas en exchanges extranjeros valoradas en más de 50.000 €. Sube tu informe del broker en la sección Modelo 100 para que DeclaRenta calcule automáticamente si superas el umbral. Plazo: 1 de enero – 31 de marzo.",
  "m721.empty_cta": "Ir a Modelo 100",
  "m721.profile_required": "Completa tu perfil fiscal antes de generar el fichero del Modelo 721.",

  // Section headers
  "section.year_label": "Ejercicio",
  "section.profile_source": 'Datos del <a href="#perfil">Perfil fiscal</a>',
  "section.positions_date_mismatch":
    "Las posiciones de tu fichero son a fecha {{date}}, no a 31/12/{{year}}. Estos modelos declaran lo que tenías a 31 de diciembre, así que no se genera ningún fichero con ellas. Descarga un informe que termine el 31/12/{{year}} (en IBKR, un Flex Query con fecha final 31/12/{{year}}) y súbelo de nuevo.",
  "section.positions_date_unknown":
    "Tu broker no indica a qué fecha corresponden las posiciones. Comprueba que el informe refleje lo que tenías a 31/12/{{year}}: si lo descargaste más tarde, las posiciones y sus valores pueden no coincidir.",
  "merge.holdings_other_date":
    "Posiciones y saldos de la cuenta {{account}} a fecha {{date}} fuera de los modelos 720, 721 y D-6: no son los de 31/12/{{year}}.",
  "merge.holdings_other_date.hint":
    "Ese fichero termina en otra fecha. Sus operaciones y movimientos sí se tienen en cuenta, pero estos modelos declaran lo que tenías a 31 de diciembre, así que sus posiciones y saldos no se suman. Si te falta el informe de esa cuenta a 31/12/{{year}}, súbelo también.",

  // Badge statuses
  "badge.complete": "Completo",
  "badge.pending": "Pendiente",
  "badge.not_applicable": "No aplica",
  "badge.generated": "Generado",

  // Empty states with educational content
  "m720.empty_title": "No hay posiciones cargadas",
  "m720.empty_description":
    "El Modelo 720 es una declaración informativa obligatoria si posees bienes en el extranjero valorados en más de 50.000 €. Sube tu informe del broker en la sección Modelo 100 para que DeclaRenta calcule automáticamente si superas el umbral y genere el fichero. Plazo: 1 de enero – 31 de marzo.",
  "m720.empty_cta": "Ir a Modelo 100",
  "d6.empty_title": "No hay posiciones cargadas",
  "d6.empty_description":
    "El Modelo D-6 declara inversiones en valores extranjeros ante el Ministerio de Economía. Desde la reforma de 2021 (Orden ICT/1408/2021), solo es obligatorio si tu participación representa el 10% o más del capital o derechos de voto de una empresa cotizada extranjera. Sube tu informe del broker en la sección Modelo 100 y DeclaRenta generará la guía paso a paso. Plazo: 1 – 31 de enero.",
  "d6.empty_cta": "Ir a Modelo 100",

  // Profile required warnings
  "m720.profile_required": "Completa tu perfil fiscal antes de generar el fichero del Modelo 720.",
  "d6.profile_required": "Completa tu perfil fiscal antes de generar la guía D-6.",

  // Trust signal
  "footer.open_source": "100% código abierto",
  "footer.verify_source": "Verificar código fuente",

  // Splash screen
  "splash.tagline": "Herramienta fiscal gratuita para inversores con brokers internacionales",
  "splash.feature_free": "100% gratuito",
  "splash.feature_selfhosted": "Self-hosted",
  "splash.feature_privacy": "Privacidad total",
  "splash.feature_opensource": "Open source",
  "splash.cta": "Comenzar",

  // Validation
  "validation.future_date": "La operación de {{symbol}} tiene fecha futura ({{date}}). Verifica los datos.",
  "validation.no_cash_transactions":
    "No se han encontrado transacciones de efectivo (dividendos/retenciones). Si usas IBKR, activa la sección Cash Transactions en tu Flex Query.",
  "validation.no_cash_degiro":
    "No se han encontrado dividendos ni retenciones. Degiro los incluye en un fichero separado: descarga también el CSV de Cuenta (Account) desde el Buzón.",
  "validation.no_cash_generic":
    "No se han encontrado transacciones de efectivo (dividendos/retenciones). Si tu broker las exporta por separado, súbelas como fichero adicional.",
  "validation.no_trades_in_year":
    "No hay operaciones en el ejercicio {{year}}. Las operaciones anteriores se usan para el cálculo FIFO.",
  "validation.very_old_data":
    "Los datos incluyen operaciones desde {{year}} (más de 10 años). Verifica que el fichero es correcto.",
  "validation.duplicate_trades":
    "Se han detectado {{count}} operación(es) duplicada(s). Revisa si has subido el mismo fichero dos veces.",

  // Operations annex
  "annex.title": "Anexo de operaciones (Anexo C1)",
  "annex.subtitle": "Detalle individual de operaciones agrupadas por tipo de activo.",
  "annex.operations": "operación(es)",
  "annex.wash_blocked": "Pérdida bloqueada por recompra: {{amount}} EUR (art. 33.5 LIRPF)",
  "annex.wash_dates": "Compras del mismo valor que la bloquean: {{dates}}",
  "annex.wash_hint":
    "En Renta Web, marca esta venta como «Pérdidas patrimoniales no imputables». La pérdida queda pendiente: se integra, primero las pérdidas más antiguas, a medida que vendas acciones de este valor que ninguna recompra en los 2 meses anteriores o posteriores (1 año si el valor no cotiza en un mercado regulado del Espacio Económico Europeo ni en uno equivalente, como NYSE o Nasdaq; en las criptomonedas, solo el año siguiente a la venta, art. 33.5.e) cubre; si recompras parte, solo cuentan las acciones no recompradas. En las criptomonedas, se integra cuando vendas las unidades recompradas, aunque vuelvas a comprar esa criptomoneda (art. 33.5.e); vender otras unidades no la integra.",
  "annex.wash_released": "Libera {{amount}} EUR de pérdidas diferidas de este valor (transmisión definitiva, art. 33.5 LIRPF)",
  "annex.wash_released_dates": "Pérdidas pendientes de las ventas del: {{dates}}",
  "annex.wash_released_hint": "Las acciones de esta venta que ninguna recompra en su plazo cubre son una transmisión definitiva: integran ahora las pérdidas pendientes de ese valor, la de una acción por cada acción, primero las más antiguas (si la venta cierra la posición y ninguna recompra en su plazo la cubre, todas las que queden). En Renta Web, impútalas en este ejercicio.",
  "annex.wash_released_crypto": "Libera {{amount}} EUR de pérdidas diferidas de esta criptomoneda (venta de las unidades recompradas, art. 33.5.e LIRPF)",
  "annex.wash_released_hint_crypto":
    "Esta venta transmite unidades de la recompra que bloqueó una pérdida: integra ahora la parte de esa pérdida que corresponde a las unidades vendidas, aunque vuelvas a comprar esta criptomoneda (art. 33.5.e). Vender otras unidades no la integra. En Renta Web, impútala en este ejercicio.",

  // Tax bracket estimation
  "chart.tax_estimate": "Estimación fiscal (base del ahorro)",
  "tax.bracket_range": "Tramo",
  "tax.bracket_base": "Base",
  "tax.bracket_rate": "Tipo",
  "tax.bracket_tax": "Cuota",
  "tax.total_estimated": "Total estimado",
  "tax.effective_rate": "Tipo efectivo",
  "tax.double_tax_deduction": "Deducción doble imposición",
  "tax.disclaimer":
    "Estimación orientativa. Los tramos corresponden a la base del ahorro del IRPF vigente. Consulta con un asesor fiscal.",
  "tax.breakdown_capital_gains": "Ganancias patrimoniales",
  "tax.breakdown_fx_gains": "Ganancias por tipo de cambio",
  "tax.breakdown_dividends": "Dividendos",
  "tax.breakdown_interest": "Intereses",
  "tax.breakdown_blocked_losses": "Pérdidas bloqueadas (diferidas)",
  "tax.breakdown_reintegrated_losses": "Pérdidas diferidas que ahora se integran",

  // Sidebar - guide
  "sidebar.guia": "Guía Renta Web",

  // Guía de cumplimentación (Renta Web)
  "guide_rw.title": "Guía de cumplimentación — Renta Web",
  "guide_rw.description": "Cómo rellenar cada casilla en Renta Web con los datos de DeclaRenta.",
  "guide_rw.intro":
    "Esta guía explica cómo trasladar los resultados de DeclaRenta a Renta Web (AEAT). Para cada apartado, se indica la casilla destino, qué valor introducir y qué opciones seleccionar en los desplegables.",
  "guide_rw.capital_gains_title": "Ganancias y pérdidas patrimoniales (transmisiones)",
  "guide_rw.fx_title": "Ganancias por tipo de cambio (moneda extranjera)",
  "guide_rw.dividends_title": "Rendimientos del capital mobiliario — Dividendos",
  "guide_rw.interest_title": "Rendimientos del capital mobiliario — Intereses",
  "guide_rw.double_taxation_title": "Deducción por doble imposición internacional",
  "guide_rw.entidad_emisora_label": "Entidad emisora",
  "guide_rw.entidad_emisora_value":
    "Nombre de la empresa o del valor que vendes (ej. Apple Inc.), no el del bróker. En divisas, la moneda (ej. USD). Si consolidas varias operaciones en una sola línea, indica el valor principal.",
  "guide_rw.tipo_elemento_label": "Tipo de elemento patrimonial",
  "guide_rw.tipo_elemento_value_capital":
    "Selecciona <strong>«Acciones admitidas a negociación»</strong> para acciones cotizadas. Para fondos: «Participaciones en IIC». Para derivados/opciones: «Otros elementos patrimoniales».",
  "guide_rw.tipo_elemento_value_fx": "Selecciona <strong>«Otros elementos patrimoniales — Divisas»</strong>.",
  "guide_rw.clave_prereq_title": "¿La casilla del valor de transmisión está bloqueada?",
  "guide_rw.clave_prereq_hint":
    "En Renta Web, las casillas <strong>1633</strong> (valor de transmisión) y <strong>1637</strong> (valor de adquisición) <strong>aparecen deshabilitadas hasta que rellenes antes estos campos, en este orden</strong>:<br>1) Casilla <strong>1626 «Tipo de elemento patrimonial. Clave»</strong> → para divisas y opciones suele ser la clave <strong>4</strong> («Otros elementos patrimoniales no afectos a actividades económicas»); para cripto, revisa la clave que el ejercicio asigne a las monedas virtuales. Los fondos de inversión (IIC) <strong>no</strong> usan la clave 4: se declaran como «Participaciones en IIC».<br>2) <strong>«Tipo de transmisión»</strong> → <strong>«Transmisión intervivos onerosa (venta, permuta, etc.)»</strong> — es <strong>onerosa</strong>, no lucrativa/gratuita.<br>3) <strong>Fecha de transmisión</strong> (casillas <strong>1631/1632</strong>) → día/mes/año de la venta.<br>4) <strong>Fecha de adquisición</strong> (casilla <strong>1932</strong>) → día/mes/año de la compra.<br>Una vez rellenados, las casillas 1633 y 1637 se activan y podrás escribir los importes. <em>El número exacto de casilla puede variar según el ejercicio.</em>",
  "guide_rw.gastos_transmision_label": "Gastos de la transmisión",
  "guide_rw.gastos_adquisicion_label": "Gastos de la adquisición",
  "guide_rw.gastos_zero":
    "<strong>0</strong> — DeclaRenta ya incluye las comisiones en los valores de transmisión/adquisición. No añadas gastos por separado.",
  "guide_rw.gastos_label": "Gastos de administración y depósito",
  "guide_rw.valor_transmision_label": "Valor de transmisión",
  "guide_rw.valor_adquisicion_label": "Valor de adquisición",
  "guide_rw.valor_transmision_hint":
    "El importe de la casilla <strong>0328</strong> de DeclaRenta (EUR, comisiones ya incluidas).",
  "guide_rw.valor_adquisicion_hint":
    "El importe de la casilla <strong>0331</strong> de DeclaRenta (EUR, comisiones ya incluidas).",
  "guide_rw.fx_valor_transmision_hint": "El importe de la casilla <strong>1633</strong> de DeclaRenta.",
  "guide_rw.fx_valor_adquisicion_hint": "El importe de la casilla <strong>1637</strong> de DeclaRenta.",
  "guide_rw.fecha_transmision_label": "Fecha de transmisión",
  "guide_rw.fecha_adquisicion_label": "Fecha de adquisición",
  "guide_rw.fecha_hint_individual":
    "Si introduces operación a operación, usa la fecha exacta del PDF. Si consolidas todas en una línea, usa <strong>31/12/AAAA</strong> (transmisión) y <strong>01/01/AAAA</strong> (adquisición).",
  "guide_rw.fx_fecha_hint":
    "Para la consolidación de FX: <strong>01/01/AAAA</strong> (adquisición) y <strong>31/12/AAAA</strong> (transmisión). Si introduces operación a operación, usa las fechas reales del informe.",
  "guide_rw.retenciones_label": "Retenciones",
  "guide_rw.retenciones_zero": "Normalmente <strong>0</strong> para emisores extranjeros (su retención extranjera va en la casilla 0588). PERO si tienes acciones <strong>españolas</strong> (ISIN ES…) en un bróker extranjero, su retención del 19% SÍ es una retención a cuenta española y va en la <strong>casilla 0597</strong>.",
  "guide_rw.importe_label": "Ingresos íntegros",
  "guide_rw.dividends_importe_hint": "El importe bruto de la casilla <strong>0029</strong> de DeclaRenta (EUR).",
  "guide_rw.interest_importe_hint": "El importe de la casilla <strong>0027</strong> de DeclaRenta (EUR).",
  "guide_rw.dt_pais_label": "País de origen",
  "guide_rw.dt_pais_hint":
    "Selecciona el país donde se practicó la retención (ej. Estados Unidos, Irlanda, Alemania…). Si tienes retenciones de varios países, añade una línea por cada uno.",
  "guide_rw.dt_importe_label": "Importe de la deducción",
  "guide_rw.dt_importe_hint":
    "El importe de la casilla <strong>0588</strong> de DeclaRenta. Es el menor entre la retención extranjera pagada y la cuota española correspondiente (Art. 80 LIRPF).",
  "guide_rw.dt_campo_label": "¿En qué campo del cuadro?",
  "guide_rw.dt_campo_hint":
    "En el cuadro de doble imposición, rellena DOS filas por cada país:<br>• <strong>«Otros rendimientos netos reducidos obtenidos en el extranjero»</strong> (2ª fila) → la columna «Bruto EUR» de ese país en el detalle de la casilla 0588 de DeclaRenta. Si solo hay un país, es la fila «Total rendimientos extranjeros» de ese detalle. No incluye los dividendos españoles ni los de países sin retención.<br>• <strong>«Impuesto satisfecho en el extranjero»</strong> (última fila) → la deducción de ese país en el mismo detalle (con un solo país, el importe de la casilla 0588).<br>Si dejas la 2ª fila vacía, Renta Web muestra el aviso «Ha reflejado el impuesto sin hacer constar las rentas». Las filas 1 y 3 quedan a 0.",
  "guide_rw.capital_gains_note":
    "Si tienes muchas operaciones, puedes consolidarlas en una sola línea por tipo de activo usando las fechas genéricas 01/01 y 31/12. Renta Web acepta importes agregados.",
  "guide_rw.fx_note":
    "Las ganancias por tipo de cambio se declaran aparte de las ganancias de valores. Aparecen cuando conviertes divisa a euros o a otra divisa (p. ej. USD→GBP) —incluidas las conversiones automáticas de tu bróker (p. ej. AFx/FXCONV en IBKR)—, no solo en las conversiones manuales. Con el «Criterio DGT (multidivisa)», mientras mantienes la divisa (p. ej. compras y vendes acciones en USD sin pasar a euros), la diferencia de cambio queda diferida hasta que la conviertes efectivamente, a euros o a otra divisa (Art. 14.2.e LIRPF). Con «Tradicional sin divisa (monodivisa)» esta sección no aplica. Con «Tradicional con divisa», la variación del tipo de cambio mientras tienes las acciones ya va dentro de su ganancia o pérdida (casillas 0328/0331). Solo queda diferida la variación mientras tienes la divisa en efectivo. La divisa también sale cuando pagas comisiones o la pierdes en una venta con pérdidas.",
  "guide_rw.dividends_note":
    "Los dividendos de brokers extranjeros no llevan retención española. La retención extranjera (withholding tax) NO se pone aquí: se deduce aparte en la casilla 0588 (doble imposición).",
  "guide_rw.interest_note":
    "Los intereses del broker (remuneración de saldo) se declaran como rendimientos del capital mobiliario. Los intereses de margen pagados NO son deducibles (Art. 26.1.a LIRPF).",
  "guide_rw.double_taxation_note":
    "La deducción por doble imposición evita pagar dos veces impuestos sobre los mismos dividendos. Se limita al menor entre lo pagado en origen y la cuota española. Si el convenio de doble imposición permite un tipo máximo inferior (ej. 15% EE.UU.), solo es deducible hasta ese límite.",
  "guide_rw.blocked_losses_title": "Pérdidas bloqueadas (anti-churning)",
  "guide_rw.blocked_losses_hint":
    "Si DeclaRenta muestra pérdidas bloqueadas, marca la casilla <strong>«Pérdidas patrimoniales no imputables»</strong> en Renta Web. Se bloquean porque recompraste el mismo valor en los 2 meses anteriores o posteriores a la venta (1 año si el valor no cotiza en un mercado regulado del Espacio Económico Europeo ni en uno equivalente, como NYSE o Nasdaq). En las criptomonedas, solo se bloquean si recompras la misma criptomoneda en el año siguiente a la venta (art. 33.5.e); las compras anteriores a la venta no cuentan. DeclaRenta aplica 2 meses a todo valor con ISIN, salvo que IBKR solo lo muestre en un mercado sin equivalencia (Londres desde 2021, SIX desde julio de 2019, OTC Markets…) o que tú lo marques con 1 año en el panel «Plazo anti-churning por valor» de los resultados (en la línea de comandos, --antichurning-1y). Toronto, Tokio y Singapur tienen una decisión de equivalencia y DeclaRenta les aplica 2 meses, aunque ninguna consulta de la DGT lo confirma para acciones. Si tu valor solo cotiza en un mercado sin equivalencia y DeclaRenta no lo sabe, márcalo con 1 año; si también cotiza en un mercado regulado del Espacio Económico Europeo o en uno equivalente, márcalo con 2 meses. Una compra de los 2 meses anteriores no bloquea si fue la única compra de ese valor en ese plazo y al empezarlo no tenías acciones de ese valor (excepción de compra única, DGT V3282-18); las compras de los 2 meses posteriores siguen bloqueando, salvo la que solo cierra una posición corta, que no es una recompra. Hasta la 0.66.13, DeclaRenta no aplicaba esta excepción: si presentaste un año con esa pérdida bloqueada, puedes corregir aquel año para deducirla (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: solicitud de rectificación). No se suman al coste de la nueva posición: quedan pendientes y se integran, primero las más antiguas, a medida que vendas acciones de ese valor que ninguna recompra en ese plazo cubre (transmisión definitiva); si recompras parte, solo cuentan las acciones no recompradas. En las criptomonedas, se integra cuando vendas las unidades recompradas, aunque vuelvas a comprar esa criptomoneda (art. 33.5.e); vender otras unidades no la integra. Si declaraste un año con DeclaRenta 0.66.5 o anterior, esas versiones liberaban una pérdida al vender las acciones recompradas aunque volvieras a recomprar: si ya dedujiste esa pérdida, no la deduzcas otra vez cuando DeclaRenta la libere ahora, o corrige aquel año (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria). Y al revés: si DeclaRenta libera ahora una pérdida en un año que ya presentaste con la 0.66.5 o anterior, puedes corregir aquel año para deducirla (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: solicitud de rectificación). En las criptomonedas, si declaraste un año con DeclaRenta 0.66.13 o anterior, una compra anterior a la venta podía bloquear la pérdida: si DeclaRenta deduce o libera ahora una pérdida de criptomonedas en un año que ya presentaste, corrige aquel año para deducirla (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: solicitud de rectificación); si no, no se deduce nunca. Siempre que corrijas un año para deducir una pérdida, revisa también los años posteriores que ya presentaste: si en alguno dedujiste esa misma pérdida porque la versión anterior la liberó allí, corrige también ese año para quitarla (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria), para no deducirla dos veces: una pérdida solo se deduce una vez.",
  "guide_rw.closing_tip": "Tras introducir todos los datos, usa el botón «Verificar declaración» de Renta Web para comprobar errores. Si otra herramienta muestra un importe distinto en ganancias patrimoniales, puede usar otro método para las acciones en divisa. En los resultados de Modelo 100, abre «Comparar con los otros métodos» para ver las cifras de los tres. Para cambiar de método, vuelve al paso «Revisar y elegir método». Usa el mismo método todos los años.",

  // PDF report
  "pdf.subtitle": "Informe fiscal — Ejercicio",
  "pdf.generated": "Generado el",
  "pdf.informative": "Informativo",
  "pdf.blocked_losses": "Pérdidas bloqueadas anti-churning",
  "pdf.interest_margin": "Intereses margen (no deducible)",
  "pdf.section_casillas": "1. Resumen de Casillas — Modelo 100",
  "pdf.section_operations": "2. Detalle de Operaciones",
  "pdf.section_dividends": "3. Dividendos",
  "pdf.section_dt": "4. Deducción por Doble Imposición Internacional",
  "pdf.section_warnings": "Advertencias",
  "pdf.reintegrated_losses": "Pérdidas reintegradas (anti-churning)",
  "pdf.dt_paid": "Impuesto pagado",
  "pdf.dt_allowed": "Deducción permitida",
  "pdf.ecb_note":
    "Tipo ECB: tipo de cambio oficial del Banco Central Europeo (EUR por 1 unidad de divisa extranjera) en la fecha de la operación. Fuente: ECB SDMX API.",
  "pdf.footer":
    "DeclaRenta — https://declarenta.com — Este informe es orientativo y no sustituye al asesoramiento fiscal profesional.",

  // Manual crypto valuation
  "crypto_rates.title": "Valoración manual de criptomonedas",
  "crypto_rates.description":
    "Algunos canjes entre criptomonedas no se han podido valorar automáticamente porque ninguna de las dos divisas tiene un tipo de cambio oficial del BCE. Introduce el valor en euros por unidad en la fecha de la operación para incluirlos.",
  "crypto_rates.help":
    "Nunca consultamos precios de criptomonedas en internet: tu cartera permanece privada. Busca tú mismo el valor en euros (p. ej. en el historial de tu exchange o en una web de precios) e introdúcelo aquí.",
  "crypto_rates.col_asset": "Activo",
  "crypto_rates.col_date": "Fecha",
  "crypto_rates.col_quantity": "Cantidad",
  "crypto_rates.col_currency": "Moneda",
  "crypto_rates.col_eur_per_unit": "EUR por unidad",
  "crypto_rates.placeholder": "p. ej. 142,50",
  "crypto_rates.save_btn": "Guardar y recalcular",
  "crypto_rates.saved": "Guardado",
  "crypto_rates.recalculate_hint": "Los valores se guardan en tu navegador y el informe se recalcula.",
  "crypto_rates.stored_title": "Precios manuales guardados",
  "crypto_rates.stored_description":
    "Estos precios en euros están guardados en tu navegador y se aplican cada vez que procesas un archivo. Corrige un valor y guarda, o bórralos todos si alguno es erróneo.",
  "crypto_rates.clear_btn": "Borrar precios guardados",

  // Manual opening lots for transferred positions
  "opening_lots.title": "Lotes manuales para posiciones transferidas",
  "opening_lots.description":
    "Si una venta corresponde a acciones transferidas desde otro broker, puedes introducir aquí los lotes de compra originales para que el FIFO calcule el coste base correcto.",
  "opening_lots.help":
    "Añade tantos lotes como necesites. Cada fila representa una compra previa distinta con su propia fecha, cantidad y precio por acción. Los datos se guardan solo en tu navegador.",
  "opening_lots.effect_hint":
    "Si el resultado baja después de introducir estos lotes, es normal: antes esa venta se estaba calculando con coste base = 0.",
  "opening_lots.group_intro":
    "Faltan {{quantity}} títulos para la venta del {{date}}. Introduce los lotes previos que cubren esa posición transferida.",
  "opening_lots.group_intro_saved":
    "Estos lotes manuales están guardados en tu navegador y se seguirán aplicando mientras no los borres.",
  "opening_lots.col_acquire_date": "Fecha de compra",
  "opening_lots.col_quantity": "Cantidad",
  "opening_lots.col_price": "Precio por acción",
  "opening_lots.col_actions": "Acciones",
  "opening_lots.placeholder_quantity": "p. ej. 14",
  "opening_lots.placeholder_price": "p. ej. 100,00",
  "opening_lots.add_row": "Añadir lote",
  "opening_lots.remove_row": "Quitar",
  "opening_lots.save_btn": "Guardar lotes y recalcular",
  "opening_lots.clear_btn": "Borrar lotes guardados",
  "opening_lots.saved": "Guardado",
  "opening_lots.row_invalid":
    "Revisa las filas marcadas: indica la fecha de compra y una cantidad y un precio mayores que cero (p. ej. 1.234,56). No se ha guardado nada.",
  "opening_lots.recalculate_hint": "Los lotes manuales se guardan en tu navegador y el informe se recalcula.",

  // Engine & parser messages (TaxMessage id → localized text). The engine still
  // emits the Spanish message/hint as a byte-identical fallback for any id NOT
  // present here; these keys add localized rendering. {{placeholders}} are filled
  // from each message's `context`. es is the source of truth — keep tildes/ñ.
  "fx.missing_prior_lots":
    "⚠ {{count}} disposiciones de {{currency}} sin lotes previos suficientes (total: {{totalQuantity}} {{currency}}). Posible adquisición anterior al período declarado — ganancia FX asumida = 0.",
  "fx.missing_prior_lots.hint":
    "La adquisición de esta divisa fue anterior al periodo del Flex Query. Se asume ganancia FX = 0 (tratamiento conservador).",
  "fx.conservation_mismatch":
    "⚠ Descuadre interno del motor de divisa para {{currency}}: {{mismatch}} unidades sin cuadrar. Las casillas 1633/1637 pueden no reconciliar.",
  "fx.conservation_mismatch.hint":
    "Esto es una comprobación interna (no debería ocurrir). Si lo ves, repórtalo en GitHub adjuntando el informe; los importes de divisa pueden necesitar revisión manual.",
  "fifo.unknown_category":
    '⚠ Categoría de activo desconocida: "{{assetCategory}}" para {{symbol}}. Se procesará con FIFO genérico.',
  "fifo.unknown_category.hint":
    "Se procesa igualmente con FIFO genérico. Si es un activo nuevo de IBKR, puede que se añada en futuras versiones.",
  "fifo.scrip_dividend": "📈 Scrip dividend: {{symbol}} +{{quantity}} acciones el {{date}}",
  "fifo.scrip_dividend.hint": "El scrip dividend se ha añadido como lote con coste igual al valor del dividendo.",
  "fifo.roll_operation": "⚠ Operación C;O (roll): {{symbol}} el {{date}}. Se procesa como cierre + apertura.",
  "fifo.roll_operation.hint":
    "Operación roll procesada correctamente como cierre de la posición anterior y apertura de la nueva.",
  "fifo.unknown_direction": '⚠ Operación con dirección desconocida ("{{buySell}}"): {{symbol}} el {{date}}. No se ha procesado.',
  "fifo.unknown_direction.hint": "Solo se procesan compras (BUY) y ventas (SELL). Revisa esta fila en el archivo del broker y, si es una operación real, corrige su dirección.",
  "fifo.split_applied": "⚡ Split {{isin}} {{ratio}} ({{direction}}) aplicado ({{date}})",
  "fifo.split_applied.hint":
    "Split aplicado a todos los lotes. El coste total se mantiene — solo cambia el número de acciones.",
  "fifo.split_unresolved": "⚠ Split de {{symbol}} el {{date}} sin aplicar: no hay acciones anteriores con las que calcular la proporción.",
  "fifo.split_unresolved.hint":
    "Sube también los extractos de años anteriores, desde la apertura de la cuenta. Si no, el número de acciones y el coste de las ventas posteriores de este valor no serán correctos.",
  "fifo.merger_applied":
    "🔄 Fusión: {{oldIsin}} → {{newIsin}} (ratio {{ratio}}, {{lotsTransferred}} lotes transferidos, {{date}})",
  "fifo.merger_applied.hint":
    "Fusión fiscal neutra: los lotes se transfieren al nuevo ISIN conservando el coste base original.",
  "fifo.cash_merger_disposal":
    "💶 Compra en efectivo: {{symbol}} ({{isin}}) × {{quantity}} el {{date}}. Se declara como una venta.",
  "fifo.cash_merger_disposal.hint":
    "Una fusión o adquisición pagada en efectivo es una transmisión: la ganancia o pérdida se calcula como en una venta, con el efectivo recibido como valor de transmisión.",
  "fifo.spinoff_applied":
    "🔀 Spin-off: {{parentIsin}} → {{newIsin}} (ratio {{ratio}}, coste {{costPercent}}% al spin-off, {{date}})",
  "fifo.spinoff_applied.hint": "El coste se reparte proporcionalmente entre la matriz y la empresa escindida.",
  "fifo.corporate_action_unhandled":
    "ℹ Acción corporativa {{type}} de {{symbol}} ({{isin}}) el {{date}}: no se aplica al cálculo FIFO.",
  "fifo.corporate_action_unhandled.hint":
    "Si cambió el número de acciones o el ISIN de la posición, revisa el coste de las ventas posteriores de este valor.",
  "fifo.sell_without_lots":
    "⚠ Venta sin lotes: {{symbol}}{{isinSuffix}} × {{quantity}} el {{date}}. Coste base = 0 (posible posición corta o datos previos incompletos).",
  "fifo.sell_without_lots.hint":
    "¿Incluye tu exportación los años anteriores? Descarga de tu broker un periodo que cubra desde la primera compra de este valor.",
  "fifo.cover_without_lots":
    "⚠ Cierre de corto sin lotes: {{symbol}} ({{isin}}) × {{quantity}} el {{date}}. Ganancia no calculada (posición corta abierta fuera del periodo o datos previos incompletos).",
  "fifo.cover_without_lots.hint":
    "¿Has incluido los años anteriores en tu Flex Query? Selecciona un periodo que cubra desde la venta que abrió esta posición corta.",
  "fifo.insufficient_lots": "⚠ Lotes insuficientes: {{symbol}}{{isinSuffix}} × {{quantity}} el {{date}}. Coste base = 0.",
  "fifo.insufficient_lots.hint":
    "El fichero no cubre todas las compras previas de este valor. Exporta desde tu broker un periodo más amplio.",
  "fifo.option_invalid_date": "⚠ Evento OptionEAE sin fecha válida para {{symbol}}. Omitido.",
  "fifo.option_invalid_date.hint":
    "Evento de opción omitido por fecha inválida. Revisa que el Flex Query incluye la sección 'Option Exercises, Assignments & Expirations'.",
  "fifo.option_zero_quantity": "⚠ Evento OptionEAE con cantidad 0 para {{symbol}} el {{date}}. Omitido.",
  "fifo.option_zero_quantity.hint": "Evento de opción con cantidad 0 — probablemente un registro duplicado de IBKR.",
  "fifo.option_invalid_strike": '⚠ Strike inválido "{{strike}}" para {{symbol}} el {{date}}. Omitiendo ejercicio.',
  "fifo.option_invalid_strike.hint":
    "No se pudo calcular el ejercicio de esta opción. El coste del subyacente no incluirá la prima.",
  "fifo.option_expiry_no_lots": "⚠ Expiración de opción sin lotes: {{symbol}} × {{quantity}} el {{date}}.",
  "fifo.option_expiry_no_lots.hint":
    "La opción expiró pero no se encontraron lotes de compra. ¿Incluiste el año de compra en el Flex Query?",
  "fifo.option_exercise_no_lots":
    "⚠ Ejercicio/asignación sin lotes de opción: {{symbol}} × {{quantity}} el {{date}}. Coste de prima = 0.",
  "fifo.option_exercise_no_lots.hint":
    "Ejercicio registrado con prima = 0 porque no se encontró la compra de la opción. Amplía el periodo del Flex Query.",
  "fifo.exercise_no_underlying_lots":
    "⚠ Ejercicio de opción sin lotes del subyacente: {{symbol}} × {{quantity}} el {{date}}. Coste base = 0.",
  "fifo.exercise_no_underlying_lots.hint":
    "Asignación de PUT registrada con coste base = 0 del subyacente. El Flex Query puede no cubrir la adquisición original.",
  "fifo.insufficient_underlying_lots":
    "⚠ Lotes insuficientes del subyacente: {{symbol}} × {{quantity}} el {{date}}. Coste base = 0.",
  "fifo.insufficient_underlying_lots.hint":
    "No hay suficientes lotes del subyacente para cubrir la asignación completa.",
  "report.crypto_valuation_unresolved":
    "Hay {{count}} operación(es) en criptomoneda cuyo valor en euros no se ha podido determinar automáticamente y se han excluido de los cálculos.",
  "report.crypto_valuation_unresolved.hint":
    "Sucede en permutas cripto-cripto (p. ej. Binance Convert) cuando ninguna de las dos monedas tiene tipo de cambio oficial del BCE. Introduce manualmente el valor en euros por unidad de cada moneda en la fecha indicada para incluir estas operaciones.",
  "report.crypto_commission_neutralized":
    "Se ha ignorado la comisión de {{count}} operación(es) por estar denominada en una criptomoneda sin tipo de cambio disponible.",
  "report.crypto_commission_neutralized.hint":
    "El valor principal de la operación sí se ha calculado; solo se omite la pequeña comisión, cuyo impacto fiscal es mínimo.",
  "report.crypto_income_unvalued":
    "Hay {{count}} ingreso(s) en criptomoneda (p. ej. recompensas de staking) que no se han podido valorar automáticamente y no están incluidos en los importes calculados.",
  "report.crypto_income_unvalued.hint":
    "Estos ingresos se pagan en la propia cripto y no tienen tipo de cambio oficial del BCE. Calcula su valor en euros a la fecha de cobro y decláralos manualmente como rendimientos del capital mobiliario (Casilla 0027).",
  "report.dividend_unvalued":
    "Hay {{count}} dividendo(s) en {{currencies}} que no se han podido valorar automáticamente y no están incluidos en los importes calculados.",
  "report.dividend_unvalued.hint":
    "El BCE no publica un tipo de cambio oficial para esa divisa en la fecha de cobro. Calcula el importe en euros a esa fecha, súmalo a mano a la casilla 0029 y ten en cuenta su retención en la deducción por doble imposición internacional (casilla 0588).",
  "report.withholding_corrected_prior_year":
    "Este fichero trae correcciones de retenciones en origen de {{year}} anotadas en {{reportYear}}: la retención de {{year}} baja {{amount}} €. Si presentaste {{year}} con la retención original, la casilla 0588 de ese año pudo salir alta.",
  "report.withholding_corrected_prior_year.hint":
    "La deducción por doble imposición internacional (casilla 0588, art. 80 LIRPF) solo admite el impuesto pagado de verdad en el extranjero. Sube el fichero de {{year}} junto a este y calcula {{year}}: DeclaRenta suma la corrección a la retención de su dividendo. Si la casilla 0588 baja respecto a la que presentaste, corrige la declaración de {{year}} (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria). Las casillas de {{reportYear}} no cambian.",
  "report.spanish_withholding_corrected_prior_year":
    "Este fichero trae correcciones de retenciones españolas de {{year}} anotadas en {{reportYear}}: la retención de {{year}} baja {{amount}} €. Si presentaste {{year}} con la retención original, la casilla 0597 de ese año pudo salir alta.",
  "report.spanish_withholding_corrected_prior_year.hint":
    "La retención española sobre dividendos de emisores españoles es un pago a cuenta (casilla 0597, retenciones del capital mobiliario) y solo cuenta lo retenido de verdad. Sube el fichero de {{year}} junto a este y calcula {{year}}: DeclaRenta suma la corrección a la retención de su dividendo. Si la casilla 0597 baja respecto a la que presentaste, corrige la declaración de {{year}} (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria). Las casillas de {{reportYear}} no cambian.",
  "report.crypto_general_gain_unvalued":
    "Hay {{count}} ganancia(s) patrimonial(es) en criptomoneda (p. ej. airdrops o comisiones de referidos) que no se han podido valorar automáticamente y no están incluidas en los importes calculados.",
  "report.crypto_general_gain_unvalued.hint":
    "Estas rentas se reciben en la propia cripto y no tienen tipo de cambio oficial del BCE. Calcula su valor en euros a la fecha de cobro y decláralas manualmente como ganancia patrimonial no derivada de transmisión (base general).",
  "report.antichurning_window_past_data":
    "Hay {{count}} venta(s) de {{year}} cuyo plazo de recompra de la regla anti-churning (2 meses; 1 año si el valor no cotiza en un mercado regulado del Espacio Económico Europeo ni en uno equivalente; en las criptomonedas, solo el año siguiente a la venta) termina después de la última fecha que cubren los ficheros subidos de ese bróker ({{lastDate}}). DeclaRenta no ve las compras posteriores a esa fecha.",
  "report.antichurning_window_past_data.hint":
    "Si compraste el mismo valor después del {{lastDate}} y dentro del plazo de esas ventas (como muy tarde, hasta el {{windowEnd}}), parte de su pérdida puede quedar bloqueada, o la venta deja de ser una transmisión definitiva y no libera pérdidas pendientes. Sube también el fichero con las operaciones hasta el {{windowEnd}} junto a este y calcula de nuevo. Ese plazo es de 1 año en los valores a los que DeclaRenta aplica 1 año (porque IBKR solo los muestra en un mercado sin equivalencia, como Londres desde 2021, SIX u OTC Markets, o porque tú los marcaste) y de 2 meses en los demás valores con ISIN. Si un valor solo cotiza en un mercado así y DeclaRenta le aplica 2 meses, márcalo con 1 año en el panel «Plazo anti-churning por valor» (en la línea de comandos, --antichurning-1y) y calcula de nuevo. En las criptomonedas solo cuentan las compras de la misma criptomoneda, en cualquier exchange, hechas después de la venta y, como muy tarde, hasta el {{windowEnd}}; las anteriores a la venta no cuentan. Si no compraste, el cálculo ya es correcto.",
  "report.antichurning_window_open_at_filing":
    "Hay {{count}} venta(s) de {{year}} cuyo plazo de recompra de la regla anti-churning termina el {{windowEnd}} como muy tarde: después del {{deadline}}, último día para presentar la declaración, y después de la última fecha que cubren los ficheros subidos de ese bróker ({{lastDate}}). Cuando presentes la declaración, ese plazo seguirá abierto.",
  "report.antichurning_window_open_at_filing.hint":
    "Antes de presentar, sube también el fichero con tus operaciones posteriores al {{lastDate}} y calcula de nuevo. Si compras el mismo valor o la misma criptomoneda hasta el {{windowEnd}} inclusive, parte de la pérdida de esas ventas puede quedar bloqueada, o la venta deja de ser una transmisión definitiva y no libera pérdidas pendientes. En ese caso, corrige la declaración presentada con una autoliquidación rectificativa.",
  "report.antichurning_one_year_ibkr":
    "DeclaRenta aplica el plazo de 1 año de la regla anti-churning (art. 33.5.g LIRPF) a las ventas de {{count}} valor(es) hechas en días en que IBKR solo los muestra en un mercado que no es un mercado regulado del Espacio Económico Europeo ni un mercado declarado equivalente por la Comisión Europea: {{list}}.",
  "report.antichurning_one_year_ibkr.hint":
    "IBKR solo muestra el mercado de las líneas que has operado. Si el valor también está admitido a negociación en un mercado regulado del Espacio Económico Europeo (no basta un mercado de crecimiento ni otro sistema multilateral de negociación) o en NYSE, Nasdaq, ASX o la Bolsa de Hong Kong, le corresponden 2 meses: márcalo con 2 meses en el panel «Plazo anti-churning por valor» (en la línea de comandos, --antichurning-2m) y calcula de nuevo.",
  "report.antichurning_listing_open":
    "DeclaRenta aplica 2 meses a las ventas de {{count}} valor(es) hechas en días en que IBKR los muestra en Toronto, TSX Venture, Aequitas Neo, Tokio o Singapur: {{list}}. Una decisión de la Comisión Europea declara ese mercado equivalente a un mercado regulado, y la DGT acepta ese tipo de decisión (consulta V0778-25), pero ninguna consulta lo confirma para acciones.",
  "report.antichurning_listing_open.hint":
    "Si prefieres el criterio prudente, márcalo con 1 año en el panel «Plazo anti-churning por valor» (en la línea de comandos, --antichurning-1y) y calcula de nuevo.",
  "report.antichurning_window_user":
    "Has fijado a mano el plazo de la regla anti-churning de {{count}} valor(es). 1 año: {{oneYear}}. 2 meses, en lugar del año que daba IBKR: {{twoMonths}}.",
  "report.antichurning_window_user.hint":
    "DeclaRenta usa tu plazo en lugar del automático en el bloqueo de pérdidas, en la prueba de transmisión definitiva y en los avisos de plazo. Puedes cambiarlo en el panel «Plazo anti-churning por valor» (en la línea de comandos, --antichurning-1y o --antichurning-2m).",
  "antichurning_window.title":
    "Plazo anti-churning por valor",
  "antichurning_window.description":
    "La regla anti-churning bloquea una pérdida si recompras el mismo valor en los 2 meses anteriores o posteriores a la venta (art. 33.5.f LIRPF). Si el valor no está admitido a negociación en un mercado regulado del Espacio Económico Europeo ni en un mercado declarado equivalente, el plazo es de 1 año (art. 33.5.g). DeclaRenta elige el plazo con el mercado que muestra IBKR y, si no lo sabe, aplica 2 meses. Aquí puedes fijarlo para cada valor.",
  "antichurning_window.col_security":
    "Valor",
  "antichurning_window.col_listing":
    "Mercado según IBKR",
  "antichurning_window.col_window":
    "Plazo",
  "antichurning_window.months_2":
    "2 meses",
  "antichurning_window.months_12":
    "1 año",
  "antichurning_window.opt_auto":
    "Automático ({{window}})",
  "antichurning_window.opt_2m":
    "2 meses: admitido en un mercado regulado del EEE o en uno equivalente",
  "antichurning_window.opt_1y":
    "1 año: no admitido en un mercado regulado del EEE ni en uno equivalente (p. ej. solo en Londres desde 2021, SIX, OTC o BME Growth)",
  "antichurning_window.no_listing":
    "sin dato",
  "antichurning_window.open_note":
    "Equivalencia por la Decisión {{decision}}, sin confirmar para acciones",
  "antichurning_window.save_btn":
    "Guardar y recalcular",
  "antichurning_window.clear_btn":
    "Borrar los plazos guardados",
  "antichurning_window.saved":
    "Guardado",
  "antichurning_window.recalculate_hint":
    "Los plazos se guardan en tu navegador y el informe se recalcula.",
  "antichurning_window.save_error":
    "El navegador no ha dejado guardar los plazos: su almacenamiento puede estar lleno o bloqueado. El informe no ha cambiado.",
  "antichurning_window.clear_error":
    "El navegador no ha dejado borrar los plazos guardados: su almacenamiento puede estar bloqueado. El informe no ha cambiado.",
  "report.antichurning_single_purchase":
    "En {{count}} venta(s) de {{year}}, la compra de los 2 meses anteriores no cuenta como recompra: fue la única compra de ese valor en ese plazo y al empezar el plazo no tenías acciones de ese valor (excepción de compra única, DGT V3282-18). Esa compra no bloquea su pérdida ni impide que la venta libere pérdidas pendientes.",
  "report.antichurning_single_purchase.hint":
    "DeclaRenta solo ve los ficheros subidos. Si al empezar el plazo (el primero empieza el {{windowStart}}) tenías acciones de ese valor en otro bróker o cuenta que no has subido, o después las traspasaste a otra entidad, la excepción no se aplica: sube también esos ficheros y calcula de nuevo. Una compra en los 2 meses posteriores a la venta sigue bloqueando la pérdida.",
  "report.antichurning_single_purchase_unverified":
    "En {{count}} venta(s) de {{year}} puede aplicarse la excepción de compra única de la regla de los 2 meses, pero DeclaRenta no la aplica: los ficheros subidos no demuestran que al empezar el plazo (el primero empieza el {{windowStart}}) no tuvieras acciones de ese valor. La compra de los 2 meses anteriores cuenta como recompra.",
  "report.antichurning_single_purchase_unverified.hint":
    "Si al empezar el plazo no tenías acciones de ese valor en ningún bróker, y en los 2 meses anteriores a la venta solo hiciste esa compra, esa compra no cuenta como recompra (DGT V3282-18). DeclaRenta solo la aplica cuando tus ficheros lo demuestran, cuenta por cuenta: los ficheros de cada cuenta que tiene o mueve ese valor deben cubrir sus operaciones sin huecos ni días repetidos desde el {{windowStart}} hasta unas posiciones a fin de periodo con fecha igual o posterior a la venta (en IBKR, las secciones Trades y Open Positions de la Flex Query, con el campo ISIN), con todas las cantidades legibles y con las mismas acciones que dejan las operaciones de esa cuenta. Una operación de acciones sin ISIN en ese periodo, o unas acciones sin ISIN que aún tuvieras al empezarlo (por ejemplo, de Revolut), en cualquier cuenta, también lo impiden, porque pueden ser de ese valor. Un fichero que solo incluye operaciones no basta, y un traspaso entre cuentas o un lote manual dentro de ese plazo no se puede comprobar.",
  "report.titularidad_compartida":
    "Los importes mostrados están divididos entre {{titulares}} titulares (la parte que corresponde a cada contribuyente). Este informe refleja la declaración de UN solo titular: cada uno de los {{titulares}} titulares debe presentar su propia declaración con esta misma parte. No declares el total en una sola declaración ni sumes las partes de varios titulares en la tuya.",
  "report.titularidad_compartida.hint":
    "El reparto a partes iguales ({{titulares}} × {{percent}} %) presupone titularidad por igual. Si los porcentajes de titularidad son distintos (p. ej. 70/30), ajusta los importes manualmente. En cuentas de gananciales la atribución es 50/50 (Art. 11.3 LIRPF). Puedes cambiar el número de titulares en el paso «Revisar y elegir método» (en la línea de comandos, --titulares).",
  "report.competitor_reconciliation":
    "Si otra herramienta muestra un importe distinto, puede deberse a que no calcula las ganancias por tipo de cambio (Art. 33.1 LIRPF).",
  "report.competitor_reconciliation.hint":
    "Puedes comparar con otro método en el paso «Revisar y elegir método» (en la línea de comandos, --fx-method). «Tradicional con divisa» valora las acciones al tipo del día de compra y al del día de venta, y también calcula tu divisa. «Tradicional sin divisa (monodivisa)» valora las acciones igual, pero no calcula ningún resultado de divisa, tampoco en las conversiones USD→EUR.",
  "report.monodivisa_conversions_skipped":
    "El método «Tradicional sin divisa (monodivisa)» ha dejado sin calcular {{count}} conversión(es) de divisa de este ejercicio (manuales o automáticas del bróker). Este método no calcula ningún resultado de divisa (casillas 1633/1637).",
  "report.monodivisa_conversions_skipped.hint":
    "Si has convertido divisa (por ejemplo, de USD a EUR), elige «Tradicional con divisa» en el paso «Revisar y elegir método» (en la línea de comandos, --fx-method tradicional-divisa). Valora las acciones igual y sí calcula tus conversiones. El «Criterio DGT (multidivisa)» también las calcula.",
  "report.fx_method_consistency":
    "DeclaRenta calcula con el «Criterio DGT (multidivisa)»: la ganancia de divisa se difiere hasta que conviertes la moneda extranjera a euros (Art. 14.2.e LIRPF; DGT V0152-26). Hay otros dos métodos: «Tradicional con divisa» y «Tradicional sin divisa (monodivisa)».",
  "report.fx_method_consistency.hint":
    "No mezcles métodos entre ejercicios: si un año declaraste con otro criterio (o con otra herramienta), la base de divisa arrastrada puede duplicarse u omitirse. Para divisa adquirida antes del periodo de tu informe, incluye los años anteriores en la exportación del bróker.",
  "report.fx_deferred_no_conversion":
    "No has convertido divisa a euros este ejercicio, por lo que no hay ganancia por tipo de cambio que declarar (no se suma ningún importe de divisa a las casillas 1633/1637). La diferencia de cambio mientras mantienes la moneda queda diferida hasta que la conviertas efectivamente a euros (Art. 14.2.e LIRPF; DGT V0152-26).",
  "report.fx_deferred_no_conversion.hint":
    "Tu bróker (p. ej. IBKR) puede mostrar una «realized forex gain» aunque no hayas pasado a euros: usa el criterio fiscal de EE. UU., no el español. Con el «Criterio DGT (multidivisa)», la ganancia de divisa solo se declara al cambiarla a euros o a otra divisa.",
  "report.fx_traditional_method":
    "Método «Tradicional con divisa». Las acciones en divisa se valoran al tipo del BCE del día de compra (coste) y del día de venta (venta). La divisa tributa por FIFO cuando sale de tu cuenta: al cambiarla a euros o a otra divisa, al pagar comisiones o intereses, o al perderla en una venta con pérdidas. Una venta te devuelve la divisa invertida y, si ganas, la ganancia. La divisa invertida cuesta lo que te costó, más la variación del tipo de cambio entre la compra y la venta de las acciones, que ya va en el resultado de esa venta. La ganancia entra al tipo del día de la venta. La divisa invertida que no recuperas tributa aparte, en esa venta. Así cada variación de la divisa se declara una sola vez.",
  "report.fx_traditional_method.hint":
    "La DGT valora así las participaciones de fondos en divisa (V2324-10, V0775-21). Para acciones, Hacienda calcula la ganancia en divisa y la pasa a euros al tipo del día de la venta (V1740-17, V2422-20, V0152-26): es el «Criterio DGT (multidivisa)». En los dos métodos, la divisa que cambias tributa al cambiarla (V2466-08). La divisa perdida en una venta con pérdidas tributa el año de la venta, como en los fondos (V0775-21, V2324-10). Autodeclaro describe la misma valoración de acciones, con los tipos de cambio del extracto de tu bróker, pero no publica cómo calcula la divisa. Usa el mismo método todos los años.",
  "report.fx_traditional_risk":
    "Hacienda aplica a las acciones el «Criterio DGT (multidivisa)» (V1740-17). En 2025 rechazó este mismo cálculo para un piso en dólares (V1615-25). Si revisa tu declaración, puede recalcularla con ese criterio.",
  "report.fx_traditional_risk.hint":
    "Si en el ciclo completo (euros → divisa → acciones → divisa → euros) no hay ventas con pérdidas, los dos métodos suelen dar casi el mismo total. Cambia en qué año y en qué casilla sale cada parte, y también puede cambiar la deducción por doble imposición (casilla 0588). Con ventas con pérdidas, este método declara también la divisa perdida y el total es distinto. Ninguna consulta de la DGT respalda este método para acciones. Si Hacienda recalcula, puede cobrar intereses de demora por el impuesto que este método lleva a un año posterior.",
  "report.fx_traditional_no_conversion":
    "No has cambiado divisa este año. La variación del {{ccy}} mientras tenías las acciones ya está en su ganancia o pérdida. La variación mientras tienes los {{ccy}} en efectivo se declarará cuando los cambies.",
  "report.fx_traditional_no_conversion.hint":
    "Con este método, la divisa solo se suma a las casillas 1633/1637 cuando sale de tu cuenta: cambios a euros o a otra divisa, comisiones, intereses pagados y divisa perdida en ventas con pérdidas.",
  "report.fx_traditional_lost_dollars":
    "En {{n}} venta(s) con pérdidas recuperaste menos {{ccy}} de los que invertiste. Esos {{ccy}} perdidos salen de tu cuenta. Su diferencia de cambio, desde que los compraste hasta que compraste las acciones ({{amount}} €), se declara este año en las casillas 1633/1637.",
  "report.fx_traditional_lost_dollars.hint":
    "El «Criterio DGT (multidivisa)» no declara nada en este caso, porque esos {{ccy}} nunca se cambiaron a euros. Este método sí lo declara, como la DGT en los fondos en divisa (V0775-21, V2324-10): la variación de la divisa antes de la compra tributa el año de la venta. El orden FIFO decide qué {{ccy}} se perdieron. Lo verás en el detalle de las casillas 1633/1637 como «Divisa perdida en una venta con pérdidas».",
  "report.fx_traditional_guard":
    "En {{n}} venta(s), la caída del {{ccy}} desde la compra de las acciones supera lo que te costó esa divisa. Su diferencia de cambio hasta la compra de las acciones ({{amount}} €) se declara este año en las casillas 1633/1637, y esos {{ccy}} vuelven al tipo del día de la venta.",
  "report.fx_traditional_guard.hint":
    "Pasa cuando el tipo de cambio se mueve mucho (más o menos el doble) entre la compra de la divisa y la venta de las acciones. Sin esta regla, esos {{ccy}} tendrían un coste negativo. Lo verás en el detalle de las casillas 1633/1637 como «Variación de la divisa hasta la compra de las acciones».",
  "report.fx_traditional_inflight":
    "Has cambiado este año {{qty}} {{ccy}} que vienen de ventas de acciones de {{years}}. Este método da por hecho que la variación del {{ccy}} mientras tenías esas acciones ({{amount}} €) ya se declaró dentro de la ganancia o pérdida de aquel año.",
  "report.fx_traditional_inflight.hint":
    "Así es si aquel año usaste «Tradicional con divisa» o «Tradicional sin divisa (monodivisa)». Si usaste el «Criterio DGT (multidivisa)», tu resultado de divisa de este año está desviado en esa cantidad. Usa el mismo método que entonces.",
  "report.fx_traditional_uncovered":
    "{{qty}} {{ccy}} usados en compras de acciones no tienen origen en euros en tus archivos (depósitos, saldos anteriores, años que no has subido, o un descubierto o préstamo de margen del bróker). Se toman al tipo del día de compra, sin diferencia de cambio anterior.",
  "report.fx_traditional_uncovered.hint":
    "Si cambiaste euros a {{ccy}} hasta 7 días después de la compra, se usa el tipo de ese cambio. Si conoces su origen, sube también los años anteriores.",
  "report.fx_traditional_uncovered_ibkr":
    "{{qty}} {{ccy}} usados en compras de acciones no tienen origen en euros en tus archivos (depósitos, saldos anteriores, años que no has subido, o un descubierto o préstamo de margen del bróker). Se toman al tipo del día de compra, sin diferencia de cambio anterior.",
  "report.fx_traditional_uncovered_ibkr.hint":
    "Si cambiaste euros a {{ccy}} hasta 7 días después de la compra, se usa el tipo de ese cambio. Si conoces su origen, sube también los años anteriores. Si tu saldo en {{ccy}} quedó en negativo (descubierto o margen), sube el extracto de IBKR con la sección «Cash Report». DeclaRenta trata ese saldo negativo como un préstamo en {{ccy}} solo si el Cash Report cuadra con tus operaciones, es de una sola cuenta y no hay en {{ccy}} depósitos, retiradas, transferencias, opciones ni posiciones cortas.",
  "report.fx_traditional_opening":
    "{{qty}} {{ccy}} del saldo inicial de tu cuenta (el «Cash Report» de IBKR) se usaron en compras de acciones y no tienen origen en euros en tus archivos. Se toman al tipo del día de compra, sin diferencia de cambio anterior.",
  "report.fx_traditional_opening.hint":
    "Ese saldo ya estaba en la cuenta al empezar el primer periodo que has subido. Si conoces su origen, sube también los años anteriores.",
  "report.fx_traditional_orphan":
    "La diferencia de cambio de {{qty}} {{ccy}} invertidos en {{security}} no se ha podido asignar a ninguna venta (posible cambio de ISIN, fusión o escisión). Revísala a mano.",
  "report.fx_traditional_orphan.hint":
    "Esos {{ccy}} se usaron para comprar {{security}}. A 31 de diciembre ya no tienes esas acciones y ninguna venta los ha recuperado. Su variación desde que compraste los {{ccy}} hasta que compraste las acciones ({{amount}} €) no se ha declarado.",
  "report.fx_loan_repayment":
    "Este año has devuelto {{ccy}} que te prestó el bróker (tu saldo en {{ccy}} estuvo en negativo). DeclaRenta declara {{amount}} € por esas devoluciones en las casillas 1633/1637. La variación de la propia deuda, desde que se abrió hasta que la devolviste, es de {{gain}} € de ganancia y {{loss}} € de pérdida.",
  "report.fx_loan_repayment.hint":
    "El Tribunal Supremo (STS 71/2021, ECLI:ES:TS:2021:345) lleva la variación de un préstamo en moneda extranjera a la base general. La DGT la lleva a la base del ahorro (V2414-12), como hace DeclaRenta. Si sigues al Supremo, declara la ganancia en la casilla 0304 y la pérdida en la casilla 0305, y quítalas de las casillas 1633/1637: baja el valor de transmisión (1633) en la ganancia y súbelo en la pérdida. DeclaRenta solo trata el saldo negativo como préstamo cuando el informe de efectivo (Cash Report) de IBKR cuadra con tus operaciones.",
  "report.fx_loan_repayment_manual":
    "Este año has devuelto {{ccy}} que te prestó el bróker (tu saldo en {{ccy}} estuvo en negativo). DeclaRenta declara {{amount}} € por esas devoluciones en las casillas 1633/1637. La variación de la propia deuda, desde que se abrió hasta que la devolviste, es de {{gain}} € de ganancia y {{loss}} € de pérdida.",
  "report.fx_loan_repayment_manual.hint":
    "El Tribunal Supremo (STS 71/2021, ECLI:ES:TS:2021:345) lleva la variación de un préstamo en moneda extranjera a la base general. La DGT la lleva a la base del ahorro (V2414-12), como hace DeclaRenta. Si sigues al Supremo, declara la ganancia en la casilla 0304 y la pérdida en la casilla 0305. De esas cifras, solo {{boxGain}} € de ganancia y {{boxLoss}} € de pérdida están en las casillas 1633/1637: baja el valor de transmisión (1633) en esa ganancia y súbelo en esa pérdida. El resto no está en 1633/1637, sino dentro del resultado de otras operaciones (por ejemplo, la venta de las acciones que compraste con el préstamo), y DeclaRenta no puede decirte qué casilla corregir: cuádralo a mano antes de presentar la declaración. DeclaRenta solo trata el saldo negativo como préstamo cuando el informe de efectivo (Cash Report) de IBKR cuadra con tus operaciones.",
  "report.fx_method_name.multidivisa":
    "Criterio DGT (multidivisa)",
  "report.fx_method_name.tradicional-divisa":
    "Tradicional con divisa",
  "report.fx_method_name.monodivisa":
    "Tradicional sin divisa (monodivisa)",
  "report.settings_line":
    "Ajustes del cálculo: método {{method}}, titulares {{titulares}}, autoconversiones {{autoconvert}}",
  "report.non_finite_total":
    "Se detectó un valor no finito (NaN/Infinito) en un total calculado; revise los archivos importados.",
  "report.non_finite_total.hint":
    "Es posible que un archivo de bróker tenga un importe corrupto o un formato numérico inesperado. Revise las operaciones de origen.",
  "flatex.lagerstellenwechsel.unmatched":
    "Traspaso de custodia (Lagerstellenwechsel) sin contrapartida para {{isin}}: {{netQuantity}} títulos.",
  "flatex.lagerstellenwechsel.unmatched.hint":
    "Un traspaso sin pareja entró o salió del depósito sin precio de adquisición. Si más tarde vendes estos títulos, revisa que el valor de compra original esté incluido para no declarar una ganancia ficticia.",
  "flatex.commission.unmatched_trades":
    "No se pudieron emparejar todas las comisiones de Flatex: faltan los apuntes de caja correspondientes.",
  "flatex.commission.unmatched_trades.hint":
    "Sube también el CSV de Kontoumsätze (movimientos de cuenta) junto con el de Depotumsätze para que la comisión de cada operación se tenga en cuenta (sumándose al coste de adquisición en las compras y restándose del valor de transmisión en las ventas).",
  "flatex.commission.cross_currency":
    "Operaciones de Flatex sin comisión calculada: {{trades}}. El apunte de caja está en una moneda distinta a la de la operación.",
  "flatex.commission.cross_currency.hint":
    "La comisión de esas operaciones se ha dejado en 0. Consulta su importe en la liquidación de la orden en Flatex y tenlo en cuenta al revisar la declaración: se suma al valor de adquisición en las compras y se resta del valor de transmisión en las ventas.",
  "flatex.commission.multi_fill_prorated":
    "Órdenes de Flatex ejecutadas en varias partes: {{orders}}. Su comisión se ha repartido entre las ejecuciones en proporción a su importe.",
  "flatex.commission.multi_fill_prorated.hint":
    "Flatex liquidó esas órdenes con un número de apuntes de caja distinto al de ejecuciones, así que no se puede saber qué comisión corresponde a cada una. El total de comisiones de cada orden es exacto; solo el reparto entre ejecuciones es aproximado.",
  "flatex.depot.repeated_fills":
    "Operaciones de Flatex repetidas y contadas una sola vez: {{fills}}. Tenían el mismo número de orden y de apunte (TA-Nr.) que otra ya cargada.",
  "flatex.depot.repeated_fills.hint":
    "Suele pasar al subir el mismo CSV de Depotumsätze dos veces, o dos exportaciones con fechas que se solapan. Si de verdad son operaciones distintas, revisa el archivo: Flatex da a cada ejecución su propio TA-Nr.",
  "flatex.dividends.net_amounts":
    "Flatex anota los dividendos por el importe neto cobrado, ya descontada la retención, y el CSV de Kontoumsätze no incluye la retención.",
  "flatex.dividends.net_amounts.hint":
    "Toma el importe íntegro y la retención de cada cobro del justificante en PDF que Flatex deja en tu buzón de documentos, y corrige a mano las casillas 0029 (importe íntegro), 0588 (retención extranjera) y 0597 (retención española).",
  "degiro.rows_skipped": "Se omitieron {{count}} filas sin ISIN/sin importe.",
  "degiro.rows_skipped.hint":
    "Estas filas tenían cantidad o precio pero les faltaba el ISIN o el importe, por lo que no se pudieron incluir como operaciones. Suele indicar que las columnas del CSV no se han reconocido bien: vuelve a exportar el CSV de Transacciones de Degiro sin modificar las cabeceras.",
  "degiro.corporate_action_pair":
    "Posible operación societaria el {{date}}: {{oldProduct}} ({{oldIsin}}) → {{newProduct}} ({{newIsin}}). Degiro la anota como una venta y una compra.",
  "degiro.corporate_action_pair.hint":
    "Degiro anota los cambios de ISIN, los splits y los canjes de acciones como una venta del valor antiguo y una compra del nuevo, sin número de orden ni costes. DeclaRenta los calcula así: declara una ganancia o pérdida ese día, y las acciones nuevas toman ese precio y esa fecha como coste. Revisa la comunicación de Degiro o del emisor. Si fue un simple cambio de ISIN, un split o un canje fiscalmente neutro (régimen especial de la Ley del Impuesto sobre Sociedades), no hubo venta: las acciones nuevas conservan el coste y la fecha de compra de las antiguas, así que corrige esa operación en tu declaración. Si fue un canje que tributa (art. 37.1.e LIRPF), el cálculo es correcto.",
  "degiro.transaction_tax": "Impuesto sobre transacciones financieras pagado en {{product}} ({{isin}}): {{amount}} {{currency}}.",
  "degiro.transaction_tax.hint":
    "Degiro cobra este impuesto al comprar acciones españolas, francesas o italianas y solo lo muestra en el CSV de Cuenta. Forma parte del valor de adquisición (art. 35.1.b LIRPF): súmalo al coste de las compras de ese valor, porque DeclaRenta no lo añade automáticamente.",
  "binance.unparseable_timestamp":
    "Binance: {{count}} fila(s) no tienen una fecha y hora (UTC_Time) legible y no se calculan: {{rows}}.",
  "binance.unparseable_timestamp.hint":
    "Entre corchetes va la celda de la fecha. Sin ella, DeclaRenta no sabe con qué otra fila va cada movimiento. Por eso no suma ni resta unidades ni dinero por esas filas. Las ganancias, las pérdidas y los ingresos de esas criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Vuelve a descargar el informe original de Binance, no lo edites y súbelo de nuevo.",
  "binance.unparseable_amount":
    "Binance: {{count}} fila(s) no tienen un importe (Change) legible y no se calculan: {{rows}}.",
  "binance.unparseable_amount.hint":
    "Entre corchetes va la celda del importe. DeclaRenta no suma ni resta unidades ni dinero por esas filas. Por eso las ganancias, las pérdidas y los ingresos de esas criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Vuelve a descargar el informe original de Binance, no lo edites y súbelo de nuevo.",
  "binance.unparseable_coin":
    "Binance: {{count}} fila(s) no dicen de qué moneda son (Coin) y no se calculan: {{rows}}.",
  "binance.unparseable_coin.hint":
    "Entre corchetes va la celda de la moneda. Sin ella, DeclaRenta no sabe qué criptomoneda entra o sale. Por eso no suma ni resta unidades ni dinero por esas filas. Las ganancias, las pérdidas y los ingresos de tus criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Vuelve a descargar el informe original de Binance, no lo edites y súbelo de nuevo.",
  "freedom24.row_skipped_malformed":
    "Freedom24: {{count}} fila(s) de acciones corporativas no tienen un tipo legible (type_id) y no se calculan.",
  "freedom24.row_skipped_malformed.hint":
    "El campo \"type_id\" de esas filas está vacío o no es texto. Por eso DeclaRenta no sabe si son un dividendo, un cupón u otra operación. No suma ningún importe por ellas. Pueden mover acciones. Por eso el aviso de operaciones societarias no aplicadas también las nombra. La comprobación de compra única de la regla de los 2 meses puede verse afectada. DeclaRenta no aplica esa excepción a su valor. Si la fila no nombra ningún valor, no la aplica a ninguno. Si te falta un dividendo o un cupón, vuelve a descargar el informe JSON completo de Freedom24 y súbelo de nuevo.",
  "freedom24.dividend_amount_unreadable":
    "Freedom24: {{count}} dividendo(s) o cupón(es) no tienen un importe (amount) legible y no se calculan: {{rows}}.",
  "freedom24.dividend_amount_unreadable.hint":
    "Entre corchetes va la celda del importe (amount). Sin ella, DeclaRenta no sabe cuánto cobraste. Por eso no suma ese ingreso ni su retención y no se inventa un importe. Si es un ingreso del año que declaras, vuelve a descargar el informe JSON completo de Freedom24 y súbelo de nuevo. También puedes añadir el importe y la retención a mano en Renta Web.",
  "freedom24.tax_amount_unreadable":
    "Freedom24: {{count}} dividendo(s) o cupón(es) no tienen una retención (tax_amount) que se pueda usar y se calculan sin retención: {{rows}}.",
  "freedom24.tax_amount_unreadable.hint":
    "Entre corchetes va la celda de la retención (tax_amount). No es un número, o es mayor que el importe (amount) del dividendo. DeclaRenta suma el ingreso completo, pero no sabe cuánto te retuvieron. Así no pagas de menos, pero pierdes la deducción por esa retención (casilla 0588, o 0597 si el valor es español). Toma la retención del informe fiscal de Freedom24 y añádela a mano en Renta Web.",
  "binance.unhandled_operation":
    "Se han omitido {{count}} movimiento(s) del CSV de Binance con operaciones no reconocidas: {{operations}}.",
  "binance.unhandled_operation.hint":
    "Estos movimientos no se han incluido en el cálculo. Si son compras, ventas o ingresos (p. ej. futuros, pagos con Binance Card, Auto-Invest o cashback), añádelos a mano en tu declaración y comunica el nombre de la operación para que se pueda incorporar.",
  "binance.unpaired_leg":
    "Binance: {{count}} movimiento(s) de compra, venta o conversión no tienen la otra parte de la operación y no se calculan: {{rows}}.",
  "binance.unpaired_leg.hint":
    "Cada compra o venta de Binance son dos filas con la misma hora: la moneda que entra y la que sale. DeclaRenta no ha encontrado la otra fila de estos movimientos. Por eso no suma ni resta unidades ni dinero por ellos. Las ganancias y las pérdidas de esas criptomonedas no son fiables. Si una fila es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Compara esas filas con tu historial de Binance y añade a mano en Renta Web las operaciones que falten.",
  "binance.spot_cost_split":
    "Binance: {{count}} fila(s) de operaciones con varias criptomonedas en el mismo segundo no dicen qué pago o cobro va con cada criptomoneda. DeclaRenta ha repartido los importes entre ellas: {{rows}}.",
  "binance.spot_cost_split.hint":
    "Binance anota varias operaciones en el mismo segundo. No pone cada pago o cobro junto a su compra o venta. Por eso DeclaRenta no sabe qué importe va con cada criptomoneda. Ha repartido los importes entre ellas por orden o a partes iguales. El total es correcto, pero el coste o el importe de venta de cada criptomoneda no es fiable. Sus ganancias y sus pérdidas tampoco lo son. Si una de ellas es una recompra en el año siguiente a una venta con pérdidas, la comprobación del art. 33.5.e LIRPF tampoco es fiable. Busca esas órdenes en tu historial de Binance y corrige a mano en Renta Web el coste o el importe de venta de cada criptomoneda.",
  "binance.unsupported_pair":
    "Se han omitido {{count}} operación(es) del CSV de Binance con un par no reconocido: {{pairs}}.",
  "binance.unsupported_pair.hint":
    "Estas operaciones no se han incluido en el cálculo. Añádelas a mano en tu declaración y comunica el par para que se pueda incorporar.",
  "etoro.closed_types_skipped":
    "Se ha(n) omitido {{count}} posición(es) cerrada(s) de eToro de un tipo no soportado: {{types}}.",
  "etoro.closed_types_skipped.hint":
    "DeclaRenta todavía no importa estos tipos de posición de eToro (p. ej. criptomonedas). Su ganancia o pérdida no está incluida en el cálculo: añádela a mano en tu declaración con el importe invertido y el beneficio que muestra eToro.",
  "lightyear.unknown_types":
    "Se ha(n) omitido {{count}} fila(s) del CSV de Lightyear con un tipo de movimiento no reconocido: {{types}}.",
  "lightyear.unknown_types.hint":
    "Estos movimientos no se han incluido en el cálculo. Si son desdoblamientos (splits), traspasos de acciones u otras operaciones societarias, revísalos a mano: pueden cambiar el número de acciones o el coste de adquisición de ventas posteriores.",
  "coinbase.rewards_income_classification":
    'Se han clasificado {{count}} ingreso(s) de tipo "Rewards Income" de Coinbase como rendimientos del capital mobiliario (base del ahorro).',
  "coinbase.rewards_income_classification.hint":
    "Si parte de esos importes son recompensas promocionales o cashback de tarjeta (no rendimientos por mantener o ceder cripto), su tratamiento correcto sería ganancia patrimonial no derivada de transmisión (base general). Revisa su naturaleza si la cantidad es significativa.",
  "coinbase.unknown_types_skipped":
    "Se han omitido {{count}} fila(s) de Coinbase con un tipo de operación no reconocido: {{types}}.",
  "coinbase.unknown_types_skipped.hint":
    "Estas filas no se han tenido en cuenta en el cálculo. Si alguna es una venta, una compra, un pago con cripto o una recompensa, añádela manualmente para que su ganancia, su coste de adquisición o su rendimiento cuenten.",
  "coinbase.advanced_trade_quote_leg_missing":
    "{{count}} operación(es) de Advanced Trade de Coinbase se pagaron o cobraron en una moneda distinta de la de valoración ({{pairs}}); solo se ha registrado la criptomoneda comprada o vendida, no la moneda de contrapartida.",
  "coinbase.advanced_trade_quote_leg_missing.hint":
    "En estos pares también transmites (al comprar) o adquieres (al vender) la moneda de cotización, sea otra criptomoneda o una divisa, y esa operación también tributa. Añade manualmente la venta o la compra de esa moneda por el mismo valor en euros de la operación para que su ganancia y su coste de adquisición cuadren.",
  "trade_republic.corporate_action_not_applied":
    "Trade Republic: no se han aplicado {{count}} movimiento(s) de acción corporativa (fusión, canje, split) de {{isins}}.",
  "trade_republic.corporate_action_not_applied.hint":
    "El coste de los títulos antiguos no pasa a los nuevos, así que una venta posterior del nuevo valor puede salir sin lotes y con coste 0. Si fue una fusión o un canje, añade el coste de adquisición original en «Lotes manuales para posiciones transferidas».",
  "trade_republic.delivery_not_applied":
    "Trade Republic: no se han importado {{count}} entrega(s) de títulos sin compraventa (acciones gratuitas, traspasos) de {{isins}}.",
  "trade_republic.delivery_not_applied.hint":
    "Las acciones gratuitas de una promoción son una ganancia patrimonial de la base general por su valor de mercado el día de la entrega: decláralas aparte y añade ese valor como coste en «Lotes manuales para posiciones transferidas». Si es un traspaso desde otro bróker, añade allí el coste de compra original.",
  "parser.trading212.unresolved_price_skipped":
    "Se omitieron {{skipped}} operaciones sin precio por acción y con importe en otra divisa.",
  "parser.trading212.unresolved_price_skipped.hint":
    'Estas filas no tenían precio por acción y su importe (Total) estaba en una divisa distinta a la del instrumento, por lo que no se pudo calcular el valor de la operación. Vuelve a exportar el histórico desde Trading 212 asegurándote de incluir la columna "Price / share".',
  "parser.cash_summary_duplicates":
    "Se omitieron {{skipped}} filas resumen duplicadas en las transacciones de efectivo.",
  "parser.cash_summary_duplicates.hint":
    'Tu Flex Query tiene activada la opción "Summary" en la sección Cash Transactions, lo que duplica cada movimiento. Puedes desactivarla, pero no es necesario: estas filas se han ignorado automáticamente para evitar duplicar dividendos, retenciones y comisiones.',
  "parser.executions_merged": "Se agruparon {{sourceFillCount}} ejecuciones parciales en {{mergedGroupCount}} órdenes.",
  "parser.executions_merged.hint":
    "Las órdenes con varias ejecuciones parciales se han combinado en una sola operación, igual que hacen los brokers que informan a Hacienda. El cálculo fiscal no cambia: cantidad total, precio medio ponderado y comisiones suman lo mismo.",
  "parser.order_level_duplicates":
    "Se omitieron {{skipped}} filas agregadas de tipo ORDER duplicadas en las operaciones.",
  "parser.order_level_duplicates.hint":
    'Tu Flex Query tiene activado el nivel de detalle "Orders" además de "Executions" en la sección Trades, lo que duplica cada operación. Puedes desactivar "Orders" en la configuración del Flex Query, pero no es necesario: estas filas se han ignorado automáticamente para evitar duplicar cantidades, importes y comisiones.',
  "parser.cancelled_trades": "Se omitieron {{count}} operaciones canceladas por IBKR junto con su anulación.",
  "parser.cancelled_trades.hint": 'IBKR marca una ejecución cancelada con una fila de anulación ("(Ca.)"). La operación original y su anulación se han descartado: nunca llegaron a ser una compra o venta real.',
  "parser.cancelled_trades_unmatched": "Se omitieron {{count}} anulaciones de IBKR sin la operación original en este archivo.",
  "parser.cancelled_trades_unmatched.hint": "La operación cancelada queda fuera del periodo de este Flex Query. Si la cargas desde otro archivo, se seguirá contando como real: exporta un periodo que incluya la operación y su anulación en el mismo archivo.",
  "parser.cancelled_trades_unreadable": "Se omitieron {{count}} anulaciones de IBKR sin poder emparejarlas con la operación que anulan: falta una cantidad o un precio legible en la anulación o en una operación de este archivo.",
  "parser.cancelled_trades_unreadable.hint": "Si la operación anulada está en este archivo, DeclaRenta la sigue contando como una compra o venta real. Comprueba que la Flex Query exporta la cantidad, el precio y el ID de ejecución (IB Execution ID) de cada operación y vuelve a exportarla.",
  "parser.open_position_quantity_unknown": "IBKR no da un número de acciones legible para {{count}} posición(es) abierta(s): {{holdings}}.",
  "parser.open_position_quantity_unknown.hint": "DeclaRenta las cuenta con 0 acciones: el Modelo 720 las incluye con su valor, pero con 0 en «Número de valores», y el D-6 no las incluye. Revisa a mano esas posiciones en el 720 y el D-6, o comprueba que la sección Open Positions de la Flex Query incluye la cantidad y vuelve a exportarla.",
  "parser.trade_quantity_unknown": "{{broker}} no da un número de acciones o un precio legible para {{count}} operación(es): {{trades}}.",
  "parser.trade_quantity_unknown.hint": "DeclaRenta no suma ni resta acciones por ellas, así que las ganancias y pérdidas de ese valor no son fiables y no se aplica la excepción de compra única de la regla de los 2 meses. Comprueba que el archivo exportado trae la cantidad y el precio de cada operación y vuelve a exportarlo.",
  "parser.crypto_quantity_unknown": "{{broker}} no da un número de unidades o un precio legible para {{count}} operación(es) con criptomonedas: {{trades}}.",
  "parser.crypto_quantity_unknown.hint": "DeclaRenta no suma ni resta unidades por ellas, así que las ganancias y pérdidas de esa criptomoneda no son fiables. Si una de ellas es una recompra en el año siguiente a una venta con pérdidas, esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF), y DeclaRenta no la bloquea porque no sabe cuántas unidades recompraste. Comprueba que el archivo exportado trae la cantidad y el precio de cada operación y vuelve a exportarlo.",
  "parser.trade_row_unreadable": "{{broker}}: {{count}} fila(s) de operación no se pueden leer y no se calculan: {{rows}}.",
  "parser.trade_row_unreadable.hint": "Entre corchetes va la celda que falla. Falta, está vacía, no se puede leer o trae un tipo de operación que DeclaRenta no reconoce. DeclaRenta no suma ni resta acciones, unidades ni dinero por esas filas. Por eso las ganancias y pérdidas de esos valores no son fiables. Tampoco aplica la excepción de compra única de la regla de los 2 meses a ningún valor al que pueda pertenecer una de esas filas. Una fila puede ser la recompra de una criptomoneda en el año siguiente a una venta con pérdidas. Entonces esa pérdida puede tener que quedar pendiente (art. 33.5.e LIRPF). DeclaRenta no la bloquea. Si una fila es una compra o una venta real, corrige esa celda en el archivo del broker y vuelve a subirlo.",
  "revolut.bad_fx_rate": "DeclaRenta ha omitido {{count}} ingreso(s) o retirada(s) de efectivo del extracto de Revolut porque su tipo de cambio (FX Rate) no es válido: {{rows}}.",
  "revolut.bad_fx_rate.hint": "Solo los ingresos y las retiradas de efectivo usan esa columna. Las compras, las ventas y los dividendos se calculan con el tipo del BCE y no se omiten. La causa suele ser una celda de tipo de cambio que no es un número, es negativa o vale cero. Vuelve a descargar el Trading Account Statement completo desde la app de Revolut y súbelo de nuevo.",
  "revolut.holding_size_unknown": "El extracto de Revolut no permite saber cuántas acciones o unidades tienes al final de {{count}} valor(es): {{tickers}}.",
  "revolut.holding_size_unknown.hint": "Una fila de cada uno no se puede leer o no dice cuántas acciones o unidades mueve (otro aviso la nombra). DeclaRenta muestra solo la parte que sí se puede leer, que puede ser 0. Para los modelos 720 y 721, toma el número y el valor de esas posiciones del extracto de Revolut y añádelos a mano.",
  "parser.corporate_action_not_applied": "{{broker}}: DeclaRenta no ha aplicado {{count}} fila(s) de desdoblamiento, agrupación u otra operación societaria: {{rows}}.",
  "parser.corporate_action_not_applied.hint": "DeclaRenta no cambia por ellas el número de acciones ni el coste de esos valores. Por eso las ganancias y pérdidas de sus ventas posteriores pueden no ser correctas. Compruébalas con el extracto del broker. Tampoco aplica a esos valores la excepción de compra única de la regla de los 2 meses. Si una de esas filas te pagó dinero, como un vencimiento o un reembolso, esa venta no está en el informe. Añádela a mano en Renta Web.",
  "parser.cash_row_undated": "{{broker}}: {{count}} movimiento(s) de dinero no tienen una fecha legible y no se calculan: {{rows}}.",
  "parser.cash_row_undated.hint": "Entre corchetes va la celda de la fecha. Sin fecha, DeclaRenta no sabe a qué año pertenece el importe ni qué tipo de cambio del BCE le toca. Por eso no lo suma y no se inventa una fecha. Puede ser un dividendo, una retención, un interés u otro ingreso del año que declaras. Entonces corrige la fecha en el archivo del broker y vuelve a subirlo. También puedes añadir el importe a mano en Renta Web.",
  "parser.cash_row_unidentified": "{{broker}}: {{count}} dividendo(s) o retención(es) no dicen de qué valor son y no se calculan: {{rows}}.",
  "parser.cash_row_unidentified.hint": "La fila no trae ni el ticker ni el ISIN. Sin el valor, DeclaRenta no sabe de qué país viene el dividendo ni con qué retención va. Por eso no lo suma y no se inventa el valor. Si es un ingreso del año que declaras, corrige la fila en el archivo del broker y vuelve a subirlo. También puedes añadir el importe a mano en Renta Web.",
  "parser.crypto_income_unidentified": "{{broker}}: {{count}} ingreso(s) en criptomonedas no dicen qué criptomoneda recibiste y no se calculan: {{rows}}.",
  "parser.crypto_income_unidentified.hint": "Entre corchetes va la celda de la criptomoneda. Sin ella, DeclaRenta no sabe qué recibiste. Tampoco sabe qué coste darle cuando la vendas. Por eso no suma ese ingreso y no se inventa la criptomoneda. Si es un ingreso del año que declaras, tienes que declararlo igualmente. Corrige la fila en el archivo del exchange y vuelve a subirlo. También puedes añadir el ingreso a mano en Renta Web.",
  "parser.crypto_income_amount_unreadable": "{{broker}}: {{count}} ingreso(s) en criptomonedas no tienen un importe legible y no se calculan: {{rows}}.",
  "parser.crypto_income_amount_unreadable.hint": "Entre corchetes va el importe tal como está en el archivo. Sin un importe, DeclaRenta no sabe cuánto recibiste. Por eso no suma ese ingreso y no lo cuenta como cero. Si es un ingreso del año que declaras, tienes que declararlo igualmente. Corrige la fila en el archivo del exchange y vuelve a subirlo. También puedes añadir el ingreso a mano en Renta Web.",
  "revolut.dividend_tax_correction": "El extracto de Revolut trae {{count}} corrección(es) de la retención de un dividendo (DIVIDEND TAX (CORRECTION)) que DeclaRenta no suma: {{rows}}.",
  "revolut.dividend_tax_correction.hint": "Con estas filas Revolut corrige la retención de un dividendo ya cobrado. DeclaRenta importa los dividendos de Revolut por su importe neto. No lee la retención de este extracto, y tampoco su corrección. Toma el dividendo bruto y la retención final, ya corregida, del informe fiscal anual de Revolut.",
} as const;

export type TranslationKeys = Record<keyof typeof es, string>;
export default es;
