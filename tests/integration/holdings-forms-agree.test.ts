// @vitest-environment jsdom
/**
 * Issue #470, the forms agree on one holding: the 720, the 721, the D-6, the
 * web sections, the CLI and the parser's warnings read the same IBKR row the
 * same way, and none of them drops a holding it cannot value without saying so.
 *
 * Every case runs through the real IBKR parser and the real generators and web
 * sections (the CLI wording: tests/cli/holdings-wording.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { buildModelo721Entries } from "../../src/generators/modelo721.js";
import { checkModelo720Thresholds, findModelo720Omissions, generateModelo720 } from "../../src/generators/modelo720.js";
import { generateD6Report } from "../../src/generators/d6.js";
import { renderSection721 } from "../../src/web/section-721.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSectionD6 } from "../../src/web/section-d6.js";
import { findMissingHoldings } from "../../src/web/missing-holdings.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Lot } from "../../src/types/tax.js";
import Decimal from "decimal.js";

const rateMap: EcbRateMap = new Map();
for (const d of ["2025-10-01", "2025-10-15", "2025-11-03", "2025-11-17", "2025-12-01", "2025-12-15", "2025-12-31"]) {
  rateMap.set(d, new Map([["USD", "0.85"]]));
}

function flexXml(positions: string, cash = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Q" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
<Trades /><CashTransactions /><CorporateActions />
<OpenPositions>${positions}</OpenPositions>
<SecuritiesInfo />
${cash ? `<CashReport>${cash}</CashReport>` : ""}
</FlexStatement></FlexStatements></FlexQueryResponse>`;
}

function flex(positions: string, cash = ""): Statement {
  return parseIbkrFlexXml(flexXml(positions, cash));
}

function stock(position: string, value: string, isin = "US0000000001", symbol = "ACME", category = "STK", currency = "USD"): string {
  return `<OpenPosition accountId="U1234567" symbol="${symbol}" description="${symbol} CORP" isin="${isin}" currency="${currency}" assetCategory="${category}" position="${position}" markPrice="100" positionValue="${value}" costBasisMoney="50000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

function coin(symbol: string, position: string, value: string): string {
  return `<OpenPosition accountId="U1234567" symbol="${symbol}" description="${symbol}" isin="" currency="USD" assetCategory="CRYPTO" position="${position}" markPrice="100000" positionValue="${value}" costBasisMoney="40000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

function cash(currency: string, ending: string, average: string | null = null, level = "Currency"): string {
  return `<CashReportCurrency accountId="U1234567" currency="${currency}" countryCode="IE" levelOfDetail="${level}" startingCash="0" endingCash="${ending}"${average === null ? "" : ` averageQ4Cash="${average}"`} endingSettledCash="0" />`;
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
  return document.getElementById(container)!.textContent.replace(/\s+/g, " ");
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe("#470 a cash balance in a currency with no year-end rate", () => {
  // IBKR's CNH (offshore yuan) has no ECB rate. 900,000 CNH is about 115,000 €:
  // left out silently, the 720 said «No estás obligado a presentar».
  const cnh = cash("BASE_SUMMARY", "115000", null, "BaseCurrency") + cash("CNH", "900000", "900000") + cash("USD", "100", "100");

  it("720 thresholds: the accounts category counts it unvalued, never dropped", () => {
    const st = flex(stock("10", "1000"), cnh);
    const accounts = checkModelo720Thresholds(st.openPositions, rateMap, 2025, st.cashBalances).accounts;
    expect(accounts).toMatchObject({ exceeds: false, unvalued: 1 });
    expect(accounts.total.toString()).toBe("85");
  });

  it("web 720: the accounts bar says «No se puede determinar», a banner names the account and currency, and the generate button never says «No estás obligado»", () => {
    useProfile("m720-content");
    renderSection720(flex(stock("10", "1000"), cnh), rateMap);
    expect(text("m720-content")).toContain("No se puede determinar: 1 saldo(s) en efectivo sin valorar");
    expect(document.querySelector("#m720-content .m720-cash-unvalued")?.textContent).toContain("U1234567 (CNH)");
    // BASE_SUMMARY is IBKR's sum of the currency rows, no balance of its own.
    expect(rows("m720-content").filter((r) => !r.startsWith("US0"))).toEqual(["CNH | — | —", "USD | 85,00 | 85,00"]);
    (document.getElementById("m720-generate-btn") as HTMLButtonElement).click();
    const after = text("m720-content");
    expect(after).not.toContain("No estás obligado");
    expect(after).toContain("U1234567 (CNH)");
  });

  it("control: BASE_SUMMARY next to EUR and USD rows moves nothing: no unvalued balance and the verdict stands", () => {
    const st = flex(stock("10", "1000"), cash("BASE_SUMMARY", "1100", null, "BaseCurrency") + cash("EUR", "1000", "1000") + cash("USD", "100", "100"));
    const accounts = checkModelo720Thresholds(st.openPositions, rateMap, 2025, st.cashBalances).accounts;
    expect(accounts).toMatchObject({ exceeds: false, unvalued: 0 });
    expect(accounts.total.toString()).toBe("1085");
    useProfile("m720-content");
    renderSection720(st, rateMap);
    (document.getElementById("m720-generate-btn") as HTMLButtonElement).click();
    expect(text("m720-content")).toContain("No estás obligado");
  });

  it("a file with only IBKR's BASE_SUMMARY row (no currency rows) is not dropped: its balance is unvalued", () => {
    const st = flex("", cash("BASE_SUMMARY", "115000", null, "BaseCurrency"));
    expect(checkModelo720Thresholds([], rateMap, 2025, st.cashBalances).accounts).toMatchObject({ exceeds: false, unvalued: 1 });
  });
});

describe("#470 one sign rule for the 720 and the D-6: a value of -0 has no sign", () => {
  for (const quantity of ["", "N/A"]) {
    for (const value of ["-0", "-0.00"]) {
      it(`position="${quantity}", positionValue="${value}": held and unvalued in both, and no D-6 cancellation`, () => {
        const st = flex(stock(quantity, value));
        expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values.unvalued).toBe(1);
        const d6 = generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z", ["US0000000001"]);
        expect(d6.unvaluedCount).toBe(1);
        expect(d6.cancelled).toEqual([]);
      });
    }
  }
});

describe("#470 the web D-6 and the D-6 guide treat a holding with no share count the same way", () => {
  const st = (): Statement => flex(stock("0", "60000") + stock("10", "1000", "US0000000002", "BIG"));

  it("both leave it out of the total, count it, and name it", () => {
    const d6 = generateD6Report(st().openPositions, rateMap, 2025, "X", "12345678Z");
    expect(d6.totalValueEur).toBe("850.00");
    expect(d6.unvaluedCount).toBe(1);
    const guide = d6.guide.join("\n");
    expect(guide).toContain("US0000000001");
    expect(guide).toContain("ACME CORP");
    expect(guide).toMatch(/a mano/);

    useProfile("d6-content");
    renderSectionD6(st(), rateMap);
    expect(text("d6-content")).toContain("Valor total: 850,00 €");
    expect(rows("d6-content")).toEqual(["US0000000001 | ACME CORP | US | — | —", "US0000000002 | BIG CORP | US | 10 | 850,00"]);
  });

  it("control: with every holding valued the guide lists no holding to declare by hand", () => {
    const d6 = generateD6Report(flex(stock("10", "1000")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect(d6.unvaluedCount).toBe(0);
    expect(d6.guide.join("\n")).not.toMatch(/a mano/);
  });
});

describe("#470 the 721 and the missing-holdings notice agree on a held coin", () => {
  for (const [quantity, value] of [["0.6", "NaN"], ["1", "-60000"], ["0.6", ""]] as const) {
    it(`BTC ${quantity} worth "${value}": the 721 keeps it, and no notice says the data has no crypto`, () => {
      const st = flex(coin("BTC", quantity, value));
      expect(buildModelo721Entries(st.openPositions, rateMap, "2025-12-31").positions).toHaveLength(1);
      const missing = findMissingHoldings([{ broker: "IBKR", statement: st }]);
      expect(missing.m721).toEqual([]);
      useProfile("m721-content");
      renderSection721(st, rateMap, missing.m721);
      expect(text("m721-content")).not.toContain("no incluyen tus criptomonedas");
    });
  }

  it("control: a coin worth 0 with no units is no holding, so the notice still shows", () => {
    expect(findMissingHoldings([{ broker: "IBKR", statement: flex(coin("BTC", "0", "0")) }]).m721).toEqual(["IBKR"]);
  });
});

describe("#470 the sign-conflict warning fires only for rows a form reads, and names that form", () => {
  it("an option with a quantity and a value of opposite signs gives no warning", () => {
    const st = flex(stock("-1", "250", "", "SPY 250117P00400000", "OPT") + stock("10", "1000", "US0000000002", "BIG"));
    expect((st.parserMessages ?? []).map((m) => m.id)).toEqual([]);
  });

  it("a stock names the 720 and the D-6; a coin names the 721", () => {
    const st = flex(stock("700", "-5000") + coin("BTC", "-1", "60000"));
    const msg = (st.parserMessages ?? []).find((m) => m.id === "parser.open_position_sign_conflict")!;
    expect(msg.context).toEqual({ count: "2", holdings: "ACME (US0000000001), BTC" });
    expect(msg.hint).toContain("720 y el D-6");
    expect(msg.hint).toContain("721");
  });

  it("an option with an unreadable quantity or a 0 next to a value gives no 720/D-6 warning either", () => {
    const st = flex(stock("", "250", "", "SPY 250117P00400000", "OPT") + stock("0", "250", "", "SPY 250117C00400000", "OPT"));
    expect((st.parserMessages ?? []).map((m) => m.id)).toEqual([]);
  });
});

describe("#470 the 720 never writes 0 in «Número de valores» for a fraction below 0.005", () => {
  const big = stock("700", "70000", "US0000000002", "BIG");

  for (const quantity of ["0.0034", "1E-3"]) {
    it(`position="${quantity}" next to a holding above the threshold: an omission, never a 0-share record`, () => {
      const st = flex(stock(quantity, "60000") + big);
      const lines = generateModelo720(st.openPositions, rateMap, cfg720).split("\n").filter((l) => l !== "");
      expect(lines.filter((l) => l.includes("US0000000001"))).toEqual([]);
      for (const l of lines.slice(1)) expect(l.slice(462, 474)).not.toBe("000000000000");
      const omissions = findModelo720Omissions(st.openPositions, rateMap, cfg720);
      expect(omissions.map((o) => o.kind === "position" && [o.position.isin, o.reason])).toEqual([["US0000000001", "quantity_below_hundredth"]]);
      // It still counts toward the threshold.
      expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values.total.toString()).toBe("110500");
      useProfile("m720-content");
      renderSection720(st, rateMap);
      expect(text("m720-content")).toContain("inferior a 0,01");
    });
  }

  it("a tranche below 0.005 units is merged into its neighbour: no record writes 0 units, and the units and value add up", () => {
    const st = flex(stock("10.003", "70000"));
    const lots = new Map<string, Lot[]>([["US0000000001", [
      { isin: "US0000000001", quantity: new Decimal("10"), acquireDate: "2024-03-01" } as Lot,
      { isin: "US0000000001", quantity: new Decimal("0.003"), acquireDate: "2025-06-01" } as Lot,
    ]]]);
    const lines = generateModelo720(st.openPositions, rateMap, cfg720, lots).split("\n").filter((l) => l !== "").slice(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.slice(462, 474)).toBe("000000001000");
  });

  it("control: 0.005 units rounds to 0.01 and is written", () => {
    const st = flex(stock("0.005", "60000") + big);
    const lines = generateModelo720(st.openPositions, rateMap, cfg720).split("\n").filter((l) => l.includes("US0000000001"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.slice(462, 474)).toBe("000000000001");
  });
});
