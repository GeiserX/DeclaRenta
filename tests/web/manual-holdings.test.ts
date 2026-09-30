// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  coerceManualHoldings,
  loadManualHoldings,
  manualHoldingsStorageKey,
  manualHoldingsTotal,
  normalizeManualHolding,
  saveManualHoldings,
} from "../../src/web/manual-holdings.js";

/** In-memory Storage: Node's own localStorage global can shadow jsdom's. */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

describe("normalizeManualHolding", () => {
  it("accepts Spanish number formats and stores dot-decimal strings", () => {
    expect(normalizeManualHolding({ asset: "  BTC ", quantity: "0,5", valueEur: "1.234,56" })).toEqual({
      asset: "BTC",
      quantity: "0.5",
      valueEur: "1234.56",
    });
  });

  it("reads a dot-grouped euro value as thousands, but keeps a dot-decimal quantity", () => {
    expect(normalizeManualHolding({ asset: "BTC", quantity: "1.234", valueEur: "60.000" })).toEqual({
      asset: "BTC",
      quantity: "1.234",
      valueEur: "60000",
    });
    expect(normalizeManualHolding({ asset: "BTC", quantity: "1", valueEur: "1.250.000" })?.valueEur).toBe("1250000");
    expect(normalizeManualHolding({ asset: "BTC", quantity: "1", valueEur: "60000.5" })?.valueEur).toBe("60000.5");
    expect(normalizeManualHolding({ asset: "BTC", quantity: "1", valueEur: "12.34" })?.valueEur).toBe("12.34");
  });

  it("accepts a zero value (an asset worth nothing at 31 December)", () => {
    expect(normalizeManualHolding({ asset: "XYZ", quantity: "10", valueEur: "0" })?.valueEur).toBe("0");
  });

  it.each([
    ["empty asset", { asset: "  ", quantity: "1", valueEur: "100" }],
    ["zero quantity", { asset: "BTC", quantity: "0", valueEur: "100" }],
    ["negative quantity", { asset: "BTC", quantity: "-1", valueEur: "100" }],
    ["negative value", { asset: "BTC", quantity: "1", valueEur: "-5" }],
    ["unreadable value", { asset: "BTC", quantity: "1", valueEur: "abc" }],
    ["empty value", { asset: "BTC", quantity: "1", valueEur: "" }],
  ])("rejects %s", (_label, row) => {
    expect(normalizeManualHolding(row)).toBeNull();
  });
});

describe("coerceManualHoldings", () => {
  it("drops malformed entries and non-arrays", () => {
    expect(coerceManualHoldings({ asset: "BTC" })).toEqual([]);
    expect(
      coerceManualHoldings([
        { asset: "BTC", quantity: "1", valueEur: "90000" },
        { asset: "ETH", quantity: 2, valueEur: "5000" },
        null,
        { asset: "SOL", quantity: "0", valueEur: "10" },
      ]),
    ).toEqual([{ asset: "BTC", quantity: "1", valueEur: "90000" }]);
  });
});

describe("manualHoldingsTotal", () => {
  it("sums with Decimal precision", () => {
    const total = manualHoldingsTotal([
      { asset: "A", quantity: "1", valueEur: "0.1" },
      { asset: "B", quantity: "1", valueEur: "0.2" },
    ]);
    expect(total.toString()).toBe("0.3");
  });
});

describe("storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps each model and year apart, and removes the key when emptied", () => {
    saveManualHoldings("721", 2025, [{ asset: "BTC", quantity: "1", valueEur: "90000" }]);
    expect(loadManualHoldings("721", 2025)).toHaveLength(1);
    expect(loadManualHoldings("721", 2024)).toEqual([]);
    expect(loadManualHoldings("720", 2025)).toEqual([]);

    saveManualHoldings("721", 2025, []);
    expect(localStorage.getItem(manualHoldingsStorageKey("721", 2025))).toBeNull();
  });

  it("returns [] for corrupt stored JSON", () => {
    localStorage.setItem(manualHoldingsStorageKey("720", 2025), "{not json");
    expect(loadManualHoldings("720", 2025)).toEqual([]);
  });
});
