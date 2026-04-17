/** Spanish (default, source of truth) */
const es = {
  // App
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker extranjero → Renta española",


  // Upload
  "upload.title": "Sube tu informe del broker",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrastra tu fichero aquí o haz clic para seleccionar",
  "upload.formats_help": "Formatos: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

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

  // Casillas
  "casilla.transmission_value": "Valor de transmisión",
  "casilla.acquisition_value": "Valor de adquisición",
  "casilla.net_gain_loss": "Ganancia/Pérdida neta",
  "casilla.gross_dividends": "Dividendos brutos",
  "casilla.interest_earned": "Intereses ganados",
  "casilla.interest_paid": "Intereses pagados (margen)",
  "casilla.double_taxation": "Deducción doble imposición",
  "casilla.blocked_losses": "Pérdidas bloqueadas por regla anti-churning (2 meses): {{amount}} EUR",
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
  "profile.incomplete_banner": "Completa tu perfil fiscal para generar los modelos 720 y D-6.",
  "profile.go_to_profile": "Ir al perfil",

  // Broker guides
  "guide.title": "¿Cómo obtener el informe?",
  "guide.tip_fifo": "Incluye todo el histórico — DeclaRenta necesita operaciones anteriores para el cálculo FIFO correcto.",

  // Modelo 720 section
  "m720.title": "Modelo 720 — Bienes en el extranjero",
  "m720.description": "Declaración informativa sobre bienes y derechos situados en el extranjero.",
  "m720.threshold_exceeded": "Según tus posiciones ({{amount}} €), estás obligado a presentar el Modelo 720.",
  "m720.threshold_not_exceeded": "No superas el umbral de 50.000 € (total: {{amount}} €). No estás obligado a presentar.",
  "m720.no_positions": "Sube un informe con posiciones abiertas en Modelo 100 para analizar el Modelo 720.",
  "m720.positions_title": "Posiciones declarables",
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
  "d6.no_minimum": "El D-6 es obligatorio para CUALQUIER importe. No tiene umbral mínimo.",
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

  // Section headers
  "section.year_label": "Ejercicio",

  // Badge statuses
  "badge.complete": "Completo",
  "badge.pending": "Pendiente",
  "badge.not_applicable": "No aplica",
  "badge.generated": "Generado",
} as const;

export type TranslationKeys = Record<keyof typeof es, string>;
export default es;
