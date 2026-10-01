/**
 * CSV report generator.
 *
 * Exports per-operation detail as CSV for import into spreadsheets.
 *
 * Two dialects share one layout:
 * - "standard": RFC 4180 style, ',' separator, '.' decimals. The CLI and any
 *   tool that parses the file rely on this exact shape.
 * - "excel-es": ';' separator and ',' decimals, what Excel expects on a
 *   Spanish-locale system (its list separator is ';'), so a double-click opens
 *   the file split into columns with numbers Excel can sum.
 */

import type { TaxSummary } from "../types/tax.js";
import { computeCasillaBlocksWithFx, groupDividendsByIssuer } from "./casillas.js";

export type CsvDialect = "standard" | "excel-es";

export function escapeCsv(val: string, separator = ","): string {
  // Prevent spreadsheet formula injection (=, +, -, @ can execute formulas in
  // Excel/Sheets). Leading tab/CR/LF/space are stripped before the dangerous
  // char is matched, because Excel still interprets a cell like "\n=cmd" or
  // "\t+..." as a formula after skipping leading control chars.
  const safe = /^[\t\r\n ]*[=+\-@]/.test(val) ? `'${val}` : val;
  if (/["\r\n]/.test(safe) || safe.includes(separator)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function formatCsv(report: TaxSummary, dialect: CsvDialect = "standard"): string {
  const sep = dialect === "excel-es" ? ";" : ",";
  // Text cell: escaped for the dialect's separator.
  const tx = (v: string): string => escapeCsv(v, sep);
  // Number cell (already formatted with '.' decimals by toFixed/toString):
  // Excel es-ES only reads ',' as the decimal mark.
  const num = (v: string): string => (dialect === "excel-es" ? v.replace(".", ",") : v);
  const row = (cells: string[]): string => cells.join(sep);
  // Header lines are written with ',' for readability; no header name contains one.
  const header = (cols: string): string => cols.split(",").join(sep);

  const lines: string[] = [];

  // Settings the figures were computed with (monodivisa and titulares change
  // every amount below), so an exported file says which options produced it.
  if (report.settings) {
    lines.push("# AJUSTES DEL CALCULO");
    lines.push(header("Ajuste,Valor"));
    lines.push(row(["Monodivisa", report.settings.monodivisa ? "SI" : "NO"]));
    lines.push(row(["Titulares", String(report.settings.titulares)]));
    lines.push(row(["Procesar_Autoconversiones", report.settings.trackAutoConvert ? "SI" : "NO"]));
    lines.push("");
  }

  // Capital gains section
  lines.push("# GANANCIAS PATRIMONIALES");
  lines.push(header("ISIN,Simbolo,Descripcion,Categoria,Fecha_Compra,Fecha_Venta,Cantidad,Coste_EUR,Venta_EUR,Ganancia_EUR,Dias,Divisa,Tipo_ECB_Compra,Tipo_ECB_Venta,Bloqueada_Antichurning,Opcion_Escenario,Put_Call,Strike,Vencimiento,Subyacente,Perdida_Bloqueada_EUR"));
  for (const d of report.capitalGains.disposals) {
    lines.push(row([
      tx(d.isin), tx(d.symbol), tx(d.description),
      tx(d.assetCategory), tx(d.acquireDate), tx(d.sellDate),
      num(d.quantity.toString()), num(d.costBasisEur.toFixed(2)), num(d.proceedsEur.toFixed(2)),
      num(d.gainLossEur.toFixed(2)), d.holdingPeriodDays.toString(),
      tx(d.currency), num(d.acquireEcbRate.toFixed(6)), num(d.sellEcbRate.toFixed(6)),
      d.washSaleBlocked ? "SI" : "NO",
      tx(d.optionScenario ?? ""),
      tx(d.putCall ?? ""),
      tx(num(d.strike ?? "")), // a number from the broker, so the decimal comma applies
      tx(d.expiry ?? ""),
      tx(d.underlyingSymbol ?? ""),
      // Appended last so existing column positions stay put.
      num(d.blockedLossEur.toFixed(2)),
    ]));
  }

  lines.push("");

  // Dividends section — one row per payment (unchanged; existing consumers rely
  // on this exact shape).
  lines.push("# DIVIDENDOS");
  lines.push(header("ISIN,Simbolo,Descripcion,Fecha,Bruto_EUR,Retencion_EUR,Pais,Divisa"));
  for (const d of report.dividends.entries) {
    lines.push(row([
      tx(d.isin), tx(d.symbol), tx(d.description), tx(d.payDate),
      num(d.grossAmountEur.toFixed(2)), num(d.withholdingTaxEur.toFixed(2)),
      tx(d.withholdingCountry), tx(d.currency),
    ]));
  }

  lines.push("");

  // Per-issuer aggregation — annual totals per company+country, the shape the
  // AEAT "Alta Capital mobiliario" form expects. Separate section (NOT mixed
  // with per-payment rows) so summing either section's amounts is unambiguous.
  const dividendGroups = groupDividendsByIssuer(report.dividends.entries);
  if (dividendGroups.length > 0) {
    lines.push("# DIVIDENDOS POR EMISOR");
    lines.push(header("ISIN,Simbolo,Pais,Pagos,Bruto_Anual_EUR,Retencion_Anual_EUR,Divisa"));
    for (const g of dividendGroups) {
      lines.push(row([
        tx(g.isin), tx(g.symbol), tx(g.withholdingCountry),
        g.paymentCount.toString(), num(g.grossTotalEur.toFixed(2)), num(g.withholdingTotalEur.toFixed(2)),
        tx(g.currency),
      ]));
    }
    lines.push("");
  }

  // FX gains section
  if (report.fxGains.disposals.length > 0) {
    lines.push("# GANANCIAS FX (Art. 33.1 LIRPF)");
    lines.push(header("Divisa,Fecha_Compra,Fecha_Venta,Cantidad,Coste_EUR,Venta_EUR,Ganancia_EUR,Dias,Origen,Lote_FIFO"));
    for (const d of report.fxGains.disposals) {
      lines.push(row([
        tx(d.currency), tx(d.acquireDate), tx(d.disposeDate),
        num(d.quantity.toFixed(2)), num(d.costBasisEur.toFixed(2)), num(d.proceedsEur.toFixed(2)),
        num(d.gainLossEur.toFixed(2)), d.holdingPeriodDays.toString(),
        tx(d.trigger), tx(d.lotId),
      ]));
    }
    lines.push("");
  }

  // Summary section. "Otros elementos patrimoniales" (1633/1637) combines
  // non-listed disposals (options, crypto, funds) and foreign-currency gains
  // (Art. 33.1) — the FX merge is owned by computeCasillaBlocksWithFx().
  const blocks = computeCasillaBlocksWithFx(report);
  const summary = (casilla: string, concept: string, value: string): void => {
    lines.push(row([casilla, concept, num(value)]));
  };
  lines.push("# RESUMEN CASILLAS");
  lines.push(header("Casilla,Concepto,Valor_EUR"));
  if (blocks.listedShares.count > 0) {
    summary("0328", "Valor de transmision (acciones negociadas)", blocks.listedShares.transmissionValue.toFixed(2));
    summary("0331", "Valor de adquisicion (acciones negociadas)", blocks.listedShares.acquisitionValue.toFixed(2));
  }
  if (blocks.otherElements.count > 0) {
    summary("1633", "Valor de transmision (otros elementos: opciones/cripto/fondos/divisa)", blocks.otherElements.transmissionValue.toFixed(2));
    summary("1637", "Valor de adquisicion (otros elementos: opciones/cripto/fondos/divisa)", blocks.otherElements.acquisitionValue.toFixed(2));
  }
  summary("0029", "Dividendos brutos", report.dividends.grossIncome.toFixed(2));
  summary("—", "Intereses pagados al broker (margen no deducible — informativo)", report.interest.paid.toFixed(2));
  summary("0027", "Intereses de cuentas", report.interest.earned.toFixed(2));
  if (report.generalGains.total.greaterThan(0)) {
    summary("0304", "Ganancias patrimoniales no derivadas de transmision (base general: airdrops/referidos)", report.generalGains.total.toFixed(2));
  }
  summary("0588", "Deduccion doble imposicion", report.doubleTaxation.deduction.toFixed(2));
  summary("0597", "Retenciones capital mobiliario", report.dividends.spanishWithholding.toFixed(2));
  // Anti-churning (Art. 33.5.f): informative, no aggregate casilla.
  if (report.capitalGains.blockedLosses.greaterThan(0)) {
    summary("—", "Perdidas bloqueadas antichurning (Art. 33.5.f — informativo)", report.capitalGains.blockedLosses.toFixed(2));
  }
  if (report.capitalGains.reintegratedLosses.greaterThan(0)) {
    summary("—", "Perdidas reintegradas antichurning (Art. 33.5.f — informativo)", report.capitalGains.reintegratedLosses.toFixed(2));
  }

  return lines.join("\n") + "\n";
}
