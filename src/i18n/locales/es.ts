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
  "upload.formats_help": "Formatos: XML (IBKR Flex), CSV (Degiro, Scalable, Lightyear, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro, Revolut)",

  // Config
  "config.title": "Configura",
  "config.year_label": "Ejercicio fiscal:",
  "config.process_btn": "Procesar",
  "config.processing": "Procesando...",

  // Results
  "results.title": "Resultados para Modelo 100",
  "results.operations": "Operaciones",
  "results.dividends": "Dividendos",
  "results.no_dividends": "Sin dividendos",
  "results.search_placeholder": "Buscar por ISIN o símbolo...",
  "results.filter_all": "Todas",
  "results.filter_gains": "Ganancias",
  "results.filter_losses": "Pérdidas",
  "results.export_json": "Exportar JSON",
  "results.export_csv": "Exportar CSV",
  "results.operations_count": "{{count}} operación(es)",
  "results.dividends_count": "{{count}} dividendo(s)",
  "results.year_mismatch": "El fichero contiene datos de los ejercicios {{available}}, pero el ejercicio seleccionado es {{year}}. Selecciona otro año en el desplegable superior.",

  // Table headers
  "table.isin": "ISIN",
  "table.symbol": "Símbolo",
  "table.buy_date": "F. Compra",
  "table.sell_date": "F. Venta",
  "table.units": "Uds.",
  "table.cost_eur": "Coste EUR",
  "table.proceeds_eur": "Venta EUR",
  "table.gain_loss_eur": "G/P EUR",
  "table.days": "Días",
  "table.date": "Fecha",
  "table.gross_eur": "Bruto EUR",
  "table.withholding_eur": "Retención EUR",
  "table.country": "País",
  "table.casilla": "Casilla",
  "table.concept": "Concepto",
  "table.amount_eur": "Importe (EUR)",
  "table.currency": "Divisa",

  // Casillas
  "casilla.transmission_value": "Valor de transmisión",
  "casilla.acquisition_value": "Valor de adquisición",
  "casilla.net_gain_loss": "Ganancia/Pérdida neta",
  "casilla.gross_dividends": "Dividendos brutos",
  "casilla.interest_earned": "Intereses ganados",
  "casilla.interest_paid": "Intereses pagados al broker (margen, no deducible — informativo)",
  "casilla.double_taxation": "Deducción doble imposición",
  "casilla.blocked_losses": "Pérdidas bloqueadas por regla anti-churning (2 meses cotizados / 1 año no cotizados): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} advertencia(s)",

  // Charts
  "chart.asset_distribution": "Distribución por tipo de activo",
  "chart.monthly_gl": "Ganancia/Pérdida por mes",
  "chart.currency_composition": "Composición por divisa",
  "chart.withholdings_country": "Retenciones por país",

  // Footer
  "footer.docs": "Documentación",
  "footer.privacy": "Self-hosted · Privacidad total",
  "footer.disclaimer": "Aviso legal",

  // Disclaimer
  "disclaimer.title": "Aviso legal",
  "disclaimer.text": "Esta herramienta es meramente informativa y no constituye asesoramiento fiscal ni jurídico. Los resultados generados deben ser verificados por el usuario y/o un profesional cualificado antes de ser utilizados en cualquier declaración tributaria.\n\nDeclaRenta no se responsabiliza de errores, omisiones ni de las consecuencias derivadas del uso de esta información. El usuario es el único responsable de la veracidad y exactitud de los datos introducidos y de las declaraciones presentadas ante la Agencia Tributaria.\n\nLos tipos de cambio proceden del Banco Central Europeo (BCE). Los cálculos fiscales se basan en la normativa vigente (LIRPF, Ley del Patrimonio, Orden EHA/3290/2008) pero pueden no cubrir todos los supuestos ni reflejar cambios normativos posteriores a la última actualización del software.",
  "disclaimer.accept": "Entendido",

  // Accessibility
  "a11y.skip_link": "Saltar al contenido",
  "a11y.nav_label": "Ajustes",
  "a11y.lang_label": "Idioma",
  "a11y.theme_toggle": "Cambiar tema",
  "a11y.drop_zone": "Zona de carga de ficheros",
  "a11y.file_input": "Seleccionar ficheros",

  // Theme
  "theme.toggle": "Cambiar tema",

  // Wizard steps
  "wizard.step1": "Subir ficheros",
  "wizard.step2": "Revisar datos",
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

  // Year comparison
  "compare.title": "Comparativa anual",
  "compare.no_data": "Procesa al menos 2 ejercicios para ver la comparativa.",
  "compare.year": "Ejercicio",
  "compare.variation": "Variación",
  "compare.saved_reports": "Informes guardados",
  "compare.clear_history": "Borrar historial",
  "compare.clear_confirm": "¿Borrar todos los informes guardados?",

  // Errors
  "error.no_broker_detected": "No se pudo detectar el broker de \"{{filename}}\". Selecciona el broker manualmente.",
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
  "profile.description": "Estos datos se utilizan para generar los ficheros de los modelos 720 y D-6.",
  "profile.nif_label": "NIF/NIE:",
  "profile.surname_label": "Apellidos:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Nombre:",
  "profile.name_placeholder": "Juan",
  "profile.ccaa_label": "Comunidad Autónoma:",
  "profile.phone_label": "Teléfono:",
  "profile.phone_placeholder": "600123456",
  "profile.saved": "Perfil guardado",
  "profile.save_btn": "Guardar perfil",
  "profile.incomplete_banner": "Completa tu perfil fiscal para generar los modelos 720 y D-6.",
  "profile.go_to_profile": "Ir al perfil",

  // Broker guides
  "guide.title": "¿Cómo obtener el informe?",
  "guide.tip_fifo": "Incluye todo el histórico — DeclaRenta necesita operaciones anteriores para el cálculo FIFO correcto.",
  "guide.select_broker_hint": "Selecciona tu broker para ver las instrucciones de descarga del informe.",
  "guide.heading": "¿Cómo obtener el informe de tu broker?",

  // IBKR
  "guide.ibkr.title": "Interactive Brokers (Flex Query XML)",
  "guide.ibkr.step1": "Inicia sesión en el <strong>Portal del Cliente</strong> de IBKR",
  "guide.ibkr.step2": "Ve a <strong>Rendimiento e informes</strong> → pestaña <strong>Consultas Flex</strong>",
  "guide.ibkr.step3": "En <strong>Consulta flex de actividad</strong>, haz clic en el <strong>+</strong> para crear una nueva consulta",
  "guide.ibkr.step4": "En la configuración, activa las secciones:<ul><li>Operaciones / Trades (obligatorio)</li><li>Transacciones de efectivo / Cash Transactions — dividendos y retenciones (obligatorio)</li><li>Posiciones abiertas / Open Positions — para Modelo 720/D-6 (recomendado)</li><li>Información de instrumentos financieros / Securities Info (recomendado)</li></ul>",
  "guide.ibkr.step5": "Formato de salida: <strong>XML</strong>",
  "guide.ibkr.step6": "Incluye <strong>todos los años disponibles</strong> para cálculo FIFO correcto",
  "guide.ibkr.step7": "Guarda la consulta, ejecútala y descarga el fichero <code>.xml</code>",

  // Degiro
  "guide.degiro.title": "Degiro (CSV)",
  "guide.degiro.step1": "Inicia sesión en la <strong>web de Degiro</strong> (no la app)",
  "guide.degiro.step2": "Abre el panel lateral <strong>Buzón</strong> (icono de sobre)",
  "guide.degiro.step3": "Haz clic en <strong>Transacciones</strong> (historial de transacciones de tus productos)",
  "guide.degiro.step4": "Selecciona el rango de fechas deseado (incluye <strong>todo el histórico</strong> para FIFO)",
  "guide.degiro.step5": "Haz clic en <strong>Exportar</strong> y descarga el fichero CSV",
  "guide.degiro.step6": "Para dividendos: vuelve al <strong>Buzón</strong> → <strong>Cuenta</strong> (historial de movimientos de tu cuenta) → misma fecha → <strong>Exportar</strong> CSV",

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
  "guide.binance.step2": "Ve a <strong>Pedidos → Historial de operaciones</strong>",
  "guide.binance.step3": "Haz clic en <strong>Exportar historial de operaciones</strong>",
  "guide.binance.step4": "Selecciona el rango de fechas y formato <strong>CSV</strong>",

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
  "guide.mexem.step3": "Crea una <strong>Activity Flex Query</strong> incluyendo Trades, Cash Transactions y Open Positions",
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
  "m720.threshold_not_exceeded": "No superas el umbral de 50.000 € (total: {{amount}} €). No estás obligado a presentar.",
  "m720.category_v": "Valores (acciones, fondos, bonos)",
  "m720.category_c": "Cuentas (saldos en efectivo)",
  "m720.category_exceeded": "Supera 50.000 € — obligatorio declarar",
  "m720.category_not_exceeded": "Por debajo del umbral",
  "m720.no_positions": "Sube un informe con posiciones abiertas en Modelo 100 para analizar el Modelo 720.",
  "m720.positions_title": "Posiciones declarables",
  "m720.cash_title": "Saldos en efectivo (Cuentas)",
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
  "d6.no_minimum": "Desde la Orden ICT/1408/2021, el D-6 solo es obligatorio si tu participación representa el <strong>10% o más</strong> del capital o derechos de voto de una empresa cotizada extranjera. La mayoría de inversores minoristas están exentos.",
  "d6.no_positions": "Sube un informe con posiciones abiertas en Modelo 100 para analizar el D-6.",
  "d6.positions_title": "Posiciones a declarar",
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
  "m721.threshold_not_exceeded": "No superas el umbral de 50.000 € (total: {{amount}} €). No estás obligado a presentar.",
  "m721.no_positions": "Sube un informe con posiciones de criptomonedas en Modelo 100 para analizar el Modelo 721.",
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
  "m721.format_notice": "El formato oficial de la AEAT es XML (Orden HFP/886/2023). El fichero generado actualmente es un prototipo — verifica antes de presentar.",
  "m721.empty_title": "No hay posiciones de criptomonedas",
  "m721.empty_description": "El Modelo 721 es una declaración informativa obligatoria si posees criptomonedas en exchanges extranjeros valoradas en más de 50.000 €. Sube tu informe del broker en la sección Modelo 100 para que DeclaRenta calcule automáticamente si superas el umbral. Plazo: 1 de enero – 31 de marzo.",
  "m721.empty_cta": "Ir a Modelo 100",
  "m721.profile_required": "Completa tu perfil fiscal antes de generar el fichero del Modelo 721.",

  // Section headers
  "section.year_label": "Ejercicio",
  "section.profile_source": "Datos del <a href=\"#perfil\">Perfil fiscal</a>",

  // Badge statuses
  "badge.complete": "Completo",
  "badge.pending": "Pendiente",
  "badge.not_applicable": "No aplica",
  "badge.generated": "Generado",

  // Empty states with educational content
  "m720.empty_title": "No hay posiciones cargadas",
  "m720.empty_description": "El Modelo 720 es una declaración informativa obligatoria si posees bienes en el extranjero valorados en más de 50.000 €. Sube tu informe del broker en la sección Modelo 100 para que DeclaRenta calcule automáticamente si superas el umbral y genere el fichero. Plazo: 1 de enero – 31 de marzo.",
  "m720.empty_cta": "Ir a Modelo 100",
  "d6.empty_title": "No hay posiciones cargadas",
  "d6.empty_description": "El Modelo D-6 declara inversiones en valores extranjeros ante el Ministerio de Economía. Desde la reforma de 2021 (Orden ICT/1408/2021), solo es obligatorio si tu participación representa el 10% o más del capital o derechos de voto de una empresa cotizada extranjera. Sube tu informe del broker en la sección Modelo 100 y DeclaRenta generará la guía paso a paso. Plazo: 1 – 31 de enero.",
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
  "validation.no_cash_transactions": "No se han encontrado transacciones de efectivo (dividendos/retenciones). Si usas IBKR, activa la sección Cash Transactions en tu Flex Query.",
  "validation.no_cash_degiro": "No se han encontrado dividendos ni retenciones. Degiro los incluye en un fichero separado: descarga también el CSV de Cuenta (Account) desde el Buzón.",
  "validation.no_cash_generic": "No se han encontrado transacciones de efectivo (dividendos/retenciones). Si tu broker las exporta por separado, súbelas como fichero adicional.",
  "validation.no_trades_in_year": "No hay operaciones en el ejercicio {{year}}. Las operaciones anteriores se usan para el cálculo FIFO.",
  "validation.very_old_data": "Los datos incluyen operaciones desde {{year}} (más de 10 años). Verifica que el fichero es correcto.",
  "validation.duplicate_trades": "Se han detectado {{count}} operación(es) duplicada(s). Revisa si has subido el mismo fichero dos veces.",

  // Operations annex
  "annex.title": "Anexo de operaciones (Anexo C1)",
  "annex.subtitle": "Detalle individual de operaciones agrupadas por tipo de activo.",
  "annex.operations": "operación(es)",

  // Tax bracket estimation
  "chart.tax_estimate": "Estimación fiscal (base del ahorro)",
  "tax.bracket_range": "Tramo",
  "tax.bracket_base": "Base",
  "tax.bracket_rate": "Tipo",
  "tax.bracket_tax": "Cuota",
  "tax.total_estimated": "Total estimado",
  "tax.effective_rate": "Tipo efectivo",
  "tax.double_tax_deduction": "Deducción doble imposición",
  "tax.disclaimer": "Estimación orientativa. Los tramos corresponden a la base del ahorro del IRPF vigente. Consulta con un asesor fiscal.",
} as const;

export type TranslationKeys = Record<keyof typeof es, string>;
export default es;
