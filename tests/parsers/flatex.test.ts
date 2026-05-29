import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flatexParser } from "../../src/parsers/flatex.js";
import { detectBroker } from "../../src/parsers/index.js";

const depotCsv = readFileSync(
  new URL("../fixtures/flatex-depotumsaetze-sample.csv", import.meta.url),
  "utf-8",
);
const kontoCsv = readFileSync(
  new URL("../fixtures/flatex-kontoumsaetze-sample.csv", import.meta.url),
  "utf-8",
);

describe("flatexParser — detection", () => {
  it("detects the Depotumsätze (securities) export", () => {
    expect(flatexParser.detect(depotCsv)).toBe(true);
  });

  it("detects the Kontoumsätze (account) export", () => {
    expect(flatexParser.detect(kontoCsv)).toBe(true);
  });

  it("does not detect unrelated CSV", () => {
    expect(flatexParser.detect("Date,Amount,Currency\n2025-01-01,100,EUR")).toBe(false);
  });

  it("is reachable through the broker registry for both files", () => {
    expect(detectBroker(depotCsv)?.name).toBe("Flatex");
    expect(detectBroker(kontoCsv)?.name).toBe("Flatex");
  });

  it("tolerates mangled umlauts in keywords (latin1 → replacement char)", () => {
    const mangled = depotCsv.replace(/Ausführung/g, "Ausf�hrung");
    expect(flatexParser.detect(mangled)).toBe(true);
    expect(() => flatexParser.parse(mangled)).not.toThrow();
  });
});

describe("flatexParser — Depotumsätze trades", () => {
  it("parses every trade except the custody transfer pair", () => {
    const stmt = flatexParser.parse(depotCsv);
    // 7 data rows: 5 real trades + 2 Lagerstellenwechsel (skipped) = 5 trades
    expect(stmt.trades).toHaveLength(5);
    expect(stmt.cashTransactions).toHaveLength(0);
  });

  it("skips Lagerstellenwechsel (custody transfers)", () => {
    const stmt = flatexParser.parse(depotCsv);
    expect(stmt.trades.some((t) => t.isin === "NO0011082075")).toBe(false);
  });

  it("marks negative Nominal as SELL", () => {
    const stmt = flatexParser.parse(depotCsv);
    const prospect = stmt.trades.find((t) => t.isin === "US74348T1025")!;
    expect(prospect.buySell).toBe("SELL");
    expect(prospect.quantity).toBe("-274");
    expect(prospect.openCloseIndicator).toBe("C");
    expect(prospect.proceeds).not.toBe("0");
    expect(prospect.cost).toBe("0");
  });

  it("marks positive Nominal as BUY", () => {
    const stmt = flatexParser.parse(depotCsv);
    const waste = stmt.trades.find((t) => t.isin === "US94106L1098")!;
    expect(waste.buySell).toBe("BUY");
    expect(waste.quantity).toBe("20");
    expect(waste.openCloseIndicator).toBe("O");
    expect(waste.cost).not.toBe("0");
    expect(waste.proceeds).toBe("0");
  });

  it("computes tradeMoney as quantity × price", () => {
    const stmt = flatexParser.parse(depotCsv);
    const waste = stmt.trades.find((t) => t.isin === "US94106L1098")!;
    // 20 × 188.12 = 3762.4
    expect(waste.tradeMoney).toBe("3762.4");
    expect(waste.tradePrice).toBe("188.12");
  });

  it("handles fractional quantities", () => {
    const stmt = flatexParser.parse(depotCsv);
    const etf = stmt.trades.find((t) => t.isin === "IE00BM8R0J59")!;
    expect(etf.quantity).toBe("2.558932");
    expect(etf.buySell).toBe("BUY");
  });

  it("converts DD.MM.YYYY dates to YYYYMMDD", () => {
    const stmt = flatexParser.parse(depotCsv);
    const waste = stmt.trades.find((t) => t.isin === "US94106L1098")!;
    expect(waste.tradeDate).toBe("20251229");
  });

  it("carries currency and order id", () => {
    const stmt = flatexParser.parse(depotCsv);
    const waste = stmt.trades.find((t) => t.isin === "US94106L1098")!;
    expect(waste.currency).toBe("EUR");
    expect(waste.tradeID).toBe("4666297928");
  });
});

describe("flatexParser — Kontoumsätze cash", () => {
  it("extracts only dividends and distributions (skips trades and transfers)", () => {
    const stmt = flatexParser.parse(kontoCsv);
    // 6 dividends + 2 distributions = 8; trades (Ausführung) and ENTRE CUENTAS skipped
    expect(stmt.trades).toHaveLength(0);
    expect(stmt.cashTransactions).toHaveLength(8);
    expect(stmt.cashTransactions.every((c) => c.type === "Dividends")).toBe(true);
  });

  it("extracts the ISIN embedded in the description", () => {
    const stmt = flatexParser.parse(kontoCsv);
    const div = stmt.cashTransactions.find((c) => c.amount === "60.75")!;
    expect(div.isin).toBe("ES0178430E18");
  });

  it("treats Erträgnisausschüttung (ETF distribution) as a dividend", () => {
    const stmt = flatexParser.parse(kontoCsv);
    const distribution = stmt.cashTransactions.find((c) => c.amount === "8.94")!;
    expect(distribution.type).toBe("Dividends");
    expect(distribution.isin).toBe("US74348T1025");
  });

  it("skips ENTRE CUENTAS transfers", () => {
    const stmt = flatexParser.parse(kontoCsv);
    expect(stmt.cashTransactions.some((c) => /entre cuentas/i.test(c.description))).toBe(false);
  });

  it("skips Ausführung ORDER cash legs (they belong to Depotumsätze)", () => {
    const stmt = flatexParser.parse(kontoCsv);
    expect(stmt.cashTransactions.some((c) => /ausf.hrung/i.test(c.description))).toBe(false);
  });

  it("parses EU number amounts correctly", () => {
    const stmt = flatexParser.parse(kontoCsv);
    const div = stmt.cashTransactions.find((c) => c.isin === "US7170811035")!;
    expect(div.amount).toBe("15.69");
    expect(div.currency).toBe("EUR");
  });
});

describe("flatexParser — errors", () => {
  it("throws on empty input", () => {
    expect(() => flatexParser.parse("Buchtag;Betrag\n")).toThrow(/vac/i);
  });

  it("throws on unrecognized format", () => {
    expect(() => flatexParser.parse("foo;bar;baz\n1;2;3")).toThrow(/no reconocido/i);
  });
});
