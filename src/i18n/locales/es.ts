/** Spanish (default, source of truth) */
const es = {
  // App
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker extranjero → Renta española",
  "app.privacy": "Self-hosted. Tus datos no salen de tu equipo.",

  // Upload
  "upload.title": "1. Sube tu informe del broker",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrastra tu fichero aquí o haz clic para seleccionar",
  "upload.formats_help": "Formatos: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  // Config
  "config.title": "2. Configura",
  "config.year_label": "Ejercicio fiscal:",
  "config.process_btn": "Procesar",
  "config.processing": "Procesando...",

  // Results
  "results.title": "3. Resultados para Modelo 100",
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

  // Errors
  "error.no_broker_detected": "No se pudo detectar el broker de \"{{filename}}\". Selecciona el broker manualmente.",
  "error.prefix": "Error: ",

  // Status
  "status.fetching_rates": "Obteniendo tipos ECB para {{currencies}}...",
  "status.files_processed": "{{count}} fichero(s) procesado(s) — {{brokers}} — {{trades}} operaciones",
} as const;

export type TranslationKeys = Record<keyof typeof es, string>;
export default es;
