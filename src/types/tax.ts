import type Decimal from "decimal.js";

/**
 * Core tax calculation types for Spanish IRPF (Modelo 100).
 */

export type MessageSeverity = "error" | "warning" | "info";

export interface TaxMessage {
  id: string;
  severity: MessageSeverity;
  message: string;
  hint?: string;
  context?: Record<string, string>;
}

/**
 * A trade whose value could not be resolved to EUR automatically — i.e. a
 * crypto-denominated leg (e.g. a crypto↔crypto swap on Binance Convert) with
 * neither an ECB rate nor a cross-leg inference available. Surfaced to the user
 * so they can supply a manual EUR-per-unit quote for that currency+date.
 *
 * Carries no monetary amounts beyond what the user needs to identify the trade
 * (symbol, date, quantity, the unresolved currency) — never logs NIF or totals.
 */
export interface UnresolvedValuation {
  /** Currency code that has no resolvable rate (e.g. "SOL") */
  currency: string;
  /** Trade date (YYYY-MM-DD) the rate is needed for */
  date: string;
  /** Asset symbol/description for the user to recognize the trade */
  symbol: string;
  description: string;
  /** Quantity transacted, as a display string */
  quantity: string;
  /** Why it could not be resolved (for the message), e.g. "no-ecb" | "no-cross-leg" */
  reason: "no-ecb" | "no-cross-leg";
}

/**
 * One raw manual EUR-per-unit valuation quote for a currency on a date. Supplied
 * by the user (manual-rates panel / CLI `--crypto-rates`) or derived from a
 * broker EUR value column. Consumed by the crypto-valuation pre-pass as a
 * non-ECB fallback rate source — never sourced from a live price oracle.
 */
export interface ManualRateQuote {
  currency: string;
  date: string;
  eurPerUnit: string;
}

/**
 * One user-supplied opening lot for a security transferred from another broker.
 *
 * The web UI stores these locally and `generateTaxReport()` injects them as
 * synthetic BUY trades before the FIFO pass, so a later sale can consume the
 * correct prior lots instead of falling back to cost basis 0.
 */
export interface ManualOpeningLot {
  symbol: string;
  description: string;
  isin: string;
  conid?: string;
  assetCategory: string;
  currency: string;
  acquireDate: string;
  quantity: string;
  pricePerShare: string;
}

/** Option exercise/close scenario per DGT V0137-23 (Art. 37.1.m LIRPF) */
export type OptionScenario = "expiration" | "close" | "exercise";

/** A single lot in the FIFO queue */
export interface Lot {
  id: string;
  isin: string;
  symbol: string;
  description: string;
  acquireDate: string;
  quantity: Decimal;
  pricePerShare: Decimal;
  /**
   * Total acquisition cost in the lot's OWN currency (FCY), commission and taxes
   * included (a foreign-currency commission is homogenized to this currency at
   * the trade-date cross-rate). Kept in FCY — NOT EUR — so the gain is computed
   * in the share's currency and only the difference is converted to EUR at the
   * disposal-date rate (DGT V2422-20 / V0152-26). Storing it in EUR at the
   * buy-date rate would leak the currency's FX drift into the stock gain.
   */
  costInFcy: Decimal;
  currency: string;
  /** ECB rate at acquisition — informational only (audit column); never used to
   *  compute the gain, which converts the FCY difference at the disposal date. */
  ecbRate: Decimal;
  /** True for short lots (opened via SELL+O) */
  isShort?: boolean;
  /** Option put/call indicator */
  putCall?: "P" | "C";
  /** Option strike price */
  strike?: string;
  /** Option expiry date (YYYYMMDD) */
  expiry?: string;
  /** Underlying symbol for derivatives */
  underlyingSymbol?: string;
  /** Underlying ISIN for derivatives */
  underlyingIsin?: string;
}

/** Result of consuming lots via FIFO for a sale */
export interface FifoDisposal {
  isin: string;
  symbol: string;
  description: string;
  sellDate: string;
  acquireDate: string;
  quantity: Decimal;
  /**
   * Gain/loss computed IN THE SHARE'S CURRENCY (proceedsFcy − costBasisFcy), the
   * fiscally-correct base per DGT V2422-20 before EUR conversion — for a
   * SAME-CURRENCY security only.
   *
   * ⚠️ NOT a coherent single-currency gain for a cross-currency crypto permuta
   * (acquired paying coin X, disposed receiving coin Y): there proceedsFcy is in
   * coin Y and costBasisFcy in coin X, so this subtraction mixes currencies and
   * is meaningless. Use the EUR fields for ALL tax math — never derive a casilla
   * from gainLossFcy/proceedsFcy/costBasisFcy. (These FCY fields exist only for
   * the same-currency audit trail and titular splitting.)
   */
  gainLossFcy: Decimal;
  /** Transmission value in the share's currency (coin received for a permuta). */
  proceedsFcy: Decimal;
  /** Acquisition value in the share's currency (coin paid for a permuta; commission/taxes homogenized). */
  costBasisFcy: Decimal;
  /**
   * EUR figures — the ONLY fields safe for tax math. Always satisfy
   * proceedsEur − costBasisEur === gainLossEur. For a same-currency security both
   * legs use the DISPOSAL-date rate (V2422-20, FX drift excluded); for a
   * cross-currency crypto permuta the cost uses the ACQUISITION-date rate (real
   * EUR paid, Art. 35.1) and proceeds the disposal-date rate. So costBasisEur is
   * the sale-date presentation for a security, but the historical EUR paid for a
   * permuta — see disposalEur() in fifo.ts.
   */
  proceedsEur: Decimal;
  costBasisEur: Decimal;
  gainLossEur: Decimal;
  holdingPeriodDays: number;
  /** Original currency of the trade */
  currency: string;
  /** ECB rate (EUR per 1 FCY) at the sale — used to convert the FCY gain. */
  sellEcbRate: Decimal;
  /** ECB rate (EUR per 1 FCY) at acquisition — informational/audit only. */
  acquireEcbRate: Decimal;
  /** Asset category (STK, OPT, FUND, etc.) */
  assetCategory: string;
  /**
   * True if ANY part of this disposal's loss is blocked by the anti-churning rule
   * (Art. 33.5.f/g LIRPF). Display flag only — equals `blockedLossEur.gt(0)`. The
   * actual deferred amount is `blockedLossEur` (blocking is PROPORTIONAL to the
   * repurchased quantity, not all-or-nothing).
   */
  washSaleBlocked: boolean;
  /**
   * Portion of THIS disposal's loss deferred now by anti-churning, proportional
   * to the homogeneous quantity repurchased within the ±2-month/±1-year window
   * (DGT V0913-08 "por paquetes"): `|gainLossEur| × absorbed/quantity`, with
   * `0 ≤ blockedLossEur ≤ |gainLossEur|`. A non-loss disposal carries 0. This is
   * the amount added BACK to the deductible base (deferred, not deducted now).
   */
  blockedLossEur: Decimal;
  /**
   * Prior deferred (blocked) loss RELEASED because this disposal sold shares that
   * were the homogeneous repurchase which previously blocked an earlier loss
   * ("se integrarán a medida que se transmitan los valores que permanezcan en el
   * patrimonio", Art. 33.5 closing paragraph). `≥ 0`; subtracted from the
   * deductible base (a now-deductible loss). Only meaningful within a single
   * (possibly multi-year merged) run; not persisted across separate filings.
   */
  reintegratedLossEur: Decimal;
  /** True for short position disposals (SELL+O → BUY+C) */
  isShort?: boolean;
  /** Option scenario per DGT V0137-23 */
  optionScenario?: OptionScenario;
  /** Option put/call indicator */
  putCall?: "P" | "C";
  /** Option strike price */
  strike?: string;
  /** Option expiry date */
  expiry?: string;
  /** Underlying symbol */
  underlyingSymbol?: string;
  /** Underlying ISIN */
  underlyingIsin?: string;
}

/** Dividend received from a foreign security */
export interface DividendEntry {
  isin: string;
  symbol: string;
  description: string;
  payDate: string;
  grossAmountEur: Decimal;
  withholdingTaxEur: Decimal;
  withholdingCountry: string;
  currency: string;
  ecbRate: Decimal;
}

/**
 * Dividends of one issuer (and one source country) aggregated for the year — the
 * shape Spanish brokers' fiscal certificates and the AEAT Renta Web "Alta Capital
 * mobiliario" form use (one record per company with the annual totals). This is a
 * PRESENTATION-only view computed from {@link DividendEntry}[]; the underlying
 * per-payment entries remain the source of truth for Casilla 0029 (grossIncome)
 * and Casilla 0588 (double taxation), which are never re-derived from these
 * groups. Grouped by issuer AND withholdingCountry so each group maps 1:1 to a
 * country contribution in the double-taxation breakdown.
 */
export interface IssuerDividendGroup {
  /** ISIN when present, else "" (issuer identified by symbol/description). */
  isin: string;
  symbol: string;
  description: string;
  withholdingCountry: string;
  /** Representative currency, or "—" when payments span multiple currencies. */
  currency: string;
  /** Sum of the per-payment gross amounts (EUR). */
  grossTotalEur: Decimal;
  /** Sum of the per-payment withholding amounts (EUR). */
  withholdingTotalEur: Decimal;
  /** Number of payments aggregated. */
  paymentCount: number;
  /** The individual payments, preserved for drill-down (sorted by payDate asc). */
  payments: DividendEntry[];
}

/** Interest income (cash, bonds, margin) */
export interface InterestEntry {
  type: "earned" | "paid";
  description: string;
  date: string;
  amountEur: Decimal;
  currency: string;
  ecbRate: Decimal;
}

/**
 * A ganancia patrimonial NO derivada de la transmisión de un elemento
 * patrimonial (Art. 33.1 LIRPF) — e.g. a crypto airdrop, referral commission or
 * fee rebate received "out of nowhere". Per DGT (V1948-21 and related), these
 * integrate into the BASE GENERAL (general tax scale), NOT the savings base,
 * valued at their market value in EUR on the receipt date. The same EUR value
 * becomes the acquisition cost of the received coins (so a later sale is taxed
 * only on subsequent appreciation).
 */
export interface GeneralGainEntry {
  description: string;
  /** Receipt date (YYYY-MM-DD) */
  date: string;
  /** Market value in EUR at receipt (the taxable amount). */
  amountEur: Decimal;
  /** Coin/asset received. */
  symbol: string;
  /** Currency the reward was paid in (the coin). */
  currency: string;
  /** ECB/synthetic rate used to value it (EUR per 1 unit). */
  ecbRate: Decimal;
}

/** Aggregated results for Modelo 100 casillas */
export interface TaxSummary {
  /** Tax year */
  year: number;
  /** @deprecated Use `messages` for severity-aware rendering */
  warnings: string[];
  /** Structured three-tier messages (error/warning/info) */
  messages: TaxMessage[];
  /**
   * Crypto-denominated trades that could not be valued automatically (no ECB
   * rate, no cross-leg inference). The web/CLI surfaces these so the user can
   * provide a manual EUR-per-unit quote. Empty/absent when everything resolved.
   */
  unresolvedCryptoValuations?: UnresolvedValuation[];

  /**
   * Capital gains: Ganancias y pérdidas patrimoniales. These aggregate totals
   * span BOTH AEAT blocks (acciones negociadas 0328/0331 and otros elementos
   * 1633/1637) and do NOT include FX gains (see `fxGains`).
   *
   * ⚠️ Do NOT map `transmissionValue`/`acquisitionValue` to a single casilla —
   * they are cross-block sums, not box 0328 nor 1633. To produce per-casilla
   * figures use computeCasillaBlocks(disposals) (or computeCasillaBlocksWithFx)
   * which partition by asset type. These aggregates are for headline totals and
   * year-over-year comparison only.
   */
  capitalGains: {
    /** Total proceeds across ALL disposals (both blocks). NOT casilla 0328 — see warning above. */
    transmissionValue: Decimal;
    /** Total cost basis across ALL disposals (both blocks). NOT casilla 0331 — see warning above. */
    acquisitionValue: Decimal;
    /** Net gain/loss (transmissionValue - acquisitionValue) — RAW, before anti-churning. */
    netGainLoss: Decimal;
    /**
     * Losses deferred NOW by the anti-churning rule (Art. 33.5.f/g), proportional
     * to repurchased quantity (Σ of each disposal's `blockedLossEur`). Added back
     * to the deductible base — not deducted this year.
     */
    blockedLosses: Decimal;
    /**
     * Previously-blocked losses RELEASED this year because the surviving
     * repurchased shares were sold (Σ of each disposal's `reintegratedLossEur`).
     * Subtracted from the deductible base — a now-deductible deferred loss.
     */
    reintegratedLosses: Decimal;
    /** Individual disposals */
    disposals: FifoDisposal[];
  };

  /** Dividends: Rendimientos del capital mobiliario (Casillas 0029-0034) */
  dividends: {
    /** Casilla 0029: Ingresos íntegros (gross dividends) */
    grossIncome: Decimal;
    /** Casilla 0034: Retenciones / Gastos deducibles */
    deductibleExpenses: Decimal;
    /**
     * Casilla 0597: Retenciones por rendimientos del capital mobiliario — the
     * SPANISH retención a cuenta (a domestic pago a cuenta deductible from the
     * cuota). A Spanish-issuer dividend (ISIN "ES…") suffers the 19% retención at
     * source even when held at a foreign broker; it is NOT a foreign tax, so it
     * goes here, never in casilla 0588 (deducción por doble imposición
     * internacional, which is foreign tax only). Sum of `withholdingTaxEur` over
     * entries with `withholdingCountry === "ES"`. 0 for purely-foreign holdings.
     */
    spanishWithholding: Decimal;
    /** Individual dividends */
    entries: DividendEntry[];
  };

  /** Interest income */
  interest: {
    /** Casilla 0027: Intereses de cuentas, depósitos y activos financieros (Art. 25.2 LIRPF) */
    earned: Decimal;
    /** Intereses pagados al broker (margen) — informativo, NO deducible (Art. 26.1.a LIRPF) */
    paid: Decimal;
    entries: InterestEntry[];
  };

  /**
   * Ganancias patrimoniales NO derivadas de transmisión (Art. 33.1 LIRPF) that
   * integrate in the BASE GENERAL: crypto airdrops, referral commissions, fee
   * rebates. Distinct from `capitalGains` (base del ahorro, derived from
   * transmisión) and from `interest` (rendimientos). MUST NOT be added to the
   * savings base (`totalSavingsBase`) nor to the 1633/1637 capital-gains blocks.
   */
  generalGains: {
    /** Total market value in EUR received (the taxable amount, base general). */
    total: Decimal;
    /** Individual reward events. */
    entries: GeneralGainEntry[];
  };

  /** Double taxation deduction: Deducción por doble imposición internacional */
  doubleTaxation: {
    /** Casilla 0588: Deducción */
    deduction: Decimal;
    /** Breakdown by country */
    byCountry: Record<string, { taxPaid: Decimal; deductionAllowed: Decimal }>;
  };

  /** FX gains: Ganancias/pérdidas por transmisión de moneda extranjera (Casillas 1633/1637) */
  fxGains: {
    /** Casilla 1633: Valor de transmisión (FX) */
    transmissionValue: Decimal;
    /** Casilla 1637: Valor de adquisición (FX) */
    acquisitionValue: Decimal;
    /** Net gain/loss (1633 - 1637) */
    netGainLoss: Decimal;
    /** Individual FX disposals */
    disposals: FxDisposal[];
  };

  /**
   * Full FX-FIFO movement trace (audit/diagnostic only). Present ONLY when the
   * caller passes `ReportOptions.fxTrace` — an opt-in for developers/advisors who
   * want to verify how a 1633/1637 figure was built (acquire → park → unpark →
   * discard → dispose, with running pool/parked balances). It is NEVER surfaced
   * in the standard UI. Serialize with `serializeFxTrace` (JSONL/CSV).
   *
   * ⚠️ RECONCILING TO THE CASILLAS — read this. The trace is the ALL-YEAR ledger
   * (deliberately NOT year-filtered) so a lot's full lifecycle is visible even
   * when the buy, sell and conversion fall in different years. The casillas, by
   * contrast, are YEAR-FILTERED (`report.ts` keeps only disposals whose
   * `disposeDate` is in the declaration year). Therefore, to tie the ledger to
   * the declared 1633/1637 you must sum ONLY the `dispose` rows whose `date`
   * falls in the declaration year: `Σ dispose.gainLossEur WHERE date∈year ===
   * fxGains.netGainLoss`. Summing every `dispose` row across all years will
   * over/under-state the box on any account that converts a tracked currency in
   * more than one year. (`park`/`unpark`/`discard`/`profit` rows never carry a
   * gain and are not summed — they explain HOW the pool reached the state a
   * `dispose` then realizes.)
   */
  fxTrace?: FxTraceEvent[];
}

/** A single lot in the FX FIFO queue (Art. 33.1 LIRPF) */
export interface FxLot {
  id: string;
  currency: string;
  acquireDate: string;
  quantity: Decimal;
  /** EUR cost per unit of foreign currency at acquisition */
  costPerUnit: Decimal;
  /** Total EUR cost for this lot */
  costInEur: Decimal;
}

/**
 * What triggered an FX event (acquisition or disposal of foreign currency).
 *
 * `stock_purchase` / `stock_sale` label the divisa-side effect of a
 * foreign-currency SECURITY trade under the carry-basis-defer model (issue #230
 * follow-up): a stock BUY silently CONSUMES the FCY it spends (parking the
 * carried basis inside the open position) and a stock SELL re-adds that carried
 * principal plus the trade's profit. Neither emits an FX disposal — the divisa
 * gain crystallizes only on the eventual conversion to euros (Art. 14.2.e LIRPF;
 * DGT V2422-20 / V2324-10). `stock_purchase` was removed in #171 (the old
 * buy-side consumption produced phantom prior-year-lot gains) and re-added here
 * for the parked-basis encoding, which never emits a disposal on a buy.
 */
export type FxTrigger = "conversion" | "dividend" | "interest" | "commission" | "stock_purchase" | "stock_sale";

/**
 * Movement kinds recorded in the FX-FIFO trace ({@link FxTraceEvent}).
 *  - `acquire`  — a pool lot was created (EUR→FCY conversion, dividend/interest in FCY).
 *  - `dispose`  — a pool lot was consumed (FCY→EUR conversion, fee, interest paid) → realizes FX.
 *  - `park`     — a stock BUY parked principal (carried basis, or `null` rate = uncovered).
 *  - `unpark`   — a stock SELL re-added parked principal to the pool at its carried basis.
 *  - `discard`  — a LOSS sell dropped principal that didn't return (no FX, never converted).
 *  - `profit`   — a stock SELL's trading profit re-added to the pool at the sale rate.
 */
export type FxTraceKind = "acquire" | "dispose" | "park" | "unpark" | "discard" | "profit";

/**
 * One movement in the FX-FIFO engine, for audit/diagnostic export ONLY (opt-in
 * via `ReportOptions.fxTrace`; never shown in the standard UI). Every monetary
 * field is a decimal STRING (lossless, matching the serializer/JSON contract) so
 * the trace round-trips without a Decimal dependency in consumers. Running
 * balances are AFTER the event is applied. See `serializeFxTrace` (JSONL/CSV).
 */
export interface FxTraceEvent {
  /** Monotonic sequence number in engine-processing order (1-based). */
  seq: number;
  /** Movement date (YYYY-MM-DD). */
  date: string;
  /** What moved — see {@link FxTraceKind}. */
  kind: FxTraceKind;
  /** Foreign currency this movement concerns (never "EUR"). */
  currency: string;
  /** What triggered the underlying event (conversion / dividend / stock_sale / …). */
  trigger: FxTrigger;
  /** Foreign-currency amount moved by this event (decimal string, always ≥ 0). */
  quantityFcy: string;
  /**
   * EUR-per-FCY rate for this slice (decimal string), or `null` for an UNCOVERED
   * park (the spent FCY had no tracked acquisition basis — funded outside the
   * data window). For `dispose` it is the conversion (sale-out) rate.
   */
  rate: string | null;
  /** dispose only: EUR cost basis of the consumed slice. */
  costBasisEur?: string;
  /** dispose only: EUR proceeds of the consumed slice. */
  proceedsEur?: string;
  /** dispose only: realized FX gain/loss (proceeds − cost). */
  gainLossEur?: string;
  /** Spendable per-currency POOL balance (FCY) after this event. */
  poolBalanceFcy: string;
  /** Parked per-(currency, position) balance (FCY) after this event. */
  parkedBalanceFcy: string;
  /** park/unpark/discard/profit only: the position (isin || symbol) whose principal moved. */
  positionKey?: string;
  /** dispose only: the consumed lot id (or "UNKNOWN" for a missing-lots floor). */
  lotId?: string;
  /**
   * dispose/park only: the ORIGINAL acquisition date (YYYY-MM-DD) of the consumed
   * pool lot — the field that PROVES date-FIFO order. `lotId` is a creation-order
   * counter shared across all currencies, so it is NOT a FIFO indicator (a re-added
   * carried principal keeps its old acquisition date but gets a fresh re-stamped
   * lotId). This date is the real FIFO key: across consecutive `dispose` rows of one
   * currency it is non-decreasing, which is what oldest-first FIFO means. Absent for
   * a missing-lots floor (no real lot) and for an uncovered park (no tracked origin).
   * Same datum as {@link FxDisposal.acquireDate}; prefixed `lot` here to disambiguate
   * from this event's own `date` (the movement date).
   */
  lotAcquireDate?: string;
  /** Optional human note (e.g. "uncovered", "missing-lots floor → gain 0"). */
  note?: string;
}

/** Result of consuming FX lots via FIFO for a currency disposal */
export interface FxDisposal {
  currency: string;
  disposeDate: string;
  acquireDate: string;
  quantity: Decimal;
  proceedsEur: Decimal;
  costBasisEur: Decimal;
  gainLossEur: Decimal;
  trigger: FxTrigger;
  holdingPeriodDays: number;
  /** FIFO lot ID consumed (for audit traceability) */
  lotId: string;
}

/** Loss carryforward entry (Art. 49 LIRPF) */
export interface LossCarryforward {
  /** Tax year the loss was generated */
  year: number;
  /** Original loss amount (negative) */
  amount: Decimal;
  /** Remaining uncompensated amount */
  remaining: Decimal;
  /** "gains" = capital gains losses, "income" = capital income losses */
  category: "gains" | "income";
}

/** Modelo 720: Foreign asset declaration */
export interface Modelo720Entry {
  isin: string;
  symbol: string;
  description: string;
  entityName: string;
  countryCode: string;
  acquisitionDate: string;
  acquisitionValueEur: Decimal;
  valuationDate: string;
  valuationEur: Decimal;
  quantity: Decimal;
  ownershipPercentage: Decimal;
  /** A = initial, M = existing unchanged, C = disposed */
  declarationType: "A" | "M" | "C";
  /** V = stocks/funds */
  assetType: "V";
  identifierType: "1"; // 1 = ISIN
}
