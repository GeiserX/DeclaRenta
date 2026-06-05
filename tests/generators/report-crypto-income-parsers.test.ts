import { describe, it, expect } from "vitest";
import { generateTaxReport } from "../../src/generators/report.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import type { FlexStatement } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// End-to-end: real parser output → generateTaxReport, proving crypto reward
// income lands in the correct casilla bucket. Fixtures anonymized (synthetic
// txids/assets, no NIF/names).

function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

function toStatement(parsed: ReturnType<typeof coinbaseParser.parse>): FlexStatement {
  return {
    accountId: "", fromDate: "", toDate: "", period: "",
    trades: parsed.trades,
    cashTransactions: parsed.cashTransactions,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    ...(parsed.manualRateHints ? { manualRateHints: parsed.manualRateHints } : {}),
    ...(parsed.parserMessages ? { parserMessages: parsed.parserMessages } : {}),
  };
}

const COINBASE_HEADER =
  "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";

const COINBASE_CSV = [
  COINBASE_HEADER,
  "2024-08-01T08:00:00Z,Staking Income,ETH,0.01,EUR,3200.00,32.00,32.00,0.00,Staking reward",
  "2024-11-01T07:30:00Z,Learning Reward,GRT,5.00,EUR,0.20,1.00,1.00,0.00,Earned GRT",
  "2024-12-01T20:00:00Z,Rewards Income,ALGO,10.00,EUR,0.15,1.50,1.50,0.00,ALGO rewards",
].join("\n");

const KRAKEN_LEDGERS = [
  '"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"',
  '"LID3","REFID2","2024-06-01 00:00:00","staking","","currency","XETH","0.025","0.0001","5.025"',
  '"LID4","REFID3","2024-07-15 12:00:00","staking","","currency","DOT","1.5","0.01","100.0"',
].join("\n");

describe("Coinbase reward income → correct casilla via generateTaxReport", () => {
  it("routes staking + rewards income to interest (Casilla 0027), learning to generalGains (0304)", () => {
    const statement = toStatement(coinbaseParser.parse(COINBASE_CSV));
    const report = generateTaxReport(statement, new Map(), 2024);

    // Staking (32) + Rewards Income (1.50) → savings base, Casilla 0027.
    expect(report.interest.earned.toFixed(2)).toBe("33.50");

    // Learning reward (1.00) → base general, Casilla 0304 — NOT interest.
    expect(report.generalGains.total.toFixed(2)).toBe("1.00");
    expect(report.generalGains.entries).toHaveLength(1);
    expect(report.generalGains.entries[0]!.symbol).toBe("GRT");
  });

  it("surfaces an info message about the rewards-income classification assumption", () => {
    const statement = toStatement(coinbaseParser.parse(COINBASE_CSV));
    const report = generateTaxReport(statement, new Map(), 2024);
    expect(report.messages.some((m) => m.id === "coinbase.rewards_income_classification" && m.severity === "info")).toBe(true);
  });

  it("taxes a later sale of a reward coin only on appreciation (cost-basis lot from EUR value)", () => {
    // Receive 0.01 ETH staking valued 32 EUR (3200 EUR/ETH), later sell it for 40 EUR.
    const csv = [
      COINBASE_HEADER,
      "2024-08-01T08:00:00Z,Staking Income,ETH,0.01,EUR,3200.00,32.00,32.00,0.00,Staking reward",
      "2024-10-01T08:00:00Z,Sell,ETH,0.01,EUR,4000.00,40.00,40.00,0.00,Sold ETH",
    ].join("\n");
    const statement = toStatement(coinbaseParser.parse(csv));
    const report = generateTaxReport(statement, makeRateMap({ "2024-10-01": { EUR: "1" } }), 2024);
    expect(report.capitalGains.disposals).toHaveLength(1);
    // Gain = 40 proceeds − 32 cost basis = 8, not the full 40 (no double tax).
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("32.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("8.00");
    // The 32 EUR was already taxed as ahorro income.
    expect(report.interest.earned.toFixed(2)).toBe("32.00");
  });
});

describe("Kraken coin-denominated staking → correct handling via generateTaxReport", () => {
  it("surfaces unvalued staking when the reward coin has no ECB/manual rate", () => {
    const parsed = krakenParser.parse(KRAKEN_LEDGERS);
    const statement: FlexStatement = {
      accountId: "", fromDate: "", toDate: "", period: "",
      trades: parsed.trades, cashTransactions: parsed.cashTransactions,
      corporateActions: [], openPositions: [], securitiesInfo: [],
    };
    const report = generateTaxReport(statement, new Map(), 2024);
    // No rate for ETH/DOT → not added to interest, surfaced for manual entry.
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
    expect(report.messages.some((m) => m.id === "report.crypto_income_unvalued")).toBe(true);
  });

  it("values Kraken staking via a manual rate when supplied", () => {
    const parsed = krakenParser.parse(KRAKEN_LEDGERS);
    const statement: FlexStatement = {
      accountId: "", fromDate: "", toDate: "", period: "",
      trades: parsed.trades, cashTransactions: parsed.cashTransactions,
      corporateActions: [], openPositions: [], securitiesInfo: [],
    };
    // ETH 0.0249 net @ 3000 EUR ≈ 74.70; DOT 1.49 net @ 5 EUR ≈ 7.45 → ~82.15.
    const manualRates = makeRateMap({
      "2024-06-01": { ETH: "3000" },
      "2024-07-15": { DOT: "5" },
    });
    const report = generateTaxReport(statement, new Map(), 2024, { manualRates });
    expect(report.interest.earned.toNumber()).toBeGreaterThan(80);
    expect(report.messages.some((m) => m.id === "report.crypto_income_unvalued")).toBe(false);
  });
});
