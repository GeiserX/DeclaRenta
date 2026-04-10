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
}

export interface Trade {
  tradeID: string;
  accountId: string;
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

export type AssetCategory = "STK" | "OPT" | "FUT" | "CASH" | "BOND" | "FUND" | "WAR";
