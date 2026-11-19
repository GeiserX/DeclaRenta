// @vitest-environment jsdom
/**
 * The «Total» of the results strip and of «Comparar con los otros métodos»
 * says it goes «a la base del ahorro» and sits next to the estimated cuota, so
 * it must be the same Decimal figure the cuota uses: savingsBalances().gains,
 * which adds the losses the anti-churning rule blocks (art. 33.5.f/g LIRPF)
 * and subtracts the deferred losses released this year (issue #471).
 *
 * «Acciones» keeps the raw 0328 − 0331 figure its subtitle names, and the
 * deferral (blocked − released) shows as its own cell and row, so the cells
 * add up to the Total.
 *
 * Real path: IBKR Flex XML → parseIbkrFlexXml → merge → generateTaxReport →
 * renderResultsSplit / bindMethodCompare, under the three FX methods.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Decimal from "decimal.js";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { renderResultsSplit, renderMethodCompare, bindMethodCompare, methodTotals } from "../../src/web/method-summary.js";
import { savingsBalances } from "../../src/engine/taxable-base.js";
import { combinedNetGainLoss, computeCasillaBlocksWithFx } from "../../src/generators/casillas.js";
import { t } from "../../src/i18n/index.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { FxMethod, TaxSummary } from "../../src/types/tax.js";
import { ECB_USD_2025_JAN_SEP } from "../integration/ecb-usd-2025.js";

const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];
const rates: EcbRateMap = new Map(Object.entries(ECB_USD_2025_JAN_SEP).map(([d, r]) => [d, new Map([["USD", r]])]));
const load = (name: string) =>
  finalizeMergedStatement(
    mergeStatement(createEmptyStatement(), parseIbkrFlexXml(readFileSync(resolve(__dirname, `../fixtures/${name}`), "utf-8"))),
  );
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** "+1.234,56 €" / "−500,00" → Decimal, failing on anything not a finite figure (no NaN, no Infinity). */
function parseCell(s: string): Decimal {
  const m = /^([+−]?)([\d.]+,\d{2})( €)?$/.exec(s);
  if (!m) throw new Error(`not a finite money figure: "${s}"`);
  const d = new Decimal(m[2]!.replace(/\./g, "").replace(",", "."));
  return m[1] === "−" ? d.neg() : d;
}

function strip(report: TaxSummary, method: FxMethod | null) {
  const root = document.createElement("div");
  root.innerHTML = renderResultsSplit(report, method);
  const cells = [...root.querySelectorAll(".split-cell")].map((c) => ({
    label: text(c.querySelector(".split-label")),
    value: text(c.querySelector(".split-value")),
    sub: text(c.querySelector(".split-sub")),
  }));
  return { root, cells };
}

/** Every value cell is a finite figure, and the printed cells but the Total add up to the printed Total, to the cent. */
function expectCellsAddUp(values: string[]) {
  const nums = values.map(parseCell);
  const total = nums[nums.length - 1]!;
  const parts = nums.slice(0, -1).reduce((a, b) => a.plus(b), new Decimal(0));
  expect(parts.toFixed(2)).toBe(total.toFixed(2));
}

async function compareRows(statementName: string, current: FxMethod) {
  const st = load(statementName);
  const run = (m: FxMethod) => generateTaxReport(st, rates, 2025, reportOptionsForMethod(m));
  const root = document.createElement("div");
  root.innerHTML = renderMethodCompare();
  bindMethodCompare(root, { method: current, report: run(current) }, run);
  const details = root.querySelector<HTMLDetailsElement>("#method-compare")!;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  await new Promise((r) => setTimeout(r, 5));
  return [...root.querySelectorAll(".method-compare-table tbody tr")].map((tr) => ({
    label: text(tr.querySelector("th")),
    cells: [...tr.querySelectorAll("td")].map(text),
  }));
}

describe("results strip Total = the base the cuota uses (#471)", () => {
  it("EUR upload: a 1.000 € loss blocked by a buy-back, a 500 € gain → Total +500, cuota 95", () => {
    const report = generateTaxReport(load("ibkr-471-blocked-eur-2025.xml"), rates, 2025);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("-500.00");
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("1000.00");
    const totals = methodTotals(report);
    expect(totals.total.toFixed(2)).toBe(savingsBalances(report).gains.toFixed(2));
    expect(totals.total.toFixed(2)).toBe("500.00");
    expect(totals.securities.toFixed(2)).toBe("-500.00");
    expect(totals.deferred.toFixed(2)).toBe("1000.00");
    expect(totals.tax.toFixed(2)).toBe("95.00");

    const { cells } = strip(report, null);
    expect(cells.map((c) => c.label)).toEqual([t("results.split_shares"), t("results.split_deferred"), t("results.split_total")]);
    expect(cells.map((c) => c.value)).toEqual(["−500,00 €", "+1.000,00 €", "+500,00 €"]);
    expect(cells[0]!.sub).toBe(t("results.split_shares_sub"));
    expect(cells[2]!.sub).toBe(t("results.split_total_sub", { tax: "95,00" }).replace(/\s+/g, " "));
    expectCellsAddUp(cells.map((c) => c.value));
  });

  it("EUR release: a 1.000 € loss blocked in 2024 is integrated in 2025 by a +500 € sale → Total −500", () => {
    const report = generateTaxReport(load("ibkr-471-release-eur-2025.xml"), rates, 2025);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("500.00");
    expect(report.capitalGains.reintegratedLosses.toFixed(2)).toBe("1000.00");
    const totals = methodTotals(report);
    expect(totals.total.toFixed(2)).toBe(savingsBalances(report).gains.toFixed(2));
    expect(totals.total.toFixed(2)).toBe("-500.00");
    expect(totals.deferred.toFixed(2)).toBe("-1000.00");
    expect(totals.tax.toFixed(2)).toBe("0.00");

    const { cells } = strip(report, null);
    expect(cells.map((c) => c.value)).toEqual(["+500,00 €", "−1.000,00 €", "−500,00 €"]);
    expectCellsAddUp(cells.map((c) => c.value));
  });

  it("same-year block and release: the deferral is 0 and its subtitle does not say «de años anteriores»", () => {
    const report = generateTaxReport(load("ibkr-471-same-year-eur-2025.xml"), rates, 2025);
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("1000.00");
    expect(report.capitalGains.reintegratedLosses.toFixed(2)).toBe("1000.00");
    const totals = methodTotals(report);
    expect(totals.hasDeferred).toBe(true);
    expect(totals.total.toFixed(2)).toBe("-700.00");

    const { cells } = strip(report, null);
    expect(cells.map((c) => c.value)).toEqual(["−700,00 €", "0,00 €", "−700,00 €"]);
    expect(cells[1]!.sub).toBe(t("results.split_deferred_sub"));
    expect(cells[1]!.sub).not.toMatch(/anteriores/);
    expectCellsAddUp(cells.map((c) => c.value));
  });

  it("USD upload under multidivisa: the printed deferral is the Total minus the other printed cells (−432,00 + 0,00 + 864,00 = 432,00)", () => {
    const report = generateTaxReport(load("ibkr-471-blocked-usd-2025.xml"), rates, 2025, reportOptionsForMethod("multidivisa"));
    // Each figure on its own rounds to −432,00, 864,01 and 432,00: printed as is, the cells would be a cent off.
    expect(report.capitalGains.blockedLosses.toDecimalPlaces(2).toFixed(2)).toBe("864.01");
    const { cells } = strip(report, "multidivisa");
    expect(cells.map((c) => c.value)).toEqual(["−432,00 €", "0,00 €", "+864,00 €", "+432,00 €"]);
  });

  for (const m of METHODS) {
    it(`USD upload under ${m}: the strip Total matches savingsBalances and the cells add up`, () => {
      const report = generateTaxReport(load("ibkr-471-blocked-usd-2025.xml"), rates, 2025, reportOptionsForMethod(m));
      expect(report.capitalGains.blockedLosses.greaterThan(0)).toBe(true);
      const totals = methodTotals(report);
      const base = savingsBalances(report).gains;
      expect(totals.total.toFixed(2)).toBe(base.toFixed(2));
      // «Acciones» stays the raw 0328 − 0331 figure (the FX part of 1633/1637 is the «Divisa» cell).
      expect(totals.securities.toFixed(2)).toBe(
        combinedNetGainLoss(computeCasillaBlocksWithFx(report)).minus(report.fxGains.netGainLoss).toFixed(2),
      );
      expect(totals.deferred.toFixed(2)).toBe(report.capitalGains.blockedLosses.minus(report.capitalGains.reintegratedLosses).toFixed(2));
      // The printed deferral is within rounding of the exact one.
      expect(totals.deferredShown.minus(totals.deferred).abs().lessThanOrEqualTo("0.02")).toBe(true);
      // The deferral moves the Total away from the raw net, by exactly the blocked loss.
      expect(totals.total.toFixed(2)).toBe(report.capitalGains.netGainLoss.plus(report.capitalGains.blockedLosses).plus(report.fxGains.netGainLoss).toFixed(2));
      expect(totals.total.minus(totals.securities.plus(totals.fx)).toFixed(2)).toBe(report.capitalGains.blockedLosses.toFixed(2));

      const { cells, root } = strip(report, m);
      expect(cells.map((c) => c.label)).toEqual([
        t("results.split_shares"),
        t("results.split_fx"),
        t("results.split_deferred"),
        t("results.split_total"),
      ]);
      expect(root.querySelector(".results-split-four")).not.toBeNull();
      expect(parseCell(cells[3]!.value).toFixed(2)).toBe(base.toDecimalPlaces(2).toFixed(2));
      expectCellsAddUp(cells.map((c) => c.value));
    });
  }

  it("the comparison table has a deferral row and every column adds up to its Total", async () => {
    const rows = await compareRows("ibkr-471-blocked-usd-2025.xml", "multidivisa");
    expect(rows.map((r) => r.label)).toEqual([
      t("results.split_shares"),
      t("results.split_fx"),
      t("results.split_deferred"),
      t("results.split_total"),
      t("results.compare_tax"),
    ]);
    const st = load("ibkr-471-blocked-usd-2025.xml");
    METHODS.forEach((m, col) => {
      const report = generateTaxReport(st, rates, 2025, reportOptionsForMethod(m));
      const column = rows.slice(0, 4).map((r) => r.cells[col]!);
      expectCellsAddUp(column);
      expect(parseCell(column[3]!).toFixed(2)).toBe(savingsBalances(report).gains.toDecimalPlaces(2).toFixed(2));
      expect(parseCell(rows[4]!.cells[col]!).toFixed(2)).toBe(methodTotals(report).tax.toFixed(2));
    });
  });

  it("the comparison table on the release upload shows the negative deferral and Total", async () => {
    const rows = await compareRows("ibkr-471-release-eur-2025.xml", "multidivisa");
    const byLabel = new Map(rows.map((r) => [r.label, r.cells]));
    expect(byLabel.get(t("results.split_deferred"))).toEqual(["−1.000,00", "−1.000,00", "−1.000,00"]);
    expect(byLabel.get(t("results.split_total"))).toEqual(["−500,00", "−500,00", "−500,00"]);
  });

  it("a non-finite amount prints «—» for every figure and the cuota, never a finite Total (fail-safe)", async () => {
    // generateTaxReport replaces a non-finite total with 0 and says so
    // (`report.non_finite_total`); the disposal itself keeps the NaN. The Total
    // and the cuota then read a zeroed leg, so they must not print a figure.
    const good = generateTaxReport(load("ibkr-471-blocked-eur-2025.xml"), rates, 2025);
    const [first, ...rest] = good.capitalGains.disposals;
    const poisoned: TaxSummary = {
      ...good,
      capitalGains: {
        ...good.capitalGains,
        disposals: [{ ...first!, costBasisEur: new Decimal(NaN), gainLossEur: new Decimal(NaN) }, ...rest],
        acquisitionValue: new Decimal(0),
      },
      messages: [...good.messages, { id: "report.non_finite_total", severity: "error", message: "x", context: { field: "acquisitionValue" } }],
    };
    // Without the guard the Total would be a finite figure here.
    expect(savingsBalances(poisoned).gains.isFinite()).toBe(true);
    const totals = methodTotals(poisoned);
    expect(totals.unreadable).toBe(true);
    const { cells, root } = strip(poisoned, "multidivisa");
    expect(cells.length).toBeGreaterThanOrEqual(3);
    for (const c of cells) expect(c.value).toBe("—");
    expect(cells[cells.length - 1]!.sub).toBe(t("results.split_unreadable_sub"));
    expect(text(root)).not.toMatch(/NaN|\d,\d\d/);

    // Only the message (every disposal finite): still unreadable, the guard zeroed a leg.
    const flagged: TaxSummary = { ...good, messages: poisoned.messages };
    expect(methodTotals(flagged).unreadable).toBe(true);
    expect(strip(flagged, null).cells.every((c) => c.value === "—")).toBe(true);

    // The comparison table prints «—» in the column of an unreadable report.
    const root2 = document.createElement("div");
    root2.innerHTML = renderMethodCompare();
    bindMethodCompare(root2, { method: "multidivisa", report: poisoned }, (m) => generateTaxReport(load("ibkr-471-blocked-eur-2025.xml"), rates, 2025, reportOptionsForMethod(m)));
    const details = root2.querySelector<HTMLDetailsElement>("#method-compare")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await new Promise((r) => setTimeout(r, 5));
    const rows = [...root2.querySelectorAll(".method-compare-table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map(text));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r[0]).toBe("—");
      expect(r[1]).not.toBe("—");
    }
  });

  it("with no deferral, half-cent securities and FX (1,004 + 1,004) print a Total that is their printed sum, 2,00, and no extra cell", async () => {
    // One disposal of +1,004 € and +1,004 € of FX: the exact base is 2,008 €.
    // Printed on its own it would round to 2,01 next to 1,00 + 1,00 (CodeRabbit
    // on #471). With no deferral cell to take the cent, the Total is the sum of
    // the printed cells: 2,00, within a cent of the base; the cuota still reads
    // the exact base.
    const real = generateTaxReport(load("ibkr-434-cycle-2025.xml"), rates, 2025, reportOptionsForMethod("multidivisa"));
    const d = real.capitalGains.disposals.find((x) => x.gainLossEur.isFinite())!;
    const half = new Decimal("1.004");
    const report: TaxSummary = {
      ...real,
      capitalGains: {
        ...real.capitalGains,
        disposals: [{ ...d, proceedsEur: d.costBasisEur.plus(half), gainLossEur: half }],
        netGainLoss: half,
        blockedLosses: new Decimal(0),
        reintegratedLosses: new Decimal(0),
      },
      fxGains: { ...real.fxGains, netGainLoss: half },
    };
    expect(savingsBalances(report).gains.toFixed(3)).toBe("2.008");
    const { cells } = strip(report, "multidivisa");
    expect(cells.map((c) => c.label)).not.toContain(t("results.split_deferred"));
    expect(cells.map((c) => c.value)).toEqual(["+1,00 €", "+1,00 €", "+2,00 €"]);
    expectCellsAddUp(cells.map((c) => c.value));
    // The printed Total stays within a cent of the base the cuota uses.
    expect(parseCell(cells[2]!.value).minus(savingsBalances(report).gains).abs().lessThanOrEqualTo("0.01")).toBe(true);

    // The comparison table: the same rule in every column, and no deferral row.
    const root = document.createElement("div");
    root.innerHTML = renderMethodCompare();
    bindMethodCompare(root, { method: "multidivisa", report }, () => report);
    const details = root.querySelector<HTMLDetailsElement>("#method-compare")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await new Promise((r) => setTimeout(r, 5));
    const rows = [...root.querySelectorAll(".method-compare-table tbody tr")].map((tr) => ({
      label: text(tr.querySelector("th")),
      cells: [...tr.querySelectorAll("td")].map(text),
    }));
    expect(rows.map((r) => r.label)).not.toContain(t("results.split_deferred"));
    expect(rows[2]!.label).toBe(t("results.split_total"));
    for (let col = 0; col < 3; col++) expectCellsAddUp(rows.slice(0, 3).map((r) => r.cells[col]!));
  });

  it("a method with no deferral shows 0,00 in the comparison's deferral row, never a rounding cent", async () => {
    // The deferral row shows when any method has one; a method without a
    // deferral must not print the rounding residue there as a deferred loss.
    const blocked = generateTaxReport(load("ibkr-471-blocked-eur-2025.xml"), rates, 2025, reportOptionsForMethod("multidivisa"));
    const real = generateTaxReport(load("ibkr-434-cycle-2025.xml"), rates, 2025, reportOptionsForMethod("multidivisa"));
    const d = real.capitalGains.disposals.find((x) => x.gainLossEur.isFinite())!;
    const half = new Decimal("1.004");
    const noDeferral: TaxSummary = {
      ...real,
      capitalGains: {
        ...real.capitalGains,
        disposals: [{ ...d, proceedsEur: d.costBasisEur.plus(half), gainLossEur: half }],
        netGainLoss: half,
        blockedLosses: new Decimal(0),
        reintegratedLosses: new Decimal(0),
      },
      fxGains: { ...real.fxGains, netGainLoss: half },
    };
    const root = document.createElement("div");
    root.innerHTML = renderMethodCompare();
    bindMethodCompare(root, { method: "multidivisa", report: blocked }, () => noDeferral);
    const details = root.querySelector<HTMLDetailsElement>("#method-compare")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await new Promise((r) => setTimeout(r, 5));
    const byLabel = new Map([...root.querySelectorAll(".method-compare-table tbody tr")].map((tr) => [text(tr.querySelector("th")), [...tr.querySelectorAll("td")].map(text)]));
    const col = METHODS.indexOf("tradicional-divisa");
    expect(byLabel.get(t("results.split_deferred"))![col]).toBe("0,00");
    expect(byLabel.get(t("results.split_total"))![col]).toBe("+2,00");
  });

  it("with no blocked or released loss the strip and the table have no deferral cell", async () => {
    const report = generateTaxReport(load("ibkr-434-cycle-2025.xml"), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(report.capitalGains.blockedLosses.isZero()).toBe(true);
    expect(report.capitalGains.reintegratedLosses.isZero()).toBe(true);
    const { cells, root } = strip(report, "multidivisa");
    expect(cells).toHaveLength(3);
    expect(root.querySelector(".results-split-four")).toBeNull();
    expect(text(root)).not.toContain(t("results.split_deferred"));
    const rows = await compareRows("ibkr-434-cycle-2025.xml", "multidivisa");
    expect(rows.map((r) => r.label)).not.toContain(t("results.split_deferred"));
  });
});
