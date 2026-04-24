import { describe, it, expect } from "vitest";
import { detectBroker, getBroker, brokerParsers } from "../../src/parsers/index.js";

const IBKR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="LastYear">
      <Trades /><CashTransactions /><CorporateActions /><OpenPositions /><SecuritiesInfo />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

describe("broker registry", () => {
  it("should detect IBKR from Flex Query XML", () => {
    const parser = detectBroker(IBKR_XML);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe("Interactive Brokers");
  });

  it("should return undefined for unknown input", () => {
    expect(detectBroker("random text file")).toBeUndefined();
    expect(detectBroker("")).toBeUndefined();
  });

  it("should look up broker by name (case-insensitive)", () => {
    expect(getBroker("interactive")).toBeDefined();
    expect(getBroker("Interactive Brokers")).toBeDefined();
    expect(getBroker("INTERACTIVE")).toBeDefined();
  });

  it("should return undefined for unknown broker name", () => {
    expect(getBroker("nonexistent")).toBeUndefined();
  });

  it("should have IBKR and Degiro in the registry", () => {
    expect(brokerParsers.length).toBeGreaterThanOrEqual(2);
    expect(brokerParsers.some((p) => p.name === "Interactive Brokers")).toBe(true);
    expect(brokerParsers.some((p) => p.name === "Degiro")).toBe(true);
  });

  it("should parse IBKR XML through the registry", () => {
    const parser = detectBroker(IBKR_XML)!;
    const statement = parser.parse(IBKR_XML);
    expect(statement.accountId).toBe("U1234567");
    expect(statement.trades).toHaveLength(0);
  });

  it("should detect Lightyear CSV before Degiro (both share ISIN/Quantity/Price headers)", () => {
    const lightyearHeader = "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.";
    const lightyearCsv = lightyearHeader + "\n16/12/2025 06:02:35,DD-0000000001,GOOG,US02079K1079,Dividend,,USD,,14.09,,,11.98,2.11";
    const parser = detectBroker(lightyearCsv);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe("Lightyear");
  });
});
