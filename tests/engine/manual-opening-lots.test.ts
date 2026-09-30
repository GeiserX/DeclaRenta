import { describe, it, expect } from "vitest";
import {
  buildManualOpeningLotTrades,
  coerceManualOpeningLots,
  normalizeManualOpeningLot,
} from "../../src/engine/manual-opening-lots.js";

describe("manual-opening-lots", () => {
  it("normalizes comma decimals and canonicalizes fields", () => {
    const normalized = normalizeManualOpeningLot({
      symbol: "aapl",
      description: "APPLE INC",
      isin: "us0378331005",
      assetCategory: "stk",
      currency: "usd",
      acquireDate: "20240110",
      quantity: "10,5",
      pricePerShare: "123,45",
    });

    expect(normalized).toEqual({
      symbol: "aapl",
      description: "APPLE INC",
      isin: "US0378331005",
      assetCategory: "STK",
      currency: "USD",
      acquireDate: "2024-01-10",
      quantity: "10.5",
      pricePerShare: "123.45",
    });
  });

  it("reads thousands separators like the manual crypto rates do", () => {
    const lot = (quantity: string, pricePerShare: string) =>
      normalizeManualOpeningLot({
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity,
        pricePerShare,
      });

    expect(lot("1 000,5", "1.234,56")).toMatchObject({ quantity: "1000.5", pricePerShare: "1234.56" });
    expect(lot("10", "1,234.56")).toMatchObject({ pricePerShare: "1234.56" });
    // A dot alone is the decimal mark, as in the crypto-rate parser.
    expect(lot("1.000", "1.250")).toMatchObject({ quantity: "1", pricePerShare: "1.25" });
  });

  it("rejects non-positive quantities", () => {
    const normalized = normalizeManualOpeningLot({
      symbol: "AAPL",
      description: "APPLE INC",
      isin: "US0378331005",
      assetCategory: "STK",
      currency: "USD",
      acquireDate: "2024-01-10",
      quantity: "-1",
      pricePerShare: "100",
    });

    expect(normalized).toBeNull();
  });

  it("coerces malformed arrays without throwing", () => {
    const lots = coerceManualOpeningLots([
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "1",
        pricePerShare: "100",
      },
      { symbol: null, quantity: {} },
    ]);

    expect(lots).toHaveLength(1);
  });

  it("builds no trades for an empty list", () => {
    expect(buildManualOpeningLotTrades([])).toEqual([]);
  });
});
