// BETA: Tradución automática, pendente de revisión por falante nativo
/** Galego */
import type { TranslationKeys } from "./es.js";

const gl: TranslationKeys = {
  "app.title": "DeclaRenta",
  "app.subtitle": "Broker estranxeiro → Renda española",


  "upload.title": "Sube o teu informe do broker",
  "upload.broker_label": "Broker:",
  "upload.auto_detect": "Auto-detectar",
  "upload.drop_text": "Arrastra o teu ficheiro aquí ou fai clic para seleccionar",
  "upload.formats_help": "Formatos: XML (IBKR Flex), CSV (Degiro, Scalable, Coinbase, Binance, Kraken), JSON (Freedom24), XLSX (eToro)",

  "config.title": "Configura",
  "config.year_label": "Exercicio fiscal:",
  "config.process_btn": "Procesar",
  "config.processing": "Procesando...",

  "results.title": "Resultados para o Modelo 100",
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

  "footer.docs": "Documentación",
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

  // Wizard steps
  "wizard.step1": "Subir ficheiros",
  "wizard.step2": "Revisar datos",
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

  // Year comparison
  "compare.title": "Comparativa anual",
  "compare.no_data": "Procesa polo menos 2 exercicios para ver a comparativa.",
  "compare.year": "Exercicio",
  "compare.variation": "Variación",
  "compare.saved_reports": "Informes gardados",
  "compare.clear_history": "Borrar historial",
  "compare.clear_confirm": "Borrar todos os informes gardados?",

  "error.no_broker_detected": "Non se puido detectar o broker de \"{{filename}}\". Selecciona o broker manualmente.",
  "error.prefix": "Erro: ",

  "status.fetching_rates": "Obtendo tipos BCE para {{currencies}}...",
  "status.files_processed": "{{count}} ficheiro(s) procesado(s) — {{brokers}} — {{trades}} operacións",

  "sidebar.profile": "Perfil fiscal",
  "sidebar.renta": "Modelo 100 (Renda)",
  "sidebar.m720": "Modelo 720",
  "sidebar.d6": "Modelo D-6",
  "sidebar.toggle": "Abrir/pechar menú",

  "profile.title": "Perfil fiscal",
  "profile.description": "Estes datos utilízanse para xerar os ficheiros dos modelos 720 e D-6.",
  "profile.nif_label": "NIF/NIE:",
  "profile.surname_label": "Apelidos:",
  "profile.surname_placeholder": "García López",
  "profile.name_label": "Nome:",
  "profile.name_placeholder": "Xoán",
  "profile.ccaa_label": "Comunidade Autónoma:",
  "profile.phone_label": "Teléfono:",
  "profile.phone_placeholder": "600123456",
  "profile.saved": "Perfil gardado",
  "profile.incomplete_banner": "Completa o teu perfil fiscal para xerar os modelos 720 e D-6.",
  "profile.go_to_profile": "Ir ao perfil",

  "guide.title": "Como obter o informe?",
  "guide.tip_fifo": "Inclúe todo o histórico — DeclaRenta necesita operacións anteriores para o cálculo FIFO correcto.",

  "m720.title": "Modelo 720 — Bens no estranxeiro",
  "m720.description": "Declaración informativa sobre bens e dereitos situados no estranxeiro.",
  "m720.threshold_exceeded": "Segundo as túas posicións ({{amount}} €), estás obrigado a presentar o Modelo 720.",
  "m720.threshold_not_exceeded": "Non superas o limiar de 50.000 € (total: {{amount}} €). Non estás obrigado a presentar.",
  "m720.no_positions": "Sube un informe con posicións abertas no Modelo 100 para analizar o Modelo 720.",
  "m720.positions_title": "Posicións declarables",
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
  "d6.no_minimum": "O D-6 é obrigatorio para CALQUERA importe. Non ten limiar mínimo.",
  "d6.no_positions": "Sube un informe con posicións abertas no Modelo 100 para analizar o D-6.",
  "d6.positions_title": "Posicións a declarar",
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

  "section.year_label": "Exercicio",

  "badge.complete": "Completo",
  "badge.pending": "Pendente",
  "badge.not_applicable": "Non aplica",
  "badge.generated": "Xerado",
};

export default gl;
