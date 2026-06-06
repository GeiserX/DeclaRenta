/**
 * CSV report generator.
 *
 * Exports per-operation detail as CSV for import into spreadsheets.
 */

import type { TaxSummary } from "../types/tax.js";
import { computeCasillaBlocksWithFx, groupDividendsByIssuer } from "./casillas.js";

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
  lines.push("ISIN,Simbolo,Descripcion,Categoria,Fecha_Compra,Fecha_Venta,Cantidad,Coste_EUR,Venta_EUR,Ganancia_EUR,Dias,Divisa,Tipo_ECB_Compra,Tipo_ECB_Venta,Bloqueada_Antichurning,Opcion_Escenario,Put_Call,Strike,Vencimiento,Subyacente");
  for (const d of report.capitalGains.disposals) {
    lines.push([
      escapeCsv(d.isin), escapeCsv(d.symbol), escapeCsv(d.description),
      escapeCsv(d.assetCategory), d.acquireDate, d.sellDate,
      d.quantity.toString(), d.costBasisEur.toFixed(2), d.proceedsEur.toFixed(2),
      d.gainLossEur.toFixed(2), d.holdingPeriodDays.toString(),
      escapeCsv(d.currency), d.acquireEcbRate.toFixed(6), d.sellEcbRate.toFixed(6),
      d.washSaleBlocked ? "SI" : "NO",
      escapeCsv(d.optionScenario ?? ""),
      escapeCsv(d.putCall ?? ""),
      escapeCsv(d.strike ?? ""),
      escapeCsv(d.expiry ?? ""),
      escapeCsv(d.underlyingSymbol ?? ""),
    ].join(","));
  }

  lines.push("");

  // Dividends section — one row per payment (unchanged; existing consumers rely
  // on this exact shape).
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

  // Per-issuer aggregation — annual totals per company+country, the shape the
  // AEAT "Alta Capital mobiliario" form expects. Separate section (NOT mixed
  // with per-payment rows) so summing either section's amounts is unambiguous.
  const dividendGroups = groupDividendsByIssuer(report.dividends.entries);
  if (dividendGroups.length > 0) {
    lines.push("# DIVIDENDOS POR EMISOR");
    lines.push("ISIN,Simbolo,Pais,Pagos,Bruto_Anual_EUR,Retencion_Anual_EUR,Divisa");
    for (const g of dividendGroups) {
      lines.push([
        escapeCsv(g.isin), escapeCsv(g.symbol), escapeCsv(g.withholdingCountry),
        g.paymentCount.toString(), g.grossTotalEur.toFixed(2), g.withholdingTotalEur.toFixed(2),
        escapeCsv(g.currency),
      ].join(","));
    }
    lines.push("");
  }

  // FX gains section
  if (report.fxGains.disposals.length > 0) {
    lines.push("# GANANCIAS FX (Art. 37.1.l LIRPF)");
    lines.push("Divisa,Fecha_Compra,Fecha_Venta,Cantidad,Coste_EUR,Venta_EUR,Ganancia_EUR,Dias,Origen,Lote_FIFO");
    for (const d of report.fxGains.disposals) {
      lines.push([
        escapeCsv(d.currency), d.acquireDate, d.disposeDate,
        d.quantity.toFixed(2), d.costBasisEur.toFixed(2), d.proceedsEur.toFixed(2),
        d.gainLossEur.toFixed(2), d.holdingPeriodDays.toString(),
        escapeCsv(d.trigger), escapeCsv(d.lotId),
      ].join(","));
    }
    lines.push("");
  }

  // Summary section. "Otros elementos patrimoniales" (1633/1637) combines
  // non-listed disposals (options, crypto, funds) and foreign-currency gains
  // (Art. 37.1.l) — the FX merge is owned by computeCasillaBlocksWithFx().
  const blocks = computeCasillaBlocksWithFx(report);
  lines.push("# RESUMEN CASILLAS");
  lines.push("Casilla,Concepto,Valor_EUR");
  if (blocks.listedShares.count > 0) {
    lines.push(`0328,Valor de transmision (acciones negociadas),${blocks.listedShares.transmissionValue.toFixed(2)}`);
    lines.push(`0331,Valor de adquisicion (acciones negociadas),${blocks.listedShares.acquisitionValue.toFixed(2)}`);
  }
  if (blocks.otherElements.count > 0) {
    lines.push(`1633,Valor de transmision (otros elementos: opciones/cripto/fondos/divisa),${blocks.otherElements.transmissionValue.toFixed(2)}`);
    lines.push(`1637,Valor de adquisicion (otros elementos: opciones/cripto/fondos/divisa),${blocks.otherElements.acquisitionValue.toFixed(2)}`);
  }
  lines.push(`0029,Dividendos brutos,${report.dividends.grossIncome.toFixed(2)}`);
  lines.push(`—,Intereses pagados al broker (margen no deducible — informativo),${report.interest.paid.toFixed(2)}`);
  lines.push(`0027,Intereses de cuentas,${report.interest.earned.toFixed(2)}`);
  if (report.generalGains.total.greaterThan(0)) {
    lines.push(`0304,Ganancias patrimoniales no derivadas de transmision (base general: airdrops/referidos),${report.generalGains.total.toFixed(2)}`);
  }
  lines.push(`0588,Deduccion doble imposicion,${report.doubleTaxation.deduction.toFixed(2)}`);

  return lines.join("\n") + "\n";
}
