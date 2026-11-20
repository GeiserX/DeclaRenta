import { describe, it, expect } from "vitest";
import { generateModelo720, readPrevious720, type Previous720Security } from "../../src/generators/modelo720.js";
import type { CashBalance, OpenPosition } from "../../src/types/ibkr.js";
import { join } from "path";
import { runCli, tempFiles } from "./run-cli.js";

// `modelo720 --previous-720` reads last year's file to decide A/M/C. Round-trip
// the generator's own output: year N's file must give back only the securities
// still held at the end of year N.

function position(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    accountId: "U7654321", symbol: "IWDA", description: "ISHARES CORE MSCI WORLD", isin: "IE00B4L5Y983",
    currency: "EUR", assetCategory: "STK", quantity: "600", costBasisMoney: "40000", costBasisPrice: "66",
    markPrice: "92", positionValue: "55200", fifoPnlUnrealized: "15200", fxRateToBase: "1", custodianCountry: "IE", ...overrides,
  };
}

function cash(endingCash: string): CashBalance {
  return { accountId: "U7654321", currency: "EUR", endingCash, endingSettledCash: endingCash, averageQ4Cash: endingCash, countryCode: "IE" };
}

function config(year: number, previousYearSecurities?: Previous720Security[]) {
  return {
    nif: "12345678A", surname: "GARCIA LOPEZ", name: "JUAN", year, phone: "600123456",
    contactName: "GARCIA LOPEZ, JUAN", declarationId: "0000000000001", isComplementary: false,
    isReplacement: false, previousYearSecurities,
  };
}

describe("--previous-720 round trip", () => {
  // Year N: IWDA held, Apple declared the year before and gone (C record), and a
  // cash account over 50k (a Category C record with the account id at 132-143).
  const yearN = generateModelo720([position()], new Map(), config(2024, [{ isin: "US0378331005", claveSubclave: "V1", country: "IE" }]), undefined, [cash("55200")]);

  it("reads back only the securities held at the end of year N", () => {
    expect(yearN.split("\n").filter((l) => l[0] === "2")).toHaveLength(3);
    expect(readPrevious720(yearN).securities.map((s) => s.isin)).toEqual(["IE00B4L5Y983"]);
  });

  it("does not force a year N+1 filing below the threshold", () => {
    const previous = readPrevious720(yearN).securities;
    const yearN1 = generateModelo720(
      [position({ positionValue: "9200" })], new Map(), config(2025, previous), undefined, [cash("920")],
    );
    expect(yearN1).toBe("");
  });

  it("does not cancel last year's extinctions or the cash account again in year N+1", () => {
    const yearN1 = generateModelo720([position()], new Map(), config(2025, readPrevious720(yearN).securities));
    const details = yearN1.split("\n").filter((l) => l[0] === "2");
    expect(details.map((l) => `${l[101]}/${l[422]}/${l.slice(131, 143).trim()}`)).toEqual(["V/M/IE00B4L5Y983"]);
  });
});

// CodeRabbit on 45c5712: a sale of a security declared last year, with no
// purchase in the data (blank acquisition date) and proceeds too big for
// valoración 1 (written 0), must name both fields to complete, not only the date.
describe("--previous-720: a sale with no history and a value too big for the field", () => {
  const ISIN = "IE00B4L5Y983";
  const dir = tempFiles({
    "prev.txt": generateModelo720([position()], new Map(), config(2024)),
    "f.xml": `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U7654321" fromDate="20250101" toDate="20251231" period="">
<Trades><Trade tradeID="1" accountId="U7654321" symbol="IWDA" description="ISHARES CORE MSCI WORLD" isin="${ISIN}" assetCategory="STK" currency="EUR" tradeDate="20250303" settlementDate="20250305" quantity="-100" tradePrice="1e11" tradeMoney="-1e13" proceeds="1e13" cost="0" fifoPnlRealized="0" fxRateToBase="1" buySell="SELL" openCloseIndicator="C" exchange="AEB" ibCommissionCurrency="EUR" ibCommission="0" taxes="0" /></Trades>
<OpenPositions />
</FlexStatement></FlexStatements></FlexQueryResponse>
`,
  });

  it("prints one warning for the blank acquisition date and one for the value written as 0", () => {
    const res = runCli(["modelo720", "-i", join(dir, "f.xml"), "-y", "2025", "--nif", "12345678Z", "--name", "Apellido, Nombre", "--previous-720", join(dir, "prev.txt"), "-o", join(dir, "720.txt")]);
    expect(res.stderr).toContain(`⚠ ${ISIN} figuraba en el 720 anterior y se vendió en 2025, pero los datos no incluyen su compra.`);
    expect(res.stderr).toContain(`⚠ ${ISIN} figuraba en el 720 anterior y se vendió en 2025, pero su valoración en la fecha de extinción no cabe en el campo del fichero`);
  }, 60_000);
});
