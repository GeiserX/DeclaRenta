/**
 * FX FIFO engine — tracks foreign-currency holdings as patrimonial elements
 * (Art. 33.1 LIRPF: gain/loss = valor de transmisión − valor de adquisición of
 * the divisa; NOT Art. 37.1.l, which governs "incorporaciones que no derivan de
 * una transmisión" — an unrelated rule). DGT V2422-20 / V1613-25 / V0463-21:
 * the FX gain crystallizes only on the effective conversion to euros (cobro/pago,
 * Art. 14.2.e).
 *
 * Each EUR→FCY conversion creates a lot; each FCY disposal (conversion
 * back to EUR, or spending FCY on stock purchases) consumes lots via FIFO.
 * Dividend/interest withholding is a pago a cuenta, NOT a disposal — see
 * extractCashFxEvents (issue #225).
 */

import Decimal from "decimal.js";
import type {
  FxLot,
  FxDisposal,
  FxShift,
  FxTrigger,
  FifoDisposal,
  TaxMessage,
  FxTraceEvent,
  FxTraceKind,
} from "../types/tax.js";
import type { ManualOpeningLot } from "../types/tax.js";
import type { Trade, CashTransaction } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate, isEcbResolvable, lookupRateInMap } from "./ecb.js";
import { daysBetween, normalizeDate } from "./dates.js";

/**
 * One foreign-currency event fed to {@link FxFifoEngine.processEvents}.
 *
 * ENCODING (three shapes share this one interface, discriminated by `kind`):
 *
 *  1. ACQUIRE/DISPOSE (the original shape; `kind` absent). Signed `quantity`
 *     drives it: positive = acquiring FCY (EUR→FCY conversion, dividend, interest
 *     received) → a pool lot; negative = disposing FCY (FCY→EUR conversion, fee,
 *     interest paid) → consume the pool FIFO and realize an FX gain (emits a
 *     FxDisposal). `commissionEur` adjusts the EUR cost/proceeds. UNCHANGED — all
 *     existing producers (extractFxEvents, extractCashFxEvents) still emit this.
 *
 *  2. STOCK_BUY (`kind: "stock_buy"`). The divisa-side of a foreign-currency
 *     stock PURCHASE: it spends `costFcy` of foreign currency. It silently
 *     CONSUMES that `costFcy` from the per-currency pool FIFO and PARKS the
 *     carried basis under its `positionKey` (any shortfall parks "uncovered").
 *     It realizes NO gain and emits NO disposal. `quantity` is unused (set to
 *     0) — the amount spent is `costFcy`.
 *
 *  3. STOCK_SELL (`kind: "stock_sell"`). The divisa-side of a foreign-currency
 *     stock SALE: it received `proceedsFcy`, of which `costFcy` is the principal
 *     that had been parked at the matching buy UNDER THE SAME `positionKey`. It
 *     re-adds that position's carried principal (up to the proceeds) plus the
 *     profit at the sale rate. It emits NO disposal — the FX gain defers to the
 *     eventual EUR conversion. `quantity` is unused.
 *
 * Buys/sells never appear as a signed `quantity`, so the existing positive/
 * negative routing in processEvents is untouched by them — they are dispatched
 * solely on `kind`. See the carry-basis-defer doc on processEvents.
 */
export interface FxEvent {
  date: string;
  currency: string;
  /**
   * For acquire/dispose events (kind absent): Positive = acquiring FCY (EUR→FCY),
   * Negative = disposing FCY (FCY→EUR or FCY spent). For stock_buy/stock_sell the
   * spent/received amounts live in costFcy/proceedsFcy and this is unused (0).
   */
  quantity: Decimal;
  /** EUR rate at event time (EUR per 1 FCY) */
  ecbRate: Decimal;
  trigger: FxTrigger;
  /** Commission in EUR (positive = cost paid). Increases cost basis on BUY, reduces proceeds on SELL. */
  commissionEur?: Decimal;
  /** Real EUR value applied to this conversion (spread-laden), BEFORE commission. When present, the effective rate realEurAmount/|quantity| is used instead of ecbRate (issue #253). */
  realEurAmount?: Decimal;
  brokerSource?: string;
  /**
   * Discriminator for the carry-basis stock events. Absent → a plain
   * acquire/dispose driven by signed `quantity` (the original behavior).
   */
  kind?: "stock_buy" | "stock_sell";
  /**
   * Stock buy/sell: the foreign-currency PRINCIPAL of the position. On a buy it
   * is the FCY cash outflow consumed from the pool and parked; on a sell it is
   * the parked principal pulled back and re-added (the part of the proceeds that
   * is "the same dollars" returning, not new profit).
   */
  costFcy?: Decimal;
  /** Stock sell only: the total FCY received (principal + profit). */
  proceedsFcy?: Decimal;
  /**
   * Explicit carry-basis for synthetic/manual stock-buy events. When present,
   * parkPrincipal bypasses pool consumption and parks the whole cost as a
   * covered slice at this EUR-per-FCY basis and acquisition date.
   */
  coveredCostPerUnit?: Decimal;
  coveredAcquireDate?: string;
  /**
   * Stock buy/sell ONLY: the stable identity of the position whose principal is
   * being parked (buy) or unparked (sell). Both producers derive it IDENTICALLY
   * — `isin || symbol`, mirroring fifo.ts `lotKey` for the STK/FUND/BOND case
   * these events cover — so a SELL only ever reclaims the principal ITS OWN
   * position parked. This makes the parked FIFO per-(currency, position), not
   * per-currency: an option-exercise/assignment STK disposal (fifo.ts emits these
   * with `assetCategory:"STK"` and the underlying's isin/symbol but NO backing BUY
   * trade) finds no parked principal under its key and cleanly degrades to the
   * "unmatched sell → re-add at sale rate" path, instead of wrongly draining a
   * DIFFERENT same-currency position's parked basis. Absent for acquire/dispose.
   */
  positionKey?: string;
  /**
   * «Tradicional con divisa» stock sell only: the release of the principal of
   * shares bought in this currency and sold in ANOTHER one (see
   * {@link FxFifoEngine.extractStockProceedsFxEvents}). Nothing comes back in
   * this currency; each covered slice books its drift up to the share
   * purchase as a `stock_sale_cross` row.
   */
  crossCurrency?: true;
}

/**
 * One slice of principal parked inside an open foreign-stock position. The
 * first four fields are the default method's; the rest are written ONLY under
 * «Tradicional con divisa» (issue #434), so default and monodivisa parked state
 * stays deep-equal to what it was before the mode existed.
 */
export interface ParkedSlice {
  q: Decimal;
  rate: Decimal | null;
  acquireDate: string | null;
  brokerSource?: string;
  /** ECB rate of the stock buy's trade date (`r_b`), the rate of its 0331 cost. */
  buyRate?: Decimal;
  /** Shifts carried by the pool lot this slice came from. */
  shifts?: FxShift[];
  /** Trade date of the stock buy that parked this slice (same-day cover). */
  parkDate?: string;
}

/** Per-year in-flight shift total of one currency (`fx_traditional_inflight`). */
export interface TraditionalInflight {
  qty: Decimal;
  amount: Decimal;
  years: Set<number>;
}

/** Parked principal of one position at the report's year end (`fx_traditional_orphan`). */
export interface TraditionalParkedAtYearEnd {
  currency: string;
  positionKey: string;
  /** Covered parked quantity (slices with a tracked EUR cost). */
  qty: Decimal;
  /** Σ q × (r_b − r_lot) of those slices: drift no sale has declared yet. */
  undeclaredEur: Decimal;
}

/** What «Tradicional con divisa» saw during one run, for the report messages. */
export interface TraditionalFxStats {
  /** One entry per losing sale that booked at least one lost-dollar row. */
  lostDollarSales: { date: string; currency: string }[];
  /** One entry per sale that booked at least one negative-cost guard row. */
  guardSales: { date: string; currency: string }[];
  /** Untracked (`null`) principal re-added at a sale, one entry per sale. */
  uncovered: { date: string; currency: string; qty: Decimal }[];
  /** `${year}|${currency}` → shifts of earlier years consumed by that year's disposals. */
  inflight: Map<string, TraditionalInflight>;
  /** Parked principal per position at the checkpoint date (the declared year end). */
  parkedAtCheckpoint: TraditionalParkedAtYearEnd[];
}

/** «Tradicional con divisa»: a stock buy's principal parked with no tracked origin. */
interface NullPark {
  event: FxEvent;
  currency: string;
  date: string;
  /** Untracked quantity, net of same-day covers. */
  qty: Decimal;
  /** Untracked quantity when the buy ran (before same-day covers). */
  gross: Decimal;
  /** Order the buy parked in, within the pass (same-day covers go oldest first). */
  seq: number;
}

/** «Tradicional con divisa»: the late covers of one pass (see `processTraditional`). */
interface CoverPass {
  /** Buys that take every acquisition of their window they need. */
  enabled: Set<FxEvent>;
  /** Acquisitions per currency, oldest first, the late-cover candidates. */
  byCcy: Map<string, FxEvent[]>;
  /** What each acquisition a cover took part of keeps for its own date. */
  left: Map<FxEvent, Decimal>;
  /**
   * A trial: the buys it adds, each buy's gross `null` in the accepted pass,
   * and `fails(date)`, asked before the first event of each date, true once
   * the trial has certainly failed (the pass then stops). A `bounded` trial's
   * chain takes in no buy past its horizon.
   */
  trial?: { pick: Set<FxEvent>; refGross: Map<FxEvent, Decimal>; fails: (date: string) => boolean; bounded: boolean };
  /** Buys of the trial that lost dollars and took their own late cover. */
  joined: Set<FxEvent>;
  /**
   * Latest year the trial changes: its buys' year and the dates of what they
   * took, counting only buys up to the horizon (a later buy that lost its
   * dollars is a cover of its own year).
   */
  horizon: string;
  /** The trial failed before the last event: the pass stopped there. */
  stopped: boolean;
}

export class FxFifoEngine {
  /**
   * «Tradicional con divisa» (issue #434, `ReportOptions.traditionalFx`). Off by
   * default: `new FxFifoEngine()` behaves exactly as before the mode existed.
   * Every line it gates is a no-op for the default method and monodivisa.
   */
  private readonly traditionalFx: boolean;

  constructor(options?: { traditionalFx?: boolean }) {
    this.traditionalFx = options?.traditionalFx === true;
  }

  private lots: Map<string, FxLot[]> = new Map();
  private disposals: FxDisposal[] = [];
  private nextLotId = 1;
  warnings: string[] = [];
  /** Structured messages with severity, hint, and context */
  messages: TaxMessage[] = [];

  private emit(msg: TaxMessage): void {
    this.messages.push(msg);
    this.warnings.push(msg.message);
  }

  private fxMissing: Map<string, { count: number; totalQty: Decimal }> = new Map();

  /**
   * ALWAYS-ON per-currency conservation accumulators (issue #230 follow-up — the
   * "no se silencien operaciones sin respaldo económico" self-check). NOT gated
   * behind tracing: this diagnostic must run on EVERY report (it is cheap — plain
   * Decimal adds, no allocation per event beyond one Map entry per currency seen).
   *
   * One running total per movement kind that mutates the spendable pool or the
   * parked FIFO, incremented at the SAME sites that call {@link record} (via the
   * {@link accumulate} helper, called right next to each record so the two can
   * never desync). Used at the end of {@link processEvents} to verify the FX
   * bookkeeping balances — see {@link checkConservation}.
   *
   * `phantom` is the reconciling term for FCY that legitimately enters the books
   * with NO real pool acquisition behind it (missing-lot floored disposals, an
   * uncovered park against an empty pool, and an unmatched-sell re-add). Such FCY
   * was never `acquired`, yet a floored dispose REDUCES lhs / an uncovered park or
   * unmatched re-add appears on the rhs without a matching acquire — so we count an
   * implicit "phantom acquire" of exactly that quantity to keep the identity
   * balanced for these documented-legitimate paths. See {@link checkConservation}
   * for the full algebra and why this is the correct (non-false-positive) form.
   */
  private accAcquired: Map<string, Decimal> = new Map();
  private accDisposed: Map<string, Decimal> = new Map();
  private accParked: Map<string, Decimal> = new Map();
  private accUnparked: Map<string, Decimal> = new Map();
  private accDiscarded: Map<string, Decimal> = new Map();
  private accProfit: Map<string, Decimal> = new Map();
  private accPhantom: Map<string, Decimal> = new Map();
  /** Every currency seen by any accumulator — drives the end-of-run check loop. */
  private accCurrencies: Set<string> = new Set();

  /**
   * Add `qty` to the per-currency running total for one conservation movement
   * kind. Called right next to each {@link record} call (and at the three
   * "phantom acquire" reconciling sites) so the accumulators stay in lockstep with
   * the trace and can never silently drift apart. Pure Decimal add + Map upsert —
   * no per-event allocation beyond the first Map entry per currency.
   */
  private accumulate(
    kind: "acquire" | "dispose" | "park" | "unpark" | "discard" | "profit" | "phantom",
    currency: string,
    qty: Decimal,
  ): void {
    const map =
      kind === "acquire"
        ? this.accAcquired
        : kind === "dispose"
          ? this.accDisposed
          : kind === "park"
            ? this.accParked
            : kind === "unpark"
              ? this.accUnparked
              : kind === "discard"
                ? this.accDiscarded
                : kind === "profit"
                  ? this.accProfit
                  : this.accPhantom;
    map.set(currency, (map.get(currency) ?? new Decimal(0)).plus(qty));
    this.accCurrencies.add(currency);
  }

  /**
   * Opt-in movement trace (audit/diagnostic only — issue #230 follow-up). OFF by
   * default and ZERO-COST when off: every `record()` call returns immediately
   * unless `traceEnabled` is set via {@link enableTrace}. When on, each pool/park
   * movement appends an {@link FxTraceEvent} so a developer/advisor can verify how
   * a 1633/1637 figure was built. Never surfaced in the standard UI.
   */
  private traceEnabled = false;
  private trace: FxTraceEvent[] = [];
  private traceSeq = 0;

  /** Enable the movement trace (see {@link getTrace}). Call before processEvents. */
  enableTrace(): void {
    this.traceEnabled = true;
  }

  /** The recorded FX-FIFO movement trace (empty unless {@link enableTrace} was called). */
  getTrace(): FxTraceEvent[] {
    return this.trace;
  }

  /** Sum the FCY quantity remaining in the spendable pool for a currency. */
  private poolBalance(currency: string): Decimal {
    const lots = this.lots.get(currency);
    if (!lots) return new Decimal(0);
    return lots.reduce((s, l) => s.plus(l.quantity), new Decimal(0));
  }

  /** Sum the FCY quantity remaining in a (currency, position) parked queue. */
  private parkedBalance(currency: string, positionKey: string | undefined): Decimal {
    const park = this.parked.get(FxFifoEngine.parkKey(currency, positionKey));
    if (!park) return new Decimal(0);
    return park.reduce((s, p) => s.plus(p.q), new Decimal(0));
  }

  /**
   * Append one movement to the trace (no-op unless tracing is enabled). Captures
   * the running pool/parked balances AFTER the caller has applied the movement,
   * so the trace reads as a chronological ledger. All monetary values are stored
   * as decimal strings (the {@link FxTraceEvent} contract).
   */
  private record(
    kind: FxTraceKind,
    event: FxEvent,
    fields: {
      quantityFcy: Decimal;
      rate: Decimal | null;
      costBasisEur?: Decimal;
      proceedsEur?: Decimal;
      gainLossEur?: Decimal;
      lotId?: string;
      lotAcquireDate?: string;
      note?: string;
    },
  ): void {
    if (!this.traceEnabled) return;
    this.trace.push({
      seq: ++this.traceSeq,
      date: event.date,
      kind,
      currency: event.currency,
      trigger: event.trigger,
      quantityFcy: fields.quantityFcy.toString(),
      rate: fields.rate === null ? null : fields.rate.toString(),
      ...(fields.costBasisEur !== undefined ? { costBasisEur: fields.costBasisEur.toString() } : {}),
      ...(fields.proceedsEur !== undefined ? { proceedsEur: fields.proceedsEur.toString() } : {}),
      ...(fields.gainLossEur !== undefined ? { gainLossEur: fields.gainLossEur.toString() } : {}),
      poolBalanceFcy: this.poolBalance(event.currency).toString(),
      parkedBalanceFcy: this.parkedBalance(event.currency, event.positionKey).toString(),
      ...(event.positionKey !== undefined ? { positionKey: event.positionKey } : {}),
      ...(fields.lotId !== undefined ? { lotId: fields.lotId } : {}),
      ...(fields.lotAcquireDate !== undefined ? { lotAcquireDate: fields.lotAcquireDate } : {}),
      ...(fields.note !== undefined ? { note: fields.note } : {}),
      ...(event.brokerSource !== undefined ? { brokerSource: event.brokerSource } : {}),
    });
  }

  /**
   * PARKED FIFO per (currency, position) — the foreign-currency PRINCIPAL
   * currently locked inside OPEN foreign-stock positions, carrying its EUR
   * acquisition basis.
   *
   * KEYED PER POSITION, NOT PER CURRENCY (the carry-basis review fix). The map
   * key is the composite `${currency}|${positionKey}` ({@link parkKey}), where
   * `positionKey` is the stock's identity (`isin || symbol` — see
   * {@link positionKey}, mirroring fifo.ts `lotKey`). The BUY producer
   * ({@link FxFifoEngine.extractStockPurchaseFxEvents}) and the SELL producer
   * ({@link FxFifoEngine.extractStockProceedsFxEvents}) derive the SAME
   * `positionKey` for the same position, so a SELL only ever reclaims the
   * principal ITS OWN position parked. WHY this matters: option exercises and
   * assignments emit `assetCategory:"STK"` disposals (fifo.ts) with the
   * underlying's isin/symbol but NO backing BUY trade — with per-CURRENCY keying
   * such a sell could unpark, and mis-rate, a DIFFERENT same-currency position's
   * parked basis. Per-position keying confines each unpark to its own queue; an
   * option-delivered-share sale finds nothing parked under its key and cleanly
   * degrades to the "unmatched sell → re-add at sale rate" path (the
   * funding-absent no-op). For every SINGLE-position scenario per-position keying
   * is identical to per-currency, so the validated invariants (S1/S2/S6/S8 and
   * the A* no-ops) are unchanged — the fix only bites multi-position-same-currency
   * cases.
   *
   * NOTE the SPENDABLE pool (`this.lots`) stays PER CURRENCY — FCY is fungible
   * for SPENDING, so a buy still consumes the shared currency pool oldest-first;
   * it merely PARKS the carried basis under its position key so the matching
   * sell reclaims its own principal.
   *
   * A `rate` of `null` is an "uncovered" parking: the FCY the buy spent had no
   * tracked acquisition lot (funding outside the data window — AFx settlement, a
   * single-year export), so there is no basis to carry; a later sell re-adds that
   * portion at the SALE rate, which is exactly what reproduces the pre-#230
   * full-proceeds behavior (the funding-absent no-op safety property).
   *
   * Transient, like `fxMissing`: cleared at the start of every processEvents run.
   * Whatever stays parked at the end is principal in positions still open at the
   * period boundary — correctly never converted, never taxed.
   *
   * Each parked slice also carries `acquireDate` — the ORIGINAL acquisition date
   * of the pool lot the buy consumed (`null` for an uncovered slice, which has no
   * tracked origin). The matching SELL re-adds the principal to the pool stamped
   * with THIS date (not the sale date), so the spendable pool stays FIFO-ordered
   * by genuine acquisition date and a later conversion consumes the truly-oldest
   * dollars first (issue #230; DGT V0282-22: the returned principal keeps its
   * original acquisition date — only the trading PROFIT is newly-acquired at the
   * sale rate/date). The carried EUR basis is `rate`; the carried date is
   * `acquireDate` — both travel with the principal across the round-trip.
   */
  private parked: Map<string, ParkedSlice[]> = new Map();

  /** «Tradicional con divisa» run state (see {@link getTraditionalStats}). */
  private tradStats: TraditionalFxStats = {
    lostDollarSales: [],
    guardSales: [],
    uncovered: [],
    inflight: new Map(),
    parkedAtCheckpoint: [],
  };
  /** «Tradicional con divisa»: every `null` park of the current pass, net of same-day covers. */
  private nullParks: NullPark[] = [];
  /** «Tradicional con divisa»: the `null` park each untracked parked slice of the current pass belongs to. */
  private nullOfSlice: Map<ParkedSlice, NullPark> = new Map();
  /** «Tradicional con divisa»: every disposal shortfall of the current pass (missing lots). */
  private shortfalls: { currency: string; date: string; qty: Decimal }[] = [];
  /** «Tradicional con divisa»: late-cover parts of an acquisition → that acquisition's own date. */
  private movedFrom: Map<FxEvent, string> = new Map();
  /** «Tradicional con divisa»: same-day covers run only for these `currency|date` keys. */
  private sameDayOn: Set<string> = new Set();
  /** «Tradicional con divisa»: the late covers of the current pass. */
  private cover: CoverPass | undefined;

  /**
   * Stable identity of a foreign-stock POSITION for the parked FIFO. `isin ||
   * symbol`, mirroring fifo.ts `lotKey` for the STK/FUND/BOND case the carry-basis
   * stock events cover (those producers already exclude CRYPTO/OPT/FOP, so the
   * conid/CRYPTO branches of `lotKey` are out of scope here). Both the BUY and the
   * SELL producer call this so the same position yields the same key on both
   * sides — the load-bearing requirement for a sell to reclaim only its own
   * parked principal.
   */
  private static positionKey(ref: { isin: string; symbol: string }): string {
    return ref.isin || ref.symbol;
  }

  /**
   * Composite key for the parked FIFO. With a positionKey: `${currency}|${positionKey}`
   * — the per-position queue. WITHOUT one: the BARE currency (`${currency}`,
   * unchanged from the old per-currency keying). The bare-currency fallback is
   * deliberate and load-bearing in two ways:
   *   1. Every PRODUCTION stock_buy/stock_sell sets positionKey, so real data
   *      always partitions per position.
   *   2. A buy and a sell that BOTH omit positionKey collapse to the SAME bare
   *      `${currency}` queue, so they still park/unpark against each other — this
   *      is exactly the old per-currency behavior, which is what the
   *      reference/unit harnesses (no positionKey) exercise. Falling back to the
   *      bare currency (not `${currency}|`) also keeps `getParked().get(currency)`
   *      working for those harnesses.
   * For a given run the two forms never collide: a position's isin/symbol is
   * non-empty, so `${currency}|${positionKey}` is always distinct from `${currency}`.
   */
  private static parkKey(currency: string, positionKey: string | undefined): string {
    return positionKey ? `${currency}|${positionKey}` : currency;
  }

  /**
   * Event order of every method that runs the FX engine (rule R0: issue #434
   * for «Tradicional con divisa», issue #437 for the default). Every producer
   * dates its events on the TRADE date. Order: date, then on one date
   *   (0) pool ACQUISITIONS (conversion-in, dividend, interest received): the
   *       currency is in the pool before a buy spends it;
   *   (1) STOCK LEGS, in {@link orderSameDayStockLegs} order;
   *   (3) DISPOSALS (conversion-out, fee, interest paid): a same-day conversion
   *       sees what a sale returned.
   * Stable otherwise. With no stock events only phases 0 and 3 occur, which is
   * the original "acquisitions before disposals" sort.
   */
  private static sortEvents(events: FxEvent[]): FxEvent[] {
    const phase = (e: FxEvent): number => (e.kind ? 1 : e.quantity.greaterThan(0) ? 0 : 3);
    const out = [...events].sort((a, b) => a.date.localeCompare(b.date) || phase(a) - phase(b));
    let i = 0;
    while (i < out.length) {
      if (phase(out[i]!) !== 1) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < out.length && phase(out[j]!) === 1 && out[j]!.date === out[i]!.date) j++;
      if (j - i > 1) out.splice(i, j - i, ...FxFifoEngine.orderSameDayStockLegs(out.slice(i, j)));
      i = j;
    }
    return out;
  }

  /**
   * Same-day stock legs (critic G1 for «Tradicional con divisa», issue #437 for
   * the default; a trap: a same-day rotation, sell A and buy B, booked +175 on
   * 400 in that mode when the buy ran first and parked "uncovered" while A's
   * dollars stayed in the pool; in the default the same order left those
   * dollars in the pool as phantom dollars).
   * All trades of one date settle together, so the time of day never decides
   * which currency paid for what. The order is by rank:
   *  (0) a sale of a position NOT bought that day frees its currency first;
   *  (1) then each same-day round trip, one position after the other in the
   *      order the upload lists them, its buys before its sales, as the stock
   *      FIFO does, so the currency one round trip returns pays the next one;
   *  (3) then a buy of a position NOT sold that day.
   * Trade times are ignored on purpose (a trap: a timed intraday round trip
   * before the sale that funded it parked `null` and left 1000 phantom USD in
   * the pool, +52.50 on a closed cycle; the rank order is never worse).
   * The rank is computed over the whole day's legs, so the order is transitive.
   */
  private static orderSameDayStockLegs(run: FxEvent[]): FxEvent[] {
    const id = (e: FxEvent): string => `${e.currency}|${e.positionKey ?? ""}`;
    const bought = new Set(run.filter((e) => e.kind === "stock_buy").map(id));
    const sold = new Set(run.filter((e) => e.kind === "stock_sell").map(id));
    const firstSeen = new Map<string, number>();
    run.forEach((e, idx) => {
      if (!firstSeen.has(id(e))) firstSeen.set(id(e), idx);
    });
    const roundTrip = (e: FxEvent): boolean => bought.has(id(e)) && sold.has(id(e));
    const rank = (e: FxEvent): number => (roundTrip(e) ? 1 : e.kind === "stock_sell" ? 0 : 3);
    const group = (e: FxEvent): number => (roundTrip(e) ? firstSeen.get(id(e))! : 0);
    const leg = (e: FxEvent): number => (e.kind === "stock_buy" ? 0 : 1);
    return run
      .map((e, idx) => ({ e, idx }))
      .sort((a, b) => rank(a.e) - rank(b.e) || group(a.e) - group(b.e) || leg(a.e) - leg(b.e) || a.idx - b.idx)
      .map((x) => x.e);
  }

  /** Parked principal per position now (covered slices only), for the orphan detector. */
  private snapshotParked(): TraditionalParkedAtYearEnd[] {
    const out: TraditionalParkedAtYearEnd[] = [];
    for (const [key, slices] of this.parked) {
      const bar = key.indexOf("|");
      if (bar < 0) continue; // bare-currency queues come only from positionKey-less harness events
      let qty = new Decimal(0);
      let undeclaredEur = new Decimal(0);
      for (const sl of slices) {
        if (sl.rate === null || !sl.q.greaterThan(FxFifoEngine.EPS)) continue;
        qty = qty.plus(sl.q);
        undeclaredEur = undeclaredEur.plus(sl.q.mul((sl.buyRate ?? sl.rate).minus(sl.rate)));
      }
      if (qty.greaterThan(FxFifoEngine.EPS)) {
        out.push({ currency: key.slice(0, bar), positionKey: key.slice(bar + 1), qty, undeclaredEur });
      }
    }
    return out;
  }

  /**
   * Process FX events extracted from trades.
   * CASH trades with assetCategory="CASH" that represent actual forex conversions
   * (not automatic FXCONV) generate FX lots and disposals.
   *
   * Carry-basis-defer model (issue #230 follow-up). The full event set is the
   * concatenation of conversion, dividend/interest, stock-buy and stock-sell
   * producers, processed in trade-date order — see {@link sortEvents}. Only the
   * acquire/dispose (signed-quantity) events emit FxDisposals; stock buys/sells
   * move principal between the spendable pool and the parked FIFO and realize
   * nothing (the divisa gain defers to the conversion that consumes the pool).
   */
  processEvents(events: FxEvent[], options?: { checkpointDate?: string }): FxDisposal[] {
    if (!this.traditionalFx) return this.runEvents(events, options);
    return this.processTraditional(events, options);
  }

  /** Days a later EUR→currency conversion may cover an "uncovered" stock buy (critic G2). */
  static readonly LATE_COVER_DAYS = 7;

  /** Tests only: judge every late or same-day cover alone, never in batches. */
  static coversAlone = false;

  /**
   * «Tradicional con divisa» covers of an "uncovered" (`null`) stock buy.
   *
   * Late cover (critic G2, a trap: "buy first, fund later" parked the buy
   * `null`, its sale re-added it at `r_s`, and the later funding lot stayed in
   * the pool as dollars that no longer existed: −200 on an economic 80).
   * Same-day cover: the currency a sale returns covers a `null` slice parked
   * the same day (a trap: hold AAA, buy more AAA and sell the old AAA on one
   * day with an empty pool; the buy runs first, as a round trip, and parked
   * `null`).
   *
   * The result is the one the user would get had the funding arrived before
   * the buy (MG0):
   *  1. A plain pass, with no cover, records every `null` park (currency, buy
   *     date, quantity). With none, it is the result.
   *  2. A covered buy that finds the pool empty takes, oldest first, the
   *     acquisitions of that currency (conversions, dividends, interest) dated
   *     1 to {@link LATE_COVER_DAYS} calendar days after it, up to what it
   *     lacks. That part runs on the buy's date, at its own rate and with its
   *     own date as the lot's acquisition date; the rest of the acquisition
   *     stays on its date. The buy then parks it like any covered slice, even
   *     when a sale had already returned part of the principal before the
   *     funding (a trap: covering only the slice still parked left 1000
   *     phantom USD, −92.50 on a closed cycle).
   *  3. Precedence (G2, iterated): the acquisition covers the `null` buy first,
   *     even when the plain pass gave it to a later buy. A later buy left
   *     without dollars that way takes its own acquisitions 1 to 7 days after
   *     it when it runs, and so on (a trap: letting the later buy keep the
   *     funding left a monthly buy-then-fund chain at −300 on an economic
   *     −250). The events run in date order, so one pass settles the whole
   *     chain (a trap: one pass per link, capped at 25, left a weekly chain
   *     past week 25 untracked and took seconds for 300 buys).
   *  4. A cover never leaves new uncovered principal: no buy may park more
   *     `null`, and no disposal may find fewer lots, than without it, over all
   *     the data. When the buy really used dollars the upload does not show
   *     (an opening balance, spec row 17), the later acquisition is new money,
   *     and covering with it makes a later disposal find no lot (a trap: +150
   *     and a false missing-lots note), in any later year (a trap: judged only
   *     up to the end of its own years, a December cover left a conversion of
   *     the next year without a lot, −30 instead of −80, Z1). A cover's own
   *     years (its horizon) are the year of its buys and of the acquisitions
   *     they take. One exception: a cover that holds up to the end of its
   *     horizon and fails only in a later year F stays when dropping it would
   *     change the figures of a year from its horizon to F − 1, because those
   *     years were filed with it (Z2: a December sale and conversion, and a
   *     conversion of the next year that finds no lot). Year F then shows the
   *     missing-lots or untracked note. The kept cover takes its own chain
   *     only: a buy after its horizon it leaves without dollars keeps them
   *     lost, and is a cover of its own year. So a filed year never changes
   *     because of a later year's data, unless one of its covers takes an
   *     acquisition of that later year. Covers are judged one year at a time,
   *     oldest first: all the year's covers at once; when that fails, the
   *     oldest half, halving after each failure and doubling after each
   *     success, down to one cover (with the chain of buys it leaves without
   *     dollars). A batch must hold over all the data. A cover only ever takes
   *     dollars away from what comes after it, so each cover of a kept batch
   *     holds alone too, and only a single cover gets the exception: batches
   *     change no result. A failing cover is dropped alone; the others stay (a
   *     trap: dropping every cover of the currency let a 2024 same-day case
   *     undo a 2023 cover, −54 on an economic 0).
   * Older `null` slices keep the untracked-origin path (spec row 17).
   */
  private processTraditional(events: FxEvent[], options?: { checkpointDate?: string }): FxDisposal[] {
    const EPS = FxFifoEngine.EPS;
    const start = {
      lots: FxFifoEngine.cloneLots(this.lots),
      disposals: this.disposals.length,
      nextLotId: this.nextLotId,
      messages: this.messages.length,
      warnings: this.warnings.length,
    };
    const order = new Map(events.map((e, i) => [e, i]));
    const byDate = (a: NullPark, b: NullPark): number =>
      a.date.localeCompare(b.date) || (order.get(a.event) ?? 0) - (order.get(b.event) ?? 0);
    // The late-cover candidates per currency, oldest first.
    const byCcy = new Map<string, FxEvent[]>();
    for (const e of events
      .filter((x) => !x.kind && x.currency !== "EUR" && x.quantity.greaterThan(EPS))
      .sort((a, b) => a.date.localeCompare(b.date) || (order.get(a) ?? 0) - (order.get(b) ?? 0))) {
      const list = byCcy.get(e.currency);
      if (list) list.push(e);
      else byCcy.set(e.currency, [e]);
    }
    // Only the pass kept as the result records the trace (the plain pass and
    // the trials do not), so a traced run pays for one traced pass.
    const traced = this.traceEnabled;
    // One pass with these late-covered buys and same-day covers (a trial when `trial` is set).
    const pass = (
      enabled: Set<FxEvent>,
      same: Set<string>,
      trial?: CoverPass["trial"],
      year = "",
      untraced = trial !== undefined,
    ): CoverPass => {
      this.lots = FxFifoEngine.cloneLots(start.lots);
      this.disposals.length = start.disposals;
      this.nextLotId = start.nextLotId;
      this.messages.length = start.messages;
      this.warnings.length = start.warnings;
      this.sameDayOn = same;
      this.movedFrom = new Map();
      this.traceEnabled = traced && !untraced;
      const cover: CoverPass = {
        enabled,
        byCcy,
        left: new Map(),
        ...(trial ? { trial } : {}),
        joined: new Set(),
        horizon: year,
        stopped: false,
      };
      this.cover = enabled.size > 0 || trial ? cover : undefined;
      this.runEvents(events, options);
      this.cover = undefined;
      this.traceEnabled = traced;
      return cover;
    };
    interface Outcome {
      nulls: Map<FxEvent, NullPark>;
      short: { currency: string; date: string; qty: Decimal }[];
      disposals: FxDisposal[];
    }
    const outcome = (): Outcome => ({
      nulls: new Map(this.nullParks.map((p) => [p.event, { ...p }])),
      short: [...this.shortfalls],
      disposals: this.disposals.slice(start.disposals),
    });
    const nullOf = (o: Outcome, buy: FxEvent): Decimal => o.nulls.get(buy)?.qty ?? new Decimal(0);

    pass(new Set(), new Set(), undefined, "", true);
    if (this.nullParks.length === 0) {
      if (traced) pass(new Set(), new Set());
      return this.disposals;
    }
    // The accepted covers and the pass they give; every trial is judged against it.
    let enabled = new Set<FxEvent>();
    let same = new Set<string>();
    let ref = outcome();
    // The engine holds the accepted pass, with its trace when one is asked for.
    let current = !traced;

    const coverable = (p: NullPark): boolean => {
      const list = byCcy.get(p.currency);
      if (!list) return false;
      const c = list[FxFifoEngine.firstAfter(list, p.date)];
      return c !== undefined && daysBetween(p.date, c.date) <= FxFifoEngine.LATE_COVER_DAYS;
    };
    const sales = new Set(events.filter((e) => e.kind === "stock_sell").map((e) => `${e.currency}|${e.date}`));
    const tried = new Set<FxEvent | string>();

    // Covers the accepted pass could still use, oldest first: a late cover per
    // `null` buy with an acquisition in its window, a same-day cover per
    // currency and date with a `null` buy and a sale.
    type Unit = { date: string; late: NullPark } | { date: string; same: string };
    const keyOf = (u: Unit): FxEvent | string => ("late" in u ? u.late.event : u.same);
    const units = (): Unit[] => {
      const out: Unit[] = [];
      const seen = new Set<string>();
      for (const p of [...ref.nulls.values()].sort(byDate)) {
        if (!p.qty.greaterThan(EPS)) continue;
        if (!tried.has(p.event) && !enabled.has(p.event) && coverable(p)) out.push({ date: p.date, late: p });
        const key = `${p.currency}|${p.date}`;
        if (sales.has(key) && !seen.has(key) && !tried.has(key) && !same.has(key)) {
          seen.add(key);
          out.push({ date: p.date, same: key });
        }
      }
      return out.sort((a, b) => a.date.localeCompare(b.date));
    };

    // One trial: the accepted covers plus `pick`, in one pass (steps 2 and 3).
    // A buy the trial leaves with more `null` than the accepted pass takes its
    // own late cover when it runs (`bounded`: only up to the horizon). Null
    // when the trial fails before its last event: a batch at its first
    // failure, a single cover at its first failure up to its own years (one
    // after them may still keep it, step 4).
    type Trial = { enabled: Set<FxEvent>; same: Set<string>; out: Outcome; horizon: string };
    const trial = (pick: Unit[], year: string, bounded = false): Trial | null => {
      const batch = pick.length > 1;
      const tEnabled = new Set(enabled);
      const tSame = new Set(same);
      const picked = new Set<FxEvent>();
      for (const u of pick) {
        if ("late" in u) {
          tEnabled.add(u.late.event);
          picked.add(u.late.event);
        } else tSame.add(u.same);
      }
      const refGross = new Map([...ref.nulls].map(([e, p]) => [e, p.gross]));
      // Step 4 as the pass runs: a buy of an earlier date (its same-day covers
      // done) with more `null` (up to the horizon, for a single cover) fails
      // the trial; past the horizon's year end that verdict is final.
      let seen = 0;
      let judged = false;
      const fails = (date: string): boolean => {
        const horizon = batch ? "9999" : (this.cover?.horizon ?? year);
        const end = `${horizon}-12-31`;
        for (; seen < this.nullParks.length; seen++) {
          const p = this.nullParks[seen]!;
          if (p.date <= end && p.qty.greaterThan(nullOf(ref, p.event).plus(EPS))) return true;
        }
        if (judged || date <= end) return false;
        judged = true;
        return !holds(outcome(), horizon);
      };
      const c = pass(tEnabled, tSame, { pick: picked, refGross, fails, bounded }, year);
      if (c.stopped) return null;
      for (const b of c.joined) tEnabled.add(b);
      return { enabled: tEnabled, same: tSame, out: outcome(), horizon: c.horizon };
    };

    // Step 4, up to the end of `year` (all the data by default): no buy more
    // `null`, no currency more missing lots.
    const holds = (o: Outcome, year = "9999"): boolean => {
      const end = `${year}-12-31`;
      for (const p of o.nulls.values()) {
        if (p.date <= end && p.qty.greaterThan(nullOf(ref, p.event).plus(EPS))) return false;
      }
      const missing = (x: Outcome): Map<string, Decimal> => {
        const m = new Map<string, Decimal>();
        for (const s of x.short) if (s.date <= end) m.set(s.currency, (m.get(s.currency) ?? new Decimal(0)).plus(s.qty));
        return m;
      };
      const before = missing(ref);
      for (const [ccy, qty] of missing(o)) {
        if (qty.greaterThan((before.get(ccy) ?? new Decimal(0)).plus(EPS))) return false;
      }
      return true;
    };

    // FX transmission and acquisition values per year, `from` to `to`, as filed.
    const figures = (o: Outcome, from: string, to: string): string => {
      const per = new Map<string, { p: Decimal; c: Decimal }>();
      for (const d of o.disposals) {
        const y = d.disposeDate.slice(0, 4);
        if (y < from || y > to) continue;
        const v = per.get(y) ?? { p: new Decimal(0), c: new Decimal(0) };
        per.set(y, { p: v.p.plus(d.proceedsEur), c: v.c.plus(d.costBasisEur) });
      }
      return [...per]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([y, v]) => `${y}:${v.p.toFixed(2)}:${v.c.toFixed(2)}`)
        .join("|");
    };
    const lastYear = Number(events.reduce((m, e) => (e.date > m ? e.date : m), "").slice(0, 4));
    // Step 4's exception: a single cover that holds up to the end of its own
    // years (`horizon`) and fails only in a later year F stays when dropping
    // it would change the figures of a year from its horizon to F − 1. Those
    // years were filed with the cover; a later year's data never changes them.
    const keepsFiled = (t: Trial): boolean => {
      if (!holds(t.out, t.horizon)) return false;
      let f = Number(t.horizon) + 1;
      while (f < lastYear && holds(t.out, String(f))) f++;
      const to = String(f - 1);
      return figures(t.out, t.horizon, to) !== figures(ref, t.horizon, to);
    };

    // Per year, how many of its oldest covers the next trial takes: all at
    // first, half after a failure, twice as many after a success. A batch
    // must hold over all the data, so (a cover only ever takes dollars away
    // from what comes after it) each of its covers would hold alone too.
    const size = new Map<string, number>();
    for (let next = units(); next.length > 0; next = units()) {
      const year = next[0]!.date.slice(0, 4);
      const all = next.filter((u) => u.date.startsWith(year));
      const n = FxFifoEngine.coversAlone ? 1 : size.get(year);
      const pick = n === undefined ? all : all.slice(0, n);
      let t = trial(pick, year);
      if (t && !holds(t.out)) {
        // Step 4's exception, for a single cover only: its own chain, without
        // the later buys it left without dollars (they are covers of their
        // own year, judged there).
        const own = pick.length === 1 && holds(t.out, t.horizon) ? trial(pick, year, true) : null;
        t = own && (holds(own.out) || keepsFiled(own)) ? own : null;
      }
      if (t) {
        enabled = t.enabled;
        same = t.same;
        ref = t.out;
        current = !traced;
        for (const u of pick) tried.add(keyOf(u));
        if (n !== undefined) size.set(year, 2 * n);
        continue;
      }
      current = false;
      if (pick.length > 1) size.set(year, Math.ceil(pick.length / 2));
      else tried.add(keyOf(pick[0]!));
    }
    if (!current) pass(enabled, same);
    return this.disposals;
  }

  /** Index of the first event of `list` (sorted by date) dated after `date`. */
  private static firstAfter(list: FxEvent[], date: string): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.date <= date) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private static cloneLots(lots: Map<string, FxLot[]>): Map<string, FxLot[]> {
    return new Map([...lots].map(([ccy, ls]) => [ccy, ls.map((l) => ({ ...l }))]));
  }

  /**
   * Late cover of a stock buy that found the pool `remaining` short (see
   * {@link processTraditional}). A covered buy, or in a trial a buy left with
   * more `null` than the accepted pass (up to the horizon in a bounded trial), takes
   * the acquisitions of its currency dated 1 to {@link LATE_COVER_DAYS} days
   * after it, oldest first, up to `remaining`: each part goes into the pool on
   * the buy's date. A conversion split in two keeps its rate: `realEurAmount`
   * and `commissionEur` are split in the same proportion. True when it added
   * a part.
   */
  private takeLateCover(event: FxEvent, remaining: Decimal): boolean {
    const c = this.cover;
    if (!c) return false;
    const EPS = FxFifoEngine.EPS;
    const list = c.byCcy.get(event.currency);
    if (!list) return false;
    // Part of the trial's chain: a picked buy, or one with more `null` than
    // the accepted pass. Only a buy up to the horizon extends it.
    const own = event.date.slice(0, 4) <= c.horizon;
    const chain =
      c.trial !== undefined &&
      (own || !c.trial.bounded) &&
      (c.trial.pick.has(event) || remaining.greaterThan((c.trial.refGross.get(event) ?? new Decimal(0)).plus(EPS)));
    const widens = chain && own;
    if (!c.enabled.has(event) && !chain) return false;
    let need = remaining;
    let added = false;
    for (let i = FxFifoEngine.firstAfter(list, event.date); i < list.length && need.greaterThan(EPS); i++) {
      const acq = list[i]!;
      if (daysBetween(event.date, acq.date) > FxFifoEngine.LATE_COVER_DAYS) break;
      const cap = c.left.get(acq) ?? acq.quantity;
      if (!cap.greaterThan(EPS)) continue;
      const x = Decimal.min(need, cap);
      const part = FxFifoEngine.splitAcquisition(acq, x, event.date);
      this.movedFrom.set(part, acq.date);
      c.left.set(acq, cap.minus(x));
      need = need.minus(x);
      if (widens && acq.date.slice(0, 4) > c.horizon) c.horizon = acq.date.slice(0, 4);
      this.addLot(part);
      added = true;
    }
    if (added && !c.enabled.has(event)) c.joined.add(event);
    return added;
  }

  /** `q` units of an acquisition, dated `date`, at the acquisition's own rate. */
  private static splitAcquisition(e: FxEvent, q: Decimal, date: string): FxEvent {
    const share = q.div(e.quantity);
    return {
      ...e,
      date,
      quantity: q,
      ...(e.realEurAmount !== undefined ? { realEurAmount: e.realEurAmount.mul(share) } : {}),
      ...(e.commissionEur !== undefined ? { commissionEur: e.commissionEur.mul(share) } : {}),
    };
  }

  /** One pass over the events (the whole run for the default and monodivisa). */
  private runEvents(events: FxEvent[], options?: { checkpointDate?: string }): FxDisposal[] {
    this.fxMissing.clear();
    this.parked.clear();
    this.tradStats = { lostDollarSales: [], guardSales: [], uncovered: [], inflight: new Map(), parkedAtCheckpoint: [] };
    this.nullParks = [];
    this.nullOfSlice = new Map();
    this.shortfalls = [];
    this.trace = [];
    this.traceSeq = 0;
    // Transient per-currency conservation accumulators — like fxMissing/parked,
    // reset every run so the self-check reflects only this report's movements.
    this.accAcquired.clear();
    this.accDisposed.clear();
    this.accParked.clear();
    this.accUnparked.clear();
    this.accDiscarded.clear();
    this.accProfit.clear();
    this.accPhantom.clear();
    this.accCurrencies.clear();
    const sorted = FxFifoEngine.sortEvents(events);

    // «Tradicional con divisa»: snapshot the parked principal at the declared
    // year end, before the first later event (orphan detector, report.ts).
    const checkpoint = this.traditionalFx ? options?.checkpointDate : undefined;
    let checkpointTaken = false;

    const trial = this.cover?.trial;
    let date = "";
    for (const event of sorted) {
      if (trial && event.date !== date) {
        date = event.date;
        if (trial.fails(date)) {
          this.cover!.stopped = true;
          return this.disposals;
        }
      }
      if (checkpoint !== undefined && !checkpointTaken && event.date > checkpoint) {
        this.tradStats.parkedAtCheckpoint = this.snapshotParked();
        checkpointTaken = true;
      }
      if (event.currency === "EUR") continue;

      if (event.kind === "stock_buy") {
        this.parkPrincipal(event);
      } else if (event.kind === "stock_sell") {
        this.unparkAndReadd(event);
      } else if (event.quantity.greaterThan(0)) {
        // A late cover took part of it: the rest stays on its own date.
        const rest = this.cover?.left.get(event);
        if (rest === undefined) this.addLot(event);
        else if (rest.greaterThan(FxFifoEngine.EPS)) {
          this.addLot(FxFifoEngine.splitAcquisition(event, rest, event.date));
        }
      } else if (event.quantity.lessThan(0)) {
        this.consumeLots(event);
      }
    }

    if (checkpoint !== undefined && !checkpointTaken) this.tradStats.parkedAtCheckpoint = this.snapshotParked();

    for (const [currency, { count, totalQty }] of this.fxMissing) {
      this.emit({
        id: "fx.missing_prior_lots",
        severity: "info",
        message: `⚠ ${count} disposiciones de ${currency} sin lotes previos suficientes (total: ${totalQty.toFixed(2)} ${currency}). Posible adquisición anterior al período declarado — ganancia FX asumida = 0.`,
        hint: "La adquisición de esta divisa fue anterior al periodo del Flex Query. Se asume ganancia FX = 0 (tratamiento conservador).",
        context: { currency, count: count.toString(), totalQuantity: totalQty.toFixed(2) },
      });
    }

    this.checkConservation();

    return this.disposals;
  }

  /** Quantity-conservation tolerance (FCY units). Dust below this is fine — the
   *  carry-basis loops already use a 1e-9 EPS, so legit runs balance far tighter
   *  than this; anything above it signals a real bookkeeping desync. */
  private static readonly CONSERVATION_EPS = new Decimal("0.01");

  /** Sum the parked FCY across ALL positions of a currency (every parked queue
   *  whose key is `${currency}` or starts with `${currency}|` — the two
   *  {@link parkKey} forms). The plain-currency `getParked()` accessor only sees
   *  the bare-key queue, so the conservation check needs this to total the
   *  per-position queues real data produces. */
  private totalParkedBalance(currency: string): Decimal {
    const prefix = `${currency}|`;
    let sum = new Decimal(0);
    for (const [key, slices] of this.parked) {
      if (key !== currency && !key.startsWith(prefix)) continue;
      for (const s of slices) sum = sum.plus(s.q);
    }
    return sum;
  }

  /**
   * FX conservation self-check (issue #230 — "para la comprobación de descuadres
   * del FIFO, y no se silencien operaciones sin respaldo económico"). A pure
   * DIAGNOSTIC: it reads only the running accumulators and the final pool/parked
   * balances and emits a developer-facing `warning` if they fail to balance. It
   * NEVER mutates a disposal, lot, or any tax figure — no casilla output depends
   * on it. It is the regression tripwire for the "pool diverged from the real
   * spendable balance" bug class (the documented €450-vs-€320 drift).
   *
   * THE IDENTITY (per currency). Six kinds mutate the pool/parked quantities:
   *   finalPool   = Σacquire − Σdispose(per-lot) − Σpark(covered) + Σunpark + Σprofit
   *   finalParked = Σpark(covered+uncovered) − Σunpark(matched) − Σdiscard
   * The accumulators sum the SAME quantities the trace's `record()` logs, so for
   * the well-behaved (fully-funded) case:
   *   (acquired + profit) − disposed − discarded  ==  finalPool + finalParked.
   *
   * RECONCILING THE THREE LEGITIMATE "no real acquire behind it" PATHS. Three
   * documented-correct paths put FCY into the books that was never a real pool
   * acquisition, so the bare identity above would FALSE-POSITIVE on them:
   *   1. Missing-lot floored disposal (consumeLots, the "sin lotes"/"insuficientes"
   *      branches): FCY is disposed that was never acquired. Those branches floor
   *      gain to 0 and DO NOT touch the pool (the pool never goes negative), so the
   *      floored qty is on `disposed` (reducing lhs) with no matching acquire.
   *   2. Uncovered park (parkPrincipal shortfall, rate=null): FCY parked from an
   *      empty pool — on the rhs (finalParked) with no acquire behind it.
   *   3. Unmatched-sell re-add (unparkAndReadd top-up): FCY re-added to the pool at
   *      the sale rate with no parked principal — on the rhs (finalPool) with no
   *      acquire behind it.
   * Each is genuine, untracked FCY (funding outside the data window — AFx
   * settlement, single-year exports, options-delivered shares). We therefore count
   * an implicit "phantom acquire" of exactly that quantity (`accPhantom`,
   * incremented at those three sites). Algebra: with phantom included,
   *   lhs − rhs = −(disposed_floor + parked_uncovered + unpark_unmatched) + phantom
   *             = 0
   * exactly, so the check is SILENT on every legitimate scenario and only fires
   * when the pool genuinely diverged from the parked/spendable books. (FCY↔FCY and
   * short legs never enter park/unpark — shorts are filtered out by the producers,
   * FCY↔FCY conversions are plain acquire/dispose — so they balance via the
   * acquire/dispose terms alone.)
   */
  private checkConservation(): void {
    // NOTE: accParked/accUnparked are accumulated for symmetry & trace diagnostics
    // but are deliberately NOT terms in the identity below — park/unpark are
    // internal pool↔parked transfers that net to zero on the rhs (poolBalance +
    // parkedBalance), so only acquire/dispose/discard/profit/phantom appear here.
    const get = (m: Map<string, Decimal>, c: string): Decimal => m.get(c) ?? new Decimal(0);
    for (const currency of this.accCurrencies) {
      const acquired = get(this.accAcquired, currency);
      const disposed = get(this.accDisposed, currency);
      const discarded = get(this.accDiscarded, currency);
      const profit = get(this.accProfit, currency);
      const phantom = get(this.accPhantom, currency);

      const lhs = acquired.plus(profit).plus(phantom).minus(disposed).minus(discarded);
      const rhs = this.poolBalance(currency).plus(this.totalParkedBalance(currency));
      const mismatch = lhs.minus(rhs);

      if (mismatch.abs().greaterThan(FxFifoEngine.CONSERVATION_EPS)) {
        this.emit({
          id: "fx.conservation_mismatch",
          severity: "warning",
          message: `⚠ Descuadre interno del motor de divisa para ${currency}: ${mismatch.toFixed(2)} unidades sin cuadrar. Las casillas 1633/1637 pueden no reconciliar.`,
          hint: "Esto es una comprobación interna (no debería ocurrir). Si lo ves, repórtalo en GitHub adjuntando el informe; los importes de divisa pueden necesitar revisión manual.",
          context: { currency, mismatch: mismatch.toString() },
        });
      }
    }
  }

  /**
   * Extract FX events from trades.
   *
   * Only explicit CASH trades generate FX events. For BASE.QUOTE pairs:
   *   - If trade.currency matches the quote: quantity is in the base (wrong
   *     currency), so we use tradeMoney (in quote = trade.currency) and invert
   *     polarity (SELL base = acquiring quote, BUY base = disposing quote).
   *   - If trade.currency matches the base: quantity is already in
   *     trade.currency, BUY = acquiring, SELL = disposing.
   * When neither side is EUR (GBP.USD, USD.JPY) the other side of the pair gets
   * its own event with opposite polarity, so the divisa given up leaves its pool.
   *
   * FXCONV/AFx-marked trades (automatic broker conversions) are PROCESSED as
   * ordinary conversions by default (#239): IBKR does NOT round-trip FCY→EUR when
   * you sell, so an auto-converted balance is genuinely held divisa whose later
   * conversion is a gain/loss (Art. 33.1). The opt-out (`trackAutoConvert ===
   * false`) restores the per-trade isFxconv() skip for accounts that genuinely
   * round-trip. No global auto-convert detection — accounts mix manual and
   * automatic conversions freely.
   *
   * Securities trades do NOT generate implicit FX events; the carry-basis stock
   * BUY/SELL producers handle a foreign-stock round-trip (park/unpark), so the
   * FCY a buy spends is consumed once — processing the AFx funding row that
   * supplied it does NOT double-count (the buy's park consumes that same lot).
   * The missing-prior-year-lot floor in consumeLots still forces gain = 0 when no
   * lot exists, so processing AFx can never fabricate a phantom gain.
   */
  static extractFxEvents(trades: Trade[], rateMap: EcbRateMap, trackAutoConvert = true): FxEvent[] {
    const events: FxEvent[] = [];

    for (const trade of trades) {
      if (trade.currency === "EUR") continue;
      if (trade.assetCategory !== "CASH") continue;
      // Broker auto-conversions (AFx/FXCONV). By default (trackAutoConvert) they
      // ARE processed as ordinary currency conversions — IBKR does NOT round-trip
      // FCY→EUR on a sale (proceeds accrue as a held FCY balance), so an AFx
      // conversion is a genuine acquisition/disposal of divisa under Art. 33.1
      // (issue #239). The opt-out (trackAutoConvert === false, the monodivisa-style
      // "skip broker auto-conversions" choice) restores the historical skip for
      // accounts where the broker genuinely round-trips and the user wants the FX
      // leg ignored. The missing-prior-year-lot floor in consumeLots still applies
      // either way, so processing AFx can never fabricate a phantom gain.
      if (!trackAutoConvert && FxFifoEngine.isFxconv(trade)) continue;

      // Rule R0 (issue #434 for «Tradicional con divisa», issue #437 for the
      // default): every FX event is dated, valued, ordered and assigned to a tax
      // year on its TRADE date, the date the stock FIFO uses for a sale. A trap:
      // with settlement dating, a same-day "convert, then buy a US stock" (stock
      // T+1, FX T+2) ran the buy before its own funding; it parked "uncovered"
      // and the funding lot stayed in the pool as dollars that no longer
      // existed, later consumed as real lots (−100 on an economic 0).
      const date = normalizeDate(trade.tradeDate || trade.settlementDate);
      const ecbRate = getEcbRate(rateMap, date, trade.currency);

      const quoteIsTarget = FxFifoEngine.isCurrencyQuote(trade);
      let amount: Decimal;
      let acquiring: boolean;

      if (quoteIsTarget) {
        amount = new Decimal(trade.tradeMoney).abs();
        acquiring = trade.buySell === "SELL";
      } else {
        amount = new Decimal(trade.quantity).abs();
        acquiring = trade.buySell === "BUY";
      }

      // Commission increases cost basis (BUY) or reduces proceeds (SELL). Signed
      // like fifo.ts commissionCost: `commission` is negative when charged, so a
      // positive value (a broker rebate) lowers the cost instead of raising it.
      let commissionEur: Decimal | undefined;
      const commCost = new Decimal(trade.commission || "0").negated();
      if (!commCost.isZero()) {
        const commCcy = trade.commissionCurrency || trade.currency;
        if (commCcy === "EUR") {
          commissionEur = commCost;
        } else {
          const commRate = getEcbRate(rateMap, date, commCcy);
          commissionEur = commCost.mul(commRate);
        }
      }

      // Real EUR cash the broker applied to THIS conversion (FX principal, spread
      // embedded, separate commission EXCLUDED). When present and a finite positive
      // amount, the engine values the conversion at the effective real rate
      // (realEurAmount/|quantity|) instead of ecbRate (issue #253). Both legs of a
      // tracked round-trip carry it so acquire and dispose value on the same basis.
      // Not finite/positive → omit it → ECB fallback. Commission handling unchanged.
      let realEurAmount: Decimal | undefined;
      if (trade.realEurAmount !== undefined) {
        try {
          const real = new Decimal(trade.realEurAmount);
          if (real.isFinite() && real.abs().greaterThan(0)) {
            realEurAmount = real.abs();
          }
        } catch {
          // Unparseable string (decimal.js throws on garbage) → omit → ECB fallback.
        }
      }

      if (acquiring) {
        events.push({
          date,
          currency: trade.currency,
          quantity: amount,
          ecbRate,
          trigger: "conversion",
          commissionEur,
          realEurAmount,
          brokerSource: trade.brokerSource,
        });
      } else {
        events.push({
          date,
          currency: trade.currency,
          quantity: amount.negated(),
          ecbRate,
          trigger: "conversion",
          commissionEur,
          realEurAmount,
          brokerSource: trade.brokerSource,
        });
      }

      // A non-EUR pair (GBP.USD, USD.JPY) swaps one divisa for another, so the
      // OTHER side of the pair moves too, with opposite polarity and at its own
      // ECB rate: the currency given up is disposed (Art. 33.1), the one received
      // is acquired. Its amount is quantity when it is the base and tradeMoney when
      // it is the quote. The commission stays on the trade.currency leg only.
      const pair = FxFifoEngine.pairCurrencies(trade);
      const tradeCcy = trade.currency.toUpperCase();
      // quoteIsTarget means trade.currency is the quote; otherwise it must be the
      // base, or the symbol does not describe this trade and there is no other leg.
      const other = !pair ? null : quoteIsTarget ? pair.base : pair.base === tradeCcy ? pair.quote : null;
      if (other && other !== "EUR" && other !== tradeCcy && isEcbResolvable(other)) {
        const otherAmount = new Decimal(quoteIsTarget ? trade.quantity : trade.tradeMoney).abs();
        if (otherAmount.greaterThan(0)) {
          events.push({
            date,
            currency: other,
            quantity: acquiring ? otherAmount.negated() : otherAmount,
            ecbRate: getEcbRate(rateMap, date, other),
            trigger: "conversion",
            brokerSource: trade.brokerSource,
          });
        }
      }
    }

    return events;
  }

  /**
   * Split a CASH trade's BASE.QUOTE symbol (e.g. "GBP.USD") into its two
   * currencies, upper-cased. Returns null when the symbol is not a pair.
   */
  static pairCurrencies(trade: Trade): { base: string; quote: string } | null {
    const sym = (trade.symbol || trade.description || "").toUpperCase();
    const dot = sym.indexOf(".");
    if (dot <= 0 || dot === sym.length - 1) return null;
    return { base: sym.slice(0, dot), quote: sym.slice(dot + 1) };
  }

  /**
   * Detect if trade.currency is the QUOTE side of a BASE.QUOTE pair.
   * When true, quantity is in the base (wrong currency for lot tracking)
   * and tradeMoney is in the quote (= trade.currency).
   */
  private static isCurrencyQuote(trade: Trade): boolean {
    const sym = (trade.symbol || trade.description || "").toUpperCase();
    const dot = sym.indexOf(".");
    if (dot === -1) return false;
    const quote = sym.slice(dot + 1);
    return quote === trade.currency.toUpperCase();
  }

  /**
   * Extract FX events from cash transactions (dividends, interest).
   *
   * Dividends/interest received in FCY create acquisition lots;
   * withholding tax and fees paid in FCY consume lots.
   */
  static extractCashFxEvents(cashTransactions: CashTransaction[], rateMap: EcbRateMap): FxEvent[] {
    const events: FxEvent[] = [];
    // R0 (issues #434, #437): every FX event is dated on its trade date and
    // settlement is never read, so a cash row goes on `dateTime` (a fee charged
    // on 31 December that settles on 2 January belongs to the earlier year), the
    // date its income is valued on (0029). Every key below (income lot,
    // withholding netting, refund) uses this one date, so a withholding still
    // nets into the income it was taken from.
    const cashDate = (tx: CashTransaction): string => normalizeDate(tx.dateTime || tx.settleDate);

    // Withholding tax (retención en origen) on a foreign-currency dividend/interest
    // is a PAGO A CUENTA: it is deducted at source, the withheld FCY never enters
    // the taxpayer's spendable balance, and it is not a "conversión de divisas a
    // euros" — so it must NOT create an FX disposal (issue #225). The DGT timing
    // doctrine (V2422-20, V1613-25, V0463-21) crystallizes an FX gain only on the
    // effective conversion to EUR (cobro/pago); a withholding is neither. The
    // GROSS income is still declared independently on the income path (casilla
    // 0029) and the withholding still credits double-taxation (0588) — those read
    // the raw cashTransactions, never these FX events, so they are untouched.
    //
    // Instead of emitting a phantom disposal that FIFO-consumes an OLDER lot at a
    // different rate (the bug), we net each withholding into its income lot: the
    // acquisition lot reflects the NET FCY actually received. FX lots are fungible
    // per currency, so netting by (broker, currency, date) is equivalent to exact
    // issuer pairing and far simpler. A withholding with no same-key income
    // (orphan / cross-date reclaim) is dropped — still never a disposal.
    //
    // The orphan drop is intentionally SILENT (no warning): extractCashFxEvents is
    // static with no `emit`/messages channel, and the condition is non-actionable —
    // the gross income (0029) and the 0588 credit are declared by the income path
    // regardless; the only effect is a marginally-gross FX lot. Surfacing it would
    // add anxiety for nothing. If a diagnostic is ever wanted, aggregate it in
    // report.ts after processEvents, not here.
    //
    // The sum is SIGNED (issue #436): a broker correction books the original
    // withholding, its positive reversal and the corrected one, and a refund is a
    // positive row. Each nets against the others on its key, so the lot holds the
    // net FCY received: 10 − 1.50 + 1.50 − 1.00 opens ONE 9.00 lot, not 7.50 + 1.50.
    // A key left with a net refund and no income to absorb it (a correction posted
    // in a later file, dated on the original day) opens one lot after the loop.
    //
    // The key also carries the broker: a withholding nets only into its own
    // broker's income, so a same-day USD dividend at another broker keeps its own
    // lot size and the FX rows keep the right "buy broker" label. The pool is per
    // currency, so this moves no 1633/1637 total, only the lot split and labels.
    const whtKey = (brokerSource: string | undefined, currency: string, date: string): string =>
      `${brokerSource ?? ""}|${currency}|${date}`;
    const whtByKey = new Map<string, Decimal>(); // > 0 withheld, < 0 refunded (net)
    const refundRowByKey = new Map<string, CashTransaction>();
    for (const tx of cashTransactions) {
      if (tx.type !== "Withholding Tax" || tx.currency === "EUR") continue;
      const amt = new Decimal(tx.amount);
      const key = whtKey(tx.brokerSource, tx.currency, cashDate(tx));
      whtByKey.set(key, (whtByKey.get(key) ?? new Decimal(0)).minus(amt));
      if (amt.greaterThan(0) && !refundRowByKey.has(key)) refundRowByKey.set(key, tx);
    }
    /**
     * Reduce an income inflow by any withholding pending for its (broker,currency,date),
     * returning the NET FCY received. STATEFUL: it draws down the shared `whtByKey`
     * bucket, so two same-key incomes split one withholding total rather
     * than each netting it in full; order within a key doesn't change the total netted.
     * A net REFUND on the key (pending < 0) is added to the first inflow instead.
     * NOTE: this keys on the EXACT same-date (broker,currency,date), deliberately coarser
     * AND stricter than the income path's matcher in dividends.ts (ISIN, same currency
     * first, ≤7-day window). Coarser is safe for FX because lots are fungible per currency
     * (the net-per-currency total is what matters, not which issuer). Stricter on the
     * date means a withholding booked on a DIFFERENT date than its dividend
     * isn't matched here → it's an orphan, dropped, and the lot stays gross. That is
     * conservative (no phantom disposal; the extra FCY only ever yields real drift on
     * currency actually received) and immaterial — accepted deliberately.
     */
    const consumeWithholding = (brokerSource: string | undefined, currency: string, date: string, gross: Decimal): Decimal => {
      const key = whtKey(brokerSource, currency, date);
      const pending = whtByKey.get(key);
      if (!pending || pending.isZero()) return gross;
      if (pending.isNegative()) {
        // Net refund on this key: it is FCY received, so it joins this inflow's lot.
        whtByKey.set(key, new Decimal(0));
        return gross.minus(pending);
      }
      const applied = Decimal.min(pending, gross);
      whtByKey.set(key, pending.minus(applied));
      return gross.minus(applied);
    };

    const convertedKeys = new Set<string>();
    for (const tx of cashTransactions) {
      if (tx.currency === "EUR") continue;
      // The broker converted this income to EUR before crediting it (Trade
      // Republic, issue #96): no foreign currency ever entered the account,
      // so it opens no FX lot. Its income value (0029) is unaffected. A refund of
      // its withholding never held FCY either, so its key opens no refund lot.
      if (tx.brokerConvertedToBase) {
        if (tx.type !== "Withholding Tax") {
          convertedKeys.add(whtKey(tx.brokerSource, tx.currency, cashDate(tx)));
        }
        continue;
      }

      const amount = new Decimal(tx.amount);
      if (amount.isZero()) continue;

      // Crypto reward income (staking, Simple Earn interest, airdrops, referral)
      // is valued and taxed entirely on the income path in report.ts; it must
      // never generate an FX event here. Skip it BEFORE any rate lookup — its
      // currency may be a coin (e.g. USDT) whose ECB/USD rate was not fetched,
      // and getEcbRate would otherwise throw and crash the whole report.
      if (tx.type === "Crypto Reward Income") continue;

      // Crypto-denominated income (e.g. Kraken staking, reported in the staked
      // coin) has no ECB rate. It can't generate an FX event — skip it here.
      // report.ts surfaces a warning so the user values it manually.
      if (!isEcbResolvable(tx.currency)) continue;

      const date = cashDate(tx);
      // A resolvable currency whose rate was not fetched (e.g. an FCY income in
      // a year with no trades) must not throw — skip the event and let report.ts
      // surface it. lookupRateInMap returns null instead of throwing.
      const ecbRate = lookupRateInMap(rateMap, date, tx.currency);
      if (ecbRate === null) continue;

      if (tx.type === "Dividends" || tx.type === "Payment In Lieu Of Dividends") {
        // Net the same-(broker,currency,date) withholding into the dividend lot.
        const net = consumeWithholding(tx.brokerSource, tx.currency, date, amount.abs());
        // `greaterThan(0)`, not `isPositive()` — decimal.js treats +0 as positive,
        // and a zero-quantity event would make addLot compute 0/0 = NaN.
        if (net.greaterThan(0)) {
          events.push({ date, currency: tx.currency, quantity: net, ecbRate, trigger: "dividend", brokerSource: tx.brokerSource });
        }
      } else if (tx.type === "Withholding Tax") {
        // Netted into its income inflow above with its sign (or dropped if an
        // orphan deduction). Never a disposal, and no lot of its own: a net
        // refund left on its key is emitted once after this loop (issue #436).
      } else if (tx.type === "Broker Interest Received" || tx.type === "Bond Interest Received") {
        // Interest can also carry withholding (e.g. "WITHHOLDING ON CREDIT INT");
        // net it the same way — a withholding is a pago a cuenta whatever the income.
        const net = consumeWithholding(tx.brokerSource, tx.currency, date, amount.abs());
        if (net.greaterThan(0)) {
          events.push({ date, currency: tx.currency, quantity: net, ecbRate, trigger: "interest", brokerSource: tx.brokerSource });
        }
      } else if (tx.type === "Broker Interest Paid" || tx.type === "Bond Interest Paid") {
        events.push({ date, currency: tx.currency, quantity: amount.abs().negated(), ecbRate, trigger: "interest", brokerSource: tx.brokerSource });
      } else if (tx.type === "Other Fees" || tx.type === "Commission Adjustments") {
        if (amount.lessThan(0)) {
          events.push({
            date,
            currency: tx.currency,
            quantity: amount.abs().negated(),
            ecbRate,
            trigger: "commission",
            brokerSource: tx.brokerSource,
          });
        } else {
          events.push({ date, currency: tx.currency, quantity: amount.abs(), ecbRate, trigger: "commission", brokerSource: tx.brokerSource });
        }
      }
    }

    // A net refund no income absorbed (issue #436): FCY received, one acquire lot
    // on its key date, under the same guards a cash row passes above. A leftover
    // net deduction (pending > 0) is an orphan and stays dropped, never a disposal.
    for (const [key, pending] of whtByKey) {
      if (!pending.isNegative() || convertedKeys.has(key)) continue;
      const tx = refundRowByKey.get(key)!; // pending < 0 needs at least one positive row
      if (tx.brokerConvertedToBase || !isEcbResolvable(tx.currency)) continue;
      const date = cashDate(tx);
      const ecbRate = lookupRateInMap(rateMap, date, tx.currency);
      if (ecbRate === null) continue;
      events.push({ date, currency: tx.currency, quantity: pending.negated(), ecbRate, trigger: "dividend", brokerSource: tx.brokerSource });
    }

    return events;
  }

  /**
   * Extract the SELL-side carry-basis FX events from foreign-currency stock
   * (security) disposals — the divisa-side effect of SELLING a foreign-currency
   * security under the carry-basis-defer model (issue #230 follow-up, supersedes
   * the v0.49.0 full-proceeds model).
   *
   * WHY THIS EXISTS — the two FIFO engines are decoupled. The stock FIFO
   * (fifo.ts) converts a security's gain at the disposal-date rate (V2422-20),
   * deliberately STRIPPING the buy↔sale FX drift out of the stock gain so the
   * currency is taxed separately as its own patrimonial element (Art. 33.1
   * LIRPF). Selling a foreign-currency stock returns the dollars that were
   * spent buying it (the principal) plus a profit/loss; those dollars must
   * re-enter the divisa pool so a later USD→EUR conversion taxes the right FX
   * gain. The matching BUY removed (parked) that principal — see
   * {@link extractStockPurchaseFxEvents}; this method re-adds it.
   *
   * CARRY-BASIS, NOT FULL PROCEEDS (the v0.49.0 → follow-up correction). The old
   * model pushed the WHOLE `proceedsFcy` as a fresh acquisition lot at the sale
   * rate and did NO buy-side accounting. Across multiple same-currency
   * round-trips the FX FIFO balance DIVERGED from the real spendable balance and
   * a later conversion consumed the wrong "oldest" dollars (proven: €450 reported
   * vs €320 correct on a two-round-trip account, off by €130). The fix splits the
   * proceeds into PRINCIPAL (`costBasisFcy`) re-added at its CARRIED basis (set by
   * the buy that parked it) and PROFIT (`proceedsFcy − costBasisFcy`, when
   * positive) added at the sale rate. So this method emits a `stock_sell` event
   * carrying BOTH `costFcy` (= `costBasisFcy`) and `proceedsFcy`; the parked-FIFO
   * re-add logic lives in {@link unparkAndReadd}.
   *
   * GAINS AND LOSSES ALIKE, STILL NO DISPOSAL. The stock P&L sign does not make
   * this a disposal: a sale only MOVES principal back into the pool (at its carry)
   * and tops up profit. On a LOSS the principal beyond the proceeds is discarded
   * by `unparkAndReadd` (those dollars left the patrimony in the losing trade).
   * No FxDisposal is emitted — the divisa gain defers to the EUR conversion
   * (Art. 14.2.e LIRPF; DGT V2422-20 / V1613-25 / V0463-21).
   *
   * UNMATCHED SELL = FULL-PROCEEDS NO-OP. If the sold position was bought OUTSIDE
   * the data window (no parked principal), `unparkAndReadd` re-adds at the sale
   * rate — reproducing the pre-#230 full-proceeds behavior exactly. This is the
   * load-bearing safety property: nothing changes for single-year/AFx files.
   *
   * SAME FILTERS AS THE BUY/CONSUMER SIDE (so every parked principal has a
   * matching re-add; an engine invariant, not a DGT rule). STK/FUND/BOND only
   * (CRYPTO permutas' proceedsFcy is a coin, not fiat → crypto path; OPT/FOP/CASH
   * excluded — CASH conversions are the FX engine's own events). `currency ≠ EUR`,
   * ECB-resolvable, `proceedsFcy > 0`, and NOT a short close (`isShort`): a cover
   * SPENDS FCY (its FifoDisposal carries the OPEN proceeds dated at the CLOSE), so
   * it is neither a buy nor a sell of held dollars here.
   *
   * Concatenated into the SAME `processEvents` call as the conversion, dividend/
   * interest, and stock-buy events; the trade-date sort ({@link sortEvents})
   * guarantees the buy parks before this sell re-adds and before a conversion
   * consumes the result.
   */
  static extractStockProceedsFxEvents(
    disposals: FifoDisposal[],
    options?: { traditionalFx?: boolean },
  ): FxEvent[] {
    const events: FxEvent[] = [];
    const traditionalFx = options?.traditionalFx === true;
    // Only genuine securities produce a foreign-currency cash inflow we track as
    // divisa. CRYPTO is excluded (a crypto↔crypto permuta's proceedsFcy is in a
    // coin, not fiat — handled by the crypto valuation path); OPT/FOP/FSFOP and
    // CASH conversions are excluded too (the latter are already the FX engine's
    // own conversion events — including them here would double-count).
    const SECURITY_CATEGORIES = new Set(["STK", "FUND", "BOND"]);
    for (const d of disposals) {
      // «Tradicional con divisa»: shares bought in one currency and sold in
      // another (same ISIN, another listing; the stock FIFO matches by ISIN).
      // The stock line runs from the buy-date rate of the lot's currency to the
      // sale value, so: the lot's currency left inside the shares and never
      // comes back (its parked principal is released, each covered slice books
      // its drift up to the share purchase, `stock_sale_cross`), and the sale's
      // currency, when foreign, is new at the sale rate (no principal of its
      // own). A trap: the `currency === "EUR"` skip below left a USD lot sold in
      // EUR parked forever, and a EUR lot sold in USD unparked the USD
      // principal of the same ISIN (review r5939472090). The default keeps its
      // path (FifoEngine marks the lot's currency only in this mode).
      if (traditionalFx && d.acquireCurrency !== undefined && d.acquireCurrency !== d.currency) {
        if (!SECURITY_CATEGORIES.has(d.assetCategory) || d.isShort) continue;
        const date = normalizeDate(d.sellDate);
        const positionKey = FxFifoEngine.positionKey(d);
        const brokerSource = d.brokerSource;
        if (d.acquireCurrency !== "EUR" && isEcbResolvable(d.acquireCurrency)) {
          events.push({
            kind: "stock_sell",
            date,
            currency: d.acquireCurrency,
            quantity: new Decimal(0),
            costFcy: d.costBasisFcy,
            proceedsFcy: new Decimal(0),
            // Unused: nothing comes back in this currency (the rows use r_b).
            ecbRate: d.acquireEcbRate,
            trigger: "stock_sale",
            brokerSource,
            positionKey,
            crossCurrency: true,
          });
        }
        if (d.currency !== "EUR" && isEcbResolvable(d.currency)) {
          events.push({
            kind: "stock_sell",
            date,
            currency: d.currency,
            quantity: new Decimal(0),
            costFcy: new Decimal(0),
            proceedsFcy: d.proceedsFcy,
            ecbRate: d.sellEcbRate,
            trigger: "stock_sale",
            brokerSource,
            positionKey,
          });
        }
        continue;
      }
      if (d.currency === "EUR") continue;
      if (!SECURITY_CATEGORIES.has(d.assetCategory)) continue; // exclude crypto permutas, options/FOP, CASH conversions
      // A SHORT close (BUY+C covering a SELL+O) must NOT seed a sell here. Its
      // FifoDisposal carries the OPEN proceeds (the FCY received when the short
      // was opened, possibly a prior year) but is dated at the CLOSE — and a
      // cover SPENDS foreign currency to buy the shares back, it does not receive
      // it. Re-adding the gross open proceeds at the close date/rate would
      // mis-date, mis-rate, and over-state held FCY. A short's divisa leg is
      // genuinely different (inflow at open, outflow at close); the carry-basis
      // long-round-trip model can't represent it, so we skip it. A later
      // conversion of the real short profit then hits the conservative missing-lot
      // floor (gain = 0) rather than a fabricated gain.
      if (d.isShort) continue;
      if (!isEcbResolvable(d.currency)) continue; // genuine fiat FCY only
      // «Tradicional con divisa» lets every long sale through, at 0 too
      // (worthless or delisted with a zero sale, spec row 7) or below 0 (the
      // commission exceeds the gross): its lost principal books its lost-dollar
      // rows. The default skips both, as before.
      if (!traditionalFx && !d.proceedsFcy.greaterThan(0)) continue;
      events.push({
        kind: "stock_sell",
        // Dated on the sale's trade date, like the buy's park (rule R0), so the
        // parked principal and the stock FIFO run in the same trade order.
        date: normalizeDate(d.sellDate),
        currency: d.currency,
        quantity: new Decimal(0), // unused for stock_sell (amounts are in costFcy/proceedsFcy)
        costFcy: d.costBasisFcy, // principal that was parked at the matching buy
        proceedsFcy: d.proceedsFcy, // FULL net proceeds in FCY (already net of commission/taxes)
        ecbRate: d.sellEcbRate, // sale-date ECB rate (for the profit and uncovered/unmatched re-add)
        trigger: "stock_sale",
        brokerSource: d.brokerSource,
        // Per-position key (isin || symbol) — IDENTICAL derivation to the buy
        // producer, so this sell unparks ONLY its own position's principal. An
        // option-exercise/assignment STK disposal carries the underlying's
        // isin/symbol but parked nothing (no backing BUY) → no match under this
        // key → it falls through to the safe sale-rate re-add (full-proceeds).
        positionKey: FxFifoEngine.positionKey(d),
      });
    }
    return events;
  }

  /**
   * Extract the BUY-side carry-basis FX events from foreign-currency stock
   * (security) PURCHASES — the divisa-side effect of BUYING a foreign-currency
   * security (issue #230 follow-up). The companion of
   * {@link extractStockProceedsFxEvents}.
   *
   * A foreign-currency stock BUY spends `costFcy` of foreign currency. The
   * resulting `stock_buy` event makes {@link parkPrincipal} silently CONSUME that
   * FCY from the spendable pool (FIFO oldest-first) and PARK the carried EUR basis
   * inside the open position — NO disposal, NO realized gain (the buy never
   * reaches the disposal path, so it cannot re-arm the missing-prior-year-lots
   * phantom gain that PR #143/#171 removed). The matching SELL later re-adds that
   * principal at its carry; an UNCOVERED buy (no tracked funding) is a safe no-op
   * against an empty pool and the sell re-adds at the sale rate (full-proceeds
   * equivalence).
   *
   * costFcy MIRRORS fifo.ts addLot EXACTLY — `quantity × tradePrice × multiplier
   * + taxes + commissionFcy`, where a commission in a different currency is
   * homogenized to the share currency via the trade-date cross-rate
   * (`commission × rate(commCcy) / rate(shareCcy)`). This is the SAME FCY cash
   * outflow that `fifo.ts` books as the lot's `costInFcy`, so the principal parked
   * here equals the principal the SELL re-adds via `costBasisFcy` — the two sides
   * reconcile.
   *
   * SAME FILTERS AS THE SELL SIDE (engine invariant, not a DGT rule): `buySell === "BUY"`,
   * STK/FUND/BOND only, `currency ≠ EUR`, ECB-resolvable, NOT an FXCONV/AFx trade.
   * EXCLUDES short-cover buys (`openCloseIndicator === "C"`): a cover is the CLOSE
   * of a short, not a fresh FCY outflow to acquire a long position — mirroring the
   * `isShort` guard on the sell side (`extractStockProceedsFxEvents` skips short
   * closes). Uses `trade.tradeDate` for the rate, exactly like `addLot`.
   */
  static extractStockPurchaseFxEvents(trades: Trade[], rateMap: EcbRateMap, trackAutoConvert = true): FxEvent[] {
    const events: FxEvent[] = [];
    const SECURITY_CATEGORIES = new Set(["STK", "FUND", "BOND"]);
    for (const trade of trades) {
      if (trade.buySell !== "BUY") continue;
      if (!SECURITY_CATEGORIES.has(trade.assetCategory)) continue;
      if (trade.currency === "EUR") continue;
      if (!isEcbResolvable(trade.currency)) continue;
      // Skip broker auto-conversions only under the opt-out (see extractFxEvents).
      // In practice AFx/FXCONV mark CASH legs, not STK/FUND/BOND, so this rarely
      // fires — but kept symmetric with the conversion producer for the opt-out.
      if (!trackAutoConvert && FxFifoEngine.isFxconv(trade)) continue;
      // A short COVER (BUY to close, openCloseIndicator "C" or "C;O") is not a
      // fresh FCY outflow acquiring a long — it closes a short opened by a prior
      // SELL. Mirrors the isShort skip on the sell side. A plain long buy has
      // openCloseIndicator "O" (or, for some exports, absent) → not skipped.
      if (trade.openCloseIndicator === "C" || trade.openCloseIndicator === "C;O") continue;

      // Dated on the TRADE date (rule R0), like the conversions, so a same-day
      // "convert, then buy" parks the dollars it was funded with, whatever the
      // two settlement cycles are (stock T+1, FX T+2). The rate math mirrors
      // fifo.ts addLot's costInFcy exactly, commission cross-rate included, so
      // costFcy stays byte-equal to the disposal's costBasisFcy the matching
      // sell unparks.
      const cashDate = normalizeDate(trade.tradeDate || trade.settlementDate);
      const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
      // costFcy = the FCY cash outflow, MIRRORING fifo.ts addLot's costInFcy:
      // quantity × tradePrice × multiplier + taxes + commission (homogenized to
      // the share currency via the trade-date cross-rate when in another currency).
      const quantity = new Decimal(trade.quantity).abs();
      const pricePerShare = new Decimal(trade.tradePrice);
      const multiplier = new Decimal(trade.multiplier || "1");
      const taxes = new Decimal(trade.taxes || "0").abs();
      const commission = new Decimal(trade.commission || "0").negated(); // signed cost, as fifo.ts
      let commissionFcy = commission;
      if (!commission.isZero() && trade.commissionCurrency && trade.commissionCurrency !== trade.currency) {
        const commEcbRate = getEcbRate(rateMap, trade.tradeDate, trade.commissionCurrency);
        commissionFcy = commission.mul(commEcbRate).dividedBy(ecbRate);
      }
      const costFcy = quantity.mul(pricePerShare).mul(multiplier).plus(taxes).plus(commissionFcy);
      if (!costFcy.greaterThan(0)) continue; // defensive: nothing to park

      events.push({
        kind: "stock_buy",
        date: cashDate,
        currency: trade.currency,
        quantity: new Decimal(0), // unused for stock_buy (the amount spent is costFcy)
        costFcy,
        ecbRate,
        trigger: "stock_purchase",
        // Per-position key (isin || symbol) — IDENTICAL derivation to the sell
        // producer (extractStockProceedsFxEvents), so the SELL of this exact
        // position reclaims the principal parked here and no other.
        brokerSource: trade.brokerSource,
        positionKey: FxFifoEngine.positionKey(trade),
      });
    }
    return events;
  }

  /**
   * Synthetic carry-basis buy-side FX events for manual opening lots.
   *
   * A transferred opening lot has no explicit EUR->FCY funding conversion in the
   * imported statement, so the normal stock-buy producer would park it as
   * "uncovered" and silently degrade to the old full-proceeds path. For manual
   * transferred positions we DO know the acquisition date and FCY cost, so we can
   * park that whole principal as an explicitly covered slice at the acquisition
   * date's ECB rate. The later SELL then re-adds the carried principal exactly as
   * if the original funding lot had been present in the data.
   */
  static extractManualOpeningLotFxEvents(lots: ManualOpeningLot[], rateMap: EcbRateMap): FxEvent[] {
    const events: FxEvent[] = [];
    const SECURITY_CATEGORIES = new Set(["STK", "FUND", "BOND"]);

    for (const lot of lots) {
      if (!SECURITY_CATEGORIES.has(lot.assetCategory)) continue;
      if (lot.currency === "EUR") continue;
      if (!isEcbResolvable(lot.currency)) continue;

      const date = normalizeDate(lot.acquireDate);
      const ecbRate = lookupRateInMap(rateMap, date, lot.currency);
      if (ecbRate === null) continue;

      const quantity = new Decimal(lot.quantity);
      const pricePerShare = new Decimal(lot.pricePerShare);
      const costFcy = quantity.mul(pricePerShare);
      if (!costFcy.greaterThan(0)) continue;

      events.push({
        kind: "stock_buy",
        date,
        currency: lot.currency,
        quantity: new Decimal(0),
        costFcy,
        ecbRate,
        trigger: "stock_purchase",
        coveredCostPerUnit: ecbRate,
        coveredAcquireDate: date,
        positionKey: lot.isin || lot.symbol,
      });
    }

    return events;
  }

  /** Detect FXCONV (automatic broker conversions for settlement) */
  static isFxconv(trade: Trade): boolean {
    const desc = (trade.description || "").toUpperCase();
    const exch = (trade.exchange || "").toUpperCase();
    const notes = (trade.notes || "").toUpperCase().split(";");
    return (
      desc.includes("FXCONV") ||
      desc.includes("CASH RECEIPTS") ||
      desc.includes("CASH DISBURSEMENTS") ||
      exch === "FXCONV" ||
      notes.includes("AFX")
    );
  }

  /** Effective EUR-per-FCY rate for an event: the broker's real applied rate
   *  (realEurAmount / |quantity|) when supplied (issue #253), else the ECB rate.
   *  ONE helper used by BOTH addLot and consumeLots so the acquire and dispose
   *  legs are ALWAYS valued on the same basis — never a half-real/half-ECB mix. */
  private static effectiveRate(event: FxEvent): Decimal {
    // A Decimal is always truthy, so re-check finite & strictly-positive here
    // (defense-in-depth, like the rest of this file): a 0/negative/NaN
    // realEurAmount must fall back to ECB, never zero out (or sign-flip) the
    // conversion. A real EUR principal is positive by definition, so a negative
    // is rejected, not silently absorbed via abs().
    if (
      event.realEurAmount &&
      event.realEurAmount.isFinite() &&
      event.realEurAmount.greaterThan(0) &&
      event.quantity.abs().greaterThan(0)
    ) {
      return event.realEurAmount.div(event.quantity.abs());
    }
    return event.ecbRate;
  }

  private addLot(event: FxEvent): void {
    // Defense-in-depth: never create a lot for a non-positive quantity — costPerUnit
    // would be 0/0 = NaN and silently poison all later FIFO math for this currency.
    if (!event.quantity.greaterThan(0)) return;
    // Commission increases the EUR cost of acquiring the lot
    const baseCost = event.quantity.mul(FxFifoEngine.effectiveRate(event));
    const totalCost = event.commissionEur ? baseCost.plus(event.commissionEur) : baseCost;
    const costPerUnit = totalCost.div(event.quantity);

    // A late-cover part runs on its buy's date but keeps the conversion's date.
    const movedFrom = this.traditionalFx ? this.movedFrom.get(event) : undefined;
    const lot: FxLot = {
      id: `FX-${this.nextLotId++}`,
      currency: event.currency,
      acquireDate: movedFrom ?? event.date,
      quantity: event.quantity,
      costPerUnit,
      costInEur: totalCost,
      brokerSource: event.brokerSource,
    };

    if (!this.lots.has(event.currency)) {
      this.lots.set(event.currency, []);
    }
    this.lots.get(event.currency)!.push(lot);
    this.record("acquire", event, {
      quantityFcy: event.quantity,
      rate: costPerUnit,
      lotId: lot.id,
      lotAcquireDate: lot.acquireDate,
      ...(movedFrom !== undefined
        ? {
            note: `cobertura tardía: parte del cambio del ${movedFrom} adelantada a una compra sin origen de ≤ ${FxFifoEngine.LATE_COVER_DAYS} días`,
          }
        : {}),
    });
    this.accumulate("acquire", event.currency, event.quantity);
  }

  /**
   * «Tradicional con divisa»: book the shifts a consumed lot carries. The whole
   * shift goes on the disposal as `declaredShiftEur` (the two-part cost); the
   * shifts of years before the disposal feed `fx_traditional_inflight`.
   */
  private shiftsOnConsume(currency: string, disposeDate: string, q: Decimal, shifts: FxShift[] | undefined): Decimal | undefined {
    if (!shifts || shifts.length === 0) return undefined;
    const year = Number(disposeDate.slice(0, 4));
    let all = new Decimal(0);
    let earlier = new Decimal(0);
    const years = new Set<number>();
    for (const sh of shifts) {
      all = all.plus(sh.perUnit);
      if (sh.year < year) {
        earlier = earlier.plus(sh.perUnit);
        years.add(sh.year);
      }
    }
    if (years.size > 0) {
      const key = `${year}|${currency}`;
      const entry = this.tradStats.inflight.get(key) ?? { qty: new Decimal(0), amount: new Decimal(0), years: new Set<number>() };
      entry.qty = entry.qty.plus(q);
      entry.amount = entry.amount.plus(q.mul(earlier));
      for (const y of years) entry.years.add(y);
      this.tradStats.inflight.set(key, entry);
    }
    return all.isZero() ? undefined : q.mul(all);
  }

  private consumeLots(event: FxEvent): void {
    let remaining = event.quantity.abs();
    const totalQty = remaining;
    const lots = this.lots.get(event.currency);

    if (!lots || lots.length === 0) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      if (this.traditionalFx) this.shortfalls.push({ currency: event.currency, date: event.date, qty: remaining });
      const effRate = FxFifoEngine.effectiveRate(event);
      const proceedsEur = remaining.mul(effRate);
      const netProceeds = event.commissionEur ? proceedsEur.minus(event.commissionEur) : proceedsEur;
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur: netProceeds,
        costBasisEur: netProceeds,
        gainLossEur: new Decimal(0),
        trigger: event.trigger,
        holdingPeriodDays: 0,
        lotId: "UNKNOWN",
        brokerSource: event.brokerSource,
      });
      this.record("dispose", event, {
        quantityFcy: remaining,
        rate: effRate,
        costBasisEur: netProceeds,
        proceedsEur: netProceeds,
        gainLossEur: new Decimal(0),
        lotId: "UNKNOWN",
        note: "sin lotes previos → ganancia FX = 0",
      });
      this.accumulate("dispose", event.currency, remaining);
      // Floored dispose: this FCY was never acquired (no prior lot) and the pool
      // was NOT driven negative (we returned without touching this.lots). It is
      // therefore an untracked "phantom acquire" of the same qty — counting it
      // keeps the conservation identity balanced for this legitimate path.
      this.accumulate("phantom", event.currency, remaining);
      return;
    }

    const effRate = FxFifoEngine.effectiveRate(event);
    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;
      const consumed = Decimal.min(remaining, lot.quantity);

      // Commission reduces proceeds, distributed proportionally across consumed lots
      let proceedsEur = consumed.mul(effRate);
      if (event.commissionEur) {
        const proportion = consumed.div(totalQty);
        proceedsEur = proceedsEur.minus(event.commissionEur.mul(proportion));
      }
      const costBasisEur = consumed.mul(lot.costPerUnit);
      const holdingDays = daysBetween(lot.acquireDate, event.date);
      const declaredShiftEur = this.traditionalFx
        ? this.shiftsOnConsume(event.currency, event.date, consumed, lot.shifts)
        : undefined;

      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: lot.acquireDate,
        quantity: consumed,
        proceedsEur,
        costBasisEur,
        gainLossEur: proceedsEur.minus(costBasisEur),
        trigger: event.trigger,
        holdingPeriodDays: holdingDays,
        lotId: lot.id,
        brokerSource: event.brokerSource,
        acquireBrokerSource: lot.brokerSource,
        ...(declaredShiftEur !== undefined ? { declaredShiftEur } : {}),
      });

      const lotIdConsumed = lot.id;
      lot.quantity = lot.quantity.minus(consumed);
      lot.costInEur = lot.costInEur.minus(costBasisEur);

      if (lot.quantity.isZero()) {
        lots.shift();
      }

      remaining = remaining.minus(consumed);
      this.record("dispose", event, {
        quantityFcy: consumed,
        rate: effRate,
        costBasisEur,
        proceedsEur,
        gainLossEur: proceedsEur.minus(costBasisEur),
        lotId: lotIdConsumed,
        lotAcquireDate: lot.acquireDate,
      });
      this.accumulate("dispose", event.currency, consumed);
    }

    if (remaining.greaterThan(0)) {
      const entry = this.fxMissing.get(event.currency) ?? { count: 0, totalQty: new Decimal(0) };
      entry.count++;
      entry.totalQty = entry.totalQty.plus(remaining);
      this.fxMissing.set(event.currency, entry);
      if (this.traditionalFx) this.shortfalls.push({ currency: event.currency, date: event.date, qty: remaining });
      let proceedsEur = remaining.mul(effRate);
      if (event.commissionEur) {
        const proportion = remaining.div(totalQty);
        proceedsEur = proceedsEur.minus(event.commissionEur.mul(proportion));
      }
      this.disposals.push({
        currency: event.currency,
        disposeDate: event.date,
        acquireDate: event.date,
        quantity: remaining,
        proceedsEur,
        costBasisEur: proceedsEur,
        gainLossEur: new Decimal(0),
        trigger: event.trigger,
        holdingPeriodDays: 0,
        lotId: "UNKNOWN",
        brokerSource: event.brokerSource,
      });
      this.record("dispose", event, {
        quantityFcy: remaining,
        rate: effRate,
        costBasisEur: proceedsEur,
        proceedsEur,
        gainLossEur: new Decimal(0),
        lotId: "UNKNOWN",
        note: "lotes insuficientes → ganancia FX = 0",
      });
      this.accumulate("dispose", event.currency, remaining);
      // Same as the no-lots branch: the pool ran out (lots fully consumed above),
      // so this leftover is disposed FCY with no acquire behind it. Count a phantom
      // acquire to balance — the pool was not driven negative (the loop stops at
      // lots.length === 0; this floor only books gain = 0 + warns).
      this.accumulate("phantom", event.currency, remaining);
    }
  }

  /**
   * Epsilon for the carry-basis FIFO loops. The reference algorithm advances/
   * shifts a queue entry while `remaining > 1e-9` (not `> 0`), so that
   * floating-point dust never leaves a phantom sub-nano sliver behind. Decimal is
   * exact, but we mirror the same threshold so the TS reproduces the reference
   * numbers byte-for-byte and never parks/re-adds a meaningless residue.
   */
  private static readonly EPS = new Decimal("1e-9");

  /**
   * Push a re-added principal/profit slice back onto the spendable pool as a new
   * FX lot at EUR rate `rate` (EUR per 1 FCY). Mirrors {@link addLot}'s lot shape
   * (costPerUnit = rate, costInEur = q × rate) so a later conversion consumes it
   * exactly like any acquisition lot. Skips non-positive `q` (defense-in-depth:
   * a zero-quantity lot would make a later costPerUnit 0/0 = NaN).
   *
   * FIFO-ORDERED INSERTION (issue #230 fix). The spendable pool is consumed
   * oldest-first by ARRAY POSITION ({@link consumeLots} takes `lots[0]`), so the
   * array must stay sorted ascending by `acquireDate`. Plain acquisitions
   * ({@link addLot}) always arrive in (date, phase) order, so they append and the
   * array stays sorted. A SELL re-adds principal stamped with its ORIGINAL
   * acquisition date (carried through the park) — which can be EARLIER than lots
   * funded between the buy and the sale — so a tail append would mis-order the
   * pool and make a later conversion consume the wrong (newer) dollars first,
   * shifting an FX gain into the wrong tax year. We therefore SPLICE the new lot
   * into the first position whose `acquireDate` is strictly greater, keeping the
   * pool FIFO-correct. Stable for equal dates (inserts AFTER same-date lots), so
   * same-date ordering is unchanged from the old append.
   */
  private pushPoolLot(
    currency: string,
    date: string,
    q: Decimal,
    rate: Decimal,
    brokerSource?: string,
    shifts?: FxShift[],
  ): FxLot | undefined {
    if (!q.greaterThan(0)) return undefined;
    const lot: FxLot = {
      id: `FX-${this.nextLotId++}`,
      currency,
      acquireDate: date,
      quantity: q,
      costPerUnit: rate,
      costInEur: q.mul(rate),
      ...(brokerSource !== undefined ? { brokerSource } : {}),
      ...(shifts !== undefined && shifts.length > 0 ? { shifts } : {}),
    };
    if (!this.lots.has(currency)) this.lots.set(currency, []);
    const lots = this.lots.get(currency)!;
    // Insert keeping the pool sorted ascending by acquireDate (FIFO frontier).
    // Find the first lot strictly newer than this one and splice in before it;
    // if none, append. localeCompare on the ISO yyyy-mm-dd dates is a date order.
    // The pool is already sorted, so a binary search finds the same index as a
    // front-to-back scan without walking thousands of lots on every sell.
    let lo = 0;
    let hi = lots.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (lots[mid]!.acquireDate.localeCompare(date) > 0) hi = mid;
      else lo = mid + 1;
    }
    lots.splice(lo, 0, lot);
    return lot;
  }

  /**
   * STOCK_BUY — silently CONSUME the FCY a foreign-stock purchase spends from the
   * spendable pool and PARK the carried basis under the buy's POSITION key.
   *
   * Consumes `event.costFcy` from the per-currency pool FIFO oldest-first (FCY is
   * fungible for spending). For each consumed pool lot it parks `{q: consumed,
   * rate: lot.rate}` (carrying that lot's EUR acquisition basis) under the
   * composite `(currency, positionKey)` queue; any shortfall (the pool ran out)
   * parks `{q: shortfall, rate: null}` — "uncovered", funded outside the data
   * window. The pool lots are mutated exactly as {@link consumeLots} would
   * (quantity and costInEur reduced proportionally, depleted lots shifted) so a
   * later conversion sees the correct remaining balance.
   *
   * PER-POSITION PARKING: the parked basis lands under THIS position's key
   * ({@link parkKey}), so ONLY the matching SELL ({@link unparkAndReadd}) of the
   * same position reclaims it. The spendable POOL it draws from is still shared
   * per-currency — only the parked principal is partitioned by position.
   *
   * EMITS NO FxDisposal and realizes NO gain — the divisa gain on these dollars
   * defers, carried in the parked basis, until a conversion realizes it
   * (Art. 14.2.e LIRPF). This is why re-arming the missing-prior-year-lots phantom
   * GAIN is impossible here: a buy never reaches the disposal path.
   */
  /**
   * «Tradicional con divisa» tags on a parked slice: the buy's rate (`r_b`), the
   * shifts of the pool lot it came from, and its buy date and order. Empty under
   * every other method, so the default parked state is unchanged.
   */
  private traditionalTags(
    event: FxEvent,
    shifts: FxShift[] | undefined,
  ): Pick<ParkedSlice, "buyRate" | "shifts" | "parkDate"> {
    if (!this.traditionalFx) return {};
    return {
      buyRate: event.ecbRate,
      ...(shifts !== undefined && shifts.length > 0 ? { shifts } : {}),
      parkDate: event.date,
    };
  }

  private parkPrincipal(event: FxEvent): void {
    const cost = event.costFcy;
    if (!cost || !cost.greaterThan(0)) return;

    if (event.coveredCostPerUnit && event.coveredAcquireDate) {
      const parkKey = FxFifoEngine.parkKey(event.currency, event.positionKey);
      if (!this.parked.has(parkKey)) this.parked.set(parkKey, []);
      const park = this.parked.get(parkKey)!;
      park.push({
        q: cost,
        rate: event.coveredCostPerUnit,
        acquireDate: event.coveredAcquireDate,
        ...this.traditionalTags(event, undefined),
      });
      this.record("park", event, {
        quantityFcy: cost,
        rate: event.coveredCostPerUnit,
        lotAcquireDate: event.coveredAcquireDate,
        note: "lote manual cubierto",
      });
      // A manual opening lot is a real historical FCY acquisition whose funding
      // row is simply absent from the imported statement. It therefore belongs on
      // the acquire side of the conservation identity, even though we park it
      // directly instead of materializing a spendable pool lot first.
      this.accumulate("acquire", event.currency, cost);
      this.accumulate("park", event.currency, cost);
      return;
    }

    let remaining = cost;
    const EPS = FxFifoEngine.EPS;
    const parkKey = FxFifoEngine.parkKey(event.currency, event.positionKey);
    if (!this.parked.has(parkKey)) this.parked.set(parkKey, []);
    const park = this.parked.get(parkKey)!;

    const takePool = (): void => {
      const lots = this.lots.get(event.currency);
      if (!lots) return;
      while (remaining.greaterThan(EPS) && lots.length > 0) {
        const lot = lots[0]!;
        const consumed = Decimal.min(remaining, lot.quantity);
        // Carry BOTH the consumed lot's EUR basis AND its ORIGINAL acquisition
        // date, so the matching sell re-adds the principal at its true age (issue
        // #230) — not the sale date, which would mis-order the FIFO frontier.
        park.push({
          q: consumed,
          rate: lot.costPerUnit,
          acquireDate: lot.acquireDate,
          ...(lot.brokerSource !== undefined ? { brokerSource: lot.brokerSource } : {}),
          ...this.traditionalTags(event, lot.shifts),
        });
        // Reduce the pool lot in lockstep (quantity + EUR cost), shift when empty.
        const costPortion = consumed.mul(lot.costPerUnit);
        lot.quantity = lot.quantity.minus(consumed);
        lot.costInEur = lot.costInEur.minus(costPortion);
        if (lot.quantity.lessThan(EPS)) lots.shift();
        remaining = remaining.minus(consumed);
        this.record("park", event, {
          quantityFcy: consumed,
          rate: lot.costPerUnit,
          lotId: lot.id,
          lotAcquireDate: lot.acquireDate,
        });
        this.accumulate("park", event.currency, consumed);
      }
    };
    takePool();
    // «Tradicional con divisa»: a late cover adds parts to the empty pool.
    if (remaining.greaterThan(EPS) && this.cover && this.takeLateCover(event, remaining)) takePool();

    // Shortfall: the pool had no (more) tracked dollars → park uncovered (no
    // tracked origin → no carried date either; the sell re-adds it at the sale
    // date, which is correct for genuinely-untracked dollars).
    if (remaining.greaterThan(EPS)) {
      const slice: ParkedSlice = { q: remaining, rate: null, acquireDate: null, ...this.traditionalTags(event, undefined) };
      park.push(slice);
      if (this.traditionalFx) {
        const np: NullPark = { event, currency: event.currency, date: event.date, qty: remaining, gross: remaining, seq: this.nullParks.length };
        this.nullParks.push(np);
        this.nullOfSlice.set(slice, np);
      }
      this.record("park", event, {
        quantityFcy: remaining,
        rate: null,
        note: "uncovered (sin lote de origen rastreado)",
      });
      this.accumulate("park", event.currency, remaining);
      // Uncovered park: this FCY had no tracked acquisition lot (funded outside the
      // data window). It lands on the parked side (rhs) with no real acquire, so we
      // count a phantom acquire of the same qty to keep the identity balanced.
      this.accumulate("phantom", event.currency, remaining);
    }
  }

  /**
   * STOCK_SELL — re-add the carried principal of a foreign-stock SALE to the
   * spendable pool at its PARKED basis, plus the trade's profit at the sale rate.
   *
   * Pulls `event.costFcy` of principal from THIS POSITION's parked FIFO
   * (`(currency, positionKey)`, {@link parkKey}) oldest-first and re-adds it to
   * the shared per-currency pool up to `min(costFcy, proceedsFcy)` worth: a
   * parked lot with a carried basis re-adds at that basis; a `null` (uncovered)
   * parked lot re-adds at the SALE rate. Any parked principal BEYOND the proceeds
   * (a stock LOSS: you got back fewer dollars than the principal) is DISCARDED —
   * those FCY genuinely left the patrimony in the losing trade, so no FX event
   * attaches to them. If THIS POSITION's parked FIFO has no match for the sell
   * (`need` remains after the position's parked queue is exhausted), the remainder
   * is re-added at the SALE rate; that is precisely what makes an unmatched sell
   * reduce to the pre-#230 full-proceeds behavior. Finally the profit
   * (`proceedsFcy − costFcy`, when positive) is added at the sale rate as fresh
   * dollars.
   *
   * PER-POSITION UNPARK (the review fix): the parked queue is looked up by THIS
   * sell's `(currency, positionKey)`, never the bare currency, so the sell can
   * only ever reclaim the principal ITS OWN matching buy parked. A sell whose
   * position parked NOTHING — the canonical case being an OPTION
   * EXERCISE/ASSIGNMENT STK disposal (fifo.ts emits these with the underlying's
   * isin/symbol and `assetCategory:"STK"` but with NO backing BUY trade, so
   * extractStockPurchaseFxEvents never parked for it) — finds an empty/absent
   * queue under its key and falls cleanly through to the unmatched-sell sale-rate
   * re-add below (the funding-absent no-op). It can no longer drain, and mis-rate,
   * a DIFFERENT same-currency position's parked basis.
   *
   * EMITS NO FxDisposal — the FX gain defers to the eventual EUR conversion that
   * consumes these re-added pool lots (Art. 14.2.e LIRPF).
   *
   * Mirrors the reference `sell` closure exactly (REFERENCE.mjs): `placed` tracks
   * how much of `readd = min(cost, proc)` has been re-added so far; the loop
   * re-adds `give = min(parkedSlice, readd − placed)` from each parked lot and
   * always fully consumes that parked slice (the part above `readd` is the
   * discarded loss); a post-loop top-up covers an unmatched sell; the profit tail
   * adds `proc − placed`. (The reference is single-position, so its per-currency
   * `pk` queue and this per-position queue are the same queue for every case it
   * covers — the keying refinement is invisible to it.)
   */
  private unparkAndReadd(event: FxEvent): void {
    if (this.traditionalFx) {
      this.unparkTraditional(event);
      return;
    }
    const cost = event.costFcy ?? new Decimal(0);
    const proc = event.proceedsFcy ?? new Decimal(0);
    const saleRate = event.ecbRate;
    const EPS = FxFifoEngine.EPS;

    let need = cost;
    const readd = Decimal.min(cost, proc);
    let placed = new Decimal(0);
    const park = this.parked.get(FxFifoEngine.parkKey(event.currency, event.positionKey));

    if (park) {
      while (need.greaterThan(EPS) && park.length > 0) {
        const p = park[0]!;
        const x = Decimal.min(need, p.q);
        const give = Decimal.min(x, readd.minus(placed));
        let reAddedLot: FxLot | undefined;
        if (give.greaterThan(EPS)) {
          const reAddRate = p.rate === null ? saleRate : p.rate;
          // Re-add the principal at its ORIGINAL acquisition date (carried through
          // the park), so the pool stays FIFO-ordered by genuine age (issue #230).
          // An uncovered slice (no tracked origin) re-adds at the sale date.
          const reAddDate = p.acquireDate ?? event.date;
          // Same for the broker: a carried slice keeps the broker its dollars
          // came from; an uncovered one is sale proceeds, so the sale's broker.
          const reAddBroker = p.rate === null ? event.brokerSource : p.brokerSource;
          reAddedLot = this.pushPoolLot(event.currency, reAddDate, give, reAddRate, reAddBroker);
          placed = placed.plus(give);
          // Re-add recorded AFTER the parked slice is decremented below would show
          // the wrong parked balance; we decrement first, then record both moves.
        }
        // Consume the whole parked slice `x`; any part above `give` (i.e. above
        // `readd`) is the loss portion — discarded, not re-added.
        const discarded = x.minus(give);
        p.q = p.q.minus(x);
        need = need.minus(x);
        if (p.q.lessThan(EPS)) park.shift();
        if (give.greaterThan(EPS)) {
          this.record("unpark", event, {
            quantityFcy: give,
            rate: p.rate === null ? saleRate : p.rate,
            lotId: reAddedLot?.id,
            lotAcquireDate: reAddedLot?.acquireDate,
            note: p.rate === null ? "uncovered → re-añadido al tipo de venta" : undefined,
          });
          this.accumulate("unpark", event.currency, give);
        }
        if (discarded.greaterThan(EPS)) {
          // Loss-spent dollars that never returned: NO FX, never converted to EUR
          // ("como una hamburguesa en dólares"). Recorded so the audit trail shows
          // exactly what left the patrimony in the losing trade (issue #230).
          this.record("discard", event, {
            quantityFcy: discarded,
            rate: p.rate,
            note: "principal perdido en la venta — sin efecto de divisa (nunca convertido a EUR)",
          });
          this.accumulate("discard", event.currency, discarded);
        }
      }
    }

    // Unmatched sell (no parked principal left, e.g. position bought outside the
    // data window): re-add the remainder of `readd` at the sale rate. This is the
    // branch that makes a sell-without-tracked-buy equal the full-proceeds model.
    if (need.greaterThan(EPS) && placed.lessThan(readd.minus(EPS))) {
      const g = Decimal.min(need, readd.minus(placed));
      const unparkLot = this.pushPoolLot(event.currency, event.date, g, saleRate, event.brokerSource);
      placed = placed.plus(g);
      this.record("unpark", event, {
        quantityFcy: g,
        rate: saleRate,
        lotId: unparkLot?.id,
        lotAcquireDate: unparkLot?.acquireDate,
        note: "venta sin compra rastreada → re-añadido al tipo de venta (full-proceeds)",
      });
      this.accumulate("unpark", event.currency, g);
      // Unmatched sell (position bought outside the data window): this FCY is
      // re-added to the pool (rhs) with NO parked principal behind it — untracked.
      // Count a phantom acquire of the same qty so the identity balances (this is
      // the full-proceeds-equivalent no-op the carry model degrades to).
      this.accumulate("phantom", event.currency, g);
    }

    // Profit (proceeds beyond principal) = fresh dollars at the sale rate.
    const profit = proc.minus(placed);
    if (profit.greaterThan(EPS)) {
      const profitLot = this.pushPoolLot(event.currency, event.date, profit, saleRate, event.brokerSource);
      this.record("profit", event, {
        quantityFcy: profit,
        rate: saleRate,
        lotId: profitLot?.id,
        lotAcquireDate: profitLot?.acquireDate,
      });
      this.accumulate("profit", event.currency, profit);
    }
  }

  /**
   * STOCK_SELL under «Tradicional con divisa» (issue #434, spec rows 5-8).
   *
   * The traditional stock line (`FifoEngine.traditionalCostBasis`) declares
   * `P × r_s − C × r_b`, so the drift of the principal while it sat inside the
   * shares (`C × (r_s − r_b)`) is already in the stock gain or loss. The
   * currency a sale returns must therefore cost what it cost PLUS that declared
   * drift, or a later conversion would declare it a second time:
   *  - a covered slice comes back at `r_lot + r_s − r_b`, keeping its original
   *    acquisition date, with the shift recorded (`FxLot.shifts`);
   *  - a `null` (untracked) slice comes back at `r_s`, dated at the sale;
   *  - the profit `P − C` comes back at `r_s`, dated at the sale.
   * Guard (row 8): when `r_lot + r_s − r_b < 0` (about a 2× swing), the slice's
   * own drift `x × (r_b − r_lot)` is booked now as a guard row (trigger
   * `stock_sale_guard`, same figures as a lost-dollar row) and the slice comes
   * back at `r_s`. A lot never gets a negative cost.
   *
   * LOST DOLLARS (row 6, departs ON PURPOSE from the default's loss-sale rule
   * "zero in the casillas", agreed in #230 for the default only). On a loss,
   * the covered principal that does not come back left the account inside the
   * losing trade. Its drift from buying the currency to buying the shares,
   * `x × (r_b − r_lot)`, was never in the stock line (that line starts at
   * `r_b`), so this mode books it at the sale as an FX row (trigger
   * `stock_sale`, proceeds `x × r_b`, cost `x × r_lot`), as the DGT does for
   * funds in foreign currency: the drift before the purchase goes in the year of
   * the sale (V0775-21 3º, V2324-10). Without it the lifetime total breaks on
   * every loss (scenarios f, f2, l, z0, r). Zero-gain rows are skipped (graft
   * 2), so broker-AFx accounts do not inflate 1633/1637 with rows that net to 0.
   * A `null` tail books nothing.
   *
   * NEGATIVE PROCEEDS (the commission exceeds the gross): nothing comes back,
   * so the whole principal is lost as above, and the extra `|proceedsFcy|` the
   * sale took from the account consumes pool lots like a fee (trigger
   * `commission`).
   *
   * Emits no disposal on a gain. Conservation accumulators move exactly as in
   * the default path (unpark / discard / profit / phantom).
   */
  private unparkTraditional(event: FxEvent): void {
    const EPS = FxFifoEngine.EPS;
    const cost = event.costFcy ?? new Decimal(0);
    const proc = event.proceedsFcy ?? new Decimal(0);
    const saleRate = event.ecbRate;
    const saleYear = Number(event.date.slice(0, 4));
    const ccy = event.currency;

    let need = cost;
    const readdCap = Decimal.max(Decimal.min(cost, proc), 0);
    let placed = new Decimal(0);
    let lostRows = 0;
    let guardRows = 0;
    let uncoveredQty = new Decimal(0);
    const park = this.parked.get(FxFifoEngine.parkKey(ccy, event.positionKey));
    // Every lot this sale returns first covers `null` slices parked the same day.
    const covers: FxLot[] = [];
    const readd = (c: string, d: string, q: Decimal, r: Decimal, b?: string, sh?: FxShift[]): FxLot | undefined => {
      const lot = this.pushPoolLot(c, d, q, r, b, sh);
      if (lot) covers.push(lot);
      return lot;
    };

    if (park) {
      while (need.greaterThan(EPS) && park.length > 0) {
        const p = park[0]!;
        const x = Decimal.min(need, p.q);
        const give = Decimal.min(x, readdCap.minus(placed));
        const discarded = x.minus(give);
        p.q = p.q.minus(x);
        need = need.minus(x);
        if (p.q.lessThan(EPS)) park.shift();

        if (give.greaterThan(EPS)) {
          let lot: FxLot | undefined;
          let note: string;
          if (p.rate === null) {
            lot = readd(ccy, event.date, give, saleRate, event.brokerSource);
            uncoveredQty = uncoveredQty.plus(give);
            note = "uncovered → re-añadido al tipo de venta";
          } else {
            const buyRate = p.buyRate ?? saleRate;
            const shift = saleRate.minus(buyRate);
            const shifts = shift.isZero() ? p.shifts : [...(p.shifts ?? []), { year: saleYear, perUnit: shift }];
            const shifted = p.rate.plus(shift);
            if (shifted.lessThan(0)) {
              // Guard (row 8): book the slice's own drift now, re-add at r_s.
              // The guard row already reports p.shifts (they are in r_lot, its
              // cost); r_s = r_b + shift holds only this sale's shift.
              if (this.bookLostDollars(event, give, p, buyRate, "guard")) guardRows++;
              lot = readd(ccy, event.date, give, saleRate, p.brokerSource, shift.isZero() ? undefined : [{ year: saleYear, perUnit: shift }]);
              note = `guarda de coste negativo: diferencia hasta la compra declarada ahora; re-añadido al tipo de venta ${saleRate.toString()} €/${ccy}`;
            } else {
              lot = readd(ccy, p.acquireDate ?? event.date, give, shifted, p.brokerSource, shifts);
              note = `coste = ${p.rate.toString()} €/${ccy} (coste de la divisa) + ${shift.toString()} €/${ccy} (variación ya declarada en la acción)`;
            }
          }
          placed = placed.plus(give);
          this.record("unpark", event, {
            quantityFcy: give,
            rate: lot?.costPerUnit ?? saleRate,
            lotId: lot?.id,
            lotAcquireDate: lot?.acquireDate,
            note,
          });
          this.accumulate("unpark", ccy, give);
        }

        if (discarded.greaterThan(EPS)) {
          // Lost principal. A covered slice books its drift as a lost-dollar row
          // (skipped when zero); an untracked one has no drift to book.
          const cross = event.crossCurrency === true;
          const booked =
            p.rate !== null && this.bookLostDollars(event, discarded, p, p.buyRate ?? saleRate, cross ? "cross" : "lost");
          if (booked && !cross) lostRows++;
          else if (!booked) {
            this.record("discard", event, {
              quantityFcy: discarded,
              rate: p.rate,
              note: cross
                ? p.rate === null
                  ? "acciones vendidas en otra moneda, divisa sin origen rastreado: sin diferencia de cambio"
                  : "acciones vendidas en otra moneda: diferencia de cambio 0 (fila omitida)"
                : p.rate === null
                  ? "principal perdido en la venta, sin origen rastreado: sin diferencia de cambio"
                  : "principal perdido en la venta: diferencia de cambio 0 (fila omitida)",
            });
          }
          this.accumulate("discard", ccy, discarded);
        }
      }
    }

    // Unmatched sell (no parked principal: bought before the upload). Same as the
    // default: re-add at the sale rate, an untracked phantom acquire.
    if (need.greaterThan(EPS) && placed.lessThan(readdCap.minus(EPS))) {
      const g = Decimal.min(need, readdCap.minus(placed));
      const unparkLot = readd(ccy, event.date, g, saleRate, event.brokerSource);
      placed = placed.plus(g);
      this.record("unpark", event, {
        quantityFcy: g,
        rate: saleRate,
        lotId: unparkLot?.id,
        lotAcquireDate: unparkLot?.acquireDate,
        note: "venta sin compra rastreada → re-añadido al tipo de venta (full-proceeds)",
      });
      this.accumulate("unpark", ccy, g);
      this.accumulate("phantom", ccy, g);
    }

    const profit = proc.minus(placed);
    if (profit.greaterThan(EPS)) {
      const profitLot = readd(ccy, event.date, profit, saleRate, event.brokerSource);
      this.record("profit", event, {
        quantityFcy: profit,
        rate: saleRate,
        lotId: profitLot?.id,
        lotAcquireDate: profitLot?.acquireDate,
      });
      this.accumulate("profit", ccy, profit);
    }

    // Negative proceeds: the commission above the gross left the account too.
    if (proc.lessThan(EPS.negated())) {
      this.consumeLots({
        date: event.date,
        currency: ccy,
        quantity: proc,
        ecbRate: saleRate,
        trigger: "commission",
        ...(event.brokerSource !== undefined ? { brokerSource: event.brokerSource } : {}),
      });
    }

    if (this.sameDayOn.has(`${ccy}|${event.date}`)) for (const lot of covers) this.sameDayCover(lot, event);

    if (lostRows > 0) this.tradStats.lostDollarSales.push({ date: event.date, currency: ccy });
    if (guardRows > 0) this.tradStats.guardSales.push({ date: event.date, currency: ccy });
    if (uncoveredQty.greaterThan(EPS)) this.tradStats.uncovered.push({ date: event.date, currency: ccy, qty: uncoveredQty });
  }

  /**
   * One lost-dollar row (spec row 6 / guard row 8): `q` units of a covered
   * parked slice leave the account at the sale. Proceeds `q × r_b`, cost
   * `q × r_lot`. Returns false (and books nothing) when the gain is zero.
   * A guard row (`guard`) has the same figures, but the currency came back, so
   * it carries its own trigger (`stock_sale_guard`) and its own message.
   */
  private bookLostDollars(
    event: FxEvent,
    q: Decimal,
    p: ParkedSlice,
    buyRate: Decimal,
    kind: "lost" | "guard" | "cross" = "lost",
  ): boolean {
    const trigger = kind === "guard" ? "stock_sale_guard" : kind === "cross" ? "stock_sale_cross" : "stock_sale";
    const rate = p.rate!;
    const proceedsEur = q.mul(buyRate);
    const costBasisEur = q.mul(rate);
    const gainLossEur = proceedsEur.minus(costBasisEur);
    if (gainLossEur.isZero()) return false;
    const acquireDate = p.acquireDate ?? event.date;
    const declaredShiftEur = this.shiftsOnConsume(event.currency, event.date, q, p.shifts);
    this.disposals.push({
      currency: event.currency,
      disposeDate: event.date,
      acquireDate,
      quantity: q,
      proceedsEur,
      costBasisEur,
      gainLossEur,
      trigger,
      holdingPeriodDays: daysBetween(acquireDate, event.date),
      lotId: "PARKED",
      ...(event.brokerSource !== undefined ? { brokerSource: event.brokerSource } : {}),
      ...(p.brokerSource !== undefined ? { acquireBrokerSource: p.brokerSource } : {}),
      ...(declaredShiftEur !== undefined ? { declaredShiftEur } : {}),
    });
    this.record("dispose", kind === "lost" ? event : { ...event, trigger }, {
      quantityFcy: q,
      rate: buyRate,
      costBasisEur,
      proceedsEur,
      gainLossEur,
      lotAcquireDate: acquireDate,
      note:
        kind === "guard"
          ? "guarda de coste negativo: diferencia de cambio desde la compra de la divisa hasta la compra de las acciones"
          : kind === "cross"
            ? "acciones vendidas en otra moneda: diferencia de cambio desde la compra de la divisa hasta la compra de las acciones"
            : "divisa perdida en la venta: diferencia de cambio desde su compra hasta la compra de las acciones",
    });
    return true;
  }

  /**
   * Same-day cover (see {@link processTraditional}): `lot`, returned by a sale,
   * covers the `null` slices of its currency parked on the sale's date, oldest
   * first: in the order their buys ran, across every position (a trap: walking
   * the parked map covered the position whose queue was created first, so an
   * older position's later buy took the dollars before an earlier buy of a
   * newer position, and FX moved between years). A covered slice takes the
   * lot's cost, date and shifts and keeps its `buyRate`. The covered quantity
   * leaves the pool (it paid for the shares) and the phantom acquire the
   * `null` park counted is taken back, so the conservation check still
   * balances.
   */
  private sameDayCover(lot: FxLot, event: FxEvent): void {
    const EPS = FxFifoEngine.EPS;
    const prefix = `${event.currency}|`;
    // The day's `null` slices of this currency, in the order their buys parked.
    const open: { key: string; slices: ParkedSlice[]; slice: ParkedSlice; seq: number }[] = [];
    for (const [key, slices] of this.parked) {
      if (key !== event.currency && !key.startsWith(prefix)) continue;
      for (const slice of slices) {
        if (slice.rate !== null || slice.parkDate !== event.date) continue;
        open.push({ key, slices, slice, seq: this.nullOfSlice.get(slice)?.seq ?? Number.MAX_SAFE_INTEGER });
      }
    }
    open.sort((a, b) => a.seq - b.seq);
    for (const { key, slices, slice } of open) {
      if (!lot.quantity.greaterThan(EPS)) break;
      const i = slices.indexOf(slice);
      const x = Decimal.min(slice.q, lot.quantity);
      const covered: ParkedSlice = {
        q: x,
        rate: lot.costPerUnit,
        acquireDate: lot.acquireDate,
        ...(lot.brokerSource !== undefined ? { brokerSource: lot.brokerSource } : {}),
        ...(slice.buyRate !== undefined ? { buyRate: slice.buyRate } : {}),
        ...(lot.shifts !== undefined ? { shifts: lot.shifts } : {}),
        parkDate: slice.parkDate,
      };
      if (x.greaterThanOrEqualTo(slice.q.minus(EPS))) slices[i] = covered;
      else {
        slice.q = slice.q.minus(x);
        slices.splice(i, 0, covered);
      }
      const np = this.nullOfSlice.get(slice);
      if (np) np.qty = np.qty.minus(x);
      lot.quantity = lot.quantity.minus(x);
      lot.costInEur = lot.costInEur.minus(x.mul(lot.costPerUnit));
      this.record("park", { ...event, positionKey: key === event.currency ? undefined : key.slice(prefix.length) }, {
        quantityFcy: x,
        rate: lot.costPerUnit,
        lotId: lot.id,
        lotAcquireDate: lot.acquireDate,
        note: "cobertura del mismo día: compra sin origen cubierta con la divisa de una venta de ese día",
      });
      this.accumulate("phantom", event.currency, x.negated());
    }
    if (!lot.quantity.greaterThan(EPS)) {
      const pool = this.lots.get(event.currency)!;
      const idx = pool.indexOf(lot);
      if (idx >= 0) pool.splice(idx, 1);
    }
  }

  getDisposals(): FxDisposal[] {
    return this.disposals;
  }

  getRemainingLots(): Map<string, FxLot[]> {
    return this.lots;
  }

  /**
   * Remaining PARKED principal (principal in still-open foreign-stock positions).
   * Keyed per position by {@link parkKey}: `${currency}|${positionKey}` for
   * production events, or the bare `${currency}` for positionKey-less events
   * (reference/unit harnesses). Whatever stays here at the end is principal in
   * positions still open at the period boundary — never converted, never taxed.
   */
  getParked(): Map<string, ParkedSlice[]> {
    return this.parked;
  }

  /** What «Tradicional con divisa» saw during the last run (empty otherwise). */
  getTraditionalStats(): TraditionalFxStats {
    return this.tradStats;
  }
}
