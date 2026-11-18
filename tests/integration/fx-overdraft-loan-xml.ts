/**
 * IBKR Flex XML for the overdraft-loan scenarios (issue #449). It writes a
 * harness scenario (fx-traditional-harness.ts) as one FlexStatement per year,
 * with a CashReport whose USD row chains `startingCash` → `endingCash` from
 * the scenario's own cash flows, and runs it through the real IBKR parser and
 * merge, so the loan gate sees what an upload gives it.
 */
import Decimal from "decimal.js";
import { parseIbkrFlexXml } from "../../src/parsers/ibkr.js";
import { createEmptyStatement, finalizeMergedStatement, mergeStatement } from "../../src/parsers/merge.js";
import { generateTaxReport, type ReportOptions } from "../../src/generators/report.js";
import type { Statement } from "../../src/types/broker.js";
import type { EcbRateMap } from "../../src/types/ecb.js";
import { toStatement, type Ev, type Scenario, type YearFigures } from "./fx-traditional-harness.js";

/** A harness event, plus debit interest (`int`) and IBKR auto-conversions (`afx` on `fund`/`conv`). */
export type LoanEv = (Ev & { afx?: boolean }) | { k: "int"; d: string; usd: string; r: string };

export interface LoanScenario {
  id: string;
  ev: LoanEv[];
  /** USD `startingCash` of the first statement; `null` writes the row without it, `undefined` writes no CashReport. */
  opening?: string | null;
  /** Added to the last statement's USD `endingCash` (a movement the upload does not show). */
  endingDelta?: string;
  account?: string;
}

const ymd = (d: string) => d.replace(/-/g, "");

/** USD cash effect of one event. */
function flow(e: LoanEv): Decimal {
  if (e.k === "buy" || e.k === "sell") {
    const v = new Decimal(e.qty).mul(e.px);
    return e.k === "buy" ? v.negated() : v;
  }
  const v = new Decimal(e.usd);
  return e.k === "fund" || e.k === "dep" || e.k === "div" ? v : v.negated();
}

const attrs = (o: Record<string, unknown>): string =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${String(v)}"`)
    .join(" ");

/** The scenario as a harness one: `int` becomes a fee row, renamed below. */
export function harnessScenario(sc: LoanScenario): Scenario {
  const ev = [...sc.ev].sort((a, b) => a.d.localeCompare(b.d));
  return {
    id: sc.id,
    years: [...new Set(ev.map((e) => Number(e.d.slice(0, 4))))].sort(),
    closed: true,
    ev: ev.map((e): Ev => (e.k === "int" ? { k: "fee", d: e.d, usd: e.usd, r: e.r } : e)),
  };
}

/** The Flex XML of the scenario and its ECB rate map. */
export function toXml(sc: LoanScenario): { xml: string; rates: EcbRateMap } {
  const hs = harnessScenario(sc);
  const sorted = [...sc.ev].sort((a, b) => a.d.localeCompare(b.d));
  const { st, rates } = toStatement(hs);
  const account = sc.account ?? "U1";
  // toStatement numbers its rows by event position (1-based).
  const byId = new Map(sorted.map((e, i) => [String(i + 1), e]));
  let starting = sc.opening === undefined || sc.opening === null ? new Decimal(0) : new Decimal(sc.opening);
  const statements = hs.years.map((y, yi) => {
    const inYear = (d: string) => d.startsWith(String(y));
    const trades = st.trades
      .filter((t) => inYear(t.tradeDate))
      .map((t) => {
        const e = byId.get(t.tradeID);
        return `<Trade ${attrs({
          tradeID: t.tradeID,
          accountId: account,
          symbol: t.symbol,
          description: t.description,
          isin: t.isin,
          assetCategory: t.assetCategory,
          currency: t.currency,
          tradeDate: ymd(t.tradeDate),
          settlementDate: ymd(t.settlementDate),
          quantity: t.quantity,
          tradePrice: t.tradePrice,
          tradeMoney: t.tradeMoney,
          proceeds: t.proceeds,
          cost: t.cost,
          fifoPnlRealized: "0",
          fxRateToBase: "1",
          buySell: t.buySell,
          openCloseIndicator: t.assetCategory === "CASH" ? undefined : t.openCloseIndicator,
          exchange: t.exchange,
          ibCommissionCurrency: "USD",
          ibCommission: "0",
          taxes: "0",
          notes: e && "afx" in e && e.afx ? "AFx" : undefined,
        })} />`;
      });
    const cash = st.cashTransactions
      .filter((c) => inYear(c.dateTime))
      .map((c) => {
        const e = byId.get(c.transactionID);
        const interest = e?.k === "int";
        return `<CashTransaction ${attrs({
          transactionID: c.transactionID,
          accountId: account,
          symbol: c.symbol,
          description: interest ? `USD DEBIT INT FOR ${c.dateTime.slice(0, 6)}` : c.description,
          isin: c.isin,
          currency: c.currency,
          dateTime: c.dateTime,
          settleDate: c.settleDate,
          amount: c.amount,
          fxRateToBase: "1",
          type: interest ? "Broker Interest Paid" : c.type,
        })} />`;
      });
    // A USD deposit: a cash row the FX engine does not read (no EUR origin).
    sorted.forEach((e, i) => {
      if (e.k !== "dep" || !inYear(e.d)) return;
      cash.push(
        `<CashTransaction ${attrs({
          transactionID: `d${i + 1}`,
          accountId: account,
          description: "CASH RECEIPTS / ELECTRONIC FUND TRANSFERS",
          currency: "USD",
          dateTime: ymd(e.d),
          settleDate: ymd(e.d),
          amount: e.usd,
          fxRateToBase: "1",
          type: "Deposits/Withdrawals",
        })} />`,
      );
    });
    const yearFlow = sorted.filter((e) => inYear(e.d)).reduce((s, e) => s.plus(flow(e)), new Decimal(0));
    let ending = starting.plus(yearFlow);
    if (yi === hs.years.length - 1 && sc.endingDelta) ending = ending.plus(sc.endingDelta);
    const row = attrs({
      accountId: account,
      currency: "USD",
      fromDate: `${y}0101`,
      toDate: `${y}1231`,
      startingCash: yi === 0 && sc.opening === null ? undefined : starting.toString(),
      endingCash: ending.toString(),
      endingSettledCash: ending.toString(),
    });
    starting = ending;
    const report = sc.opening === undefined ? "" : `<CashReport><CashReportCurrency ${row} /></CashReport>`;
    return `<FlexStatement accountId="${account}" fromDate="${y}0101" toDate="${y}1231" period="Annual">${report}<Trades>${trades.join("")}</Trades><CashTransactions>${cash.join("")}</CashTransactions></FlexStatement>`;
  });
  const xml = `<FlexQueryResponse queryName="L449" type="AF"><FlexStatements count="${statements.length}">${statements.join("")}</FlexStatements></FlexQueryResponse>`;
  return { xml, rates };
}

/** Parse and merge the files as the web does (broker stamp included). */
export function toUpload(...xmls: string[]): Statement {
  let st = createEmptyStatement();
  for (const x of xmls) st = mergeStatement(st, parseIbkrFlexXml(x), "Interactive Brokers");
  return finalizeMergedStatement(st);
}

/** Every year of the upload through generateTaxReport. */
export function runUpload(st: Statement, rates: EcbRateMap, years: number[], options: ReportOptions): Map<number, YearFigures> {
  const out = new Map<number, YearFigures>();
  for (const y of years) {
    const r = generateTaxReport(st, rates, y, options);
    out.set(y, {
      stock: r.capitalGains.netGainLoss,
      fx: r.fxGains.netGainLoss,
      t1633: r.fxGains.transmissionValue,
      a1637: r.fxGains.acquisitionValue,
      s0328: r.capitalGains.transmissionValue,
      s0331: r.capitalGains.acquisitionValue,
      report: r,
    });
  }
  return out;
}

/** Build, parse and run a scenario. */
export function runLoan(sc: LoanScenario, options: ReportOptions): Map<number, YearFigures> {
  const { xml, rates } = toXml(sc);
  return runUpload(toUpload(xml), rates, harnessScenario(sc).years, options);
}
