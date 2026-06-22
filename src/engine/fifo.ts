/**
 * FIFO (First In, First Out) cost basis engine.
 *
 * Spanish tax law (Art. 37.2 LIRPF) mandates FIFO for calculating
 * capital gains on securities. This engine tracks lots and computes
 * gains/losses using ECB official exchange rates.
 */

import Decimal from "decimal.js";
import type { Lot, FifoDisposal, TaxMessage } from "../types/tax.js";
import type { Trade, CorporateAction, OptionExercise } from "../types/ibkr.js";
import type { EcbRateMap } from "../types/ecb.js";
import { getEcbRate, isEcbResolvable } from "./ecb.js";
import { daysBetween, normalizeDate } from "./dates.js";

/** Known asset categories — warn on unknown values to catch future IBKR additions */
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([
  "STK",
  "OPT",
  "FUT",
  "FOP",
  "FSFOP",
  "CASH",
  "BOND",
  "FUND",
  "WAR",
  "CRYPTO",
  "CFD",
  "CMDTY",
]);

/** Lot grouping key: ISIN when available; conid for IBKR instruments without ISIN (survives ticker renames); otherwise asset category + symbol */
function lotKey(trade: { isin: string; symbol: string; assetCategory: string; conid?: string }): string {
  if (trade.assetCategory === "CRYPTO") return `CRYPTO:${trade.symbol.toUpperCase()}`;
  if (trade.isin) return trade.isin;
  if (trade.conid) return `${trade.assetCategory}:conid:${trade.conid}`;
  return `${trade.assetCategory}:${trade.symbol}`;
}

export class FifoEngine {
  /** FIFO queue per security (ISIN or symbol) — long positions */
  private lots: Map<string, Lot[]> = new Map();
  /** FIFO queue per security — short positions (opened via SELL+O) */
  private shortLots: Map<string, Lot[]> = new Map();
  private disposals: FifoDisposal[] = [];
  private nextLotId = 1;
  /**
   * Monodivisa (traditional) mode. When true, a foreign-currency security's cost
   * basis is converted at the ACQUISITION-date rate (Art. 35.1 "importe real por
   * el que la adquisición se hubiese efectuado"), embedding the buy→sale FX drift
   * in the stock line — what some advisors do. When false (rigorous
   * default), a same-fiat security uses the sale-date rate (DGT V2422-20) and the
   * drift is realized separately by the FX engine. Driven by `skipFx` (monodivisa)
   * in report.ts; the two states are coherent (never traditional-cost WITH the FX
   * engine on, which would double-count the drift). See disposalEur().
   */
  private traditionalCostBasis: boolean;

  constructor(options?: { traditionalCostBasis?: boolean }) {
    this.traditionalCostBasis = options?.traditionalCostBasis ?? false;
  }
  /** Warnings for issues that don't block execution */
  warnings: string[] = [];
  /** Structured messages with severity, hint, and context */
  messages: TaxMessage[] = [];

  private emit(msg: TaxMessage): void {
    this.messages.push(msg);
    this.warnings.push(msg.message);
  }

  /**
   * Process trades and corporate actions together, sorted chronologically.
   * Buys add lots; sells consume lots via FIFO; splits adjust lots.
   */
  processTrades(
    trades: Trade[],
    rateMap: EcbRateMap,
    corporateActions?: CorporateAction[],
    optionExercises?: OptionExercise[],
  ): FifoDisposal[] {
    // Process securities: STK, FUND, OPT, FUT, BOND, CFD, CRYPTO, CMDTY
    // Excluded: WAR (warrants — insufficient data), CASH (FX conversions —
    // gain/loss already embedded in securities trades via ECB rate conversion)
    const optionEaeKeys = new Set((optionExercises ?? []).map((ex) => (ex.conid ? `conid:${ex.conid}` : ex.symbol)));
    const sorted = [...trades]
      .filter((t) => {
        if (!KNOWN_CATEGORIES.has(t.assetCategory)) {
          this.emit({
            id: "fifo.unknown_category",
            severity: "info",
            message: `⚠ Categoría de activo desconocida: "${t.assetCategory}" para ${t.symbol}. Se procesará con FIFO genérico.`,
            hint: "Se procesa igualmente con FIFO genérico. Si es un activo nuevo de IBKR, puede que se añada en futuras versiones.",
            context: { symbol: t.symbol, assetCategory: t.assetCategory },
          });
        }
        // Skip option BookTrades for exercises/expirations only when a matching OptionEAE exists
        // (IBKR generates both a BookTrade with notes="Ep"/"Ex" and an OptionEAE event)
        if (
          optionEaeKeys.size > 0 &&
          (t.assetCategory === "OPT" || t.assetCategory === "FOP" || t.assetCategory === "FSFOP")
        ) {
          const notes = (t.notes || "").split(";");
          if (notes.includes("Ep") || notes.includes("Ex")) {
            const tradeKey = t.conid ? `conid:${t.conid}` : t.symbol;
            if (optionEaeKeys.has(tradeKey)) return false;
          }
        }
        return t.assetCategory !== "WAR" && t.assetCategory !== "CASH";
      })
      .sort((a, b) => {
        const cmp = normalizeDate(a.tradeDate).localeCompare(normalizeDate(b.tradeDate));
        if (cmp !== 0) return cmp;
        // Same date: opens before closes (handles both longs and shorts correctly)
        const phase = (t: Trade): number => (t.openCloseIndicator === "O" ? 0 : t.openCloseIndicator === "C" ? 1 : 0);
        const phaseCmp = phase(a) - phase(b);
        if (phaseCmp !== 0) return phaseCmp;
        // Within same phase: BUYs before SELLs to avoid "sell without lots" on longs
        if (a.buySell !== b.buySell) return a.buySell === "BUY" ? -1 : 1;
        return 0;
      });

    // Parse splits from corporate actions (deduplicate by ISIN+date)
    const splitMap = new Map<string, { isin: string; date: string; ratio: number }>();
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "FS")) {
      const ratioMatch = ca.description.match(/SPLIT\s+(\d+)\s+FOR\s+(\d+)/i);
      const ratio = ratioMatch ? parseInt(ratioMatch[1]!) / parseInt(ratioMatch[2]!) : 0;
      if (ratio <= 0) continue;
      const date = normalizeDate(ca.dateTime.slice(0, 8));
      const key = `${ca.isin}:${date}`;
      if (!splitMap.has(key)) {
        splitMap.set(key, { isin: ca.isin, date, ratio });
      }
    }
    const splits = [...splitMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Parse mergers (TC = Tender/Change / Acquisition) from corporate actions
    const mergers: {
      date: string;
      oldIsin: string;
      newIsin: string;
      newSymbol: string;
      newDescription: string;
      ratio: number;
    }[] = [];
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "TC")) {
      // IBKR description: "TENDER OFFER OLD_SYM(OLD_ISIN) MERGED(Acquisition) FOR RATIO NEW_SYM(NEW_ISIN)"
      // Also handle: "OLD_SYM(OLD_ISIN) MERGED(Acquisition) WITH NEW_SYM(NEW_ISIN) RATIO FOR 1"
      const mergeMatch = ca.description.match(
        /(\w+)\(([A-Z0-9]+)\)\s+MERGED.*?(\d+(?:\.\d+)?)\s+(?:FOR\s+)?(\d+(?:\.\d+)?)?\s*(\w+)\(([A-Z0-9]+)\)/i,
      );
      if (mergeMatch) {
        const oldIsin = mergeMatch[2]!;
        const newIsin = mergeMatch[6]!;
        const newSymbol = mergeMatch[5]!;
        const ratioNew = parseFloat(mergeMatch[3]!);
        const ratioOld = parseFloat(mergeMatch[4] ?? "1");
        const date = normalizeDate(ca.dateTime.slice(0, 8));
        mergers.push({ date, oldIsin, newIsin, newSymbol, newDescription: ca.description, ratio: ratioNew / ratioOld });
        continue;
      }
      // Simpler format: just transfer all lots from old ISIN to new ISIN
      if (ca.isin && ca.quantity) {
        const qty = new Decimal(ca.quantity);
        if (!qty.isZero()) {
          const date = normalizeDate(ca.dateTime.slice(0, 8));
          mergers.push({
            date,
            oldIsin: ca.isin,
            newIsin: ca.isin, // Same ISIN if no new one detected
            newSymbol: ca.symbol,
            newDescription: ca.description,
            ratio: 1,
          });
        }
      }
    }
    const sortedMergers = mergers.sort((a, b) => a.date.localeCompare(b.date));

    // Parse spin-offs (SO) from corporate actions
    const spinOffs: {
      date: string;
      parentIsin: string;
      newIsin: string;
      newSymbol: string;
      newDescription: string;
      ratio: number;
      costFraction: number;
    }[] = [];
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "SO")) {
      // IBKR: "PARENT_SYM(PARENT_ISIN) SPINOFF RATIO FOR 1 NEW_SYM(NEW_ISIN)"
      const soMatch = ca.description.match(
        /(\w+)\(([A-Z0-9]+)\)\s+SPINOFF\s+(\d+(?:\.\d+)?)\s+FOR\s+(\d+(?:\.\d+)?)\s+(\w+)\(([A-Z0-9]+)\)/i,
      );
      if (soMatch) {
        const parentIsin = soMatch[2]!;
        const newIsin = soMatch[6]!;
        const newSymbol = soMatch[5]!;
        const ratioNew = parseFloat(soMatch[3]!);
        const ratioOld = parseFloat(soMatch[4]!);
        const date = normalizeDate(ca.dateTime.slice(0, 8));
        // Cost-basis split fraction for the spin-off entity.
        //
        // FISCAL NOTE: the correct apportionment is by relative FAIR-MARKET VALUE
        // (parent vs spun-off) on the distribution date, not by share count. However,
        // the IBKR CorporateAction record (see types/ibkr.ts) carries only `quantity`
        // and `amount` (=0 for SO events) — it provides NO fair-market-value data for
        // either the parent or the new entity. With no value data available, the share
        // ratio is the only proxy we can compute without fabricating numbers. If a future
        // data source exposes FMVs, switch this to (spinoffValue / (parentValue + spinoffValue)).
        const costFraction = ratioNew / (ratioNew + ratioOld);
        spinOffs.push({
          date,
          parentIsin,
          newIsin,
          newSymbol,
          newDescription: ca.description,
          ratio: ratioNew / ratioOld,
          costFraction,
        });
      }
    }
    const sortedSpinOffs = spinOffs.sort((a, b) => a.date.localeCompare(b.date));

    const sortedOptionExercises = [...(optionExercises ?? [])].sort((a, b) =>
      normalizeDate(a.date).localeCompare(normalizeDate(b.date)),
    );

    // Parse scrip dividends into timeline events (applied chronologically, not upfront)
    const scripDivs: {
      key: string;
      isin: string;
      symbol: string;
      description: string;
      date: string;
      quantity: Decimal;
      pricePerShare: Decimal;
      costInFcy: Decimal;
      currency: string;
      ecbRate: Decimal;
    }[] = [];
    for (const ca of (corporateActions ?? []).filter((ca) => ca.type === "SD")) {
      const qty = new Decimal(ca.quantity);
      if (qty.isZero()) continue;
      const amount = new Decimal(ca.amount).abs(); // already in ca.currency (FCY)
      const date = normalizeDate(ca.dateTime.slice(0, 8));
      const ecbRate = getEcbRate(rateMap, date, ca.currency);
      scripDivs.push({
        key: ca.isin || ca.symbol,
        isin: ca.isin,
        symbol: ca.symbol,
        description: ca.description,
        date,
        quantity: qty.abs(),
        pricePerShare: amount.dividedBy(qty.abs()),
        costInFcy: amount,
        currency: ca.currency,
        ecbRate,
      });
      this.emit({
        id: "fifo.scrip_dividend",
        severity: "info",
        message: `📈 Scrip dividend: ${ca.symbol} +${qty.abs()} acciones el ${date}`,
        hint: "El scrip dividend se ha añadido como lote con coste igual al valor del dividendo.",
        context: { symbol: ca.symbol, date, quantity: qty.abs().toString() },
      });
    }
    const sortedScripDivs = scripDivs.sort((a, b) => a.date.localeCompare(b.date));

    // Merge trades, splits, scrip dividends, mergers, and spin-offs into a single chronological timeline
    let splitIdx = 0;
    let sdIdx = 0;
    let mergerIdx = 0;
    let spinOffIdx = 0;
    let optionIdx = 0;

    for (const trade of sorted) {
      const tradeDate = normalizeDate(trade.tradeDate);
      // Apply any splits that occur before this trade
      while (splitIdx < splits.length && splits[splitIdx]!.date <= tradeDate) {
        this.applySplit(splits[splitIdx]!);
        splitIdx++;
      }
      // Apply any scrip dividends that occur before this trade
      while (sdIdx < sortedScripDivs.length && sortedScripDivs[sdIdx]!.date <= tradeDate) {
        this.addScripDividendLot(sortedScripDivs[sdIdx]!);
        sdIdx++;
      }
      // Apply any mergers that occur before this trade
      while (mergerIdx < sortedMergers.length && sortedMergers[mergerIdx]!.date <= tradeDate) {
        this.applyMerger(sortedMergers[mergerIdx]!);
        mergerIdx++;
      }
      // Apply any spin-offs that occur before this trade
      while (spinOffIdx < sortedSpinOffs.length && sortedSpinOffs[spinOffIdx]!.date <= tradeDate) {
        this.applySpinOff(sortedSpinOffs[spinOffIdx]!);
        spinOffIdx++;
      }
      // Apply option exercises/assignments before later trades on the same day,
      // so exercised shares are available for subsequent disposals.
      while (
        optionIdx < sortedOptionExercises.length &&
        normalizeDate(sortedOptionExercises[optionIdx]!.date) <= tradeDate
      ) {
        this.processOptionExercises([sortedOptionExercises[optionIdx]!], rateMap);
        optionIdx++;
      }

      const oci = trade.openCloseIndicator;
      if (trade.buySell === "SELL" && oci === "O") {
        this.addShortLot(trade, rateMap);
      } else if (trade.buySell === "BUY" && oci === "C") {
        this.consumeShortLots(trade, rateMap);
      } else if (oci === "C;O") {
        this.emit({
          id: "fifo.roll_operation",
          severity: "info",
          message: `⚠ Operación C;O (roll): ${trade.symbol} el ${normalizeDate(trade.tradeDate)}. Se procesa como cierre + apertura.`,
          hint: "Operación roll procesada correctamente como cierre de la posición anterior y apertura de la nueva.",
          context: { symbol: trade.symbol, date: normalizeDate(trade.tradeDate) },
        });
        if (trade.buySell === "BUY") {
          this.consumeShortLots(trade, rateMap);
        } else {
          this.consumeLots(trade, rateMap);
        }
      } else if (trade.buySell === "BUY") {
        this.addLot(trade, rateMap);
      } else {
        this.consumeLots(trade, rateMap);
      }
    }

    // Apply remaining events after all trades
    while (splitIdx < splits.length) {
      this.applySplit(splits[splitIdx]!);
      splitIdx++;
    }
    while (sdIdx < sortedScripDivs.length) {
      this.addScripDividendLot(sortedScripDivs[sdIdx]!);
      sdIdx++;
    }
    while (mergerIdx < sortedMergers.length) {
      this.applyMerger(sortedMergers[mergerIdx]!);
      mergerIdx++;
    }
    while (spinOffIdx < sortedSpinOffs.length) {
      this.applySpinOff(sortedSpinOffs[spinOffIdx]!);
      spinOffIdx++;
    }
    while (optionIdx < sortedOptionExercises.length) {
      this.processOptionExercises([sortedOptionExercises[optionIdx]!], rateMap);
      optionIdx++;
    }

    return this.disposals;
  }

  private applySplit(split: { isin: string; date: string; ratio: number }): void {
    const lots = this.lots.get(split.isin);
    if (!lots || lots.length === 0) return;

    const ratio = new Decimal(split.ratio);
    for (const lot of lots) {
      // Multiply quantity by ratio, keep total cost the same
      lot.quantity = lot.quantity.mul(ratio);
      lot.pricePerShare = lot.pricePerShare.dividedBy(ratio);
      // costInFcy stays the same — total cost doesn't change on a split
    }

    // Remove sub-share lots after split (fractional remainders become cash-in-lieu)
    const remaining = lots.filter((l) => l.quantity.greaterThanOrEqualTo(1));
    if (remaining.length < lots.length) {
      this.lots.set(split.isin, remaining);
    }

    const direction = split.ratio >= 1 ? "forward" : "reverse";
    this.emit({
      id: "fifo.split_applied",
      severity: "info",
      message: `⚡ Split ${split.isin} ${split.ratio}:1 (${direction}) aplicado (${split.date})`,
      hint: "Split aplicado a todos los lotes. El coste total se mantiene — solo cambia el número de acciones.",
      context: { isin: split.isin, date: split.date, ratio: `${split.ratio}:1`, direction },
    });
  }

  private addScripDividendLot(sd: {
    key: string;
    isin: string;
    symbol: string;
    description: string;
    date: string;
    quantity: Decimal;
    pricePerShare: Decimal;
    costInFcy: Decimal;
    currency: string;
    ecbRate: Decimal;
  }): void {
    const lot: Lot = {
      id: `LOT-${this.nextLotId++}`,
      isin: sd.isin,
      symbol: sd.symbol,
      description: sd.description,
      acquireDate: sd.date,
      quantity: sd.quantity,
      pricePerShare: sd.pricePerShare,
      costInFcy: sd.costInFcy,
      currency: sd.currency,
      ecbRate: sd.ecbRate,
    };
    if (!this.lots.has(sd.key)) {
      this.lots.set(sd.key, []);
    }
    this.lots.get(sd.key)!.push(lot);
  }

  private applyMerger(merger: {
    date: string;
    oldIsin: string;
    newIsin: string;
    newSymbol: string;
    newDescription: string;
    ratio: number;
  }): void {
    const oldLots = this.lots.get(merger.oldIsin);
    if (!oldLots || oldLots.length === 0) return;

    const ratio = new Decimal(merger.ratio);

    // Transfer all lots from old ISIN to new ISIN, adjusting quantity by ratio
    // Total cost basis is preserved (tax-neutral exchange)
    const newLots: Lot[] = [];
    for (const lot of oldLots) {
      const newQuantity = lot.quantity.mul(ratio);
      newLots.push({
        ...lot,
        id: `LOT-${this.nextLotId++}`,
        isin: merger.newIsin,
        symbol: merger.newSymbol,
        description: merger.newDescription,
        quantity: newQuantity,
        pricePerShare: lot.costInFcy.dividedBy(newQuantity), // Recalculate per-share cost
        // costInFcy preserved — total cost basis unchanged (tax-neutral exchange)
      });
    }

    // Remove old lots, add new ones
    this.lots.delete(merger.oldIsin);
    if (!this.lots.has(merger.newIsin)) {
      this.lots.set(merger.newIsin, []);
    }
    this.lots.get(merger.newIsin)!.push(...newLots);

    this.emit({
      id: "fifo.merger_applied",
      severity: "info",
      message: `🔄 Fusión: ${merger.oldIsin} → ${merger.newIsin} (ratio ${merger.ratio}:1, ${oldLots.length} lotes transferidos, ${merger.date})`,
      hint: "Fusión fiscal neutra: los lotes se transfieren al nuevo ISIN conservando el coste base original.",
      context: {
        oldIsin: merger.oldIsin,
        newIsin: merger.newIsin,
        date: merger.date,
        ratio: `${merger.ratio}:1`,
        lotsTransferred: String(oldLots.length),
      },
    });
  }

  private applySpinOff(spinOff: {
    date: string;
    parentIsin: string;
    newIsin: string;
    newSymbol: string;
    newDescription: string;
    ratio: number;
    costFraction: number;
  }): void {
    const parentLots = this.lots.get(spinOff.parentIsin);
    if (!parentLots || parentLots.length === 0) return;

    const ratio = new Decimal(spinOff.ratio);
    const costFraction = new Decimal(spinOff.costFraction);
    const parentFraction = new Decimal(1).minus(costFraction);

    // For each parent lot: split cost basis proportionally and create new lot for spin-off
    const newLots: Lot[] = [];
    for (const lot of parentLots) {
      const spinOffCost = lot.costInFcy.mul(costFraction);
      const spinOffQuantity = lot.quantity.mul(ratio);

      // Reduce parent lot cost basis (in FCY)
      lot.costInFcy = lot.costInFcy.mul(parentFraction);
      lot.pricePerShare = lot.costInFcy.dividedBy(lot.quantity);

      // Create new lot for spin-off entity
      newLots.push({
        id: `LOT-${this.nextLotId++}`,
        isin: spinOff.newIsin,
        symbol: spinOff.newSymbol,
        description: spinOff.newDescription,
        acquireDate: lot.acquireDate, // Inherit original acquisition date
        quantity: spinOffQuantity,
        pricePerShare: spinOffCost.dividedBy(spinOffQuantity),
        costInFcy: spinOffCost,
        currency: lot.currency,
        ecbRate: lot.ecbRate,
      });
    }

    if (!this.lots.has(spinOff.newIsin)) {
      this.lots.set(spinOff.newIsin, []);
    }
    this.lots.get(spinOff.newIsin)!.push(...newLots);

    this.emit({
      id: "fifo.spinoff_applied",
      severity: "info",
      message: `🔀 Spin-off: ${spinOff.parentIsin} → ${spinOff.newIsin} (ratio ${spinOff.ratio}:1, coste ${(spinOff.costFraction * 100).toFixed(0)}% al spin-off, ${spinOff.date})`,
      hint: "El coste se reparte proporcionalmente entre la matriz y la empresa escindida.",
      context: {
        parentIsin: spinOff.parentIsin,
        newIsin: spinOff.newIsin,
        date: spinOff.date,
        ratio: `${spinOff.ratio}:1`,
        costPercent: (spinOff.costFraction * 100).toFixed(0),
      },
    });
  }

  /**
   * Homogenize a commission/fee into the trade's (share) currency. If the
   * commission is already in the share currency (or zero), it's returned as-is.
   * Otherwise it's converted via the trade-date cross-rate
   * `commission × rate(commCcy) / rate(shareCcy)` — keeping the lot
   * single-currency so the FCY gain stays a clean subtraction (DGT V2422-20).
   */
  private homogenizeCommission(commission: Decimal, trade: Trade, shareEcbRate: Decimal, rateMap: EcbRateMap): Decimal {
    if (commission.isZero() || !trade.commissionCurrency || trade.commissionCurrency === trade.currency) {
      return commission;
    }
    const commEcbRate = getEcbRate(rateMap, trade.tradeDate, trade.commissionCurrency);
    return commission.mul(commEcbRate).dividedBy(shareEcbRate);
  }

  /**
   * Convert a disposal's FCY proceeds/cost to EUR. `lot`/`sell` each carry the
   * ECB rate (EUR per 1 unit) and the currency of that leg.
   *
   * DGT V2422-20 (the #219 fix): for a foreign-currency SECURITY, acquisition
   * and disposal are in the SAME fiat currency (buy a USD stock, sell it in USD),
   * so the gain is computed in that currency and converted to EUR at the SALE-date
   * rate only — the buy↔sale FX drift is a separate patrimonial element (Art. 33),
   * handled by the FX engine, and must not leak into the security gain. There we
   * apply `sell.rate` to BOTH legs (proceedsEur − costBasisEur === gainLossEur).
   *
   * That rule is valid ONLY when the shared currency is a genuine fiat/stablecoin
   * whose buy↔sale move is a separately-taxed FX element. Crypto breaks it two ways:
   *  - Cross-currency permuta (buy USDC paying EUR, sell USDC for BTC): the legs
   *    are in different coins, so there is no shared currency to defer.
   *  - SAME volatile coin on both legs (a coin acquired via ETH→X and later
   *    disposed via X→ETH carries `currency:"ETH"` on both sides): the currencies
   *    match by string, but "ETH" is not a currency whose drift is deferred — its
   *    price move IS part of the permuta gain.
   * In both crypto cases the cost is the EUR actually paid at acquisition
   * (Art. 35.1 valor de adquisición) = `costBasisFcy × lot.rate` — NOT scaled by
   * the disposal coin's huge EUR price (which fabricated a multi-million cost
   * basis). So the sale-date rate is used for the cost ONLY when both legs share a
   * currency AND that currency is genuinely ECB-resolvable (fiat/stablecoin);
   * otherwise the acquisition-date rate is used. Proceeds always use the sale-date
   * rate; the gain is their difference (Art. 37.1.h).
   *
   * Monodivisa (`traditionalCostBasis`): even for a same-fiat security the cost
   * uses the ACQUISITION-date rate (Art. 35.1), so the buy→sale FX drift stays
   * embedded in the stock line instead of being deferred to the (disabled) FX
   * engine — reproducing the traditional method some advisors use.
   */
  private disposalEur(
    proceedsFcy: Decimal,
    costBasisFcy: Decimal,
    lot: { rate: Decimal; currency: string },
    sell: { rate: Decimal; currency: string },
  ): { proceedsEur: Decimal; costBasisEur: Decimal; gainLossEur: Decimal } {
    const proceedsEur = proceedsFcy.mul(sell.rate);
    // V2422-20 (cost at the sale-date rate) applies only to a genuine fiat/
    // stablecoin security where both legs share that currency. Any crypto leg
    // (cross-currency permuta, or the same VOLATILE coin on both sides) → cost
    // at the acquisition-date rate (the real EUR paid, Art. 35.1).
    const sameFiat = lot.currency === sell.currency && isEcbResolvable(sell.currency);
    const costBasisEur = costBasisFcy.mul(
      sameFiat && !this.traditionalCostBasis ? sell.rate : lot.rate,
    );
    return { proceedsEur, costBasisEur, gainLossEur: proceedsEur.minus(costBasisEur) };
  }

  private addLot(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    const quantity = new Decimal(trade.quantity).abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");
    const commission = new Decimal(trade.commission).abs();
    const taxes = new Decimal(trade.taxes || "0").abs();
    // Cost basis is kept in the share's currency (FCY). A commission in a
    // DIFFERENT currency is homogenized to the share currency via the trade-date
    // cross-rate (rate(commCcy)/rate(shareCcy)), so the lot stays single-currency
    // and the gain is later a clean FCY subtraction (DGT V2422-20).
    const commissionFcy = this.homogenizeCommission(commission, trade, ecbRate, rateMap);
    const costInFcy = quantity.mul(pricePerShare).mul(multiplier).plus(taxes).plus(commissionFcy);

    const lot: Lot = {
      id: `LOT-${this.nextLotId++}`,
      isin: trade.isin,
      symbol: trade.symbol,
      description: trade.description,
      acquireDate: trade.tradeDate,
      quantity,
      pricePerShare,
      costInFcy,
      currency: trade.currency,
      ecbRate,
      ...(trade.assetCategory === "OPT" || trade.assetCategory === "FOP" || trade.assetCategory === "FSFOP"
        ? {
            putCall: trade.putCall,
            strike: trade.strike,
            expiry: trade.expiry,
            underlyingSymbol: trade.underlyingSymbol,
            underlyingIsin: trade.underlyingIsin,
          }
        : {}),
    };

    const key = lotKey(trade);
    if (!this.lots.has(key)) {
      this.lots.set(key, []);
    }
    this.lots.get(key)!.push(lot);
  }

  private consumeLots(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    let remaining = new Decimal(trade.quantity).abs();
    const commission = new Decimal(trade.commission).abs();
    const taxes = new Decimal(trade.taxes || "0").abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");
    // Commission homogenized to the share currency (FCY) — same treatment as the
    // acquisition cost, so proceeds and cost net cleanly in one currency.
    const commissionFcy = this.homogenizeCommission(commission, trade, ecbRate, rateMap);

    // Build a disposal record sharing this trade's identity fields. The three
    // call sites below (no lots, FIFO-consumed lot, remaining shortfall) only
    // vary in the per-lot numeric fields and the optional option metadata, so the
    // ~20 constant fields are filled once here to avoid 3 near-duplicate literals.
    const buildDisposal = (parts: {
      acquireDate: string;
      quantity: Decimal;
      gainLossFcy: Decimal;
      proceedsFcy: Decimal;
      costBasisFcy: Decimal;
      proceedsEur: Decimal;
      costBasisEur: Decimal;
      gainLossEur: Decimal;
      holdingPeriodDays: number;
      acquireEcbRate: Decimal;
      optionFields?: Partial<FifoDisposal>;
    }): FifoDisposal => ({
      isin: trade.isin,
      symbol: trade.symbol,
      description: trade.description,
      sellDate: trade.tradeDate,
      acquireDate: parts.acquireDate,
      quantity: parts.quantity,
      gainLossFcy: parts.gainLossFcy,
      proceedsFcy: parts.proceedsFcy,
      costBasisFcy: parts.costBasisFcy,
      proceedsEur: parts.proceedsEur,
      costBasisEur: parts.costBasisEur,
      gainLossEur: parts.gainLossEur,
      holdingPeriodDays: parts.holdingPeriodDays,
      currency: trade.currency,
      sellEcbRate: ecbRate,
      acquireEcbRate: parts.acquireEcbRate,
      assetCategory: trade.assetCategory,
      washSaleBlocked: false, // Set later by wash sale detection
      blockedLossEur: new Decimal(0), // Set later by detectWashSales (proportional)
      reintegratedLossEur: new Decimal(0), // Set later by detectWashSales
      ...(parts.optionFields ?? {}),
    });

    const key = lotKey(trade);
    const lots = this.lots.get(key);
    if (!lots || lots.length === 0) {
      // Short sale or missing prior data — warn and record with zero cost basis
      this.emit({
        id: "fifo.sell_without_lots",
        severity: "error",
        message: `⚠ Venta sin lotes: ${trade.symbol} (${trade.isin}) × ${remaining} el ${normalizeDate(trade.tradeDate)}. Coste base = 0 (posible posición corta o datos previos incompletos).`,
        hint: "¿Has incluido los años anteriores en tu Flex Query? Selecciona un periodo que cubra desde la primera compra de este valor.",
        context: {
          symbol: trade.symbol,
          description: trade.description,
          isin: trade.isin,
          conid: trade.conid ?? "",
          assetCategory: trade.assetCategory,
          currency: trade.currency,
          date: normalizeDate(trade.tradeDate),
          quantity: remaining.toString(),
        },
      });
      const proceedsFcy = remaining.mul(pricePerShare).mul(multiplier).minus(taxes).minus(commissionFcy);
      const proceedsEur = proceedsFcy.mul(ecbRate);
      this.disposals.push(
        buildDisposal({
          acquireDate: trade.tradeDate,
          quantity: remaining,
          gainLossFcy: proceedsFcy,
          proceedsFcy,
          costBasisFcy: new Decimal(0),
          proceedsEur,
          costBasisEur: new Decimal(0),
          gainLossEur: proceedsEur,
          holdingPeriodDays: 0,
          acquireEcbRate: ecbRate,
        }),
      );
      return;
    }

    // Distribute commission proportionally across consumed lots
    const totalSellQuantity = remaining;

    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;

      const consumed = Decimal.min(remaining, lot.quantity);
      const fractionOfSale = consumed.dividedBy(totalSellQuantity);
      const commissionShareFcy = commissionFcy.mul(fractionOfSale);
      const taxesShare = taxes.mul(fractionOfSale);

      // Proceeds and cost are computed IN THE SHARE'S CURRENCY (FCY); the gain
      // is the FCY difference, converted to EUR at the SALE-date rate only
      // (DGT V2422-20). No buy-date rate enters the gain — that FX drift is a
      // separate currency gain handled by the FX engine.
      const proceedsFcy = consumed.mul(pricePerShare).mul(multiplier).minus(taxesShare).minus(commissionShareFcy);
      const costBasisFcy = lot.costInFcy.dividedBy(lot.quantity).mul(consumed);
      const gainLossFcy = proceedsFcy.minus(costBasisFcy);

      // EUR presentation: same-currency security → both legs at the sale-date
      // rate (V2422-20, FX-clean); cross-currency permuta → cost at the lot's
      // acquisition rate so a EUR-paid cost isn't scaled by the received coin's
      // EUR price. See disposalEur().
      const { proceedsEur, costBasisEur, gainLossEur } = this.disposalEur(
        proceedsFcy,
        costBasisFcy,
        { rate: lot.ecbRate, currency: lot.currency },
        { rate: ecbRate, currency: trade.currency },
      );

      const sellDate = trade.tradeDate;
      const acquireDate = lot.acquireDate;
      const holdingDays = daysBetween(acquireDate, sellDate);

      this.disposals.push(
        buildDisposal({
          acquireDate,
          quantity: consumed,
          gainLossFcy,
          proceedsFcy,
          costBasisFcy,
          proceedsEur,
          costBasisEur,
          gainLossEur,
          holdingPeriodDays: holdingDays,
          acquireEcbRate: lot.ecbRate,
          optionFields:
            trade.assetCategory === "OPT" || trade.assetCategory === "FOP" || trade.assetCategory === "FSFOP"
              ? {
                  optionScenario: "close",
                  putCall: trade.putCall ?? lot.putCall,
                  strike: trade.strike ?? lot.strike,
                  expiry: trade.expiry ?? lot.expiry,
                  underlyingSymbol: trade.underlyingSymbol ?? lot.underlyingSymbol,
                  underlyingIsin: trade.underlyingIsin ?? lot.underlyingIsin,
                }
              : undefined,
        }),
      );

      // Reduce lot (in FCY)
      lot.quantity = lot.quantity.minus(consumed);
      lot.costInFcy = lot.costInFcy.minus(costBasisFcy);

      if (lot.quantity.isZero()) {
        lots.shift();
      }

      remaining = remaining.minus(consumed);
    }

    if (remaining.greaterThan(0)) {
      // Remaining shares with no lots — short sale or data gap
      this.emit({
        id: "fifo.insufficient_lots",
        severity: "error",
        message: `⚠ Lotes insuficientes: ${trade.symbol} (${trade.isin}) × ${remaining} el ${normalizeDate(trade.tradeDate)}. Coste base = 0.`,
        hint: "El Flex Query no cubre todas las compras previas de este valor. Amplía el periodo de consulta.",
        context: {
          symbol: trade.symbol,
          description: trade.description,
          isin: trade.isin,
          conid: trade.conid ?? "",
          assetCategory: trade.assetCategory,
          currency: trade.currency,
          date: normalizeDate(trade.tradeDate),
          quantity: remaining.toString(),
        },
      });
      const fractionOfSale = remaining.dividedBy(totalSellQuantity);
      const commissionShareFcy = commissionFcy.mul(fractionOfSale);
      const taxesShare = taxes.mul(fractionOfSale);
      const proceedsFcy = remaining.mul(pricePerShare).mul(multiplier).minus(taxesShare).minus(commissionShareFcy);
      const proceedsEur = proceedsFcy.mul(ecbRate);
      this.disposals.push(
        buildDisposal({
          acquireDate: trade.tradeDate,
          quantity: remaining,
          gainLossFcy: proceedsFcy,
          proceedsFcy,
          costBasisFcy: new Decimal(0),
          proceedsEur,
          costBasisEur: new Decimal(0),
          gainLossEur: proceedsEur,
          holdingPeriodDays: 0,
          acquireEcbRate: ecbRate,
        }),
      );
    }
  }

  private addShortLot(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    const quantity = new Decimal(trade.quantity).abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");
    const commission = new Decimal(trade.commission).abs();
    const taxes = new Decimal(trade.taxes || "0").abs();
    const commissionFcy = this.homogenizeCommission(commission, trade, ecbRate, rateMap);
    // Short opens by SELLING: store the proceeds received, in the share currency
    // (FCY). The gain is computed in FCY at close and converted at the close date.
    const proceedsInFcy = quantity.mul(pricePerShare).mul(multiplier).minus(taxes).minus(commissionFcy);

    const lot: Lot = {
      id: `LOT-${this.nextLotId++}`,
      isin: trade.isin,
      symbol: trade.symbol,
      description: trade.description,
      acquireDate: trade.tradeDate,
      quantity,
      pricePerShare,
      costInFcy: proceedsInFcy,
      currency: trade.currency,
      ecbRate,
      isShort: true,
    };

    const key = lotKey(trade);
    if (!this.shortLots.has(key)) {
      this.shortLots.set(key, []);
    }
    this.shortLots.get(key)!.push(lot);
  }

  private consumeShortLots(trade: Trade, rateMap: EcbRateMap): void {
    const ecbRate = getEcbRate(rateMap, trade.tradeDate, trade.currency);
    let remaining = new Decimal(trade.quantity).abs();
    const commission = new Decimal(trade.commission).abs();
    const taxes = new Decimal(trade.taxes || "0").abs();
    const pricePerShare = new Decimal(trade.tradePrice);
    const multiplier = new Decimal(trade.multiplier || "1");
    const commissionFcy = this.homogenizeCommission(commission, trade, ecbRate, rateMap);

    const key = lotKey(trade);
    const lots = this.shortLots.get(key);
    if (!lots || lots.length === 0) {
      this.addLot(trade, rateMap);
      return;
    }

    const totalBuyQuantity = remaining;

    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;
      const consumed = Decimal.min(remaining, lot.quantity);
      const fractionOfBuy = consumed.dividedBy(totalBuyQuantity);
      const commissionShareFcy = commissionFcy.mul(fractionOfBuy);
      const taxesShare = taxes.mul(fractionOfBuy);

      // Short close: gain = open proceeds − close cost, both in the share
      // currency (FCY); convert the difference at the close-date rate only.
      // INVARIANT: this both-legs-at-close-rate (V2422-20) conversion is correct
      // ONLY because a short is opened and closed in the SAME currency, so
      // `lot.currency === trade.currency` here. A hypothetical cross-currency
      // short (open in coin X, close in coin Y — not produced by any current
      // parser path; a bare short comes from the missing-lots path, not
      // addShortLot) would need the lot-rate treatment in disposalEur(); it must
      // NOT silently reuse the close-date rate on the open-proceeds leg.
      const closeCostFcy = consumed.mul(pricePerShare).mul(multiplier).plus(taxesShare).plus(commissionShareFcy);
      const openProceedsFcy = lot.costInFcy.dividedBy(lot.quantity).mul(consumed);
      const gainLossFcy = openProceedsFcy.minus(closeCostFcy);

      const proceedsEur = openProceedsFcy.mul(ecbRate);
      const costBasisEur = closeCostFcy.mul(ecbRate);
      const gainLossEur = gainLossFcy.mul(ecbRate);

      const acquireDate = lot.acquireDate;
      const holdingDays = daysBetween(acquireDate, trade.tradeDate);

      this.disposals.push({
        isin: trade.isin,
        symbol: trade.symbol,
        description: trade.description,
        sellDate: trade.tradeDate,
        acquireDate,
        quantity: consumed,
        gainLossFcy,
        proceedsFcy: openProceedsFcy,
        costBasisFcy: closeCostFcy,
        proceedsEur,
        costBasisEur,
        gainLossEur,
        holdingPeriodDays: holdingDays,
        currency: trade.currency,
        sellEcbRate: ecbRate,
        acquireEcbRate: lot.ecbRate,
        assetCategory: trade.assetCategory,
        washSaleBlocked: false,
        blockedLossEur: new Decimal(0),
        reintegratedLossEur: new Decimal(0),
        isShort: true,
      });

      lot.quantity = lot.quantity.minus(consumed);
      lot.costInFcy = lot.costInFcy.minus(openProceedsFcy);

      if (lot.quantity.isZero()) {
        lots.shift();
      }

      remaining = remaining.minus(consumed);
    }

    if (remaining.greaterThan(0)) {
      this.addLot(
        { ...trade, quantity: remaining.toString(), openCloseIndicator: "O", commission: "0", taxes: "0" },
        rateMap,
      );
    }
  }

  /**
   * Process option exercises/assignments/expirations (DGT V0137-23, Art. 37.1.m LIRPF).
   *
   * Three scenarios:
   * 1. **Expiration**: Option expires worthless → full premium is gain (writer) or loss (buyer).
   *    Lot consumed with zero proceeds (buyer) or zero cost (writer/short).
   * 2. **Close**: Already handled by normal FIFO (BUY to close / SELL to close).
   * 3. **Exercise/Assignment**: Option exercise is integrated into the
   *    underlying transaction: premium adjusts the acquisition value or
   *    transmission value of the delivered shares.
   */
  processOptionExercises(exercises: OptionExercise[], rateMap: EcbRateMap): void {
    const sorted = [...exercises].sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));

    for (const ex of sorted) {
      if (!ex.date || ex.date.length < 8) {
        this.emit({
          id: "fifo.option_invalid_date",
          severity: "warning",
          message: `⚠ Evento OptionEAE sin fecha válida para ${ex.symbol}. Omitido.`,
          hint: "Evento de opción omitido por fecha inválida. Revisa que el Flex Query incluye la sección 'Option Exercises, Assignments & Expirations'.",
          context: { symbol: ex.symbol },
        });
        continue;
      }
      const date = normalizeDate(ex.date);
      const ecbRate = getEcbRate(rateMap, date, ex.currency);
      const quantity = new Decimal(ex.quantity).abs();
      if (quantity.isZero()) {
        this.emit({
          id: "fifo.option_zero_quantity",
          severity: "warning",
          message: `⚠ Evento OptionEAE con cantidad 0 para ${ex.symbol} el ${date}. Omitido.`,
          hint: "Evento de opción con cantidad 0 — probablemente un registro duplicado de IBKR.",
          context: { symbol: ex.symbol, date },
        });
        continue;
      }
      const multiplier = new Decimal(ex.multiplier || "100");

      if (ex.action === "Expiration") {
        this.processOptionExpiration(ex, date, ecbRate, quantity);
      } else {
        if (!ex.strike || !/^-?\d+(\.\d+)?$/.test(ex.strike.trim())) {
          this.emit({
            id: "fifo.option_invalid_strike",
            severity: "warning",
            message: `⚠ Strike inválido "${ex.strike}" para ${ex.symbol} el ${date}. Omitiendo ejercicio.`,
            hint: "No se pudo calcular el ejercicio de esta opción. El coste del subyacente no incluirá la prima.",
            context: { symbol: ex.symbol, date, strike: ex.strike },
          });
          continue;
        }
        this.processOptionExercise(ex, date, ecbRate, quantity, multiplier);
      }
    }
  }

  /** Resolve option lot key using same logic as lotKey() to avoid mismatches */
  private optionLotKey(ex: OptionExercise): string {
    if (ex.isin) return ex.isin;
    if (ex.conid) return `OPT:conid:${ex.conid}`;
    return `OPT:${ex.symbol}`;
  }

  /** Resolve underlying key: find existing lots by symbol when ISIN is unknown */
  private resolveUnderlyingKey(ex: OptionExercise): string {
    if (ex.underlyingIsin) return ex.underlyingIsin;
    // Scan existing lots for a matching symbol (trades processed first, so ISIN-keyed lots exist)
    for (const [key, lots] of this.lots) {
      if (lots.length > 0 && lots[0]!.symbol === ex.underlyingSymbol && key !== `OPT:${ex.symbol}`) {
        return key;
      }
    }
    return `STK:${ex.underlyingSymbol}`;
  }

  private processOptionExpiration(ex: OptionExercise, date: string, ecbRate: Decimal, quantity: Decimal): void {
    const optionKey = this.optionLotKey(ex);

    // Check if we hold long lots (buyer)
    const longLots = this.lots.get(optionKey);
    if (longLots && longLots.length > 0) {
      // Buyer: option expires worthless → loss = full premium paid
      let remaining = quantity;
      while (remaining.greaterThan(0) && longLots.length > 0) {
        const lot = longLots[0]!;
        const consumed = Decimal.min(remaining, lot.quantity);
        const costPerUnitFcy = lot.costInFcy.dividedBy(lot.quantity);
        const costBasisFcy = costPerUnitFcy.mul(consumed);
        const costBasisEur = costBasisFcy.mul(ecbRate);

        this.disposals.push({
          isin: ex.isin,
          symbol: ex.symbol,
          description: ex.description,
          sellDate: date,
          acquireDate: lot.acquireDate,
          quantity: consumed,
          gainLossFcy: costBasisFcy.negated(),
          proceedsFcy: new Decimal(0),
          costBasisFcy,
          proceedsEur: new Decimal(0),
          costBasisEur,
          gainLossEur: costBasisEur.negated(),
          holdingPeriodDays: daysBetween(lot.acquireDate, date),
          currency: ex.currency,
          sellEcbRate: ecbRate,
          acquireEcbRate: lot.ecbRate,
          assetCategory: "OPT",
          washSaleBlocked: false,
          blockedLossEur: new Decimal(0),
          reintegratedLossEur: new Decimal(0),
          optionScenario: "expiration",
          putCall: ex.putCall,
          strike: ex.strike,
          expiry: ex.expiry,
          underlyingSymbol: ex.underlyingSymbol,
          underlyingIsin: ex.underlyingIsin,
        });

        lot.quantity = lot.quantity.minus(consumed);
        lot.costInFcy = lot.costInFcy.minus(costBasisFcy);
        if (lot.quantity.isZero()) longLots.shift();
        remaining = remaining.minus(consumed);
      }
      if (longLots.length === 0) this.lots.delete(optionKey);
      return;
    }

    // Check if we hold short lots (writer)
    const shortLots = this.shortLots.get(optionKey);
    if (shortLots && shortLots.length > 0) {
      // Writer: option expires worthless → gain = full premium received
      let remaining = quantity;
      while (remaining.greaterThan(0) && shortLots.length > 0) {
        const lot = shortLots[0]!;
        const consumed = Decimal.min(remaining, lot.quantity);
        const proceedsPerUnitFcy = lot.costInFcy.dividedBy(lot.quantity);
        const proceedsFcy = proceedsPerUnitFcy.mul(consumed);
        const proceedsEur = proceedsFcy.mul(ecbRate);

        this.disposals.push({
          isin: ex.isin,
          symbol: ex.symbol,
          description: ex.description,
          sellDate: date,
          acquireDate: lot.acquireDate,
          quantity: consumed,
          gainLossFcy: proceedsFcy,
          proceedsFcy,
          costBasisFcy: new Decimal(0),
          proceedsEur,
          costBasisEur: new Decimal(0),
          gainLossEur: proceedsEur,
          holdingPeriodDays: daysBetween(lot.acquireDate, date),
          currency: ex.currency,
          sellEcbRate: ecbRate,
          acquireEcbRate: lot.ecbRate,
          assetCategory: "OPT",
          washSaleBlocked: false,
          blockedLossEur: new Decimal(0),
          reintegratedLossEur: new Decimal(0),
          isShort: true,
          optionScenario: "expiration",
          putCall: ex.putCall,
          strike: ex.strike,
          expiry: ex.expiry,
          underlyingSymbol: ex.underlyingSymbol,
          underlyingIsin: ex.underlyingIsin,
        });

        lot.quantity = lot.quantity.minus(consumed);
        lot.costInFcy = lot.costInFcy.minus(proceedsFcy);
        if (lot.quantity.isZero()) shortLots.shift();
        remaining = remaining.minus(consumed);
      }
      if (shortLots.length === 0) this.shortLots.delete(optionKey);
      return;
    }

    this.emit({
      id: "fifo.option_expiry_no_lots",
      severity: "warning",
      message: `⚠ Expiración de opción sin lotes: ${ex.symbol} × ${quantity} el ${date}.`,
      hint: "La opción expiró pero no se encontraron lotes de compra. ¿Incluiste el año de compra en el Flex Query?",
      context: { symbol: ex.symbol, date, quantity: quantity.toString() },
    });
  }

  /**
   * Append a synthetic underlying acquisition lot produced by an option
   * exercise/assignment. The lot's identity (ISIN, symbol, currency, ECB rate)
   * and acquireDate are constant across the three call sites (call buyer, put
   * writer, no-lots fallback); only quantity, per-share strike price, total FCY
   * cost and the description verb differ — so those are the parameters.
   */
  private addUnderlyingLot(
    underlyingKey: string,
    ex: OptionExercise,
    date: string,
    ecbRate: Decimal,
    parts: { quantity: Decimal; pricePerShare: Decimal; costInFcy: Decimal; description: string },
  ): void {
    const underlyingLot: Lot = {
      id: `LOT-${this.nextLotId++}`,
      isin: ex.underlyingIsin,
      symbol: ex.underlyingSymbol,
      description: parts.description,
      acquireDate: date,
      quantity: parts.quantity,
      pricePerShare: parts.pricePerShare,
      costInFcy: parts.costInFcy,
      currency: ex.currency,
      ecbRate,
    };
    if (!this.lots.has(underlyingKey)) this.lots.set(underlyingKey, []);
    this.lots.get(underlyingKey)!.push(underlyingLot);
  }

  private processOptionExercise(
    ex: OptionExercise,
    date: string,
    ecbRate: Decimal,
    quantity: Decimal,
    multiplier: Decimal,
  ): void {
    const optionKey = this.optionLotKey(ex);
    const sharesPerContract = multiplier;
    const underlyingKey = this.resolveUnderlyingKey(ex);

    // Determine if we're the buyer (long lots) or writer (short lots)
    const longLots = this.lots.get(optionKey);
    const shortLots = this.shortLots.get(optionKey);

    if (longLots && longLots.length > 0) {
      this.exerciseLongOption(ex, date, ecbRate, quantity, sharesPerContract, optionKey, underlyingKey, longLots);
    } else if (shortLots && shortLots.length > 0) {
      this.assignShortOption(ex, date, ecbRate, quantity, sharesPerContract, optionKey, underlyingKey, shortLots);
    } else {
      this.exerciseOptionWithoutLots(ex, date, ecbRate, quantity, sharesPerContract, underlyingKey);
    }
  }

  /**
   * BUYER exercising: consume the long option lots, integrate the premium into
   * the underlying cost basis. Per DGT V0137-23 there is no separate option
   * disposal — the premium folds into the stock cost. The share
   * acquisition/disposal price is always the STRIKE (the contractual price
   * actually paid/received on exercise), never the market price.
   */
  private exerciseLongOption(
    ex: OptionExercise,
    date: string,
    ecbRate: Decimal,
    quantity: Decimal,
    sharesPerContract: Decimal,
    optionKey: string,
    underlyingKey: string,
    longLots: Lot[],
  ): void {
    const priceForUnderlying = new Decimal(ex.strike);

    let remaining = quantity;
    while (remaining.greaterThan(0) && longLots.length > 0) {
      const lot = longLots[0]!;
      const consumed = Decimal.min(remaining, lot.quantity);
      const costPerUnitFcy = lot.costInFcy.dividedBy(lot.quantity);
      const optionPremiumFcy = costPerUnitFcy.mul(consumed);

      if (ex.putCall === "C") {
        // Call buyer: acquires shares at strike + premium (DGT V0137-23). Cost
        // is kept in the share currency (FCY); strike and premium share that
        // currency, so the lot stays single-currency.
        const baseShareCostFcy = priceForUnderlying.mul(consumed).mul(sharesPerContract);
        const totalCostFcy = baseShareCostFcy.plus(optionPremiumFcy);
        this.addUnderlyingLot(underlyingKey, ex, date, ecbRate, {
          quantity: consumed.mul(sharesPerContract),
          pricePerShare: priceForUnderlying,
          costInFcy: totalCostFcy,
          description: `${ex.underlyingSymbol} [via ejercicio ${ex.symbol}]`,
        });
      } else {
        // Put buyer exercising: sells shares at strike, premium reduces proceeds
        // (all in FCY; consumeLotsForExercise converts at the exercise date).
        const shareProceedsFcy = priceForUnderlying.mul(consumed).mul(sharesPerContract);
        const netProceedsFcy = shareProceedsFcy.minus(optionPremiumFcy);
        this.consumeLotsForExercise(underlyingKey, consumed.mul(sharesPerContract), netProceedsFcy, date, ecbRate, ex);
      }

      lot.quantity = lot.quantity.minus(consumed);
      lot.costInFcy = lot.costInFcy.minus(optionPremiumFcy);
      if (lot.quantity.isZero()) longLots.shift();
      remaining = remaining.minus(consumed);
    }
    if (longLots.length === 0) this.lots.delete(optionKey);
  }

  /**
   * WRITER assigned: consume the short option lots, integrate the premium into
   * the underlying event. Per DGT V0137-23 there is no separate option disposal
   * — the premium folds into the stock event. The share disposal/acquisition
   * price is always the STRIKE (the contractual price actually received/paid on
   * assignment), never the market price.
   */
  private assignShortOption(
    ex: OptionExercise,
    date: string,
    ecbRate: Decimal,
    quantity: Decimal,
    sharesPerContract: Decimal,
    optionKey: string,
    underlyingKey: string,
    shortLots: Lot[],
  ): void {
    const priceForUnderlying = new Decimal(ex.strike);

    let remaining = quantity;
    while (remaining.greaterThan(0) && shortLots.length > 0) {
      const lot = shortLots[0]!;
      const consumed = Decimal.min(remaining, lot.quantity);
      const proceedsPerUnitFcy = lot.costInFcy.dividedBy(lot.quantity);
      const optionPremiumFcy = proceedsPerUnitFcy.mul(consumed);

      // Call writer assigned: SELL shares at strike, premium adds to proceeds
      // Put writer assigned: BUY shares at strike, premium reduces cost.
      // All amounts in FCY; conversion happens at the exercise date downstream.
      if (ex.putCall === "C") {
        const shareProceedsFcy = priceForUnderlying.mul(consumed).mul(sharesPerContract);
        const netProceedsFcy = shareProceedsFcy.plus(optionPremiumFcy);
        this.consumeLotsForExercise(underlyingKey, consumed.mul(sharesPerContract), netProceedsFcy, date, ecbRate, ex);
      } else {
        const baseShareCostFcy = priceForUnderlying.mul(consumed).mul(sharesPerContract);
        const totalCostFcy = baseShareCostFcy.minus(optionPremiumFcy);
        this.addUnderlyingLot(underlyingKey, ex, date, ecbRate, {
          quantity: consumed.mul(sharesPerContract),
          pricePerShare: priceForUnderlying,
          costInFcy: totalCostFcy,
          description: `${ex.underlyingSymbol} [via asignación ${ex.symbol}]`,
        });
      }

      lot.quantity = lot.quantity.minus(consumed);
      lot.costInFcy = lot.costInFcy.minus(optionPremiumFcy);
      if (lot.quantity.isZero()) shortLots.shift();
      remaining = remaining.minus(consumed);
    }
    if (shortLots.length === 0) this.shortLots.delete(optionKey);
  }

  /**
   * Exercise/assignment with NO matching option lots (premium data missing).
   * The premium is treated as 0 and only the underlying position is processed:
   * a call exercise / put assignment acquires shares at strike; a put exercise /
   * call assignment delivers shares at strike.
   */
  private exerciseOptionWithoutLots(
    ex: OptionExercise,
    date: string,
    ecbRate: Decimal,
    quantity: Decimal,
    sharesPerContract: Decimal,
    underlyingKey: string,
  ): void {
    const strike = new Decimal(ex.strike);
    const totalShares = quantity.mul(sharesPerContract);

    this.emit({
      id: "fifo.option_exercise_no_lots",
      severity: "warning",
      message: `⚠ Ejercicio/asignación sin lotes de opción: ${ex.symbol} × ${quantity} el ${date}. Coste de prima = 0.`,
      hint: "Ejercicio registrado con prima = 0 porque no se encontró la compra de la opción. Amplía el periodo del Flex Query.",
      context: { symbol: ex.symbol, date, quantity: quantity.toString() },
    });
    // Still process underlying position even without option lot data
    if ((ex.action === "Exercise" && ex.putCall === "C") || (ex.action === "Assignment" && ex.putCall === "P")) {
      // Call exercise / Put assignment: acquire shares at strike (cost in FCY)
      const shareCostFcy = strike.mul(quantity).mul(sharesPerContract);
      this.addUnderlyingLot(underlyingKey, ex, date, ecbRate, {
        quantity: totalShares,
        pricePerShare: strike,
        costInFcy: shareCostFcy,
        description: `${ex.underlyingSymbol} [via ${ex.action.toLowerCase()} ${ex.symbol}]`,
      });
    } else {
      // Put exercise / Call assignment: sell shares at strike (proceeds in FCY)
      const shareProceedsFcy = strike.mul(quantity).mul(sharesPerContract);
      this.consumeLotsForExercise(underlyingKey, totalShares, shareProceedsFcy, date, ecbRate, ex);
    }
  }

  private consumeLotsForExercise(
    underlyingKey: string,
    shares: Decimal,
    proceedsFcy: Decimal,
    date: string,
    ecbRate: Decimal,
    ex: OptionExercise,
  ): void {
    const lots = this.lots.get(underlyingKey);
    if (!lots || lots.length === 0) {
      this.emit({
        id: "fifo.exercise_no_underlying_lots",
        severity: "warning",
        message: `⚠ Ejercicio de opción sin lotes del subyacente: ${ex.underlyingSymbol} × ${shares} el ${date}. Coste base = 0.`,
        hint: "Asignación de PUT registrada con coste base = 0 del subyacente. El Flex Query puede no cubrir la adquisición original.",
        context: { symbol: ex.underlyingSymbol, date, quantity: shares.toString() },
      });
      const proceedsEur = proceedsFcy.mul(ecbRate);
      this.disposals.push({
        isin: ex.underlyingIsin,
        symbol: ex.underlyingSymbol,
        description: `${ex.underlyingSymbol} [entrega por ejercicio ${ex.symbol}]`,
        sellDate: date,
        acquireDate: date,
        quantity: shares,
        gainLossFcy: proceedsFcy,
        proceedsFcy,
        costBasisFcy: new Decimal(0),
        proceedsEur,
        costBasisEur: new Decimal(0),
        gainLossEur: proceedsEur,
        holdingPeriodDays: 0,
        currency: ex.currency,
        sellEcbRate: ecbRate,
        acquireEcbRate: ecbRate,
        assetCategory: "STK",
        washSaleBlocked: false,
        blockedLossEur: new Decimal(0),
        reintegratedLossEur: new Decimal(0),
        optionScenario: "exercise",
        putCall: ex.putCall,
        strike: ex.strike,
        expiry: ex.expiry,
        underlyingSymbol: ex.underlyingSymbol,
        underlyingIsin: ex.underlyingIsin,
      });
      return;
    }

    let remaining = shares;
    while (remaining.greaterThan(0) && lots.length > 0) {
      const lot = lots[0]!;
      const consumed = Decimal.min(remaining, lot.quantity);
      const fraction = consumed.dividedBy(shares);
      const partialProceedsFcy = proceedsFcy.mul(fraction);
      const costBasisFcy = lot.costInFcy.dividedBy(lot.quantity).mul(consumed);
      const {
        proceedsEur: partialProceedsEur,
        costBasisEur,
        gainLossEur,
      } = this.disposalEur(
        partialProceedsFcy,
        costBasisFcy,
        { rate: lot.ecbRate, currency: lot.currency },
        { rate: ecbRate, currency: ex.currency },
      );

      this.disposals.push({
        isin: ex.underlyingIsin,
        symbol: ex.underlyingSymbol,
        description: `${ex.underlyingSymbol} [entrega por ejercicio ${ex.symbol}]`,
        sellDate: date,
        acquireDate: lot.acquireDate,
        quantity: consumed,
        gainLossFcy: partialProceedsFcy.minus(costBasisFcy),
        proceedsFcy: partialProceedsFcy,
        costBasisFcy,
        proceedsEur: partialProceedsEur,
        costBasisEur,
        gainLossEur,
        holdingPeriodDays: daysBetween(lot.acquireDate, date),
        currency: ex.currency,
        sellEcbRate: ecbRate,
        acquireEcbRate: lot.ecbRate,
        assetCategory: "STK",
        washSaleBlocked: false,
        blockedLossEur: new Decimal(0),
        reintegratedLossEur: new Decimal(0),
        optionScenario: "exercise",
        putCall: ex.putCall,
        strike: ex.strike,
        expiry: ex.expiry,
        underlyingSymbol: ex.underlyingSymbol,
        underlyingIsin: ex.underlyingIsin,
      });

      lot.quantity = lot.quantity.minus(consumed);
      lot.costInFcy = lot.costInFcy.minus(costBasisFcy);
      if (lot.quantity.isZero()) lots.shift();
      remaining = remaining.minus(consumed);
    }

    if (remaining.greaterThan(0)) {
      this.emit({
        id: "fifo.insufficient_underlying_lots",
        severity: "warning",
        message: `⚠ Lotes insuficientes del subyacente: ${ex.underlyingSymbol} × ${remaining} el ${date}. Coste base = 0.`,
        hint: "No hay suficientes lotes del subyacente para cubrir la asignación completa.",
        context: { symbol: ex.underlyingSymbol, date, quantity: remaining.toString() },
      });
      const fraction = remaining.dividedBy(shares);
      const partialProceedsFcy = proceedsFcy.mul(fraction);
      const partialProceedsEur = partialProceedsFcy.mul(ecbRate);
      this.disposals.push({
        isin: ex.underlyingIsin,
        symbol: ex.underlyingSymbol,
        description: `${ex.underlyingSymbol} [entrega por ejercicio ${ex.symbol}]`,
        sellDate: date,
        acquireDate: date,
        quantity: remaining,
        gainLossFcy: partialProceedsFcy,
        proceedsFcy: partialProceedsFcy,
        costBasisFcy: new Decimal(0),
        proceedsEur: partialProceedsEur,
        costBasisEur: new Decimal(0),
        gainLossEur: partialProceedsEur,
        holdingPeriodDays: 0,
        currency: ex.currency,
        sellEcbRate: ecbRate,
        acquireEcbRate: ecbRate,
        assetCategory: "STK",
        washSaleBlocked: false,
        blockedLossEur: new Decimal(0),
        reintegratedLossEur: new Decimal(0),
        optionScenario: "exercise",
        putCall: ex.putCall,
        strike: ex.strike,
        expiry: ex.expiry,
        underlyingSymbol: ex.underlyingSymbol,
        underlyingIsin: ex.underlyingIsin,
      });
    }
  }

  getDisposals(): FifoDisposal[] {
    return this.disposals;
  }

  getRemainingLots(): Map<string, Lot[]> {
    return this.lots;
  }

  getRemainingShortLots(): Map<string, Lot[]> {
    return this.shortLots;
  }
}
