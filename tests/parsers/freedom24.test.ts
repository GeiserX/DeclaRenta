import { describe, it, expect } from "vitest";
import { freedom24Parser } from "../../src/parsers/freedom24.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FREEDOM24_JSON = JSON.stringify({
  report: {
    trades: {
      detailed: [
        {
          date: "2025-03-15 09:30:00",
          ticker: "SPY.US",
          isin: "US78462F1030",
          operation: "buy",
          p: "520.50",
          q: "10",
          curr_c: "USD",
          commission: "2.00",
          amount: "-5207.00",
          exchange: "NYSE",
        },
        {
          date: "2025-09-20 14:00:00",
          ticker: "SPY.US",
          isin: "US78462F1030",
          operation: "sell",
          p: "550.00",
          q: "10",
          curr_c: "USD",
          commission: "2.00",
          amount: "5498.00",
          exchange: "NYSE",
        },
        {
          date: "2025-06-01 10:00:00",
          ticker: "VWCE.DE",
          isin: "IE00BK5BQT80",
          operation: "buy",
          p: 110.25,
          q: 5,
          curr_c: "EUR",
          commission: 1.50,
          amount: -552.75,
        },
      ],
    },
    corporate_actions: {
      detailed: [
        {
          date: "2025-05-15 00:00:00",
          ticker: "SPY.US",
          isin: "US78462F1030",
          type_id: "dividend",
          amount: "15.00",
          tax_amount: "4.50",
          curr_c: "USD",
          description: "Q1 2025 Dividend",
        },
        {
          date: "2025-08-15 00:00:00",
          ticker: "VWCE.DE",
          isin: "IE00BK5BQT80",
          type_id: "dividend",
          amount: 8.25,
          tax_amount: 0,
          curr_c: "EUR",
          description: "Annual Distribution",
        },
      ],
    },
    cash_flows: {
      detailed: [],
    },
  },
});

const FREEDOM24_FLAT = JSON.stringify({
  trades: {
    detailed: [
      {
        date: "2025-01-10 11:00:00",
        ticker: "AAPL.US",
        isin: "US0378331005",
        operation: "buy",
        p: "175.00",
        q: "5",
        curr_c: "USD",
        commission: "1.00",
        amount: "-876.00",
      },
    ],
  },
  corporate_actions: { detailed: [] },
  cash_flows: { detailed: [] },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("freedom24Parser", () => {
  describe("detect", () => {
    it("should detect Freedom24 JSON (nested report)", () => {
      expect(freedom24Parser.detect(FREEDOM24_JSON)).toBe(true);
    });

    it("should detect Freedom24 JSON (flat structure)", () => {
      expect(freedom24Parser.detect(FREEDOM24_FLAT)).toBe(true);
    });

    it("should not detect random JSON", () => {
      expect(freedom24Parser.detect('{"name": "test"}')).toBe(false);
    });

    it("should not detect XML", () => {
      expect(freedom24Parser.detect("<FlexQueryResponse>")).toBe(false);
    });

    it("should not detect CSV", () => {
      expect(freedom24Parser.detect("Date,Time,Product,ISIN")).toBe(false);
    });
  });

  describe("parse trades", () => {
    it("should parse buy trades", () => {
      const result = freedom24Parser.parse(FREEDOM24_JSON);
      const buys = result.trades.filter((t) => t.buySell === "BUY");
      expect(buys).toHaveLength(2);

      const spyBuy = buys[0]!;
      expect(spyBuy.symbol).toBe("SPY");
      expect(spyBuy.isin).toBe("US78462F1030");
      expect(spyBuy.quantity).toBe("10");
      expect(spyBuy.tradePrice).toBe("520.50");
      expect(spyBuy.currency).toBe("USD");
      expect(spyBuy.tradeDate).toBe("20250315");
      expect(spyBuy.commission).toBe("-2");
    });

    it("should parse sell trades", () => {
      const result = freedom24Parser.parse(FREEDOM24_JSON);
      const sells = result.trades.filter((t) => t.buySell === "SELL");
      expect(sells).toHaveLength(1);

      const sell = sells[0]!;
      expect(sell.symbol).toBe("SPY");
      expect(sell.quantity).toBe("-10");
      expect(sell.tradePrice).toBe("550.00");
      expect(sell.tradeDate).toBe("20250920");
    });

    it("should handle numeric values (not just strings)", () => {
      const result = freedom24Parser.parse(FREEDOM24_JSON);
      const eurBuy = result.trades.find((t) => t.currency === "EUR");
      expect(eurBuy).toBeDefined();
      expect(eurBuy!.tradePrice).toBe("110.25");
      expect(eurBuy!.quantity).toBe("5");
      expect(eurBuy!.commission).toBe("-1.5");
    });

    it("should parse flat JSON structure", () => {
      const result = freedom24Parser.parse(FREEDOM24_FLAT);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]!.symbol).toBe("AAPL");
      expect(result.trades[0]!.isin).toBe("US0378331005");
    });

    it("should extract symbol from SYMBOL.EXCHANGE ticker", () => {
      const result = freedom24Parser.parse(FREEDOM24_JSON);
      expect(result.trades[0]!.symbol).toBe("SPY");
      expect(result.trades[2]!.symbol).toBe("VWCE");
    });
  });

  describe("parse dividends", () => {
    it("should parse dividends from corporate_actions", () => {
      const result = freedom24Parser.parse(FREEDOM24_JSON);
      const divs = result.cashTransactions.filter((t) => t.type === "Dividends");
      expect(divs).toHaveLength(2);

      const spyDiv = divs[0]!;
      expect(spyDiv.amount).toBe("15.00");
      expect(spyDiv.isin).toBe("US78462F1030");
      expect(spyDiv.currency).toBe("USD");
      expect(spyDiv.dateTime).toBe("20250515");
    });

    it("should parse withholding tax", () => {
      const result = freedom24Parser.parse(FREEDOM24_JSON);
      const wht = result.cashTransactions.filter((t) => t.type === "Withholding Tax");
      expect(wht).toHaveLength(1);
      expect(wht[0]!.amount).toBe("-4.5");
      expect(wht[0]!.isin).toBe("US78462F1030");
    });

    it("should skip zero withholding tax", () => {
      const result = freedom24Parser.parse(FREEDOM24_JSON);
      const wht = result.cashTransactions.filter((t) => t.type === "Withholding Tax");
      // Only SPY has non-zero tax, VWCE has tax_amount=0
      expect(wht).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("should throw on empty input", () => {
      expect(() => freedom24Parser.parse("")).toThrow("vacío");
    });

    it("should throw on invalid JSON", () => {
      expect(() => freedom24Parser.parse("{invalid}")).toThrow();
    });

    it("should throw on unrecognized JSON structure", () => {
      expect(() => freedom24Parser.parse('{"name": "test"}')).toThrow("no reconocido");
    });
  });
});
