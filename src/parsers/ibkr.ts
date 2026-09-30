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
  // XXE / billion-laughs hardening. IBKR Flex XML is user-uploaded and
  // attacker-influenceable. fast-xml-parser already rejects external entities
  // (SYSTEM/PUBLIC → "External entities are not supported") regardless of this
  // option, so the classic XXE file/SSRF read is not reachable. What remains is
  // internal-entity (billion-laughs) expansion; we pin conservative limits to
  // bound it explicitly rather than relying on library defaults that a future
  // bump could relax. NB: a bare `processEntities: false` would ALSO stop
  // decoding the 5 predefined XML entities (&amp; &lt; &gt; &quot; &apos;) in
  // fast-xml-parser v5, corrupting legitimate fields like "E-MINI S&amp;P 500";
  // keeping `enabled: true` preserves that decoding while still capping expansion.
  processEntities: {
    enabled: true,
    maxEntityCount: 1000,
    maxExpansionDepth: 20,
    maxExpandedLength: 100000,
  },
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
  let cancelledPairsDropped = 0;
  let cancelledUnmatchedDropped = 0;

  for (const stmt of statements) {
    const rawTrades = ensureArray(stmt.Trades?.Trade) as Record<string, string>[];
    const filteredRawTrades = filterDuplicateLevelOfDetail(rawTrades);
    orderLevelDetailDuplicatesSkipped += rawTrades.length - filteredRawTrades.length;
    const { kept, pairedCount, unmatchedCount } = dropCancelledExecutions(filteredRawTrades);
    cancelledPairsDropped += pairedCount;
    cancelledUnmatchedDropped += unmatchedCount;
    const stmtTrades = kept.map(mapTrade);
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

  assertFlexDateFormat(trades.map((t) => t.tradeDate), cashTransactions.map((c) => c.dateTime));

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

  if (cancelledPairsDropped > 0) {
    parserMessages.push({
      id: "parser.cancelled_trades",
      severity: "info",
      message: `Se omitieron ${cancelledPairsDropped} operaciones canceladas por IBKR junto con su anulación.`,
      hint: 'IBKR marca una ejecución cancelada con una fila de anulación ("(Ca.)"). La operación original y su anulación se han descartado: nunca llegaron a ser una compra o venta real.',
      context: { count: String(cancelledPairsDropped) },
    });
  }

  if (cancelledUnmatchedDropped > 0) {
    parserMessages.push({
      id: "parser.cancelled_trades_unmatched",
      severity: "warning",
      message: `Se omitieron ${cancelledUnmatchedDropped} anulaciones de IBKR sin la operación original en este archivo.`,
      hint: "La operación cancelada queda fuera del periodo de este Flex Query. Si la cargas desde otro archivo, se seguirá contando como real: exporta un periodo que incluya la operación y su anulación en el mismo archivo.",
      context: { count: String(cancelledUnmatchedDropped) },
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

/**
 * A Flex date starts with yyyyMMdd or yyyy-MM-dd (plausible year, month, day).
 * dateTime values carry a time after it; the separator is not checked here.
 */
const FLEX_DATE_PREFIX = /^(?:19|20)\d\d(-?)(?:0[1-9]|1[0-2])\1(?:0[1-9]|[12]\d|3[01])(?!\d)/;

/**
 * The Flex Query "Date Format" setting also offers MM/dd/yyyy, dd/MM/yyyy,
 * dd-MMM-yy and more. Those dates never match the declaration year, so the
 * report would come out empty with no message. Refuse the file instead and say
 * which setting to change.
 */
function assertFlexDateFormat(tradeDates: string[], cashDateTimes: string[]): void {
  for (const raw of [...tradeDates, ...cashDateTimes]) {
    if (raw !== "" && !FLEX_DATE_PREFIX.test(raw)) {
      throw new Error(
        `IBKR Flex Query: formato de fecha no soportado ("${raw}"). ` +
          "En la configuración de la Flex Query, elige Date Format: yyyyMMdd y vuelve a exportar el fichero.",
      );
    }
  }
}

const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * IBKR sends the underlying's identifier as underlyingSecurityID (an ISIN, or a
 * CUSIP for some listings), not as underlyingIsin. Take it only when it has the
 * ISIN shape, so the underlying lot key matches the ISIN-keyed stock trades.
 */
function underlyingIsinOf(raw: Record<string, string>): string {
  if (raw.underlyingIsin) return raw.underlyingIsin;
  const id = raw.underlyingSecurityID?.trim() ?? "";
  return ISIN_SHAPE.test(id) ? id : "";
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
    // Flex exports name the attribute settleDateTarget; settlementDate is kept
    // for hand-written and older XML.
    settlementDate: raw.settlementDate || raw.settleDateTarget || "",
    quantity: raw.quantity ?? "0",
    tradePrice: raw.tradePrice ?? "0",
    tradeMoney: raw.tradeMoney ?? "0",
    proceeds: raw.proceeds ?? "0",
    cost: raw.cost ?? "0",
    fifoPnlRealized: raw.fifoPnlRealized ?? "0",
    fxRateToBase: raw.fxRateToBase ?? "1",
    // Canonical "BUY"/"SELL" after trimming and upper-casing. Cancel rows
    // ("SELL (Ca.)") never get here; any other value passes through and
    // FifoEngine skips it with a warning instead of treating it as a sale.
    buySell: (raw.buySell ?? "BUY").trim().toUpperCase() as Trade["buySell"],
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
    underlyingIsin: underlyingIsinOf(raw) || undefined,
    ibOrderID: raw.ibOrderID || undefined,
  };
}

/** IBKR notes code for a cancelled execution. */
const NOTE_CANCELLED = "Ca";
/** Suffix IBKR appends to buySell on the row that cancels an execution ("SELL (Ca.)"). */
const CANCEL_SUFFIX = /\s*\(Ca\.\)\s*$/i;
/** IBKR transactionType of the row that cancels an execution. */
const TRANSACTION_TYPE_CANCEL = "TradeCancel";

function isCancelRow(raw: Record<string, string>): boolean {
  if ((raw.transactionType ?? "").trim() === TRANSACTION_TYPE_CANCEL) return true;
  if (CANCEL_SUFFIX.test(raw.buySell ?? "")) return true;
  return (raw.notes ?? "").split(";").some((n) => n.trim() === NOTE_CANCELLED);
}

/** transactionID of the fill a cancel row reverses, or "" when the export lacks the link. */
function cancelledTransactionId(cancel: Record<string, string>): string {
  const id = (cancel.origTransactionID ?? "").trim();
  return id === "0" ? "" : id;
}

/**
 * Remove cancelled executions. IBKR keeps the original fill in the Flex file
 * and adds a reversing row (transactionType "TradeCancel", buySell
 * "SELL (Ca.)"/"BUY (Ca.)", notes "Ca", opposite quantity). Neither row is a
 * real transmission or acquisition, so each cancel row is paired with the fill
 * it cancels and both are dropped.
 *
 * The pairing uses IBKR's own link when the export has it: the cancel row's
 * origTransactionID is the transactionID of the cancelled fill. That matters
 * when IBKR busts a fill and rebooks it (for example with a corrected
 * commission): the original and the rebook share instrument, price, quantity,
 * ibOrderID and tradeDate, and only the link says which one was cancelled.
 * Exports without that column fall back to a heuristic: same instrument,
 * currency, price and direction, exactly opposite quantity, with a matching
 * ibExecID, ibOrderID or tradeDate breaking ties.
 *
 * A cancel row with no original in this statement (the fill is outside the
 * export's period) is dropped alone and counted separately so the user is
 * warned. It is never flipped into an opposite-direction trade: that would
 * create a lot or a disposal that never happened.
 */
function dropCancelledExecutions(
  rows: Record<string, string>[],
): { kept: Record<string, string>[]; pairedCount: number; unmatchedCount: number } {
  const cancelIdx: number[] = [];
  rows.forEach((raw, i) => {
    if (isCancelRow(raw)) cancelIdx.push(i);
  });
  if (cancelIdx.length === 0) return { kept: rows, pairedCount: 0, unmatchedCount: 0 };

  const dropped = new Set<number>(cancelIdx);
  let pairedCount = 0;
  let unmatchedCount = 0;
  for (const ci of cancelIdx) {
    const cancel = rows[ci]!;
    const origId = cancelledTransactionId(cancel);
    if (origId) {
      const oi = rows.findIndex((o, i) => !dropped.has(i) && (o.transactionID ?? "").trim() === origId);
      if (oi >= 0) {
        dropped.add(oi);
        pairedCount++;
      } else {
        unmatchedCount++;
      }
      continue;
    }
    const direction = (cancel.buySell ?? "").replace(CANCEL_SUFFIX, "").trim().toUpperCase();
    const originalQty = new Decimal(cancel.quantity || "0").neg();
    const price = new Decimal(cancel.tradePrice || "0");
    let best = -1;
    let bestScore = -1;
    rows.forEach((o, oi) => {
      if (dropped.has(oi)) return;
      const sameInstrument = o.conid && cancel.conid ? o.conid === cancel.conid : o.symbol === cancel.symbol;
      if (!sameInstrument || (o.currency ?? "") !== (cancel.currency ?? "")) return;
      if ((o.buySell ?? "").trim().toUpperCase() !== direction) return;
      if (!new Decimal(o.quantity || "0").eq(originalQty)) return;
      if (!new Decimal(o.tradePrice || "0").eq(price)) return;
      const score =
        (o.ibExecID && o.ibExecID === cancel.ibExecID ? 4 : 0) +
        (o.ibOrderID && o.ibOrderID === cancel.ibOrderID ? 2 : 0) +
        (o.tradeDate === cancel.tradeDate ? 1 : 0);
      if (score > bestScore) {
        best = oi;
        bestScore = score;
      }
    });
    if (best >= 0) {
      dropped.add(best);
      pairedCount++;
    } else {
      unmatchedCount++;
    }
  }
  return { kept: rows.filter((_, i) => !dropped.has(i)), pairedCount, unmatchedCount };
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

/**
 * Interactive Brokers Ireland Limited holds the accounts of clients resident in
 * the EEA, Spain included, so that is where their securities are deposited
 * (Modelo 720, positions 129-130 of a clave V record).
 */
const IBKR_CUSTODIAN_COUNTRY = "IE";

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
    custodianCountry: IBKR_CUSTODIAN_COUNTRY,
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
  isin: string;
  underlyingSymbol: string;
  tradePrice: string;
  action: string;
}

function parseOptionEaeRows(rawRows: Record<string, string>[]): OptionExercise[] {
  const optionRows: OptionExercise[] = [];
  const deliveryRows: OptionEaeDelivery[] = [];

  for (const raw of rawRows) {
    if (raw.strike?.trim()) {
      const action = (raw.action ?? raw.type ?? raw.transactionType ?? "").toLowerCase();
      let mappedAction: OptionExercise["action"] = "Exercise";
      if (action.includes("assign")) mappedAction = "Assignment";
      else if (action.includes("expir") || action.includes("lapse")) mappedAction = "Expiration";

      optionRows.push({
        transactionID: raw.transactionID ?? "",
        accountId: raw.accountId ?? "",
        ...(raw.conid?.trim() ? { conid: raw.conid.trim() } : {}),
        ...(raw.assetCategory?.trim() ? { assetCategory: raw.assetCategory.trim() as OptionExercise["assetCategory"] } : {}),
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
        underlyingIsin: underlyingIsinOf(raw),
        multiplier: raw.multiplier ?? "100",
      });
    } else if (raw.tradePrice?.trim()) {
      deliveryRows.push({
        date: raw.date ?? raw.dateTime?.slice(0, 8) ?? "",
        symbol: raw.symbol ?? "",
        isin: raw.isin ?? "",
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
      if (!opt.underlyingIsin && delivery.isin) opt.underlyingIsin = delivery.isin;
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
