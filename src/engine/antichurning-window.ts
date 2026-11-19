/**
 * The anti-churning window of each ISIN: 2 months (LIRPF 33.5.f) or 1 year
 * (33.5.g), issue #452.
 *
 * Letter f gives 2 months to securities «admitidos a negociación en alguno de
 * los mercados secundarios oficiales de valores definidos en la Directiva
 * 2004/39/CE»: an EEA regulated market, or a third-country market a Commission
 * decision in force declares equivalent (DGT V0778-25). Letter g gives 1 year
 * to the rest. One qualifying listing anywhere is enough.
 *
 * DeclaRenta cannot see every listing of a security, so it reads three things,
 * in this order:
 *  1. A per-ISIN value the user set (2 or 12). It wins over everything.
 *  2. IBKR's `listingExchange` (Trades and Financial Instrument Information).
 *     It gives 1 year only when EVERY IBKR code of the ISIN is a market that is
 *     neither an EEA regulated market nor named in an equivalence decision on
 *     the sale day. Any other code, or a misspelt one, gets no vote, so a
 *     second listing anywhere keeps 2 months.
 *  3. Otherwise today's heuristic in `wash-sale.ts`: 2 months with an ISIN,
 *     12 without one.
 * Crypto is letter e (#457) and never reaches this module.
 */

import type { SecurityInfo, Trade } from "../types/ibkr.js";
import type { AntichurningSecurity, FifoDisposal } from "../types/tax.js";
import { normalizeDate } from "./dates.js";

/** The shape of an ISIN: 2 letters, 9 alphanumerics, 1 check digit. */
export const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Window length in calendar months: 2 (letter f) or 12 (letter g). */
export type WindowMonths = 2 | 12;

/** Categories with no anti-churning rule, and crypto (letter e): they never vote. */
const NO_LISTING_VOTE: ReadonlySet<string> = new Set(["OPT", "FUT", "FOP", "FSFOP", "CFD", "CASH", "CRYPTO"]);

/**
 * IBKR listing codes whose market is NOT an EEA regulated market and NOT named
 * in a Commission equivalence decision, except inside the `equivalent` spans
 * (inclusive ISO days). A code is letter g on a sale day outside every span.
 * Test applied: DGT V0778-25, https://consultasdgt.es/consulta/V0778-25 .
 * Codes from IBKR's own list, https://www.interactivebrokers.com/webrest/exchanges/ .
 */
export const NON_EQUIVALENT_LISTINGS: Readonly<Record<string, { equivalent: readonly { from?: string; until?: string }[] }>> = {
  // London: EU law until the end of the Brexit transition (Withdrawal Agreement
  // art. 126-127, https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX:12020W/TXT);
  // no UK equivalence decision afterwards. Before 2021 the code also covers AIM
  // (an MTF), so "equivalent" there only means "no automatic 1 year".
  LSE: { equivalent: [{ until: "2020-12-31" }] },
  LSEIOB1: { equivalent: [{ until: "2020-12-31" }] }, // LSE International Order Book
  // SIX Swiss Exchange: Implementing Decisions (EU) 2017/2441 (24/12/2017-31/12/2018)
  // and 2018/2047 (01/01/2019-30/06/2019).
  // https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32017D2441
  // https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32018D2047
  EBS: { equivalent: [{ from: "2017-12-24", until: "2019-06-30" }] },
  // OTC Markets: OTC Link is not in the 2017/2320 annex nor in 2022/552.
  PINK: { equivalent: [] },
  OTCLNKECN: { equivalent: [] },
  // Japannext: not in the 2016/2271 annex (which names the Tokyo, Nagoya,
  // Fukuoka and Sapporo exchanges).
  JPNNEXT: { equivalent: [] },
  // Mainland China through Stock Connect: no decision for Shanghai or Shenzhen.
  SEHKNTL: { equivalent: [] },
  SEHKSZSE: { equivalent: [] },
  SEHKSTAR: { equivalent: [] },
  CHINEXT: { equivalent: [] },
  // Other third countries: no MiFID II art. 25(4)(a) and no EMIR art. 2a market
  // decision on EUR-Lex (the Brazil and India decisions cover CCPs only).
  MEXI: { equivalent: [] },
  B3: { equivalent: [] },
  KRX: { equivalent: [] },
  BURSAMY: { equivalent: [] }, // Bursa Malaysia
  NXT: { equivalent: [] },
  TASE: { equivalent: [] },
  JSE: { equivalent: [] },
  NSE: { equivalent: [] },
  TWSE: { equivalent: [] },
  TPEX: { equivalent: [] },
  MOEX: { equivalent: [] },
  ADX: { equivalent: [] },
  DFM: { equivalent: [] },
  TADAWUL: { equivalent: [] },
};

/**
 * Codes named only in an EMIR art. 2a decision. Each one says its markets «se
 * considerarán equivalentes a los mercados regulados definidos en [...] la
 * Directiva 2004/39/CE», and in V0778-25 the DGT accepted that kind of decision
 * for CME. That gives letter f (2 months), but no consulta covers shares, so
 * the report calls the point open and the user can mark 1 year.
 */
export const OPEN_EQUIVALENT_LISTINGS: Readonly<Record<string, string>> = {
  TSE: "2016/2273", // TSX Inc. https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX:32016D2273
  VENTURE: "2016/2273", // TSX Venture Inc.
  AEQLIT: "2016/2273", // Aequitas Neo Exchange Inc.
  TSEJ: "2016/2271", // Tokyo Stock Exchange, Inc. https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX:32016D2271
  SGX: "2016/2270", // Singapore Exchange Securities Trading Limited https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX:32016D2270
};

/** What DeclaRenta knows about one ISIN's window. */
export interface IsinWindow {
  /** The user's value, when set. */
  user?: WindowMonths;
  /** Every IBKR listing code of the ISIN, sorted and unique. */
  listings: readonly string[];
}

/** One ISIN's resolved window on a sale day. */
export interface ResolvedWindow {
  months: WindowMonths;
  /** `user`: the user's value; `ibkr`: IBKR's listing codes decided it; `default`: neither. */
  source: "user" | "ibkr" | "default";
  /** The equivalence decision a 2-month IBKR reading rests on, when no consulta confirms it for shares. */
  openDecision?: string;
}

/**
 * Keep only well-formed per-ISIN values: an ISIN-shaped key (upper-cased) and
 * the number 2 or 12. The input is untrusted (localStorage, CLI), so the
 * result is a Map built key by key: a `__proto__` key does nothing.
 */
export function coerceWindowOverrides(raw: unknown): Map<string, WindowMonths> {
  const out = new Map<string, WindowMonths>();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw)) {
    const isin = key.trim().toUpperCase();
    const value = (raw as Record<string, unknown>)[key];
    if (!ISIN_SHAPE.test(isin) || (value !== 2 && value !== 12)) continue;
    out.set(isin, value);
  }
  return out;
}

/**
 * The window data of every ISIN: IBKR's listing codes from the trades and the
 * Financial Instrument Information rows, and the user's values. Rows without
 * an ISIN, without a code, or of a category with no anti-churning rule (and
 * crypto) give no code.
 */
export function collectIsinWindows(
  trades: readonly Trade[],
  securitiesInfo: readonly SecurityInfo[] = [],
  overrides?: unknown,
): Map<string, IsinWindow> {
  const codes = new Map<string, Set<string>>();
  const vote = (isin: string, assetCategory: string, listing: string | undefined): void => {
    if (!isin || !listing || NO_LISTING_VOTE.has(assetCategory)) return;
    let set = codes.get(isin);
    if (!set) {
      set = new Set();
      codes.set(isin, set);
    }
    set.add(listing);
  };
  for (const t of trades) vote(t.isin, t.assetCategory, t.listingExchange);
  for (const s of securitiesInfo) vote(s.isin, s.assetCategory, s.listingExchange);

  const out = new Map<string, IsinWindow>();
  for (const [isin, set] of codes) out.set(isin, { listings: [...set].sort() });
  for (const [isin, months] of coerceWindowOverrides(overrides)) {
    out.set(isin, { listings: out.get(isin)?.listings ?? [], user: months });
  }
  return out;
}

/** Whether an IBKR code is a letter-g market on a sale day (YYYY-MM-DD). */
function nonEquivalentOn(code: string, day: string): boolean {
  const entry = NON_EQUIVALENT_LISTINGS[code];
  if (!entry || !Object.hasOwn(NON_EQUIVALENT_LISTINGS, code)) return false;
  return !entry.equivalent.some((span) => (span.from === undefined || day >= span.from) && (span.until === undefined || day <= span.until));
}

/**
 * The window of one ISIN on a sale day (YYYY-MM-DD), or undefined when neither
 * the user nor IBKR's codes decide it (the caller keeps its heuristic).
 *  - The user's value wins.
 *  - 12 from IBKR only when every code is a letter-g market on that day.
 *  - 2 from IBKR, flagged open, when every code is a letter-g market or an
 *    EMIR-only market and at least one is EMIR-only: the 2 months then rest on
 *    an equivalence decision no consulta has applied to shares.
 */
export function resolveIsinWindow(w: IsinWindow | undefined, day: string): ResolvedWindow | undefined {
  if (!w) return undefined;
  if (w.user !== undefined) return { months: w.user, source: "user" };
  if (w.listings.length === 0) return undefined;
  if (w.listings.every((code) => nonEquivalentOn(code, day))) return { months: 12, source: "ibkr" };
  const open = w.listings.filter((code) => Object.hasOwn(OPEN_EQUIVALENT_LISTINGS, code));
  if (open.length > 0 && w.listings.every((code) => open.includes(code) || nonEquivalentOn(code, day))) {
    const decisions = [...new Set(open.map((code) => OPEN_EQUIVALENT_LISTINGS[code]!))].sort();
    return { months: 2, source: "ibkr", openDecision: decisions.join(", ") };
  }
  return undefined;
}

/**
 * The securities whose anti-churning window the report lists (#452), one row
 * per ISIN: a loss sale or a released loss in the year, a user value, or a
 * sale in the year whose IBKR reading is 1 year (a gain sale can stop being a
 * «transmisión definitiva» under 1 year, so the user must be able to set it
 * back to 2 months). A gain sale with nothing to release and a 2-month reading
 * is not listed, open decision or not: no window changes its result. Each
 * condition holds whatever window the user picks (a toggle that removes a
 * release adds a user value), so a change of the window never removes a row. The row's months are those of the ISIN's last
 * sale day in the year (31 December when it has none).
 *
 * @param yearDisposals - The tax year's disposals, after anti-churning
 * @param windows - The same map `detectWashSales` used
 * @param names - Symbol and description per ISIN, for rows with no sale
 */
export function listAntichurningSecurities(
  yearDisposals: readonly FifoDisposal[],
  windows: ReadonlyMap<string, IsinWindow>,
  year: number,
  names: ReadonlyMap<string, { symbol: string; description: string }> = new Map(),
): AntichurningSecurity[] {
  const sold = new Map<string, { symbol: string; description: string; lastDay: string; relevant: boolean }>();
  for (const d of yearDisposals) {
    if (!d.isin || NO_LISTING_VOTE.has(d.assetCategory) || d.quantity.isZero()) continue;
    const day = normalizeDate(d.sellDate.trim()).slice(0, 10);
    const relevant = d.gainLossEur.isNegative() || d.reintegratedLossEur.greaterThan(0);
    const prev = sold.get(d.isin);
    if (!prev) sold.set(d.isin, { symbol: d.symbol, description: d.description, lastDay: day, relevant });
    else {
      if (day > prev.lastDay) prev.lastDay = day;
      prev.relevant ||= relevant;
    }
  }
  const isins = new Set(sold.keys());
  for (const [isin, w] of windows) if (w.user !== undefined) isins.add(isin);

  const rows: AntichurningSecurity[] = [];
  for (const isin of isins) {
    const sale = sold.get(isin);
    const w = windows.get(isin);
    const day = sale?.lastDay ?? `${year}-12-31`;
    const auto = resolveIsinWindow(w ? { listings: w.listings } : undefined, day);
    if (!sale?.relevant && w?.user === undefined && !(sale && auto?.months === 12)) continue;
    const resolved = resolveIsinWindow(w, day) ?? { months: 2, source: "default" as const };
    const name = sale ?? names.get(isin);
    rows.push({
      isin,
      symbol: name?.symbol ?? "",
      description: name?.description ?? "",
      months: resolved.months,
      source: resolved.source,
      autoMonths: auto?.months ?? 2,
      listingExchanges: [...(w?.listings ?? [])],
      ...(auto?.openDecision ? { openDecision: auto.openDecision } : {}),
    });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.isin.localeCompare(b.isin));
}
