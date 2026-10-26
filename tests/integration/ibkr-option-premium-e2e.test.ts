import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { generateTaxReport } from "../../src/generators/report.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import type { FlexStatement } from "../../src/types/ibkr.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// IBKR Flex XML → generateTaxReport, option premium regressions.
// Synthetic instruments only (XYZ / ISIN XX0000000099), shaped like real Flex
// rows: OptionEAE carries the event type ONLY in `transactionType`, and the
// option leg of an expiry/exercise also appears as a Trade with notes Ep/Ex.
// ===========================================================================

function makeRateMap(rates: Record<string, string>): EcbRateMap {
  const map: EcbRateMap = new Map();
  for (const [date, usd] of Object.entries(rates)) map.set(date, new Map([["USD", new Decimal(usd)]]));
  return map;
}

function flex(trades: string, eae = ""): FlexStatement {
  const xml = `<FlexQueryResponse queryName="Test" type="AF">
    <FlexStatements count="1">
      <FlexStatement accountId="U1" fromDate="20240101" toDate="20251231" period="Custom">
        <Trades>${trades}</Trades>
        <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        <OptionEAE>${eae}</OptionEAE>
      </FlexStatement>
    </FlexStatements>
  </FlexQueryResponse>`;
  return finalizeMergedStatement(mergeStatement(createEmptyStatement(), parseIbkrFlexXml(xml)));
}

/** One option Trade row on XYZ (USD, multiplier 100). */
function optTrade(a: {
  id: string; date: string; side: "BUY" | "SELL"; qty: string; price: string; comm: string;
  oc: "O" | "C"; putCall: "C" | "P"; strike: string; expiry: string; notes?: string;
}): string {
  const code = `XYZ   ${a.expiry.slice(2)}${a.putCall}000${a.strike}000`;
  return `<Trade tradeID="${a.id}" accountId="U1" symbol="${code}" description="XYZ ${a.expiry} ${a.strike} ${a.putCall}"
    conid="9${a.putCall === "C" ? 1 : 2}${a.strike}" isin="" assetCategory="OPT" currency="USD" tradeDate="${a.date}" settlementDate="${a.date}"
    quantity="${a.qty}" tradePrice="${a.price}" tradeMoney="${new Decimal(a.qty).mul(a.price).mul(100)}" proceeds="0" cost="0"
    fifoPnlRealized="0" fxRateToBase="1" buySell="${a.side}" openCloseIndicator="${a.oc}" exchange="CBOE"
    ibCommissionCurrency="USD" ibCommission="${a.comm}" taxes="0" multiplier="100" putCall="${a.putCall}"
    strike="${a.strike}" expiry="${a.expiry}" underlyingSymbol="XYZ" underlyingSecurityID="XX0000000099" notes="${a.notes ?? ""}" />`;
}

function stkTrade(a: { id: string; date: string; side: "BUY" | "SELL"; qty: string; price: string; comm: string }): string {
  return `<Trade tradeID="${a.id}" accountId="U1" symbol="XYZ" description="XYZ CORP" isin="XX0000000099" assetCategory="STK"
    currency="USD" tradeDate="${a.date}" settlementDate="${a.date}" quantity="${a.qty}" tradePrice="${a.price}"
    tradeMoney="${new Decimal(a.qty).mul(a.price)}" proceeds="0" cost="0" fifoPnlRealized="0" fxRateToBase="1"
    buySell="${a.side}" openCloseIndicator="${a.side === "BUY" ? "O" : "C"}" exchange="NYSE"
    ibCommissionCurrency="USD" ibCommission="${a.comm}" taxes="0" multiplier="1" />`;
}

function eaeRow(a: { date: string; type: string; qty: string; putCall: "C" | "P"; strike: string; expiry: string }): string {
  const code = `XYZ   ${a.expiry.slice(2)}${a.putCall}000${a.strike}000`;
  return `<OptionEAE accountId="U1" currency="USD" assetCategory="OPT" symbol="${code}" description="XYZ ${a.expiry} ${a.strike} ${a.putCall}"
    conid="9${a.putCall === "C" ? 1 : 2}${a.strike}" isin="" underlyingSymbol="XYZ" underlyingSecurityID="XX0000000099" multiplier="100"
    strike="${a.strike}" expiry="${a.expiry}" putCall="${a.putCall}" date="${a.date}" transactionType="${a.type}"
    quantity="${a.qty}" tradePrice="0" proceeds="0" realizedPnl="0" />`;
}

describe("bought call that expires worthless (OptionEAE transactionType=Expiration)", () => {
  // BUY 2 XYZ 50 C at 1.50 on 2025-03-03 with a 1.30 USD fee → premium 301.30 USD.
  // Expires worthless 2025-06-20. Loss = the premium (Art. 33.1 / 37.1.m LIRPF).
  const rates = makeRateMap({ "2025-03-03": "0.95", "2025-06-20": "0.88" });
  const stmt = flex(
    optTrade({ id: "1", date: "20250303", side: "BUY", qty: "2", price: "1.50", comm: "-1.30", oc: "O", putCall: "C", strike: "50", expiry: "20250620" }) +
      optTrade({ id: "2", date: "20250620", side: "SELL", qty: "-2", price: "0", comm: "0", oc: "C", putCall: "C", strike: "50", expiry: "20250620", notes: "Ep" }),
    eaeRow({ date: "20250620", type: "Expiration", qty: "2", putCall: "C", strike: "50", expiry: "20250620" }),
  );

  it("monodivisa: books a loss equal to the premium at its purchase-date rate, no phantom shares", () => {
    const report = generateTaxReport(stmt, rates, 2025, { skipFx: true });
    const disposals = report.capitalGains.disposals;
    expect(disposals).toHaveLength(1);
    const d = disposals[0]!;
    expect(d.optionScenario).toBe("expiration");
    expect(d.sellDate).toBe("2025-06-20");
    expect(d.proceedsEur.toFixed(4)).toBe("0.0000");
    expect(d.costBasisEur.toFixed(4)).toBe("286.2350"); // 301.30 × 0.95
    expect(report.capitalGains.netGainLoss.toFixed(4)).toBe("-286.2350");
    expect(disposals.some((x) => x.assetCategory === "STK")).toBe(false);
  });

  it("default mode: the same loss at the expiry-date rate", () => {
    const report = generateTaxReport(stmt, rates, 2025);
    const opt = report.capitalGains.disposals.filter((d) => d.assetCategory === "OPT");
    expect(opt).toHaveLength(1);
    expect(opt[0]!.gainLossEur.toFixed(4)).toBe("-265.1440"); // 301.30 × 0.88
  });
});

describe("IBKR commission rebate (positive ibCommission)", () => {
  // BUY 1 XYZ 60 C at 3.00 with a 2.00 USD REBATE (ibCommission +2), SELL at 5.00
  // paying 1.00 USD. Cost = 300 − 2 = 298; proceeds = 500 − 1 = 499 (Art. 35.1.b
  // and 35.2 LIRPF: only expenses actually borne). abs() made the rebate a fee
  // (cost 302) and understated the gain by twice the rebate.
  const rates = makeRateMap({ "2025-02-03": "0.90", "2025-04-01": "0.90" });
  const stmt = flex(
    optTrade({ id: "1", date: "20250203", side: "BUY", qty: "1", price: "3.00", comm: "2.00", oc: "O", putCall: "C", strike: "60", expiry: "20250620" }) +
      optTrade({ id: "2", date: "20250401", side: "SELL", qty: "-1", price: "5.00", comm: "-1.00", oc: "C", putCall: "C", strike: "60", expiry: "20250620" }),
  );

  it("lowers the acquisition value instead of raising it", () => {
    const report = generateTaxReport(stmt, rates, 2025, { skipFx: true });
    expect(report.capitalGains.disposals).toHaveLength(1);
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("268.20"); // 298 × 0.90
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("449.10"); // 499 × 0.90
    expect(report.capitalGains.netGainLoss.toFixed(2)).toBe("180.90");
  });

  it("raises the transmission value when the rebate comes on the sale", () => {
    const report = generateTaxReport(
      flex(
        optTrade({ id: "1", date: "20250203", side: "BUY", qty: "1", price: "3.00", comm: "-1.00", oc: "O", putCall: "C", strike: "60", expiry: "20250620" }) +
          optTrade({ id: "2", date: "20250401", side: "SELL", qty: "-1", price: "5.00", comm: "1.50", oc: "C", putCall: "C", strike: "60", expiry: "20250620" }),
      ),
      rates,
      2025,
      { skipFx: true },
    );
    expect(report.capitalGains.acquisitionValue.toFixed(2)).toBe("270.90"); // 301 × 0.90
    expect(report.capitalGains.transmissionValue.toFixed(2)).toBe("451.35"); // 501.50 × 0.90
  });
});

describe("monodivisa: an exercised option's premium keeps the rate of the day it was paid", () => {
  // Rates: premium day 0.95, exercise day 0.97, share sale day 0.92.
  const rates = makeRateMap({
    "2024-11-04": "0.93",
    "2024-12-10": "0.95",
    "2025-01-17": "0.97",
    "2025-03-19": "0.92",
  });

  it("call buyer: share cost = strike at the exercise rate + premium at its purchase rate", () => {
    // BUY 1 XYZ 20 C at 3.00 + 1.00 fee on 2024-12-10 (premium 301 USD), exercised
    // 2025-01-17 (100 shares at 20 = 2000 USD), shares sold 2025-03-19 at 25 − 1 fee.
    const stmt = flex(
      optTrade({ id: "1", date: "20241210", side: "BUY", qty: "1", price: "3.00", comm: "-1.00", oc: "O", putCall: "C", strike: "20", expiry: "20250117" }) +
        optTrade({ id: "2", date: "20250117", side: "SELL", qty: "-1", price: "0", comm: "0", oc: "C", putCall: "C", strike: "20", expiry: "20250117", notes: "Ex" }) +
        stkTrade({ id: "3", date: "20250319", side: "SELL", qty: "-100", price: "25", comm: "-1.00" }),
      eaeRow({ date: "20250117", type: "Exercise", qty: "1", putCall: "C", strike: "20", expiry: "20250117" }),
    );
    const mono = generateTaxReport(stmt, rates, 2025, { skipFx: true });
    const sale = mono.capitalGains.disposals.filter((d) => d.assetCategory === "STK");
    expect(sale).toHaveLength(1);
    // 2000 × 0.97 + 301 × 0.95 = 1940 + 285.95 (the old code: 2301 × 0.97 = 2231.97)
    expect(sale[0]!.costBasisEur.toFixed(2)).toBe("2225.95");
    expect(sale[0]!.proceedsEur.toFixed(2)).toBe("2299.08"); // 2499 × 0.92
    expect(mono.capitalGains.disposals.some((d) => d.assetCategory === "OPT")).toBe(false);

    // Default mode is unchanged: the whole FCY cost at the sale-date rate.
    const fx = generateTaxReport(stmt, rates, 2025);
    const fxSale = fx.capitalGains.disposals.filter((d) => d.assetCategory === "STK");
    expect(fxSale[0]!.costBasisEur.toFixed(2)).toBe("2116.92"); // 2301 × 0.92
  });

  it("put writer assigned: share cost = strike at the assignment rate − premium at its sale rate", () => {
    // SELL 1 XYZ 20 P at 2.00 − 1.00 fee on 2024-11-04 (premium received 199 USD),
    // assigned 2025-01-17 (buys 100 shares at 20), shares sold 2025-03-19 at 25 − 1.
    const stmt = flex(
      optTrade({ id: "1", date: "20241104", side: "SELL", qty: "-1", price: "2.00", comm: "-1.00", oc: "O", putCall: "P", strike: "20", expiry: "20250117" }) +
        optTrade({ id: "2", date: "20250117", side: "BUY", qty: "1", price: "0", comm: "0", oc: "C", putCall: "P", strike: "20", expiry: "20250117", notes: "A" }) +
        stkTrade({ id: "3", date: "20250319", side: "SELL", qty: "-100", price: "25", comm: "-1.00" }),
      eaeRow({ date: "20250117", type: "Assignment", qty: "1", putCall: "P", strike: "20", expiry: "20250117" }),
    );
    const mono = generateTaxReport(stmt, rates, 2025, { skipFx: true });
    const sale = mono.capitalGains.disposals.filter((d) => d.assetCategory === "STK");
    expect(sale).toHaveLength(1);
    // 2000 × 0.97 − 199 × 0.93 = 1940 − 185.07 (the old code: 1801 × 0.97 = 1746.97)
    expect(sale[0]!.costBasisEur.toFixed(2)).toBe("1754.93");
  });

  it("put buyer exercising: proceeds = strike at the exercise rate − premium at its purchase rate", () => {
    // BUY 100 XYZ at 22 + 1 fee on 2024-11-04; BUY 1 XYZ 20 P at 3.00 + 1 fee on
    // 2024-12-10 (premium 301 USD); exercised 2025-01-17 (sells the 100 at 20).
    const stmt = flex(
      stkTrade({ id: "1", date: "20241104", side: "BUY", qty: "100", price: "22", comm: "-1.00" }) +
        optTrade({ id: "2", date: "20241210", side: "BUY", qty: "1", price: "3.00", comm: "-1.00", oc: "O", putCall: "P", strike: "20", expiry: "20250117" }) +
        optTrade({ id: "3", date: "20250117", side: "SELL", qty: "-1", price: "0", comm: "0", oc: "C", putCall: "P", strike: "20", expiry: "20250117", notes: "Ex" }),
      eaeRow({ date: "20250117", type: "Exercise", qty: "1", putCall: "P", strike: "20", expiry: "20250117" }),
    );
    const mono = generateTaxReport(stmt, rates, 2025, { skipFx: true });
    const sale = mono.capitalGains.disposals.filter((d) => d.assetCategory === "STK");
    expect(sale).toHaveLength(1);
    // 2000 × 0.97 − 301 × 0.95 = 1940 − 285.95 (the old code: 1699 × 0.97 = 1648.03)
    expect(sale[0]!.proceedsEur.toFixed(2)).toBe("1654.05");
    expect(sale[0]!.costBasisEur.toFixed(2)).toBe("2046.93"); // 2201 × 0.93
  });
});
