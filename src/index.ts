/**
 * DeclaRenta - Convert foreign broker reports into Spanish tax declarations.
 *
 * @module declarenta
 * @license GPL-3.0
 */

// Parsers
export { parseIbkrFlexXml, ibkrParser } from "./parsers/ibkr.js";
export { degiroParser } from "./parsers/degiro.js";
export { scalableParser } from "./parsers/scalable.js";
export { freedom24Parser } from "./parsers/freedom24.js";
export { etoroParser, parseEtoroXlsx, detectEtoroXlsx } from "./parsers/etoro.js";
export { coinbaseParser } from "./parsers/coinbase.js";
export { binanceParser } from "./parsers/binance.js";
export { krakenParser } from "./parsers/kraken.js";
export { detectBroker, getBroker, brokerParsers } from "./parsers/index.js";

// CSV utilities
export {
  detectDelimiter,
  parseCsvLine,
  parseNumber,
  convertDateDMY,
  convertDateDMYSlash,
  convertDateISO,
  findColumn,
  stripBom,
} from "./parsers/csv-utils.js";

// Engine
export { FifoEngine } from "./engine/fifo.js";
export { detectWashSales } from "./engine/wash-sale.js";
export { fetchEcbRates, getEcbRate, getQ4AverageRate } from "./engine/ecb.js";
export { calculateDividends } from "./engine/dividends.js";
export { calculateDoubleTaxation } from "./engine/double-taxation.js";
export { applyLossCarryforward } from "./engine/loss-carryforward.js";

// Generators
export { generateTaxReport } from "./generators/report.js";
export { generateModelo720, checkModelo720Thresholds } from "./generators/modelo720.js";
export { generateModelo721 } from "./generators/modelo721.js";
export { generateD6Report } from "./generators/d6.js";
export { generatePdfReport } from "./generators/pdf.js";
export { formatCsv, escapeCsv } from "./generators/csv.js";
export { validateModelo720Records } from "./generators/modelo720-validator.js";

// i18n
export { t, setLocale, getCurrentLocale, detectLocale, initLocale, getLocaleNames } from "./i18n/index.js";
export type { Locale, TranslationKey } from "./i18n/index.js";

// Types
export type * from "./types/index.js";
