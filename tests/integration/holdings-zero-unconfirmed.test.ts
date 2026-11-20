// @vitest-environment jsdom
/**
 * Issue #470, a written 0 that nothing confirms. An IBKR Open Positions row of
 * 0 units next to a value that is no number ("N/A", "NaN", "60,000", "") or
 * with no value column at all says nothing reliable: the 0 may be an export
 * error, and the holding may still be there. Up to round 3 of #470 such a row
 * held nothing, with no warning, so a security declared last year got a
 * cancellation (C) record in the 720 and was cancelled in the D-6, and a coin
 * vanished from the 721.
 *
 * The rule: a written 0 is trusted only when a readable value of 0 sits next to
 * it. Otherwise the quantity is unknown (`quantityUnknown`): the holding is
 * held and «sin valorar» in the 720, the D-6 and the 721, no C record and no
 * cancellation is written for it, and the parser names it for review.
 *
 * Proven with a two-year IBKR upload: the 2024 statement's own 720 file and
 * D-6 declared the security, and the 2025 statement gives it 0 units.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { localizeHint, localizeMessage, setLocale } from "../../src/i18n/index.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { buildModelo721Entries } from "../../src/generators/modelo721.js";
import {
  checkModelo720SuccessiveYear,
  checkModelo720Thresholds,
  findUndatedExtinctions,
  generateModelo720,
  readPrevious720,
  readPrevious720Totals,
} from "../../src/generators/modelo720.js";
import { generateD6Report } from "../../src/generators/d6.js";
import { renderSection720 } from "../../src/web/section-720.js";
import { renderSection721 } from "../../src/web/section-721.js";
import { findMissingHoldings } from "../../src/web/missing-holdings.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const rateMap: EcbRateMap = new Map();
for (const year of ["2024", "2025"]) {
  for (const md of ["10-01", "10-15", "11-04", "11-18", "12-02", "12-16", "12-31"]) {
    rateMap.set(`${year}-${md}`, new Map([["USD", "0.85"]]));
  }
}

const ACME = "US0000000001";
const OTHER = "US0000000002";

function flex(year: number, positions: string): Statement {
  return parseIbkrFlexXml(`<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Q" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="${year}0101" toDate="${year}1231" period="LastYear">
<Trades /><CashTransactions /><CorporateActions />
<OpenPositions>${positions}</OpenPositions>
<SecuritiesInfo />
</FlexStatement></FlexStatements></FlexQueryResponse>`);
}

/** One STK row; `value` null = no positionValue attribute at all. */
function stock(position: string, value: string | null, isin = ACME, symbol = "ACME"): string {
  return `<OpenPosition accountId="U1234567" symbol="${symbol}" description="${symbol} CORP" isin="${isin}" currency="USD" assetCategory="STK" position="${position}" markPrice="100"${value === null ? "" : ` positionValue="${value}"`} costBasisMoney="50000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

function coin(position: string, value: string | null): string {
  return `<OpenPosition accountId="U1234567" symbol="BTC" description="BITCOIN" isin="" currency="USD" assetCategory="CRYPTO" position="${position}" markPrice="100000"${value === null ? "" : ` positionValue="${value}"`} costBasisMoney="40000" fxRateToBase="0.85" levelOfDetail="SUMMARY" />`;
}

const cfg = (year: number) => ({ nif: "12345678Z", surname: "PEREZ", name: "JUAN", year, phone: "600000000", contactName: "JUAN PEREZ", declarationId: "7200000000001", isComplementary: false, isReplacement: false });

// 2024: ACME and OTHER held, 59,500 € each. The 2024 statement's own 720 file
// and D-6 declare both.
const st2024 = flex(2024, stock("700", "70000") + stock("700", "70000", OTHER, "OTHER"));
const file2024 = generateModelo720(st2024.openPositions, rateMap, cfg(2024));
const d6Isins2024 = generateD6Report(st2024.openPositions, rateMap, 2024, "X", "12345678Z").positions.map((p) => p.isin);

/** The 2025 statement: ACME at 0 units next to `value`, OTHER still held. */
const year2025 = (value: string | null): Statement => flex(2025, stock("0", value) + stock("700", "70000", OTHER, "OTHER"));

/** Detail records of a 720 file as "ISIN/origin". */
function details(file: string): string[] {
  return file.split("\n").filter((l) => l[0] === "2").map((l) => `${l.slice(131, 143).trim()}/${l[422]}`);
}

const UNCONFIRMED: { label: string; value: string | null }[] = [
  { label: "N/A", value: "N/A" },
  { label: "NaN", value: "NaN" },
  { label: "60,000", value: "60,000" },
  { label: "\"\"", value: "" },
  { label: "no positionValue column", value: null },
];

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

async function upload(content: string): Promise<void> {
  const input = $("#m720-previous-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File([content], "modelo720_2024.txt")] });
  const before = $("#m720-content")!.innerHTML;
  input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 200 && $("#m720-content")!.innerHTML === before; i++) await new Promise((r) => setTimeout(r, 5));
}

describe("#470 the two-year upload: 2024 declared ACME and OTHER", () => {
  it("the 2024 file and D-6 declare both (the premise of every case below)", () => {
    expect(details(file2024)).toEqual([`${ACME}/A`, `${OTHER}/A`]);
    expect(d6Isins2024).toEqual([ACME, OTHER]);
  });
});

for (const { label, value } of UNCONFIRMED) {
  describe(`#470 2025 gives ACME 0 units next to ${label}: unknown, never cancelled`, () => {
    const st = year2025(value);
    const previous = readPrevious720(file2024);
    const totals = readPrevious720Totals(file2024);

    it("the parser flags the quantity unknown and names ACME in its own warning", () => {
      const acme = st.openPositions.find((p) => p.isin === ACME)!;
      expect(acme.quantityUnknown).toBe(true);
      const msgs = st.parserMessages ?? [];
      expect(msgs.map((m) => m.id)).toEqual(["parser.open_position_zero_unconfirmed"]);
      expect(msgs[0]!.context).toEqual({ count: "1", holdings: `ACME (${ACME})` });
    });

    it("720 successive-year check: nothing sold, ACME counted unvalued", () => {
      const s = checkModelo720SuccessiveYear(st.openPositions, rateMap, 2025, undefined, previous, totals);
      expect(s.values.sold).toEqual([]);
      expect(s.values.mandatory).toBe(false);
      expect(checkModelo720Thresholds(st.openPositions, rateMap, 2025).values).toMatchObject({ unvalued: 1, exceeds: true });
    });

    it("720 file with last year's file: no C record for ACME, OTHER stays M, no extinction to complete", () => {
      const config = { ...cfg(2025), previousYearSecurities: previous.securities, previousYearAccounts: previous.accounts };
      const file = generateModelo720(st.openPositions, rateMap, config);
      expect(details(file)).toEqual([`${OTHER}/M`]);
      for (const line of file.split("\n")) expect(line).toHaveLength(500);
      expect(findUndatedExtinctions(st.openPositions, config)).toEqual([]);
    });

    it("D-6 with last year's D-6: ACME is not cancelled; the guide names it to declare by hand", () => {
      const d6 = generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z", d6Isins2024);
      expect(d6.cancelled).toEqual([]);
      expect(d6.positions.map((p) => p.isin)).toEqual([OTHER]);
      expect(d6.unvaluedCount).toBe(1);
      const guide = d6.guide.join("\n");
      expect(guide).toContain("SIN VALORAR O SIN Nº DE TÍTULOS");
      expect(guide).toContain(`${ACME}  ACME CORP`);
      expect(guide).not.toContain("CANCELACIONES");
    });
  });
}

describe("#470 the web 720 with last year's file loaded", () => {
  beforeEach(async () => {
    const store = new Map<string, string>([["declarenta_profile", JSON.stringify({ nif: "12345678Z", apellidos: "PEREZ", nombre: "JUAN", telefono: "600000000", year: 2025 })]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    await setLocale("es");
    document.body.innerHTML = `<div id="m720-content"></div>`;
  });

  afterEach(async () => {
    $("#m720-previous-clear")?.click();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await setLocale("es");
  });

  it("0 next to N/A: ACME stays in the table as M and «—», nothing is listed as sold", async () => {
    renderSection720(year2025("N/A"), rateMap);
    await upload(file2024);
    const rows = [...document.querySelectorAll("#m720-content table tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()));
    const acme = rows.find((r) => r[0] === ACME)!;
    expect(acme[3]).toBe("—");
    expect(acme[4]!.slice(0, 1)).toBe("M");
    expect($(".m720-sold")).toBeNull();
    expect($("#m720-content")!.textContent).not.toContain("Has vendido valores que declaraste");
    expect($("#m720-content")!.textContent).not.toContain("este año no estás obligado a presentarlo");
  });

  it("control: 0 next to a readable 0 holds nothing, so ACME is listed as sold", async () => {
    renderSection720(year2025("0"), rateMap);
    await upload(file2024);
    expect([...document.querySelectorAll(".m720-sold li")].map((li) => li.textContent.split(":")[0])).toEqual([ACME]);
  });
});

describe("#470 controls: a 0 the value confirms still holds nothing", () => {
  for (const value of ["0", "0.00", "-0"]) {
    it(`0 next to ${value}: no warning, ACME gets its C record and its D-6 cancellation`, () => {
      const st = year2025(value);
      expect(st.openPositions.find((p) => p.isin === ACME)!.quantityUnknown).toBeUndefined();
      expect(st.parserMessages ?? []).toEqual([]);
      const previous = readPrevious720(file2024);
      const file = generateModelo720(st.openPositions, rateMap, { ...cfg(2025), previousYearSecurities: previous.securities });
      expect(details(file)).toEqual([`${OTHER}/M`, `${ACME}/C`]);
      expect(checkModelo720SuccessiveYear(st.openPositions, rateMap, 2025, undefined, previous, readPrevious720Totals(file2024)).values.sold.map((s) => s.isin)).toEqual([ACME]);
      expect(generateD6Report(st.openPositions, rateMap, 2025, "X", "12345678Z", d6Isins2024).cancelled.map((c) => c.isin)).toEqual([ACME]);
    });
  }

  it("a 0 next to a value other than 0 keeps its own warning, not this one", () => {
    expect((year2025("5000").parserMessages ?? []).map((m) => m.id)).toEqual(["parser.open_position_zero_with_value"]);
  });

  it("an option row of 0 next to N/A is in no form: no holdings warning", () => {
    const st = flex(2025, `<OpenPosition accountId="U1234567" symbol="ACME 250117C100" description="ACME CALL" isin="" currency="USD" assetCategory="OPT" position="0" markPrice="1" positionValue="N/A" levelOfDetail="SUMMARY" />`);
    expect(st.parserMessages ?? []).toEqual([]);
  });
});

describe("#470 a coin of 0 units next to an unconfirming value", () => {
  for (const { label, value } of UNCONFIRMED) {
    it(`0 next to ${label}: the 721 lists BTC with «—» units and no value, and the parser names it`, () => {
      const st = flex(2025, coin("0", value));
      expect((st.parserMessages ?? []).map((m) => m.id)).toEqual(["parser.crypto_position_zero_unconfirmed"]);
      expect((st.parserMessages ?? [])[0]!.context).toEqual({ count: "1", holdings: "BTC" });
      const v = buildModelo721Entries(st.openPositions, rateMap, "2025-12-31");
      expect(v.positions.map((p) => [p.entry.assetId, p.entry.quantityUnknown ?? false, p.valuationEur])).toEqual([["BTC", true, null]]);
      expect(v.unvaluedCount).toBe(1);
      // The coin row is crypto activity; held, it keeps the notice «no incluyen tus criptomonedas» off.
      expect(findMissingHoldings([{ broker: "IBKR", statement: st }]).m721).toEqual([]);
    });
  }

  it("control: a coin of 0 units next to a readable 0 is not in the 721", () => {
    const st = flex(2025, coin("0", "0"));
    expect(st.parserMessages ?? []).toEqual([]);
    expect(buildModelo721Entries(st.openPositions, rateMap, "2025-12-31").positions).toEqual([]);
    expect(findMissingHoldings([{ broker: "IBKR", statement: st }]).m721).toEqual(["IBKR"]);
  });

  it("the web 721 shows BTC with «—» units", () => {
    const store = new Map<string, string>([["declarenta_profile", JSON.stringify({ year: 2025 })]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null });
    document.body.innerHTML = `<div id="m721-content"></div>`;
    renderSection721(flex(2025, coin("0", "N/A")), rateMap);
    const rows = [...document.querySelectorAll("#m721-content tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()).join(" | "));
    expect(rows).toEqual(["BITCOIN | — | — | —"]);
    expect(document.getElementById("m721-content")!.textContent).toContain("BTC");
    vi.unstubAllGlobals();
  });
});

describe("#470 the new warnings in the 5 locales", () => {
  afterEach(async () => {
    await setLocale("es");
  });

  it("the Spanish text is the parser's own; every other locale has its own text naming the holding", async () => {
    const msgs = [(year2025("N/A").parserMessages ?? [])[0]!, (flex(2025, coin("0", "N/A")).parserMessages ?? [])[0]!];
    expect(msgs.map((m) => m.id)).toEqual(["parser.open_position_zero_unconfirmed", "parser.crypto_position_zero_unconfirmed"]);
    await setLocale("es");
    for (const m of msgs) {
      expect(localizeMessage(m)).toBe(m.message);
      expect(localizeHint(m)).toBe(m.hint);
    }
    for (const locale of ["en", "ca", "eu", "gl"] as const) {
      await setLocale(locale);
      for (const m of msgs) {
        expect(localizeMessage(m)).not.toBe(m.message);
        expect(localizeHint(m)).not.toBe(m.hint);
        expect(localizeMessage(m)).toContain(m.context!.holdings);
        expect(localizeMessage(m)).not.toContain("{{");
      }
    }
  });
});
