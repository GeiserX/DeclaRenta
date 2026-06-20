import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { lightyearParser } from "../../src/parsers/lightyear.js";

// ---------------------------------------------------------------------------
// realEurAmount on Lightyear FX conversions (Art. 35.1 LIRPF; issue #253)
//
// A Lightyear conversion is a PAIR of rows sharing a timestamp, one per
// currency. The EUR leg's |Net Amt.| is the REAL spread-laden EUR principal
// (fee excluded — the parser emits the fee separately as a -Fee commission and
// the FX engine applies it on top). The parser harvests that |Net Amt.| and
// stamps it onto the non-EUR CASH trade as `realEurAmount`, so the engine can
// value the conversion at the broker's effective rate instead of ECB.
// ---------------------------------------------------------------------------

const HEADER = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";

describe("lightyearParser - FX conversion realEurAmount", () => {
  it("should set realEurAmount from the EUR leg Net Amt. on a EUR→USD buy", () => {
    // Real fixture pair: buy USD 64.50, EUR leg Gross -59.24, Fee 0.21, Net -59.03
    const csv = [
      HEADER,
      "07/04/2025 19:09:30,CN-0000000012,USD,,Conversion,,USD,,64.50,0.91515,,64.50,",
      "07/04/2025 19:09:30,CN-0000000013,EUR,,Conversion,,EUR,,-59.24,1.09271,0.21,-59.03,",
    ].join("\n");
    const result = lightyearParser.parse(csv);
    const fx = result.trades.find((t) => t.assetCategory === "CASH")!;
    expect(fx).toBeDefined();
    expect(fx.currency).toBe("USD");
    expect(fx.buySell).toBe("BUY");
    // |EUR Net Amt.| (spread embedded, fee EXCLUDED), NOT |Gross|
    expect(fx.realEurAmount).toBe("59.03");
    expect(fx.commission).toBe("-0.21");
    expect(fx.commissionCurrency).toBe("EUR");
  });

  it("should set realEurAmount from the EUR leg on a USD→EUR sell", () => {
    // Sell USD 500 → receive EUR; EUR leg Gross +460.21, Fee 0.21, Net +460.00
    const csv = [
      HEADER,
      "10/05/2025 12:00:00,CN-0000000098,USD,,Conversion,,USD,,-500.00,1.087,,-500.00,",
      "10/05/2025 12:00:00,CN-0000000099,EUR,,Conversion,,EUR,,460.21,0.92,0.21,460.00,",
    ].join("\n");
    const result = lightyearParser.parse(csv);
    const fx = result.trades.find((t) => t.assetCategory === "CASH")!;
    expect(fx).toBeDefined();
    expect(fx.currency).toBe("USD");
    expect(fx.buySell).toBe("SELL");
    expect(fx.quantity).toBe("-500");
    // |EUR Net Amt.| of the pair
    expect(fx.realEurAmount).toBe("460");
    expect(fx.commission).toBe("-0.21");
    expect(fx.commissionCurrency).toBe("EUR");
  });

  it("should set realEurAmount from Net Amt. even when there is no fee", () => {
    // Fee-free conversion: EUR leg Net -100.00, no Fee column value
    const csv = [
      HEADER,
      "11/06/2025 08:30:00,CN-0000000200,USD,,Conversion,,USD,,108.70,0.92,,108.70,",
      "11/06/2025 08:30:00,CN-0000000201,EUR,,Conversion,,EUR,,-100.00,1.087,,-100.00,",
    ].join("\n");
    const result = lightyearParser.parse(csv);
    const fx = result.trades.find((t) => t.assetCategory === "CASH")!;
    expect(fx).toBeDefined();
    expect(fx.currency).toBe("USD");
    expect(fx.realEurAmount).toBe("100");
    // No fee → commission is "-0" (parser emits `-${abs("0")}`)
    expect(fx.commission).toBe("-0");
  });

  it("should leave realEurAmount unset for an FCY↔FCY conversion (no EUR leg)", () => {
    // No EUR leg present → no real EUR principal → engine falls back to ECB
    const csv = [
      HEADER,
      "12/07/2025 10:00:00,CN-0000000300,USD,,Conversion,,USD,,200.00,0.92,,200.00,",
      "12/07/2025 10:00:00,CN-0000000301,GBP,,Conversion,,GBP,,-158.00,1.27,,-158.00,",
    ].join("\n");
    const result = lightyearParser.parse(csv);
    const usdFx = result.trades.find((t) => t.assetCategory === "CASH" && t.currency === "USD")!;
    expect(usdFx).toBeDefined();
    expect(usdFx.realEurAmount).toBeUndefined();
  });

  it("should reconcile realEurAmount + |commission| to |EUR Gross Amount| (no double-count)", () => {
    // The invariant that proves the fee is NOT double-counted:
    //   realEurAmount (EUR Net) + |commission| (Fee) === |EUR Gross|
    const csv = [
      HEADER,
      "07/04/2025 19:09:30,CN-0000000012,USD,,Conversion,,USD,,64.50,0.91515,,64.50,",
      "07/04/2025 19:09:30,CN-0000000013,EUR,,Conversion,,EUR,,-59.24,1.09271,0.21,-59.03,",
    ].join("\n");
    const result = lightyearParser.parse(csv);
    const fx = result.trades.find((t) => t.assetCategory === "CASH")!;
    const realEur = new Decimal(fx.realEurAmount!);
    const fee = new Decimal(fx.commission).abs();
    const eurGross = new Decimal("59.24");
    expect(realEur.plus(fee).toString()).toBe(eurGross.toString());
  });

  it("should drop realEurAmount to ECB when TWO EUR legs share a timestamp (ambiguous pairing)", () => {
    // Two distinct conversions in the same second (USD→EUR and GBP→EUR). The
    // second-resolution timestamp cannot tell which EUR principal belongs to
    // which non-EUR leg, so attaching either would mis-value the conversion.
    // Both non-EUR trades must omit realEurAmount → engine falls back to ECB.
    const csv = [
      HEADER,
      "07/04/2025 19:09:30,CN-0000000401,USD,,Conversion,,USD,,64.50,0.91515,,64.50,",
      "07/04/2025 19:09:30,CN-0000000402,EUR,,Conversion,,EUR,,-59.24,1.09271,0.21,-59.03,",
      "07/04/2025 19:09:30,CN-0000000403,GBP,,Conversion,,GBP,,50.00,1.17,,50.00,",
      "07/04/2025 19:09:30,CN-0000000404,EUR,,Conversion,,EUR,,-58.50,1.17,0.00,-58.50,",
    ].join("\n");
    const result = lightyearParser.parse(csv);
    const cashTrades = result.trades.filter((t) => t.assetCategory === "CASH");
    expect(cashTrades.length).toBeGreaterThanOrEqual(2);
    for (const t of cashTrades) {
      expect(t.realEurAmount).toBeUndefined();
    }
  });
});
