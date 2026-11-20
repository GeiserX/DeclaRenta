// @vitest-environment jsdom
/**
 * Issue #470, a number too big for a field of the Modelo 720 file. Every
 * numeric field of a type-2 record has a fixed width: valoración 1 and 2 have
 * 12 integer digits and 2 decimals (up to 999,999,999,999.99 €), «Número de
 * valores» 10 integer digits and 2 decimals. Up to round 3 of #470 a finite
 * value past that (positionValue="1e999") was written in exponent form
 * ("8.5e+998") and a value of 13 to 21 digits crashed the whole file.
 *
 * The rule: a value that does not fit its field is «sin valorar» (a position
 * value, a cash balance or its Q4 average), a share count that does not fit is
 * left out for manual entry (`quantity_too_large`), and the value of a
 * cancellation (C) record that does not fit is written as 0 and named to
 * complete by hand. No field is ever written in exponent form, and every record
 * is exactly 500 characters.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import Decimal from "decimal.js";
import { setLocale, t } from "../../src/i18n/index.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import {
  checkModelo720Thresholds,
  findModelo720Omissions,
  findUndatedExtinctions,
  generateModelo720,
  unvaluedCashBalances,
} from "../../src/generators/modelo720.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSectionD6 } from "../../src/web/section-d6.js";
import { renderSection721 } from "../../src/web/section-721.js";
import { generateD6Report } from "../../src/generators/d6.js";
import { buildModelo721Entries, findModelo721Omissions, generateModelo721 } from "../../src/generators/modelo721.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { FifoDisposal } from "../../src/types/tax.js";

const rateMap: EcbRateMap = new Map();
for (const d of ["2025-10-01", "2025-10-15", "2025-11-03", "2025-11-17", "2025-12-01", "2025-12-15", "2025-12-31"]) {
  rateMap.set(d, new Map([["USD", "0.85"]]));
}

const ACME = "US0000000001";
const OTHER = "US0000000002";

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

function stock(position: string, value: string, isin = ACME, currency = "USD"): string {
  return `<OpenPosition accountId="U1234567" symbol="${isin === ACME ? "ACME" : "OTHER"}" description="${isin === ACME ? "ACME" : "OTHER"} CORP" isin="${isin}" currency="${currency}" assetCategory="STK" position="${position}" markPrice="100" positionValue="${value}" costBasisMoney="50000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

function cash(currency: string, ending: string, average: string, account = "U1234567"): string {
  return `<CashReportCurrency accountId="${account}" currency="${currency}" countryCode="IE" levelOfDetail="Currency" startingCash="0" endingCash="${ending}" averageQ4Cash="${average}" endingSettledCash="0" />`;
}

const other = stock("700", "70000", OTHER);
const cfg720 = { nif: "12345678Z", surname: "PEREZ", name: "JUAN", year: 2025, phone: "600000000", contactName: "JUAN PEREZ", declarationId: "7200000000001", isComplementary: false, isReplacement: false };

/**
 * Every record of a 720 file is 500 characters and every numeric field it
 * writes is digits in its fixed width: no exponent, no overflow.
 */
function expectWellFormed(file: string): string[] {
  const lines = file.split("\n");
  for (const line of lines) {
    expect(line).toHaveLength(500);
    if (line[0] === "1") {
      expect(line.slice(144, 162)).toMatch(/^[ N]\d{17}$/);
      expect(line.slice(162, 180)).toMatch(/^[ N]\d{17}$/);
    } else {
      expect(line.slice(431, 446)).toMatch(/^[ N]\d{14}$/);
      expect(line.slice(446, 461)).toMatch(/^[ N]\d{14}$/);
      expect(line.slice(462, 474)).toMatch(/^\d{12}$/);
    }
  }
  return lines.filter((l) => l[0] === "2");
}

function useProfile(): void {
  const profile = JSON.stringify({ year: 2025 });
  vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "declarenta_profile" ? profile : null) });
  document.body.innerHTML = `<div id="m720-content"></div>`;
}

function rows(): string[][] {
  return [...document.querySelectorAll("#m720-content tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()));
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await setLocale("es");
});

describe("#470 a position value too big for valoración 1 is «sin valorar»", () => {
  // 1e999 is a finite number; 1e13 and 2e12 USD are 8.5e12 and 1.7e12 € at 0.85.
  for (const value of ["1e999", "1e13", "2e12"]) {
    describe(`positionValue="${value}"`, () => {
      it("720 thresholds: counted unvalued, never added to the total", () => {
        const th = checkModelo720Thresholds(flex(stock("700", value) + other).openPositions, rateMap, 2025).values;
        expect(th).toMatchObject({ unvalued: 1, exceeds: true });
        expect(th.total.toString()).toBe("59500");
        expect(checkModelo720Thresholds(flex(stock("700", value)).openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 1, exceeds: false });
      });

      it("720 file: no crash, no record for it, every field in its width", () => {
        const details = expectWellFormed(generateModelo720(flex(stock("700", value) + other).openPositions, rateMap, cfg720));
        expect(details.map((l) => l.slice(131, 143))).toEqual([OTHER]);
        expect(findModelo720Omissions(flex(stock("700", value) + other).openPositions, rateMap, { year: 2025 })).toEqual([]);
      });

      it("web 720 table: «—» for it, and the unvalued banner", () => {
        useProfile();
        renderSection720(flex(stock("700", value) + other), rateMap);
        expect(rows().find((r) => r[0] === ACME)?.at(-1)).toBe("—");
        expect(document.getElementById("m720-content")!.textContent).toContain("no se han podido valorar");
      });
    });
  }

  it("boundary: 999,999,999,999.99 € fits and is written; 999,999,999,999.995 € rounds past it and is unvalued", () => {
    const fits = flex(stock("700", "999999999999.99", ACME, "EUR"));
    expect(checkModelo720Thresholds(fits.openPositions, rateMap, 2025).values.unvalued).toBe(0);
    const details = expectWellFormed(generateModelo720(fits.openPositions, rateMap, cfg720));
    expect(details.map((l) => l.slice(431, 446))).toEqual([" 99999999999999"]);

    const over = flex(stock("700", "999999999999.995", ACME, "EUR") + other);
    expect(checkModelo720Thresholds(over.openPositions, rateMap, 2025).values.unvalued).toBe(1);
    expect(expectWellFormed(generateModelo720(over.openPositions, rateMap, cfg720)).map((l) => l.slice(131, 143))).toEqual([OTHER]);
  });
});

describe("#470 a share count too big for «Número de valores» is left out for manual entry", () => {
  for (const position of ["1e10", "1e999", "9999999999.995"]) {
    it(`position="${position}": valued, counted, never written; the omission names why`, () => {
      const st = flex(stock(position, "70000") + other);
      expect(st.openPositions[0]!.quantityUnknown).toBeUndefined();
      expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 0, exceeds: true });
      const details = expectWellFormed(generateModelo720(st.openPositions, rateMap, cfg720));
      expect(details.map((l) => l.slice(131, 143))).toEqual([OTHER]);
      expect(findModelo720Omissions(st.openPositions, rateMap, { year: 2025 }).map((o) => (o.kind === "position" ? [o.position.isin, o.reason] : o.kind))).toEqual([[ACME, "quantity_too_large"]]);
    });
  }

  it("boundary: 9,999,999,999.99 shares fit and are written", () => {
    const st = flex(stock("9999999999.99", "70000"));
    const details = expectWellFormed(generateModelo720(st.openPositions, rateMap, cfg720));
    expect(details.map((l) => l.slice(462, 474))).toEqual(["999999999999"]);
    expect(findModelo720Omissions(st.openPositions, rateMap, { year: 2025 })).toEqual([]);
  });

  it("the web lists it with its own reason, in the 5 locales", async () => {
    useProfile();
    renderSection720(flex(stock("1e10", "70000") + other), rateMap);
    expect(document.getElementById("m720-content")!.textContent).toContain(`ACME: ${t("m720.omitted_quantity_too_large")}`);
    const texts = new Set<string>();
    for (const locale of ["es", "en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      const text = t("m720.omitted_quantity_too_large");
      expect(text).not.toBe("m720.omitted_quantity_too_large");
      texts.add(text);
    }
    expect(texts.size).toBe(5);
  });
});

describe("#470 a cash balance or Q4 average too big for its valoración is «sin valorar»", () => {
  const big = cash("USD", "70000", "70000", "U7654321");
  for (const [ending, average] of [["1e999", "100"], ["100", "1e999"], ["2e12", "100"], ["100", "2e12"]] as const) {
    it(`endingCash="${ending}" averageQ4Cash="${average}": unvalued and named, the other account written`, () => {
      const balances = flex("", cash("USD", ending, average) + big).cashBalances;
      const th = checkModelo720Thresholds([], rateMap, 2025, balances).accounts;
      expect(th).toMatchObject({ unvalued: 1, exceeds: true });
      expect(th.total.toString()).toBe("59500");
      expect(unvaluedCashBalances(balances, rateMap, 2025).map((cb) => cb.accountId)).toEqual(["U1234567"]);
      const details = expectWellFormed(generateModelo720([], rateMap, cfg720, undefined, balances));
      expect(details.map((l) => l.slice(155, 189).trim())).toEqual(["U7654321"]);

      useProfile();
      renderSection720(flex("", cash("USD", ending, average) + big), rateMap);
      expect(document.querySelector("#m720-content .m720-cash-unvalued")!.textContent).toContain("U1234567 (USD)");
      expect(rows().map((r) => r.join(" | "))).toContain("USD | — | —");
    });
  }
});

describe("#470 a cancellation whose value does not fit valoración 1", () => {
  const previous = [{ isin: ACME, claveSubclave: "V1", country: "US" }];
  const sale = (proceedsEur: string) => ({
    isin: ACME, symbol: "ACME", description: "ACME CORP", sellDate: "2025-03-03", acquireDate: "2023-05-02", assetCategory: "STK",
    isShort: false, costBasisFcy: new Decimal(9000), holdingPeriodDays: 671, proceedsEur: new Decimal(proceedsEur),
  }) as unknown as FifoDisposal;

  for (const proceeds of ["1e999", "1e13"]) {
    it(`proceeds of ${proceeds} €: the C record is written with 0 and named to complete by hand`, () => {
      const st = flex(other);
      const config = { ...cfg720, previousYearSecurities: previous };
      const details = expectWellFormed(generateModelo720(st.openPositions, rateMap, config, undefined, undefined, [sale(proceeds)]));
      const c = details.filter((l) => l.slice(131, 143) === ACME);
      expect(c.map((l) => [l[422], l.slice(423, 431), l.slice(431, 446)])).toEqual([["C", "20250303", " 00000000000000"]]);
      expect(findUndatedExtinctions(st.openPositions, config, [sale(proceeds)])).toEqual([{ isin: ACME, missing: "value" }]);
    });
  }

  it("control: proceeds that fit are written as they are, and nothing is to complete", () => {
    const st = flex(other);
    const config = { ...cfg720, previousYearSecurities: previous };
    const details = expectWellFormed(generateModelo720(st.openPositions, rateMap, config, undefined, undefined, [sale("10500")]));
    expect(details.filter((l) => l.slice(131, 143) === ACME).map((l) => l.slice(431, 446))).toEqual([" 00000001050000"]);
    expect(findUndatedExtinctions(st.openPositions, config, [sale("10500")])).toEqual([]);
  });

  it("the web lists the sale with its note when last year's file is loaded", async () => {
    // Last year's file, written by the tool itself: ACME declared (EUR, rate 1).
    const file2024 = generateModelo720(flex(stock("700", "70000", ACME, "EUR")).openPositions, new Map(), { ...cfg720, year: 2024 });
    const store = new Map<string, string>([["declarenta_profile", JSON.stringify({ nif: "12345678Z", apellidos: "PEREZ", nombre: "JUAN", telefono: "600000000", year: 2025 })]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    document.body.innerHTML = `<div id="m720-content"></div>`;
    renderSection720(flex(other), rateMap, undefined, [sale("1e999")]);
    const input = document.getElementById("m720-previous-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([file2024], "modelo720_2024.txt")] });
    const before = document.getElementById("m720-content")!.innerHTML;
    input.dispatchEvent(new Event("change"));
    for (let i = 0; i < 200 && document.getElementById("m720-content")!.innerHTML === before; i++) await new Promise((r) => setTimeout(r, 5));
    expect([...document.querySelectorAll(".m720-sold li")].map((li) => li.textContent)).toEqual([`${ACME}: ${t("m720.sold_value_too_large")}`]);
    document.getElementById("m720-previous-clear")?.click();
  });

  it("a sale with no history and a value too big names both fields to complete, in the web and the CLI order", async () => {
    // CodeRabbit on 45c5712: a sale with no lot (no history) has a blank
    // acquisition date, and proceeds of 1e13 € write 0 in valoración 1. Only
    // the date was named, so the 0 had no explanation.
    const noLots = { ...sale("1e13"), acquireDate: "2025-03-03", costBasisFcy: new Decimal(0), holdingPeriodDays: 0 };
    const config = { ...cfg720, previousYearSecurities: previous };
    expect(findUndatedExtinctions(flex(other).openPositions, config, [noLots])).toEqual([
      { isin: ACME, missing: "acquisitionDate" },
      { isin: ACME, missing: "value" },
    ]);
    const file2024 = generateModelo720(flex(stock("700", "70000", ACME, "EUR")).openPositions, new Map(), { ...cfg720, year: 2024 });
    const store = new Map<string, string>([["declarenta_profile", JSON.stringify({ nif: "12345678Z", apellidos: "PEREZ", nombre: "JUAN", telefono: "600000000", year: 2025 })]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    document.body.innerHTML = `<div id="m720-content"></div>`;
    renderSection720(flex(other), rateMap, undefined, [noLots]);
    const input = document.getElementById("m720-previous-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([file2024], "modelo720_2024.txt")] });
    const before = document.getElementById("m720-content")!.innerHTML;
    input.dispatchEvent(new Event("change"));
    for (let i = 0; i < 200 && document.getElementById("m720-content")!.innerHTML === before; i++) await new Promise((r) => setTimeout(r, 5));
    expect([...document.querySelectorAll(".m720-sold li")].map((li) => li.textContent)).toEqual([
      `${ACME}: ${t("m720.sold_no_acquisition")}`,
      `${ACME}: ${t("m720.sold_value_too_large")}`,
    ]);
    document.getElementById("m720-previous-clear")?.click();
  });

  it("the web names it, in the 5 locales", async () => {
    const texts = new Set<string>();
    for (const locale of ["es", "en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      const text = t("m720.sold_value_too_large");
      expect(text).not.toBe("m720.sold_value_too_large");
      texts.add(text);
    }
    expect(texts.size).toBe(5);
  });
});

function coin(value: string, currency = "USD"): string {
  return `<OpenPosition accountId="U1234567" symbol="BTC" description="BITCOIN" isin="" currency="${currency}" assetCategory="CRYPTO" position="1" markPrice="100000" positionValue="${value}" costBasisMoney="40000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

function useContainer(id: string): void {
  const profile = JSON.stringify({ year: 2025 });
  vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "declarenta_profile" ? profile : null) });
  document.body.innerHTML = `<div id="${id}"></div>`;
}

describe("#470 one rule in the three forms: a value too big for the 720 field is unvalued in the D-6 and the 721 too", () => {
  // At 0.85, 1e999 and 2e12 USD do not fit 12 integer digits in euros. The 720
  // calls them «sin valorar»; the D-6 and the 721 must not print a total of
  // hundreds of digits next to it.
  for (const value of ["1e999", "2e12"]) {
    it(`positionValue="${value}": the D-6 counts it unvalued, names it, and its total stays the other holding's`, () => {
      const d6 = generateD6Report(flex(stock("700", value) + other).openPositions, rateMap, 2025, "X", "12345678Z");
      expect(d6.positions.map((p) => p.isin)).toEqual([OTHER]);
      expect(d6.unvaluedCount).toBe(1);
      expect(d6.totalValueEur).toBe("59500.00");
      expect(d6.guide.join("\n")).toContain(`${ACME}  ACME CORP`);
      expect(d6.guide.join("\n")).not.toMatch(/e\+|\d{16}/);
    });

    it(`positionValue="${value}": the web D-6 shows «—» and the unvalued banner`, () => {
      useContainer("d6-content");
      renderSectionD6(flex(stock("700", value) + other), rateMap);
      const cells = [...document.querySelectorAll("#d6-content tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()));
      expect(cells.find((r) => r[0] === ACME)?.at(-1)).toBe("—");
      expect(document.getElementById("d6-content")!.textContent).toContain("no se han podido valorar");
    });

    it(`a coin worth ${value}: the 721 counts it unvalued, never in the total, and the verdict cannot say «not obliged»`, () => {
      const v = buildModelo721Entries(flex(coin(value)).openPositions, rateMap, "2025-12-31");
      expect(v.unvaluedCount).toBe(1);
      expect(v.totalValueEur.toString()).toBe("0");
      expect(v.positions[0]!.valuationEur).toBeNull();
      useContainer("m721-content");
      renderSection721(flex(coin(value)), rateMap);
      expect(document.getElementById("m721-content")!.textContent).toContain("No se puede determinar");
    });
  }

  it("boundary: 999,999,999,999.99 € is valued in the D-6 and the 721; 999,999,999,999.995 € is not", () => {
    const fits = generateD6Report(flex(stock("700", "999999999999.99", ACME, "EUR")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect([fits.unvaluedCount, fits.totalValueEur]).toEqual([0, "999999999999.99"]);
    const over = generateD6Report(flex(stock("700", "999999999999.995", ACME, "EUR")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect([over.unvaluedCount, over.totalValueEur]).toEqual([1, "0.00"]);
    expect(buildModelo721Entries(flex(coin("999999999999.99", "EUR")).openPositions, rateMap, "2025-12-31").unvaluedCount).toBe(0);
    expect(buildModelo721Entries(flex(coin("999999999999.995", "EUR")).openPositions, rateMap, "2025-12-31").unvaluedCount).toBe(1);
  });
});

describe("#470 one rule for the share count: a count the 720 field cannot hold has no valid share count in the D-6", () => {
  // The 720 leaves out a count past 10 integer digits (`quantity_too_large`).
  // The D-6 wrote the same count as "1e+25" in its guide and JSON. Now it is a
  // holding with no valid share count: named, counted, out of the total.
  for (const position of ["1e25", "1e10", "9999999999.995"]) {
    it(`position="${position}": the D-6 counts it unvalued, names it, and never writes an exponent`, () => {
      const d6 = generateD6Report(flex(stock(position, "70000") + other).openPositions, rateMap, 2025, "X", "12345678Z");
      expect(d6.positions.map((p) => p.isin)).toEqual([OTHER]);
      expect([d6.unvaluedCount, d6.unvalued]).toEqual([1, [{ isin: ACME, description: "ACME CORP" }]]);
      expect(d6.totalValueEur).toBe("59500.00");
      expect(d6.guide.join("\n")).not.toMatch(/e\+|\d{16}/);
    });

    it(`position="${position}": the web D-6 shows «—» for its count and value, and the unvalued banner`, () => {
      useContainer("d6-content");
      renderSectionD6(flex(stock(position, "70000") + other), rateMap);
      const row = [...document.querySelectorAll("#d6-content tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim())).find((r) => r[0] === ACME)!;
      expect(row.at(-1)).toBe("—");
      expect(row).toContain("—");
      expect(row.join(" ")).not.toMatch(/e\+|\d{3}\.\d{3}\.\d{3}\.\d{3}/);
      expect(document.getElementById("d6-content")!.textContent).toContain("no se han podido valorar");
    });
  }

  it("boundary: 9,999,999,999.99 shares are listed in digits; a tiny count is written in full, never as 5e-8", () => {
    const fits = generateD6Report(flex(stock("9999999999.99", "70000")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect([fits.unvaluedCount, fits.positions[0]!.sharesAtYearEnd]).toEqual([0, "9999999999.99"]);
    const tiny = generateD6Report(flex(stock("0.00000005", "70000")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect([tiny.unvaluedCount, tiny.positions[0]!.sharesAtYearEnd]).toEqual([0, "0.00000005"]);
    expect(tiny.guide.join("\n")).toContain("Nº títulos:        0.00000005");
  });
});

describe("#470 a share count with more than 20 decimals has no valid share count in the D-6, and no screen expands it", () => {
  // CodeRabbit on 45c5712: position="1e-1000000000" is a readable number, and
  // `toFixed()` wrote it as a billion characters: the D-6 report and the web
  // table ran out of memory. A count with more than 20 decimals is no share
  // count a broker writes. The D-6 names it to declare by hand, and the
  // holding stays held (no cancellation). Every quantity cell shows «—» for it.
  const tinyCases = (process.env.D6_TINY_CASES ?? "1e-100000,1e-1000000000,0.000000000000000000001").split(",");
  for (const position of tinyCases) {
    it(`position="${position}": the D-6 counts it unvalued, names it, keeps it held, and writes no long count`, () => {
      const d6 = generateD6Report(flex(stock(position, "70000") + other).openPositions, rateMap, 2025, "X", "12345678Z", [ACME]);
      expect(d6.positions.map((p) => p.isin)).toEqual([OTHER]);
      expect([d6.unvaluedCount, d6.unvalued]).toEqual([1, [{ isin: ACME, description: "ACME CORP" }]]);
      expect(d6.cancelled).toEqual([]);
      expect(d6.totalValueEur).toBe("59500.00");
      expect(JSON.stringify(d6).length).toBeLessThan(20000);
    });

    it(`position="${position}": the web D-6 shows «—» for its count and value, and the unvalued banner`, () => {
      useContainer("d6-content");
      renderSectionD6(flex(stock(position, "70000") + other), rateMap);
      const row = [...document.querySelectorAll("#d6-content tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim())).find((r) => r[0] === ACME)!;
      expect(row.at(-1)).toBe("—");
      expect(row.join(" ").length).toBeLessThan(200);
      expect(document.getElementById("d6-content")!.textContent).toContain("no se han podido valorar");
    });

    // The web cell bounds the printed length, not the decimals (`fmtQty`, 60
    // digits in full): 21 decimals print in full, an absurd exponent is «—».
    it(`a coin of ${position} units: the web 721 never shows a long number`, () => {
      useContainer("m721-content");
      renderSection721(flex(coin("60000").replace('position="1"', `position="${position}"`)), rateMap);
      const row = [...document.querySelectorAll("#m721-content tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()))[0]!;
      expect(row[2]).toBe(position === "0.000000000000000000001" ? "0,000000000000000000001" : "—");
      expect(document.getElementById("m721-content")!.innerHTML.length).toBeLessThan(50000);
    });
  }

  it("boundary: a count with 20 decimals is listed in full, as is 0.00000005", () => {
    const fits = generateD6Report(flex(stock("0.00000000000000000001", "70000")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect([fits.unvaluedCount, fits.positions[0]!.sharesAtYearEnd]).toEqual([0, "0.00000000000000000001"]);
    const tiny = generateD6Report(flex(stock("0.00000005", "70000")).openPositions, rateMap, 2025, "X", "12345678Z");
    expect([tiny.unvaluedCount, tiny.positions[0]!.sharesAtYearEnd]).toEqual([0, "0.00000005"]);
  });
});

describe("#470 the 721 library export writes numbers as the 720 does: digits in their width, never an exponent", () => {
  const cfg721 = { ...cfg720, declarationId: "7210000000001", allowPrototypeOutput: true };
  const entry = (valuationEur: string, quantity = "1") => ({
    assetId: "BTC", description: "BITCOIN", exchangeName: "", countryCode: "", quantity: new Decimal(quantity),
    valuationEur: new Decimal(valuationEur), acquisitionCostEur: new Decimal(40000),
  });

  it("a value that fits is written in digits", () => {
    const lines = generateModelo721([entry("60000.5")], cfg721).split("\n");
    for (const line of lines) expect(line).toHaveLength(500);
    // Valoración (sign and 13 + 2 digits), a blank, then the quantity (9 + 3).
    expect(lines[1]).toContain(" 000000006000050 000000001000");
    expect(lines[1]).not.toMatch(/e\+/);
  });

  it.each([["1e25"], ["1e999"]])("a value of %s throws, never writes an exponent", (value) => {
    expect(() => generateModelo721([entry(value)], cfg721)).toThrow(/excede el campo/);
  });

  // CodeRabbit on 45c5712: the acquisition cost skips the 720 fit, and numPad
  // wrote the integer digits with toFixed(0) before its width check, one digit
  // per exponent step. costBasisMoney="1e1000000000" ran out of memory. Now
  // the size is compared first and the error stays short.
  const hugeCases = (process.env.M721_HUGE_CASES ?? "1e100000,1e1000000000").split(",");
  for (const cost of hugeCases) {
    it(`an IBKR coin with costBasisMoney="${cost}" fails fast with a short error, never a long string`, () => {
      const xml = coin("60000").replace('costBasisMoney="40000"', `costBasisMoney="${cost}"`);
      const entries = buildModelo721Entries(flex(xml).openPositions, rateMap, "2025-12-31").positions.map((p) => p.entry);
      let message = "";
      try {
        generateModelo721(entries, cfg721);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/^Modelo 721: importe .* excede el campo de 13 dígitos enteros$/);
      expect(message.length).toBeLessThan(100);
    });
  }

  // The quantity field has 9 integer digits: 1e9 coins or more threw and
  // failed the whole file, though a meme coin held by the billion is ordinary.
  // As the 720 does with a count past its field (`quantity_too_large`), that
  // coin is left out of the file and named for manual entry
  // (`findModelo721Omissions`); every other record is the same, and the coin
  // still counts toward the 50,000 € threshold.
  const shib = (position: string, value: string) => coin(value)
    .replace('symbol="BTC" description="BITCOIN"', 'symbol="SHIB" description="SHIBA INU"')
    .replace('position="1"', `position="${position}"`);
  const entriesOf = (xml: string) => buildModelo721Entries(flex(xml).openPositions, rateMap, "2025-12-31").positions.map((p) => p.entry);

  for (const position of ["1000000000", "-1000000000", "1e21", ...hugeCases]) {
    it(`a coin of ${position} units is left out and named; the file is the one without it`, () => {
      const entries = entriesOf(coin("80000") + shib(position, "20000"));
      expect(generateModelo721(entries, cfg721)).toBe(generateModelo721(entriesOf(coin("80000")), cfg721));
      expect(findModelo721Omissions(entries)).toEqual([{ reason: "quantity_too_large", entry: entries[1] }]);
    });
  }

  it("a coin left out still counts toward the threshold; the sums are those of the records written", () => {
    // 25,500 € of BTC alone is below 50,000 €; with 34,000 € of SHIB it is not.
    expect(generateModelo721(entriesOf(coin("30000")), cfg721)).toBe("");
    const lines = generateModelo721(entriesOf(coin("30000") + shib("2000000000", "40000")), cfg721).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.slice(135, 144)).toBe("000000001");
    expect(lines[0]!.slice(163, 180)).toBe("00000000002550000");
    expect(lines[1]!.slice(131, 143).trim()).toBe("BTC");
    // The only coin, left out: no file, and the omission names it.
    const alone = entriesOf(shib("2000000000", "80000"));
    expect(generateModelo721(alone, cfg721)).toBe("");
    expect(findModelo721Omissions(alone).map((o) => o.entry.assetId)).toEqual(["SHIB"]);
  });

  it("boundary: 999,999,999.999 coins are written; 1,000,000,000 are left out", () => {
    const fits = entriesOf(coin("80000") + shib("999999999.999", "20000"));
    expect(findModelo721Omissions(fits)).toEqual([]);
    expect(generateModelo721(fits, cfg721).split("\n")[2]!.slice(464, 476)).toBe("999999999999");
    expect(findModelo721Omissions(entriesOf(shib("1000000000", "80000")))).toHaveLength(1);
  });
});

