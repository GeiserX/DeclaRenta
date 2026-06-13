import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { generateTaxReport } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { degiroParser } from "../../src/parsers/degiro.js";
import { binanceParser } from "../../src/parsers/binance.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { krakenParser } from "../../src/parsers/kraken.js";
import { trading212Parser } from "../../src/parsers/trading212.js";
import { parseRevolutXlsx } from "../../src/parsers/revolut.js";
import type { FlexStatement } from "../../src/types/ibkr.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: fixture file → broker parser → generateTaxReport → CASILLA NUMBERS
// ---------------------------------------------------------------------------
// These tests are REGRESSION ANCHORS for the full pipeline. They pin the
// NUMERIC and STRUCTURAL outputs (capital-gain net, dividend gross/withholding,
// interest totals, FX totals, disposal counts) — never human-readable message
// TEXT, which is being migrated to i18n (only stable message IDs are asserted).
// The ECB rate map is built in-memory exactly like the generator unit tests
// (tests/generators/*) — no network fetch ever happens.
// ===========================================================================

/** Build an in-memory ECB rate map (date → currency → "EUR per 1 FCY"). */
function makeRateMap(rates: Record<string, Record<string, string>>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, currencies] of Object.entries(rates)) {
    map.set(date, new Map(Object.entries(currencies)));
  }
  return map;
}

/** Wrap a parser `Statement` into the `FlexStatement` shape generateTaxReport expects. */
function toStatement(parsed: Statement): FlexStatement {
  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades: parsed.trades,
    cashTransactions: parsed.cashTransactions,
    corporateActions: parsed.corporateActions,
    openPositions: parsed.openPositions,
    securitiesInfo: parsed.securitiesInfo,
    ...(parsed.manualRateHints ? { manualRateHints: parsed.manualRateHints } : {}),
    ...(parsed.parserMessages ? { parserMessages: parsed.parserMessages } : {}),
  };
}

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");
}

function fixtureBuffer(name: string): Buffer {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
}

// ---------------------------------------------------------------------------
// IBKR (XML) — ibkr-sample.xml: 1 STK buy+sell pair (USD) + 1 dividend with WHT
// ---------------------------------------------------------------------------

describe("IBKR ibkr-sample.xml → casillas", () => {
  // ACME: BUY 10 @150 USD 2024-03-15, SELL 10 @175 USD 2024-09-20.
  // Cost converts at the SALE-date rate (DGT V2422-20): 10×150×0.91 = 1365.
  // Proceeds: 10×175×0.91 = 1592.50. Dividend 5 USD @0.93 = 4.65; WHT 0.75 @0.93 = 0.6975.
  const rates = makeRateMap({
    "2024-03-15": { USD: "0.92" },
    "2024-09-20": { USD: "0.91" },
    "2024-06-15": { USD: "0.93" },
  });
  const report = generateTaxReport(toStatement(parseIbkrFlexXml(fixture("ibkr-sample.xml"))), rates, 2024);

  it("pins capital-gain net (Casillas 0328/0331): 1592.50 − 1365.00 = 227.50", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("1592.50");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("1365.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("227.50");
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
  });

  it("pins dividend gross income (Casilla 0029) = 4.65 with US withholding 0.70", () => {
    expect(report.dividends.entries).toHaveLength(1);
    expect(report.dividends.grossIncome.toFixed(2)).toBe("4.65");
    const div = report.dividends.entries[0]!;
    expect(div.grossAmountEur.toFixed(4)).toBe("4.6500");
    expect(div.withholdingTaxEur.toFixed(4)).toBe("0.6975");
    expect(div.withholdingCountry).toBe("US");
  });

  it("pins double-taxation deduction (Casilla 0588) capped at 0.70 for US", () => {
    // Foreign tax paid 0.6975; Art. 80 cap (effective Spanish rate on the small
    // savings base) rounds the deduction to 0.70.
    expect(report.doubleTaxation.deduction.toFixed(2)).toBe("0.70");
    expect(Object.keys(report.doubleTaxation.byCountry)).toEqual(["US"]);
  });

  it("has no interest, no general gains, no FX disposals (securities-only USD)", () => {
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
    expect(report.interest.paid.toFixed(2)).toBe("0.00");
    expect(report.generalGains.total.toFixed(2)).toBe("0.00");
    expect(report.fxGains.disposals).toHaveLength(0);
    expect(report.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// Degiro (CSV account) — degiro-account-sample.csv: 4 dividends + 4 withholdings
// ---------------------------------------------------------------------------

describe("Degiro degiro-account-sample.csv → dividend casillas", () => {
  // ALPHA 2.42 USD @0.91 = 2.2022; BETA 4.00 USD @0.90 = 3.60;
  // GAMMA 12.50 EUR = 12.50; DELTA 62.38 EUR = 62.38. Σ = 80.6822 → 80.68.
  // WHT: 0.4641 + 0.90 + 2.38 + 11.85 = 15.5941 foreign tax paid.
  const rates = makeRateMap({
    "2024-01-12": { USD: "0.91" },
    "2024-01-05": { USD: "0.90" },
    "2024-01-04": { USD: "0.90" },
    "2024-05-25": { USD: "0.92" },
  });
  const report = generateTaxReport(toStatement(degiroParser.parse(fixture("degiro-account-sample.csv"))), rates, 2024);

  it("pins gross dividend income (Casilla 0029) = 80.68 across 4 issuers", () => {
    expect(report.dividends.entries).toHaveLength(4);
    expect(report.dividends.grossIncome.toFixed(2)).toBe("80.68");
  });

  it("pins per-issuer gross/withholding EUR amounts", () => {
    // Degiro carries the issuer name in `symbol` (description is the generic
    // "Dividendo"). ALPHA pays in USD (converted), DELTA in EUR (1:1).
    const byIssuer = new Map(report.dividends.entries.map((d) => [d.symbol, d]));
    const alpha = byIssuer.get("ALPHA SEMICON ADR")!;
    const delta = byIssuer.get("DELTA INSURANCE SA")!;
    expect(alpha.grossAmountEur.toFixed(4)).toBe("2.2022");
    expect(alpha.withholdingTaxEur.toFixed(4)).toBe("0.4641");
    expect(delta.grossAmountEur.toFixed(2)).toBe("62.38");
    expect(delta.withholdingTaxEur.toFixed(2)).toBe("11.85");
  });

  it("pins double-taxation: 15.5941 foreign tax paid, deduction Art.80-capped at 12.10", () => {
    const xx = report.doubleTaxation.byCountry["XX"]!;
    expect(xx.taxPaid.toFixed(4)).toBe("15.5941");
    // Art. 80 caps the deduction below the full foreign tax: the effective
    // Spanish rate on this savings base limits it to 12.1023.
    expect(report.doubleTaxation.deduction.toFixed(2)).toBe("12.10");
    expect(xx.deductionAllowed.toFixed(4)).toBe("12.1023");
  });

  it("has no capital-gain disposals (account file is dividends-only)", () => {
    expect(report.capitalGains.disposals).toHaveLength(0);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// Binance (CSV Trade History) — binance-sample.csv: BTC buy+sell (EUR) + ETH buy
// ---------------------------------------------------------------------------

describe("Binance binance-sample.csv → capital-gain casilla", () => {
  // BTC BUY 0.05 @42000 EUR (2024-01-15) → cost 2100; SELL 0.05 @48000 EUR
  // (2024-06-20) → proceeds 2400; net 300. ETH buy is an open lot (no disposal).
  // EUR-denominated, so rate = 1 on the sale date.
  const rates = makeRateMap({ "2024-06-20": { EUR: "1" } });
  const report = generateTaxReport(toStatement(binanceParser.parse(fixture("binance-sample.csv"))), rates, 2024);

  it("pins BTC capital gain: 2400 − 2100 = 300.00 EUR, one disposal", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("2400.00");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("2100.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("300.00");
  });

  it("has no dividends, interest, general gains, or FX (pure crypto EUR trades)", () => {
    expect(report.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
    expect(report.generalGains.total.toFixed(2)).toBe("0.00");
    expect(report.fxGains.disposals).toHaveLength(0);
  });

  it("splits every amount when titulares = 2 (Art. 11.3 LIRPF)", () => {
    const split = generateTaxReport(
      toStatement(binanceParser.parse(fixture("binance-sample.csv"))),
      rates,
      2024,
      { titulares: 2 },
    );
    // Each contribuyente declares half: 1200 / 1050 / 150.
    expect(split.capitalGains.transmissionValue.toFixed(2)).toBe("1200.00");
    expect(split.capitalGains.acquisitionValue.toFixed(2)).toBe("1050.00");
    expect(split.capitalGains.netGainLoss.toFixed(2)).toBe("150.00");
    expect(split.messages.some((m) => m.id === "report.titularidad_compartida")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coinbase (CSV v1) — coinbase-sample.csv: BTC buy+sell (EUR) + ETH staking income
// ---------------------------------------------------------------------------

describe("Coinbase coinbase-sample.csv → capital-gain + interest casillas", () => {
  // BTC BUY 0.05, Total 2139 incl. fees (2024-03-15); SELL 0.05, Total 2360
  // net of fees (2024-09-20) → net 221. Staking income 32 EUR (ahorro bucket →
  // Casilla 0027 interest). EUR-denominated → rate 1.
  const rates = makeRateMap({
    "2024-09-20": { EUR: "1" },
    "2024-06-01": { EUR: "1" },
  });
  const report = generateTaxReport(toStatement(coinbaseParser.parse(fixture("coinbase-sample.csv"))), rates, 2024);

  it("pins BTC capital gain net (fee-inclusive cost basis): 2360 − 2139 = 221.00", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("2360.00");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("2139.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("221.00");
  });

  it("pins staking income as interest (Casilla 0027) = 32.00 EUR, ahorro bucket", () => {
    expect(report.interest.earned.toFixed(2)).toBe("32.00");
    expect(report.interest.entries).toHaveLength(1);
    // Staking is rendimiento del capital mobiliario (ahorro), NOT a base-general gain.
    expect(report.generalGains.total.toFixed(2)).toBe("0.00");
  });

  it("has no dividends and no FX disposals", () => {
    expect(report.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(report.fxGains.disposals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Kraken (CSV trades) — kraken-trades-sample.csv: BTC buy + ETH sell (no prior lot)
// ---------------------------------------------------------------------------

describe("Kraken kraken-trades-sample.csv → capital-gain casilla (incomplete-data case)", () => {
  // BTC BUY 0.05 @42000 EUR (2024-03-15) — an OPEN lot, no disposal in 2024.
  // ETH SELL 1.0 @3200 EUR (2024-09-20) — has NO prior BTC/ETH lot in this file,
  // so the engine fires fifo.sell_without_lots and conservatively taxes the full
  // proceeds (cost basis 0). This is the documented "data window gap" behavior:
  // the user's export does not cover the original ETH acquisition. It is a
  // REGRESSION ANCHOR for that conservative (never understates tax) path.
  const rates = makeRateMap({ "2024-09-20": { EUR: "1" } });
  const report = generateTaxReport(toStatement(krakenParser.parse(fixture("kraken-trades-sample.csv"))), rates, 2024);

  it("pins one disposal with cost basis 0 → full proceeds taxed (3196.50 net)", () => {
    expect(report.capitalGains.disposals).toHaveLength(1);
    // Proceeds 3200 − 3.50 fee = 3196.50; no lot → cost basis 0.
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("3196.50");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("0.00");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("3196.50");
  });

  it("surfaces the missing-lot warning (stable message ID, not text)", () => {
    expect(report.messages.some((m) => m.id === "fifo.sell_without_lots")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Revolut (XLSX) — revolut-sample.xlsx: 2 BTC buy+sell pairs (USD-priced crypto)
// ---------------------------------------------------------------------------

describe("Revolut revolut-sample.xlsx → capital-gain casilla", () => {
  // Two matched BTC lots, both acquired 2020-01-01, sold 2020-02-10 and
  // 2020-09-18. BTC is priced in USD: cost converts at the ACQUISITION-date rate
  // (real EUR paid, Art. 35.1), proceeds at the disposal-date rate. The
  // resulting net is small and deterministic — a regression anchor for the
  // cross-currency crypto valuation path through the full pipeline.
  let report: ReturnType<typeof generateTaxReport>;

  it("parses + reports without throwing, producing 2 disposals", async () => {
    const parsed = await parseRevolutXlsx(fixtureBuffer("revolut-sample.xlsx"));
    const rates = makeRateMap({
      "2020-01-01": { USD: "0.89" },
      "2020-02-10": { USD: "0.91" },
      "2020-09-18": { USD: "0.85" },
    });
    report = generateTaxReport(toStatement(parsed), rates, 2020);
    expect(report.capitalGains.disposals).toHaveLength(2);
  });

  it("pins the aggregate capital gain: 42.59 − 41.02 = 1.58 EUR", () => {
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("42.59");
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("41.02");
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("1.58");
    expect(report.capitalGains.blockedLosses.toFixed(2)).toBe("0.00");
  });

  it("has no dividends or interest (closed-positions-only file)", () => {
    expect(report.dividends.grossIncome.toFixed(2)).toBe("0.00");
    expect(report.interest.earned.toFixed(2)).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// Trading 212 (CSV) — trading212-dividends-sample.csv: 5 dividends (USD + EUR),
// 3 withholdings, plus the acquiring stock buys.
// ---------------------------------------------------------------------------

describe("Trading 212 trading212-dividends-sample.csv → dividend casillas", () => {
  // Five dividends in 2025:
  //   ORIO 9.71 USD @0.92 = 8.9332 (WHT 1.46 USD @0.92 = 1.3432)
  //   NOVA 5.50 EUR        = 5.5000 (no WHT)
  //   HELI 11.20 EUR       = 11.2000 (WHT 2.95 EUR = 2.95)
  //   VEGA 1.53 USD @0.86  = 1.3158 (WHT 0.23 USD @0.86 = 0.1978)
  //   ORIO 12.98 USD @0.85 = 11.0330 (special, no WHT)
  // Σ gross = 37.98. Rates MUST cover the stock-buy dates too, or the crypto
  // valuation pre-pass would warn about un-priced STK lots (not a tax defect,
  // but noise) — these are plain STK securities, never crypto.
  const rates = makeRateMap({
    "2025-01-10": { USD: "0.91" }, // ORIO buy
    "2025-02-12": { USD: "0.91" }, // NOVA buy (EUR, rate unused)
    "2025-02-20": { USD: "0.91" }, // HELI buy (EUR, rate unused)
    "2025-03-18": { USD: "0.91" }, // VEGA buy
    "2025-03-15": { USD: "0.92" }, // ORIO dividend + WHT
    "2025-04-03": { USD: "0.90" }, // NOVA dividend
    "2025-05-08": { USD: "0.89" }, // HELI dividend + WHT
    "2025-06-20": { USD: "0.86" }, // VEGA dividend + WHT
    "2025-07-05": { USD: "0.85" }, // ORIO special dividend
  });
  const report = generateTaxReport(toStatement(trading212Parser.parse(fixture("trading212-dividends-sample.csv"))), rates, 2025);

  it("pins gross dividend income (Casilla 0029) = 37.98 across 5 payments", () => {
    expect(report.dividends.entries).toHaveLength(5);
    expect(report.dividends.grossIncome.toFixed(2)).toBe("37.98");
  });

  it("pins per-payment USD-converted dividend EUR amounts", () => {
    const orioFirst = report.dividends.entries.find((d) => d.symbol === "ORIO" && d.payDate === "2025-03-15")!;
    const vega = report.dividends.entries.find((d) => d.symbol === "VEGA")!;
    expect(orioFirst.grossAmountEur.toFixed(4)).toBe("8.9332");
    expect(orioFirst.withholdingTaxEur.toFixed(4)).toBe("1.3432");
    expect(vega.grossAmountEur.toFixed(4)).toBe("1.3158");
    expect(vega.withholdingTaxEur.toFixed(4)).toBe("0.1978");
  });

  it("does NOT mis-flag these STK dividends as unresolved crypto valuations", () => {
    expect(report.unresolvedCryptoValuations).toBeUndefined();
    expect(report.messages.some((m) => m.id === "report.crypto_valuation_unresolved")).toBe(false);
  });

  it("has no capital-gain disposals (buys are open lots, no sells in this file)", () => {
    expect(report.capitalGains.disposals).toHaveLength(0);
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("0.00");
  });
});
