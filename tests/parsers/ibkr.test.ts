import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");
}

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
               exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-1.00" taxes="0" />
        <Trade tradeID="123456790" accountId="U1234567" symbol="AAPL" description="APPLE INC"
               isin="US0378331005" assetCategory="STK" currency="USD"
               tradeDate="20250920" settlementDate="20250923"
               quantity="-10" tradePrice="195.00" tradeMoney="-1950.00"
               proceeds="-1950.00" cost="-1500.00" fifoPnlRealized="450.00"
               fxRateToBase="0.91" buySell="SELL" openCloseIndicator="C"
               exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-1.00" taxes="0" />
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
    // Commission must be parsed from the ibCommission/ibCommissionCurrency
    // Flex attributes — never silently 0 (see #188).
    expect(buy.commission).toBe("-1.00");
    expect(buy.commissionCurrency).toBe("USD");

    const sell = result.trades[1]!;
    expect(sell.buySell).toBe("SELL");
    expect(sell.quantity).toBe("-10");
    expect(sell.tradePrice).toBe("195.00");
    expect(sell.commission).toBe("-1.00");
    expect(sell.commissionCurrency).toBe("USD");
  });

  // Regression for #188: IBKR Flex <Trade> elements carry commissions in
  // ibCommission/ibCommissionCurrency. The parser previously read the plain
  // commission/commissionCurrency names (which never exist on <Trade>), so
  // every IBKR commission silently became 0 — overstating capital gains.
  it("should read commission from ibCommission and ignore legacy plain commission attr", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>
        <Trade tradeID="1" accountId="U1234567" symbol="MSFT" description="MICROSOFT"
               isin="US5949181045" assetCategory="STK" currency="USD"
               tradeDate="20250410" settlementDate="20250413"
               quantity="5" tradePrice="400.00" tradeMoney="2000.00"
               proceeds="2000.00" cost="2000.00" fifoPnlRealized="0"
               fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
               exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-2.50"
               commission="-99.99" commissionCurrency="EUR" taxes="0" />
      </Trades>
      <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    const trade = result.trades[0]!;
    // The ib-prefixed attributes win; the bogus legacy plain attrs are ignored.
    expect(trade.commission).toBe("-2.50");
    expect(trade.commissionCurrency).toBe("USD");
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
                   exchange="CBOE" ibCommissionCurrency="USD" ibCommission="-0.65" taxes="0"
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
                   exchange="CME" ibCommissionCurrency="USD" ibCommission="-2.10" taxes="0"
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
                   exchange="SMART" ibCommissionCurrency="USD" ibCommission="-5.00" taxes="0"
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
                   exchange="CBOE" ibCommissionCurrency="USD" ibCommission="-0.65" taxes="0"
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

  it("should merge multiple accounts from multi-account Flex Query", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <FlexQueryResponse queryName="Multi" type="AF">
      <FlexStatements count="2">
        <FlexStatement accountId="U1111111" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="A001" accountId="U1111111" symbol="AAPL" description="APPLE INC"
                   isin="US0378331005" assetCategory="STK" currency="USD"
                   tradeDate="20250315" settlementDate="20250318"
                   quantity="10" tradePrice="175.50" tradeMoney="1755.00"
                   proceeds="1755.00" cost="1500.00" fifoPnlRealized="255.00"
                   fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
                   exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-1.00" taxes="0" />
          </Trades>
          <CashTransactions>
            <CashTransaction transactionID="C001" accountId="U1111111"
                             symbol="AAPL" description="AAPL Dividend"
                             isin="US0378331005" currency="USD"
                             dateTime="20250515" settleDate="20250515"
                             amount="2.50" fxRateToBase="0.93" type="Dividends" />
          </CashTransactions>
          <CorporateActions />
          <OpenPositions>
            <OpenPosition accountId="U1111111" symbol="AAPL" description="APPLE INC"
                          isin="US0378331005" currency="USD" assetCategory="STK"
                          quantity="10" costBasisMoney="1755" costBasisPrice="175.50"
                          markPrice="195" positionValue="1950" fifoPnlUnrealized="195"
                          fxRateToBase="0.92" />
          </OpenPositions>
          <SecuritiesInfo>
            <SecurityInfo symbol="AAPL" description="APPLE INC" isin="US0378331005"
                          cusip="037833100" currency="USD" assetCategory="STK"
                          multiplier="1" subCategory="COMMON" />
          </SecuritiesInfo>
        </FlexStatement>
        <FlexStatement accountId="U2222222" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="B001" accountId="U2222222" symbol="MSFT" description="MICROSOFT CORP"
                   isin="US5949181045" assetCategory="STK" currency="USD"
                   tradeDate="20250420" settlementDate="20250423"
                   quantity="5" tradePrice="400.00" tradeMoney="2000.00"
                   proceeds="2000.00" cost="1800.00" fifoPnlRealized="200.00"
                   fxRateToBase="0.91" buySell="BUY" openCloseIndicator="O"
                   exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-1.00" taxes="0" />
            <Trade tradeID="B002" accountId="U2222222" symbol="MSFT" description="MICROSOFT CORP"
                   isin="US5949181045" assetCategory="STK" currency="USD"
                   tradeDate="20250920" settlementDate="20250923"
                   quantity="-5" tradePrice="420.00" tradeMoney="-2100.00"
                   proceeds="-2100.00" cost="-1800.00" fifoPnlRealized="300.00"
                   fxRateToBase="0.90" buySell="SELL" openCloseIndicator="C"
                   exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-1.00" taxes="0" />
          </Trades>
          <CashTransactions>
            <CashTransaction transactionID="C002" accountId="U2222222"
                             symbol="MSFT" description="MSFT Dividend"
                             isin="US5949181045" currency="USD"
                             dateTime="20250610" settleDate="20250610"
                             amount="3.75" fxRateToBase="0.91" type="Dividends" />
          </CashTransactions>
          <CorporateActions />
          <OpenPositions>
            <OpenPosition accountId="U2222222" symbol="GOOG" description="ALPHABET INC"
                          isin="US02079K3059" currency="USD" assetCategory="STK"
                          quantity="20" costBasisMoney="3000" costBasisPrice="150"
                          markPrice="170" positionValue="3400" fifoPnlUnrealized="400"
                          fxRateToBase="0.91" />
          </OpenPositions>
          <SecuritiesInfo>
            <SecurityInfo symbol="MSFT" description="MICROSOFT CORP" isin="US5949181045"
                          cusip="594918104" currency="USD" assetCategory="STK"
                          multiplier="1" subCategory="COMMON" />
          </SecuritiesInfo>
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);

    // accountId combines both
    expect(result.accountId).toBe("U1111111,U2222222");

    // Trades merged: 1 from account1 + 2 from account2
    expect(result.trades).toHaveLength(3);
    expect(result.trades[0]!.symbol).toBe("AAPL");
    expect(result.trades[0]!.accountId).toBe("U1111111");
    expect(result.trades[1]!.symbol).toBe("MSFT");
    expect(result.trades[1]!.accountId).toBe("U2222222");
    expect(result.trades[2]!.symbol).toBe("MSFT");
    expect(result.trades[2]!.buySell).toBe("SELL");

    // Cash transactions merged: 1 + 1
    expect(result.cashTransactions).toHaveLength(2);
    expect(result.cashTransactions[0]!.amount).toBe("2.50");
    expect(result.cashTransactions[1]!.amount).toBe("3.75");

    // Open positions merged: 1 + 1
    expect(result.openPositions).toHaveLength(2);
    expect(result.openPositions[0]!.symbol).toBe("AAPL");
    expect(result.openPositions[1]!.symbol).toBe("GOOG");

    // Securities info merged: 1 + 1
    expect(result.securitiesInfo).toHaveLength(2);

    // Metadata from first statement
    expect(result.fromDate).toBe("20250101");
    expect(result.toDate).toBe("20251231");
  });

  it("should still work with single-account XML (backward compatible)", () => {
    // The existing MINIMAL_FLEX_XML is single-account — ensure it still works
    const result = parseIbkrFlexXml(MINIMAL_FLEX_XML);
    expect(result.accountId).toBe("U1234567");
    expect(result.trades).toHaveLength(2);
    expect(result.cashTransactions).toHaveLength(2);
  });

  it("should parse CashReport cash balances", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Test" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades /><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
          <CashReport>
            <CashReportCurrency accountId="U1234567" currency="USD"
                                endingCash="14523.45" endingSettledCash="14523.45" />
            <CashReportCurrency accountId="U1234567" currency="EUR"
                                endingCash="1200.00" endingSettledCash="1200.00" />
          </CashReport>
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    expect(result.cashBalances).toHaveLength(2);
    expect(result.cashBalances![0]!.currency).toBe("USD");
    expect(result.cashBalances![0]!.endingCash).toBe("14523.45");
    expect(result.cashBalances![0]!.accountId).toBe("U1234567");
    expect(result.cashBalances![1]!.currency).toBe("EUR");
    expect(result.cashBalances![1]!.endingCash).toBe("1200.00");
  });

  it("should return undefined cashBalances when no CashReport section", () => {
    const result = parseIbkrFlexXml(MINIMAL_FLEX_XML);
    expect(result.cashBalances).toBeUndefined();
  });

  it("should handle multi-account with empty sections in some accounts", () => {
    const xml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Multi" type="AF">
      <FlexStatements count="2">
        <FlexStatement accountId="U1111111" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>
            <Trade tradeID="A001" accountId="U1111111" symbol="AAPL" description="APPLE"
                   isin="US0378331005" assetCategory="STK" currency="USD"
                   tradeDate="20250315" settlementDate="20250318"
                   quantity="10" tradePrice="175" tradeMoney="1750"
                   proceeds="1750" cost="1500" fifoPnlRealized="250"
                   fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
                   exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-1" taxes="0" />
          </Trades>
          <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
        <FlexStatement accountId="U2222222" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades /><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;

    const result = parseIbkrFlexXml(xml);
    expect(result.accountId).toBe("U1111111,U2222222");
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.symbol).toBe("AAPL");
    expect(result.cashTransactions).toHaveLength(0);
    expect(result.openPositions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// IBKR "Summary" option duplicate cash transactions (PR #191 root cause)
//
// When the user enables the "Summary" option in the Cash Transactions section
// of the Flex Query, IBKR emits every cash transaction twice: a DETAIL row
// (real transactionID, real accountId, dateTime with ;HHMMSS time) and a
// SUMMARY row (transactionID="", accountId="-", dateTime without time). The
// parser must drop the summary rows so dividends, withholding, fees and
// deposits are not double-counted.
// ---------------------------------------------------------------------------

describe("IBKR Summary-option duplicate cash transactions", () => {
  const xml = fixture("ibkr-summary-duplicates.xml");

  it("keeps only the 20 detail rows, dropping the 20 summary duplicates", () => {
    const result = parseIbkrFlexXml(xml);
    expect(result.cashTransactions).toHaveLength(20);
  });

  it("retains only rows with a real accountId (never the '-' summary marker)", () => {
    const result = parseIbkrFlexXml(xml);
    expect(result.cashTransactions.every((c) => c.accountId === "U12345678")).toBe(true);
    expect(result.cashTransactions.some((c) => c.accountId === "-")).toBe(false);
  });

  it("retains only rows with a real transactionID (never blank summary rows)", () => {
    const result = parseIbkrFlexXml(xml);
    expect(result.cashTransactions.every((c) => c.transactionID !== "")).toBe(true);
  });

  it("preserves one of each cash type after dedup (no over-deletion)", () => {
    const result = parseIbkrFlexXml(xml);
    const byType = result.cashTransactions.reduce<Record<string, number>>((acc, c) => {
      acc[c.type] = (acc[c.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType["Dividends"]).toBe(7);
    expect(byType["Withholding Tax"]).toBe(7);
    expect(byType["Other Fees"]).toBe(1);
    expect(byType["Deposits/Withdrawals"]).toBe(5);
  });

  it("sums dividend and withholding amounts without double-counting", () => {
    const result = parseIbkrFlexXml(xml);
    const sumOf = (type: string) =>
      result.cashTransactions
        .filter((c) => c.type === type)
        .reduce((acc, c) => acc + Number(c.amount), 0);
    // Detail-only totals — would be exactly doubled if summary rows leaked through
    expect(sumOf("Dividends")).toBeCloseTo(176.18, 2);
    expect(sumOf("Withholding Tax")).toBeCloseTo(-30.79, 2);
  });

  it("emits an info parserMessage reporting how many summary rows were skipped", () => {
    const result = parseIbkrFlexXml(xml);
    const msg = result.parserMessages?.find((m) => m.id === "parser.cash_summary_duplicates");
    expect(msg).toBeDefined();
    expect(msg!.severity).toBe("info");
    expect(msg!.context?.skipped).toBe("20");
  });

  it("does NOT drop legitimate rows when no summary duplicates are present", () => {
    const clean = fixture("ibkr-sample.xml");
    const result = parseIbkrFlexXml(clean);
    expect(result.cashTransactions).toHaveLength(2);
    expect(result.parserMessages?.some((m) => m.id === "parser.cash_summary_duplicates")).toBeFalsy();
  });

  it("drops rows flagged with levelOfDetail=\"SUMMARY\" even if they carry a real accountId", () => {
    // Some Flex Query exports DO emit the official levelOfDetail attribute on
    // summary rows while still populating transactionID/accountId. The blank-id
    // + "-" marker would miss those, so the levelOfDetail signal must catch them.
    const summaryXml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Lod" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U5550000" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades /><CorporateActions /><OpenPositions /><SecuritiesInfo />
          <CashTransactions>
            <CashTransaction transactionID="111" accountId="U5550000" symbol="AAPL"
              description="AAPL Cash Dividend" isin="US0378331005" currency="USD"
              dateTime="20250515;202000" settleDate="20250515" amount="2.50"
              fxRateToBase="0.93" type="Dividends" levelOfDetail="DETAIL" />
            <CashTransaction transactionID="222" accountId="U5550000" symbol="AAPL"
              description="AAPL Cash Dividend" isin="US0378331005" currency="USD"
              dateTime="20250515" settleDate="20250515" amount="2.50"
              fxRateToBase="0.93" type="Dividends" levelOfDetail="SUMMARY" />
          </CashTransactions>
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(summaryXml);
    expect(result.cashTransactions).toHaveLength(1);
    expect(result.cashTransactions[0]!.transactionID).toBe("111");
    expect(result.parserMessages?.find((m) => m.id === "parser.cash_summary_duplicates")?.context?.skipped).toBe("1");
  });

  it("aggregates the skipped count across multiple accounts (multi-statement merge)", () => {
    const multiXml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Multi" type="AF">
      <FlexStatements count="2">
        <FlexStatement accountId="U1111111" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades /><CorporateActions /><OpenPositions /><SecuritiesInfo />
          <CashTransactions>
            <CashTransaction transactionID="" accountId="-" symbol="AAPL"
              description="AAPL Cash Dividend" isin="US0378331005" currency="USD"
              dateTime="20250515" settleDate="20250515" amount="2.50"
              fxRateToBase="0.93" type="Dividends" />
            <CashTransaction transactionID="A1" accountId="U1111111" symbol="AAPL"
              description="AAPL Cash Dividend" isin="US0378331005" currency="USD"
              dateTime="20250515;202000" settleDate="20250515" amount="2.50"
              fxRateToBase="0.93" type="Dividends" />
          </CashTransactions>
        </FlexStatement>
        <FlexStatement accountId="U2222222" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades /><CorporateActions /><OpenPositions /><SecuritiesInfo />
          <CashTransactions>
            <CashTransaction transactionID="" accountId="-" symbol="MSFT"
              description="MSFT Cash Dividend" isin="US5949181045" currency="USD"
              dateTime="20250610" settleDate="20250610" amount="3.00"
              fxRateToBase="0.93" type="Dividends" />
            <CashTransaction transactionID="B1" accountId="U2222222" symbol="MSFT"
              description="MSFT Cash Dividend" isin="US5949181045" currency="USD"
              dateTime="20250610;202000" settleDate="20250610" amount="3.00"
              fxRateToBase="0.93" type="Dividends" />
          </CashTransactions>
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(multiXml);
    expect(result.cashTransactions).toHaveLength(2);
    expect(result.cashTransactions.map((c) => c.transactionID).sort()).toEqual(["A1", "B1"]);
    expect(result.parserMessages?.find((m) => m.id === "parser.cash_summary_duplicates")?.context?.skipped).toBe("2");
  });

  it("drops every row when a statement contains only summary rows", () => {
    const summaryOnlyXml = `<?xml version="1.0"?>
    <FlexQueryResponse queryName="SummaryOnly" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U7770000" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades /><CorporateActions /><OpenPositions /><SecuritiesInfo />
          <CashTransactions>
            <CashTransaction transactionID="" accountId="-" symbol="AAPL"
              description="AAPL Cash Dividend" isin="US0378331005" currency="USD"
              dateTime="20250515" settleDate="20250515" amount="2.50"
              fxRateToBase="0.93" type="Dividends" />
            <CashTransaction transactionID="" accountId="-" symbol="AAPL"
              description="AAPL US Tax" isin="US0378331005" currency="USD"
              dateTime="20250515" settleDate="20250515" amount="-0.38"
              fxRateToBase="0.93" type="Withholding Tax" />
          </CashTransactions>
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
    const result = parseIbkrFlexXml(summaryOnlyXml);
    expect(result.cashTransactions).toHaveLength(0);
    expect(result.parserMessages?.find((m) => m.id === "parser.cash_summary_duplicates")?.context?.skipped).toBe("2");
  });
});

describe("IBKR partial-fill execution merging", () => {
  function wrap(tradesXml: string): string {
    return `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Merge" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U9999999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>${tradesXml}</Trades>
          <CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
  }

  it("collapses three same-day executions of one ibOrderID into one trade with VWAP price", () => {
    // Three BUY fills: 100@10.00, 200@10.50, 100@11.00 → 400 shares, VWAP = 10.50
    // tradeMoney = 1000 + 2100 + 1100 = 4200; 4200 / 400 = 10.50
    const xml = wrap(`
      <Trade tradeID="A1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="10.00" tradeMoney="1000" proceeds="-1000" cost="1000.50"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.20" taxes="0"
             multiplier="1" ibOrderID="ORDER-1" />
      <Trade tradeID="A2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="200" tradePrice="10.50" tradeMoney="2100" proceeds="-2100" cost="2100.30"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.30" taxes="0"
             multiplier="1" ibOrderID="ORDER-1" />
      <Trade tradeID="A3" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="11.00" tradeMoney="1100" proceeds="-1100" cost="1100.10"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ORDER-1" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0]!;
    expect(t.quantity).toBe("400");
    expect(Number(t.tradePrice)).toBeCloseTo(10.5, 8);
    expect(t.tradeMoney).toBe("4200");
    expect(t.proceeds).toBe("-4200");
    expect(Number(t.commission)).toBeCloseTo(-0.6, 8);
    expect(t.tradeID).toBe("merged-ORDER-1-20250515-BUY-O");
    expect(t.ibOrderID).toBe("ORDER-1");
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")?.context).toEqual({
      sourceFillCount: "3",
      mergedGroupCount: "1",
    });
  });

  it("splits same ibOrderID across different tradeDate values (GTC overnight)", () => {
    const xml = wrap(`
      <Trade tradeID="A1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20251231" settlementDate="20260102"
             quantity="50" tradePrice="20.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.50" taxes="0"
             multiplier="1" ibOrderID="GTC-1" />
      <Trade tradeID="A2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20260102" settlementDate="20260106"
             quantity="50" tradePrice="20.10" tradeMoney="1005" proceeds="-1005" cost="1005"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.50" taxes="0"
             multiplier="1" ibOrderID="GTC-1" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    expect(result.trades.map((t) => t.tradeDate).sort()).toEqual(["20251231", "20260102"]);
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")).toBeUndefined();
  });

  it("mixes single-fill and multi-fill orders, leaves single fills untouched", () => {
    const xml = wrap(`
      <Trade tradeID="S1" accountId="U9999999" symbol="ALPHA" description="ALPHA" isin="US1111111111"
             assetCategory="STK" currency="USD" tradeDate="20250410" settlementDate="20250412"
             quantity="10" tradePrice="100" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ALONE" />
      <Trade tradeID="M1" accountId="U9999999" symbol="BETA" description="BETA" isin="US2222222222"
             assetCategory="STK" currency="USD" tradeDate="20250411" settlementDate="20250413"
             quantity="3" tradePrice="50" tradeMoney="150" proceeds="-150" cost="150"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="MULTI" />
      <Trade tradeID="M2" accountId="U9999999" symbol="BETA" description="BETA" isin="US2222222222"
             assetCategory="STK" currency="USD" tradeDate="20250411" settlementDate="20250413"
             quantity="7" tradePrice="51" tradeMoney="357" proceeds="-357" cost="357"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="MULTI" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    const alpha = result.trades.find((t) => t.symbol === "ALPHA")!;
    const beta = result.trades.find((t) => t.symbol === "BETA")!;
    expect(alpha.tradeID).toBe("S1"); // unchanged
    expect(alpha.quantity).toBe("10");
    expect(beta.tradeID).toBe("merged-MULTI-20250411-BUY-O"); // merged
    expect(beta.quantity).toBe("10");
    expect(beta.tradeMoney).toBe("507"); // 150 + 357
    expect(Number(beta.tradePrice)).toBeCloseTo(50.7, 8); // VWAP
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")?.context).toEqual({
      sourceFillCount: "2",
      mergedGroupCount: "1",
    });
  });

  it("passes through trades with empty ibOrderID without merging", () => {
    const xml = wrap(`
      <Trade tradeID="E1" accountId="U9999999" symbol="GAMMA" description="GAMMA" isin="US3333333333"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="5" tradePrice="40" tradeMoney="200" proceeds="-200" cost="200"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="" />
      <Trade tradeID="E2" accountId="U9999999" symbol="GAMMA" description="GAMMA" isin="US3333333333"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="5" tradePrice="40" tradeMoney="200" proceeds="-200" cost="200"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    expect(result.trades.every((t) => !t.ibOrderID)).toBe(true);
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")).toBeUndefined();
  });

  it("preserves option-exercise note markers (Ep/Ex) when merging", () => {
    const xml = wrap(`
      <Trade tradeID="O1" accountId="U9999999" symbol="OPT1" description="OPT1" isin=""
             assetCategory="OPT" currency="USD" tradeDate="20250619" settlementDate="20250620"
             quantity="-1" tradePrice="0.01" tradeMoney="-1" proceeds="1" cost="-1"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="SELL" openCloseIndicator="C"
             exchange="CBOE" ibCommissionCurrency="USD" ibCommission="-0.50" taxes="0"
             multiplier="100" notes="Ep" ibOrderID="OPT-EX" />
      <Trade tradeID="O2" accountId="U9999999" symbol="OPT1" description="OPT1" isin=""
             assetCategory="OPT" currency="USD" tradeDate="20250619" settlementDate="20250620"
             quantity="-1" tradePrice="0.01" tradeMoney="-1" proceeds="1" cost="-1"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="SELL" openCloseIndicator="C"
             exchange="CBOE" ibCommissionCurrency="USD" ibCommission="-0.50" taxes="0"
             multiplier="100" notes="Ep" ibOrderID="OPT-EX" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.notes).toBe("Ep");
    expect(result.trades[0]!.quantity).toBe("-2");
  });
});

describe("IBKR ORDER-level duplicate filtering", () => {
  function wrap(tradesXml: string): string {
    return `<?xml version="1.0"?>
    <FlexQueryResponse queryName="LOD" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U9999999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>${tradesXml}</Trades>
          <CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
  }

  it("drops ORDER-level rows when EXECUTION rows for the same ibOrderID are present", () => {
    // Two EXECUTION fills (100 + 100 = 200) plus one ORDER aggregate (200) for the
    // same ibOrderID. Without filtering, mergeExecutionsByOrder would sum all three
    // and emit quantity=400, doubling the real position.
    const xml = wrap(`
      <Trade tradeID="E1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="10.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.20" taxes="0"
             multiplier="1" ibOrderID="ORD-X" levelOfDetail="EXECUTION" />
      <Trade tradeID="E2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="10.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.20" taxes="0"
             multiplier="1" ibOrderID="ORD-X" levelOfDetail="EXECUTION" />
      <Trade tradeID="O1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="200" tradePrice="10.00" tradeMoney="2000" proceeds="-2000" cost="2000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.40" taxes="0"
             multiplier="1" ibOrderID="ORD-X" levelOfDetail="ORDER" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.quantity).toBe("200");
    expect(result.trades[0]!.tradeMoney).toBe("2000");
    expect(result.parserMessages?.find((m) => m.id === "parser.order_level_duplicates")?.context).toEqual({
      skipped: "1",
    });
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")?.context).toEqual({
      sourceFillCount: "2",
      mergedGroupCount: "1",
    });
  });

  it("keeps ORDER-level rows when no EXECUTION rows are present (ORDER-only export)", () => {
    // Two ORDER rows with distinct ibOrderIDs and no EXECUTION counterparts. The
    // export is already aggregated at order level — the filter must be a no-op
    // and mergeExecutionsByOrder leaves them as singletons.
    const xml = wrap(`
      <Trade tradeID="O1" accountId="U9999999" symbol="ALPHA" description="ALPHA" isin="US1111111111"
             assetCategory="STK" currency="USD" tradeDate="20250410" settlementDate="20250412"
             quantity="10" tradePrice="100" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ORD-A" levelOfDetail="ORDER" />
      <Trade tradeID="O2" accountId="U9999999" symbol="BETA" description="BETA" isin="US2222222222"
             assetCategory="STK" currency="USD" tradeDate="20250411" settlementDate="20250413"
             quantity="5" tradePrice="50" tradeMoney="250" proceeds="-250" cost="250"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="ORD-B" levelOfDetail="ORDER" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    expect(result.parserMessages?.find((m) => m.id === "parser.order_level_duplicates")).toBeUndefined();
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")).toBeUndefined();
  });

  it("keeps ORDER rows without an EXECUTION counterpart in a mixed export", () => {
    // Hybrid statement: ORD-X has 2 EXECUTION fills + matching ORDER aggregate
    // (drop ORDER, merge EXECUTIONs). ORD-Y is a standalone ORDER row with no
    // EXECUTION counterpart and must be preserved — a per-ibOrderID match
    // prevents collateral data loss when both LODs are mixed in one statement.
    const xml = wrap(`
      <Trade tradeID="E1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="10.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.20" taxes="0"
             multiplier="1" ibOrderID="ORD-X" levelOfDetail="EXECUTION" />
      <Trade tradeID="E2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="10.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.20" taxes="0"
             multiplier="1" ibOrderID="ORD-X" levelOfDetail="EXECUTION" />
      <Trade tradeID="O1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="200" tradePrice="10.00" tradeMoney="2000" proceeds="-2000" cost="2000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.40" taxes="0"
             multiplier="1" ibOrderID="ORD-X" levelOfDetail="ORDER" />
      <Trade tradeID="O2" accountId="U9999999" symbol="BETA" description="BETA" isin="US2222222222"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="20.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ORD-Y" levelOfDetail="ORDER" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    const ordX = result.trades.find((t) => t.ibOrderID === "ORD-X");
    expect(ordX?.quantity).toBe("200");
    expect(ordX?.tradeMoney).toBe("2000");
    const ordY = result.trades.find((t) => t.ibOrderID === "ORD-Y");
    expect(ordY).toBeDefined();
    expect(ordY?.quantity).toBe("50");
    expect(ordY?.tradeMoney).toBe("1000");
    expect(result.parserMessages?.find((m) => m.id === "parser.order_level_duplicates")?.context).toEqual({
      skipped: "1",
    });
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")?.context).toEqual({
      sourceFillCount: "2",
      mergedGroupCount: "1",
    });
  });
});

describe("IBKR heterogeneous-order safeguards", () => {
  function wrap(tradesXml: string): string {
    return `<?xml version="1.0"?>
    <FlexQueryResponse queryName="Heter" type="AF">
      <FlexStatements count="1">
        <FlexStatement accountId="U9999999" fromDate="20250101" toDate="20251231" period="LastYear">
          <Trades>${tradesXml}</Trades>
          <CorporateActions /><OpenPositions /><SecuritiesInfo />
        </FlexStatement>
      </FlexStatements>
    </FlexQueryResponse>`;
  }

  it("keeps BUY and SELL fills of the same ibOrderID split (no VWAP across opposite sides)", () => {
    // Pathological but legal: one ibOrderID with a BUY fill and a SELL fill on
    // the same day. VWAP across opposite sides would be meaningless; both fills
    // must land in the report as separate trades.
    const xml = wrap(`
      <Trade tradeID="B1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="10.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.20" taxes="0"
             multiplier="1" ibOrderID="FLIP-1" />
      <Trade tradeID="S1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="-40" tradePrice="10.50" tradeMoney="-420" proceeds="420" cost="-420"
             fifoPnlRealized="20" fxRateToBase="0.92" buySell="SELL" openCloseIndicator="C"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="FLIP-1" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    const buy = result.trades.find((t) => t.buySell === "BUY")!;
    const sell = result.trades.find((t) => t.buySell === "SELL")!;
    expect(buy.quantity).toBe("100");
    expect(buy.tradeID).toBe("B1"); // single-fill bucket, unchanged
    expect(sell.quantity).toBe("-40");
    expect(sell.tradeID).toBe("S1");
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")).toBeUndefined();
  });

  it("keeps Open and Close fills of the same ibOrderID split (O/C is tax-relevant)", () => {
    // FIFO branches on openCloseIndicator (fifo.ts:80). A mixed O/C group must
    // not be flattened or the cost-basis/proceeds attribution would be wrong.
    const xml = wrap(`
      <Trade tradeID="O1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="OC-1" />
      <Trade tradeID="C1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.05" tradeMoney="502.5" proceeds="-502.5" cost="502.5"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="C"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="OC-1" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    const open = result.trades.find((t) => t.openCloseIndicator === "O")!;
    const close = result.trades.find((t) => t.openCloseIndicator === "C")!;
    expect(open.quantity).toBe("50");
    expect(close.quantity).toBe("50");
    expect(open.tradeID).toBe("O1");
    expect(close.tradeID).toBe("C1");
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")).toBeUndefined();
  });

  it("gives distinct, non-empty tradeIDs to two merged orders that match on date/symbol/qty/price/side", () => {
    // Two different ibOrderIDs each fill in 2 partials for the same symbol, day,
    // total quantity, VWAP and side. The validator in src/web/validation.ts
    // falls back to a composite key when tradeID is empty — empty IDs here
    // would alias the two merged orders into a spurious "duplicate" warning.
    // The synthetic `merged-${ibOrderID}-${tradeDate}` id keeps them distinct.
    const xml = wrap(`
      <Trade tradeID="A1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ORDER-A" />
      <Trade tradeID="A2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ORDER-A" />
      <Trade tradeID="B1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ORDER-B" />
      <Trade tradeID="B2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="ORDER-B" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    const ordA = result.trades.find((t) => t.ibOrderID === "ORDER-A")!;
    const ordB = result.trades.find((t) => t.ibOrderID === "ORDER-B")!;
    expect(ordA.tradeID).toBe("merged-ORDER-A-20250515-BUY-O");
    expect(ordB.tradeID).toBe("merged-ORDER-B-20250515-BUY-O");
    expect(ordA.tradeID).not.toBe(ordB.tradeID);
    expect(ordA.tradeID).not.toBe("");
    expect(ordB.tradeID).not.toBe("");
    // Same (symbol, isin, tradeDate, quantity, tradePrice, buySell) — the
    // composite-key fallback would collide; the synthetic tradeID prevents it.
    expect(ordA.quantity).toBe(ordB.quantity);
    expect(ordA.tradePrice).toBe(ordB.tradePrice);
    expect(ordA.tradeDate).toBe(ordB.tradeDate);
  });

  it("keeps ORDER row on a date where no EXECUTION counterpart exists for the same ibOrderID", () => {
    // GTC id-reuse / cross-date safety: ORDER row on date B must survive when
    // EXECUTION rows only exist on date A for the same ibOrderID. Per-ibOrderID
    // matching would silently drop the date-B ORDER row.
    const xml = wrap(`
      <Trade tradeID="E1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="REUSE-1" levelOfDetail="EXECUTION" />
      <Trade tradeID="E2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="REUSE-1" levelOfDetail="EXECUTION" />
      <Trade tradeID="O-A" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="100" tradePrice="10.00" tradeMoney="1000" proceeds="-1000" cost="1000"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.20" taxes="0"
             multiplier="1" ibOrderID="REUSE-1" levelOfDetail="ORDER" />
      <Trade tradeID="O-B" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250516" settlementDate="20250520"
             quantity="30" tradePrice="11.00" tradeMoney="330" proceeds="-330" cost="330"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="REUSE-1" levelOfDetail="ORDER" />
    `);
    const result = parseIbkrFlexXml(xml);
    // Expect 2 trades: merged executions on day A, standalone ORDER on day B.
    expect(result.trades).toHaveLength(2);
    const dayA = result.trades.find((t) => t.tradeDate === "20250515")!;
    const dayB = result.trades.find((t) => t.tradeDate === "20250516")!;
    expect(dayA.quantity).toBe("100"); // 50 + 50 merged executions
    expect(dayA.tradeID).toBe("merged-REUSE-1-20250515-BUY-O");
    expect(dayB.quantity).toBe("30"); // ORDER row preserved
    expect(dayB.tradeID).toBe("O-B");
    expect(result.parserMessages?.find((m) => m.id === "parser.order_level_duplicates")?.context).toEqual({
      skipped: "1", // only the day-A ORDER row is a duplicate
    });
  });

  it("gives distinct synthetic tradeIDs to Open and Close multi-fill buckets under one ibOrderID (position flip)", () => {
    // Position-flip case: one ibOrderID covers both closing a short and opening
    // a new long (or vice versa) — same buySell, different openCloseIndicator.
    // Each side multi-fills. The bucket key splits on openCloseIndicator, so we
    // get two merged trades for the same (ibOrderID, tradeDate). The synthetic
    // tradeID MUST also split on openCloseIndicator (and buySell) — otherwise
    // both merged trades would alias to the same `merged-${ibOrderID}-${date}`
    // ID, re-triggering the validation.ts:80 dedup misflag and breaking the
    // merge.ts sort tiebreaker — i.e. the exact bug the synthetic ID prevents.
    const xml = wrap(`
      <Trade tradeID="O1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="OC-MULTI" />
      <Trade tradeID="O2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="50" tradePrice="10.00" tradeMoney="500" proceeds="-500" cost="500"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.10" taxes="0"
             multiplier="1" ibOrderID="OC-MULTI" />
      <Trade tradeID="C1" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="30" tradePrice="10.00" tradeMoney="300" proceeds="-300" cost="300"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="C"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="OC-MULTI" />
      <Trade tradeID="C2" accountId="U9999999" symbol="ACME" description="ACME" isin="US0000000001"
             assetCategory="STK" currency="USD" tradeDate="20250515" settlementDate="20250517"
             quantity="20" tradePrice="10.00" tradeMoney="200" proceeds="-200" cost="200"
             fifoPnlRealized="0" fxRateToBase="0.92" buySell="BUY" openCloseIndicator="C"
             exchange="NASDAQ" ibCommissionCurrency="USD" ibCommission="-0.05" taxes="0"
             multiplier="1" ibOrderID="OC-MULTI" />
    `);
    const result = parseIbkrFlexXml(xml);
    expect(result.trades).toHaveLength(2);
    const open = result.trades.find((t) => t.openCloseIndicator === "O")!;
    const close = result.trades.find((t) => t.openCloseIndicator === "C")!;
    expect(open.quantity).toBe("100"); // 50 + 50 merged
    expect(close.quantity).toBe("50"); // 30 + 20 merged
    expect(open.tradeID).toBe("merged-OC-MULTI-20250515-BUY-O");
    expect(close.tradeID).toBe("merged-OC-MULTI-20250515-BUY-C");
    expect(open.tradeID).not.toBe(close.tradeID);
    expect(open.tradeID).not.toBe("");
    expect(close.tradeID).not.toBe("");
    expect(result.parserMessages?.find((m) => m.id === "parser.executions_merged")?.context).toEqual({
      sourceFillCount: "4",
      mergedGroupCount: "2",
    });
  });
});

describe("parseIbkrFlexXml — XML entity hardening (XXE / billion-laughs)", () => {
  it("rejects external-entity (XXE) payloads", () => {
    // The classic XXE file/SSRF read. fast-xml-parser refuses to resolve
    // SYSTEM/PUBLIC external entities — uploads can never exfiltrate files.
    const xml = `<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="&xxe;" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades /><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
    expect(() => parseIbkrFlexXml(xml)).toThrow(/external entit/i);
  });

  it("does not explode a billion-laughs entity bomb", () => {
    // Nested internal entities are capped by maxExpandedLength/maxEntityCount, so
    // the deepest reference is never expanded into a multi-megabyte string.
    const xml = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
]>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="&lol6;" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades /><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    // accountId must NOT have ballooned into the fully-expanded 10^6 "lol" string.
    expect(result.accountId.length).toBeLessThan(10000);
  });

  it("still decodes the 5 predefined XML entities in legitimate fields", () => {
    // Hardening must not corrupt real data: an ampersand in a description (e.g.
    // "E-MINI S&P 500") arrives as "&amp;" on the wire and must decode to "&".
    const xml = `<?xml version="1.0"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades>
        <Trade tradeID="FUT001" accountId="U1234567" symbol="ESU5"
               description="E-MINI S&amp;P 500 &lt;CME&gt;" isin="" assetCategory="FUT" currency="USD"
               tradeDate="20250601" settlementDate="20250601"
               quantity="1" tradePrice="5500.00" tradeMoney="275000.00"
               proceeds="275000.00" cost="0" fifoPnlRealized="0"
               fxRateToBase="0.92" buySell="BUY" openCloseIndicator="O"
               exchange="CME" ibCommissionCurrency="USD" ibCommission="-2.10" taxes="0"
               multiplier="50" />
      </Trades>
      <CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
    const result = parseIbkrFlexXml(xml);
    expect(result.trades[0]!.description).toBe("E-MINI S&P 500 <CME>");
  });
});
