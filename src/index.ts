/**
 * DeclaRenta - Convert foreign broker reports into Spanish tax declarations.
 *
 * @module declarenta
 * @license GPL-3.0
 */

// Parsers
export { parseIbkrFlexXml } from "./parsers/ibkr.js";

// Engine
export { FifoEngine } from "./engine/fifo.js";
export { detectWashSales } from "./engine/wash-sale.js";
export { fetchEcbRates, getEcbRate } from "./engine/ecb.js";
export { calculateDividends } from "./engine/dividends.js";
export { calculateDoubleTaxation } from "./engine/double-taxation.js";

// Generators
export { generateTaxReport } from "./generators/report.js";
export { generateModelo720 } from "./generators/modelo720.js";
export { formatCsv, escapeCsv } from "./generators/csv.js";

// Types
export type * from "./types/index.js";
