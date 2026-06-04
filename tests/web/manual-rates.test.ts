import { describe, it, expect, beforeEach } from "vitest";
import { getManualRates, setManualRate } from "../../src/web/manual-rates.js";
import { lookupRateInMap } from "../../src/engine/ecb.js";

// Shim localStorage exactly as tests/web/profile.test.ts does (no jsdom).
let store: Record<string, string> = {};
beforeEach(() => {
  store = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    removeItem: (key: string) => { delete store[key]; },
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
});

const KEY = "declarenta_manual_rates";

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
    setManualRate("SOL", "2025-04-10", "0");
    expect(store[KEY]).toBeUndefined();
    expect(getManualRates().size).toBe(0);
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
    store[KEY] = JSON.stringify([
      { currency: "SOL", date: "2025-04-10", eurPerUnit: "40" },
      { currency: "BAD" },
    ]);
    const map = getManualRates();
    expect(lookupRateInMap(map, "2025-04-10", "SOL")).not.toBeNull();
    expect(map.size).toBe(1);
  });
});
