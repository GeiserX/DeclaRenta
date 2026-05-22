import type { TaxSummary } from "../types/tax.js";
import type Decimal from "decimal.js";
import type { CellHookData } from "jspdf-autotable";
import type { TranslationKey } from "../i18n/index.js";

export type TranslationFn = (key: TranslationKey) => string;

// Injected by Vite at build time; vitest.config.ts provides "dev" fallback
declare const __APP_VERSION__: string;

// ---------------------------------------------------------------------------
// Layout constants (A4 mm)
// ---------------------------------------------------------------------------

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const C = {
  primary:   "#1a365d",
  header:    "#2b6cb0",
  muted:     "#718096",
  danger:    "#e53e3e",
  headerBg:  [43, 108, 176]  as [number, number, number],
  textRgb:   [26, 32, 44]    as [number, number, number],
  mutedRgb:  [113, 128, 150] as [number, number, number],
  dangerRgb: [229, 62, 62]   as [number, number, number],
  successRgb:[56, 161, 105]  as [number, number, number],
  rowAlt:    [247, 250, 252] as [number, number, number],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: string): string {
  if (d.length === 8) return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
  return d;
}

function eur(d: Decimal): string {
  return d.toFixed(2) + " EUR";
}

function lastTableY(doc: unknown, fallback: number): number {
  return (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;
}

// ---------------------------------------------------------------------------
// Browser-side PDF report generator
// ---------------------------------------------------------------------------

/**
 * Generates a Modelo 100 PDF report entirely in-browser.
 * Lazy-loads jsPDF + jspdf-autotable on first call (~125 KB gz, never on initial page load).
 */
export async function generatePdfWebReport(
  report: TaxSummary,
  t: TranslationFn,
  locale: string = "es",
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

  // --- Header ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(C.primary);
  doc.text("DECLARENTA", MARGIN, MARGIN + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(C.muted);
  doc.text(`${t("pdf.subtitle")} ${report.year}`, MARGIN, MARGIN + 11);
  doc.text(
    `${t("pdf.generated")} ${new Date().toLocaleDateString(locale)} — v${version}`,
    MARGIN,
    MARGIN + 16,
  );

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, MARGIN + 20, MARGIN + CONTENT_W, MARGIN + 20);

  // --- Section 1: Casillas ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(C.header);
  doc.text(t("pdf.section_casillas"), MARGIN, MARGIN + 27);

  const casillasBody: string[][] = [
    ["0327", t("casilla.transmission_value"), eur(report.capitalGains.transmissionValue)],
    ["0328", t("casilla.acquisition_value"),  eur(report.capitalGains.acquisitionValue)],
    ["",     t("casilla.net_gain_loss"),       eur(report.capitalGains.netGainLoss)],
    ["0029", t("casilla.gross_dividends"),     eur(report.dividends.grossIncome)],
    // Casilla 0027: Intereses de cuentas, depósitos y activos financieros (Art. 25.2 LIRPF)
    ["0027", t("casilla.interest_earned"),     eur(report.interest.earned)],
    [t("pdf.informative"), t("pdf.interest_margin"), eur(report.interest.paid)],
    ["0588", t("casilla.double_taxation"),     eur(report.doubleTaxation.deduction)],
  ];

  // FX gains (Casillas 1626/1631) — only shown when multi-currency FX events exist
  if (report.fxGains.disposals.length > 0) {
    casillasBody.push(["1626", t("casilla.fx_transmission_value"), eur(report.fxGains.transmissionValue)]);
    casillasBody.push(["1631", t("casilla.fx_acquisition_value"),  eur(report.fxGains.acquisitionValue)]);
    casillasBody.push(["",     t("casilla.fx_net_gain_loss"),       eur(report.fxGains.netGainLoss)]);
  }

  // Blocked losses: informative only — Renta Web handles Art. 33.5.f per-disposal, no aggregate casilla
  if (report.capitalGains.blockedLosses.greaterThan(0)) {
    casillasBody.push([t("pdf.informative"), t("pdf.blocked_losses"), eur(report.capitalGains.blockedLosses)]);
  }

  autoTable(doc, {
    startY: MARGIN + 30,
    head: [[t("table.casilla"), t("table.concept"), t("table.amount_eur")]],
    body: casillasBody,
    theme: "striped",
    headStyles: { fillColor: C.headerBg, fontSize: 8, textColor: [255, 255, 255] as [number, number, number] },
    bodyStyles: { fontSize: 8, textColor: C.textRgb },
    alternateRowStyles: { fillColor: C.rowAlt },
    columnStyles: {
      0: { cellWidth: 22 },
      2: { cellWidth: 42, halign: "right" },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  // contentEndY tracks the real bottom of all rendered content across the whole document.
  // Sections using autoTable update it via lastTableY(); the warnings section updates it
  // directly from the manual-text cursor so the ECB footnote never overlaps either.
  let contentEndY = lastTableY(doc, MARGIN + 30);

  // --- Section 2: Operaciones ---
  if (report.capitalGains.disposals.length > 0) {
    const y2 = contentEndY + 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(C.header);
    doc.text(t("pdf.section_operations"), MARGIN, y2);

    const opsColors: [number, number, number][] = report.capitalGains.disposals.map((d) =>
      d.gainLossEur.greaterThanOrEqualTo(0) ? C.successRgb : C.dangerRgb,
    );

    const opsBody = report.capitalGains.disposals.map((d) => {
      const scenarioTag =
        d.optionScenario === "expiration" ? "EXP"
        : d.optionScenario === "exercise" ? "EJ"
        : d.optionScenario === "close" ? "CL"
        : null;
      const symbol = scenarioTag
        ? `${(d.underlyingSymbol ?? d.symbol).slice(0, 6)}${d.putCall ?? ""} [${scenarioTag}]`
        : d.symbol.slice(0, 12);
      const sign = d.gainLossEur.greaterThanOrEqualTo(0) ? "+" : "";
      return [
        d.isin,
        symbol,
        formatDate(d.acquireDate),
        formatDate(d.sellDate),
        d.quantity.toFixed(4),
        d.costBasisEur.toFixed(2),
        d.proceedsEur.toFixed(2),
        sign + d.gainLossEur.toFixed(2),
        d.sellEcbRate.toFixed(4),
      ];
    });

    autoTable(doc, {
      startY: y2 + 4,
      head: [[
        t("table.isin"), t("table.symbol"),
        t("table.buy_date"), t("table.sell_date"),
        t("table.units"), t("table.cost_eur"),
        t("table.proceeds_eur"), t("table.gain_loss_eur"), "ECB",
      ]],
      body: opsBody,
      theme: "striped",
      headStyles: { fillColor: C.headerBg, fontSize: 6.5, textColor: [255, 255, 255] as [number, number, number] },
      bodyStyles: { fontSize: 6.5, textColor: C.textRgb },
      alternateRowStyles: { fillColor: C.rowAlt },
      tableWidth: CONTENT_W,
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 20 },
        2: { cellWidth: 17 },
        3: { cellWidth: 17 },
        4: { cellWidth: 14, halign: "right" },
        5: { cellWidth: 22, halign: "right" },
        6: { cellWidth: 22, halign: "right" },
        7: { cellWidth: 20, halign: "right" },
        8: { cellWidth: 26, halign: "right" },
      },
      margin: { left: MARGIN, right: MARGIN },
      didParseCell: (data: CellHookData) => {
        if (data.section === "body" && data.column.index === 7) {
          data.cell.styles.textColor = opsColors[data.row.index] ?? C.textRgb;
        }
      },
    });

    contentEndY = lastTableY(doc, contentEndY);
  }

  // --- Section 3: Dividendos ---
  if (report.dividends.entries.length > 0) {
    const y3 = contentEndY + 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(C.header);
    doc.text(t("pdf.section_dividends"), MARGIN, y3);

    autoTable(doc, {
      startY: y3 + 4,
      head: [[
        t("table.date"), t("table.isin"), t("table.symbol"),
        t("table.gross_eur"), t("table.withholding_eur"), t("table.country"), "ECB",
      ]],
      body: report.dividends.entries.map((d) => [
        formatDate(d.payDate),
        d.isin,
        d.symbol.slice(0, 10),
        d.grossAmountEur.toFixed(2),
        d.withholdingTaxEur.toFixed(2),
        d.withholdingCountry,
        d.ecbRate.toFixed(4),
      ]),
      theme: "striped",
      headStyles: { fillColor: C.headerBg, fontSize: 7, textColor: [255, 255, 255] as [number, number, number] },
      bodyStyles: { fontSize: 7, textColor: C.textRgb },
      alternateRowStyles: { fillColor: C.rowAlt },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 6: { halign: "right" } },
      margin: { left: MARGIN, right: MARGIN },
    });

    contentEndY = lastTableY(doc, contentEndY);
  }

  // --- Section 4: Doble imposición ---
  const dtEntries = Object.entries(report.doubleTaxation.byCountry);
  if (dtEntries.length > 0) {
    const y4 = contentEndY + 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(C.header);
    doc.text(t("pdf.section_dt"), MARGIN, y4);

    autoTable(doc, {
      startY: y4 + 4,
      head: [[t("table.country"), t("pdf.dt_paid"), t("pdf.dt_allowed")]],
      body: dtEntries.map(([country, data]) => [
        country,
        data.taxPaid.toFixed(2) + " EUR",
        data.deductionAllowed.toFixed(2) + " EUR",
      ]),
      theme: "striped",
      headStyles: { fillColor: C.headerBg, fontSize: 8, textColor: [255, 255, 255] as [number, number, number] },
      bodyStyles: { fontSize: 8, textColor: C.textRgb },
      alternateRowStyles: { fillColor: C.rowAlt },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      margin: { left: MARGIN, right: MARGIN },
    });

    contentEndY = lastTableY(doc, contentEndY);
  }

  // --- Section 5: Messages (three-tier) ---
  const msgs = report.messages;
  if (msgs.length > 0) {
    const y5 = contentEndY + 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(C.header);
    doc.text(t("pdf.section_messages"), MARGIN, y5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    let wy = y5 + 6;

    const renderGroup = (items: typeof msgs, label: string, color: [number, number, number]) => {
      if (items.length === 0) return;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...color);
      if (wy + 8 > PAGE_H - MARGIN - 20) { doc.addPage(); wy = MARGIN + 10; }
      doc.text(label, MARGIN, wy);
      wy += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      for (const m of items) {
        doc.setTextColor(...color);
        const text = m.message + (m.hint ? ` → ${m.hint}` : "");
        const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
        const blockH = lines.length * 4;
        if (wy + blockH > PAGE_H - MARGIN - 20) { doc.addPage(); wy = MARGIN + 10; }
        doc.text(lines, MARGIN, wy);
        wy += blockH;
      }
      wy += 2;
    };

    const errors = msgs.filter((m) => m.severity === "error");
    const warnings = msgs.filter((m) => m.severity === "warning");
    const infos = msgs.filter((m) => m.severity === "info");

    renderGroup(errors, `⛔ ${errors.length} error(es)`, [220, 38, 38]);
    renderGroup(warnings, `⚠ ${warnings.length} aviso(s)`, [180, 120, 0]);
    renderGroup(infos, `ℹ ${infos.length} nota(s)`, [120, 120, 140]);

    contentEndY = wy;
  }

  // --- ECB footnote ---
  // Always render the footnote; add a page if the content leaves insufficient room.
  let footnoteY = contentEndY + 10;
  if (footnoteY > PAGE_H - MARGIN - 35) {
    doc.addPage();
    footnoteY = MARGIN + 10;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(C.muted);
  doc.text(t("pdf.ecb_note"), MARGIN, footnoteY, { maxWidth: CONTENT_W });

  // --- Page numbers (looped after all content) ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(C.muted);
    doc.text(`${i} / ${totalPages}`, PAGE_W / 2, PAGE_H - 8, { align: "center" });
  }

  // --- Footer disclaimer (last page) ---
  doc.setPage(totalPages);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(C.muted);
  doc.text(t("pdf.footer"), MARGIN, PAGE_H - MARGIN, { maxWidth: CONTENT_W, align: "center" });

  return doc.output("blob");
}
