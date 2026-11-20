import { describe, it, expect } from "vitest";
import { generateTaxReport, reportOptionsForMethod } from "../../src/generators/report.js";
import { localizeHint, localizeMessage, setLocale } from "../../src/i18n/index.js";
import type { CashTransaction, FlexStatement, Trade } from "../../src/types/ibkr.js";
import type { FxMethod, TaxSummary } from "../../src/types/tax.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// A row DeclaRenta leaves out (a number no broker writes, or a value in euros
// it cannot count) must leave out only itself. What it is linked to keeps its
// own place: the principal its sale releases, the lot its sale takes, the
// loss the boxes count for it, and the withholding of its dividend
// (CodeRabbit on 10e1918, #469 and #470). Every case runs through the real
// generateTaxReport.
// ===========================================================================

/** EUR per unit of each currency, by day: `rates[date]` overrides `base`. */
function rateMap(base: Record<string, string>, rates: Record<string, Record<string, string>> = {}): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (let t = Date.UTC(2024, 11, 1); t <= Date.UTC(2026, 0, 31); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    map.set(day, new Map(Object.entries({ ...base, ...(rates[day] ?? {}) })));
  }
  return map;
}

let seq = 0;
function trade(overrides: Partial<Trade>): Trade {
  seq++;
  const tradeDate = overrides.tradeDate ?? "2025-01-15";
  return {
    tradeID: `T${seq}`,
    accountId: "U1",
    symbol: "XYZ",
    description: "XYZ INC",
    isin: "US0000004531",
    assetCategory: "STK",
    currency: "USD",
    tradeDate,
    settlementDate: tradeDate,
    quantity: "10",
    tradePrice: "10",
    tradeMoney: "100",
    proceeds: "-100",
    cost: "100",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: "BUY",
    openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O",
    exchange: "NASDAQ",
    commissionCurrency: overrides.currency ?? "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function stock(date: string, side: "BUY" | "SELL", qty: string, price: string, extra: Partial<Trade> = {}): Trade {
  const money = side === "SELL" ? `-${qty}` : qty;
  return trade({ tradeDate: date, buySell: side, quantity: side === "SELL" ? `-${qty}` : qty, tradePrice: price, tradeMoney: money, ...extra });
}

/** A conversion of `usd` dollars: from euros (`fund`) or to euros. */
function conversion(date: string, usd: string, direction: "fund" | "toEur"): Trade {
  return trade({
    symbol: "EUR.USD",
    description: "EUR.USD",
    isin: "",
    assetCategory: "CASH",
    tradeDate: date,
    quantity: usd,
    tradePrice: "1",
    tradeMoney: usd,
    proceeds: direction === "fund" ? usd : `-${usd}`,
    cost: usd,
    buySell: direction === "fund" ? "SELL" : "BUY",
    openCloseIndicator: "O",
    exchange: "IDEALFX",
  });
}

function cash(id: string, date: string, amount: string, type: CashTransaction["type"]): CashTransaction {
  return {
    transactionID: id,
    accountId: "U1",
    symbol: "XYZ",
    description: "XYZ(US0000004531) Cash Dividend USD 0.50",
    isin: "US0000004531",
    currency: "USD",
    dateTime: date,
    settleDate: date,
    amount,
    fxRateToBase: "1",
    type,
  };
}

function statement(trades: Trade[], cashTransactions: CashTransaction[] = [], toDate = "20251231"): FlexStatement {
  return {
    accountId: "U1",
    fromDate: "20250101",
    toDate,
    period: "Annual",
    trades,
    cashTransactions,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
}

function message(r: TaxSummary, id: string) {
  return r.messages.find((m) => m.id === id);
}

describe("a sale left out releases the principal of its own shares (fx-fifo, CodeRabbit 4634270109)", () => {
  // 100 USD bought at 1.00 € pay the first 10 shares; their sale has a price
  // no broker writes, so FIFO books it with proceeds that are no number. 200
  // USD bought at 0.80 € pay the next 20 shares, sold for 250 USD at 0.90 €,
  // and those 250 USD go back to euros at 0.90 €. Their cost is 200 × 0.80 +
  // 50 × 0.90 = 205 €: a gain of 20 €. A trap: the left-out sale kept its 100
  // USD parked, the second sale released them instead of its own (cost 100 ×
  // 1.00 + 100 × 0.80 + 50 × 0.90 = 225 €) and the gain read 0.
  const rates = rateMap({ USD: "0.90" }, {
    "2025-01-10": { USD: "1.00" },
    "2025-01-15": { USD: "1.05" },
    "2025-03-03": { USD: "0.80" },
    "2025-03-05": { USD: "0.85" },
  });
  const trades = (badPrice: string, badCurrency = "USD") => [
    conversion("2025-01-10", "100", "fund"),
    stock("2025-01-15", "BUY", "10", "10"),
    stock("2025-02-03", "SELL", "10", badPrice, { currency: badCurrency, commissionCurrency: badCurrency }),
    conversion("2025-03-03", "200", "fund"),
    stock("2025-03-05", "BUY", "20", "10"),
    stock("2025-04-01", "SELL", "20", "12.5"),
    conversion("2025-05-02", "250", "toEur"),
  ];

  it("the default gains 20 € on the 250 USD, from the 200 USD that paid the shares sold", () => {
    const r = generateTaxReport(statement(trades("1e25")), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (03/02/2025)");
    expect(r.fxGains.acquisitionValue.toString()).toBe("205");
    expect(r.fxGains.netGainLoss.toString()).toBe("20");
  });

  it("the same holds when the sale left out is in euros, on another listing of the shares", () => {
    for (const method of ["multidivisa", "tradicional-divisa"] as const) {
      const r = generateTaxReport(statement(trades("1e25", "EUR")), rates, 2025, reportOptionsForMethod(method));
      expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("XYZ (03/02/2025)");
      // The 100 USD drifted 0.05 € each up to the shares' purchase: a sale
      // counted nowhere books no currency row for them either.
      for (const d of r.fxGains.disposals) expect(d.disposeDate.startsWith("2025-02-03"), method).toBe(false);
      if (method === "multidivisa") {
        expect(r.fxGains.acquisitionValue.toString()).toBe("205");
        expect(r.fxGains.netGainLoss.toString()).toBe("20");
      }
    }
  });

  it("«Tradicional con divisa» leaves no principal of the second shares parked once they are sold", () => {
    const r = generateTaxReport(statement(trades("1e25")), rates, 2025, reportOptionsForMethod("tradicional-divisa"));
    expect(message(r, "report.trade_out_of_range")).toBeDefined();
    // The 200 USD left inside XYZ drifted 0.05 € each from their purchase to
    // the shares': their own sale declares it. Parked behind the 100 USD of
    // the left-out sale, 100 of them stayed with nothing to release them.
    expect(message(r, "report.fx_traditional_orphan")).toBeUndefined();
    // The left-out sale books no currency row of its own.
    for (const d of r.fxGains.disposals) expect(d.disposeDate.startsWith("2025-02-03")).toBe(false);
  });

  it("a sale whose proceeds are 0 € keeps the default's behaviour (control)", () => {
    // A worthless sale is no left-out row: the default still skips it, as
    // before, and the gain is the old 0 €. Only a sale with no number moves.
    const r = generateTaxReport(statement(trades("0")), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(message(r, "report.trade_out_of_range")).toBeUndefined();
    expect(r.fxGains.netGainLoss.toString()).toBe("0");
  });
});

describe("a loss the boxes count blocks like any other (wash-sale, CodeRabbit 4634270118)", () => {
  // The lot cost 1e12 €, past what the boxes count, so the sale counts its
  // proceeds and no cost: 10 × 0.01 − 5 € of commission = −4.90 €, a loss
  // the boxes subtract. The shares are bought back the next day, so that
  // loss waits (art. 33.5.f LIRPF). A trap: the anti-churning rule read the
  // uncounted cost as "no loss" and let the 4.90 € through.
  const rates = rateMap({ USD: "1" });
  const eur = { currency: "EUR", commissionCurrency: "EUR" };
  const rows = [
    stock("2025-03-01", "BUY", "10", "1e11", eur),
    stock("2025-03-15", "SELL", "10", "0.01", { ...eur, commission: "-5" }),
    stock("2025-03-16", "BUY", "10", "9", eur),
  ];

  it("blocks the 4.90 € the boxes count as a loss", () => {
    const r = generateTaxReport(statement(rows), rates, 2025, reportOptionsForMethod("monodivisa"));
    expect(r.capitalGains.transmissionValue.toString()).toBe("-4.9");
    expect(r.capitalGains.acquisitionValue.toString()).toBe("0");
    expect(r.capitalGains.blockedLosses.toString()).toBe("4.9");
    const sale = r.capitalGains.disposals.find((d) => d.sellDate.startsWith("2025-03-15"))!;
    expect(sale.washSaleBlocked).toBe(true);
    expect(sale.blockedLossEur.toString()).toBe("4.9");
  });

  it("a loss blocked in full raises no warning about the data ending inside its window", () => {
    // The data ends on 20 March, inside the two months after the sale, but a
    // later buy can block no more than the 4.90 € already blocked. A trap:
    // the window check read the raw result (−1e12 €) as a loss still open.
    const r = generateTaxReport(statement(rows, [], "20250320"), rates, 2025, reportOptionsForMethod("monodivisa"));
    expect(r.capitalGains.blockedLosses.toString()).toBe("4.9");
    expect(message(r, "report.antichurning_window_past_data")).toBeUndefined();
    expect(message(r, "report.antichurning_window_open_at_filing")).toBeUndefined();
  });

  it("the same loss with no repurchase still warns that the data ends inside its window (control)", () => {
    const r = generateTaxReport(statement(rows.slice(0, 2), [], "20250320"), rates, 2025, reportOptionsForMethod("monodivisa"));
    expect(r.capitalGains.blockedLosses.toString()).toBe("0");
    const warned = message(r, "report.antichurning_window_past_data") ?? message(r, "report.antichurning_window_open_at_filing");
    expect(warned).toBeDefined();
  });

  it("proceeds the boxes do not count block nothing (control)", () => {
    const r = generateTaxReport(statement([
      stock("2025-03-01", "BUY", "10", "8", eur),
      stock("2025-03-15", "SELL", "10", "1e11", { ...eur, commission: "-5" }),
      stock("2025-03-16", "BUY", "10", "9", eur),
    ]), rates, 2025, reportOptionsForMethod("monodivisa"));
    expect(r.capitalGains.blockedLosses.toString()).toBe("0");
  });
});

describe("a coin sale with no rate for its quote still takes its lot (crypto valuation, CodeRabbit 4634270129)", () => {
  // BTC bought at 300 € and then at 100 €. The first sale is paid in ETH with
  // a price no broker writes, on a day ETH has no rate: it must still take
  // the 300 € coin, so the second sale, for 400 €, takes the 100 € one and
  // gains 300 €. A trap: the valuation dropped the first sale for its missing
  // rate, and the second sale took the 300 € coin and gained only 100 €.
  const rates = rateMap({ USD: "1" });
  const coin = (date: string, side: "BUY" | "SELL", price: string, currency = "EUR") =>
    stock(date, side, "1", price, { symbol: "BTC", description: "BTC", isin: "", assetCategory: "CRYPTO", currency, commissionCurrency: currency, exchange: "BINANCE" });

  it("the 400 € sale gains 300 € from the 100 € coin", () => {
    const r = generateTaxReport(statement([
      coin("2025-01-10", "BUY", "300"),
      coin("2025-02-10", "BUY", "100"),
      coin("2025-03-10", "SELL", "1e25", "ETH"),
      coin("2025-04-10", "SELL", "400"),
    ]), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(message(r, "report.trade_out_of_range")?.context?.rows).toBe("BTC (10/03/2025)");
    const sale = r.capitalGains.disposals.find((d) => d.sellDate.startsWith("2025-04-10"))!;
    expect(sale.costBasisEur.toString()).toBe("100");
    expect(sale.gainLossEur.toString()).toBe("300");
    // Its own rate cannot be typed in: it is named once, as out of range, not
    // as a permuta waiting for a hand-typed price.
    expect(message(r, "report.crypto_valuation_unresolved")).toBeUndefined();
  });

  it("an ordinary sale with no rate for its quote is still left out and named (control)", () => {
    const r = generateTaxReport(statement([
      coin("2025-01-10", "BUY", "300"),
      coin("2025-02-10", "BUY", "100"),
      coin("2025-03-10", "SELL", "20", "ETH"),
      coin("2025-04-10", "SELL", "400"),
    ]), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(message(r, "report.crypto_valuation_unresolved")).toBeDefined();
    const sale = r.capitalGains.disposals.find((d) => d.sellDate.startsWith("2025-04-10"))!;
    expect(sale.costBasisEur.toString()).toBe("300");
  });
});

describe("the withholding of a dividend left out goes with it (dividends, CodeRabbit 4634270137)", () => {
  const rates = rateMap({ USD: "1" });
  const METHODS: FxMethod[] = ["multidivisa", "tradicional-divisa", "monodivisa"];

  for (const [label, amount, named] of [
    ["worth 1e12 € or more", "9e15", "report.cash_amount_too_large"],
    ["with a number no broker writes", "1e2000", "report.trade_out_of_range"],
  ] as const) {
    for (const method of METHODS) {
      it(`a dividend ${label} keeps its 15 USD withholding off the next day's dividend (${method})`, () => {
        // XYZ pays 9e15 USD on 14 March, with 15 USD withheld, and 50 USD on
        // 15 March with nothing withheld. The first is left out; its 15 USD
        // must not become the second's: a trap, the matcher paired it with
        // the only dividend left within 7 days and box 0588 deducted it.
        const r = generateTaxReport(statement([], [
          cash("D1", "2025-03-14", amount, "Dividends"),
          cash("W1", "2025-03-14", "-15", "Withholding Tax"),
          cash("D2", "2025-03-15", "50", "Dividends"),
        ]), rates, 2025, reportOptionsForMethod(method));
        expect(message(r, named)?.context?.rows).toBe("XYZ (14/03/2025)");
        expect(r.dividends.grossIncome.toString()).toBe("50");
        expect(r.dividends.entries.map((e) => e.withholdingTaxEur.toString())).toEqual(["0"]);
        expect(r.doubleTaxation.deduction.toString()).toBe("0");
        const left = message(r, "report.withholding_of_excluded_dividend");
        expect(left?.severity).toBe("warning");
        expect(left?.context).toMatchObject({ count: "1", rows: "XYZ (14/03/2025)" });
      });
    }
  }

  it("a retained dividend keeps its own withholding beside one left out", () => {
    const r = generateTaxReport(statement([], [
      cash("D1", "2025-03-14", "9e15", "Dividends"),
      cash("W1", "2025-03-14", "-15", "Withholding Tax"),
      cash("D2", "2025-03-15", "50", "Dividends"),
      cash("W2", "2025-03-15", "-7.5", "Withholding Tax"),
    ]), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(r.dividends.entries.map((e) => e.withholdingTaxEur.toString())).toEqual(["7.5"]);
    expect(message(r, "report.withholding_of_excluded_dividend")?.context).toMatchObject({ count: "1" });
  });

  it("a refund split between a dividend left out and a kept one stays, so it can only lower the deduction", () => {
    // The 20 USD refund corrects 15 of D1's withholding and 5 of D2's. Its
    // part of D2 must stay; dropping the whole row would give D2 its 10 USD
    // back. Kept, it takes all 10: a deduction of 0, never more than 5.
    const r = generateTaxReport(statement([], [
      cash("D1", "2025-03-14", "9e15", "Dividends"),
      cash("W1", "2025-03-14", "-15", "Withholding Tax"),
      cash("D2", "2025-03-15", "50", "Dividends"),
      cash("W2", "2025-03-15", "-10", "Withholding Tax"),
      cash("R1", "2025-03-14", "20", "Withholding Tax"),
    ]), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(r.dividends.entries.map((e) => e.withholdingTaxEur.toString())).toEqual(["0"]);
    expect(message(r, "report.withholding_of_excluded_dividend")?.context).toMatchObject({ count: "1", rows: "XYZ (14/03/2025)" });
  });

  it("with no dividend left out every withholding stays where it was (control)", () => {
    const r = generateTaxReport(statement([], [
      cash("D1", "2025-03-14", "100", "Dividends"),
      cash("W1", "2025-03-14", "-15", "Withholding Tax"),
      cash("D2", "2025-03-15", "50", "Dividends"),
    ]), rates, 2025, reportOptionsForMethod("multidivisa"));
    expect(r.dividends.entries.map((e) => e.withholdingTaxEur.toString())).toEqual(["15", "0"]);
    expect(message(r, "report.withholding_of_excluded_dividend")).toBeUndefined();
  });

  it("names the withholding left out in the 5 locales", async () => {
    const r = generateTaxReport(statement([], [
      cash("D1", "2025-03-14", "9e15", "Dividends"),
      cash("W1", "2025-03-14", "-15", "Withholding Tax"),
    ]), rates, 2025, reportOptionsForMethod("monodivisa"));
    const m = message(r, "report.withholding_of_excluded_dividend")!;
    expect(localizeMessage(m)).toBe(m.message);
    expect(localizeHint(m)).toBe(m.hint);
    try {
      for (const locale of ["en", "ca", "eu", "gl"] as const) {
        await setLocale(locale);
        expect(localizeMessage(m)).not.toBe(m.message);
        expect(localizeMessage(m)).toContain("XYZ (14/03/2025)");
        expect(localizeHint(m)).not.toBe(m.hint);
      }
    } finally {
      await setLocale("es");
    }
  });
});
