/**
 * Post-parse data validation and sanity checks.
 */

import { t } from "../i18n/index.js";
import type { Statement } from "../types/broker.js";

export interface ValidationIssue {
  level: "error" | "warning" | "info";
  message: string;
}

/**
 * Run sanity checks on parsed statement data.
 * Called after all files are parsed and merged, before processing.
 */
export function validateStatement(statement: Statement, selectedYear: number | null, brokers?: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const trades = statement.trades;

  // 1. Future dates
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  for (const trade of trades) {
    const d = trade.tradeDate.replace(/[-;]/g, "").slice(0, 8);
    if (d > todayStr && d.length === 8) {
      issues.push({
        level: "warning",
        message: t("validation.future_date", { symbol: trade.symbol, date: d }),
      });
      break; // One warning is enough
    }
  }

  // 2. Missing cash transactions (dividends/withholdings)
  const hasTrades = trades.length > 0;
  const hasCash = statement.cashTransactions.length > 0;
  if (hasTrades && !hasCash) {
    const brokerLower = (brokers ?? []).map((b) => b.toLowerCase());
    const isDegiro = brokerLower.some((b) => b.includes("degiro"));
    const isIbkr = brokerLower.some((b) => b.includes("ibkr") || b.includes("interactive") || b.includes("mexem"));
    if (isDegiro) issues.push({ level: "warning", message: t("validation.no_cash_degiro") });
    if (isIbkr) issues.push({ level: "warning", message: t("validation.no_cash_transactions") });
    if (!isDegiro && !isIbkr) issues.push({ level: "warning", message: t("validation.no_cash_generic") });
  }

  // 3. No trades for selected year
  if (selectedYear && hasTrades) {
    const yearStr = String(selectedYear);
    const tradesInYear = trades.filter((tr) => {
      const d = tr.tradeDate.replace(/[-;]/g, "").slice(0, 8);
      return d.startsWith(yearStr);
    });
    if (tradesInYear.length === 0) {
      issues.push({
        level: "info",
        message: t("validation.no_trades_in_year", { year: yearStr }),
      });
    }
  }

  // 4. Very old data only (>10 years)
  if (trades.length > 0) {
    const dates = trades.map((tr) => tr.tradeDate.replace(/[-;]/g, "").slice(0, 8)).filter(Boolean).sort();
    const oldest = dates[0];
    if (oldest && parseInt(oldest.slice(0, 4), 10) < today.getFullYear() - 10) {
      issues.push({
        level: "info",
        message: t("validation.very_old_data", { year: oldest.slice(0, 4) }),
      });
    }
  }

  // 5. Duplicate trades detection (same ISIN + date + quantity + price)
  const seen = new Set<string>();
  let dupeCount = 0;
  for (const tr of trades) {
    const key = `${tr.isin}|${tr.tradeDate}|${tr.quantity}|${tr.tradePrice}|${tr.buySell}`;
    if (seen.has(key)) {
      dupeCount++;
    } else {
      seen.add(key);
    }
  }
  if (dupeCount > 0) {
    issues.push({
      level: "warning",
      message: t("validation.duplicate_trades", { count: String(dupeCount) }),
    });
  }

  return issues;
}

/**
 * Render validation issues as HTML for the review step.
 */
export function renderValidationIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return "";

  const icons: Record<string, string> = { error: "\u26D4", warning: "\u26A0\uFE0F", info: "\u2139\uFE0F" };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const items = issues
    .map((i) => `<li class="validation-${i.level}">${icons[i.level]} ${esc(i.message)}</li>`)
    .join("");

  return `<div class="validation-banner"><ul class="validation-list">${items}</ul></div>`;
}
