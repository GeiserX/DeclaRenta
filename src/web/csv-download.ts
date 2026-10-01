/**
 * CSV download blob for the web export buttons.
 *
 * Prepends a UTF-8 byte order mark (EF BB BF). Without it Excel decodes the
 * file as Windows-1252 and accented broker descriptions turn into mojibake
 * ("Société" shows as "SociÃ©tÃ©"). The CLI writes to stdout and never adds it.
 */

import type { TaxSummary } from "../types/tax.js";
import { formatCsv, type CsvDialect } from "../generators/csv.js";

const UTF8_BOM = "\uFEFF";

export function csvDownload(report: TaxSummary, dialect: CsvDialect): { blob: Blob; filename: string } {
  const blob = new Blob([UTF8_BOM + formatCsv(report, dialect)], { type: "text/csv;charset=utf-8" });
  const suffix = dialect === "excel-es" ? "_excel" : "";
  return { blob, filename: `declarenta_${report.year}${suffix}.csv` };
}
