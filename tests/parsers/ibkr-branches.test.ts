import { describe, it, expect } from "vitest";
import { parseIbkrFlexXml, ibkrParser } from "../../src/parsers/ibkr.js";

describe("ibkrParser.detect", () => {
  it("should detect valid Flex Query XML", () => {
    expect(ibkrParser.detect("<FlexQueryResponse")).toBe(true);
  });

  it("should reject non-Flex XML", () => {
    expect(ibkrParser.detect("<SomeOtherXml>")).toBe(false);
  });
});

describe("ibkrParser.parse", () => {
  it("should parse via the BrokerParser interface", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades><Trade tradeID="1" symbol="SPY" isin="US78462F1030" assetCategory="STK"
            currency="USD" tradeDate="20250315" quantity="5" tradePrice="500"
            buySell="BUY" commission="-1" /></Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = ibkrParser.parse(xml);
    expect(result.trades).toHaveLength(1);
  });
});

describe("parseIbkrFlexXml - trade attribute defaults", () => {
  it("should handle trade with conid (trimmed)", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="1" symbol="SPY" conid="  265598  " isin="" assetCategory="STK"
                   currency="USD" tradeDate="20250315" quantity="5" tradePrice="500"
                   buySell="BUY" commission="-1" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    expect(result.trades[0].conid).toBe("265598");
  });

  it("should not include conid when empty", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="1" symbol="SPY" conid="" isin="US78462F1030" assetCategory="STK"
                   currency="USD" tradeDate="20250315" quantity="5" tradePrice="500"
                   buySell="BUY" commission="-1" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    expect(result.trades[0].conid).toBeUndefined();
  });

  it("should not include conid when only whitespace", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="1" symbol="SPY" conid="   " isin="US78462F1030" assetCategory="STK"
                   currency="USD" tradeDate="20250315" quantity="5" tradePrice="500"
                   buySell="BUY" commission="-1" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    expect(result.trades[0].conid).toBeUndefined();
  });

  it("should handle put option putCall=P", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="1" symbol="SPY P" isin="" assetCategory="OPT" currency="USD"
                   tradeDate="20250315" quantity="1" tradePrice="3" buySell="BUY"
                   commission="-0.65" multiplier="100" putCall="P" strike="400" expiry="20250620" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    expect(result.trades[0].putCall).toBe("P");
  });

  it("should handle missing optional fields with empty strings", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement fromDate="20250101" toDate="20251231">
          <Trades>
            <Trade tradeID="" symbol="XYZ" isin="" assetCategory="" currency=""
                   tradeDate="" quantity="" tradePrice="" tradeMoney="" proceeds=""
                   cost="" fifoPnlRealized="" fxRateToBase="" buySell="" openCloseIndicator=""
                   exchange="" commissionCurrency="" commission="" taxes=""
                   multiplier="" strike="" expiry="" underlyingSymbol="" underlyingIsin="" />
          </Trades>
          <CashTransactions>
            <CashTransaction transactionID="" symbol="" isin="" currency=""
                             dateTime="" settleDate="" amount="" fxRateToBase="" type="" />
          </CashTransactions>
          <CorporateActions>
            <CorporateAction transactionID="" symbol="" isin="" currency=""
                             reportDate="" dateTime="" quantity="" amount="" type="" actionDescription="" />
          </CorporateActions>
          <OpenPositions />
          <SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);

    // Trade defaults — when XML attributes are explicitly empty strings,
    // ?? keeps them as "" (since "" is not null/undefined)
    const trade = result.trades[0];
    expect(trade.tradeID).toBe("");
    expect(trade.description).toBe("");
    expect(trade.settlementDate).toBe("");
    expect(trade.tradeMoney).toBe("");
    expect(trade.proceeds).toBe("");
    expect(trade.cost).toBe("");
    expect(trade.fifoPnlRealized).toBe("");
    expect(trade.exchange).toBe("");
    expect(trade.taxes).toBe("");
    expect(trade.multiplier).toBe("");
    expect(trade.putCall).toBeUndefined();
    // strike/expiry/underlyingSymbol/underlyingIsin use || undefined, so empty string -> undefined
    expect(trade.strike).toBeUndefined();
    expect(trade.expiry).toBeUndefined();
    expect(trade.underlyingSymbol).toBeUndefined();
    expect(trade.underlyingIsin).toBeUndefined();

    // CashTransaction defaults
    const ct = result.cashTransactions[0];
    expect(ct.transactionID).toBe("");
    expect(ct.settleDate).toBe("");
    expect(ct.amount).toBe("");
    expect(ct.type).toBe("");

    // CorporateAction defaults
    const ca = result.corporateActions[0];
    expect(ca.transactionID).toBe("");
    expect(ca.reportDate).toBe("");
    expect(ca.quantity).toBe("");
    expect(ca.amount).toBe("");
    expect(ca.type).toBe("");
    expect(ca.actionDescription).toBe("");
  });

  it("should handle single statement with missing accountId", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement fromDate="20250101" toDate="20251231" period="Y">
          <Trades /><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    expect(result.accountId).toBe("");
    expect(result.period).toBe("Y");
  });
});
