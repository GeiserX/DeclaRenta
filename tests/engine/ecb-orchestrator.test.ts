import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildEcbRateMap,
  deriveEcbNeeds,
  __resetEcbCache,
  type EcbFetcher,
} from "../../src/engine/ecb-orchestrator.js";
import { getEcbRate } from "../../src/engine/ecb.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import type { Statement } from "../../src/types/broker.js";
import type { Trade, CashTransaction, OpenPosition } from "../../src/types/ibkr.js";
import type { ManualOpeningLot } from "../../src/types/tax.js";

// All fixtures below are ANONYMIZED: synthetic account IDs, no real NIF/names/amounts.

function makeTrade(overrides: Partial<Trade>): Trade {
  const tradeDate = overrides.tradeDate ?? "2025-04-10";
  return {
    tradeID: "t1",
    accountId: "ACC-TEST",
    symbol: "AAA",
    description: "",
    isin: "",
    assetCategory: "STK",
    currency: "USD",
    tradeDate,
    settlementDate: tradeDate,
    quantity: "1",
    tradePrice: "1",
    tradeMoney: "1",
    proceeds: "1",
    cost: "1",
    fifoPnlRealized: "0",
    fxRateToBase: "0",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "X",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

function makeCash(overrides: Partial<CashTransaction>): CashTransaction {
  return {
    transactionID: "c1",
    accountId: "ACC-TEST",
    symbol: "",
    description: "",
    isin: "",
    currency: "GBP",
    dateTime: "20230615;120000",
    settleDate: "20230615",
    amount: "1",
    fxRateToBase: "0",
    type: "Dividends",
    ...overrides,
  };
}

function makeStatement(trades: Trade[], cashTransactions: CashTransaction[] = []): Statement {
  return {
    accountId: "ACC-TEST",
    fromDate: "",
    toDate: "",
    period: "",
    trades,
    cashTransactions,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
}

/**
 * A fake fetcher that records every (year, currencies) call and returns one
 * synthetic observation per requested currency. Stands in for the real ECB SDMX
 * network round-trip so the orchestrator can be tested with NO network at all.
 */
function makeFakeFetcher(): { fetcher: EcbFetcher; calls: Array<{ year: number; currencies: string[] }> } {
  const calls: Array<{ year: number; currencies: string[] }> = [];
  const fetcher: EcbFetcher = (year, currencies) => {
    calls.push({ year, currencies: [...currencies] });
    const map: EcbRateMap = new Map();
    // One deterministic observation per (year, currency): date 0701, rate encodes both.
    for (const currency of currencies) {
      const date = `${year}-07-01`;
      let byCur = map.get(date);
      if (!byCur) {
        byCur = new Map();
        map.set(date, byCur);
      }
      byCur.set(currency, `0.${year}${currency}`);
    }
    return Promise.resolve(map);
  };
  return { fetcher, calls };
}

describe("deriveEcbNeeds", () => {
  it("(a) derives the correct (currency, year) needs from sample statements", () => {
    const statement = makeStatement(
      [
        makeTrade({ currency: "USD", tradeDate: "2025-03-02" }),
        makeTrade({ currency: "GBP", tradeDate: "2024-11-20" }),
        makeTrade({ currency: "EUR", tradeDate: "2025-05-01" }), // EUR stripped
      ],
      [
        // Cash transaction in a year with NO trades (2022) — its year must be included.
        makeCash({ currency: "CHF", dateTime: "20220615;120000" }),
      ],
    );

    const needs = deriveEcbNeeds(statement, 2025);

    // EUR is removed; trade + cash currencies remain.
    expect([...needs.currencies].sort()).toEqual(["CHF", "GBP", "USD"]);
    // Years: 2025 (trade + declaration), 2024 (trade), 2022 (cash), plus the year
    // before each of them for the early-January lookback (2021, 2023).
    for (const y of [2021, 2022, 2023, 2024, 2025]) expect(needs.years).toContain(y);
  });

  it("adds the previous year of EVERY year, so a gap year still gets its late-December rates", () => {
    // Activity in 2023, nothing in 2024, a USD dividend on 1 January 2025.
    const statement = makeStatement(
      [makeTrade({ currency: "USD", tradeDate: "2023-06-10" })],
      [makeCash({ currency: "USD", dateTime: "20250101;120000" })],
    );
    const needs = deriveEcbNeeds(statement, 2025);
    expect(needs.years).toContain(2024);
  });

  it("includes the currencies of open positions and cash balances", () => {
    const statement = makeStatement([makeTrade({ currency: "EUR", tradeDate: "2025-03-02" })]);
    const position: OpenPosition = {
      accountId: "ACC-TEST",
      symbol: "GBETF",
      description: "",
      isin: "",
      currency: "GBP",
      assetCategory: "STK",
      quantity: "100",
      costBasisMoney: "1",
      costBasisPrice: "1",
      markPrice: "800",
      positionValue: "80000",
      fifoPnlUnrealized: "0",
      fxRateToBase: "0",
    };
    statement.openPositions = [position];
    statement.cashBalances = [
      { accountId: "ACC-TEST", currency: "USD", endingCash: "70000", endingSettledCash: "70000" },
    ];

    const needs = deriveEcbNeeds(statement, 2025);

    expect(needs.currencies).toContain("GBP");
    expect(needs.currencies).toContain("USD");
  });

  it("includes minYear - 1 for the early-January lookback", () => {
    const statement = makeStatement([makeTrade({ currency: "USD", tradeDate: "2023-01-02" })]);
    const needs = deriveEcbNeeds(statement, 2023);
    expect(needs.years).toContain(2022); // minYear (2023) - 1
  });

  it("includes manual opening lots in currencies and years", () => {
    const statement = makeStatement([]);
    const manualOpeningLots: ManualOpeningLot[] = [
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "10",
        pricePerShare: "100",
      },
    ];

    const needs = deriveEcbNeeds(statement, 2025, manualOpeningLots);

    expect(needs.currencies).toEqual(["USD"]);
    expect([...needs.years].sort((x, y) => x - y)).toEqual([2023, 2024, 2025]);
  });

  it("returns no years when there are no trades or cash and the declaration year is added", () => {
    const statement = makeStatement([]);
    const needs = deriveEcbNeeds(statement, 2025);
    // Declaration year present; minYear-1 (2024) added because years is non-empty.
    expect([...needs.years].sort((x, y) => x - y)).toEqual([2024, 2025]);
    expect(needs.currencies).toEqual([]);
  });
});

describe("buildEcbRateMap", () => {
  beforeEach(() => {
    __resetEcbCache();
  });

  it("(d) merges per-year fetch batches into one correct rate map", async () => {
    const { fetcher } = makeFakeFetcher();
    const statement = makeStatement([
      makeTrade({ currency: "USD", tradeDate: "2025-06-10" }),
      makeTrade({ currency: "GBP", tradeDate: "2024-06-10" }),
    ]);

    const map = await buildEcbRateMap({ statement, year: 2025 }, { fetcher });

    // Both years' observations present and correctly keyed.
    expect(map.get("2025-07-01")?.get("USD")).toBe("0.2025USD");
    expect(map.get("2024-07-01")?.get("GBP")).toBe("0.2024GBP");
    // 2023 (minYear-1) was fetched too (lookback) — same currencies, distinct date.
    expect(map.get("2023-07-01")?.get("USD")).toBe("0.2023USD");
  });

  it("fetches prior-year ECB rates needed only by manual opening lots", async () => {
    const { fetcher } = makeFakeFetcher();
    const statement = makeStatement([]);
    const manualOpeningLots: ManualOpeningLot[] = [
      {
        symbol: "AAPL",
        description: "APPLE INC",
        isin: "US0378331005",
        assetCategory: "STK",
        currency: "USD",
        acquireDate: "2024-01-10",
        quantity: "10",
        pricePerShare: "100",
      },
    ];

    const map = await buildEcbRateMap({ statement, year: 2025, manualOpeningLots }, { fetcher });

    expect(map.get("2024-07-01")?.get("USD")).toBe("0.2024USD");
    expect(map.get("2023-07-01")?.get("USD")).toBe("0.2023USD");
  });

  it("does NOT overwrite a date's sub-map when two currencies share a fetch date", async () => {
    const { fetcher } = makeFakeFetcher();
    // Single year so both currencies land on the same 0701 date.
    const needs = { currencies: ["USD", "GBP"], years: [2025] };
    const map = await buildEcbRateMap(needs, { fetcher });
    const day = map.get("2025-07-01");
    expect(day?.get("USD")).toBe("0.2025USD");
    expect(day?.get("GBP")).toBe("0.2025GBP");
  });

  it("(b) a second call for the same needs does NOT re-invoke the fetcher (memoization)", async () => {
    const { fetcher, calls } = makeFakeFetcher();
    const needs = { currencies: ["USD", "GBP"], years: [2025] };

    const first = await buildEcbRateMap(needs, { fetcher });
    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await buildEcbRateMap(needs, { fetcher });

    // No new fetcher invocations on the second call — fully served from cache.
    expect(calls.length).toBe(callsAfterFirst);
    // And the cached map is identical to the freshly-built one.
    expect(second.get("2025-07-01")?.get("USD")).toBe(first.get("2025-07-01")?.get("USD"));
    expect(second.get("2025-07-01")?.get("GBP")).toBe("0.2025GBP");
  });

  it("(c) a superset call fetches ONLY the missing (currency, year) pairs", async () => {
    const { fetcher, calls } = makeFakeFetcher();

    // Warm the cache with USD@2025.
    await buildEcbRateMap({ currencies: ["USD"], years: [2025] }, { fetcher });
    calls.length = 0; // reset the recorder

    // Superset: USD (cached) + GBP (missing) for the same year.
    const map = await buildEcbRateMap({ currencies: ["USD", "GBP"], years: [2025] }, { fetcher });

    // Exactly one fetch, and it asked ONLY for the missing GBP — never USD again.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.year).toBe(2025);
    expect(calls[0]!.currencies).toEqual(["GBP"]);

    // The merged result still contains BOTH the cached USD and the new GBP.
    expect(map.get("2025-07-01")?.get("USD")).toBe("0.2025USD");
    expect(map.get("2025-07-01")?.get("GBP")).toBe("0.2025GBP");
  });

  it("fetches a missing year while reusing a cached year (superset across years)", async () => {
    const { fetcher, calls } = makeFakeFetcher();

    await buildEcbRateMap({ currencies: ["USD"], years: [2025] }, { fetcher });
    calls.length = 0;

    await buildEcbRateMap({ currencies: ["USD"], years: [2024, 2025] }, { fetcher });

    // Only 2024 is fetched; 2025 served from cache.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.year).toBe(2024);
    expect(calls[0]!.currencies).toEqual(["USD"]);
  });

  it("does not refetch a currency that returned no rows (cached empty result)", async () => {
    // Fetcher that returns an EMPTY map (e.g. crypto/no observations).
    const calls: number[] = [];
    const emptyFetcher: EcbFetcher = (year) => {
      calls.push(year);
      const empty: EcbRateMap = new Map();
      return Promise.resolve(empty);
    };

    await buildEcbRateMap({ currencies: ["BTC"], years: [2025] }, { fetcher: emptyFetcher });
    await buildEcbRateMap({ currencies: ["BTC"], years: [2025] }, { fetcher: emptyFetcher });

    // Second call is fully cached even though the first returned nothing.
    expect(calls).toEqual([2025]);
  });

  it("noCache bypasses the cache (read and write) for a logically-distinct run", async () => {
    const { fetcher, calls } = makeFakeFetcher();
    const needs = { currencies: ["USD"], years: [2025] };

    await buildEcbRateMap(needs, { fetcher, noCache: true });
    await buildEcbRateMap(needs, { fetcher, noCache: true });

    // Both runs fetch — nothing is read from or written to the shared cache.
    expect(calls).toHaveLength(2);
  });

  it("resolves a 1 January dividend after a gap year (late-December rates are fetched)", async () => {
    // Business-day observations only: 1 January and weekends have no rate.
    const fetcher: EcbFetcher = (year, currencies) => {
      const map: EcbRateMap = new Map();
      for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
        const dow = d.getUTCDay();
        const iso = d.toISOString().slice(0, 10);
        if (dow === 0 || dow === 6 || iso.endsWith("-01-01")) continue;
        map.set(iso, new Map(currencies.map((c) => [c, "0.9"])));
      }
      return Promise.resolve(map);
    };
    const statement = makeStatement(
      [makeTrade({ currency: "USD", tradeDate: "2023-06-10" })],
      [makeCash({ currency: "USD", dateTime: "20250101;120000" })],
    );

    const map = await buildEcbRateMap({ statement, year: 2025 }, { fetcher, noCache: true });

    expect(getEcbRate(map, "2025-01-01", "USD").toString()).toBe("0.9");
  });

  it("refetches the current year (its batch is still growing) but keeps serving past years from the cache", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    try {
      const calls: number[] = [];
      const published: Record<string, string> = { "2026-09-28": "0.90" };
      const fetcher: EcbFetcher = (year, currencies) => {
        calls.push(year);
        const map: EcbRateMap = new Map();
        if (year === 2026) {
          for (const [date, rate] of Object.entries(published)) {
            map.set(date, new Map(currencies.map((c) => [c, rate])));
          }
        } else {
          map.set(`${year}-12-30`, new Map(currencies.map((c) => [c, "0.80"])));
        }
        return Promise.resolve(map);
      };

      await buildEcbRateMap({ currencies: ["USD"], years: [2024, 2026] }, { fetcher });
      // The ECB publishes the next day's rate while the tab stays open.
      published["2026-09-29"] = "0.95";
      const second = await buildEcbRateMap({ currencies: ["USD"], years: [2024, 2026] }, { fetcher });

      expect(getEcbRate(second, "2026-09-29", "USD").toString()).toBe("0.95");
      // 2026 fetched twice; 2024 fetched once and then served from the cache.
      expect(calls.filter((y) => y === 2026)).toHaveLength(2);
      expect(calls.filter((y) => y === 2024)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches the years in parallel, not one after another", async () => {
    const DELAY_MS = 50;
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher: EcbFetcher = async (year, currencies) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, DELAY_MS));
      inFlight--;
      return new Map([[`${year}-07-01`, new Map(currencies.map((c) => [c, `0.${year}`]))]]);
    };

    const start = Date.now();
    const map = await buildEcbRateMap({ currencies: ["USD"], years: [2023, 2024, 2025] }, { fetcher, noCache: true });
    const elapsed = Date.now() - start;

    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThan(3 * DELAY_MS);
    for (const y of [2023, 2024, 2025]) expect(map.get(`${y}-07-01`)?.get("USD")).toBe(`0.${y}`);
  });

  it("defaults to the real fetchEcbRates when no fetcher is injected (no accidental network in this test)", async () => {
    // Empty needs → no years to fetch → returns an empty map without touching fetch.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const map = await buildEcbRateMap({ currencies: [], years: [] });
    expect(map.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
