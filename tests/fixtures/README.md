# Test Fixtures

Anonymized sample files for broker parser tests. All data is fake (dummy ISINs, symbols, round prices).

| File | Broker | Format | Contents |
|------|--------|--------|----------|
| `degiro-transactions-real.csv` | Degiro | CSV (comma, EU numbers) | Real anonymized transactions export |
| `degiro-account-real.csv` | Degiro | CSV (comma, EU numbers) | Real anonymized account/dividends export |
| `ibkr-sample.xml` | Interactive Brokers | XML (Flex Query) | 2 stock trades (buy+sell), 1 dividend+WHT, 1 open position |
| `etoro-sample.csv` | eToro | CSV (comma) | 2 closed positions (Closed Positions section), 1 dividend (Dividends section) |
| `scalable-sample.csv` | Scalable Capital | CSV (semicolon, EU numbers) | 1 buy, 1 sell, 1 distribution |
| `freedom24-sample.json` | Freedom24 | JSON (nested report) | 2 trades (buy+sell), 1 dividend corporate action with WHT |
| `binance-sample.csv` | Binance | CSV (comma) | 2 BTC trades (buy+sell), 1 ETH buy |
| `coinbase-sample.csv` | Coinbase | CSV (comma) | 1 BTC buy, 1 BTC sell, 1 ETH staking income |
| `kraken-trades-sample.csv` | Kraken | CSV (double-quoted) | 1 BTC buy, 1 ETH sell |
| `kraken-ledgers-sample.csv` | Kraken | CSV (double-quoted) | 2 staking entries (ETH, DOT) |
