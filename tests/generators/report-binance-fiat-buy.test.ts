import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import { binanceParser } from "../../src/parsers/binance.js";
import type { FlexStatement } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// End-to-end: real Binance parser output → generateTaxReport. Proves the
// user-visible symptom of issue/PR #221 is actually fixed — a "Buy Crypto With
// Fiat" purchase creates a FIFO lot, so a LATER disposal of that coin is taxed
// on its real cost basis instead of fabricating a phantom "Venta sin lotes"
// (fifo.sell_without_lots, cost basis 0 → full proceeds taxed as gain).

const TX_HEADER = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark";

function toStatement(parsed: ReturnType<typeof binanceParser.parse>): FlexStatement {
  return {
    accountId: "", fromDate: "", toDate: "", period: "",
    trades: parsed.trades,
    cashTransactions: parsed.cashTransactions,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    ...(parsed.manualRateHints ? { manualRateHints: parsed.manualRateHints } : {}),
  };
}

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

describe("Binance 'Buy Crypto With Fiat' → FIFO lot via generateTaxReport (PR #221)", () => {
  it("a later SELL of a fiat-bought coin finds its lot — no phantom 'sell_without_lots'", () => {
    // Buy 0.05 BTC for 2499 EUR (Jan), then sell all 0.05 BTC for 3000 EUR (Jun).
    const csv = [
      TX_HEADER,
      "1,2025-01-10 23:03:54,Spot,Buy Crypto With Fiat,BTC,0.05,Via CashBalance - Wallet/N001",
      "1,2025-01-10 23:03:55,Spot,Buy Crypto With Fiat,EUR,-2499,Via CashBalance - Wallet/N001",
      "1,2025-06-01 10:00:00,Spot,Binance Convert,BTC,-0.05,",
      "1,2025-06-01 10:00:01,Spot,Binance Convert,EUR,3000,",
    ].join("\n");
    const statement = toStatement(binanceParser.parse(csv));
    const report = generateTaxReport(statement, makeRateMap({ "2025-06-01": { EUR: "1" } }), 2025);

    // The disposal must consume the 2499 EUR lot — NOT phantom cost-basis 0.
    expect(report.messages.some((m) => m.id === "fifo.sell_without_lots")).toBe(false);
    expect(report.messages.some((m) => m.id === "fifo.insufficient_lots")).toBe(false);
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("2499.00");
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("3000.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("501.00"); // 3000 − 2499
  });

  it("PINS the pre-fix bug: an unhandled buy op leaves no lot → phantom max gain", () => {
    // Same SELL, but the acquiring buy uses an operation the parser does NOT
    // handle (simulating the pre-fix state where "Buy Crypto With Fiat" fell
    // through). The BTC then has no lot → fifo.sell_without_lots, cost basis 0,
    // and the full 3000 EUR proceeds are taxed as gain. This documents exactly
    // the failure mode the fix removes.
    const csv = [
      TX_HEADER,
      "1,2025-01-10 23:03:54,Spot,Totally Unknown Op,BTC,0.05,Via CashBalance - Wallet/N001",
      "1,2025-01-10 23:03:55,Spot,Totally Unknown Op,EUR,-2499,Via CashBalance - Wallet/N001",
      "1,2025-06-01 10:00:00,Spot,Binance Convert,BTC,-0.05,",
      "1,2025-06-01 10:00:01,Spot,Binance Convert,EUR,3000,",
    ].join("\n");
    const statement = toStatement(binanceParser.parse(csv));
    const report = generateTaxReport(statement, makeRateMap({ "2025-06-01": { EUR: "1" } }), 2025);

    expect(report.messages.some((m) => m.id === "fifo.sell_without_lots")).toBe(true);
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("3000.00"); // phantom max gain
  });
});
