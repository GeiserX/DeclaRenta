import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateModelo721, buildModelo721Entries } from "../../src/generators/modelo721.js";
import type { Modelo721Entry } from "../../src/generators/modelo721.js";
import type { OpenPosition } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

function makePosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    accountId: "U111",
    symbol: "BTC",
    description: "Bitcoin",
    isin: "",
    currency: "USD",
    assetCategory: "CRYPTO",
    quantity: "1.5",
    costBasisMoney: "30000",
    costBasisPrice: "20000",
    markPrice: "40000",
    positionValue: "60000",
    fifoPnlUnrealized: "30000",
    fxRateToBase: "1",
    ...overrides,
  };
}

/** date -> currency -> rate (EUR per 1 FCY). */
function makeRateMap(date: string, rates: Record<string, string>): EcbRateMap {
  return new Map([[date, new Map(Object.entries(rates))]]);
}

function makeEntry(overrides: Partial<Modelo721Entry> = {}): Modelo721Entry {
  return {
    assetId: "BTC",
    description: "Bitcoin",
    exchangeName: "Coinbase",
    countryCode: "US",
    quantity: new Decimal("1.5"),
    valuationEur: new Decimal("60000"),
    acquisitionCostEur: new Decimal("30000"),
    ...overrides,
  };
}

const baseConfig = {
  nif: "12345678A",
  surname: "GARCIA LOPEZ",
  name: "JUAN",
  year: 2025,
  phone: "600123456",
  contactName: "GARCIA LOPEZ, JUAN",
  declarationId: "0000000000001",
  isComplementary: false,
  isReplacement: false,
  allowPrototypeOutput: true,
};

describe("Modelo 721 Generator", () => {
  it("should return empty string when total value is below 50K EUR", () => {
    const entries = [makeEntry({ valuationEur: new Decimal("10000") })];
    expect(generateModelo721(entries, baseConfig)).toBe("");
  });

  it("should generate records when total value exceeds 50K EUR", () => {
    const entries = [makeEntry()]; // 60000 EUR
    const result = generateModelo721(entries, baseConfig);
    expect(result).not.toBe("");
    const lines = result.split("\n");
    expect(lines).toHaveLength(2); // 1 summary + 1 detail
    expect(lines[0]![0]).toBe("1"); // summary
    expect(lines[1]![0]).toBe("2"); // detail
  });

  it("should use model number 721", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const lines = result.split("\n");
    expect(lines[0]!.slice(1, 4)).toBe("721");
    expect(lines[1]!.slice(1, 4)).toBe("721");
  });

  it("should include year in records", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const summary = result.split("\n")[0]!;
    expect(summary.slice(4, 8)).toBe("2025");
  });

  it("should include NIF in records", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const summary = result.split("\n")[0]!;
    expect(summary.slice(8, 17).trim()).toBe("12345678A");
  });

  it("should mark asset type as C for crypto", () => {
    const entries = [makeEntry()];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    // Asset type at position 102 (0-indexed: 101)
    expect(detail[101]).toBe("C");
  });

  it("should include country code", () => {
    const entries = [makeEntry({ countryCode: "US" })];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    expect(detail.slice(128, 130)).toBe("US");
  });

  it("should include asset ID", () => {
    const entries = [makeEntry({ assetId: "BTC" })];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    expect(detail.slice(131, 143).trim()).toBe("BTC");
  });

  it("should include exchange name", () => {
    const entries = [makeEntry({ exchangeName: "Coinbase" })];
    const result = generateModelo721(entries, baseConfig);
    const detail = result.split("\n")[1]!;
    expect(detail.slice(189, 230).trim()).toBe("Coinbase");
  });

  it("should handle multiple entries", () => {
    const entries = [
      makeEntry({ assetId: "BTC", valuationEur: new Decimal("40000") }),
      makeEntry({ assetId: "ETH", valuationEur: new Decimal("20000"), description: "Ethereum" }),
    ];
    const result = generateModelo721(entries, baseConfig);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3); // 1 summary + 2 detail
  });

  it("should set complementary flag", () => {
    const entries = [makeEntry()];
    const config = { ...baseConfig, isComplementary: true };
    const result = generateModelo721(entries, config);
    const summary = result.split("\n")[0]!;
    expect(summary[120]).toBe("C"); // position 121
  });

  it("should set replacement flag", () => {
    const entries = [makeEntry()];
    const config = { ...baseConfig, isReplacement: true };
    const result = generateModelo721(entries, config);
    const summary = result.split("\n")[0]!;
    expect(summary[121]).toBe("S"); // position 122
  });

  it("should include detail count in summary", () => {
    const entries = [makeEntry(), makeEntry({ assetId: "ETH" })];
    const result = generateModelo721(entries, baseConfig);
    const summary = result.split("\n")[0]!;
    const count = summary.slice(135, 144);
    expect(parseInt(count)).toBe(2);
  });

  describe("Fixed-width text sanitization (control chars)", () => {
    it("replaces control chars in description/exchange with a space, keeping column positions", () => {
      // Broker-supplied free text carrying a newline + tab — these would corrupt
      // the fixed-width record (a newline ends it early) if written raw.
      const entries = [makeEntry({
        description: "Bit\ncoin",
        exchangeName: "Coin\tbase",
      })];
      const result = generateModelo721(entries, baseConfig);
      const detail = result.split("\n")[1]!;

      // Description column 36-75 (0-indexed slice 35..75): the \n is replaced by
      // a space, so the field is "Bit coin" left-padded to 40 — same width.
      const descField = detail.slice(35, 75);
      expect(descField).toBe("Bit coin".padEnd(40, " "));
      expect(descField).not.toContain("\n");

      // Exchange column 190-230 (0-indexed slice 189..230): the \t is replaced by
      // a space, so "Coin base" padded to 41 — same width.
      const exchField = detail.slice(189, 230);
      expect(exchField).toBe("Coin base".padEnd(41, " "));
      expect(exchField).not.toContain("\t");

      // Whole record must still be exactly one line (no embedded newline split it).
      expect(result.split("\n")).toHaveLength(2);
      // Each record is exactly 500 bytes — positions of every later field intact.
      expect(detail.length).toBe(500);
    });

    it("replaces control chars in summary name/contact, keeping column positions", () => {
      const entries = [makeEntry()];
      const config = {
        ...baseConfig,
        surname: "GARCIA\nLOPEZ",
        name: "JUAN",
        contactName: "GARCIA\tLOPEZ, JUAN",
      };
      const result = generateModelo721(entries, config);
      const summary = result.split("\n")[0]!;

      // Name column 18-57 (0-indexed slice 17..57): "GARCIA LOPEZ JUAN" (the \n in
      // surname becomes a space) padded to 40.
      const nameField = summary.slice(17, 57);
      expect(nameField).toBe("GARCIA LOPEZ JUAN".padEnd(40, " "));
      expect(nameField).not.toContain("\n");

      // Contact column 68-107 (0-indexed slice 67..107): \t becomes a space.
      const contactField = summary.slice(67, 107);
      expect(contactField).toBe("GARCIA LOPEZ, JUAN".padEnd(40, " "));
      expect(contactField).not.toContain("\t");

      expect(summary.length).toBe(500);
    });

    it("is byte-identical for clean (control-char-free) input — regression", () => {
      // A clean record must be unchanged by sanitization. These literals are the
      // exact fixed-width output for makeEntry()/baseConfig BEFORE fixedWidthText
      // was introduced — any drift in column positions/widths fails here.
      const entries = [makeEntry()];
      const result = generateModelo721(entries, baseConfig);
      const [summary, detail] = result.split("\n");

      const expectedSummary =
        "1" + "721" + "2025" +
        "12345678A" +                       // NIF (9, right)
        "GARCIA LOPEZ JUAN".padEnd(40, " ") + // Name (18-57)
        "T" +
        "600123456" +                       // Phone (9, right "0")
        "GARCIA LOPEZ, JUAN".padEnd(40, " ") + // Contact (68-107)
        "0000000000001" +                   // Declaration ID
        " " + " " +                          // Complementary, Replacement
        "0000000000000" +                   // Previous ID
        "000000001" +                       // Detail count
        " " + "000000000030000" + "00" +     // Acq sign + value (15,2): 30000.00
        " " + "000000000060000" + "00" +     // Val sign + value (15,2): 60000.00
        "".padEnd(320, " ");                 // Blank 181-500
      expect(summary).toBe(expectedSummary);
      expect(summary!.length).toBe(500);

      const expectedDetail =
        "2" + "721" + "2025" +
        "12345678A" +                       // NIF (9, right)
        "12345678A" +                       // Declared NIF (9, right)
        "".padEnd(9, " ") +                  // Proxy NIF (27-35)
        "Bitcoin".padEnd(40, " ") +          // Description (36-75)
        "1" +                                // Declaration type
        "".padEnd(25, " ") +                 // Reserved 77-101
        "C" +                                // Asset type (crypto)
        "".padEnd(26, " ") +                 // Reserved 103-128
        "US" +                               // Country code (129-130)
        "9" +                                // ID type
        "BTC".padEnd(12, " ") +              // Asset ID (132-143)
        "".padEnd(46, " ") +                 // Reserved 144-189
        "Coinbase".padEnd(41, " ") +         // Exchange name (190-230)
        "".padEnd(184, " ") +                // Reserved 231-414
        "".padEnd(8, " ") +                  // Acquisition date (415-422)
        "M" +                                // Type
        "".padEnd(8, " ") +                  // Sell date (424-431)
        " " + "0000000030000" + "00" +       // Acq sign + value (13,2): 30000.00
        " " + "0000000060000" + "00" +       // Val sign + value (13,2): 60000.00
        " " +                                // Reserved 463
        "000000001" + "500" +                // Quantity (9,3): 1.500
        "".padEnd(1, " ") +                  // Reserved 476
        "10000" +                            // Ownership % (3,2): 100.00
        "".padEnd(18, " ");                  // Blank 483-500
      expect(detail).toBe(expectedDetail);
      expect(detail!.length).toBe(500);
    });
  });

  describe("Negative value sign fields", () => {
    it("should set acquisition sign to N for negative acquisition cost", () => {
      const entries = [makeEntry({
        acquisitionCostEur: new Decimal("-30000"),
        valuationEur: new Decimal("60000"),
      })];
      const result = generateModelo721(entries, baseConfig);
      const detail = result.split("\n")[1]!;
      // Acquisition sign at position 432 (0-indexed: 431)
      expect(detail[431]).toBe("N");
    });

    it("should set valuation sign to N for negative valuation", () => {
      const entries = [
        makeEntry({
          assetId: "ETH",
          valuationEur: new Decimal("-60000"),
          acquisitionCostEur: new Decimal("30000"),
        }),
        makeEntry({
          assetId: "BTC",
          valuationEur: new Decimal("120000"),
          acquisitionCostEur: new Decimal("50000"),
        }),
      ];
      // Total valuation: -60000 + 120000 = 60000 > 50K threshold
      const result = generateModelo721(entries, baseConfig);
      expect(result).not.toBe("");
      // First detail record (ETH) has the negative valuation
      const detail = result.split("\n")[1]!;
      // Valuation sign at position 448 (0-indexed: 447)
      expect(detail[447]).toBe("N");
    });
  });
});

describe("buildModelo721Entries — 721 valuation source of truth", () => {
  const yearEnd = "2025-12-31";
  // 1 USD = 0.9 EUR for the year-end date.
  const rateMap = makeRateMap(yearEnd, { USD: "0.9" });

  it("values a crypto position at the year-end ECB rate", () => {
    const pos = makePosition({ currency: "USD", positionValue: "60000", costBasisMoney: "30000" });
    const { positions, unvaluedCount, totalValueEur } = buildModelo721Entries([pos], rateMap, yearEnd);
    expect(positions).toHaveLength(1);
    expect(unvaluedCount).toBe(0);
    // 60000 USD * 0.9 = 54000 EUR
    expect(totalValueEur.toString()).toBe("54000");
    expect(positions[0]!.valuationEur!.toString()).toBe("54000");
    expect(positions[0]!.entry.valuationEur.toString()).toBe("54000");
    // costBasisMoney 30000 USD * 0.9 = 27000 EUR
    expect(positions[0]!.entry.acquisitionCostEur.toString()).toBe("27000");
  });

  it("excludes CASH (fiat) positions — those belong in Modelo 720", () => {
    const crypto = makePosition({ assetCategory: "CRYPTO", currency: "USD" });
    const cash = makePosition({ assetCategory: "CASH", currency: "USD", symbol: "USD", description: "US Dollar" });
    const { positions } = buildModelo721Entries([crypto, cash], rateMap, yearEnd);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.entry.assetId).toBe("BTC");
  });

  it("excludes positions with non-positive value", () => {
    const zero = makePosition({ positionValue: "0" });
    const negative = makePosition({ positionValue: "-100" });
    const { positions } = buildModelo721Entries([zero, negative], rateMap, yearEnd);
    expect(positions).toHaveLength(0);
  });

  it("counts positions whose currency has no resolvable rate as unvalued (null valuation)", () => {
    // BTC has no ECB rate → null. USD resolves.
    const btc = makePosition({ currency: "BTC", symbol: "BTC", description: "Bitcoin", positionValue: "1" });
    const usdc = makePosition({ currency: "USD", symbol: "ADA", description: "Cardano", positionValue: "1000" });
    const { positions, unvaluedCount, totalValueEur } = buildModelo721Entries([btc, usdc], rateMap, yearEnd);
    expect(positions).toHaveLength(2);
    expect(unvaluedCount).toBe(1);
    const btcEntry = positions.find((p) => p.entry.assetId === "BTC")!;
    expect(btcEntry.valuationEur).toBeNull();
    expect(btcEntry.entry.valuationEur.toString()).toBe("0");
    expect(btcEntry.entry.acquisitionCostEur.toString()).toBe("0");
    // Only the resolvable USD position contributes: 1000 * 0.9 = 900
    expect(totalValueEur.toString()).toBe("900");
  });

  it("leaves exchange and country blank (never derived from the ISIN prefix)", () => {
    // An ISIN starting with "US" must NOT leak into exchange/country.
    const pos = makePosition({ isin: "US0000000000", currency: "USD" });
    const { positions } = buildModelo721Entries([pos], rateMap, yearEnd);
    expect(positions[0]!.entry.exchangeName).toBe("");
    expect(positions[0]!.entry.countryCode).toBe("");
  });

  it("falls back to description/isin when symbol is empty", () => {
    const pos = makePosition({ symbol: "", description: "", isin: "CRYPTO-XYZ", currency: "USD" });
    const { positions } = buildModelo721Entries([pos], rateMap, yearEnd);
    expect(positions[0]!.entry.assetId).toBe("CRYPTO-XYZ");
    expect(positions[0]!.entry.description).toBe("CRYPTO-XYZ");
  });
});
