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
