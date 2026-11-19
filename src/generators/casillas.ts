/**
 * Authoritative Modelo 100 casilla mapping for capital gains (FY2025).
 *
 * Source: Orden HAC/277/2026 (BOE-A-2026-7041). The AEAT splits gains from the
 * transmission of patrimonial elements into TWO distinct blocks:
 *
 *  1. "Acciones negociadas" (página 14 III) — listed shares traded on regulated
 *     markets (Art. 37.1.a LIRPF):
 *       0327 = Denominación de los valores (TEXT, issuer name — NOT a money box)
 *       0328 = Importe global de las transmisiones (valor de transmisión)
 *       0331 = Valor de adquisición global
 *       0336 = Ganancias patrimoniales reducidas no exentas (per-row net gain)
 *       0338 = Pérdidas patrimoniales. Importe computable
 *       0339 = Suma de ganancias  /  0340 = Suma de pérdidas
 *
 *  2. "Otros elementos patrimoniales" (página 17 I) — options (Art. 37.1.m),
 *     crypto, non-listed funds, and foreign-currency gains (Art. 33.1):
 *       1626 = Tipo de elemento patrimonial. Clave (use 4 = otros elementos no afectos; 5 is afectos)
 *       1633 = Valor de transmisión
 *       1637 = Valor de adquisición
 *       1640 = Ganancia patrimonial obtenida ([1633] - [1637] positiva)
 *       1638 = Pérdida patrimonial obtenida ([1633] - [1637] negativa)
 *       0385 = Suma de pérdidas  /  0386 = Suma de ganancias (no afectos)
 *
 * The previous single "0327/0328 = transmisión/adquisición" mapping was WRONG:
 * 0327 is a text field, and options/crypto must not be reported in the
 * acciones-negociadas block.
 */

import Decimal from "decimal.js";
import { isCountableAmount } from "../engine/amount-range.js";
import type { DividendEntry, FifoDisposal, IssuerDividendGroup, TaxSummary } from "../types/tax.js";

/**
 * Asset categories routed to the "acciones negociadas" block (listed shares).
 *
 * CAVEAT — this is a deliberate simplification. The AEAT block split is by
 * *listing status*, not by IBKR `assetCategory`:
 *  - A listed ETF/fund IS an "acción/participación negociada" (0328/0331), but
 *    parsers emit it as FUND, so it currently routes to "otros elementos"
 *    (1633/1637).
 *  - A non-listed (OTC) share would belong in "otros elementos", but STK has no
 *    listing flag to distinguish it.
 * We have no reliable listed/unlisted signal in the broker exports, so we treat
 * STK as listed and everything else as "otros elementos". This errs toward the
 * conservative side (both blocks feed the same savings base at the same rate, so
 * the *tax due* is identical — only the box placement differs). Revisit if a
 * listing flag becomes available. The user-facing note is in docs/casillas.md.
 */
const LISTED_SHARE_CATEGORIES: ReadonlySet<string> = new Set(["STK"]);

export interface CasillaBlock {
  /** Total proceeds (valor de transmisión) for the block. */
  transmissionValue: Decimal;
  /** Total cost basis (valor de adquisición) for the block. */
  acquisitionValue: Decimal;
  /** Sum of positive gains. */
  gains: Decimal;
  /** Sum of computable losses (absolute value of negative results). */
  losses: Decimal;
  /** Net gain/loss (transmissionValue - acquisitionValue). */
  netGainLoss: Decimal;
  /** Number of disposals in the block. */
  count: number;
}

export interface CasillaBlocks {
  /** Acciones negociadas en mercados regulados (Art. 37.1.a) → 0328/0331/0336. */
  listedShares: CasillaBlock;
  /** Otros elementos patrimoniales: opciones, cripto, fondos no cotizados (Art. 37.1.m) → 1633/1637/1640. */
  otherElements: CasillaBlock;
}

/** True if a disposal belongs to the listed-shares block (acciones negociadas). */
export function isListedShare(d: Pick<FifoDisposal, "assetCategory">): boolean {
  return LISTED_SHARE_CATEGORIES.has(d.assetCategory);
}

function emptyBlock(): CasillaBlock {
  return {
    transmissionValue: new Decimal(0),
    acquisitionValue: new Decimal(0),
    gains: new Decimal(0),
    losses: new Decimal(0),
    netGainLoss: new Decimal(0),
    count: 0,
  };
}

/**
 * The amounts of one disposal (a sale, or a currency disposal) that the boxes
 * add. A non-finite amount (NaN or ±Infinity, from a division by an unexpected
 * zero or a corrupt rate) is left out alone, never the valid amounts of the
 * rest of the year (#469 review). Before, the whole leg was summed and then set
 * to 0, so one poisoned sale erased every cost of the year (the user overpays)
 * or every proceeds (the user underpays).
 *
 * The rule never lets a missing number lower the tax:
 * - proceeds not finite: neither its proceeds nor its cost are added, because a
 *   cost with no proceeds would be a loss that no figure supports;
 * - cost not finite: the proceeds are added and the cost is not (a gain that
 *   may be too high, never too low);
 * - result: proceeds minus cost of what was added, or `gainLossEur` itself when
 *   every amount is finite (byte-identical to before).
 *
 * An amount past 12 integer digits of euros counts as missing too
 * (`isCountableAmount`, the Modelo 720's valoración width): no real trade
 * reaches it, and a cost of 1e2000 € made box 0331 and the net a
 * 2000-digit loss with no warning (#470).
 *
 * `excluded` marks a disposal that lost an amount: the report names it in the
 * error `report.non_finite_disposal`, so it is never silent. The report totals,
 * the casilla boxes and the web annex all read the amounts through this, so
 * every view shows the same figures.
 */
export function finiteDisposalAmounts(d: Pick<FifoDisposal, "proceedsEur" | "costBasisEur" | "gainLossEur">): {
  proceeds: Decimal;
  cost: Decimal;
  gainLoss: Decimal;
  excluded: boolean;
} {
  const proceedsCounted = isCountableAmount(d.proceedsEur);
  const costCounted = isCountableAmount(d.costBasisEur);
  if (proceedsCounted && costCounted && d.gainLossEur.isFinite()) {
    return { proceeds: d.proceedsEur, cost: d.costBasisEur, gainLoss: d.gainLossEur, excluded: false };
  }
  const proceeds = proceedsCounted ? d.proceedsEur : new Decimal(0);
  const cost = proceedsCounted && costCounted ? d.costBasisEur : new Decimal(0);
  return { proceeds, cost, gainLoss: proceeds.minus(cost), excluded: true };
}

/**
 * One sale's amounts as the boxes count them, for an output that lists every
 * sale (the CLI JSON, the CSV, both PDFs): null where the boxes add nothing.
 * The proceeds are null when they are left out, and then the cost and the
 * result too (a cost with no proceeds is no loss); the cost alone is null
 * when only it is left out, and the result is then the proceeds. Each column
 * then adds up to its box, and no row prints «NaN» or a 2000-digit figure
 * (#469, #470). Every amount of an ordinary sale is its own.
 */
export function countedDisposalAmounts(d: Pick<FifoDisposal, "proceedsEur" | "costBasisEur" | "gainLossEur">): {
  proceeds: Decimal | null;
  cost: Decimal | null;
  gainLoss: Decimal | null;
} {
  if (!isCountableAmount(d.proceedsEur)) return { proceeds: null, cost: null, gainLoss: null };
  const { gainLoss } = finiteDisposalAmounts(d);
  return { proceeds: d.proceedsEur, cost: isCountableAmount(d.costBasisEur) ? d.costBasisEur : null, gainLoss };
}

function accumulate(block: CasillaBlock, d: FifoDisposal): void {
  const { proceeds, cost, gainLoss } = finiteDisposalAmounts(d);
  block.transmissionValue = block.transmissionValue.plus(proceeds);
  block.acquisitionValue = block.acquisitionValue.plus(cost);
  // Zero-gain disposals fall into the gains bucket (>= 0). This is a sum-of-
  // positives / sum-of-losses split for the 0339/0340 (or 0386/0385) totals; a
  // zero contributes nothing either way, so the boundary choice is immaterial to
  // the figures and only keeps the count of "loss" rows from being inflated.
  if (gainLoss.greaterThanOrEqualTo(0)) {
    block.gains = block.gains.plus(gainLoss);
  } else {
    block.losses = block.losses.plus(gainLoss.abs());
  }
  block.netGainLoss = block.netGainLoss.plus(gainLoss);
  block.count += 1;
}

/**
 * The casilla boxes never render "NaN" (#469). The disposals' own amounts are
 * already cleaned one by one (`finiteDisposalAmounts`); this is the last line
 * for the FX totals folded in from the report, which report.ts
 * guardNonFiniteTotals has already cleaned: a non-finite leg is 0, and a
 * non-finite net is the difference of the two legs, as the report's. A strict
 * no-op when every amount is finite.
 */
function finiteBlock(block: CasillaBlock): CasillaBlock {
  const finite = (d: Decimal): Decimal => (d.isFinite() ? d : new Decimal(0));
  const transmissionValue = finite(block.transmissionValue);
  const acquisitionValue = finite(block.acquisitionValue);
  return {
    transmissionValue,
    acquisitionValue,
    gains: finite(block.gains),
    losses: finite(block.losses),
    netGainLoss: block.netGainLoss.isFinite() ? block.netGainLoss : transmissionValue.minus(acquisitionValue),
    count: block.count,
  };
}

/**
 * Partition capital-gains disposals into the two AEAT blocks.
 *
 * Foreign-currency (FX) gains also belong to "otros elementos patrimoniales"
 * but are tracked separately in TaxSummary.fxGains; callers that want the full
 * 1633/1637 figure should add the FX totals to `otherElements`.
 */
export function computeCasillaBlocks(disposals: FifoDisposal[]): CasillaBlocks {
  const listedShares = emptyBlock();
  const otherElements = emptyBlock();
  for (const d of disposals) {
    accumulate(isListedShare(d) ? listedShares : otherElements, d);
  }
  return { listedShares: finiteBlock(listedShares), otherElements: finiteBlock(otherElements) };
}

/**
 * Compute the casilla blocks AND fold foreign-currency (FX) gains into the
 * "otros elementos" block. Use this from output generators (PDF/CSV/CLI/web) so
 * the FX merge lives in exactly one place — previously each consumer added
 * `report.fxGains.*` to `otherElements` by hand, which is easy to get wrong and
 * drifts between formats.
 *
 * FX gains (Art. 33.1 LIRPF) are reported in the same 1633/1637 block as
 * options/crypto/non-listed funds (Art. 37.1.m). `listedShares` is returned
 * unchanged.
 */
export function computeCasillaBlocksWithFx(report: TaxSummary): CasillaBlocks {
  const { listedShares, otherElements } = computeCasillaBlocks(report.capitalGains.disposals);
  const fx = report.fxGains;
  const merged: CasillaBlock = {
    transmissionValue: otherElements.transmissionValue.plus(fx.transmissionValue),
    acquisitionValue: otherElements.acquisitionValue.plus(fx.acquisitionValue),
    gains: fx.netGainLoss.greaterThanOrEqualTo(0)
      ? otherElements.gains.plus(fx.netGainLoss)
      : otherElements.gains,
    losses: fx.netGainLoss.lessThan(0)
      ? otherElements.losses.plus(fx.netGainLoss.abs())
      : otherElements.losses,
    netGainLoss: otherElements.netGainLoss.plus(fx.netGainLoss),
    count: otherElements.count + fx.disposals.length,
  };
  return { listedShares, otherElements: finiteBlock(merged) };
}

/**
 * Combined net gain/loss across both blocks (listed shares + otros elementos,
 * FX already folded in). Use this instead of recomputing
 * `capitalGains.netGainLoss + fxGains.netGainLoss` by hand, so the FX merge stays
 * owned by a single place (see {@link computeCasillaBlocksWithFx}).
 */
export function combinedNetGainLoss(blocks: CasillaBlocks): Decimal {
  return blocks.listedShares.netGainLoss.plus(blocks.otherElements.netGainLoss);
}

/**
 * Aggregate per-payment dividend entries into one group per issuer + source
 * country — the layout of Spanish brokers' fiscal certificates and the AEAT
 * "Alta Capital mobiliario" form (one record per company with annual totals).
 *
 * PRESENTATION-ONLY. Renderers call this on demand (like
 * {@link computeCasillaBlocksWithFx}); it is never stored on TaxSummary and the
 * tax figures (Casilla 0029 grossIncome, Casilla 0588) are computed from the raw
 * per-payment `entries` independently. The sum of `grossTotalEur` across groups
 * therefore equals `report.dividends.grossIncome` exactly.
 *
 * Grouping key: `(isin || symbol || description)` + `withholdingCountry`. Country
 * is part of the key so each group maps 1:1 to a double-taxation country line and
 * can never display a single country for payments taxed under two (the rare
 * same-issuer/two-country case shows as two blocks — honest and reconcilable).
 * Input entries must already be titulares-split (renderers receive
 * `report.dividends.entries`, which report.ts splits before storing).
 */
export function groupDividendsByIssuer(entries: DividendEntry[]): IssuerDividendGroup[] {
  const groups = new Map<string, IssuerDividendGroup>();
  for (const d of entries) {
    const identity = d.isin || d.symbol || d.description;
    const key = `${identity}|${d.withholdingCountry}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        isin: d.isin,
        symbol: d.symbol,
        description: d.description,
        withholdingCountry: d.withholdingCountry,
        currency: d.currency,
        grossTotalEur: new Decimal(0),
        withholdingTotalEur: new Decimal(0),
        paymentCount: 0,
        payments: [],
      };
      groups.set(key, g);
    }
    g.grossTotalEur = g.grossTotalEur.plus(d.grossAmountEur);
    g.withholdingTotalEur = g.withholdingTotalEur.plus(d.withholdingTaxEur);
    g.paymentCount += 1;
    g.payments.push(d);
    // Distinct currencies within a group are still summed correctly (all EUR),
    // but no single currency label is meaningful → mark as mixed.
    if (g.currency !== "—" && g.currency !== d.currency) g.currency = "—";
  }

  for (const g of groups.values()) {
    g.payments.sort((a, b) => a.payDate.localeCompare(b.payDate));
  }

  // Largest issuer first (how a user scans a fiscal certificate); a stable key
  // (issuer identity + country) breaks ties for deterministic output (snapshots).
  const tieKey = (g: IssuerDividendGroup) => `${g.isin || g.symbol || g.description}|${g.withholdingCountry}`;
  return [...groups.values()].sort(
    (a, b) => b.grossTotalEur.minus(a.grossTotalEur).toNumber() || tieKey(a).localeCompare(tieKey(b)),
  );
}
