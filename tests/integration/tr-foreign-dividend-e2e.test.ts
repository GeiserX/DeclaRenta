import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { tradeRepublicParser } from "../../src/parsers/trade-republic.js";
import { ibkrParser } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { generateTaxReport } from "../../src/generators/report.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";

// ===========================================================================
// End-to-end: Trade Republic foreign dividends (issues #96, #476).
// ---------------------------------------------------------------------------
// TR converts a US dividend to EUR before crediting it. Its CSV writes the
// gross in EUR (`amount` = original_amount x fx_rate), keeps the original USD
// amount (`original_amount`/`original_currency`) and books the US withholding
// in EUR (the `tax` column, account currency).
//   - 0029: the gross EUR TR writes, no ECB rate (DGT V5732-26, #476).
//   - 0588: the EUR withholding, 1:1. It used to be 0 because the matcher
//     required the dividend and the withholding to share a currency.
//   - FX (1633/1637): the taxpayer never held the USD, so no FX lot. A TR lot
//     used to sit in the USD pool and shift FIFO for a broker that really
//     holds USD (IBKR) in a merged file.
// Every figure is hand-computed. Rates are "EUR per 1 USD", built in memory.
// ===========================================================================

/** Daily USD map over the test window, baseline 0.92, with pinned dates. */
function rateMap(overrides: Record<string, string>): EcbRateMap {
  const m: EcbRateMap = new Map();
  const d = new Date("2024-12-01T00:00:00Z");
  while (d <= new Date("2026-01-31T00:00:00Z")) {
    const k = d.toISOString().slice(0, 10);
    m.set(k, new Map([["USD", overrides[k] ?? "0.92"]]));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return m;
}

const RATES = rateMap({
  "2025-03-14": "0.918",
  "2025-06-16": "0.864",
  "2025-05-02": "0.88",
  "2025-11-03": "0.87",
});

const HEADER =
  '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"';

// EUR-only TR account: a US stock paying two $10 dividends, each credited in
// EUR at TR's rate with the 15% US tax withheld in EUR.
const TR_CSV = [
  HEADER,
  '"2025-01-10T10:00:00Z","2025-01-10","DEFAULT","TRADING","BUY","STOCK","Acme Corp","US0000001001","10","90.00","-900.00","-1.00","","EUR","","","","Buy","tr-buy","","","",""',
  '"2025-03-14T10:00:00Z","2025-03-14","DEFAULT","CASH","DIVIDEND","STOCK","Acme Corp","US0000001001","10","","9.00","","-1.35","EUR","10.00","USD","0.900000","Cash Dividend","tr-d1","","","",""',
  '"2025-06-16T10:00:00Z","2025-06-16","DEFAULT","CASH","DIVIDEND","STOCK","Acme Corp","US0000001001","10","","8.50","","-1.28","EUR","10.00","USD","0.850000","Cash Dividend","tr-d2","","","",""',
].join("\n");

// IBKR account that really holds USD: sell EUR for $1000 on 2 May (0.88),
// convert the $1000 back to EUR on 3 November (0.87). Alone: cost 880.00,
// proceeds 870.00, FX -10.00.
const IBKR_XML = `<?xml version="1.0"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U999" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>
        <Trade tradeID="ib-fund" accountId="U999" symbol="EUR.USD" description="EUR.USD" isin="" assetCategory="CASH"
          currency="USD" tradeDate="20250502" settleDateTarget="20250502" quantity="-880" tradePrice="1.13636"
          tradeMoney="1000" proceeds="1000" cost="0" buySell="SELL" commission="0" commissionCurrency="USD" />
        <Trade tradeID="ib-conv" accountId="U999" symbol="EUR.USD" description="EUR.USD" isin="" assetCategory="CASH"
          currency="USD" tradeDate="20251103" settleDateTarget="20251103" quantity="870" tradePrice="1.14943"
          tradeMoney="-1000" proceeds="-1000" cost="0" buySell="BUY" commission="0" commissionCurrency="USD" />
      </Trades>
      <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

function merged(...files: [Statement, string][]): Statement {
  const target = createEmptyStatement();
  for (const [statement, broker] of files) mergeStatement(target, statement, broker);
  return finalizeMergedStatement(target);
}

describe("Trade Republic USD dividend with EUR withholding (issue #96)", () => {
  const tr = () => merged([tradeRepublicParser.parse(TR_CSV), "Trade Republic"]);

  it("declares 0029 at TR's gross EUR and credits the EUR withholding in 0588", () => {
    const r = generateTaxReport(tr(), RATES, 2025);

    expect(r.dividends.entries.map((e) => e.currency)).toEqual(["EUR", "EUR"]);
    // 0029 = TR's 9.00 + 8.50 (not the ECB's 10 x 0.918 + 10 x 0.864 = 17.82).
    expect(r.dividends.grossIncome.toFixed(2)).toBe("17.50");
    // Withholding 1:1 in EUR: 1.35 + 1.28 = 2.63 (never x the USD rate).
    expect(r.dividends.entries.map((e) => e.withholdingTaxEur.toFixed(2))).toEqual(["1.35", "1.28"]);
    // 0588 US = min(2.63 paid, 15% x 17.50 = 2.625, 19% x 17.50 = 3.325).
    expect(r.doubleTaxation.byCountry["US"]!.taxPaid.toFixed(2)).toBe("2.63");
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("2.63");
  });

  it("keeps 0588 in monodivisa too", () => {
    const r = generateTaxReport(tr(), RATES, 2025, { skipFx: true });
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("2.63");
  });

  it("opens no FX lot: the TR-only FX trace is empty", () => {
    const r = generateTaxReport(tr(), RATES, 2025, { fxTrace: true });
    expect(r.fxTrace).toEqual([]);
    expect(r.fxGains.netGainLoss.toFixed(2)).toBe("0.00");
  });

  it("gives the same FX result merged with an IBKR file that holds USD as IBKR alone", () => {
    const ibkrOnly = generateTaxReport(merged([ibkrParser.parse(IBKR_XML), "IBKR"]), RATES, 2025);
    const both = generateTaxReport(
      merged([tradeRepublicParser.parse(TR_CSV), "Trade Republic"], [ibkrParser.parse(IBKR_XML), "IBKR"]),
      RATES,
      2025,
    );

    expect(ibkrOnly.fxGains.transmissionValue.toFixed(2)).toBe("870.00");
    expect(ibkrOnly.fxGains.acquisitionValue.toFixed(2)).toBe("880.00");
    expect(ibkrOnly.fxGains.netGainLoss.toFixed(2)).toBe("-10.00");
    expect(both.fxGains.transmissionValue.toFixed(2)).toBe(ibkrOnly.fxGains.transmissionValue.toFixed(2));
    expect(both.fxGains.acquisitionValue.toFixed(2)).toBe(ibkrOnly.fxGains.acquisitionValue.toFixed(2));
    expect(both.fxGains.netGainLoss.toFixed(2)).toBe("-10.00");
    // The TR income still lands in the merged report.
    expect(both.doubleTaxation.deduction.toFixed(2)).toBe("2.63");
  });

  it("credits the withholding of the repo's TR sample export", () => {
    const sample = readFileSync(new URL("../fixtures/trade-republic-sample.csv", import.meta.url), "utf-8");
    const r = generateTaxReport(
      merged([tradeRepublicParser.parse(sample), "Trade Republic"]),
      rateMap({ "2025-05-15": "0.8945", "2025-02-13": "0.9620" }),
      2025,
    );
    // The 15 May dividend: TR's gross 0.48 EUR, 0.07 EUR withheld.
    // 0588 = min(0.07, 15% x 0.48 = 0.072) = 0.07.
    expect(r.doubleTaxation.deduction.toFixed(2)).toBe("0.07");
  });
});
