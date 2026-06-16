import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { detectWashSales, addMonths } from "../../src/engine/wash-sale.js";
import type { FifoDisposal } from "../../src/types/tax.js";
import type { Trade } from "../../src/types/ibkr.js";

function makeDisposal(overrides: Partial<FifoDisposal>): FifoDisposal {
  return {
    isin: "US0378331005",
    symbol: "AAPL",
    description: "APPLE INC",
    sellDate: "2025-06-15",
    acquireDate: "2025-01-10",
    quantity: new Decimal(10),
    proceedsEur: new Decimal(900),
    costBasisEur: new Decimal(1000),
    gainLossEur: new Decimal(-100),
    holdingPeriodDays: 156,
    currency: "USD",
    sellEcbRate: new Decimal("0.91"),
    acquireEcbRate: new Decimal("0.92"),
    assetCategory: "STK",
    washSaleBlocked: false,
    ...overrides,
  };
}

/**
 * Build a Trade. `quantity` defaults to "10" so every pre-existing call (which
 * passes only isin/date/buySell, where proportional blocking == whole-loss
 * because the repurchase covers the full sold quantity) keeps working unchanged.
 * The proportional-blocking tests pass an explicit quantity to vary the
 * repurchased size against the sold quantity.
 */
function makeTrade(isin: string, date: string, buySell: "BUY" | "SELL", quantity = "10"): Trade {
  return {
    tradeID: "1", accountId: "U1", symbol: "AAPL", description: "APPLE INC",
    isin, assetCategory: "STK", currency: "USD", tradeDate: date,
    settlementDate: date, quantity, tradePrice: "100",
    tradeMoney: "1000", proceeds: "1000", cost: "1000",
    fifoPnlRealized: "0", fxRateToBase: "1", buySell,
    openCloseIndicator: buySell === "BUY" ? "O" : "C",
    exchange: "NASDAQ", commissionCurrency: "USD", commission: "0", taxes: "0", multiplier: "1",
  };
}

describe("addMonths (calendar-clamped)", () => {
  it("clamps Jan 31 + 1 month to the last day of February (non-leap)", () => {
    const result = addMonths(new Date(2025, 0, 31), 1); // 2025-01-31, Feb 2025 = 28d
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28); // clamped, NOT Mar 2/3
  });

  it("clamps Jan 31 + 1 month to Feb 29 in a leap year", () => {
    const result = addMonths(new Date(2024, 0, 31), 1); // 2024-01-31, Feb 2024 = 29d
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(29);
  });

  it("clamps Dec 31 + 2 months to the last day of February next year", () => {
    const result = addMonths(new Date(2025, 11, 31), 2); // 2025-12-31 → Feb 2026
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28); // clamped, NOT Mar 2/3
  });

  it("clamps Mar 31 - 1 month to the last day of February (no overflow)", () => {
    const result = addMonths(new Date(2025, 2, 31), -1); // 2025-03-31 → Feb 2025
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it("preserves the day when the target month is long enough", () => {
    const result = addMonths(new Date(2025, 0, 15), 1); // 2025-01-15 → 2025-02-15
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(15);
  });
});

describe("detectWashSales", () => {
  it("should block loss when repurchased within 2 months after sale", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-07-01", "BUY"), // Repurchase 16 days later
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should block loss when purchased within 2 months before sale", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-05-20", "BUY"), // Purchase 26 days before
      makeTrade("US0378331005", "2025-06-15", "SELL"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should NOT block loss when no repurchase within 2 months", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-01-10", "BUY"), // Original purchase (>2 months before)
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-12-01", "BUY"), // >2 months after
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should NOT block gains", () => {
    const disposals = [makeDisposal({ gainLossEur: new Decimal(200) })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-06-20", "BUY"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should NOT block loss for different ISIN", () => {
    const disposals = [makeDisposal({ sellDate: "2025-06-15", gainLossEur: new Decimal(-100) })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US5949181045", "2025-06-20", "BUY"), // Different ISIN (MSFT)
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should block loss for empty-ISIN trades using symbol fallback", () => {
    const disposals = [makeDisposal({
      isin: "",
      symbol: "AAPL",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "AAPL", isin: "" },
      { ...makeTrade("", "2025-07-01", "BUY"), symbol: "AAPL", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should NOT match empty-ISIN trades with different symbols", () => {
    const disposals = [makeDisposal({
      isin: "",
      symbol: "AAPL",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "AAPL", isin: "" },
      { ...makeTrade("", "2025-07-01", "BUY"), symbol: "MSFT", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should use 1-year window for CRYPTO asset category", () => {
    const disposals = [makeDisposal({
      isin: "",
      symbol: "BTC",
      assetCategory: "CRYPTO",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-500),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "BTC", isin: "", assetCategory: "CRYPTO" as const },
      { ...makeTrade("", "2026-03-01", "BUY"), symbol: "BTC", isin: "", assetCategory: "CRYPTO" as const },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should use 1-year window for unlisted (no-ISIN, non-crypto) asset", () => {
    // STK with NO ISIN → treated as unlisted → 12-month window.
    const disposals = [makeDisposal({
      isin: "",
      symbol: "PRIVCO",
      assetCategory: "STK",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-300),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL"), symbol: "PRIVCO", isin: "" },
      // Repurchase ~9 months later: outside 2mo, inside 12mo window.
      { ...makeTrade("", "2026-03-01", "BUY"), symbol: "PRIVCO", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("should use 2-month window for listed STK with a real ISIN (no 12mo block)", () => {
    const disposals = [makeDisposal({
      isin: "US0378331005",
      symbol: "AAPL",
      assetCategory: "STK",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      // ~9 months later: outside the 2-month listed window → not blocked.
      makeTrade("US0378331005", "2026-03-01", "BUY"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should NOT block loss for options (OPT assetCategory)", () => {
    const disposals = [makeDisposal({
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-500),
      assetCategory: "OPT",
      symbol: "AAPL 250620C00200000",
    })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-06-20", "BUY"), // Same ISIN repurchase
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false); // Options excluded
  });

  it("should skip a disposal with a blank security key (no ISIN, no symbol) without blocking or crashing", () => {
    // homogeneousKey("", "", "STK") === "" → the empty-key guard must return the
    // disposal unchanged, never matching it against unrelated buys.
    const disposals = [makeDisposal({
      isin: "",
      symbol: "",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      // A repurchase that WOULD match if the blank disposal were keyed wrongly.
      { ...makeTrade("", "2025-07-01", "BUY"), symbol: "", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("should skip buys with a blank security key during indexing (buy-side empty-key guard)", () => {
    // A keyed loss must not be blocked by a repurchase that itself has no usable
    // key — the blank-key BUY is dropped from the index, so it can never match.
    const disposals = [makeDisposal({
      isin: "US0378331005",
      symbol: "AAPL",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-100),
    })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      // Blank ISIN + blank symbol → homogeneousKey returns "" → not indexed.
      { ...makeTrade("", "2025-07-01", "BUY"), symbol: "", isin: "" },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("blocks the loss when a qualifying repurchase falls inside the window (deferral case)", () => {
    // Loss + repurchase 16 days later (inside the 2-month listed window) → the
    // loss is disallowed now (deferred to the replacement lot's basis).
    const disposals = [makeDisposal({
      isin: "US0378331005",
      symbol: "AAPL",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-250),
    })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-07-01", "BUY"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("does NOT block the symmetric case when the repurchase falls just outside the window", () => {
    // Same loss, but the only repurchase is > 2 months after the sale → allowed.
    const disposals = [makeDisposal({
      isin: "US0378331005",
      symbol: "AAPL",
      sellDate: "2025-06-15",
      gainLossEur: new Decimal(-250),
    })];
    const trades = [
      makeTrade("US0378331005", "2025-06-15", "SELL"),
      makeTrade("US0378331005", "2025-08-16", "BUY"), // 2025-06-15 + 2mo = 2025-08-15; one day past
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("matches the expected disallowed set on a large indexed input (50+ ops, guards the refactor)", () => {
    // Three securities traded heavily so the per-key index has many candidate
    // buys; only the buys inside each loss's window must block it. This asserts
    // the indexed (binary-search) matcher reproduces the exact disallowed set.
    const AAPL = "US0378331005";
    const MSFT = "US5949181045";
    const TSLA = "US88160R1014";

    const trades: Trade[] = [];
    // AAPL: monthly buys across the whole year (12 buys) — dense window candidates.
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      trades.push(makeTrade(AAPL, `2025-${mm}-10`, "BUY"));
    }
    // MSFT: only two buys, both far from the June sale (Jan and Dec) → no repurchase in window.
    trades.push(makeTrade(MSFT, "2025-01-05", "BUY"));
    trades.push(makeTrade(MSFT, "2025-12-20", "BUY"));
    // TSLA: a single buy on the exact sell date (same-day lot, must NOT count as a repurchase).
    trades.push(makeTrade(TSLA, "2025-06-15", "BUY"));
    // Pad with unrelated SELLs and exempt-category noise to push the op count past 50.
    for (let i = 0; i < 40; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      trades.push(makeTrade(AAPL, `2025-03-${day}`, "SELL"));
      const opt = makeTrade(AAPL, `2025-03-${day}`, "BUY");
      trades.push({ ...opt, assetCategory: "OPT" }); // exempt → ignored by the index
    }
    expect(trades.length).toBeGreaterThan(50);

    const disposals = [
      // 0: AAPL loss in June → blocked (e.g. the 2025-06-10 / 2025-07-10 buys are in window).
      makeDisposal({ isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15", gainLossEur: new Decimal(-100) }),
      // 1: MSFT loss in June → NOT blocked (nearest buys are Jan/Dec, outside 2mo).
      makeDisposal({ isin: MSFT, symbol: "MSFT", sellDate: "2025-06-15", gainLossEur: new Decimal(-100) }),
      // 2: TSLA loss in June → NOT blocked (only buy is same-day → excluded).
      makeDisposal({ isin: TSLA, symbol: "TSLA", sellDate: "2025-06-15", gainLossEur: new Decimal(-100) }),
      // 3: AAPL GAIN in June → never blocked regardless of repurchases.
      makeDisposal({ isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15", gainLossEur: new Decimal(50) }),
      // 4: AAPL loss in January → blocked (2025-01-10 and 2025-02-10 buys are in window).
      makeDisposal({ isin: AAPL, symbol: "AAPL", sellDate: "2025-01-20", gainLossEur: new Decimal(-100) }),
    ];

    const result = detectWashSales(disposals, trades);
    const blocked = result.map((d) => d.washSaleBlocked);
    expect(blocked).toEqual([true, false, false, false, true]);
  });
});

describe("proportional blocking + reintegration", () => {
  const AAPL = "US0378331005";

  it("blocks loss PROPORTIONAL to the repurchased quantity (sell 100, rebuy 30 → 30%)", () => {
    // Sell 100 sh at a €1000 loss; rebuy only 30 within the 2-month window.
    // blockedLossEur = |loss| × 30/100 = €300. The loss on the other 70 is
    // deductible now (DGT V0913-08 "por paquetes").
    const disposals = [makeDisposal({
      isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15",
      quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
    })];
    const trades = [
      makeTrade(AAPL, "2025-06-15", "SELL", "100"),
      makeTrade(AAPL, "2025-07-01", "BUY", "30"), // repurchase 30 sh, 16 days later
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.blockedLossEur.toFixed(2)).toBe("300.00");
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("caps the block at the whole loss when the repurchase ≥ the sold quantity (rebuy 120 ≥ sell 100)", () => {
    // Repurchasing MORE than was sold cannot block more than the loss itself:
    // absorbed is capped at the sold quantity → blockedLossEur === |loss|.
    const disposals = [makeDisposal({
      isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15",
      quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
    })];
    const trades = [
      makeTrade(AAPL, "2025-06-15", "SELL", "100"),
      makeTrade(AAPL, "2025-07-01", "BUY", "120"), // rebuy 120 > 100 sold
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.blockedLossEur.toFixed(2)).toBe("1000.00");
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("blocks NOTHING when there is no repurchase at all", () => {
    const disposals = [makeDisposal({
      isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15",
      quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
    })];
    const trades = [
      makeTrade(AAPL, "2025-06-15", "SELL", "100"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.blockedLossEur.toFixed(2)).toBe("0.00");
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("blocks NOTHING when the repurchase falls outside the window (listed ISIN, 2-month window)", () => {
    // Listed STK with a real ISIN → 2-month window. A repurchase 3 months later
    // is outside it, so the proportional block is zero.
    const disposals = [makeDisposal({
      isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15",
      quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
    })];
    const trades = [
      makeTrade(AAPL, "2025-06-15", "SELL", "100"),
      makeTrade(AAPL, "2025-09-16", "BUY", "30"), // 2025-06-15 + 2mo = 2025-08-15; ~3 months out
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.blockedLossEur.toFixed(2)).toBe("0.00");
    expect(result[0]!.washSaleBlocked).toBe(false);
  });

  it("consumes ONE repurchase budget across TWO loss-sales without double-counting (50-sh budget → 500 total)", () => {
    // Two €1000 loss-sales of 100 sh each (same ISIN), but only ONE 50-share
    // repurchase inside both windows. The 50-share budget absorbs 50 sh of loss
    // ONCE (DGT V2481-20: "no puede una misma compra determinar la no imputación
    // de varias pérdidas"). Total blocked = |loss| × 50/100 of ONE sale = €500,
    // NOT €1000. The budget is consumed chronologically: the EARLIER sale
    // (2025-06-15) gets the €500 block; the LATER sale (2025-07-20) gets €0.
    const disposals = [
      makeDisposal({
        isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15",
        quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
      }),
      makeDisposal({
        isin: AAPL, symbol: "AAPL", sellDate: "2025-07-20",
        quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
      }),
    ];
    const trades = [
      makeTrade(AAPL, "2025-06-15", "SELL", "100"),
      makeTrade(AAPL, "2025-07-20", "SELL", "100"),
      // One 50-sh repurchase on 2025-07-01: within 2mo of BOTH sales.
      makeTrade(AAPL, "2025-07-01", "BUY", "50"),
    ];

    const result = detectWashSales(disposals, trades);
    const earliest = result.find((d) => d.sellDate === "2025-06-15")!;
    const later = result.find((d) => d.sellDate === "2025-07-20")!;
    expect(earliest.blockedLossEur.toFixed(2)).toBe("500.00");
    expect(later.blockedLossEur.toFixed(2)).toBe("0.00");
    // Total blocked across both disposals === one sale's 50% (no double-count).
    const total = result.reduce((s, d) => s.plus(d.blockedLossEur), new Decimal(0));
    expect(total.toFixed(2)).toBe("500.00");
  });

  it("DEFERS then RELEASES the loss when the repurchased lot is later sold (full reintegration, cross-year)", () => {
    // (a) BUY 100 (2024-01-10), (b) SELL 100 at €1000 loss (2024-06-01),
    // (c) BUY 100 — the repurchase — (2024-07-01) inside the 2-month window →
    // blocks the whole €1000; (d) SELL 100 (2025-03-01) of shares whose
    // acquireDate === the repurchase date (2024-07-01) → releases the €1000.
    const disposals = [
      // The loss-sale disposal (sold the original lot acquired 2024-01-10).
      makeDisposal({
        isin: AAPL, symbol: "AAPL", sellDate: "2024-06-01", acquireDate: "2024-01-10",
        quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
      }),
      // The later disposal sells the repurchased lot (acquireDate = 2024-07-01).
      makeDisposal({
        isin: AAPL, symbol: "AAPL", sellDate: "2025-03-01", acquireDate: "2024-07-01",
        quantity: new Decimal(100), gainLossEur: new Decimal(200), // gain or loss irrelevant to release
      }),
    ];
    const trades = [
      makeTrade(AAPL, "2024-01-10", "BUY", "100"),  // original lot
      makeTrade(AAPL, "2024-06-01", "SELL", "100"), // the loss-sale
      makeTrade(AAPL, "2024-07-01", "BUY", "100"),  // the repurchase (blocks the loss)
      makeTrade(AAPL, "2025-03-01", "SELL", "100"), // sells the repurchased lot
    ];

    const result = detectWashSales(disposals, trades);
    const lossSale = result.find((d) => d.sellDate === "2024-06-01")!;
    const release = result.find((d) => d.sellDate === "2025-03-01")!;
    expect(lossSale.blockedLossEur.toFixed(2)).toBe("1000.00");
    expect(release.reintegratedLossEur.toFixed(2)).toBe("1000.00");
  });

  it("releases the deferred loss PROPORTIONALLY across partial sales of the repurchased lot", () => {
    // Same block as above (€1000 deferred onto the 100-sh repurchase of 2024-07-01),
    // but the surviving lot is sold in two halves: 50 sh (2025-03-01) releases
    // €500, the remaining 50 sh (2025-05-01) releases the other €500.
    const disposals = [
      makeDisposal({
        isin: AAPL, symbol: "AAPL", sellDate: "2024-06-01", acquireDate: "2024-01-10",
        quantity: new Decimal(100), gainLossEur: new Decimal(-1000),
      }),
      makeDisposal({
        isin: AAPL, symbol: "AAPL", sellDate: "2025-03-01", acquireDate: "2024-07-01",
        quantity: new Decimal(50), gainLossEur: new Decimal(100),
      }),
      makeDisposal({
        isin: AAPL, symbol: "AAPL", sellDate: "2025-05-01", acquireDate: "2024-07-01",
        quantity: new Decimal(50), gainLossEur: new Decimal(100),
      }),
    ];
    const trades = [
      makeTrade(AAPL, "2024-01-10", "BUY", "100"),
      makeTrade(AAPL, "2024-06-01", "SELL", "100"),
      makeTrade(AAPL, "2024-07-01", "BUY", "100"),
      makeTrade(AAPL, "2025-03-01", "SELL", "50"),
      makeTrade(AAPL, "2025-05-01", "SELL", "50"),
    ];

    const result = detectWashSales(disposals, trades);
    const lossSale = result.find((d) => d.sellDate === "2024-06-01")!;
    const release1 = result.find((d) => d.sellDate === "2025-03-01")!;
    const release2 = result.find((d) => d.sellDate === "2025-05-01")!;
    expect(lossSale.blockedLossEur.toFixed(2)).toBe("1000.00");
    expect(release1.reintegratedLossEur.toFixed(2)).toBe("500.00");
    expect(release2.reintegratedLossEur.toFixed(2)).toBe("500.00");
  });

  it("blocks proportionally for CRYPTO using the 12-month window (sell 100, rebuy 25 → 25%)", () => {
    // CRYPTO → 12-month window. A partial repurchase 6 months later is in-window
    // and blocks proportionally: |loss| × 25/100 = €125.
    const disposals = [makeDisposal({
      isin: "", symbol: "BTC", assetCategory: "CRYPTO", sellDate: "2025-06-15",
      quantity: new Decimal(100), gainLossEur: new Decimal(-500),
    })];
    const trades = [
      { ...makeTrade("", "2025-06-15", "SELL", "100"), symbol: "BTC", isin: "", assetCategory: "CRYPTO" as const },
      { ...makeTrade("", "2025-12-01", "BUY", "25"), symbol: "BTC", isin: "", assetCategory: "CRYPTO" as const },
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.blockedLossEur.toFixed(2)).toBe("125.00");
    expect(result[0]!.washSaleBlocked).toBe(true);
  });

  it("regression: a FULL repurchase (sell 10, rebuy 10) still blocks the WHOLE loss (backward compat)", () => {
    // The old boolean behavior == proportional with absorbed == sold quantity.
    // Sell 10 at €100 loss, rebuy 10 → blockedLossEur === |loss| === €100.
    const disposals = [makeDisposal({
      isin: AAPL, symbol: "AAPL", sellDate: "2025-06-15",
      quantity: new Decimal(10), gainLossEur: new Decimal(-100),
    })];
    const trades = [
      makeTrade(AAPL, "2025-06-15", "SELL", "10"),
      makeTrade(AAPL, "2025-07-01", "BUY", "10"),
    ];

    const result = detectWashSales(disposals, trades);
    expect(result[0]!.blockedLossEur.toFixed(2)).toBe("100.00");
    expect(result[0]!.washSaleBlocked).toBe(true);
  });
});
