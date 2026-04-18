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

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const VERSION: string = (_require("../../package.json") as { version: string }).version;

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

      const casillas: [string, string, string][] = [
        ["Casilla 0327", "Valor de transmisión", formatEur(report.capitalGains.transmissionValue)],
        ["Casilla 0328", "Valor de adquisición", formatEur(report.capitalGains.acquisitionValue)],
        ["", "Ganancia/Pérdida neta", formatEur(report.capitalGains.netGainLoss)],
        ["Casilla 0029", "Dividendos brutos", formatEur(report.dividends.grossIncome)],
        ["Casilla 0033", "Intereses ganados", formatEur(report.interest.earned)],
        ["Casilla 0032", "Intereses margen (no deducible)", formatEur(report.interest.paid)],
        ["Casilla 0588", "Deducción doble imposición", formatEur(report.doubleTaxation.deduction)],
      ];

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

        const cols = [
          { label: "ISIN", x: MARGIN + 4, w: 68 },
          { label: "Símbolo", x: MARGIN + 76, w: 46 },
          { label: "F. Compra", x: MARGIN + 126, w: 52 },
          { label: "F. Venta", x: MARGIN + 182, w: 52 },
          { label: "Uds.", x: MARGIN + 238, w: 28 },
          { label: "Coste EUR", x: MARGIN + 270, w: 56 },
          { label: "Venta EUR", x: MARGIN + 330, w: 56 },
          { label: "G/P EUR", x: MARGIN + 390, w: 48 },
          { label: "Tipo ECB", x: MARGIN + 442, w: 48 },
        ];

        doc.fontSize(FONT_SIZE.small).fillColor("#ffffff");
        for (const col of cols) {
          doc.text(col.label, col.x, tableY + 3, { width: col.w });
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

          doc.fontSize(FONT_SIZE.small).fillColor(COLORS.text);
          doc.text(d.isin, cols[0]!.x, rowY + 2, { width: cols[0]!.w });
          doc.text(d.symbol.slice(0, 10), cols[1]!.x, rowY + 2, { width: cols[1]!.w });
          doc.text(formatDate(d.acquireDate), cols[2]!.x, rowY + 2, { width: cols[2]!.w });
          doc.text(formatDate(d.sellDate), cols[3]!.x, rowY + 2, { width: cols[3]!.w });
          doc.text(d.quantity.toString(), cols[4]!.x, rowY + 2, { width: cols[4]!.w });
          doc.text(d.costBasisEur.toFixed(2), cols[5]!.x, rowY + 2, { width: cols[5]!.w });
          doc.text(d.proceedsEur.toFixed(2), cols[6]!.x, rowY + 2, { width: cols[6]!.w });
          doc.fillColor(glColor).text(gainLoss.toFixed(2), cols[7]!.x, rowY + 2, { width: cols[7]!.w });
          doc.fillColor(COLORS.muted).text(d.sellEcbRate.toFixed(4), cols[8]!.x, rowY + 2, { width: cols[8]!.w });

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

        for (const d of report.dividends.entries.slice(0, 30)) {
          doc.fontSize(FONT_SIZE.small).fillColor(COLORS.text)
            .text(
              `${formatDate(d.payDate)}  ${d.symbol.padEnd(12)}  ${d.isin}  Bruto: ${d.grossAmountEur.toFixed(2)} EUR  Retención: ${d.withholdingTaxEur.toFixed(2)} EUR  (${d.withholdingCountry})  ECB: ${d.ecbRate.toFixed(4)}`,
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
              `${country}: Impuesto pagado ${data.taxPaid.toFixed(2)} EUR → Deducción permitida ${data.deductionAllowed.toFixed(2)} EUR`,
              MARGIN,
            );
          doc.moveDown(0.3);
        }

        doc.moveDown(1);
      }

      // --- Warnings ---
      if (report.warnings.length > 0) {
        checkPageBreak(doc);
        sectionHeader(doc, "Advertencias");
        for (const w of report.warnings.slice(0, 20)) {
          doc.fontSize(FONT_SIZE.small).fillColor(COLORS.accent).text(w, MARGIN);
          doc.moveDown(0.2);
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
          `DeclaRenta v${VERSION} — https://declarenta.es — Este informe es orientativo y no sustituye al asesoramiento fiscal profesional.`,
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
