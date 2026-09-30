import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { tradeRepublicParser } from "../../src/parsers/trade-republic.js";
import { coinbaseParser } from "../../src/parsers/coinbase.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

const HEADER =
  '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");
}

/** EUR-only statements need no ECB rates. */
const NO_RATES: EcbRateMap = new Map();

describe("Trade Republic: rows the parser does not import are reported", () => {
  const statement = tradeRepublicParser.parse(fixture("trade-republic-sample.csv"));
  const messages = statement.parserMessages ?? [];

  it("warns about the fund merger and names both ISINs", () => {
    const merger = messages.find((m) => m.id === "trade_republic.corporate_action_not_applied");
    expect(merger).toBeDefined();
    expect(merger!.severity).toBe("warning");
    expect(merger!.context?.count).toBe("2");
    expect(merger!.context?.isins).toContain("LU0000000001");
    expect(merger!.context?.isins).toContain("IE0000000001");
  });

  it("warns about the free-share delivery and names its ISIN", () => {
    const delivery = messages.find((m) => m.id === "trade_republic.delivery_not_applied");
    expect(delivery).toBeDefined();
    expect(delivery!.severity).toBe("warning");
    expect(delivery!.context?.count).toBe("1");
    expect(delivery!.context?.isins).toBe("DE0000004001");
  });

  it("stays silent when the file has neither", () => {
    const csv = [
      HEADER,
      '"2025-05-05T08:43:55.972Z","2025-05-05","DEFAULT","TRADING","BUY","STOCK","Acme Corp","US0000001001","1.0000000000","179.880000","-179.88","-1.00","","EUR","","","","Buy","tx-1","","","",""',
    ].join("\n");
    expect(tradeRepublicParser.parse(csv).parserMessages).toBeUndefined();
  });
});

describe("Trade Republic: a trade row with no unit price", () => {
  const csv = [
    HEADER,
    '"2025-05-05T08:43:55.972Z","2025-05-05","DEFAULT","TRADING","BUY","STOCK","Acme Corp","US0000001001","1.0000000000","","-179.88","-1.00","","EUR","","","","Buy","tx-buy","","","",""',
    '"2025-06-05T08:43:55.972Z","2025-06-05","DEFAULT","TRADING","SELL","STOCK","Acme Corp","US0000001001","-1.0000000000","190.000000","190.00","-1.00","","EUR","","","","Sell","tx-sell","","","",""',
  ].join("\n");

  it("takes the price from amount / shares, so the lot costs 180.88 and not just the fee", () => {
    const statement = tradeRepublicParser.parse(csv);
    const buy = statement.trades.find((t) => t.tradeID === "tx-buy")!;
    expect(buy.tradePrice).toBe("179.88");

    const report = generateTaxReport(statement, NO_RATES, 2025);
    const disposals = report.capitalGains.disposals;
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.costBasisEur.toString()).toBe("180.88");
    expect(disposals[0]!.proceedsEur.toString()).toBe("189");
  });
});

describe("Trade Republic: crypto is keyed by ticker", () => {
  it("parses the fixture's Bitcoin rows as symbol BTC with no ISIN", () => {
    const statement = tradeRepublicParser.parse(fixture("trade-republic-sample.csv"));
    const btc = statement.trades.filter((t) => t.assetCategory === "CRYPTO");
    expect(btc).toHaveLength(2);
    for (const t of btc) {
      expect(t.symbol).toBe("BTC");
      expect(t.isin).toBe("");
      expect(t.description).toBe("Bitcoin");
    }
  });

  it("lets a Coinbase BTC sale consume a Trade Republic BTC lot", () => {
    const tr = tradeRepublicParser.parse([
      HEADER,
      '"2025-01-10T10:00:00.000Z","2025-01-10","DEFAULT","TRADING","BUY","CRYPTO","Bitcoin","BTC","0.0100000000","90000.000000","-900.00","","","EUR","","","","Buy trade Bitcoin","tx-btc-buy","","","",""',
    ].join("\n"));
    const cb = coinbaseParser.parse([
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
      "2025-06-10T10:00:00Z,Sell,BTC,0.01,EUR,95000.00,950.00,950.00,0.00,Sold 0.01 BTC",
    ].join("\n"));

    const merged = createEmptyStatement();
    mergeStatement(merged, tr);
    mergeStatement(merged, cb);
    const report = generateTaxReport(finalizeMergedStatement(merged), NO_RATES, 2025);

    expect(report.messages.map((m) => m.id)).not.toContain("fifo.sell_without_lots");
    const disposals = report.capitalGains.disposals;
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.costBasisEur.toString()).toBe("900");
    expect(disposals[0]!.gainLossEur.toString()).toBe("50");
  });
});
