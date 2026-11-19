import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  coerceWindowOverrides,
  collectIsinWindows,
  isValidIsin,
  listAntichurningSecurities,
  NON_EQUIVALENT_LISTINGS,
  OPEN_EQUIVALENT_LISTINGS,
  resolveIsinWindow,
  type IsinWindow,
} from "../../src/engine/antichurning-window.js";
import type { SecurityInfo, Trade } from "../../src/types/ibkr.js";
import type { FifoDisposal } from "../../src/types/tax.js";

// Issue #452: which window (LIRPF 33.5.f 2 months / 33.5.g 1 year) each ISIN gets.

const ISIN = "GB0007980591";

function trade(listing: string | undefined, over: Partial<Trade> = {}): Trade {
  return {
    tradeID: "1", accountId: "U1", symbol: "BP", description: "BP PLC", isin: ISIN, assetCategory: "STK",
    currency: "GBP", tradeDate: "2025-03-01", settlementDate: "2025-03-01", quantity: "1", tradePrice: "1",
    tradeMoney: "1", proceeds: "-1", cost: "1", fifoPnlRealized: "0", fxRateToBase: "1", buySell: "BUY",
    openCloseIndicator: "O", exchange: "LSE", commissionCurrency: "GBP", commission: "0", taxes: "0", multiplier: "1",
    ...(listing === undefined ? {} : { listingExchange: listing }),
    ...over,
  };
}

function info(listing: string, over: Partial<SecurityInfo> = {}): SecurityInfo {
  return { symbol: "BP", description: "BP PLC", isin: ISIN, cusip: "", currency: "GBP", assetCategory: "STK", multiplier: "1", subCategory: "", listingExchange: listing, ...over };
}

const resolve = (w: IsinWindow | undefined, day = "2025-03-01") => resolveIsinWindow(w, day);
const from = (listings: string[], day = "2025-03-01") => resolve({ listings }, day);

describe("resolveIsinWindow: IBKR codes", () => {
  it("LSE only, sale in 2025 → 12 from IBKR", () => {
    expect(from(["LSE"])).toEqual({ months: 12, source: "ibkr" });
  });
  it("LSE only, sale on 01/06/2020 (EU law until 31/12/2020) → no automatic year", () => {
    expect(from(["LSE"], "2020-06-01")).toBeUndefined();
    expect(from(["LSE"], "2020-12-31")).toBeUndefined();
    expect(from(["LSE"], "2021-01-01")?.months).toBe(12);
  });
  it("LSE plus NYSE, or plus an unknown code → no automatic year (one qualifying listing is enough)", () => {
    expect(from(["LSE", "NYSE"])).toBeUndefined();
    expect(from(["LSE", "XYZ"])).toBeUndefined();
  });
  it("no code → undefined (the caller keeps its default)", () => {
    expect(from([])).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
  });
  it("SIX (EBS) is 2 months only inside 24/12/2017-30/06/2019", () => {
    expect(from(["EBS"], "2019-03-01")).toBeUndefined();
    expect(from(["EBS"], "2017-12-24")).toBeUndefined();
    expect(from(["EBS"], "2019-06-30")).toBeUndefined();
    expect(from(["EBS"], "2019-07-01")?.months).toBe(12);
    expect(from(["EBS"], "2017-12-01")?.months).toBe(12);
  });
  it("Toronto (TSE) → 2 months, flagged open with Decision 2016/2273", () => {
    expect(from(["TSE"])).toEqual({ months: 2, source: "ibkr", openDecision: "2016/2273" });
  });
  it("Tokyo and Toronto together → both decisions; Toronto plus London 2025 still rests only on the open decision", () => {
    expect(from(["TSE", "TSEJ"])?.openDecision).toBe("2016/2271, 2016/2273");
    expect(from(["LSE", "TSE"])).toEqual({ months: 2, source: "ibkr", openDecision: "2016/2273" });
  });
  it("Toronto plus NYSE → not open (NYSE is settled letter f)", () => {
    expect(from(["NYSE", "TSE"])).toBeUndefined();
  });
  it("third-country markets with no decision give 12 from IBKR: Bursa Malaysia (BURSAMY), Korea, Mexico, OTC", () => {
    for (const code of ["BURSAMY", "KRX", "MEXI", "PINK"]) {
      expect(from([code]), code).toEqual({ months: 12, source: "ibkr" });
    }
  });
  it("LSEETF, the US, ASX, SEHK and EEA codes never give 1 year", () => {
    for (const code of ["LSEETF", "NYSE", "NASDAQ", "ARCA", "ASX", "CHIXAU", "SEHK", "IBIS", "AEB", "SBF", "BM"]) {
      expect(from([code]), code).toBeUndefined();
    }
  });
  it("prototype keys are no market", () => {
    expect(from(["__proto__"])).toBeUndefined();
    expect(from(["constructor"])).toBeUndefined();
    expect(from(["toString"])).toBeUndefined();
  });
  it("the lists do not overlap, and every code is upper case", () => {
    for (const code of Object.keys(NON_EQUIVALENT_LISTINGS)) {
      expect(code).toBe(code.toUpperCase());
      expect(Object.hasOwn(OPEN_EQUIVALENT_LISTINGS, code), code).toBe(false);
    }
    expect(Object.keys(NON_EQUIVALENT_LISTINGS)).not.toContain("TSE");
    expect(Object.keys(NON_EQUIVALENT_LISTINGS)).not.toContain("TSEJ");
    expect(Object.keys(NON_EQUIVALENT_LISTINGS)).not.toContain("LSEETF");
  });
});

describe("resolveIsinWindow: the user's value wins", () => {
  it("the user's 2 beats IBKR's 12", () => {
    expect(resolve({ user: 2, listings: ["LSE"] })).toEqual({ months: 2, source: "user" });
  });
  it("the user's 12 applies with no IBKR data", () => {
    expect(resolve({ user: 12, listings: [] })).toEqual({ months: 12, source: "user" });
  });
  it("the user's 12 applies on any date", () => {
    expect(resolve({ user: 12, listings: ["LSE"] }, "2019-01-01")?.months).toBe(12);
  });
});

describe("collectIsinWindows", () => {
  it("reads Trades and SecurityInfo, sorted and unique", () => {
    const w = collectIsinWindows([trade("LSE"), trade("LSE")], [info("NYSE")]);
    expect(w.get(ISIN)).toEqual({ listings: ["LSE", "NYSE"] });
  });
  it("a SecurityInfo-only NYSE vote turns a Trades-only LSE 12 into no automatic year", () => {
    expect(resolve(collectIsinWindows([trade("LSE")], []).get(ISIN))?.months).toBe(12);
    expect(resolve(collectIsinWindows([trade("LSE")], [info("NYSE")]).get(ISIN))).toBeUndefined();
  });
  it("CRYPTO and exempt categories (OPT) do not vote, nor rows with no ISIN or no code", () => {
    const w = collectIsinWindows(
      [trade("LSE", { assetCategory: "CRYPTO" }), trade("LSE", { assetCategory: "OPT" }), trade("LSE", { isin: "" }), trade(undefined)],
      [info("LSE", { assetCategory: "OPT" })],
    );
    expect(w.size).toBe(0);
  });
  it("adds the user's values, keeping IBKR's codes for the display", () => {
    const w = collectIsinWindows([trade("LSE")], [], { [ISIN]: 2, "US0378331005": 12 });
    expect(w.get(ISIN)).toEqual({ listings: ["LSE"], user: 2 });
    expect(w.get("US0378331005")).toEqual({ listings: [], user: 12 });
  });
});

describe("isValidIsin: shape and ISO 6166 check digit", () => {
  it("accepts real ISINs", () => {
    for (const isin of ["GB0007980591", "US0378331005", "ES0113900J37", "IE00B4L5Y983", "MYL1155OO000", "CA0679011084"]) {
      expect(isValidIsin(isin), isin).toBe(true);
    }
  });
  it("rejects a wrong check digit, a swapped pair, the wrong shape and lower case", () => {
    for (const isin of ["GB0007980592", "US0378331006", "GB0007989051", "GB000798059", "gb0007980591", "", "GB000798059X"]) {
      expect(isValidIsin(isin), isin).toBe(false);
    }
  });
});

describe("coerceWindowOverrides: untrusted input", () => {
  it("keeps ISIN keys (upper-cased) with exactly 2 or 12", () => {
    expect([...coerceWindowOverrides({ [ISIN.toLowerCase()]: 12, US0378331005: 2 })]).toEqual([[ISIN, 12], ["US0378331005", 2]]);
  });
  it("drops __proto__, bad ISINs, other numbers and strings", () => {
    const raw = JSON.parse(`{"__proto__": 12, "XX123": 12, "${ISIN}": "12", "US0378331005": 6, "DE0005140008": null}`) as unknown;
    expect(coerceWindowOverrides(raw).size).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("ignores arrays, null and primitives", () => {
    for (const raw of [null, undefined, 12, "x", [ISIN]]) expect(coerceWindowOverrides(raw).size).toBe(0);
  });
});

function disposal(over: Partial<FifoDisposal>): FifoDisposal {
  return {
    isin: ISIN, symbol: "BP", description: "BP PLC", sellDate: "2025-03-01", acquireDate: "2025-02-01",
    quantity: new Decimal(1), proceedsEur: new Decimal(80), costBasisEur: new Decimal(100), gainLossEur: new Decimal(-20),
    holdingPeriodDays: 28, currency: "GBP", sellEcbRate: new Decimal(1), acquireEcbRate: new Decimal(1), assetCategory: "STK",
    washSaleBlocked: false, gainLossFcy: new Decimal(0), proceedsFcy: new Decimal(0), costBasisFcy: new Decimal(0),
    blockedLossEur: new Decimal(0), reintegratedLossEur: new Decimal(0), ...over,
  };
}

describe("listAntichurningSecurities", () => {
  it("lists a loss sale with its resolved window; a gain sale with the default window is not listed", () => {
    const rows = listAntichurningSecurities([disposal({}), disposal({ isin: "US0378331005", symbol: "AAPL", gainLossEur: new Decimal(5) })], new Map(), 2025);
    expect(rows).toEqual([{ isin: ISIN, symbol: "BP", description: "BP PLC", months: 2, source: "default", autoMonths: 2, listingExchanges: [] }]);
  });
  it("a gain sale with an IBKR 1-year reading is listed", () => {
    const rows = listAntichurningSecurities([disposal({ gainLossEur: new Decimal(5) })], collectIsinWindows([trade("LSE")]), 2025);
    expect(rows[0]).toMatchObject({ months: 12, source: "ibkr", autoMonths: 12, listingExchanges: ["LSE"] });
  });
  it("a gain sale on Toronto (open decision, 2 months) with nothing released is not listed", () => {
    const rows = listAntichurningSecurities([disposal({ isin: "CA0106791084", gainLossEur: new Decimal(5) })], collectIsinWindows([trade("TSE", { isin: "CA0106791084" })]), 2025);
    expect(rows).toEqual([]);
  });
  it("a Toronto loss sale is listed with its open decision", () => {
    const rows = listAntichurningSecurities([disposal({ isin: "CA0106791084" })], collectIsinWindows([trade("TSE", { isin: "CA0106791084" })]), 2025);
    expect(rows[0]).toMatchObject({ months: 2, source: "ibkr", openDecision: "2016/2273" });
  });
  it("a user value with no sale in the year is listed with the trades' name", () => {
    const names = new Map([["US0378331005", { symbol: "AAPL", description: "APPLE INC" }]]);
    const rows = listAntichurningSecurities([], collectIsinWindows([], [], { US0378331005: 12 }), 2025, names);
    expect(rows).toEqual([{ isin: "US0378331005", symbol: "AAPL", description: "APPLE INC", months: 12, source: "user", autoMonths: 2, listingExchanges: [] }]);
  });
  it("crypto and options are never listed", () => {
    const rows = listAntichurningSecurities(
      [disposal({ assetCategory: "CRYPTO", isin: "" }), disposal({ assetCategory: "OPT" })],
      collectIsinWindows([], [], {}),
      2025,
    );
    expect(rows).toEqual([]);
  });
  it("the row's months follow the last sale day of the year (SIX before and after 30/06/2019)", () => {
    const w = collectIsinWindows([trade("EBS", { isin: "CH0038863350" })]);
    const early = listAntichurningSecurities([disposal({ isin: "CH0038863350", sellDate: "2019-03-01" })], w, 2019);
    const late = listAntichurningSecurities([disposal({ isin: "CH0038863350", sellDate: "2019-03-01" }), disposal({ isin: "CH0038863350", sellDate: "2019-09-01" })], w, 2019);
    expect(early[0]?.months).toBe(2);
    expect(late[0]?.months).toBe(12);
  });
});
