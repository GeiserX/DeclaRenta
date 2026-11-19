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
  /**
   * Open positions and cash balances of each merged file, with that file's
   * period end. Set by `mergeStatement` so `yearEndHoldings` can keep only the
   * holdings of the files that end on 31 December of the declared year.
   */
  holdingsBySource?: HoldingsSource[];
  /**
   * The period of each account in the file (IBKR: one FlexStatement per
   * account, each with its own dates). The anti-churning one-purchase exception
   * (#453) checks coverage per account; without it the file is one account
   * over `fromDate`–`toDate`.
   */
  accountPeriods?: AccountPeriod[];
}

/** One account of a file and the dates that file covers for it. */
export interface AccountPeriod {
  accountId: string;
  fromDate: string;
  toDate: string;
  /** Whether the file has a Trades section for the account: a holdings-only Flex shows no trades for its period. */
  hasTrades: boolean;
  /**
   * Whether the file has an Open Positions section for the account. An empty
   * section lists nothing held at `toDate`; no section lists nothing at all.
   */
  hasPositions?: boolean;
}

/** The year-end holdings of one merged file, dated to that file's period end. */
export interface HoldingsSource {
  accountId: string;
  /** That file's period start, when it gives one (the anti-churning one-purchase exception reads it). */
  fromDate?: string;
  toDate: string;
  /** The merged file's broker (`mergeStatement`'s `brokerName`), when given. */
  brokerSource?: string;
  openPositions: OpenPosition[];
  cashBalances: CashBalance[];
  /** That file's `accountPeriods`, when it gives them. */
  accountPeriods?: AccountPeriod[];
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
  /** Booking date (YYYYMMDD), used to pair the fills of a partially executed order. */
  tradeDate: string;
  /** Booking number of the cash leg (Flatex TA-Nr.), used to drop the same leg uploaded twice. */
  bookingId?: string;
  /**
   * The amount cell of a leg whose amount cannot be read (`Betrag: "abc"`).
   * Such a leg's `netAmount` is "0", and its order gets no fee (#467).
   */
  unreadableCell?: string;
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
  /**
   * Time of day of the execution ("HH:MM:SS"), when the export has one. Only
   * orders trades of the same day, so FIFO consumes the unit bought first
   * (Art. 37.2 LIRPF). Absent → the parser's row order is kept.
   */
  tradeTime?: string;
  settlementDate: string;
  quantity: string;
  /**
   * The file gave no readable quantity for this trade (`quantity` then holds
   * the "0" default). The anti-churning one-purchase exception (#453) treats
   * it as missing evidence, never as an explicit zero. Every share parser
   * sets it for a buy or sale row whose quantity cell is empty or no number,
   * and Flatex, DEGIRO and Trading 212 also for one whose price is (the
   * quantity then also reads "0"). FIFO books no shares for it (no lot, no
   * disposal).
   */
  quantityUnknown?: boolean;
  /**
   * Set with `quantityUnknown` on a trade row the parser could not read at
   * all (#467, #468): a bad date, no ticker or ISIN, an operation type that is
   * neither a buy nor a sale, no amount. It names the row for the user
   * (security, date, the unreadable cell); `parser.trade_row_unreadable` lists
   * it. The row books nothing, as with an unreadable quantity.
   */
  unreadableRow?: string;
  /**
   * Set with `quantityUnknown` on a row of a split, a merger, a delivery or
   * another corporate action the parser does not apply (#467). It names the
   * row (security, date, action, share count);
   * `parser.corporate_action_not_applied` lists it. The row books nothing.
   */
  corporateActionRow?: string;
  /**
   * Set on a kept row whose date the file does not give. The parsed file
   * leaves `tradeDate` ""; `finalizeMergedStatement` puts the earliest date
   * of the whole upload there, so the row falls before or inside every
   * anti-churning window and never after a year-end list (#467).
   */
  undatedRow?: boolean;
  tradePrice: string;
  tradeMoney: string;
  proceeds: string;
  cost: string;
  fifoPnlRealized: string;
  fxRateToBase: string;
  buySell: "BUY" | "SELL";
  openCloseIndicator: "O" | "C" | "C;O";
  /** Execution venue of the trade (IBKR `exchange`); not the listing market. */
  exchange: string;
  /**
   * IBKR `listingExchange`, trimmed and upper-cased: the market the contract is
   * listed on (e.g. LSE, NYSE, TSE). Decides the anti-churning window (#452).
   * Only IBKR sets it. On an order merged from several fills: the first fill
   * that has one.
   */
  listingExchange?: string;
  /**
   * Every distinct `listingExchange` of a merged order's fills, set only when
   * the fills disagree, so each one still votes for the window (#452).
   */
  listingExchanges?: string[];
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
  /**
   * Real EUR value the broker actually applied to a EUR↔FCY CASH conversion —
   * the spread-laden euro amount moved, BEFORE the separately-itemized
   * `commission`/fee (which the FX engine still applies on top, Art. 35). When
   * present, the FX FIFO engine values THIS conversion at the effective real rate
   * (`realEurAmount / |quantity|`) instead of the ECB reference rate, so the
   * broker's hidden FX spread is captured as a deductible cost (Art. 35.1 LIRPF;
   * issue #253). Absent → the engine falls back to the official ECB rate (the
   * default for every other conversion and for valuing FCY that arrives with no
   * euro price). This is a real cash amount FROM the statement — NOT IBKR's
   * `fxRateToBase` (which remains banned). Only meaningful on `assetCategory:
   * "CASH"` conversion trades; ignored elsewhere and under monodivisa (skipFx).
   */
  realEurAmount?: string;
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
  /** Optional: which broker produced this cash transaction (for cross-broker reports) */
  brokerSource?: string;
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
  /**
   * The broker credited this foreign-currency income in the account currency
   * (EUR): it converted the amount itself before crediting, so the taxpayer
   * never held the foreign currency. The row is still valued at the ECB rate
   * of its date for the income boxes (0029), but it opens NO FX lot in the
   * divisa engine (issue #96, Trade Republic). Absent = the currency really
   * entered the account (IBKR multi-currency cash).
   */
  brokerConvertedToBase?: boolean;
  /**
   * The day the broker posted the row, when the export says so (IBKR
   * `reportDate`). A withholding correction keeps its dividend's date in
   * `dateTime` but can be posted in a later year; the report then warns that
   * the earlier year's Casilla 0588 may be too high (issue #438).
   */
  reportDate?: string;
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
  brokerSource?: string;
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
  /**
   * Country where the broker keeps the securities in custody (ISO alpha-2).
   * Modelo 720 writes it in positions 129-130 of a clave V record.
   */
  custodianCountry?: string;
  brokerSource?: string;
  /**
   * The parser built this row from the file's own trades (Revolut's transaction
   * log), so it is no holding the broker reported. The anti-churning
   * one-purchase exception (#453) cannot use it as proof of no earlier shares.
   */
  fromTrades?: boolean;
  /**
   * The file gave no readable quantity for this row (`quantity` then holds the
   * "0" default). The one-purchase exception (#453) treats it as missing
   * evidence, never as an explicit zero.
   */
  quantityUnknown?: boolean;
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
  /** IBKR «Listing Exchange» (stocks only), trimmed and upper-cased (#452). */
  listingExchange?: string;
  /** IBKR contract id: ties the listing to the trades of the same contract (#452). */
  conid?: string;
  /**
   * Last day of the statement the row came from, as the statement writes it
   * (YYYYMMDD or YYYY-MM-DD): the listing is
   * the one of that period, so a later trade of the same contract naming
   * another code replaces it (#452).
   */
  asOf?: string;
  brokerSource?: string;
}

/** Cash balance at a foreign broker (for Modelo 720, category C — Cuentas) */
export interface CashBalance {
  accountId: string;
  currency: string;
  /**
   * IBKR CashReport: the balance at the start of the row's period (`fromDate`).
   * Absent when the export has no such column. The FX engine's loan model
   * (issue #449) reads it, with `endingCash` and the period, to prove that the
   * upload explains every movement of the currency.
   */
  startingCash?: string;
  /** "0" when the row has no such column (see `endingCashMissing`). */
  endingCash: string;
  /**
   * IBKR CashReport: true when the row has no `endingCash` column. Modelo 720
   * keeps reading `endingCash` ("0" then); the loan model (issue #449) does not
   * accept a defaulted balance as proof of the account's cash.
   */
  endingCashMissing?: true;
  endingSettledCash: string;
  /** IBKR CashReport: the period of this row (the statement's when the row has none). */
  fromDate?: string;
  toDate?: string;
  /** Q4 average cash balance in the same currency, required for Modelo 720 Category C. */
  averageQ4Cash?: string;
  /** Account opening date in YYYYMMDD/ISO format when known. */
  openedDate?: string;
  /** Foreign financial institution name when known. */
  institutionName?: string;
  /** Country code of the foreign account/institution when known. */
  countryCode?: string;
  brokerSource?: string;
}

export type AssetCategory = "STK" | "OPT" | "FUT" | "FOP" | "FSFOP" | "CASH" | "BOND" | "FUND" | "WAR" | "CRYPTO" | "CFD";

/** Option exercise/assignment/expiry event from OptionEAE section */
export interface OptionExercise {
  transactionID: string;
  accountId: string;
  /** IBKR contract ID — matches Trade.conid for lot key consistency */
  conid?: string;
  /** OPT, FOP or FSFOP — the option lot is keyed by it (lotKey), like Trade.assetCategory */
  assetCategory?: AssetCategory;
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
  brokerSource?: string;
}
