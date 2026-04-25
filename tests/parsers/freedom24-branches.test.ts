import { describe, it, expect } from "vitest";
import { freedom24Parser } from "../../src/parsers/freedom24.js";

describe("freedom24Parser - branch coverage", () => {
  it("should parse flat structure (no report wrapper)", () => {
    const input = JSON.stringify({
      trades: {
        detailed: [
          {
            date: "2025-01-15 10:00:00",
            ticker: "SPY.US",
            isin: "US78462F1030",
            operation: "buy",
            p: 500,
            q: 10,
            curr_c: "USD",
            commission: 1.5,
            amount: 5000,
          },
        ],
      },
      corporate_actions: { detailed: [] },
    });
    const result = freedom24Parser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe("SPY");
  });

  it("should parse report wrapper structure", () => {
    const input = JSON.stringify({
      report: {
        trades: {
          detailed: [
            {
              date: "2025-01-15 10:00:00",
              ticker: "AAPL.US",
              operation: "sell",
              p: "180",
              q: "5",
              curr_c: "USD",
            },
          ],
        },
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buySell).toBe("SELL");
  });

  it("should skip zero-quantity trades", () => {
    const input = JSON.stringify({
      trades: {
        detailed: [
          { date: "2025-01-15 10:00:00", ticker: "SPY.US", operation: "buy", p: 500, q: 0, curr_c: "USD" },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.trades).toHaveLength(0);
  });

  it("should handle ticker without dot (no exchange suffix)", () => {
    const input = JSON.stringify({
      trades: {
        detailed: [
          { date: "2025-01-15 10:00:00", ticker: "NOTICKER", operation: "buy", p: 100, q: 10, curr_c: "EUR" },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.trades[0].symbol).toBe("NOTICKER");
    expect(result.trades[0].exchange).toBe("");
  });

  it("should handle ticker with multiple dots", () => {
    const input = JSON.stringify({
      trades: {
        detailed: [
          { date: "2025-01-15 10:00:00", ticker: "BRK.B.US", operation: "buy", p: 400, q: 2, curr_c: "USD" },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.trades[0].symbol).toBe("BRK.B");
  });

  it("should parse dividends with withholding tax", () => {
    const input = JSON.stringify({
      corporate_actions: {
        detailed: [
          {
            date: "2025-06-15 00:00:00",
            ticker: "AAPL.US",
            isin: "US0378331005",
            type_id: "dividend",
            amount: 2.50,
            tax_amount: -0.38,
            curr_c: "USD",
            description: "Q2 Dividend",
          },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.cashTransactions).toHaveLength(2);
    expect(result.cashTransactions[0].type).toBe("Dividends");
    expect(result.cashTransactions[1].type).toBe("Withholding Tax");
  });

  it("should parse coupon type as dividend", () => {
    const input = JSON.stringify({
      corporate_actions: {
        detailed: [
          {
            date: "2025-06-15 00:00:00",
            ticker: "T.US",
            isin: "US8725901040",
            type_id: "coupon",
            amount: 15.00,
            tax_amount: 0,
            curr_c: "USD",
          },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0].type).toBe("Dividends");
  });

  it("should skip non-dividend corporate actions", () => {
    const input = JSON.stringify({
      corporate_actions: {
        detailed: [
          { date: "2025-06-15 00:00:00", ticker: "AAPL.US", type_id: "split", amount: 0, curr_c: "USD" },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should handle positive tax_amount (converts to negative)", () => {
    const input = JSON.stringify({
      corporate_actions: {
        detailed: [
          {
            date: "2025-06-15 00:00:00",
            ticker: "AAPL.US",
            isin: "US0378331005",
            type_id: "dividend",
            amount: 10,
            tax_amount: 1.5,
            curr_c: "USD",
          },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    const wht = result.cashTransactions.find((ct) => ct.type === "Withholding Tax");
    expect(wht.amount).toBe("-1.5");
  });

  it("should handle missing isin and description", () => {
    const input = JSON.stringify({
      corporate_actions: {
        detailed: [
          { date: "2025-06-15 00:00:00", ticker: "AAPL.US", type_id: "dividend", amount: 5, curr_c: "USD" },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.cashTransactions[0].isin).toBe("");
  });

  it("should handle EUR currency with exchange in trade", () => {
    const input = JSON.stringify({
      trades: {
        detailed: [
          { date: "2025-01-15 10:00:00", ticker: "SAP.DE", operation: "buy", p: 200, q: 5, curr_c: "EUR", exchange: "XETR" },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    expect(result.trades[0].exchange).toBe("XETR");
  });

  it("should handle undefined values with str() helper", () => {
    const input = JSON.stringify({
      trades: {
        detailed: [
          { date: "2025-01-15 10:00:00", ticker: "SPY.US", operation: "buy", p: 500, q: 10, curr_c: "USD" },
        ],
      },
    });
    const result = freedom24Parser.parse(input);
    // Commission defaults to "0" when undefined
    expect(result.trades[0].commission).toBe("0");
  });
});

describe("freedom24Parser - error cases", () => {
  it("should throw on empty input", () => {
    expect(() => freedom24Parser.parse("")).toThrow("fichero vacío");
  });

  it("should throw on non-JSON input", () => {
    expect(() => freedom24Parser.parse("not json")).toThrow();
  });

  it("should throw on JSON without expected keys", () => {
    expect(() => freedom24Parser.parse('{"data": []}')).toThrow("formato no reconocido");
  });
});

describe("freedom24Parser.detect", () => {
  it("should detect valid JSON with trades", () => {
    expect(freedom24Parser.detect('{"trades": {"detailed": []}}')).toBe(true);
  });

  it("should detect valid JSON with cash_flows", () => {
    expect(freedom24Parser.detect('{"cash_flows": {"detailed": []}}')).toBe(true);
  });

  it("should detect valid JSON with report wrapper", () => {
    expect(freedom24Parser.detect('{"report": {"trades": {"detailed": []}}}')).toBe(true);
  });

  it("should reject non-JSON", () => {
    expect(freedom24Parser.detect("not json")).toBe(false);
  });

  it("should reject JSON without expected keys", () => {
    expect(freedom24Parser.detect('{"data": []}')).toBe(false);
  });
});
