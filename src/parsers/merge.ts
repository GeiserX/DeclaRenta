import type { Statement } from "../types/broker.js";
import { normalizeDate } from "../engine/dates.js";

export function createEmptyStatement(): Statement {
  return {
    accountId: "",
    fromDate: "",
    toDate: "",
    period: "",
    trades: [],
    cashTransactions: [],
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
    cashBalances: [],
    optionExercises: [],
    parserWarnings: [],
  };
}

export function mergeStatement(target: Statement, source: Statement): Statement {
  target.accountId = target.accountId || source.accountId;
  target.fromDate = minDate(target.fromDate, source.fromDate);
  target.toDate = maxDate(target.toDate, source.toDate);
  target.period = target.period || source.period;

  target.trades.push(...source.trades);
  target.cashTransactions.push(...source.cashTransactions);
  target.corporateActions.push(...source.corporateActions);
  target.openPositions.push(...source.openPositions);
  target.securitiesInfo.push(...source.securitiesInfo);
  target.cashBalances = [...(target.cashBalances ?? []), ...(source.cashBalances ?? [])];
  target.optionExercises = [...(target.optionExercises ?? []), ...(source.optionExercises ?? [])];
  target.parserWarnings = [...(target.parserWarnings ?? []), ...(source.parserWarnings ?? [])];

  return target;
}

export function finalizeMergedStatement(statement: Statement): Statement {
  statement.trades.sort((a, b) => {
    const dateCmp = normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate));
    if (dateCmp !== 0) return dateCmp;
    return a.tradeID.localeCompare(b.tradeID);
  });
  statement.cashTransactions.sort((a, b) =>
    normalizeDate(a.dateTime).localeCompare(normalizeDate(b.dateTime)),
  );
  statement.corporateActions.sort((a, b) =>
    normalizeDate(a.dateTime).localeCompare(normalizeDate(b.dateTime)),
  );
  statement.optionExercises?.sort((a, b) =>
    normalizeDate(a.date).localeCompare(normalizeDate(b.date)),
  );
  return statement;
}

function minDate(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return normalizeDate(a) <= normalizeDate(b) ? a : b;
}

function maxDate(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return normalizeDate(a) >= normalizeDate(b) ? a : b;
}
