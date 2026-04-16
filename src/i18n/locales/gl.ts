// BETA: Tradución automática, pendente de revisión por falante nativo
/** Galego */
import type { TranslationKeys } from "./es.js";

const gl: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker estranxeiro → Renda española",


  "upload.title": "1. Sube o teu informe do broker",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrastra o teu ficheiro aquí ou fai clic para seleccionar",
  "upload.formats_help": "Formatos: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "2. Configura",
  "config.year_label": "Exercicio fiscal:",
  "config.process_btn": "Procesar",
  "config.processing": "Procesando...",

  "results.title": "3. Resultados para o Modelo 100",
  "results.operations": "Operacións",
  "results.dividends": "Dividendos",
  "results.no_dividends": "Sen dividendos",
  "results.search_placeholder": "Buscar por ISIN ou símbolo...",
  "results.filter_all": "Todas",
  "results.filter_gains": "Ganancias",
  "results.filter_losses": "Perdas",
  "results.export_json": "Exportar JSON",
  "results.export_csv": "Exportar CSV",
  "results.operations_count": "{{count}} operación(s)",
  "results.dividends_count": "{{count}} dividendo(s)",

  "table.isin": "ISIN",
  "table.symbol": "Símbolo",
  "table.buy_date": "D. Compra",
  "table.sell_date": "D. Venda",
  "table.units": "Uds.",
  "table.cost_eur": "Custo EUR",
  "table.proceeds_eur": "Venda EUR",
  "table.gain_loss_eur": "G/P EUR",
  "table.days": "Días",
  "table.date": "Data",
  "table.gross_eur": "Bruto EUR",
  "table.withholding_eur": "Retención EUR",
  "table.country": "País",
  "table.casilla": "Casilla",
  "table.concept": "Concepto",
  "table.amount_eur": "Importe (EUR)",

  "casilla.transmission_value": "Valor de transmisión",
  "casilla.acquisition_value": "Valor de adquisición",
  "casilla.net_gain_loss": "Ganancia/Perda neta",
  "casilla.gross_dividends": "Dividendos brutos",
  "casilla.interest_earned": "Xuros gañados",
  "casilla.interest_paid": "Xuros pagados (marxe)",
  "casilla.double_taxation": "Dedución dobre imposición",
  "casilla.blocked_losses": "Perdas bloqueadas pola regra anti-churning (2 meses): {{amount}} EUR",
  "casilla.warnings_count": "{{count}} advertencia(s)",

  "chart.asset_distribution": "Distribución por tipo de activo",
  "chart.monthly_gl": "Ganancia/Perda por mes",
  "chart.currency_composition": "Composición por divisa",
  "chart.withholdings_country": "Retencións por país",

  "footer.privacy": "Self-hosted · Privacidade total",
  "footer.disclaimer": "Aviso legal",

  "disclaimer.title": "Aviso legal",
  "disclaimer.text": "Esta ferramenta é meramente informativa e non constitúe asesoramento fiscal nin xurídico. Os resultados xerados deben ser verificados polo usuario e/ou un profesional cualificado antes de ser utilizados en calquera declaración tributaria.\n\nDeclaRenta non se responsabiliza de erros, omisións nin das consecuencias derivadas do uso desta información. O usuario é o único responsable da veracidade e exactitude dos datos introducidos e das declaracións presentadas ante a Axencia Tributaria.\n\nOs tipos de cambio proceden do Banco Central Europeo (BCE). Os cálculos fiscais baséanse na normativa vixente (LIRPF, Lei do Patrimonio, Orde EHA/3290/2008) pero poden non cubrir todos os supostos nin reflectir cambios normativos posteriores á última actualización do software.",
  "disclaimer.accept": "Entendido",

  "a11y.skip_link": "Saltar ao contido",
  "a11y.nav_label": "Axustes",
  "a11y.lang_label": "Idioma",
  "a11y.theme_toggle": "Cambiar tema",
  "a11y.drop_zone": "Zona de carga de ficheiros",
  "a11y.file_input": "Seleccionar ficheiros",

  "theme.toggle": "Cambiar tema",

  "error.no_broker_detected": "Non se puido detectar o broker de \"{{filename}}\". Selecciona o broker manualmente.",
  "error.prefix": "Erro: ",

  "status.fetching_rates": "Obtendo tipos BCE para {{currencies}}...",
  "status.files_processed": "{{count}} ficheiro(s) procesado(s) — {{brokers}} — {{trades}} operacións",
};

export default gl;
