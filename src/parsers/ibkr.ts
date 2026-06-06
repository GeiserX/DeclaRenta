/**
 * IBKR Flex Query XML parser.
 *
 * Parses the XML export from Interactive Brokers' Flex Query system
 * into structured TypeScript objects.
 */

import Decimal from "decimal.js";
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
import type { TaxMessage } from "../types/tax.js";

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
  const optionExercises: OptionExercise[] = [];

  // The "Summary" option in the Cash Transactions section makes IBKR emit
  // every cash transaction twice: a DETAIL row (real transactionID, real
  // accountId, dateTime with ;HHMMSS time) and a SUMMARY row (levelOfDetail
  // "SUMMARY", or transactionID="" + accountId="-"). Summary rows would
  // double-count dividends, withholding, fees and deposits, so they are
  // dropped here before mapping.
  let cashSummaryDuplicatesSkipped = 0;
  let executionsMergedGroups = 0;
  let executionsMergedSources = 0;
  let orderLevelDetailDuplicatesSkipped = 0;

  for (const stmt of statements) {
    const rawTrades = ensureArray(stmt.Trades?.Trade) as Record<string, string>[];
    const filteredRawTrades = filterDuplicateLevelOfDetail(rawTrades);
    orderLevelDetailDuplicatesSkipped += rawTrades.length - filteredRawTrades.length;
    const stmtTrades = filteredRawTrades.map(mapTrade);
    const { merged, mergedGroupCount, sourceFillCount } = mergeExecutionsByOrder(stmtTrades);
    trades.push(...merged);
    executionsMergedGroups += mergedGroupCount;
    executionsMergedSources += sourceFillCount;
    const rawCash = ensureArray(stmt.CashTransactions?.CashTransaction) as Record<string, string>[];
    const detailCash = rawCash.filter((raw) => !isCashSummaryRow(raw));
    cashSummaryDuplicatesSkipped += rawCash.length - detailCash.length;
    cashTransactions.push(...detailCash.map(mapCashTransaction));
    corporateActions.push(...ensureArray(stmt.CorporateActions?.CorporateAction).map(mapCorporateAction));
    openPositions.push(...ensureArray(stmt.OpenPositions?.OpenPosition).map(mapOpenPosition));
    securitiesInfo.push(...ensureArray(stmt.SecuritiesInfo?.SecurityInfo).map(mapSecurityInfo));
    cashBalances.push(...ensureArray(stmt.CashReport?.CashReportCurrency).map(mapCashBalance));
    optionExercises.push(...parseOptionEaeRows(ensureArray(stmt.OptionEAE?.OptionEAE) as Record<string, string>[]));
  }

  // Detect important sections present in XML but not parsed
  const parserWarnings: string[] = [];
  const parserMessages: TaxMessage[] = [];
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
        parserMessages.push({
          id: `parser.unparsed_section.${section}`,
          severity: "info",
          message: `⚠ Sección "${section}" encontrada en el Flex Query pero no procesada (${desc}). Revisa manualmente.`,
          hint: "Esta sección no afecta al cálculo fiscal. Si crees que debería incluirse, contacta con soporte.",
          context: { section },
        });
      }
    }
  }

  if (cashSummaryDuplicatesSkipped > 0) {
    parserMessages.push({
      id: "parser.cash_summary_duplicates",
      severity: "info",
      message: `Se omitieron ${cashSummaryDuplicatesSkipped} filas resumen duplicadas en las transacciones de efectivo.`,
      hint: 'Tu Flex Query tiene activada la opción "Summary" en la sección Cash Transactions, lo que duplica cada movimiento. Puedes desactivarla, pero no es necesario: estas filas se han ignorado automáticamente para evitar duplicar dividendos, retenciones y comisiones.',
      context: { skipped: String(cashSummaryDuplicatesSkipped) },
    });
  }

  if (executionsMergedGroups > 0) {
    parserMessages.push({
      id: "parser.executions_merged",
      severity: "info",
      message: `Se agruparon ${executionsMergedSources} ejecuciones parciales en ${executionsMergedGroups} órdenes.`,
      hint: "Las órdenes con varias ejecuciones parciales se han combinado en una sola operación, igual que hacen los brokers que informan a Hacienda. El cálculo fiscal no cambia: cantidad total, precio medio ponderado y comisiones suman lo mismo.",
      context: { sourceFillCount: String(executionsMergedSources), mergedGroupCount: String(executionsMergedGroups) },
    });
  }

  if (orderLevelDetailDuplicatesSkipped > 0) {
    parserMessages.push({
      id: "parser.order_level_duplicates",
      severity: "info",
      message: `Se omitieron ${orderLevelDetailDuplicatesSkipped} filas agregadas de tipo ORDER duplicadas en las operaciones.`,
      hint: 'Tu Flex Query tiene activado el nivel de detalle "Orders" además de "Executions" en la sección Trades, lo que duplica cada operación. Puedes desactivar "Orders" en la configuración del Flex Query, pero no es necesario: estas filas se han ignorado automáticamente para evitar duplicar cantidades, importes y comisiones.',
      context: { skipped: String(orderLevelDetailDuplicatesSkipped) },
    });
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
    parserMessages: parserMessages.length > 0 ? parserMessages : undefined,
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
    commissionCurrency: raw.ibCommissionCurrency ?? "",
    commission: raw.ibCommission ?? "0",
    taxes: raw.taxes ?? "0",
    multiplier: raw.multiplier ?? "1",
    notes: raw.notes || undefined,
    putCall: raw.putCall === "P" || raw.putCall === "C" ? raw.putCall : undefined,
    strike: raw.strike || undefined,
    expiry: raw.expiry || undefined,
    underlyingSymbol: raw.underlyingSymbol || undefined,
    underlyingIsin: raw.underlyingIsin || undefined,
    ibOrderID: raw.ibOrderID || undefined,
  };
}

/**
 * Collapse same-order partial-fill executions into a single synthetic Trade.
 *
 * IBKR emits one `<Trade levelOfDetail="EXECUTION">` per fill; an order that
 * fills in 3 partials yields 3 Trades sharing the same `ibOrderID` + `tradeDate`.
 * Hacienda-facing brokers report at the order level, so we mirror that here:
 * quantities and money sum, price becomes the VWAP. Tax math is unchanged
 * because FIFO consumes `quantity × tradePrice × multiplier + taxes + commission`,
 * and the merged values preserve that identity exactly.
 *
 * GTC orders that span multiple `tradeDate`s split back into one row per day
 * (the key includes `tradeDate`), so a year-boundary GTC fill lands in the
 * correct tax year.
 *
 * Heterogeneous `buySell` (a BUY-then-SELL flip in one ibOrderID) or mixed
 * `openCloseIndicator` (Open + Close fills under one id) also stay split:
 * VWAP across opposite sides is meaningless, and `openCloseIndicator` is
 * tax-relevant — `fifo.ts` branches on it for cost basis vs proceeds.
 *
 * Trades with no `ibOrderID` pass through un-merged (rare; only carry-forward
 * edge cases — real IBKR data always populates the field).
 */
function mergeExecutionsByOrder(
  trades: Trade[],
): { merged: Trade[]; mergedGroupCount: number; sourceFillCount: number } {
  const groups = new Map<string, Trade[]>();
  let ungroupedCounter = 0;

  for (const trade of trades) {
    const key = trade.ibOrderID
      ? `${trade.ibOrderID}|${trade.tradeDate}|${trade.buySell}|${trade.openCloseIndicator}`
      : `__ungrouped_${ungroupedCounter++}__`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(trade);
  }

  const merged: Trade[] = [];
  let mergedGroupCount = 0;
  let sourceFillCount = 0;
  for (const bucket of groups.values()) {
    if (bucket.length === 1) {
      merged.push(bucket[0]!);
      continue;
    }
    mergedGroupCount++;
    sourceFillCount += bucket.length;
    merged.push(mergeTradeGroup(bucket));
  }
  return { merged, mergedGroupCount, sourceFillCount };
}

function mergeTradeGroup(group: Trade[]): Trade {
  const first = group[0]!;
  let qty = new Decimal(0);
  let qtyAbs = new Decimal(0);
  let money = new Decimal(0);
  let proceeds = new Decimal(0);
  let cost = new Decimal(0);
  let commission = new Decimal(0);
  let taxes = new Decimal(0);
  let fifoPnl = new Decimal(0);
  const notes = new Set<string>();
  let exchange = first.exchange;

  for (const t of group) {
    const q = new Decimal(t.quantity);
    qty = qty.plus(q);
    qtyAbs = qtyAbs.plus(q.abs());
    money = money.plus(new Decimal(t.tradeMoney || "0"));
    proceeds = proceeds.plus(new Decimal(t.proceeds || "0"));
    cost = cost.plus(new Decimal(t.cost || "0"));
    commission = commission.plus(new Decimal(t.commission || "0"));
    taxes = taxes.plus(new Decimal(t.taxes || "0"));
    fifoPnl = fifoPnl.plus(new Decimal(t.fifoPnlRealized || "0"));
    if (!exchange) exchange = t.exchange;
    if (t.notes) {
      for (const n of t.notes.split(";")) {
        const trimmed = n.trim();
        if (trimmed) notes.add(trimmed);
      }
    }
  }

  // VWAP per unit, consistent with IBKR's tradePrice semantics:
  //   tradeMoney = quantity × tradePrice × multiplier
  // All fills share the same multiplier (invariant within an order).
  const multiplier = new Decimal(first.multiplier || "1");
  const vwap = qtyAbs.isZero() || multiplier.isZero()
    ? new Decimal(first.tradePrice)
    : money.abs().dividedBy(qtyAbs.mul(multiplier));

  // Stable synthetic tradeID covering the full bucket key
  // (ibOrderID, tradeDate, buySell, openCloseIndicator). Must mirror
  // the bucket dimensions in mergeExecutionsByOrder — otherwise two
  // distinct merged orders would alias to the same ID, re-triggering
  // the validator's composite-key dedup misflag and breaking the
  // merge.ts sort tiebreaker.
  const syntheticTradeId = `merged-${first.ibOrderID}-${first.tradeDate}-${first.buySell}-${first.openCloseIndicator}`;

  return {
    ...first,
    tradeID: syntheticTradeId,
    quantity: qty.toString(),
    tradePrice: vwap.toString(),
    tradeMoney: money.toString(),
    proceeds: proceeds.toString(),
    cost: cost.toString(),
    commission: commission.toString(),
    taxes: taxes.toString(),
    fifoPnlRealized: fifoPnl.toString(),
    exchange,
    notes: notes.size > 0 ? Array.from(notes).join(";") : undefined,
  };
}

/** IBKR's own marker for aggregated rows; present in some Flex Query exports. */
const LEVEL_OF_DETAIL_SUMMARY = "SUMMARY";
/** Placeholder accountId IBKR writes on summary rows that omit the official attribute. */
const SUMMARY_ACCOUNT_PLACEHOLDER = "-";
/** IBKR's aggregated marker for the Trades section; emitted when the Flex Query
 *  selects the "Orders" level of detail alongside "Executions". */
const LEVEL_OF_DETAIL_ORDER = "ORDER";
/** IBKR's per-fill marker for the Trades section; the default level of detail. */
const LEVEL_OF_DETAIL_EXECUTION = "EXECUTION";

/**
 * Drop ORDER-level Trade rows when an EXECUTION-level counterpart exists for
 * the same `ibOrderID` AND `tradeDate`. IBKR Flex Query allows multiple
 * `levelOfDetail` selections on the Trades section: enabling both "Executions"
 * (per-fill) and "Orders" (aggregated) emits the same activity twice — once
 * per fill, once aggregated. Since {@link mergeExecutionsByOrder} groups by
 * `ibOrderID|tradeDate|...`, leaving the ORDER row in would double-count
 * quantity, money and commission.
 *
 * The match is per `(ibOrderID, tradeDate)` rather than a global flag, or per
 * `ibOrderID` alone, so that:
 *  - hybrid statements (some orders with both LODs, others with only ORDER —
 *    e.g. BookTrade / internal-transfer rows that may bypass execution detail)
 *    keep their ORDER-only rows, and
 *  - a GTC order whose `ibOrderID` carries across days never silently drops an
 *    ORDER row for a date that has no matching EXECUTION row.
 *
 * ORDER rows with no `ibOrderID` are always kept; they cannot be a duplicate
 * of a keyed EXECUTION row.
 *
 * Symmetric to {@link isCashSummaryRow} for the CashTransactions section, but
 * kept separate because the markers differ (SUMMARY vs ORDER), cash carries a
 * `transactionID/accountId` fallback signal that does not apply to trades, and
 * trades only drop ORDER when a matching EXECUTION is also present (a pure
 * ORDER-only export remains valid input).
 */
function filterDuplicateLevelOfDetail(rawTrades: Record<string, string>[]): Record<string, string>[] {
  const executionKeys = new Set<string>();
  for (const t of rawTrades) {
    if ((t.levelOfDetail ?? "").toUpperCase() === LEVEL_OF_DETAIL_EXECUTION && t.ibOrderID) {
      executionKeys.add(`${t.ibOrderID}|${t.tradeDate ?? ""}`);
    }
  }
  if (executionKeys.size === 0) return rawTrades;
  return rawTrades.filter(
    (t) =>
      !(
        (t.levelOfDetail ?? "").toUpperCase() === LEVEL_OF_DETAIL_ORDER &&
        t.ibOrderID &&
        executionKeys.has(`${t.ibOrderID}|${t.tradeDate ?? ""}`)
      ),
  );
}

/**
 * Detect a duplicate "Summary" cash-transaction row produced when the user
 * enables the Summary option in the Flex Query Cash Transactions section.
 *
 * Two independent signals identify these rows:
 *  - IBKR's own `levelOfDetail="SUMMARY"` attribute (present in some exports), or
 *  - the export-specific marker: blank `transactionID` AND `accountId === "-"`.
 *
 * Detail (real) rows always carry a real transactionID and a real accountId,
 * so this never drops a legitimate transaction.
 */
function isCashSummaryRow(raw: Record<string, string>): boolean {
  if ((raw.levelOfDetail ?? "").toUpperCase() === LEVEL_OF_DETAIL_SUMMARY) return true;
  return (raw.transactionID ?? "") === "" && (raw.accountId ?? "") === SUMMARY_ACCOUNT_PLACEHOLDER;
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
    averageQ4Cash: raw.averageQ4Cash ?? raw.averageCash ?? raw.averageCashBalance,
    openedDate: raw.openedDate ?? raw.openDate,
    institutionName: raw.institutionName ?? raw.brokerName,
    countryCode: raw.countryCode ?? raw.country,
  };
}

interface OptionEaeDelivery {
  date: string;
  symbol: string;
  underlyingSymbol: string;
  tradePrice: string;
  action: string;
}

function parseOptionEaeRows(rawRows: Record<string, string>[]): OptionExercise[] {
  const optionRows: OptionExercise[] = [];
  const deliveryRows: OptionEaeDelivery[] = [];

  for (const raw of rawRows) {
    if (raw.strike?.trim()) {
      const action = (raw.action ?? raw.type ?? "").toLowerCase();
      let mappedAction: OptionExercise["action"] = "Exercise";
      if (action.includes("assign")) mappedAction = "Assignment";
      else if (action.includes("expir") || action.includes("lapse")) mappedAction = "Expiration";

      optionRows.push({
        transactionID: raw.transactionID ?? "",
        accountId: raw.accountId ?? "",
        ...(raw.conid?.trim() ? { conid: raw.conid.trim() } : {}),
        symbol: raw.symbol ?? "",
        description: raw.description ?? "",
        isin: raw.isin ?? "",
        currency: raw.currency ?? "",
        date: raw.date ?? raw.dateTime?.slice(0, 8) ?? "",
        action: mappedAction,
        putCall: raw.putCall?.toUpperCase() === "P" ? "P" : raw.putCall?.toUpperCase() === "C" ? "C" : "C",
        strike: raw.strike,
        expiry: raw.expiry ?? "",
        quantity: raw.quantity ?? "0",
        proceeds: raw.proceeds ?? raw.amount ?? "0",
        underlyingSymbol: raw.underlyingSymbol ?? raw.symbol ?? "",
        underlyingIsin: raw.underlyingIsin ?? "",
        multiplier: raw.multiplier ?? "100",
      });
    } else if (raw.tradePrice?.trim()) {
      deliveryRows.push({
        date: raw.date ?? raw.dateTime?.slice(0, 8) ?? "",
        symbol: raw.symbol ?? "",
        underlyingSymbol: raw.underlyingSymbol ?? raw.symbol ?? "",
        tradePrice: raw.tradePrice,
        action: (raw.action ?? raw.type ?? "").toLowerCase(),
      });
    }
  }

  for (const opt of optionRows) {
    if (opt.action === "Expiration") continue;
    const delivery = deliveryRows.find(
      (d) => d.date === opt.date &&
        (d.symbol === opt.underlyingSymbol || d.underlyingSymbol === opt.underlyingSymbol),
    );
    if (delivery) {
      opt.marketPrice = delivery.tradePrice;
    }
  }

  return optionRows;
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
