/**
 * CSV report generator.
 *
 * Exports per-operation detail as CSV for import into spreadsheets.
 */

import type { TaxSummary } from "../types/tax.js";

export function escapeCsv(val: string): string {
  // Prevent spreadsheet formula injection (=, +, -, @ can execute formulas in Excel/Sheets)
  const safe = /^[\t\r ]*[=+\-@]/.test(val) ? `'${val}` : val;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function formatCsv(report: TaxSummary): string {
  const lines: string[] = [];

  // Capital gains section
  lines.push("# GANANCIAS PATRIMONIALES");
  lines.push("ISIN,Simbolo,Descripcion,Fecha_Compra,Fecha_Venta,Cantidad,Coste_EUR,Venta_EUR,Ganancia_EUR,Dias,Divisa,Tipo_ECB_Compra,Tipo_ECB_Venta,Bloqueada_Antichurning");
  for (const d of report.capitalGains.disposals) {
    lines.push([
      escapeCsv(d.isin), escapeCsv(d.symbol), escapeCsv(d.description), d.acquireDate, d.sellDate,
      d.quantity.toString(), d.costBasisEur.toFixed(2), d.proceedsEur.toFixed(2),
      d.gainLossEur.toFixed(2), d.holdingPeriodDays.toString(),
      escapeCsv(d.currency), d.acquireEcbRate.toFixed(6), d.sellEcbRate.toFixed(6),
      d.washSaleBlocked ? "SI" : "NO",
    ].join(","));
  }

  lines.push("");

  // Dividends section
  lines.push("# DIVIDENDOS");
  lines.push("ISIN,Simbolo,Descripcion,Fecha,Bruto_EUR,Retencion_EUR,Pais,Divisa");
  for (const d of report.dividends.entries) {
    lines.push([
      escapeCsv(d.isin), escapeCsv(d.symbol), escapeCsv(d.description), d.payDate,
      d.grossAmountEur.toFixed(2), d.withholdingTaxEur.toFixed(2),
      escapeCsv(d.withholdingCountry), escapeCsv(d.currency),
    ].join(","));
  }

  lines.push("");

  // FX gains section
  if (report.fxGains.disposals.length > 0) {
    lines.push("# GANANCIAS FX (Art. 37.1.l LIRPF)");
    lines.push("Divisa,Fecha_Compra,Fecha_Venta,Cantidad,Coste_EUR,Venta_EUR,Ganancia_EUR,Dias,Origen");
    for (const d of report.fxGains.disposals) {
      lines.push([
        escapeCsv(d.currency), d.acquireDate, d.disposeDate,
        d.quantity.toFixed(2), d.costBasisEur.toFixed(2), d.proceedsEur.toFixed(2),
        d.gainLossEur.toFixed(2), d.holdingPeriodDays.toString(),
        escapeCsv(d.trigger),
      ].join(","));
    }
    lines.push("");
  }

  // Summary section
  lines.push("# RESUMEN CASILLAS");
  lines.push("Casilla,Concepto,Valor_EUR");
  lines.push(`0327,Valor de transmision,${report.capitalGains.transmissionValue.toFixed(2)}`);
  lines.push(`0328,Valor de adquisicion,${report.capitalGains.acquisitionValue.toFixed(2)}`);
  lines.push(`1626,Valor de transmision FX,${report.fxGains.transmissionValue.toFixed(2)}`);
  lines.push(`1631,Valor de adquisicion FX,${report.fxGains.acquisitionValue.toFixed(2)}`);
  lines.push(`0029,Dividendos brutos,${report.dividends.grossIncome.toFixed(2)}`);
  lines.push(`—,Intereses pagados al broker (margen no deducible — informativo),${report.interest.paid.toFixed(2)}`);
  lines.push(`0033,Intereses de cuentas,${report.interest.earned.toFixed(2)}`);
  lines.push(`0588,Deduccion doble imposicion,${report.doubleTaxation.deduction.toFixed(2)}`);

  return lines.join("\n") + "\n";
}
