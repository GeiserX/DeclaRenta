/**
 * IBKR Flex Query XML types.
 * Based on the Flex Query XML schema and csingley/ibflex field coverage.
 */

export interface FlexStatement {
  accountId: string;
  fromDate: string;
  toDate: string;
  period: string;
  trades: Trade[];
  cashTransactions: CashTransaction[];
  corporateActions: CorporateAction[];
  openPositions: OpenPosition[];
  securitiesInfo: SecurityInfo[];
  cashBalances?: CashBalance[];
  optionExercises?: OptionExercise[];
  parserWarnings?: string[];
  parserMessages?: import("./tax.js").TaxMessage[];
  /**
   * Net cash legs of trades that live in a SEPARATE statement file (e.g. Flatex
   * exports trades and their cash settlement in two CSVs). Used post-merge to
   * derive the per-trade commission from the gross/net discrepancy, then dropped.
   */
  pendingOrderLegs?: OrderLeg[];
  /**
   * Optional EUR-per-unit valuation hints derived from a broker-supplied EUR
   * value column (e.g. a user-added `EUR_Value` column in a Binance Transaction
   * History CSV). Fed into the crypto-valuation pre-pass as a manual-rate source
   * so crypto↔crypto permutas and crypto income can be valued without any live
   * price oracle. Lower precedence than ECB rates and explicit user manual rates.
   */
  manualRateHints?: import("./tax.js").ManualRateQuote[];
}

/**
 * A trade's net cash settlement leg, sourced from a different file than the
 * trade itself. Matched to a Trade via `orderKey` (stored in `Trade.notes`)
 * so commission can be recovered as |grossTradeMoney − |netAmount||.
 */
export interface OrderLeg {
  /** Join key (broker order number) — matches the owning Trade's `notes`. */
  orderKey: string;
  /** Signed net cash credited/debited for the trade, in `currency`. */
  netAmount: string;
  /** ISIN of the traded security, for diagnostics. */
  isin: string;
  currency: string;
}

export interface Trade {
  tradeID: string;
  accountId: string;
  /** IBKR contract ID — stable across ticker renames */
  conid?: string;
  symbol: string;
  description: string;
  isin: string;
  assetCategory: AssetCategory;
  currency: string;
  tradeDate: string;
  settlementDate: string;
  quantity: string;
  tradePrice: string;
  tradeMoney: string;
  proceeds: string;
  cost: string;
  fifoPnlRealized: string;
  fxRateToBase: string;
  buySell: "BUY" | "SELL";
  openCloseIndicator: "O" | "C" | "C;O";
  exchange: string;
  commissionCurrency: string;
  commission: string;
  taxes: string;
  multiplier: string;
  /** Optional: which broker produced this trade (for cross-broker reports) */
  brokerSource?: string;
  /** IBKR notes field (e.g. "AFx" = Automatic FX, "P" = partial) */
  notes?: string;
  /** Option put/call indicator */
  putCall?: "P" | "C";
  /** Option/future strike price */
  strike?: string;
  /** Option/future expiry date (YYYYMMDD) */
  expiry?: string;
  /** Underlying symbol for derivatives */
  underlyingSymbol?: string;
  /** Underlying ISIN for derivatives */
  underlyingIsin?: string;
  /** IBKR order ID — same value across partial-fill executions of one order. Used by the parser to collapse executions into one trade. */
  ibOrderID?: string;
}

export interface CashTransaction {
  transactionID: string;
  accountId: string;
  symbol: string;
  description: string;
  isin: string;
  currency: string;
  dateTime: string;
  settleDate: string;
  amount: string;
  fxRateToBase: string;
  type: CashTransactionType;
  /**
   * Tax bucket for crypto reward income. Distinguishes a rendimiento del capital
   * mobiliario / interest (`"ahorro"` → savings base, e.g. staking, Simple Earn
   * interest) from a ganancia patrimonial no derivada de transmisión
   * (`"general"` → base general, e.g. airdrops, referral commissions). Absent
   * for ordinary interest/dividends, which keep their existing routing.
   */
  taxBucket?: "ahorro" | "general";
  /**
   * Quantity of coins received as a reward (drives a synthetic FIFO acquisition
   * lot so a later sale is not double-taxed). Paired with {@link rewardCostBasisEur}.
   */
  rewardQuantity?: string;
  /**
   * EUR cost basis to assign to the synthetic acquisition lot — equal to the EUR
   * value taxed as income. Omitted when the reward could not be valued in EUR
   * (then no lot is created and the income is surfaced for manual valuation).
   */
  rewardCostBasisEur?: string;
}

export type CashTransactionType =
  | "Dividends"
  | "Payment In Lieu Of Dividends"
  | "Withholding Tax"
  | "Broker Interest Paid"
  | "Broker Interest Received"
  | "Bond Interest Paid"
  | "Bond Interest Received"
  | "Other Fees"
  | "Commission Adjustments"
  | "Deposits/Withdrawals"
  /**
   * Crypto reward income (staking, Simple Earn interest, airdrops, referral
   * commissions). The `taxBucket` field decides whether it lands in the savings
   * base (rendimiento, Casilla 0027) or the base general (ganancia no derivada
   * de transmisión). Kept distinct from `Broker Interest Received` so airdrops
   * are never mis-bucketed into the savings base.
   */
  | "Crypto Reward Income";

export interface CorporateAction {
  transactionID: string;
  accountId: string;
  symbol: string;
  description: string;
  isin: string;
  currency: string;
  reportDate: string;
  dateTime: string;
  quantity: string;
  amount: string;
  type: string;
  actionDescription: string;
}

export interface OpenPosition {
  accountId: string;
  symbol: string;
  description: string;
  isin: string;
  currency: string;
  assetCategory: AssetCategory;
  quantity: string;
  costBasisMoney: string;
  costBasisPrice: string;
  markPrice: string;
  positionValue: string;
  fifoPnlUnrealized: string;
  fxRateToBase: string;
}

export interface SecurityInfo {
  symbol: string;
  description: string;
  isin: string;
  cusip: string;
  currency: string;
  assetCategory: AssetCategory;
  multiplier: string;
  subCategory: string;
}

/** Cash balance at a foreign broker (for Modelo 720, category C — Cuentas) */
export interface CashBalance {
  accountId: string;
  currency: string;
  endingCash: string;
  endingSettledCash: string;
  /** Q4 average cash balance in the same currency, required for Modelo 720 Category C. */
  averageQ4Cash?: string;
  /** Account opening date in YYYYMMDD/ISO format when known. */
  openedDate?: string;
  /** Foreign financial institution name when known. */
  institutionName?: string;
  /** Country code of the foreign account/institution when known. */
  countryCode?: string;
}

export type AssetCategory = "STK" | "OPT" | "FUT" | "FOP" | "FSFOP" | "CASH" | "BOND" | "FUND" | "WAR" | "CRYPTO" | "CFD";

/** Option exercise/assignment/expiry event from OptionEAE section */
export interface OptionExercise {
  transactionID: string;
  accountId: string;
  /** IBKR contract ID — matches Trade.conid for lot key consistency */
  conid?: string;
  symbol: string;
  description: string;
  isin: string;
  currency: string;
  date: string;
  /** "Exercise" | "Assignment" | "Expiration" */
  action: "Exercise" | "Assignment" | "Expiration";
  putCall: "P" | "C";
  strike: string;
  expiry: string;
  quantity: string;
  /** Proceeds from exercise/assignment (premium received or paid) */
  proceeds: string;
  underlyingSymbol: string;
  underlyingIsin: string;
  multiplier: string;
  /** Market price of underlying at exercise (from paired delivery row, DGT V0137-23) */
  marketPrice?: string;
}
