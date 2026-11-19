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

/** Every value cell is a finite figure, and every cell but the Total adds up to the Total. */
function expectCellsAddUp(values: string[]) {
  const nums = values.map(parseCell);
  const total = nums[nums.length - 1]!;
  const parts = nums.slice(0, -1).reduce((a, b) => a.plus(b), new Decimal(0));
  // Each cell is rounded on its own, so the sum can be a cent off.
  expect(parts.minus(total).abs().lessThanOrEqualTo("0.01")).toBe(true);
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
