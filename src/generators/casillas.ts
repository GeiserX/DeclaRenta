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
 *     crypto, non-listed funds, and foreign-currency gains (Art. 37.1.l):
 *       1626 = Tipo de elemento patrimonial. Clave (use 4 = no afectos)
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
import type { FifoDisposal, TaxSummary } from "../types/tax.js";

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
 * listing flag becomes available. See docs.html FAQ for the user-facing note.
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

function accumulate(block: CasillaBlock, d: FifoDisposal): void {
  block.transmissionValue = block.transmissionValue.plus(d.proceedsEur);
  block.acquisitionValue = block.acquisitionValue.plus(d.costBasisEur);
  // Zero-gain disposals fall into the gains bucket (>= 0). This is a sum-of-
  // positives / sum-of-losses split for the 0339/0340 (or 0386/0385) totals; a
  // zero contributes nothing either way, so the boundary choice is immaterial to
  // the figures and only keeps the count of "loss" rows from being inflated.
  if (d.gainLossEur.greaterThanOrEqualTo(0)) {
    block.gains = block.gains.plus(d.gainLossEur);
  } else {
    block.losses = block.losses.plus(d.gainLossEur.abs());
  }
  block.netGainLoss = block.netGainLoss.plus(d.gainLossEur);
  block.count += 1;
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
  return { listedShares, otherElements };
}

/**
 * Compute the casilla blocks AND fold foreign-currency (FX) gains into the
 * "otros elementos" block. Use this from output generators (PDF/CSV/CLI/web) so
 * the FX merge lives in exactly one place — previously each consumer added
 * `report.fxGains.*` to `otherElements` by hand, which is easy to get wrong and
 * drifts between formats.
 *
 * FX gains (Art. 37.1.l LIRPF) are reported in the same 1633/1637 block as
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
  return { listedShares, otherElements: merged };
}
