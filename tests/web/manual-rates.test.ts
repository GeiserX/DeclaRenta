import { describe, it, expect, beforeEach } from "vitest";
import {
  clearManualOpeningLots,
  getManualRates,
  setManualRate,
  getManualOpeningLots,
  renderManualOpeningLotsPanel,
  setManualOpeningLots,
} from "../../src/web/manual-rates.js";
import { lookupRateInMap } from "../../src/engine/ecb.js";

// Shim localStorage exactly as tests/web/profile.test.ts does (no jsdom).
let store: Record<string, string> = {};
beforeEach(() => {
  store = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val;
    },

    removeItem: (key: string) => {
      store = Object.fromEntries(Object.entries(store).filter(([entryKey]) => entryKey !== key));
    },

    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
});

const KEY = "declarenta_manual_rates";
const OPENING_LOTS_KEY = "declarenta_manual_opening_lots";

describe("setManualRate / getManualRates", () => {
  it("persists a quote and resolves it through getManualRates", () => {
    setManualRate("SOL", "2025-04-10", "40");
    const map = getManualRates();
    expect(lookupRateInMap(map, "2025-04-10", "SOL")!.toFixed(0)).toBe("40");
  });

  it("upper-cases a hand-typed lowercase currency", () => {
    setManualRate("sol", "2025-04-10", "40");
    expect(lookupRateInMap(getManualRates(), "2025-04-10", "SOL")).not.toBeNull();
  });

  it("normalizes a stablecoin ticker so the USD-keyed lookup matches", () => {
    setManualRate("USDT", "2025-04-10", "0.92");
    // Stored under USD; lookupRateInMap normalizes USDT→USD too.
    expect(lookupRateInMap(getManualRates(), "2025-04-10", "USDT")!.toFixed(2)).toBe("0.92");
    expect(lookupRateInMap(getManualRates(), "2025-04-10", "USD")!.toFixed(2)).toBe("0.92");
  });

  it("upserts (does not duplicate) when the same currency+date is saved twice", () => {
    setManualRate("SOL", "2025-04-10", "40");
    setManualRate("SOL", "2025-04-10", "42");
    const stored: unknown = JSON.parse(store[KEY]!);
    expect(Array.isArray(stored) && stored.length).toBe(1);
    expect(lookupRateInMap(getManualRates(), "2025-04-10", "SOL")!.toFixed(0)).toBe("42");
  });

  it("ignores an invalid (non-positive) rate rather than persisting it", () => {
    expect(setManualRate("SOL", "2025-04-10", "0")).toBe(false);
    expect(store[KEY]).toBeUndefined();
    expect(getManualRates().size).toBe(0);
  });

  it("returns true and canonicalizes a comma-decimal rate on persist", () => {
    expect(setManualRate("SOL", "2025-04-10", "142,50")).toBe(true);
    const stored = JSON.parse(store[KEY]!) as { eurPerUnit: string }[];
    expect(stored[0]!.eurPerUnit).toBe("142.50");
    expect(lookupRateInMap(getManualRates(), "2025-04-10", "SOL")!.toFixed(2)).toBe("142.50");
  });

  it("returns false for a non-numeric rate", () => {
    expect(setManualRate("SOL", "2025-04-10", "abc")).toBe(false);
  });
});

describe("getManualRates resilience", () => {
  it("returns an empty map when nothing is stored", () => {
    expect(getManualRates().size).toBe(0);
  });

  it("tolerates corrupt JSON in storage", () => {
    store[KEY] = "{not valid json";
    expect(getManualRates().size).toBe(0);
  });

  it("tolerates a non-array JSON payload", () => {
    store[KEY] = '{"currency":"SOL"}';
    expect(getManualRates().size).toBe(0);
  });

  it("skips malformed entries but keeps valid ones", () => {
    store[KEY] = JSON.stringify([{ currency: "SOL", date: "2025-04-10", eurPerUnit: "40" }, { currency: "BAD" }]);
    const map = getManualRates();
    expect(lookupRateInMap(map, "2025-04-10", "SOL")).not.toBeNull();
    expect(map.size).toBe(1);
  });
});

describe("setManualOpeningLots / getManualOpeningLots", () => {
  it("persists multiple opening lots for one transferred position", () => {
    const saved = setManualOpeningLots("US0378331005", [
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "14",
        pricePerShare: "100",
      },
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-02-01",
        quantity: "3",
        pricePerShare: "200",
      },
    ]);

    expect(saved).toBe(2);
    const stored = JSON.parse(store[OPENING_LOTS_KEY]!) as { isin: string }[];
    expect(stored).toHaveLength(2);
    expect(getManualOpeningLots()).toHaveLength(2);
    expect(getManualOpeningLots()[0]!.isin).toBe("US0378331005");
  });

  it("ignores invalid opening lots", () => {
    const saved = setManualOpeningLots("US0378331005", [
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "0",
        pricePerShare: "100",
      },
    ]);

    expect(saved).toBe(0);
    expect(store[OPENING_LOTS_KEY]).toBeUndefined();
    expect(getManualOpeningLots()).toHaveLength(0);
  });

  it("skips malformed persisted opening lots without throwing", () => {
    store[OPENING_LOTS_KEY] = JSON.stringify([
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "14",
        pricePerShare: "100",
      },
      {
        symbol: null,
        description: 42,
        isin: null,
        assetCategory: {},
        currency: "USD",
        acquireDate: [],
        quantity: {},
        pricePerShare: "50",
      },
    ]);

    expect(() => getManualOpeningLots()).not.toThrow();
    expect(getManualOpeningLots()).toHaveLength(1);
    expect(getManualOpeningLots()[0]!.symbol).toBe("AAPL");
  });

  it("can clear saved opening lots", () => {
    setManualOpeningLots("US0378331005", [
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "14",
        pricePerShare: "100",
      },
    ]);

    clearManualOpeningLots();

    expect(store[OPENING_LOTS_KEY]).toBeUndefined();
    expect(getManualOpeningLots()).toHaveLength(0);
  });

  it("renders saved opening lots even without active missing-lot messages", () => {
    setManualOpeningLots("US0378331005", [
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "14",
        pricePerShare: "100",
      },
    ]);

    const html = renderManualOpeningLotsPanel([]);

    expect(html).toContain('<details class="manual-opening-lots-panel');
    expect(html).toContain("AAPL");
    expect(html).toContain("manual-opening-lots-clear-btn");
  });

  it("keeps the panel open when there are active missing-lot issues", () => {
    const html = renderManualOpeningLotsPanel([
      {
        id: "fifo.insufficient_lots",
        severity: "warning",
        message: "missing lots",
        context: {
          symbol: "AAPL",
          description: "APPLE INC",
          isin: "US0378331005",
          assetCategory: "STK",
          currency: "USD",
          date: "2025-03-10",
          quantity: "14",
        },
      },
    ]);

    expect(html).toContain('<details class="manual-opening-lots-panel crypto-rates-panel" open>');
  });
});
