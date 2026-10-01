/**
 * Brokers whose export carries no year-end holdings.
 *
 * Most broker exports (Binance, Coinbase, Kraken, Degiro, ...) are transaction
 * lists: they never say what the user held at 31 December. The Modelo 720, 721
 * and D-6 sections value only those holdings, so without this list they told a
 * user who just uploaded a file to "upload a report with positions". Each
 * section uses the list to name the brokers it could not see holdings for and
 * to send the user to that broker's year-end statement instead.
 *
 * Computed per uploaded file, then grouped by broker: a broker counts as having
 * holdings when ANY of its files has them (e.g. Degiro transactions + account).
 */

import Decimal from "decimal.js";
import type { Statement } from "../types/broker.js";

/** One parsed file and the broker that parsed it. */
export interface ParsedExport {
  broker: string;
  statement: Statement;
}

/** Brokers with activity relevant to each model but no holdings in their export. */
export interface MissingHoldings {
  m720: string[];
  m721: string[];
  d6: string[];
}

const SECURITY_CATEGORIES = new Set(["STK", "FUND", "BOND"]);

interface BrokerFacts {
  anyHoldings: boolean;
  cryptoActivity: boolean;
  cryptoHoldings: boolean;
  securitiesActivity: boolean;
  securitiesHoldings: boolean;
}

function factsOf(statement: Statement): BrokerFacts {
  const positions = statement.openPositions;
  const positiveCash = (statement.cashBalances ?? []).some((cb) => new Decimal(cb.endingCash || 0).greaterThan(0));
  return {
    anyHoldings: positions.length > 0 || positiveCash,
    cryptoActivity:
      statement.trades.some((tr) => tr.assetCategory === "CRYPTO") ||
      positions.some((p) => p.assetCategory === "CRYPTO") ||
      statement.cashTransactions.some((c) => c.type === "Crypto Reward Income"),
    // Same filter as buildModelo721Entries: a crypto position with no value is not counted.
    cryptoHoldings: positions.some(
      (p) => p.assetCategory === "CRYPTO" && new Decimal(p.positionValue || 0).greaterThan(0),
    ),
    securitiesActivity: statement.trades.some((tr) => SECURITY_CATEGORIES.has(tr.assetCategory)),
    securitiesHoldings: positions.some((p) => SECURITY_CATEGORIES.has(p.assetCategory)),
  };
}

/**
 * For each model, the brokers (in upload order, without duplicates) whose
 * export has no holdings the model could use.
 *
 * - 720: the broker's files have no open positions and no positive cash balance.
 * - 721: the broker's files have crypto activity but no valued crypto position.
 *   Brokers with no crypto at all are left out, so a Degiro user is not told
 *   to check a crypto threshold.
 * - D-6: the broker's files have securities trades but no securities position.
 */
export function findMissingHoldings(exports: ParsedExport[]): MissingHoldings {
  const byBroker = new Map<string, BrokerFacts>();
  for (const { broker, statement } of exports) {
    const f = factsOf(statement);
    const prev = byBroker.get(broker);
    byBroker.set(
      broker,
      prev
        ? {
            anyHoldings: prev.anyHoldings || f.anyHoldings,
            cryptoActivity: prev.cryptoActivity || f.cryptoActivity,
            cryptoHoldings: prev.cryptoHoldings || f.cryptoHoldings,
            securitiesActivity: prev.securitiesActivity || f.securitiesActivity,
            securitiesHoldings: prev.securitiesHoldings || f.securitiesHoldings,
          }
        : f,
    );
  }

  const result: MissingHoldings = { m720: [], m721: [], d6: [] };
  for (const [broker, f] of byBroker) {
    if (!f.anyHoldings) result.m720.push(broker);
    if (f.cryptoActivity && !f.cryptoHoldings) result.m721.push(broker);
    if (f.securitiesActivity && !f.securitiesHoldings) result.d6.push(broker);
  }
  return result;
}

/** "Binance", "Binance y Coinbase", "Binance, Coinbase y Kraken" in the given locale. */
export function formatBrokerList(brokers: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(brokers);
  } catch {
    return brokers.join(", ");
  }
}
