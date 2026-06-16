# Anti-churning rule — proportional blocking + reintegration (Art. 33.5.f/g LIRPF)

> Design contract for `feat/antichurning-proportional`. Supersedes the boolean
> whole-loss model. Grounded in BOE Art. 33.5.f/g + Art. 37.2, Art. 8 RIRPF, and
> DGT V0913-08 / V2481-20 / V3282-18 (all verified verbatim).

## The rule (verified against primary sources)

When a taxpayer sells securities at a **loss** and acquires **homogeneous**
securities within **±2 calendar months** (listed, letter f) / **±1 year**
(unlisted, letter g) of the sale, the loss is **not computable now**. It is:

1. **Proportional to the repurchased quantity.** Sell 100 at a loss, rebuy 30 →
   only the loss on **30** is blocked/deferred; the loss on **70** is deductible
   now. The block attaches to *"un número de acciones … igual al saldo de las
   existentes"* (V2481-20/V3282-18); the non-imputable loss is *"la
   correspondiente a las acciones que se consideran recompradas"* (V0913-08).
2. **No double-counting.** *"no puede resultar que una misma compra determine la
   no imputación de varias pérdidas patrimoniales"* (V2481-20) — one repurchased
   share absorbs one sold share's loss, once. Repurchase quantity is a
   **consumable budget**.
3. **Deferred, not forfeited.** *"las pérdidas patrimoniales se integrarán a
   medida que se transmitan los valores o participaciones que permanezcan en el
   patrimonio del contribuyente"* — the blocked loss is a **pending loss**
   released when the surviving repurchased shares are later transmitted. It is
   **NOT** added to the repurchased lot's cost basis.
4. **Per-lot ("por paquetes")** proration base (V0913-08), matching our per-lot
   `FifoDisposal` granularity (one disposal per consumed FIFO lot).
5. FIFO (Art. 37.2) decides **which** lots are sold and the loss; the homogeneity
   test (Art. 33.5.f/g) is a **separate** overlay deciding whether that loss is
   blocked. Two independent steps.

## What was wrong before (both confirmed in code)

- `wash-sale.ts` set `washSaleBlocked: boolean` on `inWindowCount > 0` — **any**
  repurchase blocked the **whole** loss (rebuy 1 share → block 100). No
  proportionality; repurchase quantity discarded at indexing.
- `report.ts`/`casillas.ts` never excluded the blocked loss from the deductible
  base; only a presentation chart (`taxable-base.ts`) added it back, and that
  module's own comment admits it diverges from the engine and "does NOT try to
  reconcile." Net effect: the **filed base could under-tax** (loss deducted that
  should defer) while the **chart over-removed** it — two different wrong numbers.

## The model

### Engine (`detectWashSales`, rewritten)

Operates on the **full, all-year** disposal set in **one chronological pass**
(so cross-year reintegration works in merged multi-file runs). Per
homogeneous key:

- **Buy budget**: sorted buy events `{time, qty}`; `qty` is consumable.
- **Deferred ledger**: `Map<acquireTime, {qty, deferredEur}>` — deferred loss
  attached to the repurchased lots (keyed by the repurchase buy's normalized
  date), released when a future disposal sells shares acquired on that date.

For each disposal (chronological):
1. **Reintegration (all disposals, gain or loss).** If it sells shares whose
   `acquireDate` matches a deferred-ledger entry, release proportionally:
   `reintegratedLossEur = entry.deferredEur × min(qty, entry.qty)/entry.qty`;
   decrement the entry.
2. **Blocking (loss disposals only).** Sum in-window homogeneous repurchase qty
   (excluding buys on the sell date — the lot being sold), `absorbed =
   min(repurchasedQtyAvailable, disposal.qty)`,
   `blockedLossEur = |gainLossEur| × absorbed/qty`. Consume `absorbed` from the
   in-window buys (FIFO), attaching the deferred loss to each consumed buy's
   date in the ledger.

### New `FifoDisposal` fields

- `blockedLossEur: Decimal` — portion of THIS disposal's loss deferred now
  (`0 ≤ blockedLossEur ≤ |gainLossEur|`). Replaces the all-or-nothing meaning.
- `reintegratedLossEur: Decimal` — prior deferred loss released because THIS
  disposal sold tainted repurchased shares (`≥ 0`).
- `washSaleBlocked: boolean` retained = `blockedLossEur.gt(0)` (display flag,
  keeps CSV/CLI/annex consumers unchanged).

Invariant preserved: `proceedsEur − costBasisEur === gainLossEur` (the raw
transmission is untouched; blocking/reintegration are separate adjustments).

### Report reconciliation (`report.ts`)

- `blockedLosses = Σ blockedLossEur` (proportional now).
- `reintegratedLosses = Σ reintegratedLossEur` (NEW on `capitalGains`).
- **Fiscal capital-gains contribution** = `netGainLoss + blockedLosses −
  reintegratedLosses` (add back the deferred portion not deductible now;
  subtract the prior deferred losses now released).
- `totalSavingsBase` uses the **fiscal** capital-gains contribution (this is the
  C1 fix — blocked losses no longer silently deducted; reintegrated ones are).
- `netGainLoss` headline stays **raw** (invariant + year-compare stability);
  blocking/reintegration surfaced as explicit separate lines.

### Chart (`taxable-base.ts`)

Formula becomes `max(0, capitalGains + blockedLosses − reintegratedLosses + fx +
dividends + interest)`, reconciled with the engine. The "deliberately diverges"
comment is removed.

## Casilla presentation

Transmission values (0327/0330 proceeds, 0328/0331 cost) are **unchanged** — you
still report every transmission. Blocked (deferred) and reintegrated losses are
surfaced as **separate informational lines** (mirroring the existing blocked-loss
line), matching how AEAT Renta Web works: enter the transmission, then flag the
non-computable loss via *"No imputación de pérdidas por recompra de valores
homogéneos"*, and integrate deferred losses when the surviving lot is sold.

## Cross-year scope

- **Within a merged multi-file run** (`--input 2023 2024 2025`): fully handled —
  the single global pass blocks in the earlier year and reintegrates in the year
  the surviving lot is sold.
- **Separate per-year filings**: the deferred ledger is not persisted to disk in
  this change. Users file cross-year correctly by uploading adjacent years
  together (already supported). A `--prior-blocked-losses` JSON I/O analogous to
  `--prior-losses` (Art. 49) is a documented **future** follow-up — deliberately
  not built here to avoid speculative persistent state.

## Known limitations (documented, accepted)

- **"Transmisión definitiva" rollforward**: doctrine says a deferred loss does
  NOT reintegrate if the surviving shares are re-repurchased within the window of
  *their* sale. We reintegrate on sale regardless. Direction of error: releases
  the deferred loss slightly too early in the rare re-churn case (minor
  under-payment that year, self-correcting) — strictly better than the prior
  behavior (loss lost forever). 
- **Listed/unlisted heuristic** (ISIN-presence → 2 months) unchanged; an
  ISIN-bearing unlisted instrument still gets the 2-month window.
- **Same-day intraday** sell-then-rebuy still excluded (no intraday timestamps).
- **Multiple loss-sales, one repurchase**: budget consumed **chronologically**
  (earliest loss-sale first), the most defensible reading (DGT lot-tracking is
  chronological; AEAT gives no explicit tiebreak).
