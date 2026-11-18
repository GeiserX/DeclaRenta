/**
 * The overdraft generator of issue #449: seeded cycles of buys that may
 * overdraw the account, sales on later days and conversions, every share
 * sold and every dollar converted by the end.
 */
import type { Ev, Scenario } from "./fx-traditional-harness.js";

/** USD commission of the `worthless` sale (see {@link gen}). */
export const WORTHLESS_COMMISSION = 5;
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
function day(n: number): string {
  const t = new Date("2024-09-02T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * The issue's generator, as described: buys may overdraw the account, sales
 * come on a later day, one event per day (no same-day trades), no loss
 * sales; sometimes a held sale between an overdrawing buy and its funding.
 * `overdraft=false` funds every buy the day before instead (control).
 * `sameDay` also sells part of the position, or all of it, on the day of an
 * overdrawing buy, at no loss (the review's MIN1 shape: the default lost
 * `x × (r_loan − cost)` when that sale's currency repaid the loan).
 * `more.twice` sells the rest of that position, or part of it, a second time
 * that day (a loan the first sale already repaid, PR #456 review); and
 * `more.worthless` ends the cycle with a share bought for 10 USD and sold for
 * 0 with a 5 USD commission (proceeds −5): the caller writes the commission
 * into the XML (`WORTHLESS_COMMISSION`) and the CashReport's ending. Neither
 * draws a random number unless it is on, so the other seeds do not move.
 */
export function gen(seed: number, overdraft: boolean, sameDay = false, more: { twice?: boolean; worthless?: boolean } = {}): Scenario {
  const rand = rng(seed);
  const ri = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const rate = () => (0.8 + ri(0, 40) / 100).toFixed(2);
  const syms = ["AAA", "BBB", "CCC"];
  const held: Record<string, { q: number; px: number }[]> = { AAA: [], BBB: [], CCC: [] };
  const ev: Ev[] = [];
  let usd = 0;
  let d = 0;
  const maxPx = (s: string) => Math.max(0, ...held[s]!.map((l) => l.px));
  const qty = (s: string) => held[s]!.reduce((a, l) => a + l.q, 0);
  const sell = (s: string, all: boolean, r = rate()) => {
    const q = all ? qty(s) : ri(1, qty(s));
    const px = maxPx(s) + ri(0, 25); // never a loss
    ev.push({ k: "sell", d: day(d), sym: s, qty: String(q), px: String(px), r });
    usd += q * px;
    let left = q;
    while (left > 0) {
      const l = held[s]![0]!;
      const t = Math.min(left, l.q);
      l.q -= t;
      left -= t;
      if (l.q === 0) held[s]!.shift();
    }
  };
  for (let i = 0; i < 12; i++) {
    d += ri(1, 6);
    const x = rand();
    const sym = syms[ri(0, 2)]!;
    if (x < 0.4) {
      const q = ri(3, 12);
      const px = ri(40, 120);
      const cost = q * px;
      if (!overdraft && usd < cost) {
        ev.push({ k: "fund", d: day(d), usd: String(cost - usd), r: rate() });
        usd = cost;
        d += 1;
      }
      const r = rate();
      ev.push({ k: "buy", d: day(d), sym, qty: String(q), px: String(px), r });
      held[sym]!.push({ q, px });
      const deficit = cost - usd;
      usd -= cost;
      // Same day, same rate: part of the position, or all of it, sold at no loss.
      if (sameDay && deficit > 0 && rand() < 0.5) {
        sell(sym, rand() < 0.3, r);
        if (more.twice && qty(sym) > 0 && rand() < 0.7) sell(sym, rand() < 0.5, r);
      }
      if (overdraft && deficit > 0) {
        const others = syms.filter((s) => s !== sym && qty(s) > 0);
        if (others.length > 0 && rand() < 0.6) {
          d += ri(1, 3);
          sell(others[ri(0, others.length - 1)]!, rand() < 0.5);
        }
        d += ri(1, 12);
        ev.push({ k: "fund", d: day(d), usd: String(deficit), r: rate() });
        usd += deficit;
      }
    } else if (x < 0.65 && qty(sym) > 0) {
      sell(sym, rand() < 0.5);
    } else if (x < 0.8 && usd > 50) {
      const amt = ri(1, Math.floor(usd));
      ev.push({ k: "conv", d: day(d), usd: String(amt), r: rate() });
      usd -= amt;
    } else if (x < 0.9) {
      const amt = ri(100, 1500);
      ev.push({ k: "fund", d: day(d), usd: String(amt), r: rate() });
      usd += amt;
    }
  }
  for (const s of syms) {
    if (qty(s) > 0) {
      d += ri(1, 4);
      sell(s, true);
    }
  }
  if (more.worthless) {
    d += 1;
    ev.push({ k: "buy", d: day(d), sym: "AAA", qty: "1", px: "10", r: rate() });
    d += 1;
    ev.push({ k: "sell", d: day(d), sym: "AAA", qty: "1", px: "0", r: rate() });
    usd -= 10 + WORTHLESS_COMMISSION;
  }
  d += 2;
  if (usd < 0) {
    ev.push({ k: "fund", d: day(d), usd: String(-usd), r: rate() });
    usd = 0;
    d += 1;
  }
  if (usd > 0) ev.push({ k: "conv", d: day(d), usd: String(usd), r: rate() });
  const out = [...ev].sort((a, b) => a.d.localeCompare(b.d));
  return { id: `X${seed}${overdraft ? "" : "-nod"}${sameDay ? "-sd" : ""}${more.twice ? "-2x" : ""}${more.worthless ? "-w" : ""}`, years: [...new Set(out.map((e) => Number(e.d.slice(0, 4))))].sort(), closed: true, ev: out };
}

