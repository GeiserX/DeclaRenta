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
  CashBalance,
  OptionExercise,
} from "../types/ibkr.js";
import type { BrokerParser, Statement } from "../types/broker.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  isArray: (_name, jpath) => {
    const arrayPaths = [
      "FlexQueryResponse.FlexStatements.FlexStatement",
      "FlexQueryResponse.FlexStatements.FlexStatement.Trades.Trade",
      "FlexQueryResponse.FlexStatements.FlexStatement.CashTransactions.CashTransaction",
      "FlexQueryResponse.FlexStatements.FlexStatement.CorporateActions.CorporateAction",
      "FlexQueryResponse.FlexStatements.FlexStatement.OpenPositions.OpenPosition",
      "FlexQueryResponse.FlexStatements.FlexStatement.SecuritiesInfo.SecurityInfo",
      "FlexQueryResponse.FlexStatements.FlexStatement.CashReport.CashReportCurrency",
      "FlexQueryResponse.FlexStatements.FlexStatement.OptionEAE.OptionEAE",
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

  const statements = ensureArray(response.FlexStatements?.FlexStatement);
  if (statements.length === 0) {
    throw new Error("Invalid Flex Query XML: missing FlexStatement");
  }

  // Merge all accounts into a single FlexStatement
  const trades: ReturnType<typeof mapTrade>[] = [];
  const cashTransactions: ReturnType<typeof mapCashTransaction>[] = [];
  const corporateActions: ReturnType<typeof mapCorporateAction>[] = [];
  const openPositions: ReturnType<typeof mapOpenPosition>[] = [];
  const securitiesInfo: ReturnType<typeof mapSecurityInfo>[] = [];
  const cashBalances: ReturnType<typeof mapCashBalance>[] = [];
  const optionExercises: ReturnType<typeof mapOptionExercise>[] = [];

  for (const stmt of statements) {
    trades.push(...ensureArray(stmt.Trades?.Trade).map(mapTrade));
    cashTransactions.push(...ensureArray(stmt.CashTransactions?.CashTransaction).map(mapCashTransaction));
    corporateActions.push(...ensureArray(stmt.CorporateActions?.CorporateAction).map(mapCorporateAction));
    openPositions.push(...ensureArray(stmt.OpenPositions?.OpenPosition).map(mapOpenPosition));
    securitiesInfo.push(...ensureArray(stmt.SecuritiesInfo?.SecurityInfo).map(mapSecurityInfo));
    cashBalances.push(...ensureArray(stmt.CashReport?.CashReportCurrency).map(mapCashBalance));
    optionExercises.push(...ensureArray(stmt.OptionEAE?.OptionEAE).map(mapOptionExercise));
  }

  // Detect important sections present in XML but not parsed
  const parserWarnings: string[] = [];
  const importantUnparsed: Record<string, string> = {
    TransfersInTransit: "transferencias en tránsito",
    UnbookedTrades: "operaciones no liquidadas",
    RoutingCommissions: "comisiones de routing",
    ComplexPositions: "posiciones complejas (spreads)",
  };
  for (const stmt of statements) {
    for (const [section, desc] of Object.entries(importantUnparsed)) {
      if (stmt[section] !== undefined && stmt[section] !== null) {
        parserWarnings.push(`⚠ Sección "${section}" encontrada en el Flex Query pero no procesada (${desc}). Revisa manualmente.`);
      }
    }
  }

  // Use first statement's metadata, combine accountIds for multi-account
  const first = statements[0]!;
  const accountId = statements.length === 1
    ? (first.accountId ?? "")
    : statements.map((s: Record<string, string>) => s.accountId ?? "").filter(Boolean).join(",");

  return {
    accountId,
    fromDate: first.fromDate ?? "",
    toDate: first.toDate ?? "",
    period: first.period ?? "",
    trades,
    cashTransactions,
    corporateActions,
    openPositions,
    securitiesInfo,
    cashBalances: cashBalances.length > 0 ? cashBalances : undefined,
    optionExercises: optionExercises.length > 0 ? optionExercises : undefined,
    parserWarnings: parserWarnings.length > 0 ? parserWarnings : undefined,
  };
}

function mapTrade(raw: Record<string, string>): Trade {
  return {
    tradeID: raw.tradeID ?? "",
    accountId: raw.accountId ?? "",
    ...(raw.conid?.trim() ? { conid: raw.conid.trim() } : {}),
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
    multiplier: raw.multiplier ?? "1",
    putCall: raw.putCall === "P" || raw.putCall === "C" ? raw.putCall : undefined,
    strike: raw.strike || undefined,
    expiry: raw.expiry || undefined,
    underlyingSymbol: raw.underlyingSymbol || undefined,
    underlyingIsin: raw.underlyingIsin || undefined,
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

function mapCashBalance(raw: Record<string, string>): CashBalance {
  return {
    accountId: raw.accountId ?? "",
    currency: raw.currency ?? "",
    endingCash: raw.endingCash ?? "0",
    endingSettledCash: raw.endingSettledCash ?? "0",
  };
}

function mapOptionExercise(raw: Record<string, string>): OptionExercise {
  const action = (raw.action ?? raw.type ?? "").toLowerCase();
  let mappedAction: OptionExercise["action"] = "Exercise";
  if (action.includes("assign")) mappedAction = "Assignment";
  else if (action.includes("expir") || action.includes("lapse")) mappedAction = "Expiration";

  return {
    transactionID: raw.transactionID ?? "",
    accountId: raw.accountId ?? "",
    symbol: raw.symbol ?? "",
    description: raw.description ?? "",
    isin: raw.isin ?? "",
    currency: raw.currency ?? "",
    date: raw.date ?? raw.dateTime?.slice(0, 8) ?? "",
    action: mappedAction,
    putCall: raw.putCall === "P" ? "P" : "C",
    strike: raw.strike ?? "0",
    expiry: raw.expiry ?? "",
    quantity: raw.quantity ?? "0",
    proceeds: raw.proceeds ?? raw.amount ?? "0",
    underlyingSymbol: raw.underlyingSymbol ?? "",
    underlyingIsin: raw.underlyingIsin ?? "",
    multiplier: raw.multiplier ?? "100",
  };
}

/** IBKR Flex Query XML parser implementing BrokerParser interface */
export const ibkrParser: BrokerParser = {
  name: "Interactive Brokers",
  formats: ["Flex Query XML"],
  detect(input: string): boolean {
    return input.includes("<FlexQueryResponse");
  },
  parse(input: string): Statement {
    return parseIbkrFlexXml(input);
  },
};
