# Anti-churning rule — proportional blocking + reintegration (Art. 33.5.f/g LIRPF)

> Design contract for `feat/antichurning-proportional`, with the release rule of
> issue #451 (the «transmisión definitiva» queue). Supersedes the boolean
> whole-loss model. Grounded in BOE Art. 33.5.f/g + Art. 37.2, Art. 8 RIRPF, and
> DGT V0913-08 / V2481-20 / V3282-18 / V0248-18 / V0571-21 / V1760-23 /
> V0754-26 / V0046-20 / V1294-22 / V0279-25 (all verified verbatim).

## The rule (verified against primary sources)

When a taxpayer sells securities at a **loss** and acquires **homogeneous**
securities within **±2 calendar months** (admitted to trading on a regulated
market of the European Economic Area or an equivalent third-country market,
letter f; NYSE and Nasdaq are equivalent, DGT V0778-25) / **±1 year** (admitted
to neither, letter g) of the sale, the loss is **not computable now**. It is:

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
   later **«transmisión definitiva»** of homogeneous shares: the shares of a
   later sale, gain or loss, that no unused homogeneous repurchase in that sale's
   window absorbs. The absorbed shares keep it deferred (see "Release" below).
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
  PRE-sale absorption, once per sale day.
  Forward/reverse splits are applied to compare every movement in the sale's
  share units, matching the FIFO engine's split-adjusted disposal quantities.
- **Pending-loss queue**: per key, a FIFO list of `{qty, eur, time, sellDate}`
  entries, one per blocked loss, counted in the shares of the loss sale that a
  rebuy absorbed. A pending loss does not belong to a lot: any later definitive
  transmission of the same security releases it. `time` is the loss sale's date,
  so a loss blocked by one FIFO split of a sale is never released by another
  split of the same sale. Entries are split-adjusted at release time.

For each sale day of a key (chronological). FIFO splits one sale into one
disposal per lot, and same-day sales have no intraday order, so the day is one
unit:
1. **Absorb.** Over the day's sold quantity, take the in-window homogeneous
   repurchases that no earlier transmission used, oldest first (the DGT's
   order, see "Pick order" below): PRE-sale buys, each only for its shares still
   held after the sale (the newest `holdingAfter` shares, FIFO); then POST-sale
   buys, uncapped, because they are genuine replacement lots; last, the rest of
   the lot the sale itself transmits. A full exit with no later repurchase
   therefore absorbs `0`, while a full exit followed by a later repurchase still
   absorbs the post-sale quantity. A buy on the sale day counts as the newest
   pre-sale purchase, for its own held shares (see "Pick order", step 3). This
   runs for **every loss sale**, and for a
   **gain sale while losses are pending**: the definitive test applies
   «con independencia de que determinen ganancias o pérdidas patrimoniales» and
   uses «los mismos criterios» as the block (V3282-18), and a rebuy counted there
   is used up for later sales (V0248-18: «no pueden considerarse 3000 acciones
   que ya fueron tenidas en cuenta en la transmisión de 25 de abril»). A gain
   lot with nothing pending has no test to run and uses no rebuy.
   **Hand out.** Of the shares sold, the rebought ones are the last acquired:
   «la pérdida patrimonial que puede imputarse es la atribuible a las acciones
   adquiridas en primer lugar» (V0913-08; V1294-22; Art. 37.2). So the absorbed
   shares go to the day's loss lots first, newest acquisition first, then to its
   gain lots, newest first. A loss lot inside a sale with a net gain stays
   blocked (V0279-25), and a pending loss elsewhere can never hand a gain lot
   the rebuy that blocks a loss lot of the same sale.
2. **Release.** The shares no rebuy absorbed are definitive. Each releases one
   pending share's loss, **oldest first**, into the `reintegratedLossEur` of
   the disposal that carries it, whichever lot FIFO sells. V0754-26: the definitive 2026 sale of 770 shares releases
   «1 de agosto de 2025 – 190 acciones … 9 de octubre de 2025 – 185 acciones de
   las 207». V0571-21: the definitive 25/12 sale of 3,000 releases the 800 of
   2,000 shares of 05/07 and the loss of 1,000 of the 3,000 shares of 08/07.
   V0046-20: a definitive sale of old FIFO lots is enough. The absorbed shares
   keep the pending losses deferred (V3282-18: «no se produce ninguna
   transmisión definitiva de acciones a lo largo del ejercicio 2017»).
   Only held shares are transmitted: a short cover (`isShort`) buys back shares
   sold short, so it runs no definitive test (it uses no rebuy as a gain lot),
   releases nothing and is no exit; its own loss still blocks. For the same
   reason the shares a cover buys are no repurchase: they go straight back to
   the lender and never stay in the patrimony («los valores … que permanezcan
   en el patrimonio»). FIFO books no lot for them (`consumeShortLots`) and
   `fx-fifo.ts` does not count a cover as a purchase. Only what a `C;O` buy (or
   a `C` buy larger than the open short) leaves after the cover is a held lot
   and a repurchase. The day's covered shares go to the cover buys in FIFO's
   own order (`compareFifoTradeOrder`: a `C;O` buy before a `C` buy, whatever
   the file order), so an orphan `C` buy listed before the `C;O` buy that
   closed the short is never counted as a repurchase. FIFO also runs the day's
   SELL `O` rows between the two, so the covered shares are split by the day
   the short opened (the short disposal's `acquireDate`): a `C;O` buy covers
   only a short opened on an earlier day, and a `C` buy covers what is left of
   it and then the short a same-day SELL `O` opened. In an intraday flip from
   short to long the shares each buy keeps are then the ones FIFO keeps.
   Without this a cover buy
   blocked a loss that nothing could release once the position stayed flat
   (Σ blocked ≠ Σ released). A zero-share
   disposal (a 0-quantity SELL row FIFO books with no lots) is skipped. The
   release keeps a cursor on the queue, so a sale of many lots walks it once.
3. **Total exit.** A sale day whose sales no rebuy absorbed and that leaves no
   shares releases every loss still pending. V1760-23: «en el periodo impositivo
   que transmita de forma definitiva las 10 acciones que quedan en su poder …
   podrá imputar las pérdidas patrimoniales de 2022 que le resten por imputar».
   The queue can hold more shares than the position, because a rebought loss
   sale keeps the old losses pending and adds its own; without this step those
   losses would never come back. The position must be zero both in the BUY/SELL
   trades and in FIFO (`remainingLots` plus the disposals' holding spans), so
   shares that came in without a BUY (scrip dividend, merger into a new ISIN,
   spin-off, reward lots) still count as held. A holding span starts on the
   date the shares entered the security: `entryDate`, which FIFO sets on
   spin-off lots and on lots of a merger into a new ISIN, and their disposals,
   else `acquireDate`. Those lots keep the parent's tax `acquireDate`
   (Art. 37.1), which would otherwise make them look held before the corporate
   action. A TC row that keeps the ISIN moves no shares into a new security,
   so its lots keep their entry date. The day must transmit held shares: a day
   of short covers only is no exit, and what the total exit releases goes to
   the day's last long sale, never to a short cover.
4. **Block (loss lots only).** `blockedLossEur = |gainLossEur| × absorbed/qty`,
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
- **Window past the loaded data**: the detector sees only the uploaded trades.
  A sale of the report's year whose window ends after the last date the upload
  covers (the statement end or the last trade of any security), and whose
  result a later buy could change (a loss not fully blocked, or a release),
  gets one shared warning, `report.antichurning_window_past_data` (5 locales).
  BLOCK and RELEASE are treated the same: nothing is withheld, the user is
  asked to add the next file. With several merged brokers, each broker's files
  end on their own date (its last trade of any security, or its statement end
  when later), and a security is covered up to the earliest end among the
  brokers that trade it. A broker with a statement end and no trades counts as
  one of the merged brokers too, so its later statement end cannot cover a
  security traded elsewhere. The per-security last trade is not used: a final exit
  never has a later trade of its own. From tax year 2024 on, a window that ends
  after 30 June of the next year (the filing deadline) is still open when the
  user files, so it gets `report.antichurning_window_open_at_filing` instead:
  no "if you did not buy, the result is correct", and a buy before the window
  ends means correcting the filed return with an autoliquidación rectificativa.
- **Separate per-year filings**: the pending-loss queue is not persisted to disk in
  this change. Users file cross-year correctly by uploading adjacent years
  together (already supported). A `--prior-blocked-losses` JSON I/O analogous to
  `--prior-losses` (Art. 49) is a documented **future** follow-up — deliberately
  not built here to avoid speculative persistent state.

## Known limitations (documented, accepted)

- **Window per ISIN (#452).** Letter f covers a regulated market of the
  European Economic Area (the EU, Norway, Iceland, Liechtenstein) and any
  third-country market the European Commission declared equivalent while the
  decision stands (DGT V0778-25). The MiFID II decisions in force are
  Implementing Decisions (EU) 2017/2320 (US: NYSE, Nasdaq and the other SEC
  national exchanges), 2017/2318 (Australia) and 2017/2319 (Hong Kong);
  Switzerland's (2017/2441, 2018/2047) covered 24/12/2017-30/06/2019, and the
  UK was EU law until 31/12/2020 and has none since. So a share listed only on
  NYSE or Nasdaq gets 2 months under the statute too. The EMIR art. 2a
  decisions 2016/2273 (TSX, TSX Venture, Aequitas Neo), 2016/2271 (Tokyo) and
  2016/2270 (Singapore) also declare markets equivalent to a regulated market,
  and V0778-25 accepted that kind of decision for CME; no consulta applies it
  to shares, so that point is open. `src/engine/antichurning-window.ts`
  resolves one window per ISIN: the user's value (`windowMonthsByIsin`, the
  web panel, `--antichurning-1y` / `--antichurning-2m`) wins; else 12 only
  when every IBKR `listingExchange` of the ISIN (Trades and SecurityInfo) in
  force on the sale day is in `NON_EQUIVALENT_LISTINGS` and outside its
  equivalence spans on that day (London admitted to neither kind of market
  from 2021, SIX outside its spans, OTC Markets, Japannext, Stock Connect,
  other third countries). A code stops being in force only when a later row
  of the same contract (conid), dated on or before the sale day, names
  another code (`listingsOn`: a share that left NYSE for OTC Markets); a
  SecurityInfo row is dated on its statement's last day; else
  the old heuristic (ISIN → 2, no ISIN → 12). The EMIR-only codes stay at 2
  months with `report.antichurning_listing_open`. The same map reaches
  `detectWashSales` (block and definitive test) and `salesWithWindowPastData`.
  Remaining limits: a listing IBKR does not show (Shell on Amsterdam) needs
  the user's 2-month mark; a no-ISIN US listing keeps 12; no warning when a
  1-year window starts before the upload; which date counts when an
  equivalence starts or ends inside the window is the sale day (open).
- **Crypto window (handled).** Crypto is no «valor o participación» (DGT
  V0648-24, V0525-25), so letters f and g do not apply. The engine applies art.
  33.5.e: only a repurchase of the same coin (the `CRYPTO:<SYMBOL>` key, any
  exchange) in the year after the sale counts, de fecha a fecha with the end
  day included, and a buy before the sale or on the sale day never blocks
  (`looksBack` in `wash-sale.ts`, #457). The window end, the past-data warning
  and the 30 June split did not move. This is a deduction, not a holding: no
  consulta names crypto and art. 33.5 together; V1613-25 applies letter e
  «y no las letras f) y g)» to dollars, the closest fungible non-security.
  Release (#457 follow-up): letter e has its own release sentence («se
  integrará cuando se produzca la posterior transmisión del elemento
  patrimonial», without the f/g «que permanezcan»), and the AEAT Manual
  integrates the loss when «se transmita el elemento patrimonial adquirido».
  So a crypto loss does not go into the share-count queue's definitive test.
  It is tied to the coins of the repurchase that blocked it (tie groups per
  buy day) and released when FIFO transmits those coins, in proportion to the
  quantity. A sale of other coins releases nothing, and so does a sell-out
  before the rebuy arrives (no total exit for crypto). Of one buy day's coins
  the tied ones go last, and reward coins of that day carry no tie (FIFO
  books a day's trade coins before its reward coins). A tied coin sold
  releases its claims even when the coin is bought again in the year after:
  letter e names that transmission as the moment and has no f/g «definitiva»
  test, and the new buy can block the new sale's own loss instead. Only loss
  lots take a rebuy, so a gain sale (of tied or other coins) uses up none that
  a later loss needs. A crypto release is final, so by itself it raises no
  past-data or open-at-filing warning. No consulta names crypto and art. 33.5 together; the rule reads the
  statute and the Manual, and never releases earlier than the law allows.
  Open points it leaves: (B) A partial reacquisition stays
  proportional, though V0913-08 speaks of «valores». (C) Staking, airdrop and
  reward receipts are no repurchase (reward lots stay out of
  `washSaleTrades`), the less strict choice, which no source settles.
- **Sale-day buys (closed by the #454 follow-up).** A buy on the sale day
  counts for its own held shares (V0571-21; see "Pick order", step 3). The
  stand-in it replaced had three gaps, now pinned on the DGT's figures in
  `tests/integration/antichurning-same-day-held-e2e.test.ts` (IBKR and DEGIRO,
  all three FX methods). (a) The rebuy was missed when no unused older lot was
  in the window: buy 100, sell them at a loss on 10/03 and buy 50 the same day
  blocked 0 when the 100 were bought on 01/12/2024; now 50. With the older lot
  used (buy 100 on 01/03 and 100 on 02/03, sell 100 on 03/03 at −100, then
  sell 100 on 10/03 at −100 and buy 50), 10/03 blocked 0 and released 100
  (fiscal −200); now 50 blocked, 50 released (−100). A sale with a same-day
  rebuy counted as definitive (buy 100 on 01/12/2024, sell 50 on 05/03/2025 at
  −50 rebought on 08/03, sell all 100 on 20/03 at +100 and buy 300): released
  50 (fiscal 50); now 0 (fiscal 100). (b) The sale-day shares were used twice:
  sell 25 more at a loss on 20/03 blocked 25; now deducted, releasing 25 of
  the 10/03 loss. (c) The stood-in lot went after the post-sale buys: buy 100
  on 01/03; on 10/03 sell 100 at −100 and buy 50; on 15/03 buy 100; on 20/03
  sell 50 at −50 gave fiscal −100; now 10/03 takes its 50 and 50 of 15/03, and
  20/03 blocks the other 50 of 15/03 (fiscal 0).
- **V2481-20** (engine 1,751.73, DGT 1,767; `it.fails` on the DGT's figure).
  The 23/04 sales leave no shares, so no purchase before them counts (V3282-18
  A, situation 1): they take the 1,880 of 27/04 and 40 of the 1,900 of 06/05.
  Only 1,860 are left for the 1,880 shares sold on 29/04, so 20 are definitive
  and release 20 × 672/880 = 15.27. The DGT says only that the 06/05 purchase
  prevents the release and does not count the 40 shares. Neither the pick
  order nor the sale-day rule changes this figure.
- **Multiple sales, one repurchase**: budget consumed **chronologically**
  (earliest sale day first, gain sales with pending losses included), the most
  defensible reading (DGT lot-tracking is chronological; AEAT gives no explicit
  tiebreak).
- **Single-purchase exception** (V3282-18 A, AEAT Manual 2025; #453): see
  "One-purchase exception" below. Fail safe where the upload cannot prove the
  zero holding at the window start.
- **Single-year files**: if the user omits prior-year buys, `holdingAfter` can
  understate the real position and is clamped at zero. This is the same data
  window limitation the FIFO engine already surfaces elsewhere; this fix does
  not reconstruct prior-year holdings from absent input.
- **Corporate actions**: forward/reverse splits are reflected in both the
  remaining-position cap and deferred-loss release proration. The total exit
  also reads FIFO's lots, so scrip dividends and mergers into a new ISIN keep
  the position open (tested). The pre-sale cap still reads the BUY/SELL trades
  only, so after such an action it can understate the position, the same way
  as the single-year limitation above.

## One-purchase exception (issue #453)

V3282-18, rule A) on the purchases of the 2 months before the sale: «No
obstante, esta regla no resulta de aplicación cuando dentro del plazo de los dos
meses anteriores a la transmisión sólo se hubiera efectuado una operación de
compra y, además, al inicio de ese período no se tuvieran acciones o
participaciones homogéneas.» The same paragraph is in every later consulta that
repeats the procedure (V0183-23, V0709-24, V0279-25, …) and in the AEAT Manual
práctico Renta 2025. The decisions, each pinned in
`tests/integration/antichurning-single-purchase-e2e.test.ts`:

- **Only the pre-sale pass.** The exception lifts rule A) only. Rule B) follows
  it «sin perjuicio de que las recompras efectuadas en el plazo de los dos meses
  posteriores a la transmisión impidan también la imputación», and the manual
  adds «Asimismo, deben tenerse en cuenta las compras posteriores a la venta».
  So the post-sale pass runs unchanged and a rebuy after the sale still blocks.
  When the exception holds, the pre-sale buy is not consumed: it was not
  «considerada recompra» for this sale.
- **Letter f only.** The doctrine states it inside «el procedimiento para la
  aplicación de lo previsto en el artículo 33.5.f)», for «los dos meses
  anteriores». V0183-23 sends US shares to letter g without saying the
  procedure carries over. The engine applies it to the 2-month window only;
  the 1-year window (no ISIN, crypto) keeps rule A) whole.
- **One operation = one order on one day.** IBKR's parser already collapses the
  executions of one `ibOrderID` per day into one trade; DEGIRO and Flatex write
  the order id as `tradeID` on each fill. Rows of one broker, account and day
  with the same `ibOrderID || tradeID` are one operation; a row with no id is
  its own. A GTC order filled on two days is two purchases (the parser splits it
  per day too). Every BUY row counts, cover buys included, and the count runs
  to the sale day included: a same-day buy has no intraday order, so it counts
  as a second purchase (fail safe).
- **No shares at the window start.** "At the start" is before the first day of
  the window: the split-adjusted long position over the days before it must be
  zero, and FIFO must hold no lot that entered before it (scrip, merger,
  spin-off lots). The trades are the merged upload, all brokers and the manual
  opening lots. The long position counts held shares only: a SELL "O" opens a
  short and takes none, and a cover buy adds only what it does not cover. So a
  short opened and covered before the window changes nothing. When the upload
  itself shows shares at the window start, the answer is null (no mark).
- **Fail safe: the upload must prove the zero.** A file's start date proves
  nothing about shares bought before it, at the same broker or any other. The
  exception is "applied" only when all of these hold, and "unverified" (not
  applied, `report.antichurning_single_purchase_unverified` warns) otherwise:
  - The long position never goes negative (a sale of shares the upload never
    shows bought).
  - No share trade without an ISIN (not the exempt categories, not crypto), of
    any account, falls between the window start and the latest list date the
    check uses, and none has an unreadable date. Such a trade sits in a
    symbol-only bucket, so its buy is missing from the ISIN's purchase count
    and its sale from the reconciliation. No identifier ties it to an ISIN in
    every file (IBKR's `conid` is optional, other brokers have none), so none
    is resolved: fail safe.
  - No share holding without an ISIN may be open at the window start
    (`unidentifiedHeldAt`): FIFO holds no ISIN-less share lot that entered
    before it and was not sold before it (`buildUnidentifiedFifoHoldings`,
    which also sees lots no BUY row opened, such as a scrip dividend keyed on
    its bare symbol), and no account ever sells more shares of an ISIN-less
    key than it shows bought (those shares were held before the files,
    perhaps still at the window start). That last test runs per account
    (`someAccountSoldUnbought`), because FIFO is the taxpayer's, across
    accounts: account B's sale of shares it held before its files can take
    account A's lot, so neither the lots nor the symbol's merged balance show
    A's shares, still held. With no account ever below zero, FIFO holds a lot
    exactly when some account does. Manual opening lots belong to no uploaded
    account, so any account may sell them: a day's shortfall is taken from
    them first. A trade with neither ISIN nor symbol before the window has no
    holding to walk and also fails.
  - No share trade has a missing or unreadable quantity. Every share parser
    (IBKR, DEGIRO, Trade Republic, Trading 212, Revolut, Freedom24, Lightyear,
    Scalable Capital, Flatex, eToro) keeps such a buy or sale row with
    quantity "0" and `Trade.quantityUnknown`, where it skips a written "0"
    (an explicit 0 stays a zero with no flag, and `parser.trade_quantity_unknown`
    names the rows). Outside IBKR the kept row carries only the security, the
    day and the direction, every amount "0" (`quantityUnknownTrade`), so it
    moves no money, and FIFO skips every such row, so it books no shares (a
    0-share lot would give the next sale a 0/0 cost). An IBKR fill with no
    readable quantity stays out of its order's merge as its own flagged row,
    so the readable fills of that order still merge and book their shares and
    cost. A cell that is blank, only a currency symbol ("€") or no number is
    unreadable. Only a buy or sale row is kept: a Freedom24 transfer stays
    skipped, a Flatex row with neither Nominal nor Kurs is kept only when its
    text says Kauf or Verkauf, a DEGIRO row with neither quantity nor price
    only when it has an order id or a value, and a written zero price (a
    conversion, a rights assignment) is always skipped. Revolut's
    closed-positions format keeps both legs of such a row, as eToro does. A
    buy or sale with a readable quantity but a blank or unreadable price is
    kept the same way (a Flatex Kauf or Verkauf, a DEGIRO row with an order id
    or a value, a Trading 212 buy with no price and a Total in another
    currency): FIFO cannot book shares with no cost, and a dropped row would
    hide a second purchase. An IBKR cancellation whose quantity or price is
    unreadable pairs with its fill only by the same `ibExecID`; with none it
    is dropped alone, and its warning does not claim the original is outside
    the file. A crypto row of unknown quantity is no repurchase either: FIFO
    holds no lot for it, so no loss is tied to its coins. Its warning is the
    crypto one: it says that a crypto loss before such a rebuy may have to
    wait (art. 33.5.e) and that DeclaRenta does not block it, and it does not
    name the one-purchase exception, which crypto does not have. With an ISIN, the row makes that security "unverified":
    it may be a second purchase, or a purchase and a sale that leave the list
    unchanged. With no ISIN, it is an unidentified trade with no holding to
    walk, like one with neither ISIN nor symbol: before the window or in the
    checked span, it fails every ISIN. Before this, both rows read "0" and the
    check skipped them, so a buy in the window and its sale, both without a
    quantity, vanished and the exception was applied. Such a holding may be
    this security bought before the window: a Flex without the Trades ISIN
    column, or a Revolut file (Revolut gives no ISIN), would otherwise hide
    it, because its account never trades the ISIN key. A holding closed
    before the window does not stop the exception.
  - `buildEvidenceCheck`, for EVERY account (broker and account id) that
    trades the key or lists it in any holdings list of the upload:
    1. it has a holdings list dated on or after the sale day; the earliest such
       date counts (the IBKR parser keeps the SUMMARY row of a holding and
       drops its LOT rows, so the Summary and Lot options together do not count
       it twice). An empty list counts only when the file says it has the
       section (`AccountPeriod.hasPositions`, an empty `<OpenPositions />`);
       with no section there is no list. Each row goes to the account it
       names, in a one-account file too; the IBKR parser gives a row without
       an Account ID its FlexStatement's account (a Trade row too, so a Flex
       without the Account ID column in either section still proves), and a
       row of no listed account forms its own group with no period (so it
       fails);
    2. its files with a trades section cover every day from the window start
       to that date exactly once: no gap (a hidden trade) and no day in two
       files (merge does not drop duplicated trades, so the same Flex uploaded
       twice would double them and still match a doubled list). Back-to-back
       periods qualify. The IBKR parser gives one period per FlexStatement,
       so each account of a multi-account Flex has its own, and marks the ones
       without a `<Trades>` element (`AccountPeriod.hasTrades`): a
       holdings-only Flex covers nothing, though it can give the list;
    3. every row of the key in that list has a readable quantity. IBKR writes
       it as `position` (hand-written files may use `quantity`); the parser
       marks a missing or non-numeric one `quantityUnknown` instead of reading
       its "0" default (the quantity stays "0" so the D-6 and the 720 do not
       crash). The two forms then differ: the D-6 leaves such a holding out of
       its positions list (it has no share count), though it never lists a long
       one as a cancellation (the broker still lists it, so it was not sold);
       the Modelo 720 keeps it with its value and 0 in «Número de valores». A
       short one (negative value) is no holding, so both cancel it: without a
       share count the D-6 reads the sign from the value, as the 720 does.
       `parser.open_position_quantity_unknown` names those holdings so the user
       checks both forms by hand. A list with no row of the key says zero, but only when
       every share row (not the exempt categories, not crypto) of every list in
       the upload has an ISIN: Open Positions may leave the ISIN field out
       while Trades has it, and then the row of the shares held is no row of
       the key;
    4. the long holding listed equals what that account's own trades from the
       window start leave on that date, split-adjusted to that date, and that
       replay never ends a day below zero (`longPositionAt` answers null): a
       sale of shares the account held at the window start, which a later buy
       and a transfer out can hide in the end total and the merged position.

    Then the account held nothing at the window start: its list is that
    holding plus its trades since. Each account is checked on its own, in its
    own list's share units, so a split between two lists' dates cannot mix
    units. Nothing is offset between accounts: one account's surplus and
    another's deficit fit both a transfer between them and shares held before
    plus a transfer out of the upload, and no parser documents transfers. So a
    transfer between two uploaded accounts is "unverified", and so is a manual
    opening lot of the key dated on or after the window start (it comes from an
    account the upload does not hold). Only IBKR
    (OpenPositions) gives such lists today. Revolut's list is built by its
    parser from the file's own trades (`OpenPosition.fromTrades`), so it always
    matches them and is ignored. An account in a transactions CSV (DEGIRO,
    Trade Republic and the rest) that trades the key therefore always gets
    "unverified"; Revolut trades never carry the ISIN key, so they count only
    through the two ISIN-less rules above.
  Left invisible on purpose: a broker or account the user did not upload, and
  shares held at the window start that a transfer out of the upload (which the
  IBKR parser does not read) hides before the list date, also when they pass
  through another uploaded account first: the reconciliation catches a
  transfer only when it leaves a difference in some account. The info message
  `report.antichurning_single_purchase` names both whenever the exception is
  applied.
- **Definitive test.** Gain lots with pending losses share the absorption, so
  the exception decides the definitive test too («deberán observarse los mismos
  criterios»).
- The check runs only where the pre-sale pass would take something, so a sale
  it cannot change carries no mark (`FifoDisposal.washSaleSinglePurchase`,
  display only).

No committed fixture changed: the only fixtures where the pre-sale pass blocks
or keeps a sale non-definitive are `revolut-sample.xlsx` (BTC, 1-year window)
and `trading212-v2-sample.csv` (ALFA, two buys in the window).

## Pick order (issue #454)

Up to 0.66.13 the engine took post-sale buys first, then pre-sale buys newest
first, capped by `holdingAfter`. The DGT names the purchase each sale takes, and
the order it follows is derived from those names:

1. **Oldest unused purchase first, so the purchases before the sale come before
   those after it.** V3282-18 gives the 26/03 sale «las 2.000 acciones
   adquiridas el 20 de marzo», not 24/03 nor the later 28/03; the 31/03 sale
   gets 24/03 and the 05/04 sale 28/03 («al haberse tenido en cuenta ya las
   adquisiciones de 15 de marzo de 2017, de 20 de marzo de 2017 y de 24 de marzo
   de 2017»). V0248-18: the 16/02 sale takes the 2,000 of 15/02, 25/04 takes
   3,000 of the 5,000 of 18/03, so 28/04 finds «5000 acciones (2.000, 3.000)»
   and 29/05 «(3000, 4.000) … 7.000».
2. **A purchase already used by an earlier sale is out** («sólo deberán
   tenerse en cuenta … las compras de acciones que a su vez no hayan sido
   consideradas previamente recompras», V0248-18, V3282-18; one purchase cannot
   block two losses, V0913-08, V2481-20). Unchanged.
3. **A pre-sale purchase counts only for its shares still held after the
   sale** (rule A: «únicamente, las compras que supongan una recompra»;
   situation 3: «un número de acciones … igual al saldo de las existentes
   después»). V1760-23: the 10/05 sale finds the 06/05 shares used and the
   04/05 shares sold, so its repurchase is the 10/06 purchase, after it. The
   engine reads the held shares as FIFO leaves them: the newest `holdingAfter`
   shares, handed to the buy days before the sale, newest first.

   **The sale day.** Brokers give no time of day, but FIFO sells the oldest
   shares first, so the shares bought on the sale day are the newest ones held
   after it. The walk therefore starts at the sale day: its buys take the first
   part of `holdingAfter` and count for their own held shares, and a sale uses
   them like any other purchase (after the older held days, before the
   post-sale buys; last when they are only partly held, step 4). The DGT counts
   a sale-day buy as a rebuy (V0571-21: the 7,000 bought on 11/08 make that
   sale not definitive). Buy 100 on 01/03 and 40 on 05/03, sell 100 at a loss
   and buy 50 on 10/03: 90 blocked (05/03 and the 50 of 10/03; situation 3
   gives min(90 held, 140 bought) = 90 too). Taking the sale-day buys off the
   count instead (proposed in the review of #454) gives 40 there, and V2481-20
   1,088.08, V0571-21 −1,500. Crypto never reaches the sale day: its window
   starts at the sale (art. 33.5.e), so its walk is empty. For the
   one-purchase exception a sale-day buy is still a second purchase.

   Up to the #454 follow-up the walk skipped the sale day while `holdingAfter`
   counted its buys, so an older lot, even one FIFO sold, stood in for the
   sale-day rebuy. That stand-in missed the rebuy when no unused older lot was
   in the window, left the sale-day buy for a later sale to use again, and,
   because the stood-in lot was only partly held, put it after the post-sale
   buys. The cases are in "Known limitations" (closed).
4. **The rest of the lot the sale transmits comes last, after the post-sale
   purchases.** V3282-18 gives the 20/02 sale «las 2.000 acciones adquiridas el
   15 de marzo», not the 2,000 left of the 15/02 lot it sells from; V1760-23
   gives the 05/05 and 09/05 sales the 06/05 purchase, not the rest of the 04/05
   lot. That rest still counts (situation 3; the one-purchase exception exists
   because it would), so it is used when nothing else covers the sale.

   The buys of one day are one purchase for steps 3 and 4. Brokers give no time
   of day, and DEGIRO lists one order as one row per fill with one «ID Orden».
   So the engine counts the held shares per buy day, and when that day is only
   partly held, every row of the day goes last. Per row, the fills FIFO did not
   touch would count as fully held and come before the post-sale purchases, and
   the year would depend on how the broker split the order: buy 100 on 01/03,
   sell 50 on 10/03, buy 50 on 15/03, sell 50 on 20/03 gives −200 as one row
   and gave −40 as fills of 60 + 40.

The same order runs the definitive test of #451 («los mismos criterios»), and
the one-purchase exception lifts both pre-sale steps (1 and 4).

Figures it reproduces, each pinned in
`tests/integration/antichurning-definitive-e2e.test.ts`:

| Consulta | 0.66.13 | Now | DGT |
|---|---|---|---|
| V0248-18 (2017) | 500 | 900 | 900 |
| V0754-26, rebuys before the sales (2025 / 2026) | −775 / −1,331 | 0 / −942 | 0 / −942 |
| V2481-20 (2020) | 1,079.44 | 1,751.73 | 1,767 |
| V3282-18, V1760-23, V0571-21, V0046-20, V0913-08, V1294-22, V0754-26 (rebuys after) | DGT | DGT | — |

The repurchase dates now match the DGT's on V3282-18 (20/02 ← 15/03, 26/03 ←
20/03) and V1760-23 (05/05 and 09/05 ← 06/05, 10/05 ← 10/06, 17/06 ← 20/06);
0.66.13 got the figures there with other purchases. V2481-20 keeps a gap of
15.27 (see "Known limitations"). No committed fixture changed in any FX method:
their few blocked losses have a post-sale rebuy and no pre-sale alternative.
The sale-day rule (#454 follow-up) keeps every figure in this table; on
V2481-20 the 20/04 sale now takes the 880 bought that day (was 14/04) and the
22/04 sale the 905 of 21/04. It moves one fixture,
`degiro-transactions-sample.csv` 2021: THETA buy 2 and sell 1 on 14/04 with
nothing held before is one purchase the CSV cannot prove, so the #453
fail-safe blocks 49.02 (24.51 with two owners) with the "unverified" warning.

## Migration note (issue #451)

Up to 0.66.5 the engine released a pending loss as soon as the repurchased lot
that carried it was sold, even when that sale was itself rebought inside its
window. A year filed with 0.66.5 or earlier may therefore have deducted a loss
too early. When a newer version releases that loss in a later year, the user
must not deduct the part already deducted, or must correct the earlier year.
Verified case: the issue example filed for 2025 with 0.66.5 deducted 20; the new
engine releases 25 in 2026 instead of 5. The lifetime total does not change;
only the year does. The new rule can also move a loss to an earlier year
(V0046-20, the V1760-23 total exit); there the user can correct the earlier
return to claim it. Whenever the user corrects an earlier year to claim a
loss (that case, or a loss 0.66.13 and earlier blocked against the
one-purchase exception, #453), the later years already filed must be checked
too: where the old version released that same loss and the user deducted it,
that year is corrected to remove it, so the loss is deducted once. The
procedure depends on the year: from 2024 on, an
«autoliquidación rectificativa» in both directions; for 2023 and earlier, an
«autoliquidación complementaria» to pay more or a «solicitud de rectificación»
to claim. AEAT, Manual práctico de Renta 2025: «la aplicación efectiva de la
autoliquidación rectificativa como sistema único para la corrección de
autoliquidaciones, en sustitución del actual sistema dual de autoliquidación
complementaria y solicitud de rectificación … desde el período impositivo
2024», and the old procedure «se aplicará para la corrección de errores de
autoliquidaciones de IRPF correspondientes a 2023 y ejercicios anteriores».
The in-app Renta Web guide (`guide_rw.blocked_losses_hint`) carries the short
version in all five locales.

Pinned by `tests/integration/antichurning-definitive-e2e.test.ts` (one block per
consulta, through `generateTaxReport`, plus a seeded property: over a position
closed by a definitive sale, Σ blocked = Σ released, summed before rounding; the
short-cover, zero-share, spin-off entry-date and window-past-data blocks) and
the queue cases in `tests/engine/wash-sale.test.ts` (with the 10,000-lot cursor
bound).
