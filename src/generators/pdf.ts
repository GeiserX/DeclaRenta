/**
 * PDF report generator.
 *
 * Generates a structured PDF with capital gains, dividends, double taxation,
 * and summary information for the Spanish tax declaration.
 *
 * Uses pdfkit for server-side PDF generation (Node.js only, not browser).
 */

import PDFDocument from "pdfkit";
import Decimal from "decimal.js";
import type { TaxSummary } from "../types/tax.js";
import { localizeHint, localizeMessage, t } from "../i18n/index.js";
import { combinedNetGainLoss, computeCasillaBlocksWithFx, groupDividendsByIssuer } from "./casillas.js";
import { pdfSafeText } from "./pdf-text.js";
import { showBrokerColumns } from "./broker-columns.js";

declare const __PACKAGE_VERSION__: string | undefined;
const VERSION = typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "dev";

// ---------------------------------------------------------------------------
// PDF layout constants
// ---------------------------------------------------------------------------

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const FONT_SIZE = {
  title: 18,
  section: 13,
  body: 9,
  small: 7.5,
};
const COLORS = {
  primary: "#1a365d",
  secondary: "#2b6cb0",
  text: "#1a202c",
  muted: "#718096",
  accent: "#e53e3e",
  success: "#38a169",
  bg: "#f7fafc",
  border: "#e2e8f0",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEur(d: Decimal): string {
  return d.toFixed(2) + " EUR";
}

function formatDate(date: string): string {
  if (date.length === 8) {
    return `${date.slice(6, 8)}/${date.slice(4, 6)}/${date.slice(0, 4)}`;
  }
  return date;
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

/**
 * Generate a PDF report from a TaxSummary.
 *
 * @param report - Complete tax summary
 * @returns Promise<Buffer> containing the PDF
 */
export function generatePdfReport(report: TaxSummary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        info: {
          Title: `DeclaRenta - Informe Fiscal ${report.year}`,
          Author: "DeclaRenta",
          Subject: `Modelo 100 - Ejercicio ${report.year}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      doc.on("end", () => { resolve(Buffer.concat(chunks)); });
      doc.on("error", (err: Error) => { reject(err); });

      // --- Header ---
      doc
        .fontSize(FONT_SIZE.title)
        .fillColor(COLORS.primary)
        .text("DECLARENTA", MARGIN, MARGIN, { align: "left" })
        .fontSize(FONT_SIZE.small)
        .fillColor(COLORS.muted)
        .text(`Informe fiscal — Ejercicio ${report.year}`, { align: "left" })
        .text(`Generado el ${new Date().toLocaleDateString("es-ES")} — v${VERSION}`, { align: "left" });
      if (report.settings) {
        const s = report.settings;
        const yesNo = (v: boolean) => (v ? "sí" : "no");
        doc.text(
          `Ajustes del cálculo: monodivisa ${yesNo(s.monodivisa)}, titulares ${s.titulares}, autoconversiones ${yesNo(s.trackAutoConvert)}`,
          { align: "left" },
        );
      }

      doc.moveDown(1.5);

      // --- Divider ---
      const dividerY = doc.y;
      doc
        .moveTo(MARGIN, dividerY)
        .lineTo(MARGIN + CONTENT_WIDTH, dividerY)
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .stroke();

      doc.moveDown(1);

      // --- Section 1: Resumen Casillas ---
      sectionHeader(doc, "1. Resumen de Casillas — Modelo 100");

      const blocks = computeCasillaBlocksWithFx(report);
      const casillas: [string, string, string][] = [];
      if (blocks.listedShares.count > 0) {
        casillas.push(["Casilla 0328", "V. transmisión (acciones negociadas)", formatEur(blocks.listedShares.transmissionValue)]);
        casillas.push(["Casilla 0331", "V. adquisición (acciones negociadas)", formatEur(blocks.listedShares.acquisitionValue)]);
      }
      if (blocks.otherElements.count > 0) {
        casillas.push(["Casilla 1633", "V. transmisión (otros: opc./cripto/fondos/divisa)", formatEur(blocks.otherElements.transmissionValue)]);
        casillas.push(["Casilla 1637", "V. adquisición (otros: opc./cripto/fondos/divisa)", formatEur(blocks.otherElements.acquisitionValue)]);
      }
      casillas.push(
        ["", "Ganancia/Pérdida neta", formatEur(combinedNetGainLoss(blocks))],
        ["Casilla 0029", "Dividendos brutos", formatEur(report.dividends.grossIncome)],
        ["Casilla 0027", "Intereses ganados", formatEur(report.interest.earned)],
        ["Informativo", "Intereses margen (no deducible)", formatEur(report.interest.paid)],
      );
      if (report.generalGains.total.greaterThan(0)) {
        casillas.push(["Casilla 0304", "Gananc. patrim. no derivadas de transmisión (airdrops/referidos)", formatEur(report.generalGains.total)]);
      }
      casillas.push(
        ["Casilla 0588", "Deducción doble imposición", formatEur(report.doubleTaxation.deduction)],
        ["Casilla 0597", "Retenciones capital mobiliario", formatEur(report.dividends.spanishWithholding)],
      );
      // Anti-churning (Art. 33.5.f): informative only, Renta Web applies it per
      // disposal and has no aggregate casilla. Same rows as the web PDF.
      if (report.capitalGains.blockedLosses.greaterThan(0)) {
        casillas.push(["Informativo", "Pérdidas bloqueadas anti-churning", formatEur(report.capitalGains.blockedLosses)]);
      }
      if (report.capitalGains.reintegratedLosses.greaterThan(0)) {
        casillas.push(["Informativo", "Pérdidas reintegradas (anti-churning)", formatEur(report.capitalGains.reintegratedLosses)]);
      }

      for (const [casilla, desc, value] of casillas) {
        const y = doc.y;
        doc.fontSize(FONT_SIZE.body).fillColor(COLORS.text);
        if (casilla) {
          doc.font("Helvetica-Bold").text(casilla, MARGIN, y, { width: 90, continued: false });
          doc.font("Helvetica").text(desc, MARGIN + 95, y, { width: 280, continued: false });
        } else {
          doc.font("Helvetica-Bold").text(desc, MARGIN + 95, y, { width: 280, continued: false });
        }
        doc.font("Helvetica").text(value, MARGIN + 380, y, { width: 120, align: "right" });
        doc.moveDown(0.3);
      }

      doc.moveDown(1);

      // --- Section 2: Operaciones (capital gains detail) ---
      if (report.capitalGains.disposals.length > 0) {
        checkPageBreak(doc);
        sectionHeader(doc, "2. Detalle de Operaciones");

        // Table header
        const tableY = doc.y;
        doc
          .rect(MARGIN, tableY, CONTENT_WIDTH, 16)
          .fill(COLORS.primary);

        // Purchase and sale broker after the dates, only when the sales name
        // more than one broker; the table then uses a smaller font and narrower
        // columns to stay inside the page.
        const brokers = showBrokerColumns(report.capitalGains.disposals);
        const tableFont = brokers ? 6.5 : FONT_SIZE.small;
        const cols = opsColumns(brokers);
        const col = (key: OpsColumnKey) => cols.find((c) => c.key === key)!;

        doc.fontSize(tableFont).fillColor("#ffffff");
        for (const c of cols) {
          doc.text(c.label, c.x, tableY + 3, { width: c.w });
        }

        doc.y = tableY + 18;

        // Table rows
        const maxRows = Math.min(report.capitalGains.disposals.length, 50);
        for (let i = 0; i < maxRows; i++) {
          const d = report.capitalGains.disposals[i]!;
          const rowY = doc.y;

          if (i % 2 === 0) {
            doc.rect(MARGIN, rowY, CONTENT_WIDTH, 14).fill(COLORS.bg);
          }

          const gainLoss = d.gainLossEur;
          const glColor = gainLoss.greaterThanOrEqualTo(0) ? COLORS.success : COLORS.accent;

          const cell = (key: OpsColumnKey, text: string) => {
            const c = col(key);
            doc.text(text, c.x, rowY + 2, { width: c.w });
          };
          doc.fontSize(tableFont).fillColor(COLORS.text);
          cell("isin", d.isin);
          const scenarioTag = d.optionScenario === "expiration" ? "EXP" : d.optionScenario === "exercise" ? "EJ" : "CL";
          const symbolLabel = d.optionScenario
            ? `${(d.underlyingSymbol ?? d.symbol).slice(0, 6)}${d.putCall ?? ""} [${scenarioTag}]`
            : d.symbol.slice(0, 10);
          cell("symbol", symbolLabel);
          cell("buyDate", formatDate(d.acquireDate));
          cell("sellDate", formatDate(d.sellDate));
          if (brokers) {
            // One line each: a name too long for the column ends in "...",
            // never wraps into the next row.
            for (const [key, name] of [["buyBroker", d.acquireBrokerSource], ["sellBroker", d.brokerSource]] as const) {
              const c = col(key);
              doc.text(pdfSafeText(name ?? "—"), c.x, rowY + 2, { width: c.w, height: tableFont * 1.6, ellipsis: true });
            }
          }
          cell("units", d.quantity.toString());
          cell("cost", d.costBasisEur.toFixed(2));
          cell("proceeds", d.proceedsEur.toFixed(2));
          doc.fillColor(glColor);
          cell("gainLoss", gainLoss.toFixed(2));
          doc.fillColor(COLORS.muted);
          cell("ecb", d.sellEcbRate.toFixed(4));

          doc.y = rowY + 14;
          checkPageBreak(doc);
        }

        if (report.capitalGains.disposals.length > maxRows) {
          doc.fontSize(FONT_SIZE.small).fillColor(COLORS.muted)
            .text(`... y ${report.capitalGains.disposals.length - maxRows} operaciones más`, MARGIN);
        }

        doc.moveDown(1);
      }

      // --- Section 3: Dividendos ---
      if (report.dividends.entries.length > 0) {
        checkPageBreak(doc);
        sectionHeader(doc, "3. Dividendos");

        // Grouped per issuer + country (annual totals, fiscal-certificate layout).
        for (const g of groupDividendsByIssuer(report.dividends.entries).slice(0, 30)) {
          doc.fontSize(FONT_SIZE.small).fillColor(COLORS.text)
            .text(
              `${g.symbol.padEnd(12)}  ${g.isin}  (${g.withholdingCountry})  ${g.paymentCount} pago(s)  Bruto: ${g.grossTotalEur.toFixed(2)} EUR  Retención: ${g.withholdingTotalEur.toFixed(2)} EUR`,
              MARGIN,
            );
          doc.moveDown(0.2);
        }

        doc.moveDown(1);
      }

      // --- Section 4: Doble imposición ---
      if (report.doubleTaxation.deduction.greaterThan(0)) {
        checkPageBreak(doc);
        sectionHeader(doc, "4. Deducción por Doble Imposición Internacional");

        for (const [country, data] of Object.entries(report.doubleTaxation.byCountry)) {
          doc.fontSize(FONT_SIZE.body).fillColor(COLORS.text)
            .text(
              `${country}: Impuesto pagado ${data.taxPaid.toFixed(2)} EUR — Deducción permitida ${data.deductionAllowed.toFixed(2)} EUR`,
              MARGIN,
            );
          doc.moveDown(0.3);
        }

        doc.moveDown(1);
      }

      // --- Messages (three-tier) ---
      if (report.messages.length > 0) {
        checkPageBreak(doc);
        sectionHeader(doc, "Mensajes");
        // Errors and warnings always render in full, errors first; only the
        // informative notes are capped.
        const MAX_INFOS = 20;
        const infos = report.messages.filter((m) => m.severity === "info");
        const shown = [
          ...report.messages.filter((m) => m.severity === "error"),
          ...report.messages.filter((m) => m.severity === "warning"),
          ...infos.slice(0, MAX_INFOS),
        ];
        for (const m of shown) {
          const label = t(m.severity === "error" ? "pdf.severity_error" : m.severity === "warning" ? "pdf.severity_warning" : "pdf.severity_info");
          const color = m.severity === "error" ? COLORS.accent : COLORS.muted;
          const hint = localizeHint(m);
          const text = `${label}: ${pdfSafeText(localizeMessage(m))}${hint ? ` — ${pdfSafeText(hint)}` : ""}`;
          doc.fontSize(FONT_SIZE.small).fillColor(color).text(text, MARGIN);
          doc.moveDown(0.2);
        }
        if (infos.length > MAX_INFOS) {
          doc.fontSize(FONT_SIZE.small).fillColor(COLORS.muted)
            .text(`... y ${infos.length - MAX_INFOS} mensajes informativos más`, MARGIN);
        }
      }

      // --- ECB footnote ---
      checkPageBreak(doc);
      doc.moveDown(0.5);
      doc.fontSize(FONT_SIZE.small).fillColor(COLORS.muted)
        .text(
          "Tipo ECB: tipo de cambio oficial del Banco Central Europeo (EUR por 1 unidad de divisa extranjera) en la fecha de la operación. Fuente: ECB SDMX API.",
          MARGIN,
        );

      // --- Footer ---
      doc.fontSize(FONT_SIZE.small).fillColor(COLORS.muted)
        .text(
          `DeclaRenta v${VERSION} — https://declarenta.com — Este informe es orientativo y no sustituye al asesoramiento fiscal profesional.`,
          MARGIN,
          doc.page.height - MARGIN - 20,
          { width: CONTENT_WIDTH, align: "center" },
        );

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

type OpsColumnKey =
  | "isin" | "symbol" | "buyDate" | "sellDate" | "buyBroker" | "sellBroker"
  | "units" | "cost" | "proceeds" | "gainLoss" | "ecb";

/**
 * Operations table columns, left to right, 4 pt apart. Without the broker
 * columns the widths are the original layout; with them every column narrows
 * so the eleven fit in CONTENT_WIDTH at the smaller font.
 */
function opsColumns(brokers: boolean): { key: OpsColumnKey; label: string; x: number; w: number }[] {
  const spec: [OpsColumnKey, string, number, number][] = [
    // key, label, width, width with brokers
    ["isin", "ISIN", 68, 46],
    ["symbol", "Símbolo", 46, 46],
    ["buyDate", "F. Compra", 52, 36],
    ["sellDate", "F. Venta", 52, 36],
    ["buyBroker", "Broker compra", 0, 56],
    ["sellBroker", "Broker venta", 0, 56],
    ["units", "Uds.", 28, 26],
    ["cost", "Coste EUR", 56, 34],
    ["proceeds", "Venta EUR", 56, 34],
    ["gainLoss", "G/P EUR", 48, 32],
    ["ecb", "Tipo ECB", 48, 32],
  ];
  const cols: { key: OpsColumnKey; label: string; x: number; w: number }[] = [];
  let x = MARGIN + 4;
  for (const [key, label, w, wBrokers] of spec) {
    const width = brokers ? wBrokers : w;
    if (width === 0) continue;
    cols.push({ key, label, x, w: width });
    x += width + 4;
  }
  return cols;
}

function sectionHeader(doc: InstanceType<typeof PDFDocument>, title: string): void {
  doc
    .fontSize(FONT_SIZE.section)
    .fillColor(COLORS.secondary)
    .font("Helvetica-Bold")
    .text(title, MARGIN)
    .font("Helvetica");
  doc.moveDown(0.5);
}

function checkPageBreak(doc: InstanceType<typeof PDFDocument>): void {
  if (doc.y > doc.page.height - MARGIN - 60) {
    doc.addPage();
  }
}
