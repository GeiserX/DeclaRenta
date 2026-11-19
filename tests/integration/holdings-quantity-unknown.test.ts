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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { localizeHint, localizeMessage, setLocale } from "../../src/i18n/index.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { buildModelo721Entries } from "../../src/generators/modelo721.js";
import { checkModelo720Thresholds, findModelo720Omissions, generateModelo720 } from "../../src/generators/modelo720.js";
import { generateD6Report } from "../../src/generators/d6.js";
import { renderSection721 } from "../../src/web/section-721.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSectionD6 } from "../../src/web/section-d6.js";
import { hasNoMarketValue, holdsNothing, isNegativePositionValue, isShortPosition, positionValueOf } from "../../src/engine/ecb.js";
import { findMissingHoldings } from "../../src/web/missing-holdings.js";
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

describe("#470 D-6: an IBKR stock with neither a readable quantity nor a readable value", () => {
  // Both blank, or a value written as text: the D-6 must count it to declare
  // by hand and keep every other holding, never crash (review of #470).
  for (const value of ["", "N/A"]) {
    it(`position="" positionValue="${value}": the generator counts it unvalued and keeps the other holding`, () => {
      const st = flex(stock("", value) + stock("700", "70000", "US0000000002"));
      const r = generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z");
      expect(r.positions.map((p) => [p.isin, p.sharesAtYearEnd])).toEqual([["US0000000002", "700"]]);
      expect(r.unvaluedCount).toBe(1);
    });

    it(`position="" positionValue="${value}": the web section shows «—» shares and «—» value next to the other holding`, () => {
      useProfile("d6-content");
      renderSectionD6(flex(stock("", value) + stock("700", "70000", "US0000000002")), rateMap);
      expect(rows("d6-content")).toEqual([
        "US0000000001 | ACME CORP | US | — | —",
        "US0000000002 | ACME CORP | US | 700 | 59.500,00",
      ]);
      expect(document.querySelector("#d6-content .d6-quantity-unknown")?.textContent).toContain("ACME (US0000000001)");
    });
  }

  it("hasNoMarketValue reads an unreadable value as no value, and isNegativePositionValue proves no short from it", () => {
    expect(hasNoMarketValue({ quantity: "0", positionValue: "", quantityUnknown: true })).toBe(true);
    expect(hasNoMarketValue({ quantity: "0", positionValue: "N/A", quantityUnknown: true })).toBe(true);
    expect(hasNoMarketValue({ quantity: "5", positionValue: "N/A" })).toBe(true);
    expect(isNegativePositionValue("")).toBe(false);
    expect(isNegativePositionValue("N/A")).toBe(false);
    expect(isNegativePositionValue("-1")).toBe(true);
  });
});

describe("#470 an IBKR position of 0 next to a value that is not 0", () => {
  it("the parser flags the 0 as unknown and warns, for shares and for crypto (control: 0 with value 0 is no flag)", () => {
    const st = flex(stock("0", "70000") + coin("BTC", "BITCOIN", "0", "60000") + stock("0", "0", "US0000000003"));
    expect(st.openPositions.map((p) => [p.symbol, p.quantity, p.quantityUnknown ?? false])).toEqual([
      ["ACME", "0", true],
      ["BTC", "0", true],
      ["ACME", "0", false],
    ]);
    expect((st.parserMessages ?? []).map((m) => m.id).sort()).toEqual(["parser.crypto_position_zero_with_value", "parser.open_position_zero_with_value"]);
  });

  it("the 720 writes no record with 0 shares and lists it for manual entry", () => {
    const st = flex(stock("0", "70000"));
    expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values.exceeds).toBe(true);
    expect(generateModelo720(st.openPositions, rateMap, cfg720)).toBe("");
    expect(findModelo720Omissions(st.openPositions, rateMap, { year: 2025 }).map((o) => (o.kind === "position" ? o.reason : o.kind))).toEqual(["quantity_unknown"]);
  });

  it("the web 721 shows «—» units, never 0", () => {
    useProfile("m721-content");
    renderSection721(flex(coin("BTC", "BITCOIN", "0", "60000")), rateMap);
    expect(rows("m721-content")).toEqual(["BITCOIN | — | — | 51.000,00"]);
  });

  it("the D-6 counts it to declare by hand instead of dropping it", () => {
    const r = generateD6Report(flex(stock("0", "70000")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect(r.positions).toEqual([]);
    expect(r.unvaluedCount).toBe(1);
  });
});

describe("#470 an IBKR position of 0 units worth 0 holds nothing", () => {
  it("the 720 writes no phantom record with 0 shares and 0 € next to a real holding", () => {
    const st = flex(stock("0", "0") + stock("700", "70000", "US0000000002"));
    const detail = generateModelo720(st.openPositions, rateMap, cfg720).split("\n").slice(1);
    expect(detail).toHaveLength(1);
    expect(detail[0]!).toContain("US0000000002");
    expect(detail[0]!.slice(462, 474)).toBe("000000070000");
    expect(findModelo720Omissions(st.openPositions, rateMap, { year: 2025 })).toEqual([]);
  });

  it("the web 720 table leaves it out", () => {
    useProfile("m720-content");
    renderSection720(flex(stock("0", "0") + stock("700", "70000", "US0000000002")), rateMap);
    expect(rows("m720-content").filter((r) => r.includes("US0000000001"))).toEqual([]);
    expect(rows("m720-content").filter((r) => r.includes("US0000000002"))).toHaveLength(1);
  });

  it("a security declared last year whose only row is 0 units worth 0 gets its C record, not an M record with 0 shares", () => {
    const st = flex(stock("0", "0") + stock("700", "70000", "US0000000002"));
    const config = { ...cfg720, previousYearSecurities: [{ isin: "US0000000001", claveSubclave: "V1", country: "US" }] };
    const detail = generateModelo720(st.openPositions, rateMap, config).split("\n").slice(1);
    const acme = detail.filter((r) => r.includes("US0000000001"));
    expect(acme).toHaveLength(1);
    // Position 423 is the declaration type: C (cancelled), not M (held).
    expect(acme[0]![422]).toBe("C");
  });

  it("holdsNothing: only an explicit 0 with a value of 0", () => {
    expect(holdsNothing({ quantity: "0", positionValue: "0" })).toBe(true);
    expect(holdsNothing({ quantity: "0", positionValue: "0", quantityUnknown: true })).toBe(false);
    expect(holdsNothing({ quantity: "5", positionValue: "0" })).toBe(false);
  });
});

describe("#470 an IBKR row whose positionValue is no number, whatever its quantity", () => {
  // Up to 0.66.14 the 720 (isHeldSecurity, the web filter) and the 721
  // (buildModelo721Entries, the web filter) ran `new Decimal(positionValue)`
  // and threw on "" or "N/A". A held row with such a value is unvalued
  // («sin valorar», never 0 €, never dropped); a row of 0 units holds nothing,
  // and a negative quantity is a short, as in the D-6.
  const other = stock("10", "1000", "US0000000002");
  const previous = [{ isin: "US0000000001", claveSubclave: "V1", country: "US" }];

  for (const value of ["", "N/A"]) {
    describe(`positionValue="${value}"`, () => {
      for (const position of ["700", ""]) {
        it(`position="${position}" (held): 720 thresholds, file, previous-year file and web table count it unvalued`, () => {
          const st = flex(stock(position, value) + other);
          expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 1, exceeds: false });
          expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values.total.toString()).toBe("850");
          const detail = generateModelo720(flex(stock(position, value) + stock("700", "70000", "US0000000002")).openPositions, rateMap, cfg720).split("\n").slice(1);
          expect(detail).toHaveLength(1);
          expect(detail[0]!).toContain("US0000000002");
          // Still held: last year's security gets no C record.
          const withPrevious = generateModelo720(flex(stock(position, value) + stock("700", "70000", "US0000000002")).openPositions, rateMap, { ...cfg720, previousYearSecurities: previous });
          expect(withPrevious.split("\n").slice(1).filter((r) => r.includes("US0000000001"))).toEqual([]);

          useProfile("m720-content");
          renderSection720(st, rateMap);
          expect(rows("m720-content").find((r) => r.includes("US0000000001"))?.split(" | ").at(-1)).toBe("—");
          expect(document.getElementById("m720-content")!.textContent).toContain("no se han podido valorar");
        });
      }

      it("position=\"0\": holds nothing in the 720 (no record, not unvalued; last year's security gets its C record), as in the D-6", () => {
        const st = flex(stock("0", value) + other);
        expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 0 });
        const withPrevious = generateModelo720(flex(stock("0", value) + stock("700", "70000", "US0000000002")).openPositions, rateMap, { ...cfg720, previousYearSecurities: previous });
        const acme = withPrevious.split("\n").slice(1).filter((r) => r.includes("US0000000001"));
        expect(acme).toHaveLength(1);
        expect(acme[0]![422]).toBe("C");
        useProfile("m720-content");
        renderSection720(st, rateMap);
        expect(rows("m720-content").filter((r) => r.includes("US0000000001"))).toEqual([]);
        expect(generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z").positions.map((p) => p.isin)).toEqual(["US0000000002"]);
      });

      it("position=\"-700\": a short, out of the 720 table and thresholds and cancelled, as in the D-6", () => {
        const st = flex(stock("-700", value) + other);
        expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 0 });
        const withPrevious = generateModelo720(flex(stock("-700", value) + stock("700", "70000", "US0000000002")).openPositions, rateMap, { ...cfg720, previousYearSecurities: previous });
        expect(withPrevious.split("\n").slice(1).filter((r) => r.includes("US0000000001")).map((r) => r[422])).toEqual(["C"]);
        useProfile("m720-content");
        renderSection720(st, rateMap);
        expect(rows("m720-content").filter((r) => r.includes("US0000000001"))).toEqual([]);
        const d6 = generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z", ["US0000000001"]);
        expect(d6.cancelled.map((c) => c.isin)).toEqual(["US0000000001"]);
      });

      it("D-6 generator and web: a held row is counted to value by hand, next to the readable one", () => {
        const st = flex(stock("700", value) + stock("700", "70000", "US0000000002"));
        const r = generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z");
        expect(r.positions.map((p) => p.isin)).toEqual(["US0000000002"]);
        expect(r.unvaluedCount).toBe(1);
        useProfile("d6-content");
        renderSectionD6(st, rateMap);
        expect(rows("d6-content")).toEqual([
          "US0000000001 | ACME CORP | US | 700 | —",
          "US0000000002 | ACME CORP | US | 700 | 59.500,00",
        ]);
      });

      for (const position of ["0.6", ""]) {
        it(`a coin with position="${position}": the 721 keeps it unvalued, and the web verdict is «No se puede determinar»`, () => {
          const st = flex(coin("BTC", "BITCOIN", position, value) + coin("ETH", "ETHER", "10", "30000"));
          const v = buildModelo721Entries(st.openPositions, rateMap, "2025-12-31");
          expect(v.positions.map((p) => [p.entry.assetId, p.valuationEur?.toString() ?? null])).toEqual([["BTC", null], ["ETH", "25500"]]);
          expect(v.unvaluedCount).toBe(1);
          useProfile("m721-content");
          renderSection721(st, rateMap);
          expect(rows("m721-content")[0]!.split(" | ").at(-1)).toBe("—");
          const text = document.getElementById("m721-content")!.textContent;
          expect(text).toContain("No se puede determinar");
          expect(text).not.toContain("No estás obligado");
          // Not a valued crypto holding for the "brokers without holdings" notice.
          expect(findMissingHoldings([{ broker: "IBKR", statement: flex(coin("BTC", "BITCOIN", position, value)) }]).m721).toEqual(["IBKR"]);
        });
      }

      it("a coin with position=\"0\" holds nothing in the 721", () => {
        const v = buildModelo721Entries(flex(coin("BTC", "BITCOIN", "0", value) + coin("ETH", "ETHER", "10", "30000")).openPositions, rateMap, "2025-12-31");
        expect(v.positions.map((p) => p.entry.assetId)).toEqual(["ETH"]);
        expect(v.unvaluedCount).toBe(0);
      });

      it("an unreadable costBasisMoney does not crash the 721 (value known)", () => {
        const st = flex(coin("BTC", "BITCOIN", "0.6", "60000").replace('costBasisMoney="40000"', `costBasisMoney="${value}"`));
        expect(buildModelo721Entries(st.openPositions, rateMap, "2025-12-31").totalValueEur.toString()).toBe("51000");
      });
    });
  }

  it("positionValueOf reads a number or null, isShortPosition takes the sign from the value or, when the value cannot tell, the quantity", () => {
    expect(positionValueOf({ positionValue: "" })).toBeNull();
    expect(positionValueOf({ positionValue: "N/A" })).toBeNull();
    expect(positionValueOf({ positionValue: "-12.5" })?.toString()).toBe("-12.5");
    expect(isShortPosition({ quantity: "5", positionValue: "-1" })).toBe(true);
    expect(isShortPosition({ quantity: "-5", positionValue: "N/A" })).toBe(true);
    expect(isShortPosition({ quantity: "-5", positionValue: "0" })).toBe(true);
    expect(isShortPosition({ quantity: "5", positionValue: "N/A" })).toBe(false);
    expect(isShortPosition({ quantity: "0", positionValue: "", quantityUnknown: true })).toBe(false);
    expect(holdsNothing({ quantity: "0", positionValue: "N/A" })).toBe(true);
  });
});

describe("#470 the warning for an explicit 0 next to a value that is not 0", () => {
  // The 0 is readable, so the "no readable quantity" wording was wrong for it:
  // the file says 0 units but gives a value, so the quantity is unknown.
  afterEach(async () => { await setLocale("es"); });

  it("shares and crypto get their own wording, apart from an unreadable quantity, each naming its own holdings", () => {
    const st = flex(stock("0", "70000") + stock("", "1000", "US0000000002") + coin("BTC", "BITCOIN", "0", "60000") + coin("ETH", "ETHER", "", "30000"));
    const byId = new Map((st.parserMessages ?? []).map((m) => [m.id, m]));
    expect([...byId.keys()].sort()).toEqual([
      "parser.crypto_position_quantity_unknown",
      "parser.crypto_position_zero_with_value",
      "parser.open_position_quantity_unknown",
      "parser.open_position_zero_with_value",
    ]);
    expect(byId.get("parser.open_position_zero_with_value")!.context).toEqual({ count: "1", holdings: "ACME (US0000000001)" });
    expect(byId.get("parser.open_position_quantity_unknown")!.context).toEqual({ count: "1", holdings: "ACME (US0000000002)" });
    expect(byId.get("parser.crypto_position_zero_with_value")!.context).toEqual({ count: "1", holdings: "BTC" });
    expect(byId.get("parser.crypto_position_quantity_unknown")!.context).toEqual({ count: "1", holdings: "ETH" });

    const shares = byId.get("parser.open_position_zero_with_value")!;
    expect(shares.message).toBe("IBKR da 0 acciones para 1 posición(es) abierta(s) que sí tienen un valor distinto de 0: ACME (US0000000001).");
    expect(shares.message).not.toContain("legible");
    expect(shares.hint).toContain("se trata como desconocido");
    expect(shares.hint).toContain("Modelo 720");
    const crypto = byId.get("parser.crypto_position_zero_with_value")!;
    expect(crypto.message).toBe("IBKR da 0 unidades para 1 posición(es) de criptomonedas que sí tienen un valor distinto de 0: BTC.");
    expect(crypto.hint).toContain("Modelo 721");
    expect(crypto.hint).not.toContain("720");
  });

  it("control: 0 units worth 0 and a readable quantity give no warning", () => {
    expect(flex(stock("0", "0") + stock("700", "70000", "US0000000002") + coin("BTC", "BITCOIN", "0", "0")).parserMessages ?? []).toEqual([]);
  });

  it("the Spanish locale text is the parser's own, and every locale renders the holdings with the 0-with-a-value wording", async () => {
    const st = flex(stock("0", "70000") + coin("BTC", "BITCOIN", "0", "60000"));
    const msgs = (st.parserMessages ?? []).filter((m) => m.id.endsWith("_zero_with_value"));
    expect(msgs).toHaveLength(2);
    for (const m of msgs) {
      expect(localizeMessage(m)).toBe(m.message);
      expect(localizeHint(m)).toBe(m.hint);
    }
    const unreadable: Record<string, RegExp> = { en: /readable/i, ca: /llegible/, eu: /irakurgarri/, gl: /lexible/ };
    for (const locale of ["en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      for (const m of msgs) {
        const text = localizeMessage(m);
        expect(text).toContain(m.context!.holdings);
        expect(text).toContain("0");
        expect(text).not.toMatch(unreadable[locale]!);
        expect(localizeHint(m)).not.toBe(m.hint);
      }
    }
  });
});
