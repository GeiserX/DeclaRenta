// @vitest-environment jsdom
/**
 * Issue #470, the numbers an IBKR holding carries: one rule for what "a number"
 * is, for every reader of the same field.
 *
 * - A position value or a cash balance is a number when it is a finite decimal
 *   (`700`, `-12.5`, `1e5`). "NaN", "Infinity", hex and any other text are no
 *   number: the holding is «sin valorar», warned and counted, never 0 €, never
 *   NaN, and it never lets a verdict say «no estás obligado».
 * - A quantity and a value of opposite signs contradict each other: the holding
 *   is held with an unknown value in the 720, the 721 and the D-6 alike.
 *
 * Every case runs through the real IBKR parser and the real generators and web
 * sections.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Decimal from "decimal.js";
import { localizeHint, localizeMessage, setLocale } from "../../src/i18n/index.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { buildModelo721Entries } from "../../src/generators/modelo721.js";
import { checkModelo720SuccessiveYear, checkModelo720Thresholds, findModelo720Omissions, generateModelo720 } from "../../src/generators/modelo720.js";
import { generateD6Report } from "../../src/generators/d6.js";
import { renderSection721 } from "../../src/web/section-721.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSectionD6 } from "../../src/web/section-d6.js";
import { findMissingHoldings } from "../../src/web/missing-holdings.js";
import { readPositionNumber } from "../../src/engine/ecb.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const rateMap: EcbRateMap = new Map();
for (const d of ["2025-10-01", "2025-10-15", "2025-11-03", "2025-11-17", "2025-12-01", "2025-12-15", "2025-12-31"]) {
  rateMap.set(d, new Map([["USD", "0.85"]]));
}

function flex(positions: string, cash = ""): Statement {
  return parseIbkrFlexXml(`<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Q" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
<Trades /><CashTransactions /><CorporateActions />
<OpenPositions>${positions}</OpenPositions>
<SecuritiesInfo />
${cash ? `<CashReport>${cash}</CashReport>` : ""}
</FlexStatement></FlexStatements></FlexQueryResponse>`);
}

function stock(position: string, value: string, isin = "US0000000001"): string {
  return `<OpenPosition accountId="U1234567" symbol="ACME" description="ACME CORP" isin="${isin}" currency="USD" assetCategory="STK" position="${position}" markPrice="100" positionValue="${value}" costBasisMoney="50000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

function coin(symbol: string, description: string, position: string, value: string): string {
  return `<OpenPosition accountId="U1234567" symbol="${symbol}" description="${description}" isin="" currency="USD" assetCategory="CRYPTO" position="${position}" markPrice="100000" positionValue="${value}" costBasisMoney="40000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

/** One CashReport row: `ending` null = no endingCash attribute; `average` null = none. */
function cash(currency: string, ending: string | null, average: string | null = null, account = "U1234567"): string {
  return `<CashReportCurrency accountId="${account}" currency="${currency}" countryCode="IE" levelOfDetail="Currency" startingCash="0"${ending === null ? "" : ` endingCash="${ending}"`}${average === null ? "" : ` averageQ4Cash="${average}"`} endingSettledCash="0" />`;
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

function text(container: string): string {
  return document.getElementById(container)!.textContent;
}

const NOT_A_NUMBER = ["NaN", "Infinity", "-Infinity", "0x10", "1_000", "1e999999999999999999"];

describe("#470 one rule for a number", () => {
  it("readPositionNumber reads finite decimals, exponents included, and nothing else", () => {
    expect(readPositionNumber("700")?.toString()).toBe("700");
    expect(readPositionNumber(" -12.5 ")?.toString()).toBe("-12.5");
    expect(readPositionNumber("1e5")?.toString()).toBe("100000");
    expect(readPositionNumber("7E2")?.toString()).toBe("700");
    expect(readPositionNumber(".5")?.toString()).toBe("0.5");
    for (const t of [...NOT_A_NUMBER, "", "N/A", "1,000", "-", "e5"]) expect(readPositionNumber(t), t).toBeNull();
  });
});

describe("#470 a position value that is no finite number is «sin valorar» everywhere", () => {
  const big = stock("700", "70000", "US0000000002");
  const small = stock("10", "1000", "US0000000002");

  for (const value of NOT_A_NUMBER) {
    describe(`positionValue="${value}"`, () => {
      it("720 thresholds: unvalued, never NaN; below the threshold otherwise the verdict cannot say «not obliged»", () => {
        const withBig = checkModelo720Thresholds(flex(stock("700", value) + big).openPositions, rateMap, 2025).values;
        expect(withBig.unvalued).toBe(1);
        expect(withBig.total.toString()).toBe("59500");
        expect(withBig.exceeds).toBe(true);
        const withSmall = checkModelo720Thresholds(flex(stock("700", value) + small).openPositions, rateMap, 2025).values;
        expect(withSmall).toMatchObject({ unvalued: 1, exceeds: false });
        expect(withSmall.total.toString()).toBe("850");
      });

      it("720 file: only the valued holding is written, every record 500 characters", () => {
        const lines = generateModelo720(flex(stock("700", value) + big).openPositions, rateMap, cfg720).split("\n").filter((l) => l !== "");
        expect(lines).toHaveLength(2);
        for (const l of lines) expect(l).toHaveLength(500);
        expect(lines[1]!).toContain("US0000000002");
        expect(lines.join("")).not.toMatch(/NaN|Infinity/);
      });

      it("D-6: counted unvalued, the total stays finite", () => {
        const r = generateD6Report(flex(stock("700", value) + big).openPositions, rateMap, 2025, "X", "12345678Z");
        expect(r.positions.map((p) => p.isin)).toEqual(["US0000000002"]);
        expect(r.unvaluedCount).toBe(1);
        expect(r.totalValueEur).toBe("59500.00");
      });

      it("web 720 and D-6 tables show «—», never NaN", () => {
        useProfile("m720-content");
        renderSection720(flex(stock("700", value) + small), rateMap);
        expect(rows("m720-content").find((r) => r.includes("US0000000001"))?.split(" | ").at(-1)).toBe("—");
        expect(text("m720-content")).toContain("no se han podido valorar");
        expect(text("m720-content")).toContain("No se puede determinar");
        expect(text("m720-content")).not.toMatch(/NaN|Infinity/);

        useProfile("d6-content");
        renderSectionD6(flex(stock("700", value) + big), rateMap);
        expect(rows("d6-content")).toEqual([
          "US0000000001 | ACME CORP | US | 700 | —",
          "US0000000002 | ACME CORP | US | 700 | 59.500,00",
        ]);
        expect(text("d6-content")).not.toMatch(/NaN|Infinity/);
      });

      it("721: a coin is kept unvalued (never dropped), and the web verdict is «No se puede determinar»", () => {
        const st = flex(coin("BTC", "BITCOIN", "0.6", value) + coin("ETH", "ETHER", "10", "30000"));
        const v = buildModelo721Entries(st.openPositions, rateMap, "2025-12-31");
        expect(v.positions.map((p) => [p.entry.assetId, p.valuationEur?.toString() ?? null])).toEqual([["BTC", null], ["ETH", "25500"]]);
        expect(v.unvaluedCount).toBe(1);
        expect(v.totalValueEur.toString()).toBe("25500");
        useProfile("m721-content");
        renderSection721(st, rateMap);
        expect(text("m721-content")).toContain("No se puede determinar");
        expect(text("m721-content")).not.toContain("No estás obligado");
        expect(text("m721-content")).not.toMatch(/NaN|Infinity/);
      });
    });
  }

  it("control: an exponent value is a number, valued like the plain one", () => {
    const st = flex(stock("700", "7e4"));
    expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 0, exceeds: true });
    expect(generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z").totalValueEur).toBe("59500.00");
  });
});

describe("#470 an IBKR quantity or value written with an exponent", () => {
  it("position=\"0\" next to positionValue=\"1e5\" is a 0 next to a value: flagged, warned, never 0 shares", () => {
    const st = flex(stock("0", "1e5"));
    expect(st.openPositions.map((p) => p.quantityUnknown ?? false)).toEqual([true]);
    expect((st.parserMessages ?? []).map((m) => m.id)).toEqual(["parser.open_position_zero_with_value"]);
    // The 720 writes no record with 0 in «Número de valores»; it is listed for manual entry.
    expect(generateModelo720(st.openPositions, rateMap, cfg720)).toBe("");
    expect(findModelo720Omissions(st.openPositions, rateMap, { year: 2025 }).map((o) => (o.kind === "position" ? o.reason : o.kind))).toEqual(["quantity_unknown"]);
    // Declared last year: no M record with 0 shares either.
    const previous = [{ isin: "US0000000001", claveSubclave: "V1", country: "US" }];
    expect(generateModelo720(st.openPositions, rateMap, { ...cfg720, previousYearSecurities: previous })).toBe("");
    // The D-6 counts it to declare by hand instead of cancelling it.
    const d6 = generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z", ["US0000000001"]);
    expect(d6.unvaluedCount).toBe(1);
    expect(d6.cancelled).toEqual([]);
  });

  it("a coin with position=\"0\" and positionValue=\"6e4\" shows «—» units in the 721, never 0", () => {
    const st = flex(coin("BTC", "BITCOIN", "0", "6e4"));
    expect((st.parserMessages ?? []).map((m) => m.id)).toEqual(["parser.crypto_position_zero_with_value"]);
    useProfile("m721-content");
    renderSection721(st, rateMap);
    expect(rows("m721-content")).toEqual(["BITCOIN | — | — | 51.000,00"]);
  });

  it("position=\"7e2\" is 700 shares, as readable as \"700\": no warning, and the 720 writes 700 shares", () => {
    const st = flex(stock("7e2", "70000"));
    expect(st.openPositions.map((p) => p.quantityUnknown ?? false)).toEqual([false]);
    expect(st.parserMessages ?? []).toEqual([]);
    const detail = generateModelo720(st.openPositions, rateMap, cfg720).split("\n")[1] ?? "";
    expect(detail.slice(462, 474)).toBe("000000070000");
    expect(generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z").positions.map((p) => p.sharesAtYearEnd)).toEqual(["700"]);
  });

  it("position=\"NaN\" is no number: unknown, never NaN shares", () => {
    const st = flex(stock("NaN", "70000"));
    expect(st.openPositions.map((p) => [p.quantity, p.quantityUnknown ?? false])).toEqual([["0", true]]);
    expect((st.parserMessages ?? []).map((m) => m.id)).toEqual(["parser.open_position_quantity_unknown"]);
  });
});

describe("#470 an IBKR cash balance that is no number", () => {
  const unreadable = ["", "N/A", "NaN", "Infinity"];

  for (const ending of unreadable) {
    describe(`endingCash="${ending}"`, () => {
      it("the parser warns naming the account and currency", () => {
        const msgs = flex("", cash("USD", ending) + cash("EUR", "100")).parserMessages ?? [];
        expect(msgs.map((m) => m.id)).toEqual(["parser.cash_balance_unreadable"]);
        expect(msgs[0]!.context).toEqual({ count: "1", accounts: "U1234567 (USD)" });
      });

      it("720 thresholds: the accounts category counts it unvalued, never 0 € and never a crash", () => {
        const alone = checkModelo720Thresholds([], rateMap, 2025, flex("", cash("USD", ending)).cashBalances).accounts;
        expect(alone).toMatchObject({ unvalued: 1, exceeds: false });
        expect(alone.total.toString()).toBe("0");
        const withBig = checkModelo720Thresholds([], rateMap, 2025, flex("", cash("USD", ending) + cash("USD", "70000", "70000", "U7654321")).cashBalances).accounts;
        expect(withBig).toMatchObject({ unvalued: 1, exceeds: true });
        expect(withBig.total.toString()).toBe("59500");
      });

      it("720 file and omissions: no crash; the valued account is written, the unreadable one is not", () => {
        const balances = flex("", cash("USD", ending) + cash("USD", "70000", "70000", "U7654321")).cashBalances;
        const lines = generateModelo720([], rateMap, cfg720, undefined, balances).split("\n").filter((l) => l !== "");
        expect(lines).toHaveLength(2);
        expect(lines[1]!).toContain("U7654321");
        expect(lines[1]!).not.toContain("U1234567");
        expect(() => findModelo720Omissions([], rateMap, { year: 2025 }, balances)).not.toThrow();
      });

      it("last year's declared account with an unreadable balance is not reported as missing", () => {
        const balances = flex("", cash("USD", ending)).cashBalances;
        const s = checkModelo720SuccessiveYear([], rateMap, 2025, balances, { securities: [], accounts: ["U1234567"] }, { year: 2024, values: new Decimal(0), accountsEnding: new Decimal(60000), accountsAverage: new Decimal(0) });
        expect(s.accounts.missing).toEqual([]);
      });

      it("web 720: the accounts bar says «No se puede determinar», the cash table shows «—» and a banner names the account", () => {
        useProfile("m720-content");
        renderSection720(flex("", cash("USD", ending)), rateMap);
        const t = text("m720-content");
        expect(t).toContain("No se puede determinar: 1 saldo(s) en efectivo sin valorar");
        expect(t).toContain("U1234567 (USD)");
        expect(rows("m720-content")).toEqual(["USD | — | —"]);
        expect(t).not.toMatch(/NaN|Infinity/);
      });

      it("the broker counts as having holdings: no «no holdings» notice for the 720", () => {
        expect(findMissingHoldings([{ broker: "IBKR", statement: flex("", cash("USD", ending)) }]).m720).toEqual([]);
      });
    });
  }

  it("a missing endingCash attribute is no balance either: unvalued, not 0 €", () => {
    const st = flex("", cash("USD", null));
    expect(checkModelo720Thresholds([], rateMap, 2025, st.cashBalances).accounts).toMatchObject({ unvalued: 1, exceeds: false });
    expect((st.parserMessages ?? []).map((m) => m.id)).toEqual(["parser.cash_balance_unreadable"]);
  });

  it("an unreadable averageQ4Cash is a missing average: the balance counts, the record is not written, no crash", () => {
    const balances = flex("", cash("USD", "70000", "N/A")).cashBalances;
    const th = checkModelo720Thresholds([], rateMap, 2025, balances).accounts;
    expect(th).toMatchObject({ unvalued: 0, exceeds: true });
    expect(th.total.toString()).toBe("59500");
    expect(generateModelo720([], rateMap, cfg720, undefined, balances)).toBe("");
    useProfile("m720-content");
    renderSection720(flex("", cash("USD", "70000", "N/A")), rateMap);
    expect(rows("m720-content")).toEqual(["USD | 59.500,00 | —"]);
    expect(text("m720-content")).toContain("media del cuarto trimestre");
  });

  it("controls: a readable balance, 0 and a negative one stay as they were, with no warning", () => {
    const st = flex("", cash("USD", "1000") + cash("EUR", "0") + cash("GBP", "-5"));
    expect(st.parserMessages ?? []).toEqual([]);
    const accounts = checkModelo720Thresholds([], rateMap, 2025, st.cashBalances).accounts;
    expect(accounts).toMatchObject({ unvalued: 0, exceeds: false });
    expect(accounts.total.toString()).toBe("850");
  });

  it("IBKR's BASE_SUMMARY row is a sum, no balance of its own: an unreadable one is not counted twice", () => {
    const st = flex("", cash("BASE_SUMMARY", "") + cash("USD", ""));
    expect(checkModelo720Thresholds([], rateMap, 2025, st.cashBalances).accounts.unvalued).toBe(1);
    expect((st.parserMessages ?? [])[0]!.context).toEqual({ count: "1", accounts: "U1234567 (USD)" });
  });
});

describe("#470 a quantity and a value of opposite signs", () => {
  // 700 units worth -5000, or -700 units worth 5000: the row contradicts
  // itself, so it is neither a long holding worth 5000 nor a short. It is held
  // with an unknown value in the 720, the 721 and the D-6 alike.
  const small = stock("10", "1000", "US0000000002");
  const previous = [{ isin: "US0000000001", claveSubclave: "V1", country: "US" }];

  for (const [position, value] of [["700", "-5000"], ["-700", "5000"]] as const) {
    it(`${position} units worth ${value}: 720, D-6 and web agree it is held and unvalued`, () => {
      const st = flex(stock(position, value) + small);
      const th = checkModelo720Thresholds(st.openPositions, rateMap, 2025).values;
      expect(th).toMatchObject({ unvalued: 1, exceeds: false });
      expect(th.total.toString()).toBe("850");
      // Held: last year's security gets no C record, and no record is written for it.
      const lines = generateModelo720(flex(stock(position, value) + stock("700", "70000", "US0000000002")).openPositions, rateMap, { ...cfg720, previousYearSecurities: previous }).split("\n").slice(1);
      expect(lines.filter((r) => r.includes("US0000000001"))).toEqual([]);

      const d6 = generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z", ["US0000000001"]);
      expect(d6.positions.map((p) => p.isin)).toEqual(["US0000000002"]);
      expect(d6.unvaluedCount).toBe(1);
      expect(d6.cancelled).toEqual([]);
      expect(d6.totalValueEur).toBe("850.00");

      useProfile("m720-content");
      renderSection720(st, rateMap);
      expect(rows("m720-content").find((r) => r.includes("US0000000001"))?.split(" | ").at(-1)).toBe("—");
      expect(text("m720-content")).toContain("No se puede determinar");

      useProfile("d6-content");
      renderSectionD6(st, rateMap);
      expect(rows("d6-content").find((r) => r.includes("US0000000001"))?.split(" | ").at(-1)).toBe("—");
    });

    it(`${position} units worth ${value} as a coin: the 721 keeps it unvalued`, () => {
      const v = buildModelo721Entries(flex(coin("BTC", "BITCOIN", position, value)).openPositions, rateMap, "2025-12-31");
      expect(v.positions.map((p) => [p.entry.assetId, p.valuationEur])).toEqual([["BTC", null]]);
      expect(v.unvaluedCount).toBe(1);
    });
  }

  it("the parser warns naming the holdings (control: a real short and a real long give no warning)", () => {
    const st = flex(stock("700", "-5000") + coin("BTC", "BITCOIN", "-1", "60000") + stock("-700", "-5000", "US0000000003") + stock("700", "5000", "US0000000004"));
    const msgs = (st.parserMessages ?? []);
    expect(msgs.map((m) => m.id)).toEqual(["parser.open_position_sign_conflict"]);
    expect(msgs[0]!.context).toEqual({ count: "2", holdings: "ACME (US0000000001), BTC" });
  });

  it("control: a real short (-700 worth -5000) stays out of the 720 and the D-6", () => {
    const st = flex(stock("-700", "-5000") + small);
    expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values.unvalued).toBe(0);
    expect(generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z").unvaluedCount).toBe(0);
  });
});

describe("#470 the warning for 0 next to a value is true for both signs", () => {
  afterEach(async () => { await setLocale("es"); });

  it("a 0 next to a negative value is a short: the hint says so, and the 720 and the D-6 leave it out", () => {
    const st = flex(stock("0", "-5000") + coin("BTC", "BITCOIN", "0", "-60000"));
    const byId = new Map((st.parserMessages ?? []).map((m) => [m.id, m]));
    const shares = byId.get("parser.open_position_zero_with_value")!;
    expect(shares.hint).toContain("valor positivo");
    expect(shares.hint).toContain("valor negativo");
    const crypto = byId.get("parser.crypto_position_zero_with_value")!;
    expect(crypto.hint).toContain("valor negativo");
    expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values.unvalued).toBe(0);
    expect(generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z").unvaluedCount).toBe(0);
    expect(buildModelo721Entries(st.openPositions, rateMap, "2025-12-31").positions).toEqual([]);
  });

  it("every locale has the new texts, and the Spanish one is the parser's own", async () => {
    const st = flex(stock("0", "-5000") + stock("700", "-5000", "US0000000002"), cash("USD", ""));
    const msgs = st.parserMessages ?? [];
    expect(msgs.map((m) => m.id).sort()).toEqual(["parser.cash_balance_unreadable", "parser.open_position_sign_conflict", "parser.open_position_zero_with_value"]);
    for (const m of msgs) {
      expect(localizeMessage(m)).toBe(m.message);
      expect(localizeHint(m)).toBe(m.hint);
    }
    for (const locale of ["en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      for (const m of msgs) {
        expect(localizeMessage(m)).not.toBe(m.message);
        expect(localizeHint(m)).not.toBe(m.hint);
        expect(localizeMessage(m)).toContain(Object.values(m.context!).at(-1)!);
      }
    }
  });
});

describe("#470 the unknown-quantity banners are true for a missing quantity and for a 0 next to a value", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it("721, D-6 and 720 texts no longer claim the file gives no number", () => {
    useProfile("m721-content");
    renderSection721(flex(coin("BTC", "BITCOIN", "0", "60000")), rateMap);
    const m721 = document.querySelector("#m721-content .m721-quantity-unknown")!.textContent;
    expect(m721).not.toContain("no da");
    expect(m721).toContain("un 0 que su valor no confirma");

    useProfile("d6-content");
    renderSectionD6(flex(stock("0", "70000")), rateMap);
    const d6 = document.querySelector("#d6-content .d6-quantity-unknown")!.textContent;
    expect(d6).not.toContain("no da");
    expect(d6).toContain("un 0 que su valor no confirma");

    useProfile("m720-content");
    renderSection720(flex(stock("0", "70000")), rateMap);
    expect(text("m720-content")).not.toContain("el archivo no da su número de valores");
    expect(text("m720-content")).toContain("un 0 junto a un valor");
  });
});
