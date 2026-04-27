import type Decimal from "decimal.js";

/**
 * Core tax calculation types for Spanish IRPF (Modelo 100).
 */

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

/** Interest income (cash, bonds, margin) */
export interface InterestEntry {
  type: "earned" | "paid";
  description: string;
  date: string;
  amountEur: Decimal;
  currency: string;
  ecbRate: Decimal;
}

/** Aggregated results for Modelo 100 casillas */
export interface TaxSummary {
  /** Tax year */
  year: number;
  /** Non-fatal warnings (short sales, missing lots, etc.) */
  warnings: string[];

  /** Capital gains: Ganancias y pérdidas patrimoniales (Casillas 0327-0340) */
  capitalGains: {
    /** Casilla 0327: Valor de transmisión (total proceeds) */
    transmissionValue: Decimal;
    /** Casilla 0328: Valor de adquisición (total cost basis) */
    acquisitionValue: Decimal;
    /** Net gain/loss (0327 - 0328) */
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
    /** Casilla 0033: Intereses de cuentas y depósitos */
    earned: Decimal;
    /** Intereses pagados al broker (margen) — informativo, NO deducible (Art. 26.1.a LIRPF) */
    paid: Decimal;
    entries: InterestEntry[];
  };

  /** Double taxation deduction: Deducción por doble imposición internacional */
  doubleTaxation: {
    /** Casilla 0588: Deducción */
    deduction: Decimal;
    /** Breakdown by country */
    byCountry: Record<string, { taxPaid: Decimal; deductionAllowed: Decimal }>;
  };

  /** FX gains: Ganancias/pérdidas por transmisión de moneda extranjera (Casillas 1626/1631) */
  fxGains: {
    /** Casilla 1626: Valor de transmisión (FX) */
    transmissionValue: Decimal;
    /** Casilla 1631: Valor de adquisición (FX) */
    acquisitionValue: Decimal;
    /** Net gain/loss (1626 - 1631) */
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
export type FxTrigger = "conversion" | "stock_purchase" | "stock_sale" | "dividend" | "interest" | "commission";

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
