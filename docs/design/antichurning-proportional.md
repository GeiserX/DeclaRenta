# Anti-churning rule — proportional blocking + reintegration (Art. 33.5.f/g LIRPF)

> Design contract for `feat/antichurning-proportional`, with the release rule of
> issue #451 (the «transmisión definitiva» queue). Supersedes the boolean
> whole-loss model. Grounded in BOE Art. 33.5.f/g + Art. 37.2, Art. 8 RIRPF, and
> DGT V0913-08 / V2481-20 / V3282-18 / V0248-18 / V0571-21 / V1760-23 /
> V0754-26 / V0046-20 / V1294-22 (all verified verbatim).

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
   patrimonio del contribuyente"* — the blocked loss is a **pending loss**. It is
   **NOT** added to the repurchased lot's cost basis. It is released only by a
   later **«transmisión definitiva»** of homogeneous shares: a sale, gain or loss,
   with no unused homogeneous repurchase in its own window (see "Release" below).
4. **Per-lot ("por paquetes")** proration base (V0913-08), matching our per-lot
   `FifoDisposal` granularity (one disposal per consumed FIFO lot).
5. **Total-sale carve-out.** If, after the transmission, no homogeneous shares
   remain in the taxpayer's patrimony, the loss is deductible in full (DGT
   V3282-18 situation 1). Pre-sale buys only block up to the shares that still
   remain after the sale; a later post-sale repurchase is still a genuine
   replacement and can block normally.
6. FIFO (Art. 37.2) decides **which** lots are sold and the loss; the homogeneity
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
- **Remaining-position budget**: signed BUY/SELL movements compute
  `holdingAfter = max(0, net position after the sale date)`. This caps only
  PRE-sale absorption and is shared across same-date FIFO disposal splits.
  Forward/reverse splits are applied to compare every movement in the sale's
  share units, matching the FIFO engine's split-adjusted disposal quantities.
- **Pending-loss queue**: per key, a FIFO list of `{qty, eur, time, sellDate}`
  entries, one per blocked loss, counted in the shares of the loss sale that a
  rebuy absorbed. A pending loss does not belong to a lot: any later definitive
  transmission of the same security releases it. `time` is the loss sale's date,
  so a loss blocked by one FIFO split of a sale is never released by another
  split of the same sale. Entries are split-adjusted at release time.

For each disposal (chronological):
1. **Absorb.** Take the in-window homogeneous repurchases that no earlier
   transmission used: POST-sale buys first, uncapped, because they are genuine
   replacement lots; then PRE-sale buys newest-first, only up to the
   remaining-position budget `holdingAfter`. A full exit with no later
   repurchase therefore absorbs `0`, while a full exit followed by a later
   repurchase still absorbs the post-sale quantity. A buy on the sale day is the
   lot being sold and is skipped. This runs for **every loss sale**, and for a
   **gain sale while losses are pending**: the definitive test applies
   «con independencia de que determinen ganancias o pérdidas patrimoniales» and
   uses «los mismos criterios» as the block (V3282-18), and a rebuy counted there
   is used up for later sales (V0248-18: «no pueden considerarse 3000 acciones
   que ya fueron tenidas en cuenta en la transmisión de 25 de abril»). A gain
   sale with nothing pending has no test to run and uses no rebuy.
2. **Release.** The shares no rebuy absorbed are definitive. Each releases one
   pending share's loss, **oldest first**, into `reintegratedLossEur`, whichever
   lot FIFO sells. V0754-26: the definitive 2026 sale of 770 shares releases
   «1 de agosto de 2025 – 190 acciones … 9 de octubre de 2025 – 185 acciones de
   las 207». V0571-21: the definitive 25/12 sale of 3,000 releases the 800 of
   2,000 shares of 05/07 and the loss of 1,000 of the 3,000 shares of 08/07.
   V0046-20: a definitive sale of old FIFO lots is enough. The absorbed shares
   keep the pending losses deferred (V3282-18: «no se produce ninguna
   transmisión definitiva de acciones a lo largo del ejercicio 2017»).
3. **Total exit.** A sale day whose sales no rebuy absorbed and that leaves no
   shares releases every loss still pending. V1760-23: «en el periodo impositivo
   que transmita de forma definitiva las 10 acciones que quedan en su poder …
   podrá imputar las pérdidas patrimoniales de 2022 que le resten por imputar».
   The queue can hold more shares than the position, because a rebought loss
   sale keeps the old losses pending and adds its own; without this step those
   losses would never come back.
4. **Block (losses only).** `blockedLossEur = |gainLossEur| × absorbed/qty`,
   appended to the end of the queue. The absorbed shares that keep the old
   losses pending are the same ones that block this loss; they are not counted
   twice (V0913-08: «se produce la transmisión efectiva de 955 acciones, por lo
   que podrá integrarse la pérdida patrimonial no integrada el 15 de febrero que
   corresponda a 955 acciones … no podrá imputarse la pérdida patrimonial que
   corresponda a 10 acciones»).

Worked example (issue #451, 1 share): buy A 100 (01/09/2025), sell 80
(01/10, −20), buy B 75 (05/10), sell 70 (10/10, −5), buy C 72 (25/10). The 01/10
sale is absorbed by B: 20 blocked. The 10/10 sale is absorbed by C: it is not
definitive, so the 20 stays pending, and its own 5 is blocked. 2025: blocked 25,
released 0, deductible 0. Selling C in 2026 with no rebuy is definitive and a
total exit: it releases both, 25.

### New `FifoDisposal` fields

- `blockedLossEur: Decimal` — portion of THIS disposal's loss deferred now
  (`0 ≤ blockedLossEur ≤ |gainLossEur|`). Replaces the all-or-nothing meaning.
- `reintegratedLossEur: Decimal` — pending loss of earlier sales released by
  THIS disposal's definitive shares (`≥ 0`).
- `washSaleRepurchaseDates?: string[]` — display only: the purchases that
  absorbed this disposal's loss.
- `washSaleReleasedFromDates?: string[]` — display only: the sell dates of the
  loss sales whose pending loss this disposal released. The web tables show a
  blocked row with the purchases that blocked it, and a releasing row with the
  loss sales it releases, because a pending loss no longer belongs to one lot.
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
homogéneos"*, and integrate the deferred losses in the year of the definitive
transmission that releases them.

## Cross-year scope

- **Within a merged multi-file run** (`--input 2023 2024 2025`): fully handled —
  the single global pass blocks in the earlier year and releases in the year of
  the definitive transmission, by the same rule.
- **Separate per-year filings**: the pending-loss queue is not persisted to disk in
  this change. Users file cross-year correctly by uploading adjacent years
  together (already supported). A `--prior-blocked-losses` JSON I/O analogous to
  `--prior-losses` (Art. 49) is a documented **future** follow-up — deliberately
  not built here to avoid speculative persistent state.

## Known limitations (documented, accepted)

- **Listed/unlisted heuristic** (ISIN-presence → 2 months) unchanged; an
  ISIN-bearing unlisted instrument still gets the 2-month window.
- **Same-day intraday** sell-then-rebuy still excluded (no intraday timestamps).
  This now also covers the definitive test: the DGT treats a buy on the sale day
  as a rebuy that makes the sale non-definitive (V0571-21, 11/08/2020), and the
  engine releases on such a sale. In V0571-21 itself the engine still gets the
  DGT's answer, because an unused pre-sale buy also absorbs that sale.
- **Rebuy pick order**: post-sale buys first, then pre-sale newest-first. The
  DGT picks the earliest unused buy, pre-sale before post-sale (V3282-18,
  V1760-23). The totals match on V3282-18, V0571-21, V1760-23 and V0754-26, but
  not on V2481-20: there the 22/04 loss is rebought the same day, the engine
  takes 905 of the 27/04 buy instead, and the 29/04 sale ends up definitive for
  925 shares (2020: engine 1,079.44, DGT 1,767). A pre-sale-first order gives
  1,751.73 there but breaks V1760-23, and no strict budget reaches 1,767: the
  DGT's short answer does not track the 23/04 gain sales' use of the 06/05 buy.
  Tracked apart from #451.
- **Lot attribution inside one sale**: when one sale spans several FIFO lots,
  the engine lets the first-processed (oldest) lot absorb the rebuy first. The
  DGT puts the deductible part on the first-acquired shares (V0913-08, V1294-22,
  Art. 37.2), so the blocked part sits on the newest lots. Totals of blocked
  loss can differ by the price gap between lots (V0913-08: 144,000 against the
  DGT's 144,500). The release step is not affected.
- **Multiple sales, one repurchase**: budget consumed **chronologically**
  (earliest sale first, gain sales with pending losses included), the most
  defensible reading (DGT lot-tracking is chronological; AEAT gives no explicit
  tiebreak).
- **Single-purchase exception** (AEAT Manual 2025, V3282-18 A): not applied; a
  separate issue. It would feed the definitive test too («los mismos
  criterios»).
- **Single-year files**: if the user omits prior-year buys, `holdingAfter` can
  understate the real position and is clamped at zero. This is the same data
  window limitation the FIFO engine already surfaces elsewhere; this fix does
  not reconstruct prior-year holdings from absent input.
- **Corporate actions**: forward/reverse splits are reflected in both the
  remaining-position cap and deferred-loss release proration. More complex
  tax-neutral transformations (mergers, spin-offs, scrip dividends) still rely
  on the FIFO disposal stream for the actual gain/loss and should get dedicated
  anti-churning tests if a real case reaches this path.

## Migration note (issue #451)

Up to 0.66.5 the engine released a pending loss as soon as the repurchased lot
that carried it was sold, even when that sale was itself rebought inside its
window. A year filed with 0.66.5 or earlier may therefore have deducted a loss
too early. When a newer version releases that loss in a later year, the user
must not deduct the part already deducted, or must file an «autoliquidación
complementaria» for the earlier year. Verified case: the issue example filed for
2025 with 0.66.5 deducted 20; the new engine releases 25 in 2026 instead of 5.
The lifetime total does not change; only the year does. The new rule can also
move a loss to an earlier year (V0046-20, the V1760-23 total exit); there the
user can ask to rectify the earlier return to claim it. The in-app Renta Web
guide (`guide_rw.blocked_losses_hint`) carries the short version in all five
locales.

Pinned by `tests/integration/antichurning-definitive-e2e.test.ts` (one block per
consulta, through `generateTaxReport`, plus a seeded property: over a position
closed by a definitive sale, Σ blocked = Σ released) and the queue cases in
`tests/engine/wash-sale.test.ts`.
