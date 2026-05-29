import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { flatexParser } from "../../src/parsers/flatex.js";
import { detectBroker } from "../../src/parsers/index.js";
import {
  createEmptyStatement,
  mergeStatement,
  finalizeMergedStatement,
} from "../../src/parsers/merge.js";

/** Parse both Flatex files and merge them exactly as the app does. */
function parseBoth() {
  const merged = createEmptyStatement();
  mergeStatement(merged, flatexParser.parse(depotCsv));
  mergeStatement(merged, flatexParser.parse(kontoCsv));
  return finalizeMergedStatement(merged);
}

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

describe("flatexParser — zero guards", () => {
  const header =
    "Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot";

  it("skips decimal-formatted zero quantity rows", () => {
    const csv = `${header}\n1;01.12.2025;01.12.2025;US0000000000;TEST CORP.;0,00;Stk.;Ausführung ORDER Kauf US0000000000 1;1;10,00;EUR;***xxx Depot`;
    expect(flatexParser.parse(csv).trades).toHaveLength(0);
  });

  it("skips decimal-formatted zero price rows", () => {
    const csv = `${header}\n1;01.12.2025;01.12.2025;US0000000000;TEST CORP.;10;Stk.;Ausführung ORDER Kauf US0000000000 1;1;0,00;EUR;***xxx Depot`;
    expect(flatexParser.parse(csv).trades).toHaveLength(0);
  });
});

describe("flatexParser — commission reconciliation (both files)", () => {
  it("does NOT emit trade cash legs as dividends/cash", () => {
    // "Ausführung ORDER" rows are stashed as pendingOrderLegs, not cash txns.
    const stmt = flatexParser.parse(kontoCsv);
    expect(stmt.cashTransactions.some((c) => /ausf.hrung/i.test(c.description))).toBe(false);
    expect(stmt.pendingOrderLegs!.length).toBeGreaterThan(0);
  });

  it("recovers ~7.90 EUR commission on a BUY (cost stays gross, fee separate)", () => {
    const stmt = parseBoth();
    // WASTE MANAGEMENT buy: gross 20 × 188.12 = 3762.4; Konto net -3770.3
    const waste = stmt.trades.find((t) => t.isin === "US94106L1098")!;
    expect(waste.commission).toBe("7.9");
    // IBKR convention: cost/proceeds stay GROSS; FIFO adds commission to basis.
    expect(waste.cost).toBe("3762.4");
    expect(waste.tradeMoney).toBe("3762.4");
  });

  it("recovers ~7.90 EUR commission on a SELL (proceeds stay gross, fee separate)", () => {
    const stmt = parseBoth();
    // PROSPECT sell: gross 274 × 2.082 = 570.468; Konto net +562.57
    const prospect = stmt.trades.find((t) => t.isin === "US74348T1025")!;
    expect(prospect.commission).toBe("7.898");
    expect(prospect.proceeds).toBe("570.468"); // gross; FIFO subtracts the fee
  });

  it("leaves a zero commission when the net cash equals the gross (fractional ETF)", () => {
    const stmt = parseBoth();
    // GLOBAL X ETF buy: gross 2.558932 × 14.084 ≈ 36.04; Konto net -36.04 → fee 0
    const etf = stmt.trades.find((t) => t.isin === "IE00BM8R0J59")!;
    expect(new Decimal(etf.commission).toNumber()).toBeCloseTo(0, 2);
  });

  it("clears the scratch notes key and pendingOrderLegs after reconciliation", () => {
    const stmt = parseBoth();
    expect(stmt.pendingOrderLegs).toBeUndefined();
    expect(stmt.trades.every((t) => !t.notes?.startsWith("flatex-order:"))).toBe(true);
  });

  it("warns when only the Depot file is uploaded (no cash legs to reconcile)", () => {
    const merged = createEmptyStatement();
    mergeStatement(merged, flatexParser.parse(depotCsv));
    const stmt = finalizeMergedStatement(merged);
    expect(
      stmt.parserMessages!.some((m) => m.id === "flatex.commission.unmatched_trades"),
    ).toBe(true);
    // Commission stays zero — it can't be recovered without the Konto file.
    const waste = stmt.trades.find((t) => t.isin === "US94106L1098")!;
    expect(waste.commission).toBe("0");
  });
});

describe("flatexParser — Lagerstellenwechsel warning", () => {
  const depotHeader =
    "Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot";

  it("does NOT warn when in/out legs are balanced (fixture pair nets to zero)", () => {
    const stmt = flatexParser.parse(depotCsv);
    expect(
      (stmt.parserMessages ?? []).some((m) => m.id === "flatex.lagerstellenwechsel.unmatched"),
    ).toBe(false);
  });

  it("warns when a custody transfer leg has no counterpart", () => {
    const csv = `${depotHeader}\n1;12.12.2025;12.12.2025;NO0011082075;HOEEGH;100;Stk.;Lagerstellenwechsel in NO0011082075;4640912524;8,22;EUR;***xxx Depot`;
    const stmt = flatexParser.parse(csv);
    expect(stmt.trades).toHaveLength(0);
    const msg = (stmt.parserMessages ?? []).find(
      (m) => m.id === "flatex.lagerstellenwechsel.unmatched",
    )!;
    expect(msg).toBeDefined();
    expect(msg.severity).toBe("info");
    expect(msg.context?.netQuantity).toBe("100");
    expect(msg.context?.isin).toBe("NO0011082075");
  });
});

describe("flatexParser — dividend country end-to-end", () => {
  it("assigns withholdingCountry ES for a Spanish-ISIN dividend through the engine", async () => {
    const { calculateDividends } = await import("../../src/engine/dividends.js");
    const stmt = flatexParser.parse(kontoCsv);
    const esTx = stmt.cashTransactions.filter((c) => c.isin === "ES0178430E18");
    expect(esTx.length).toBeGreaterThan(0);
    const entries = calculateDividends(esTx, new Map());
    expect(entries[0]!.withholdingCountry).toBe("ES");
  });

  it("assigns withholdingCountry US for a US-ISIN dividend through the engine", async () => {
    const { calculateDividends } = await import("../../src/engine/dividends.js");
    const stmt = flatexParser.parse(kontoCsv);
    const usTx = stmt.cashTransactions.filter((c) => c.isin === "US7170811035");
    expect(usTx.length).toBeGreaterThan(0);
    const entries = calculateDividends(usTx, new Map());
    expect(entries[0]!.withholdingCountry).toBe("US");
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
