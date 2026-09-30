import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { FifoEngine } from "../../src/engine/fifo.js";
import type { Trade, CorporateAction } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// Simple rate map: 1 EUR = 1 USD (for simplicity)
const rateMap: EcbRateMap = new Map([
  ["2024-01-15", new Map([["USD", new Decimal("1")]])],
  ["2024-06-01", new Map([["USD", new Decimal("1")]])],
  ["2024-07-01", new Map([["USD", new Decimal("1")]])],
  ["2024-09-01", new Map([["USD", new Decimal("1")]])],
  ["2024-12-01", new Map([["USD", new Decimal("1")]])],
]);

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeID: "T1",
    accountId: "",
    symbol: "OLD",
    description: "Old Corp",
    isin: "US1111111111",
    assetCategory: "STK",
    currency: "USD",
    tradeDate: "20240115",
    settlementDate: "20240117",
    quantity: "100",
    tradePrice: "50",
    tradeMoney: "-5000",
    proceeds: "0",
    cost: "-5000",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: "BUY",
    openCloseIndicator: overrides.buySell === "SELL" ? "C" : "O",
    exchange: "NYSE",
    commissionCurrency: "USD",
    commission: "-1",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

describe("Corporate Actions in FIFO Engine", () => {
  describe("Mergers (TC)", () => {
    it("should transfer lots from old ISIN to new ISIN", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "100", tradePrice: "50" }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "NEW",
          description: "OLD(US1111111111) MERGED(Acquisition) 1 FOR 1 NEW(US2222222222)",
          isin: "US1111111111",
          currency: "USD",
          reportDate: "20240601",
          dateTime: "20240601",
          quantity: "100",
          amount: "0",
          type: "TC",
          actionDescription: "Merger",
        },
      ];

      engine.processTrades(trades, rateMap, corporateActions);

      const lots = engine.getRemainingLots();
      // Old ISIN should have no lots
      expect(lots.has("US1111111111")).toBe(false);
      // New ISIN should have the transferred lots
      const newLots = lots.get("US2222222222");
      expect(newLots).toBeDefined();
      expect(newLots!.length).toBe(1);
      expect(newLots![0]!.quantity.toNumber()).toBe(100);
    });

    it("should preserve total cost basis through merger", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "100", tradePrice: "50", commission: "-10" }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "NEW",
          description: "OLD(US1111111111) MERGED(Acquisition) 1 FOR 1 NEW(US2222222222)",
          isin: "US1111111111",
          currency: "USD",
          reportDate: "20240601",
          dateTime: "20240601",
          quantity: "100",
          amount: "0",
          type: "TC",
          actionDescription: "Merger",
        },
      ];

      engine.processTrades(trades, rateMap, corporateActions);

      const newLots = engine.getRemainingLots().get("US2222222222")!;
      // Cost basis (in FCY) preserved through the tax-neutral merger:
      // 100 * 50 + 10 commission = 5010 USD
      expect(newLots[0]!.costInFcy.toFixed(2)).toBe("5010.00");
    });

    it("should apply merger ratio to quantity", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "100", tradePrice: "50" }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "NEW",
          description: "OLD(US1111111111) MERGED(Acquisition) 2 FOR 1 NEW(US2222222222)",
          isin: "US1111111111",
          currency: "USD",
          reportDate: "20240601",
          dateTime: "20240601",
          quantity: "200",
          amount: "0",
          type: "TC",
          actionDescription: "Merger 2:1",
        },
      ];

      engine.processTrades(trades, rateMap, corporateActions);

      const newLots = engine.getRemainingLots().get("US2222222222")!;
      expect(newLots[0]!.quantity.toNumber()).toBe(200); // 100 * 2
    });

    it("should allow selling new ISIN after merger", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "100", tradePrice: "50", commission: "0" }),
        makeTrade({
          tradeID: "T2",
          tradeDate: "20240901",
          isin: "US2222222222",
          symbol: "NEW",
          quantity: "-50",
          tradePrice: "60",
          buySell: "SELL",
          openCloseIndicator: "C",
          tradeMoney: "3000",
          proceeds: "3000",
          commission: "0",
        }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "NEW",
          description: "OLD(US1111111111) MERGED(Acquisition) 1 FOR 1 NEW(US2222222222)",
          isin: "US1111111111",
          currency: "USD",
          reportDate: "20240601",
          dateTime: "20240601",
          quantity: "100",
          amount: "0",
          type: "TC",
          actionDescription: "Merger",
        },
      ];

      const disposals = engine.processTrades(trades, rateMap, corporateActions);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.isin).toBe("US2222222222");
      expect(d.quantity.toNumber()).toBe(50);
      // Cost basis = 50 * 50 = 2500 (half of original 5000)
      expect(d.costBasisEur.toFixed(2)).toBe("2500.00");
      // Proceeds = 50 * 60 = 3000
      expect(d.proceedsEur.toFixed(2)).toBe("3000.00");
      expect(d.gainLossEur.toFixed(2)).toBe("500.00");
    });

    it("books a cash buyout (shares out, cash in) as a sale, not a tax-neutral merger", () => {
      // Cash acquisition: IBKR reports it only as a TC row that removes the shares
      // (quantity < 0) and pays cash (amount ≠ 0). That is a transmisión onerosa
      // (Art. 33.1 / 35 LIRPF), so the lots must be consumed at the cash received.
      const cashRates: EcbRateMap = new Map([
        ["2022-01-10", new Map([["USD", new Decimal("0.9")]])],
        ["2022-10-28", new Map([["USD", new Decimal("0.95")]])],
      ]);
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({
          tradeDate: "20220110",
          symbol: "TWTR",
          description: "TWITTER INC",
          isin: "US90184L1026",
          quantity: "100",
          tradePrice: "40",
          commission: "0",
        }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "TWTR",
          description:
            "TWTR(US90184L1026) MERGED(Acquisition) FOR USD 54.20 PER SHARE (TWTR, TWITTER INC, US90184L1026)",
          isin: "US90184L1026",
          currency: "USD",
          reportDate: "20221028",
          dateTime: "20221028;202500",
          quantity: "-100",
          amount: "-5420", // real Flex files carry the cash leg as a negative amount
          type: "TC",
          actionDescription: "Acquisition",
        },
      ];

      const disposals = engine.processTrades(trades, cashRates, corporateActions);

      expect(disposals).toHaveLength(1);
      const d = disposals[0]!;
      expect(d.isin).toBe("US90184L1026");
      expect(d.sellDate).toBe("20221028");
      expect(d.quantity.toString()).toBe("100");
      expect(d.proceedsFcy.toFixed(2)).toBe("5420.00");
      // Same-currency security: both legs at the sale-date rate (V2422-20).
      expect(d.proceedsEur.toFixed(2)).toBe("5149.00"); // 5420 × 0.95
      expect(d.costBasisEur.toFixed(2)).toBe("3800.00"); // 4000 × 0.95
      expect(d.gainLossEur.toFixed(2)).toBe("1349.00");
      expect(engine.getRemainingLots().get("US90184L1026") ?? []).toHaveLength(0);
      const ids = engine.messages.map((m) => m.id);
      expect(ids).toContain("fifo.cash_merger_disposal");
      expect(ids).not.toContain("fifo.merger_applied");
    });

    it("does not book a cash-and-stock merger as a sale of the whole position", () => {
      // Real IBKR rows (Livongo -> Teladoc, 2020): the old shares leave with only the
      // cash leg in `amount`; the new shares arrive on a second row with amount 0.
      // Booking the first row as a sale would invent a loss for the stock leg.
      const mergerRates: EcbRateMap = new Map([
        ["2020-06-01", new Map([["USD", new Decimal("1")]])],
        ["2020-10-30", new Map([["USD", new Decimal("1")]])],
      ]);
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({
          tradeDate: "20200601",
          symbol: "LVGO",
          description: "LIVONGO HEALTH INC",
          isin: "US5391831030",
          quantity: "2.5052",
          tradePrice: "120",
          commission: "0",
        }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "LVGO",
          description:
            "LVGO(US5391831030) CASH and STOCK MERGER (Acquisition) US87918A1051 592 FOR 1000 AND USD 4.24 (LVGO, LIVONGO HEALTH INC, US5391831030)",
          isin: "US5391831030",
          currency: "USD",
          reportDate: "20201030",
          dateTime: "20201030;202500",
          quantity: "-2.5052",
          amount: "-10.622048",
          type: "TC",
          actionDescription: "Acquisition",
        },
        {
          transactionID: "CA2",
          accountId: "",
          symbol: "TDOC",
          description:
            "LVGO(US5391831030) CASH and STOCK MERGER (Acquisition) US87918A1051 592 FOR 1000 AND USD 4.24 (TDOC, TELADOC HEALTH INC, US87918A1051)",
          isin: "US87918A1051",
          currency: "USD",
          reportDate: "20201030",
          dateTime: "20201030;202500",
          quantity: "1.4831",
          amount: "0",
          type: "TC",
          actionDescription: "Acquisition",
        },
      ];

      const disposals = engine.processTrades(trades, mergerRates, corporateActions);

      expect(disposals).toHaveLength(0);
      expect(engine.messages.map((m) => m.id)).not.toContain("fifo.cash_merger_disposal");
    });

    it("applies a 1-for-3 merger ratio exactly, so selling every new share leaves no dust", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "300", tradePrice: "50", commission: "0" }),
        makeTrade({
          tradeID: "T2",
          tradeDate: "20240901",
          isin: "US2222222222",
          symbol: "NEW",
          quantity: "-100",
          tradePrice: "160",
          buySell: "SELL",
          openCloseIndicator: "C",
          commission: "0",
        }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "NEW",
          description: "OLD(US1111111111) MERGED(Acquisition) 1 FOR 3 NEW(US2222222222)",
          isin: "US1111111111",
          currency: "USD",
          reportDate: "20240601",
          dateTime: "20240601",
          quantity: "100",
          amount: "0",
          type: "TC",
          actionDescription: "Merger 1:3",
        },
      ];

      const disposals = engine.processTrades(trades, rateMap, corporateActions);

      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantity.toString()).toBe("100");
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("15000.00");
      expect(engine.messages.map((m) => m.id)).not.toContain("fifo.insufficient_lots");
    });
  });

  describe("Spin-offs (SO)", () => {
    it("should create new lots for spin-off entity", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "100", tradePrice: "100", commission: "0" }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "SPINCO",
          description: "PARENT(US1111111111) SPINOFF 1 FOR 4 SPINCO(US3333333333)",
          isin: "US3333333333",
          currency: "USD",
          reportDate: "20240701",
          dateTime: "20240701",
          quantity: "25",
          amount: "0",
          type: "SO",
          actionDescription: "Spin-off 1:4",
        },
      ];

      engine.processTrades(trades, rateMap, corporateActions);

      const lots = engine.getRemainingLots();
      // Parent should still have lots (with reduced cost basis)
      const parentLots = lots.get("US1111111111");
      expect(parentLots).toBeDefined();
      expect(parentLots!.length).toBe(1);
      expect(parentLots![0]!.quantity.toNumber()).toBe(100); // Quantity unchanged

      // Spin-off should have new lots
      const spinLots = lots.get("US3333333333");
      expect(spinLots).toBeDefined();
      expect(spinLots!.length).toBe(1);
      expect(spinLots![0]!.quantity.toNumber()).toBe(25); // 100 * (1/4)
    });

    it("should split cost basis proportionally", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "100", tradePrice: "100", commission: "0" }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "SPINCO",
          // 1 FOR 4 → ratio = 0.25, costFraction = 1/(1+4) = 0.2
          description: "PARENT(US1111111111) SPINOFF 1 FOR 4 SPINCO(US3333333333)",
          isin: "US3333333333",
          currency: "USD",
          reportDate: "20240701",
          dateTime: "20240701",
          quantity: "25",
          amount: "0",
          type: "SO",
          actionDescription: "Spin-off",
        },
      ];

      engine.processTrades(trades, rateMap, corporateActions);

      const parentLots = engine.getRemainingLots().get("US1111111111")!;
      const spinLots = engine.getRemainingLots().get("US3333333333")!;

      // Total original cost (in FCY) = 100 * 100 = 10000
      const parentCost = parentLots[0]!.costInFcy.toNumber();
      const spinCost = spinLots[0]!.costInFcy.toNumber();

      // Total cost must be preserved
      expect(parentCost + spinCost).toBeCloseTo(10000, 2);
      // Spin-off gets costFraction (1/5 = 20%) of original cost
      expect(spinCost).toBeCloseTo(2000, 2);
      expect(parentCost).toBeCloseTo(8000, 2);
    });

    it("should inherit acquisition date from parent", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "100", tradePrice: "100", commission: "0" }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "SPINCO",
          description: "PARENT(US1111111111) SPINOFF 1 FOR 4 SPINCO(US3333333333)",
          isin: "US3333333333",
          currency: "USD",
          reportDate: "20240701",
          dateTime: "20240701",
          quantity: "25",
          amount: "0",
          type: "SO",
          actionDescription: "Spin-off",
        },
      ];

      engine.processTrades(trades, rateMap, corporateActions);

      const spinLots = engine.getRemainingLots().get("US3333333333")!;
      expect(spinLots[0]!.acquireDate).toBe("20240115"); // Same as parent
    });

    it("applies a 1-for-3 spin-off ratio exactly, so selling every spun-off share leaves no dust", () => {
      const engine = new FifoEngine();
      const trades: Trade[] = [
        makeTrade({ tradeDate: "20240115", isin: "US1111111111", quantity: "300", tradePrice: "100", commission: "0" }),
        makeTrade({
          tradeID: "T2",
          tradeDate: "20240901",
          isin: "US3333333333",
          symbol: "SPINCO",
          quantity: "-100",
          tradePrice: "80",
          buySell: "SELL",
          openCloseIndicator: "C",
          commission: "0",
        }),
      ];
      const corporateActions: CorporateAction[] = [
        {
          transactionID: "CA1",
          accountId: "",
          symbol: "SPINCO",
          // 1 FOR 3 → 100 new shares, costFraction = 1/(1+3) = 25% of 30000
          description: "PARENT(US1111111111) SPINOFF 1 FOR 3 SPINCO(US3333333333)",
          isin: "US3333333333",
          currency: "USD",
          reportDate: "20240701",
          dateTime: "20240701",
          quantity: "100",
          amount: "0",
          type: "SO",
          actionDescription: "Spin-off",
        },
      ];

      const disposals = engine.processTrades(trades, rateMap, corporateActions);

      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantity.toString()).toBe("100");
      expect(disposals[0]!.costBasisEur.toFixed(2)).toBe("7500.00");
      expect(engine.messages.map((m) => m.id)).not.toContain("fifo.insufficient_lots");
    });
  });
});
