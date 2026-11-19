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
 *     It gives 1 year only when EVERY IBKR code of the ISIN in force on the
 *     sale day is a market that is neither an EEA regulated market nor named
 *     in an equivalence decision on that day. Any other code, or a misspelt
 *     one, gets no vote, so a second listing anywhere keeps 2 months. A code
 *     stops being in force only when a later row of the SAME contract (conid),
 *     dated on or before the sale day, names another code (`listingsOn`).
 *  3. Otherwise today's heuristic in `wash-sale.ts`: 2 months with an ISIN,
 *     12 without one.
 * Crypto is letter e (#457) and never reaches this module.
 */

import type { SecurityInfo, Trade } from "../types/ibkr.js";
import type { AntichurningSecurity, FifoDisposal } from "../types/tax.js";
import { normalizeDate } from "./dates.js";

/** The shape of an ISIN: 2 letters, 9 alphanumerics, 1 check digit. */
export const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * True when `isin` has the ISIN shape and its check digit is right (ISO 6166:
 * letters become 10-35, then the Luhn test over every digit). For values a
 * person types (the CLI flags); parsers and stored values only check the shape.
 */
export function isValidIsin(isin: string): boolean {
  if (!ISIN_SHAPE.test(isin)) return false;
  const digits = isin.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

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

/** One IBKR listing code seen on a row of an ISIN. */
export interface ListingVote {
  code: string;
  /** IBKR contract id. Without it the vote is never replaced: it counts on every day. */
  conid?: string;
  /** YYYY-MM-DD: the trade day, or the last day of the statement a SecurityInfo row came from. */
  date?: string;
}

/** What DeclaRenta knows about one ISIN's window. */
export interface IsinWindow {
  /** The user's value, when set. */
  user?: WindowMonths;
  /** Every IBKR listing code of the ISIN, sorted and unique. */
  listings: readonly string[];
  /** The rows behind `listings`, with contract and date. Absent: every code counts on every day. */
  votes?: readonly ListingVote[];
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
 * Financial Instrument Information rows, each with its contract (conid) and
 * date, and the user's values. Rows without an ISIN, without a code, or of a
 * category with no anti-churning rule (and crypto) give no code. A merged
 * order whose fills named different codes votes for each (`listingExchanges`).
 */
export function collectIsinWindows(
  trades: readonly Trade[],
  securitiesInfo: readonly SecurityInfo[] = [],
  overrides?: unknown,
): Map<string, IsinWindow> {
  const votes = new Map<string, Map<string, ListingVote>>();
  const vote = (isin: string, assetCategory: string, code: string | undefined, conid: string | undefined, date: string | undefined): void => {
    if (!isin || !code || NO_LISTING_VOTE.has(assetCategory)) return;
    const day = date ? normalizeDate(date.trim()).slice(0, 10) : undefined;
    let byKey = votes.get(isin);
    if (!byKey) {
      byKey = new Map();
      votes.set(isin, byKey);
    }
    byKey.set(`${code}\u0000${conid ?? ""}\u0000${day ?? ""}`, { code, ...(conid ? { conid } : {}), ...(day ? { date: day } : {}) });
  };
  for (const t of trades) {
    for (const code of t.listingExchanges ?? [t.listingExchange]) vote(t.isin, t.assetCategory, code, t.conid, t.tradeDate);
  }
  for (const s of securitiesInfo) vote(s.isin, s.assetCategory, s.listingExchange, s.conid, s.asOf);

  const out = new Map<string, IsinWindow>();
  for (const [isin, byKey] of votes) {
    const list = [...byKey.values()];
    out.set(isin, { listings: [...new Set(list.map((v) => v.code))].sort(), votes: list });
  }
  for (const [isin, months] of coerceWindowOverrides(overrides)) {
    const w = out.get(isin);
    out.set(isin, { listings: w?.listings ?? [], ...(w?.votes ? { votes: w.votes } : {}), user: months });
  }
  return out;
}

/**
 * The IBKR codes of an ISIN in force on a sale day (YYYY-MM-DD). IBKR's
 * `listingExchange` is the contract's primary listing, so when a later row of
 * the same contract names another code, the listing changed (a share that
 * left NYSE for OTC Markets shows NYSE, then PINK). A code drops out on the
 * sale day only when every row of that contract naming it is older than the
 * contract's latest row on or before that day. Everything else counts: rows
 * of another contract (a second line of the same ISIN is a second listing),
 * rows with no conid or no date, and codes first seen after the sale day
 * (DeclaRenta cannot tell when that listing started).
 */
export function listingsOn(w: IsinWindow, day: string): string[] {
  if (!w.votes) return [...w.listings];
  const latest = new Map<string, string>();
  const lastOfCode = new Map<string, string>();
  for (const v of w.votes) {
    if (!v.conid || !v.date) continue;
    if (v.date <= day && v.date > (latest.get(v.conid) ?? "")) latest.set(v.conid, v.date);
    const key = `${v.conid}\u0000${v.code}`;
    if (v.date > (lastOfCode.get(key) ?? "")) lastOfCode.set(key, v.date);
  }
  const codes = new Set<string>();
  for (const v of w.votes) {
    const newest = v.conid && v.date ? latest.get(v.conid) : undefined;
    if (newest !== undefined && lastOfCode.get(`${v.conid}\u0000${v.code}`)! < newest) continue;
    codes.add(v.code);
  }
  return [...codes].sort();
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
 *  - 12 from IBKR only when every code in force on that day (`listingsOn`) is
 *    a letter-g market on that day.
 *  - 2 from IBKR, flagged open, when every code is a letter-g market or an
 *    EMIR-only market and at least one is EMIR-only: the 2 months then rest on
 *    an equivalence decision no consulta has applied to shares.
 */
export function resolveIsinWindow(w: IsinWindow | undefined, day: string): ResolvedWindow | undefined {
  if (!w) return undefined;
  if (w.user !== undefined) return { months: w.user, source: "user" };
  const listings = listingsOn(w, day);
  if (listings.length === 0) return undefined;
  if (listings.every((code) => nonEquivalentOn(code, day))) return { months: 12, source: "ibkr" };
  const open = listings.filter((code) => Object.hasOwn(OPEN_EQUIVALENT_LISTINGS, code));
  if (open.length > 0 && listings.every((code) => open.includes(code) || nonEquivalentOn(code, day))) {
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
 * back to 2 months). Every sale day of the year is read, so a 1-year sale
 * before a 2-month one (SIX on 01/11/2017, then inside its equivalence on
 * 27/12/2017) keeps the row. A gain sale with nothing to release and a
 * 2-month reading on every sale day is not listed, open decision or not: no
 * window changes its result. Each condition holds whatever window the user
 * picks (a toggle that removes a release adds a user value), so a change of
 * the window never removes a row. The row describes one day: the last sale day
 * with an IBKR 1-year reading, else the last sale day, else 31 December; its
 * `listingExchanges` are the codes in force on that day.
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
  const sold = new Map<string, { symbol: string; description: string; days: Set<string>; relevant: boolean }>();
  for (const d of yearDisposals) {
    if (!d.isin || NO_LISTING_VOTE.has(d.assetCategory) || d.quantity.isZero()) continue;
    const day = normalizeDate(d.sellDate.trim()).slice(0, 10);
    const relevant = d.gainLossEur.isNegative() || d.reintegratedLossEur.greaterThan(0);
    const prev = sold.get(d.isin);
    if (!prev) sold.set(d.isin, { symbol: d.symbol, description: d.description, days: new Set([day]), relevant });
    else {
      prev.days.add(day);
      prev.relevant ||= relevant;
    }
  }
  const isins = new Set(sold.keys());
  for (const [isin, w] of windows) if (w.user !== undefined) isins.add(isin);

  const rows: AntichurningSecurity[] = [];
  for (const isin of isins) {
    const sale = sold.get(isin);
    const w = windows.get(isin);
    // The automatic reading, without the user's value.
    const ibkr: IsinWindow | undefined = w ? { listings: w.listings, ...(w.votes ? { votes: w.votes } : {}) } : undefined;
    const days = [...(sale?.days ?? [])].sort();
    const oneYearDay = days.filter((d) => resolveIsinWindow(ibkr, d)?.months === 12).at(-1);
    if (!sale?.relevant && w?.user === undefined && oneYearDay === undefined) continue;
    const day = oneYearDay ?? days.at(-1) ?? `${year}-12-31`;
    const auto = resolveIsinWindow(ibkr, day);
    const resolved = resolveIsinWindow(w, day) ?? { months: 2, source: "default" as const };
    const name = sale ?? names.get(isin);
    rows.push({
      isin,
      symbol: name?.symbol ?? "",
      description: name?.description ?? "",
      months: resolved.months,
      source: resolved.source,
      autoMonths: auto?.months ?? 2,
      listingExchanges: w ? listingsOn(w, day) : [],
      ...(auto?.openDecision ? { openDecision: auto.openDecision } : {}),
    });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.isin.localeCompare(b.isin));
}
