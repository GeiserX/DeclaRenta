import { describe, it, expect, beforeEach } from "vitest";
import {
  clearManualOpeningLots,
  clearManualRates,
  getManualRates,
  removeManualRate,
  renderSavedManualRates,
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

  it("clears one persisted opening-lot group when saved with no valid rows", () => {
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
    setManualOpeningLots("US5949181045", [
      {
        symbol: "MSFT",
        description: "MICROSOFT CORP",
        isin: "US5949181045",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-12",
        quantity: "5",
        pricePerShare: "200",
      },
    ]);

    expect(setManualOpeningLots("US0378331005", [])).toBe(1);

    const lots = getManualOpeningLots();
    expect(lots).toHaveLength(1);
    expect(lots[0]!.isin).toBe("US5949181045");
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

  it("caps manual opening lot dates at today", () => {
    const today = new Date().toISOString().slice(0, 10);
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

    expect(html).toContain(`type="date" max="${today}"`);
  });
});

describe("clearManualRates / removeManualRate", () => {
  it("clearManualRates empties getManualRates", () => {
    setManualRate("SOL", "2025-04-10", "40");
    setManualRate("BNB", "2025-05-01", "500");
    clearManualRates();
    expect(getManualRates().size).toBe(0);
    expect(store[KEY]).toBeUndefined();
  });

  it("removeManualRate deletes only the matching currency+date", () => {
    setManualRate("SOL", "2025-04-10", "40");
    setManualRate("SOL", "2025-04-11", "41");
    expect(removeManualRate("SOL", "2025-04-10")).toBe(true);
    expect(lookupRateInMap(getManualRates(), "2025-04-10", "SOL")?.toFixed(0)).not.toBe("40");
    expect(JSON.parse(store[KEY]!)).toEqual([{ currency: "SOL", date: "2025-04-11", eurPerUnit: "41" }]);
  });

  it("removeManualRate drops the storage key when the last price goes", () => {
    setManualRate("SOL", "2025-04-10", "40");
    expect(removeManualRate("SOL", "2025-04-10")).toBe(true);
    expect(store[KEY]).toBeUndefined();
  });

  it("removeManualRate returns false when nothing matches", () => {
    setManualRate("SOL", "2025-04-10", "40");
    expect(removeManualRate("BTC", "2025-04-10")).toBe(false);
    expect(getManualRates().size).toBe(1);
  });
});

describe("renderSavedManualRates", () => {
  it("returns an empty string when nothing is saved", () => {
    expect(renderSavedManualRates()).toBe("");
  });

  it("lists every stored price with a delete button per row and a clear-all button", () => {
    setManualRate("SOL", "2025-04-10", "30000");
    setManualRate("PEPE", "2025-03-01", "0,00001234");
    const html = renderSavedManualRates();
    expect(html).toContain("SOL");
    expect(html).toContain("2025-04-10");
    // Shown the Spanish way, so a slipped decimal mark is easy to spot.
    expect(html).toContain("30.000,00");
    // Small quotes keep every digit the user typed.
    expect(html).toContain("0,00001234");
    expect(html.match(/saved-manual-rate-delete/g)).toHaveLength(2);
    expect(html).toContain('data-currency="SOL" data-date="2025-04-10"');
    expect(html).toContain('id="saved-manual-rates-clear-btn"');
    // Sorted by date: PEPE (March) before SOL (April).
    expect(html.indexOf("PEPE")).toBeLessThan(html.indexOf("SOL"));
  });

  it("still lists (and escapes) a stored entry it cannot parse, so it can be deleted", () => {
    store[KEY] = JSON.stringify([{ currency: "<b>X</b>", date: "2025-01-01", eurPerUnit: "abc" }]);
    const html = renderSavedManualRates();
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain(">abc<");
  });
});
