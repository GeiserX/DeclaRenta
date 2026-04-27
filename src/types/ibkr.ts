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
  | "Deposits/Withdrawals";

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
