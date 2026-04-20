# Test Fixtures

Anonymized sample files for broker parser tests. All data is fake (dummy ISINs, symbols, round prices).

| File | Broker | Format | Contents |
|------|--------|--------|----------|
| `ibkr-sample.xml` | Interactive Brokers | XML (Flex Query) | 2 stock trades (buy+sell), 1 dividend+WHT, 1 open position |
| `degiro-transactions-sample.csv` | Degiro | CSV (19-col Spanish) | 13 rows: USD+EUR buys/sells, FX rates, zero-price rights row |
| `degiro-account-sample.csv` | Degiro | CSV (12-col Spanish) | Dividends, withholdings, STT, cash sweep |
| `binance-sample.csv` | Binance | CSV (Trade History) | 2 BTC trades (buy+sell), 1 ETH buy |
| `binance-tx-sample.csv` | Binance | CSV (Transaction History) | Deposit, Convert pair, Strategy Sold+Revenue, Buy+Spend |
| `coinbase-sample.csv` | Coinbase | CSV (v1) | 1 BTC buy, 1 BTC sell, 1 ETH staking income |
| `coinbase-v2-sample.csv` | Coinbase | CSV (v2 with preamble) | Send, Convert, Receive, Buy, Sell, Staking Income |
| `etoro-sample.csv` | eToro | CSV (text) | 2 closed positions (buy+loss), 1 dividend |
| `scalable-sample.csv` | Scalable Capital | CSV (semicolon, EU numbers) | 1 buy, 1 sell, 1 distribution |
| `freedom24-sample.json` | Freedom24 | JSON (nested report) | 2 trades (buy+sell), 1 dividend with WHT |
| `kraken-trades-sample.csv` | Kraken | CSV (double-quoted) | 1 BTC buy, 1 ETH sell |
| `kraken-ledgers-sample.csv` | Kraken | CSV (double-quoted) | 2 staking entries (ETH, DOT) |
