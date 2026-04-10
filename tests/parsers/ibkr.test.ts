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
});
