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
    unreadable. A row of the security whose type is neither a buy nor a
    sale (a Freedom24 transfer, a Flatex Einbuchung) is kept as an unreadable
    row, as the next point says. A DEGIRO row with neither quantity nor price
    is kept only when it has an order id or a value. A Flatex or DEGIRO row
    with a written zero price (a conversion, a rights assignment, free
    shares, a transfer in) moves shares of its ISIN, so it is kept as a
    corporate-action row (below), whatever the spelling of the zero ("0",
    "0.00", "0,0000"). A Trading 212 price of zero with the Total in another
    currency stays skipped (with the Total in the instrument currency the row
    is valued from the Total and booked). A DEGIRO row with a written zero
    quantity ("0,00") and no readable price stays skipped too.
    An IBKR fill with `tradePrice="0"` and a readable quantity still reaches
    `mapTrade`. Revolut's
    closed-positions format keeps both legs of such a row, as eToro does. A
    buy or sale with a readable quantity but a blank or unreadable price is
    kept the same way (a Flatex Kauf or Verkauf, a DEGIRO row with or without
    an order id or a value, a Trading 212 buy with no price and a Total in another
    currency): FIFO cannot book shares with no cost, and a dropped row would
    hide a second purchase. An IBKR cancellation with an `origTransactionID`
    drops itself and the fill that id names, whatever their quantity or
    price. A cancellation without that link reaches the fallback matcher:
    when a quantity or a price (missing, blank or no number; a written "0" is
    readable) is unreadable on the cancellation or on a candidate fill, the
    pair needs the same `ibExecID`; with none the cancellation is dropped
    alone, and its warning does not claim the original is outside the file.
    A crypto row of unknown quantity is no repurchase either: FIFO
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
  - No trade row of the security is dropped because a parser cannot read it
    (#466, #467, #468). A row that names a security (a ticker or an ISIN) and
    looks like a trade, but whose date, ticker or ISIN, type or direction,
    or amount cannot be read, is kept as a `quantityUnknownTrade` with
    `Trade.unreadableRow`: the security, the date and the cell that failed,
    for example `XYZ 20241202 [Type: "TRANSFER IN"]`. It books no shares and
    no money, so it acts as a row of unknown quantity above (the ISIN is
    "unverified"; with no ISIN, the trade is unidentified). The warning
    `parser.trade_row_unreadable` names every such row. The shared helpers
    are in `src/parsers/csv-utils.ts` (`unreadableTrade`, `unreadableCell`,
    `markUndatedTrades`, `corporateActionTrade`, `dropUndatedCash`).
    - A trade whose date is not a real day ("2024-13-45", "31-02-2024",
      "02.12.2024 09:30" where the broker writes another format, or an empty
      cell) is kept the same way, in every parser: a lot with a false date
      could sit outside the window it belongs to. No parser throws for a
      date any more. The parsed file leaves such a row with no date
      (`tradeDate` "") and marks it `Trade.undatedRow`.
      `finalizeMergedStatement` gives it the earliest readable date of the
      whole upload (trades and cash rows), because the engine needs a real
      day. Every sale is on or after that day, so the row stands before the
      sale's window or inside it, never after another broker's year-end
      list, where the evidence check does not look. With no ISIN, a row
      there is an unidentified trade, and the exception is never "applied".
      An upload with no readable date at all keeps the warning and books no
      row.
    - IBKR keeps one exception: a date in the wrong shape ("03/01/2025")
      means the Flex Date Format setting is wrong, so the whole file is still
      refused with the setting to change. A date of the right shape that is
      no real day ("20240231") is kept as above.
    - A split, consolidation, merger, spin-off or other corporate action
      that names a security is kept as a row of unknown quantity with
      `Trade.corporateActionRow` (the security, the date, the action and
      the share count it writes). It books no shares and no money, and
      `parser.corporate_action_not_applied` names it, not
      `parser.trade_row_unreadable`. The engine does not apply corporate
      actions from these files, so the user must check the holding by
      hand; until then the security's evidence is "unverified".
    - A cash row (a dividend, a withholding, interest, a deposit) whose date
      is not a real day is not booked. We never guess its date: the date
      sets the tax year, the ECB rate and the pairing of a dividend with
      its withholding, and a guessed year can move income to the wrong
      return. `parser.cash_row_undated` names each row with its type,
      security, amount and the failing cell, so the user can add it by hand.
    - A dividend or withholding row with no ticker goes by its ISIN
      (Lightyear, Trading 212, Freedom24). With no ticker and no ISIN (and
      for Scalable, no ISIN) it is not booked, for the same reason: the
      security sets the source country and the pairing with the withholding.
      `parser.cash_row_unidentified` names each row with its type, amount
      and date (Lightyear, Scalable, Trading 212, Revolut, Freedom24).
    - An IBKR cash `dateTime` written with the Flex Date/Time separator ",",
      a space or none ("20240615,103000", "2024-06-15 10:30:00",
      "20240615103000") is rewritten with ";" (`flexDateTime`). The engine
      reads only ";", so such a dividend was dropped as undated or crashed
      the report.
    - In Revolut and eToro XLSX files, a date stored as a date cell is read
      as its real day (`isoDateCells`). The sheet's display text ("1/10/25"
      for the default format) is never parsed. A workbook in the 1904 date
      system (Excel for Mac, Numbers) is read with that system: the same
      serial number is a day 4 years and 1 day later.
    - A slash date in text ("1/10/2024", "01/10/2024", "1/10/24") reads the
      same with or without a leading zero, in one order per file
      (`slashDateOrder`, `convertSlashDate`): day first, unless a date of the
      file has a second part over 12 ("3/15/2025") and none a first part over
      12. A 2-digit year is 20YY. A file with both kinds is day first, so its
      month-first dates are no real day and are named, never read as another
      day.
    - A row of an unknown type that writes a zero share count moves no
      shares and stays skipped. So does a row that names no security and
      moves no shares (a cash line). A row that names its security only by
      name and writes a share count is kept (Scalable, Trading 212, Flatex,
      Trade Republic). The cases per broker follow.
    - Revolut: a buy, sale or other type with a ticker and no readable date
      (an undated row with no ticker is kept with no ISIN);
      any type that is not a buy, sale, dividend, dividend tax correction,
      split or cash row (a `SPINOFF`, a `TRANSFER IN`), also with a zero
      quantity when it has an amount (a cash merger), unless it is a fee; a
      buy or sale with no ticker; a closed position with no symbol; a split
      with no readable date, or with a Quantity that is 0, empty or no
      number (a corporate-action row, and the holding is of unknown size;
      the dated one was only counted by `revolut.split_unresolved`, which
      is gone). Stop and stop-limit orders (`BUY - STOP`,
      `SELL - STOP LIMIT`) are buys and sales. The
      `FX Rate` cell is read only on a cash top-up or withdrawal, the only
      rows that use it (#466): a bad cell no longer deletes a sale, a buy or
      a dividend. A cash row with a bad rate is still skipped, and
      `revolut.bad_fx_rate` names it by date and amount. A ticker with a row
      of unknown size (a blank or unreadable quantity, an unreadable date or
      type) gets a holding of unknown size (`OpenPosition.quantityUnknown`):
      its quantity is the readable part, so the Modelo 720 and 721 still
      count it as a holding to value by hand, and it is never complete
      evidence. A buy of unknown size with nothing readable left makes one of
      quantity "0"; a row of unknown type alone makes none.
      `revolut.holding_size_unknown` names every such ticker.
      A `DIVIDEND TAX (CORRECTION)` row books nothing, and
      `revolut.dividend_tax_correction` (info) names it by ticker, date and
      amount.
      Revolut writes English US numbers, so a comma between groups of three
      digits is a thousands separator: "USD 1,500" is 1500 and a quantity of
      "1,000" is 1000 shares (both were read with the comma as a decimal
      point). Any other comma is still a decimal comma ("EUR 15,61").
      A `DIVIDEND` whose Total Amount has no number (blank, currency only,
      text) is not booked and is named by
      `parser.cash_income_amount_unreadable`, with or without a ticker; it
      was dropped with no word. A written zero stays skipped.
      A row of unknown type with a zero quantity whose Total Amount cannot
      be read ("USD abc", "USD") is kept like one with a readable amount; a
      blank or written-zero amount moves no money and stays skipped.
      A buy or sale whose Price per share cannot be read, is zero or is
      negative takes |Total Amount| ÷ Quantity as its price (it was booked
      at 0, so a sale became a full loss). With no readable non-zero Total
      either, a written zero price is a corporate-action row and any other
      price an unreadable row named by Price per share; the holding is of
      unknown size.
      A closed position whose Gross proceeds cannot be read keeps both legs
      as unreadable rows (it was a sale at 0). One with no symbol and no
      readable date is kept too when it has a quantity; only a line with a
      `Total` label or no quantity is skipped as a totals line.
      The column lookup matches each header as the detection does, so
      "Price per share (USD)" or "Gross proceeds (USD)" is read (every
      trade was priced 0, or the file came out empty). A detected sheet
      with a required column missing is refused, naming the column.
      A buy, sale or dividend whose Total Amount or Price per share is
      written in another currency than its Currency cell ("EUR 1500" with
      USD) is not booked and is named with those cells (it was booked in
      the Currency cell's currency). An empty Currency cell takes the
      currency in front of the amounts. A closed position does the same
      with its Cost basis, Gross proceeds and Fees: one written in another
      currency than its Currency cell keeps both legs as unreadable rows
      named with those cells (it was booked in the Currency cell's
      currency).
      A split, merger or spin-off row with no ticker is a corporate-action
      row with no security, named as not applied (it was dropped with no
      word, so a split's later sale kept its pre-split cost and a cash
      merger's money was lost). One that moves no shares and no money is
      skipped. A reward or a custody fee with no ticker stays skipped.
    - Trading 212: a buy or sale with no readable Time or no ticker; an
      action that is not a buy, sale, dividend, interest, split or cash row
      and writes a share count. An unknown action with an empty share cell
      (`Result adjustment`) is a cash row, not evidence; the same holds for
      Lightyear and Scalable (`Fee`, `Tax`). Its money is not booked, but a
      Trading 212 Total that is not a written zero is named by
      `parser.cash_row_not_booked` (it was dropped with no word, so a
      credit was gain the report never saw).
      Each leg of a `Stock split open` or `Stock split close` is a
      corporate-action row (above).
      FIFO values a Trading 212 buy or sale at `No. of shares` ×
      `Price / share`, and never reads the Total. A row with no readable or
      nonzero price was valued from a Total in the instrument's currency,
      but its price stayed 0, so a sale was a full loss with no word. The
      price is now Total ÷ shares. With neither a price nor a Total, a sale
      was booked at 0: a written zero in both cells is now a
      corporate-action row, and any other an unreadable row named by both
      cells. A buy or sale with an empty `Currency (Price / share)` (or a
      row cut short) is an unreadable row named by that cell; it was booked
      as euros. A dividend, interest or withholding with an empty
      `Currency (Total)` is not booked and is named by
      `parser.cash_income_amount_unreadable`: in an EUR account the Total
      is in EUR while `Currency (Price / share)` is the instrument's, so
      the Total is never read in the price currency. A buy or sale with no
      readable price and an empty `Currency (Total)` is an unreadable row
      named by both cells, never valued from that Total; one with a
      readable price does not need the cell. A fee with no currency of its
      own takes `Currency (Total)`, and with neither it is not added. `Dividend (Tax exempted)` is
      a dividend; it was booked as a withholding. `Lending interest` is
      interest (casilla 0027); it was dropped with no word. A withholding
      keeps its sign when the file writes any withholding as negative, so a
      positive one is a refund. The withholding of a dividend that is not
      booked is not booked either, and is named with it.
    - Freedom24: a row with no readable date, no ticker, or an operation
      other than `buy` or `sell` after trimming (`sale`, `transfer`). Before,
      every operation that was not `sell` was booked as a buy (#468). In
      `corporate_actions`, every row that is not a dividend or a coupon is
      a corporate-action row: a split, a consolidation, a merger, a
      conversion, bonus shares, a maturity, a redemption or any type we do
      not know. The JSON gives no share count, and these rows were skipped
      with no word. A row with no ticker and no ISIN is kept too, so every
      security is "unverified". The not-applied hint says that a row that
      paid money (a maturity, a redemption) is a sale missing from the
      report. A dividend whose `amount` is missing, empty, text or not
      finite is not booked. The engine threw on it and the whole report
      failed. `freedom24.dividend_amount_unreadable` names it with its cell,
      or `parser.cash_row_unidentified` with no security. A corporate
      action with no readable `type_id` cannot be told from a dividend or a
      split: it is a corporate-action row named by its `type_id` cell, and
      `freedom24.row_skipped_malformed` counts it and says the 2-month
      one-purchase check may be affected. Before, it was only counted. A
      dividend whose `tax_amount` is written but is no finite number is
      booked with no withholding (the user loses a deduction, never
      underpays), and `freedom24.tax_amount_unreadable` names the cell. A
      readable `tax_amount` larger than the dividend's `amount` ("1e400",
      or "1.234,56" on 500) is treated the same way: it went to box 0597
      with no cap for a Spanish security.
      A buy or sale whose price `p` is missing, empty, text, written with
      a decimal comma, not finite or below zero is an unreadable row named
      by `p`. Before, a missing price was read as 0, so a sale became a
      full loss, and "" or "abc" stopped the whole report. A written zero
      price is a corporate-action row, as in Flatex and DEGIRO. A trade or
      dividend with no readable `curr_c` (missing, empty, null, not a
      three-letter code) is never read as USD: the trade is an unreadable
      row named by `curr_c`, and the dividend is not booked and is named by
      `parser.cash_income_amount_unreadable` with its `amount` and `curr_c`
      cells. " usd" is USD. Every `cash_flows` row that is not a deposit or
      a withdrawal is named by `freedom24.cash_flow_not_read` (type,
      amount, currency, date); before, every one was dropped with no word.
      A written zero amount stays skipped. A row is a deposit or a
      withdrawal only when its `type_id` and `type` carry no other word:
      `deposit_interest` or "Interest on deposit" is named. A buy or sale
      whose readable `amount` is not p × q, with or without its commission
      (1 % and a cent of tolerance), is an unreadable row named by its `q`,
      `p`, `commission` and `amount` cells: an option, a bond priced in %
      of face or a price of 1e400 was booked at p × q. A `q` written with
      a comma ("1,000") is a trade of unknown quantity, never 1 share. The
      `tax_amount` of a negative dividend (a reversal) is a refund, so a
      reversed Spanish dividend no longer keeps its withholding in box 0597.
    - Lightyear and Scalable Capital: a buy or sale with no date, ticker or
      ISIN; a type that is not a buy or sale and moves shares. A split or
      corporate-action type is a corporate-action row (above). Scalable also
      reads a German date (DD.MM.YYYY).
      FIFO values a Scalable buy or sale at `shares` × `price`. A price that
      could not be read ("abc", "-") stopped the report with a
      `DecimalError`, and an empty, "€", written-zero or missing one sold
      the shares at 0, so a gain became a loss with no word. With no
      readable or nonzero price the price is now |`amount`| ÷ `shares`, the
      file's own numbers. With no amount either, a price that cannot be
      read makes an unreadable row named by `price`, and a written zero
      price is a corporate-action row. A Scalable `Corporate action` row of
      an ISIN that writes 0 shares but an amount (a cash merger, a
      redemption) is a corporate-action row too, so the payout is named; it
      was dropped with no word. A blank or written zero amount stays
      skipped.
      Scalable books only executed rows. A row whose status says it never
      happened (cancelled, rejected, pending, expired, failed) stays
      skipped. A row of any other status ("Settled") was dropped with no
      word: a buy, a sale or a row that moves shares is now an unreadable
      row named by `status`, and an interest or distribution is not booked
      and is named by `scalable.income_row_not_read`.
      The `tax` of a reversed (negative) Scalable Distribution is a refund,
      never a new withholding: a reversed Spanish dividend kept its 0597
      credit. A reversal whose `tax` cannot be read is not booked and is
      named, so the dividend it reverses keeps its income.
      FIFO values a Lightyear buy or sale at Quantity × `Price/share`. A
      price that could not be read ("n/a", "-") stopped the report with a
      `DecimalError`, and an empty, missing or written-zero one sold the
      shares at 0 €, so a gain became a loss with no word. With no readable
      or nonzero price the price is now |`Gross Amount`| ÷ `Quantity`, the
      file's own numbers. With no Gross either, a price that cannot be read
      makes an unreadable row named by `Price/share`, and a written zero
      price is a corporate-action row, as in Flatex, DEGIRO and Freedom24.
      A Lightyear buy or sale with an empty or missing `CCY` (a row cut
      short) is an unreadable row named by `CCY`; it was read as EUR.
      A Lightyear conversion leg with no `CCY`, or a non-EUR one whose
      `Net Amt.` and `Gross Amount` both cannot be read, is named with the
      unreadable rows but not kept as a trade: a currency leg is no
      evidence for this rule, and the FX engine books every CASH trade it
      gets. The first stopped the report, the second was dropped with no
      word.
      A Lightyear Dividend, Distribution, Interest or Reward row that names
      a security and writes a share count gave shares too (a share reward,
      a dividend paid in shares). It was booked as income only, so the
      shares had no lot: a loss sale before them was not blocked, and their
      later sale had no cost. The income stays booked, and the shares are
      now a purchase of that day at the value taxed as income (Gross for a
      dividend, Net else Gross for interest and rewards), named in
      `lightyear.income_shares_booked` so the user checks them. A share
      count or a value that cannot be read, a negative count, or no date,
      ticker or `CCY` makes an unreadable row named by its cell; a zero
      value is a corporate-action row, as for a Buy. A written zero count,
      or none (the real export), moves no shares.
    - Flatex: the side comes from the text (Kauf, Verkauf), never from the
      Nominal's sign alone (#468). A row with neither word is unreadable, so
      a Depotübertrag Ausgang is no sale and an Einbuchung no repurchase. A
      Kauf with a negative Nominal is unreadable; a Verkauf with a positive
      Nominal stays a sale. A Storno of a Kauf or a Verkauf is neither: it is
      unreadable, named by its text (a reversed sale was booked as a second
      sale). A Kauf or Verkauf with no ISIN is kept, and so is a row of
      another text with no ISIN that names a security and moves shares, or
      has a Nominal that cannot be read and a readable Kurs. A row of the
      ISIN with a written zero Kurs is a corporate-action
      row. The legs of a custody transfer (`Lagerstellenwechsel`) of one ISIN
      on one day that net to zero are skipped; every other leg is a
      corporate-action row, and `flatex.lagerstellenwechsel.unmatched` still
      names the ISIN.
      A Kauf or Verkauf with an empty currency cell is an unreadable row
      named `Kurs, divisa: ""` (it was booked as euros), and so is one with a
      negative Kurs (it was booked as negative proceeds or cost).
    - Flatex Kontoumsätze: an order's cash leg whose Betrag cannot be read
      ("", "€", "abc") gives its order no fee: read as 0 it made the whole
      trade a fee (a 1194 € gain became a 1006 € loss), and as text it
      stopped the upload. The legs of an order are summed with their sign,
      so a Storno cancels its leg. A fee is kept only when it is 0 or more
      (one cent of rounding allowed) and below the gross; a missing or extra
      leg made a fee as large as a fill. Otherwise the fills keep a fee of 0,
      and `flatex.commission.not_recovered` names each order by number,
      ISIN, date and the gross next to the sum of its legs, or the cell that
      cannot be read. The order number is a word of its own: the last digits
      of an ISIN are no order number. A dividend, distribution, withholding
      or interest row whose Betrag cannot be read, or whose currency cell is
      empty, is not booked, nor are the same-day withholdings of that
      dividend, and `parser.cash_income_amount_unreadable` names each. A
      written 0 stays a zero. A positive Habenzinsen, Zinsen or Zinszahlung
      row is interest received (casilla 0027); it was dropped with no word.
      A negative one stays out, which can only raise the tax.
    - Flatex orders: a fill and its cash leg fall on the same Buchtag, so
      the legs and fills of an order are matched day by day. A day with a
      fill and no leg, or a leg and no fill, a leg with no readable Buchtag,
      or a fill the parser keeps unreadable gives the whole order no fee,
      and `flatex.commission.not_recovered` names it. Before, a leg of
      another day, of a fill missing from the Depot export, or of an
      unreadable fill became the fee of another fill. A day with one
      combined leg for several fills splits the fee pro rata only when the
      fee is below the day's smallest fill: a missing or extra leg (one
      uploaded twice with no TA-Nr.) moves the fee by at least that fill's
      value. A day with more legs than fills, once each Storno cancels a
      leg, is never split: the extra leg can be that of a fill the Depot
      export does not list or writes with a Nominal of 0, and below the
      smallest fill it became the other fills' fee. A combined leg for fills
      of two days is no longer split, which can only raise the tax.
    - Trade Republic: a buy or sale with no amount, or that names no
      security (crypto with no `symbol`, any other with no `symbol` and no
      `name`), named by that cell: under an empty symbol unrelated
      securities shared one FIFO pool and one took another's cost. A
      TRADING row of another type, or a row of a category or CASH type the
      parser does not know (BENEFITS SAVEBACK, CASH STOCKPERK), that names
      an ISIN or writes a share count, and does not write a zero one. With
      no ISIN it is evidence of an unidentified trade. A CORPORATE_ACTION or
      DELIVERY row that names an ISIN or writes a share count, and does not
      write a zero one, is a corporate-action row (above), and its own
      warning still names it. The file gives a share count and a sign, but
      not what the action did (a split, a merger, a transfer in), so booking
      the count could add or remove shares that were never there. The row
      books nothing and keeps the evidence "unverified". A CASH row of an
      unknown type with no share count, or a zero one, and a row of an
      unknown category that moves no shares, that names an ISIN and does
      not write a zero amount (a coupon, a capital return) is not booked
      and is named by `trade_republic.cash_type_not_read`, with its
      category when it is not CASH. An empty amount is named as an
      unreadable one, never skipped as a zero; a written zero stays
      skipped. Deposits, card payments and transfers name no ISIN and stay
      skipped. A negative `price` is
      |`amount`| ÷ `shares`, as an empty one: it sold the shares at a
      negative price. `price`, `amount` and `fee` are read once, from the
      cell: read a second time, "1.2,3,4" (first read "12.3,4") became
      123.4, and as a price its raw text stopped the report. Now such a
      price is |`amount`| ÷ `shares`, such an amount names the row, and
      such a fee is not booked, which can only raise the tax. A buy's or
      sale's `tax` is a cost only when it is negative, as TR writes a paid
      tax. A positive one is money paid back: booked by its absolute value,
      it lowered the gain by twice the refund. It is not booked, and
      `trade_republic.trade_tax_positive` names the row.
    - DEGIRO: a row with no ISIN but a readable quantity or price, or an
      order id. When the product name has the shape of an option
      (`AAPL C200.00 20DEC24`) or a future (`FDAX MAR25`), the row is kept as
      a derivative (`OPT`, `FUT`): it is named the same way, but it does not
      stand for every share in the evidence, which derivatives never enter.
      A row of an ISIN with a written zero price is a corporate-action row.
    - eToro: an unknown or empty direction in the `Long / Short` column
      (only `Long`, `Short`, `Buy` and `Real` are read; `Real` is an
      unleveraged position, always long), or an English Action with no Buy
      or Sell, or an empty Action on a row with an ISIN, units or dates.
      Before, an unknown or empty direction was booked as a long position,
      so a short's gain became a loss. FIFO values each leg at Units × Open
      Rate or Close Rate, so a row whose rate cannot be read, or whose rate
      column is missing, keeps both legs as unreadable rows named by that
      cell (`Close Rate: —`). Before, a missing Close Rate column booked
      every sale at 0 (a full loss), and a rate that could not be read went
      on as text and stopped the report. A rate with a thousands separator
      or a decimal comma is read as a number. In the Spanish export, a row
      whose `Tipo de cambio de apertura (USD)` cannot be read, or is 0 or
      below, is unreadable too: read as USD, a EUR instrument's gain was
      converted at the dollar's rate.
    - Kraken: a type that is neither `buy` nor `sell` keeps an unreadable row
      for each coin. Before, it was booked as a buy, so FIFO could take its
      price as the cost of a later sale (#468). A readable row with no txid
      is booked under a row id (it was dropped with its gain); a row with no
      pair is kept unreadable. A buy or sale whose `vol` (or, for a
      crypto-quoted pair, `cost`) cannot be read keeps an unreadable row for
      each coin. Before, it was booked as zero units and FIFO dropped it
      with its gain and no word.
      FIFO values a Kraken trade at price × vol. A `price` that cannot be
      read (empty, only a currency sign, text, negative, or no column) was
      booked as 0, so a sale became a full loss with no word, or was passed
      on as text and stopped the whole report with a `DecimalError`. The
      price is now cost ÷ vol, the file's own numbers; a row with neither
      is an unreadable row named by its `price`. A written 0 stays the
      file's word.
      Only Kraken's legacy codes (XXBT, XETH, ZEUR, XICN, XNMC, XXVN, ...)
      lose their X or Z prefix. Any other code was cut too, so ZETA became
      ETA, XAUT became AUT and XUSD became dollars: a rebuy of the same
      coin at another broker did not block a Kraken loss. A legacy quote
      (ZEUR, XXBT) is split off only after a legacy base or a known coin,
      so Tezos (XTZEUR) is no longer read as XT/ZEUR, and USDTZUSD
      (Kraken's own key for USDT/USD) is USDT, never the coin "USDTZ"
      that no USDT rebuy at another broker could match.
      A pair written with a slash (BTC/EUR) was booked as the coin "BTC/",
      so it matched no BTC lot, reward or rebuy. It is now split at the
      slash; a slash pair that is not two sides, or whose quote is no known
      currency or coin, is named by `kraken.unrecognized_pair`.
      A pair of two fiat currencies (ZEURZUSD, EURUSD) was booked as a
      crypto trade of the coin "EUR": multidivisa made up a capital loss on
      a euro round trip, and a sale of euros alone gave a gain with
      `fifo.sell_without_lots`. The FX engine reads only cash trades, so
      the row books nothing and `kraken.fiat_conversion_not_booked` names
      it by pair, type, vol, cost and time, as at Binance. Its ledger rows
      are not named again as missing from the Trades CSV.
      A ledger (Ledgers CSV) row of type `trade` books nothing: trades
      come from the Trades CSV, whose txid is the ledger refid. A ledger
      uploaded with no Trades CSV lost a sale with no word. At merge time,
      `kraken.ledger_trade_not_booked` names each ledger trade, by refid,
      date and legs, that no Kraken trade of the upload books.
      Ledger rows of type `spend` and `receive` (an instant buy or sale in
      the Kraken app), `conversion` and `sale` are sales and swaps too, and
      may be in no Trades CSV. They were only counted by type in the info
      message `kraken.ledger_rows_ignored`, so a sale's gain vanished. They
      are now collected by refid like `trade` rows (each leg with its type)
      and named by `kraken.ledger_trade_not_booked` when no Kraken trade of
      the upload has that txid.
      Every ledger `transfer` was skipped with no word, so an airdrop
      (subtype `airdrop`, FLR or SGB) went undeclared. It is now crypto
      income of the base general (art. 33.1 LIRPF), as at Binance. Only the
      moves between the user's own wallets (spottostaking, stakingfromspot,
      stakingtospot, spotfromstaking, spotfromfutures, spottofutures) stay
      skipped; any other transfer, and an airdrop that is not a credit, is
      named by `kraken.ledger_rows_ignored` by type and subtype.
      A staking or Earn row that takes coins away (a negative amount, or a
      fee larger than the reward) was booked as negative income and cut
      casilla 0027 with no word. DeclaRenta does not know which reward it
      cancels, so it books nothing and `kraken.income_negative` names it
      by type, coin, amount, fee and date, as at Binance. A reward whose
      fee equals its amount is booked as 0, as before.
      A ledger row of type `reward`, `dividend` or `credit` that gives coins
      or money (or whose amount cannot be read) may be income. It was only
      counted by type in an info message whose hint never said so. It books
      nothing, since DeclaRenta does not know what income it is, and
      `kraken.ledger_income_not_booked` names it by type, coin, amount and
      date. A row of those types that takes money away or writes zero stays
      counted in `kraken.ledger_rows_ignored`.
    - Coinbase: a buy, sale or Convert whose `Asset` is empty or whose
      `Quantity Transacted` cannot be read is an unreadable row, named by
      that cell (with no Asset, by its type and quantity). A Convert still
      books the coin it received when its Notes name it. Before, the row
      was skipped with no word: a sale vanished with its gain, and a rebuy
      could not show that an art. 33.5.e check was missing.
      FIFO values a Coinbase trade at Quantity × Spot Price. A Spot Price
      that cannot be read (empty, only a currency sign, text, a cell cut
      off) was booked as 0, so a sale became a full loss with no word, or
      was passed on as text and stopped the whole report with a
      `DecimalError`. The price is now Subtotal ÷ Quantity, the file's own
      numbers; a row with neither is an unreadable row named by its Spot
      Price. A written 0 stays the file's word. An empty `Price Currency`,
      or a header with no currency column, was read as EUR, so dollars were
      booked as euros: such a buy, sale or Convert (both coins) is an
      unreadable row named by that cell. Exports from before 2021 write the
      currency in the money headers ("USD Spot Price at Transaction", "EUR
      Subtotal"); no money column was found, so every trade was booked at 0
      and the gain vanished. Those headers are now read, with the currency
      from the prefix, and a header with no price column at all is refused.
    - Crypto income whose coin cannot be read: a Coinbase Staking Income,
      Rewards Income, Learning Reward, Inflation Reward or Coinbase Earn
      row with an empty `Asset`, and a Kraken staking or Earn reward with
      an empty `asset`, is not booked under a guessed coin.
      `parser.crypto_income_unidentified` names each row by type, amount,
      date and cell. Before, the Coinbase row was skipped with no word, so
      the income could go undeclared; the Kraken row was booked under an
      empty coin and only counted as unvalued income. Another Coinbase
      type with an empty `Asset` is now counted by
      `coinbase.unknown_types_skipped` like the same type with a coin.
      Binance names such a row with `binance.unparseable_coin`.
    - Crypto income whose amount cannot be read: a Coinbase income row
      whose `Total` and `Subtotal` both cannot be read (empty, text, only a
      currency sign), and a Kraken staking or Earn reward whose `amount`
      cannot be read, is not booked.
      `parser.crypto_income_amount_unreadable` names each row by type, coin,
      date and cells. Before, an empty Coinbase Total booked the income as
      0 with no word, even with a readable Subtotal (now used); a Total of
      "abc" stopped the whole report with a `DecimalError`; and the Kraken
      reward was booked as 0 units.
      A Coinbase income row with an empty `Price Currency` is named the
      same way: it was booked as euros. Coinbase income in another currency
      ($30 of staking) was taken as that many euros (30 €), for the income
      and for the cost of the coin received; it is now valued at the ECB
      rate of its day, and only a EUR amount is taken as it is. A negative
      Coinbase income row (income taken back) lowers the income, as
      before, but no longer opens a second lot: abs() gave it one, so a
      later sale of a coin with no lot got a made-up cost and no
      `fifo.insufficient_lots` warning.
    - Dividends and interest whose amount cannot be read: a Lightyear
      Dividend or Distribution whose `Gross Amount` cannot be read, a
      Lightyear Interest or Reward whose `Net Amt.` and `Gross Amount`
      both cannot be read, a Trading 212 Dividend or Interest on cash whose
      `Total` cannot be read, a Scalable Interest or Distribution whose
      `amount` cannot be read, and a Trade Republic DIVIDEND (its
      `original_amount` when it has one), INTEREST_PAYMENT or
      TAX_OPTIMIZATION whose `amount` cannot be read, is not booked, and
      neither is its withholding. `parser.cash_income_amount_unreadable`
      names each row by type, security, currency, date, tax and cell.
      Before, Lightyear, Scalable and Trade Republic booked such a
      dividend at 0 with its withholding (a deduction for income the
      report did not count), Trading 212 dropped such a dividend or
      interest with no word, Lightyear and Scalable such interest, and
      Trade Republic booked such interest as 0 and dropped a tax
      optimisation. A written 0 stays an explicit zero with no warning.
      A Trade Republic dividend whose written `tax` cannot be read
      ("-15.00 EUR", "-15abc", "-Infinity") is booked in full with no
      withholding, which can only raise the tax; a reversal (a negative
      amount) with such a cell is not booked, so the dividend it reverses
      keeps its income. `trade_republic.tax_unreadable` names each row.
      Before, such a cell stopped the report or booked an unlimited
      withholding. The `tax` of a reversal is a refund, never a new
      withholding, and a dividend with `original_currency` but no
      `original_amount` is booked in the account currency, the currency of
      the amount read.
    - eToro: a dividend whose net amount cannot be read (in the Spanish
      export, the EUR net), and an Interest Payment whose Amount cannot be
      read, is not booked, and neither is that dividend's withholding.
      `parser.cash_income_amount_unreadable` names each row. Before, both
      were dropped with no word. A written 0 stays skipped. A dividend with
      no withholding is booked at its net as a number: its raw text
      ("1,234.56") stopped the report. A Dividends or Account Activity
      sheet whose needed columns are not recognised is named by the error
      `etoro.columns_not_detected`, like Closed Positions; it dropped every
      dividend or interest with no word. An undated row is a totals line
      only when it has no ISIN and its name is exactly `Total` or
      `Totales`: an undated TotalEnergies dividend is named by
      `parser.cash_row_undated`, never skipped as a total.
      On a sheet with only `Withholding Tax Rate (%)`, only a rate
      strictly between 0 and 100 grosses the net up. A rate of 100 or more
      made the gross infinite or negative and stopped the report; such a
      row is now booked at its net with no withholding, which can only
      raise the tax. A reversal (a negative net) refunds its withholding:
      the text "--7.5000" stopped the report.
    - eToro: the English export's `FX rate at open (USD)` column is read
      like the Spanish `Tipo de cambio de apertura (USD)`. Only the Spanish
      name was known, so an English export booked a EUR instrument's legs
      as dollars with no word.
    - eToro: a closed position whose FX rate is not 1 was labelled EUR, so
      a quote in pence or HKD was booked as euros (a loss 85 or 8 times too
      large). The FX rate says only that the quote is not in dollars, not
      which currency it is in. Every leg is now booked in USD, the
      account's currency: Open Rate × `FX rate at open (USD)` and Close
      Rate × `FX rate at close (USD)`, eToro's own applied rates. The ECB
      converts the dollars to euros, as for any USD trade. A non-USD row
      whose FX rate at close cannot be read, or that has no such column, is
      kept as an unreadable row named by that cell.
    - eToro: an Account Activity row whose Type names staking was dropped
      with no word, because only interest was read. DeclaRenta does not
      import eToro crypto, so the reward is not booked and its value is not
      guessed. `etoro.staking_not_imported` names each row by type,
      details, amount and date, for the user to add by hand.
    - DEGIRO Account CSV: a Dividendo, a Retención del dividendo or an
      interest row whose amount cannot be read, or whose currency cell is
      empty, is not booked, and neither are the withholdings of such a
      dividend (same ISIN, product and date). The same warning names each
      row by its amount or currency cell. Before, a textual amount stopped
      the report, an empty one booked a dividend of 0 with its withholding,
      an empty currency booked a pound or yen amount as euros, and a GBX
      row with a textual amount refused the file. A positive interest row
      (flatex Interest, Interés, Zinsen, Rente, Intérêts) is interest
      received; it was dropped with no word. A negative one stays out,
      which can only raise the tax. A Dividendo or a Retención with no ISIN
      is not booked: its country, and so whether the withholding is Spanish
      or foreign, would be a guess (a Spanish 19 € withheld became a 15 €
      foreign deduction). `parser.cash_row_unidentified` names it, with the
      withholding next to the dividend of the same product and date. A row
      with no Descripción that names a security and moves money is named by
      `degiro.cash_row_undescribed` and not booked; it was dropped with no
      word.
      A German `Fondsausschüttung` (an ETF distribution) is a dividend,
      like `Dividende`; it was dropped with no word.
    - DEGIRO Transactions CSV: a buy or sale with an empty price-currency
      cell is an unreadable row named by that cell, never a trade in euros
      (a yen buy made a loss of thousands). An empty costs-currency cell is
      EUR, the currency DEGIRO charges in. A GBX trade whose `Valor local`
      or `Tipo de cambio` cannot be read is booked from its price and
      quantity, never refused. A row with a readable quantity and a blank
      or unreadable price is a trade of unknown price even with no order id
      and no value: dropped, it hid a second purchase in the window. A
      negative price is an unreadable row named by `Precio`, as in Flatex:
      booked, a sale had negative proceeds and a false loss.
    - Binance Trade History: a row whose `Side` is neither BUY nor SELL, or
      whose `Executed` (or, for a crypto-quoted pair, `Amount`) is no
      number ("", "abc", "1,000.5BTC"), keeps an unreadable row for each
      coin. Before, the first was skipped and the second booked as zero
      units, both with no word.
    - `parser.trade_row_unreadable` says in its hint that a crypto row may
      be a repurchase whose art. 33.5.e check DeclaRenta cannot make.
    - IBKR: a trade with no `buySell` takes its side from the quantity's
      sign; with no signed quantity, the side is unknown (""), never BUY.
    - Binance Transaction History: a row with no readable `UTC_Time` (empty,
      text, a date with no time) cannot be paired with the other legs of its
      conversion or trade, so it books nothing and is no trade.
      `binance.unparseable_timestamp` names each row by coin, operation,
      change and the date cell. `binance.unparseable_amount` does the same
      for a row whose `Change` is no number, empty, `NaN` or `Infinity`.
      An undated row with no readable `Change` is named in the first
      warning with both cells. `binance.unparseable_coin` names a row with
      no `Coin` that moves a non-zero amount. A `--` or zero `Change`, and
      a row with neither a coin nor an amount, move nothing and stay
      skipped. The hints say that the coin's
      gains, losses and income, and its art. 33.5.e check, are not reliable.
      Before, both warnings gave only a count. A `UTC_Time` of the right
      shape that is no real day ("2025-13-45 10:00:00") is still paired, and
      its trades are undated rows, as in every parser. A Convert, fiat
      purchase, Strategy or plain spot leg that no other leg pairs within
      its 1 s window books nothing, and `binance.unpaired_leg` names it by
      coin, operation, change and time, with the same art. 33.5.e caveat.
      Before, an unpaired spot leg was dropped with no word, and a Convert
      or Strategy leg was only counted by `binance.unhandled_operation`,
      which now counts only operations no phase knows. The window stays at
      1 s: every leg pair in the fixtures shares one second, and the code
      already handles legs written 1 s apart. When several coins are bought
      with one fiat in one window, each received row is paired with a fiat
      row by order when their counts match (one payment per fill), and each
      coin gets the sum of its own payments. Before, two fills of one coin
      and one order of another split the total equally, so one coin took
      the other's cost (ETH cost 5050 € instead of 100 €) with no word.
      That pairing is trusted only when the file writes each payment next
      to its fill: in file order, the rows form consecutive pairs of one
      received row and one fiat row (the real export lists each order's
      rows together, in either order). Equal counts alone prove nothing:
      "Buy BTC 0.1, Buy ETH 1, Sell EUR -100, Sell EUR -10000" gave ETH the
      10000 € and a 9800 € loss with no word. When the rows are not in
      such pairs, or the counts do not match, the window is booked as
      before (by order, else by coin when that count matches, else an
      equal split; the total paid stays exact), and
      `binance.spot_cost_split` names every leg of the window with the
      art. 33.5.e caveat.
      The same holds for every other Binance path that pairs two or more
      coins. A spot window paid in two currencies, and a Convert window,
      go through `pairAndEmit`, which pairs by closest EUR value and, with
      no EUR value, by order: "Buy ETH 1, Buy BTC 0.1, Sell EUR -11000,
      Sell USD -110" gave ETH the 11000 € and a 10800 € loss with no word.
      Strategy pairs the k-th `Transaction Buy` with the k-th `Transaction
      Spend`, and the k-th `Transaction Sold` with the k-th `Transaction
      Revenue`. When a side has two or more legs to choose from (one pair
      and a leftover included) and no EUR value on every leg decides them,
      the pairing is trusted only when the file writes every leg in a pair
      of two adjacent rows (fees and the other side's rows do not break a
      pair). A leftover leg proves nothing on its own: in "Buy ETH, Sell
      EUR, Buy BTC, Buy SOL, Sell USD" the pairs ETH/EUR and BTC/USD look
      adjacent once SOL is ignored, but the USD sits next to SOL. Such a
      window waits until every window has run. It is trusted only if a
      later window pairs every leftover and all those pairs together are
      adjacent rows: a trade that starts in one window's last second and
      ends in the next. Strategy pairs of one coin on each side are trusted
      only when the choice cannot change a lot, because FIFO keeps one lot
      per Buy row: "Buy ETH 1, Buy ETH 2, Spend -100, Spend -200" gave a
      later sale of 1 ETH a gain of 100 € where "Spend -200, Spend -100"
      gave 0. So every Spend (or Revenue) must be the same amount, and
      every Buy (or Sold) too when one is left over. Otherwise the numbers
      are booked as before and `binance.spot_cost_split`, now worded for
      purchases and sales, names every leg.
      Fees follow the same rule. Binance writes an order's rows together,
      with the fee first, between or last, so a fee belongs to the order
      written beside it. A fee in a coin that only one order of its second
      takes goes to that order. When two or more orders take its coin, the
      nearest leg rows before and after the fee must belong to one of them;
      otherwise the fee is deducted from no order, which can only raise a
      gain, and `binance.fee_unassigned` names it. Before, the last spot
      trade of a second took every fee ("Buy BTC, Sell EUR, Fee -5, Buy ETH,
      Sell EUR, Fee -1" put 6 € on ETH), each Strategy pair took the first
      fee row of its coin (BTC paid ETH's 5 € and the 1 € row vanished), and
      a fiat-for-fiat Strategy pair wrote its fee onto an earlier, unrelated
      trade. Dust rows and their BNB rows pair within 1 s, like every other
      trade path; a dust row with no BNB row is named by
      `binance.unpaired_leg`, and a dust window paired by order or with
      fewer BNB rows than coins by `binance.spot_cost_split`. A negative
      income row (a reward taken back) and a fiat-for-fiat swap book
      nothing, as before, and are now named (`binance.income_negative`,
      `binance.fiat_conversion_not_booked`). In the Trade History export,
      FIFO values a fiat-pair trade at Price × Executed: a Price that
      cannot be read was read as 0 (a 3000 € sale showed a 2000 € loss), so
      the price is now Amount ÷ Executed, and a row with neither is an
      unreadable row named by its Price. A row whose Pair cannot be split is
      named by date, side, amount and the Pair cell.
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
