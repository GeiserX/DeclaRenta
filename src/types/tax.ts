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
  costInEur: Decimal;
  currency: string;
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
  proceedsEur: Decimal;
  costBasisEur: Decimal;
  gainLossEur: Decimal;
  holdingPeriodDays: number;
  /** Original currency of the trade */
  currency: string;
  /** ECB rate (EUR per 1 FCY) used for the sale */
  sellEcbRate: Decimal;
  /** ECB rate (EUR per 1 FCY) used for the acquisition */
  acquireEcbRate: Decimal;
  /** Asset category (STK, OPT, FUND, etc.) */
  assetCategory: string;
  /** True if loss is blocked by the anti-churning rule (Art. 33.5.f LIRPF) */
  washSaleBlocked: boolean;
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
  /** Stable grouping key: `${isin||symbol||description}|${withholdingCountry}`. */
  key: string;
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
    /** Net gain/loss (transmissionValue - acquisitionValue) */
    netGainLoss: Decimal;
    /** Gains blocked by anti-churning rule */
    blockedLosses: Decimal;
    /** Individual disposals */
    disposals: FifoDisposal[];
  };

  /** Dividends: Rendimientos del capital mobiliario (Casillas 0029-0034) */
  dividends: {
    /** Casilla 0029: Ingresos íntegros (gross dividends) */
    grossIncome: Decimal;
    /** Casilla 0034: Retenciones / Gastos deducibles */
    deductibleExpenses: Decimal;
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
}

/** A single lot in the FX FIFO queue (Art. 37.1.l LIRPF) */
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

/** What triggered an FX disposal */
export type FxTrigger = "conversion" | "dividend" | "interest" | "commission";

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
