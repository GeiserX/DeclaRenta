import { describe, it, expect } from "vitest";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";

const MINIMAL_FLEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>
        <Trade tradeID="123456789" accountId="U1234567" symbol="AAPL" description="APPLE INC"
               isin="US0378331005" assetCategory="STK" currency="USD"
               tradeDate="20250315" settlementDate="20250318"
               quantity="10" tradePrice="175.50" tradeMoney="1755.00"
               proceeds="1755.00" cost="1500.00" fifoPnlRealized="255.00"
               fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
               exchange="NASDAQ" commissionCurrency="USD" commission="-1.00" taxes="0" />
        <Trade tradeID="123456790" accountId="U1234567" symbol="AAPL" description="APPLE INC"
               isin="US0378331005" assetCategory="STK" currency="USD"
               tradeDate="20250920" settlementDate="20250923"
               quantity="-10" tradePrice="195.00" tradeMoney="-1950.00"
               proceeds="-1950.00" cost="-1500.00" fifoPnlRealized="450.00"
               fxRateToBase="0.91" buySell="SELL" openCloseIndicator="C"
               exchange="NASDAQ" commissionCurrency="USD" commission="-1.00" taxes="0" />
      </Trades>
      <CashTransactions>
        <CashTransaction transactionID="987654321" accountId="U1234567"
                         symbol="AAPL" description="AAPL(US0378331005) Cash Dividend USD 0.25"
                         isin="US0378331005" currency="USD"
                         dateTime="20250515" settleDate="20250515"
                         amount="2.50" fxRateToBase="0.93" type="Dividends" />
        <CashTransaction transactionID="987654322" accountId="U1234567"
                         symbol="AAPL" description="AAPL(US0378331005) US Tax"
                         isin="US0378331005" currency="USD"
                         dateTime="20250515" settleDate="20250515"
                         amount="-0.38" fxRateToBase="0.93" type="Withholding Tax" />
      </CashTransactions>
      <CorporateActions />
      <OpenPositions />
      <SecuritiesInfo>
        <SecurityInfo symbol="AAPL" description="APPLE INC" isin="US0378331005"
                      cusip="037833100" currency="USD" assetCategory="STK"
                      multiplier="1" subCategory="COMMON" />
      </SecuritiesInfo>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

describe("parseIbkrFlexXml", () => {
  it("should parse a minimal Flex Query XML", () => {
    const result = parseIbkrFlexXml(MINIMAL_FLEX_XML);

    expect(result.accountId).toBe("U1234567");
    expect(result.fromDate).toBe("20250101");
    expect(result.toDate).toBe("20251231");
  });

  it("should parse trades correctly", () => {
    const result = parseIbkrFlexXml(MINIMAL_FLEX_XML);

    expect(result.trades).toHaveLength(2);

    const buy = result.trades[0]!;
    expect(buy.symbol).toBe("AAPL");
    expect(buy.isin).toBe("US0378331005");
    expect(buy.buySell).toBe("BUY");
    expect(buy.quantity).toBe("10");
    expect(buy.tradePrice).toBe("175.50");
    expect(buy.currency).toBe("USD");

    const sell = result.trades[1]!;
    expect(sell.buySell).toBe("SELL");
    expect(sell.quantity).toBe("-10");
    expect(sell.tradePrice).toBe("195.00");
  });

  it("should parse cash transactions (dividends + withholdings)", () => {
    const result = parseIbkrFlexXml(MINIMAL_FLEX_XML);

    expect(result.cashTransactions).toHaveLength(2);

    const dividend = result.cashTransactions[0]!;
    expect(dividend.type).toBe("Dividends");
    expect(dividend.amount).toBe("2.50");
    expect(dividend.isin).toBe("US0378331005");

    const withholding = result.cashTransactions[1]!;
    expect(withholding.type).toBe("Withholding Tax");
    expect(withholding.amount).toBe("-0.38");
  });

  it("should parse securities info", () => {
    const result = parseIbkrFlexXml(MINIMAL_FLEX_XML);

    expect(result.securitiesInfo).toHaveLength(1);
    expect(result.securitiesInfo[0]!.isin).toBe("US0378331005");
    expect(result.securitiesInfo[0]!.assetCategory).toBe("STK");
  });

  it("should throw on invalid XML", () => {
    expect(() => parseIbkrFlexXml("<invalid>")).toThrow("missing FlexQueryResponse");
  });

  it("should handle empty sections", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades /><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(0);
    expect(result.cashTransactions).toHaveLength(0);
  });

  it("should throw on missing FlexStatement", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="0">
      </FlexStatements>
    </FlexQueryResponse>`;

    expect(() => parseIbkrFlexXml(xml)).toThrow("missing FlexStatement");
  });

  it("should parse corporate actions", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades />
          <CashTransactions />
          <CorporateActions>
            <CorporateAction transactionID="CA001" accountId="U1234567" symbol="AAPL" description="AAPL Split 4:1"
                             isin="US0378331005" currency="USD" reportDate="20250601" dateTime="20250601"
                             quantity="30" amount="0" type="SO" actionDescription="AAPL(US0378331005) SPLIT 4 FOR 1" />
          </CorporateActions>
          <OpenPositions />
          <SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    expect(result.corporateActions).toHaveLength(1);
    expect(result.corporateActions[0]!.symbol).toBe("AAPL");
    expect(result.corporateActions[0]!.type).toBe("SO");
    expect(result.corporateActions[0]!.quantity).toBe("30");
    expect(result.corporateActions[0]!.actionDescription).toContain("SPLIT");
  });

  it("should parse open positions", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades />
          <CashTransactions />
          <CorporateActions />
          <OpenPositions>
            <OpenPosition accountId="U1234567" symbol="AAPL" description="APPLE INC"
                          isin="US0378331005" currency="USD" assetCategory="STK"
                          quantity="100" costBasisMoney="17500" costBasisPrice="175"
                          markPrice="195" positionValue="19500" fifoPnlUnrealized="2000"
                          fxRateToBase="0.92" />
          </OpenPositions>
          <SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    expect(result.openPositions).toHaveLength(1);
    expect(result.openPositions[0]!.symbol).toBe("AAPL");
    expect(result.openPositions[0]!.quantity).toBe("100");
    expect(result.openPositions[0]!.markPrice).toBe("195");
    expect(result.openPositions[0]!.assetCategory).toBe("STK");
  });

  it("should parse multiple corporate actions as array", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades />
          <CashTransactions />
          <CorporateActions>
            <CorporateAction transactionID="CA001" accountId="U1234567" symbol="OLD" description="Merger"
                             isin="US1111111111" currency="USD" reportDate="20250601" dateTime="20250601"
                             quantity="-100" amount="0" type="TC" actionDescription="TENDER" />
            <CorporateAction transactionID="CA002" accountId="U1234567" symbol="NEW" description="Merger"
                             isin="US2222222222" currency="USD" reportDate="20250601" dateTime="20250601"
                             quantity="100" amount="0" type="TC" actionDescription="TENDER" />
          </CorporateActions>
          <OpenPositions />
          <SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    expect(result.corporateActions).toHaveLength(2);
  });

  it("should parse option trades with derivative fields", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="OPT001" accountId="U1234567" symbol="AAPL 250620C00200000"
                   description="AAPL 20JUN25 200 C" isin="" assetCategory="OPT" currency="USD"
                   tradeDate="20250315" settlementDate="20250316"
                   quantity="1" tradePrice="5.50" tradeMoney="550.00"
                   proceeds="550.00" cost="0" fifoPnlRealized="0"
                   fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
                   exchange="CBOE" commissionCurrency="USD" commission="-0.65" taxes="0"
                   multiplier="100" putCall="C" strike="200" expiry="20250620"
                   underlyingSymbol="AAPL" underlyingIsin="US0378331005" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    const trade = result.trades[0]!;
    expect(trade.assetCategory).toBe("OPT");
    expect(trade.multiplier).toBe("100");
    expect(trade.putCall).toBe("C");
    expect(trade.strike).toBe("200");
    expect(trade.expiry).toBe("20250620");
    expect(trade.underlyingSymbol).toBe("AAPL");
    expect(trade.underlyingIsin).toBe("US0378331005");
  });

  it("should parse futures with multiplier and asset category", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="FUT001" accountId="U1234567" symbol="ESU5"
                   description="E-MINI S&amp;P 500" isin="" assetCategory="FUT" currency="USD"
                   tradeDate="20250601" settlementDate="20250601"
                   quantity="1" tradePrice="5500.00" tradeMoney="275000.00"
                   proceeds="275000.00" cost="0" fifoPnlRealized="0"
                   fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
                   exchange="CME" commissionCurrency="USD" commission="-2.10" taxes="0"
                   multiplier="50" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    const trade = result.trades[0]!;
    expect(trade.assetCategory).toBe("FUT");
    expect(trade.multiplier).toBe("50");
    expect(trade.isin).toBe("");
    expect(trade.symbol).toBe("ESU5");
  });

  it("should parse bond trades", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="BOND001" accountId="U1234567" symbol="T 3.5 05/15/33"
                   description="US TREASURY 3.5% 05/15/2033" isin="US91282CGR69" assetCategory="BOND" currency="USD"
                   tradeDate="20250315" settlementDate="20250317"
                   quantity="10000" tradePrice="97.50" tradeMoney="9750.00"
                   proceeds="9750.00" cost="0" fifoPnlRealized="0"
                   fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
                   exchange="SMART" commissionCurrency="USD" commission="-5.00" taxes="0"
                   multiplier="1" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    const trade = result.trades[0]!;
    expect(trade.assetCategory).toBe("BOND");
    expect(trade.isin).toBe("US91282CGR69");
    expect(trade.multiplier).toBe("1");
  });

  it("should reject invalid putCall values", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="OPT002" accountId="U1234567" symbol="SPY" isin="" assetCategory="OPT"
                   currency="USD" tradeDate="20250315" settlementDate="20250316"
                   quantity="1" tradePrice="3.00" tradeMoney="300"
                   proceeds="300" cost="0" fifoPnlRealized="0"
                   fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
                   exchange="CBOE" commissionCurrency="USD" commission="-0.65" taxes="0"
                   multiplier="100" putCall="X" strike="500" expiry="20250620" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    const trade = result.trades[0]!;
    expect(trade.putCall).toBeUndefined();
    expect(trade.strike).toBe("500");
  });

  it("should handle defaults for missing attributes", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement>
          <Trades>
            <Trade symbol="XYZ" />
          </Trades>
          <CashTransactions />
          <CorporateActions />
          <OpenPositions>
            <OpenPosition symbol="XYZ" />
          </OpenPositions>
          <SecuritiesInfo>
            <SecurityInfo symbol="XYZ" />
          </SecuritiesInfo>
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    const trade = result.trades[0]!;
    expect(trade.symbol).toBe("XYZ");
    expect(trade.isin).toBe("");
    expect(trade.quantity).toBe("0");
    expect(trade.buySell).toBe("BUY");
    expect(trade.fxRateToBase).toBe("1");

    const pos = result.openPositions[0]!;
    expect(pos.symbol).toBe("XYZ");
    expect(pos.quantity).toBe("0");
    expect(pos.fxRateToBase).toBe("1");

    const sec = result.securitiesInfo[0]!;
    expect(sec.symbol).toBe("XYZ");
    expect(sec.multiplier).toBe("1");
  });
});
