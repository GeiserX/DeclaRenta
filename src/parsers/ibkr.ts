/**
 * IBKR Flex Query XML parser.
 *
 * Parses the XML export from Interactive Brokers' Flex Query system
 * into structured TypeScript objects.
 */

import { XMLParser } from "fast-xml-parser";
import type {
  FlexStatement,
  Trade,
  CashTransaction,
  CorporateAction,
  OpenPosition,
  SecurityInfo,
} from "../types/ibkr.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  isArray: (_name, jpath) => {
    const arrayPaths = [
      "FlexQueryResponse.FlexStatements.FlexStatement.Trades.Trade",
      "FlexQueryResponse.FlexStatements.FlexStatement.CashTransactions.CashTransaction",
      "FlexQueryResponse.FlexStatements.FlexStatement.CorporateActions.CorporateAction",
      "FlexQueryResponse.FlexStatements.FlexStatement.OpenPositions.OpenPosition",
      "FlexQueryResponse.FlexStatements.FlexStatement.SecuritiesInfo.SecurityInfo",
    ];
    return arrayPaths.some((p) => jpath === p);
  },
});

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Parse an IBKR Flex Query XML string into a FlexStatement.
 *
 * @param xml - Raw XML string from IBKR Flex Query export
 * @returns Parsed FlexStatement with trades, dividends, positions, etc.
 * @throws Error if XML structure is not a valid Flex Query response
 */
export function parseIbkrFlexXml(xml: string): FlexStatement {
  const parsed = parser.parse(xml);

  const response = parsed.FlexQueryResponse;
  if (!response) {
    throw new Error("Invalid Flex Query XML: missing FlexQueryResponse root element");
  }

  const statement = response.FlexStatements?.FlexStatement;
  if (!statement) {
    throw new Error("Invalid Flex Query XML: missing FlexStatement");
  }

  const trades = ensureArray(statement.Trades?.Trade).map(mapTrade);
  const cashTransactions = ensureArray(statement.CashTransactions?.CashTransaction).map(mapCashTransaction);
  const corporateActions = ensureArray(statement.CorporateActions?.CorporateAction).map(mapCorporateAction);
  const openPositions = ensureArray(statement.OpenPositions?.OpenPosition).map(mapOpenPosition);
  const securitiesInfo = ensureArray(statement.SecuritiesInfo?.SecurityInfo).map(mapSecurityInfo);

  return {
    accountId: statement.accountId ?? "",
    fromDate: statement.fromDate ?? "",
    toDate: statement.toDate ?? "",
    period: statement.period ?? "",
    trades,
    cashTransactions,
    corporateActions,
    openPositions,
    securitiesInfo,
  };
}

function mapTrade(raw: Record<string, string>): Trade {
  return {
    tradeID: raw.tradeID ?? "",
    accountId: raw.accountId ?? "",
    symbol: raw.symbol ?? "",
    description: raw.description ?? "",
    isin: raw.isin ?? "",
    assetCategory: (raw.assetCategory ?? "STK") as Trade["assetCategory"],
    currency: raw.currency ?? "",
    tradeDate: raw.tradeDate ?? "",
    settlementDate: raw.settlementDate ?? "",
    quantity: raw.quantity ?? "0",
    tradePrice: raw.tradePrice ?? "0",
    tradeMoney: raw.tradeMoney ?? "0",
    proceeds: raw.proceeds ?? "0",
    cost: raw.cost ?? "0",
    fifoPnlRealized: raw.fifoPnlRealized ?? "0",
    fxRateToBase: raw.fxRateToBase ?? "1",
    buySell: (raw.buySell ?? "BUY") as Trade["buySell"],
    openCloseIndicator: (raw.openCloseIndicator ?? "O") as Trade["openCloseIndicator"],
    exchange: raw.exchange ?? "",
    commissionCurrency: raw.commissionCurrency ?? "",
    commission: raw.commission ?? "0",
    taxes: raw.taxes ?? "0",
  };
}

function mapCashTransaction(raw: Record<string, string>): CashTransaction {
  return {
    transactionID: raw.transactionID ?? "",
    accountId: raw.accountId ?? "",
    symbol: raw.symbol ?? "",
    description: raw.description ?? "",
    isin: raw.isin ?? "",
    currency: raw.currency ?? "",
    dateTime: raw.dateTime ?? "",
    settleDate: raw.settleDate ?? "",
    amount: raw.amount ?? "0",
    fxRateToBase: raw.fxRateToBase ?? "1",
    type: (raw.type ?? "") as CashTransaction["type"],
  };
}

function mapCorporateAction(raw: Record<string, string>): CorporateAction {
  return {
    transactionID: raw.transactionID ?? "",
    accountId: raw.accountId ?? "",
    symbol: raw.symbol ?? "",
    description: raw.description ?? "",
    isin: raw.isin ?? "",
    currency: raw.currency ?? "",
    reportDate: raw.reportDate ?? "",
    dateTime: raw.dateTime ?? "",
    quantity: raw.quantity ?? "0",
    amount: raw.amount ?? "0",
    type: raw.type ?? "",
    actionDescription: raw.actionDescription ?? "",
  };
}

function mapOpenPosition(raw: Record<string, string>): OpenPosition {
  return {
    accountId: raw.accountId ?? "",
    symbol: raw.symbol ?? "",
    description: raw.description ?? "",
    isin: raw.isin ?? "",
    currency: raw.currency ?? "",
    assetCategory: (raw.assetCategory ?? "STK") as OpenPosition["assetCategory"],
    quantity: raw.quantity ?? "0",
    costBasisMoney: raw.costBasisMoney ?? "0",
    costBasisPrice: raw.costBasisPrice ?? "0",
    markPrice: raw.markPrice ?? "0",
    positionValue: raw.positionValue ?? "0",
    fifoPnlUnrealized: raw.fifoPnlUnrealized ?? "0",
    fxRateToBase: raw.fxRateToBase ?? "1",
  };
}

function mapSecurityInfo(raw: Record<string, string>): SecurityInfo {
  return {
    symbol: raw.symbol ?? "",
    description: raw.description ?? "",
    isin: raw.isin ?? "",
    cusip: raw.cusip ?? "",
    currency: raw.currency ?? "",
    assetCategory: (raw.assetCategory ?? "STK") as SecurityInfo["assetCategory"],
    multiplier: raw.multiplier ?? "1",
    subCategory: raw.subCategory ?? "",
  };
}
