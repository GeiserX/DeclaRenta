// @vitest-environment jsdom
/**
 * The results page of the three FX methods on the real engine (#434), with
 * the IBKR cycle fixture (manual USD conversions) and real 2025 ECB rates:
 *
 * - the «Acciones / Divisa / Total» strip shows what generateTaxReport gives
 *   for the method on screen;
 * - the comparison box shows the three real results, distinct per method;
 * - under «Tradicional con divisa» the method notes render in «Cómo se ha
 *   calculado» and the risk line is the only warning.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { renderHowCalculated, renderResultsSplit, renderMethodCompare, bindMethodCompare } from "../../src/web/method-summary.js";
import { renderCasillaCards } from "../../src/web/casilla-detail.js";
import { localizeMessage } from "../../src/i18n/index.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { FxMethod, TaxSummary } from "../../src/types/tax.js";
import { ECB_USD_2025_JAN_SEP } from "../integration/ecb-usd-2025.js";

const rates: EcbRateMap = new Map(Object.entries(ECB_USD_2025_JAN_SEP).map(([d, r]) => [d, new Map([["USD", r]])]));
const statement = finalizeMergedStatement(
  mergeStatement(
    createEmptyStatement(),
    parseIbkrFlexXml(readFileSync(resolve(__dirname, "../fixtures/ibkr-434-cycle-2025.xml"), "utf-8")),
  ),
);
const run = (m: FxMethod): TaxSummary => generateTaxReport(statement, rates, 2025, reportOptionsForMethod(m));

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("results page on the real engine, cycle fixture", () => {
  it("the strip shows the engine's «Tradicional con divisa» figures", () => {
    const report = run("tradicional-divisa");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("240.38");
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("-57.36");
    const root = document.createElement("div");
    root.innerHTML = renderResultsSplit(report, "tradicional-divisa");
    expect([...root.querySelectorAll(".split-value")].map(text)).toEqual(["+240,38 €", "−57,36 €", "+183,02 €"]);
  });

  it("the comparison box shows the three real results", async () => {
    const report = run("tradicional-divisa");
    const root = document.createElement("div");
    root.innerHTML = renderMethodCompare();
    const calls: FxMethod[] = [];
    bindMethodCompare(root, { method: "tradicional-divisa", report }, (m) => {
      calls.push(m);
      return run(m);
    });
    const details = root.querySelector<HTMLDetailsElement>("#method-compare")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual(["multidivisa", "monodivisa"]);
    const rows = [...root.querySelectorAll(".method-compare-table tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map(text),
    );
    // Columns: Criterio DGT, Tradicional con divisa, Tradicional sin divisa. The
    // total is rounded from the unrounded parts, so it can be a cent off the
    // sum of the two rounded rows above it (437,48 − 267,59 shows as 169,90).
    expect(rows[0]).toEqual(["+437,48", "+240,38", "+240,38"]);
    expect(rows[1]).toEqual(["−267,59", "−57,36", "0,00"]);
    expect(rows[2]).toEqual(["+169,90", "+183,02", "+240,38"]);
  });

  it("method notes go to «Cómo se ha calculado»; the risk line is the only warning", () => {
    const report = run("tradicional-divisa");
    const how = document.createElement("div");
    how.innerHTML = renderHowCalculated(report, "tradicional-divisa");
    const method = report.messages.find((m) => m.id === "report.fx_traditional_method")!;
    expect(method.severity).toBe("info");
    expect(text(how.querySelector(".how-notes"))).toContain(localizeMessage(method));

    const cards = document.createElement("div");
    renderCasillaCards(cards, report);
    const warnings = report.messages.filter((m) => m.severity === "warning");
    expect(warnings.map((m) => m.id)).toEqual(["report.fx_traditional_risk"]);
    expect(cards.querySelectorAll(".msg-warning li")).toHaveLength(1);
    expect(text(cards.querySelector(".msg-warning li"))).toContain(localizeMessage(warnings[0]!));
    // The method notes are not repeated in the info list under the casillas.
    expect(text(cards.querySelector(".msg-info"))).not.toContain(localizeMessage(method));
  });
});
