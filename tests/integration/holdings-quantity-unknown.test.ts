// @vitest-environment jsdom
/**
 * Issue #470: a holding whose quantity the export does not give
 * (`quantityUnknown`, quantity "0") is never written as 0 units or 0 € in the
 * 721, the 720 or the D-6.
 *
 * IBKR can export an Open Positions row with `position=""`. The parser keeps
 * it with quantity "0" and the flag. Up to 0.66.14 the 721 showed 0 units, a
 * row with no value either left the 721 and the 720 totals as if worth 0 € (so
 * the verdict said "not obliged"), and the 720 file wrote 0 in «Número de
 * valores». Every case runs through the real IBKR parser.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { buildModelo721Entries } from "../../src/generators/modelo721.js";
import { checkModelo720Thresholds, findModelo720Omissions, generateModelo720 } from "../../src/generators/modelo720.js";
import { generateD6Report } from "../../src/generators/d6.js";
import { renderSection721 } from "../../src/web/section-721.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSectionD6 } from "../../src/web/section-d6.js";
import { hasNoMarketValue } from "../../src/engine/ecb.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const rateMap: EcbRateMap = new Map();
for (const d of ["2025-10-01", "2025-10-15", "2025-11-03", "2025-11-17", "2025-12-01", "2025-12-15", "2025-12-31"]) {
  rateMap.set(d, new Map([["USD", "0.85"]]));
}

function flex(positions: string): Statement {
  return parseIbkrFlexXml(`<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Q" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
<Trades /><CashTransactions /><CorporateActions />
<OpenPositions>${positions}</OpenPositions>
<SecuritiesInfo />
</FlexStatement></FlexStatements></FlexQueryResponse>`);
}

/** An IBKR crypto row: `position` null = attribute blank, `value` null = no positionValue. */
function coin(symbol: string, description: string, position: string, value: string | null): string {
  return `<OpenPosition accountId="U1234567" symbol="${symbol}" description="${description}" isin="" currency="USD" assetCategory="CRYPTO" position="${position}" markPrice="100000"${value === null ? "" : ` positionValue="${value}"`} costBasisMoney="40000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

function stock(position: string, value: string | null, isin = "US0000000001"): string {
  return `<OpenPosition accountId="U1234567" symbol="ACME" description="ACME CORP" isin="${isin}" currency="USD" assetCategory="STK" position="${position}" markPrice="100"${value === null ? "" : ` positionValue="${value}"`} costBasisMoney="50000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

const cfg720 = { nif: "12345678Z", surname: "PEREZ", name: "JUAN", year: 2025, phone: "600000000", contactName: "JUAN PEREZ", declarationId: "7200000000001", isComplementary: false, isReplacement: false };

function useProfile(container: string): void {
  const profile = JSON.stringify({ year: 2025 });
  vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "declarenta_profile" ? profile : null) });
  document.body.innerHTML = `<div id="${container}"></div>`;
}

function rows(container: string): string[] {
  return [...document.querySelectorAll(`#${container} tbody tr`)].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()).join(" | "));
}

describe("#470 hasNoMarketValue", () => {
  it("an unknown quantity with no value is unvalued; with a value it is valued; an explicit 0 is no holding", () => {
    expect(hasNoMarketValue({ quantity: "0", positionValue: "0", quantityUnknown: true })).toBe(true);
    expect(hasNoMarketValue({ quantity: "0", positionValue: "60000", quantityUnknown: true })).toBe(false);
    expect(hasNoMarketValue({ quantity: "0", positionValue: "0" })).toBe(false);
    expect(hasNoMarketValue({ quantity: "0.6", positionValue: "0" })).toBe(true);
  });
});

describe("#470 Modelo 721: an IBKR coin with no readable quantity", () => {
  beforeEach(() => { useProfile("m721-content"); });

  it("value known: the entry carries quantityUnknown and the section shows «—» units with a banner naming the coin", () => {
    const st = flex(coin("BTC", "BITCOIN", "", "60000"));
    const v = buildModelo721Entries(st.openPositions, rateMap, "2025-12-31");
    expect(v.positions.map((p) => [p.entry.assetId, p.entry.quantityUnknown, p.valuationEur?.toString()])).toEqual([["BTC", true, "51000"]]);
    expect(v.unvaluedCount).toBe(0);

    renderSection721(st, rateMap);
    expect(rows("m721-content")).toEqual(["BITCOIN | — | — | 51.000,00"]);
    const banner = document.querySelector("#m721-content .m721-quantity-unknown")?.textContent ?? "";
    expect(banner).toContain("BTC");
    expect(banner).toContain("No son 0");
  });

  it("value missing too: unvalued, kept in the table, and the verdict is «No se puede determinar», not «No estás obligado»", () => {
    const st = flex(coin("BTC", "BITCOIN", "", null) + coin("ETH", "ETHER", "10", "30000"));
    const v = buildModelo721Entries(st.openPositions, rateMap, "2025-12-31");
    expect(v.unvaluedCount).toBe(1);
    expect(v.totalValueEur.toString()).toBe("25500");

    renderSection721(st, rateMap);
    expect(rows("m721-content")).toEqual(["BITCOIN | — | — | —", "ETHER | — | 10 | 25.500,00"]);
    const text = document.getElementById("m721-content")!.textContent;
    expect(text).toContain("No se puede determinar");
    expect(text).not.toContain("No estás obligado");
  });

  it("control: a readable quantity shows its units and no unknown-units banner", () => {
    renderSection721(flex(coin("BTC", "BITCOIN", "0.6", "60000")), rateMap);
    expect(rows("m721-content")).toEqual(["BITCOIN | — | 0,6 | 51.000,00"]);
    expect(document.querySelector("#m721-content .m721-quantity-unknown")).toBeNull();
  });

  it("the IBKR warning for a coin names the 721 and units, and never claims the 720 covers it", () => {
    const msgs = flex(coin("BTC", "BITCOIN", "", "60000")).parserMessages ?? [];
    expect(msgs.map((m) => m.id)).toEqual(["parser.crypto_position_quantity_unknown"]);
    expect(msgs[0]!.message).toContain("unidades");
    expect(msgs[0]!.hint).toContain("Modelo 721");
    expect(msgs[0]!.hint).not.toContain("720");
  });

  it("a stock and a coin with no quantity get one warning each", () => {
    const msgs = flex(coin("BTC", "BITCOIN", "", "60000") + stock("", "70000")).parserMessages ?? [];
    expect(msgs.map((m) => m.id).sort()).toEqual(["parser.crypto_position_quantity_unknown", "parser.open_position_quantity_unknown"]);
    const shares = msgs.find((m) => m.id === "parser.open_position_quantity_unknown")!;
    expect(shares.context?.holdings).toBe("ACME (US0000000001)");
    expect(shares.hint).not.toContain("con 0 en");
  });
});

describe("#470 Modelo 720: an IBKR stock with no readable quantity", () => {
  it("value missing: counted unvalued in the thresholds, never 0 € (control: position 700)", () => {
    expect(checkModelo720Thresholds(flex(stock("", null)).openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 1, exceeds: false });
    expect(checkModelo720Thresholds(flex(stock("700", null)).openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 1, exceeds: false });
  });

  it("value known: counts toward the threshold, but the file writes no record with 0 «Número de valores»; it is listed for manual entry", () => {
    const st = flex(stock("", "70000"));
    expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values.exceeds).toBe(true);
    expect(generateModelo720(st.openPositions, rateMap, cfg720)).toBe("");
    const omissions = findModelo720Omissions(st.openPositions, rateMap, { year: 2025 });
    expect(omissions.map((o) => (o.kind === "position" ? [o.reason, o.position.isin] : [o.kind]))).toEqual([["quantity_unknown", "US0000000001"]]);
  });

  it("control: position 700 writes the record with 700 shares", () => {
    const out = generateModelo720(flex(stock("700", "70000")).openPositions, rateMap, cfg720);
    const detail = out.split("\n")[1] ?? "";
    expect(detail.slice(462, 474)).toBe("000000070000");
    expect(findModelo720Omissions(flex(stock("700", "70000")).openPositions, rateMap, { year: 2025 })).toEqual([]);
  });

  it("next to a readable holding, only the readable one is written", () => {
    const st = flex(stock("", "70000") + stock("10", "1000", "US0000000002"));
    const detail = generateModelo720(st.openPositions, rateMap, cfg720).split("\n").slice(1);
    expect(detail).toHaveLength(1);
    expect(detail[0]!).toContain("US0000000002");
  });

  it("the web table shows «—» and the unvalued banner for a holding with no value (control: position 700)", () => {
    for (const position of ["", "700"]) {
      useProfile("m720-content");
      renderSection720(flex(stock(position, null)), rateMap);
      const acme = rows("m720-content").find((r) => r.includes("US0000000001"));
      expect(acme?.split(" | ").at(-1)).toBe("—");
      expect(document.getElementById("m720-content")!.textContent).toContain("no se han podido valorar");
    }
  });

  it("the web section lists a valued holding with no quantity for manual entry", () => {
    useProfile("m720-content");
    renderSection720(flex(stock("", "70000")), rateMap);
    expect(document.getElementById("m720-content")!.textContent).toContain("el archivo no da su número de valores");
  });
});

describe("#470 D-6: an IBKR stock with no readable quantity", () => {
  it("the generator writes no position with 0 shares and counts it to declare by hand", () => {
    const r = generateD6Report(flex(stock("", "70000")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect(r.positions).toEqual([]);
    expect(r.unvaluedCount).toBe(1);
    // A short one (negative value) is no holding.
    expect(generateD6Report(flex(stock("", "-70000")).openPositions, rateMap, 2025, "X", "12345678Z").unvaluedCount).toBe(0);
  });

  it("the web section lists it with «—» shares and a banner naming it (control: position 700)", () => {
    useProfile("d6-content");
    renderSectionD6(flex(stock("", "70000")), rateMap);
    expect(rows("d6-content")).toEqual(["US0000000001 | ACME CORP | US | — | 59.500,00"]);
    expect(document.querySelector("#d6-content .d6-quantity-unknown")?.textContent).toContain("ACME (US0000000001)");
    expect([...document.querySelectorAll("#d6-content .aforix-field-value")].map((e) => e.textContent)).not.toContain("0");

    useProfile("d6-content");
    renderSectionD6(flex(stock("700", "70000")), rateMap);
    expect(rows("d6-content")).toEqual(["US0000000001 | ACME CORP | US | 700 | 59.500,00"]);
    expect(document.querySelector("#d6-content .d6-quantity-unknown")).toBeNull();
  });
});
