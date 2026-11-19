# Test Fixtures

Anonymized sample files for broker parser tests. All data is fake (dummy ISINs, symbols, round prices).

| File | Broker | Format | Contents |
|------|--------|--------|----------|
| `ibkr-sample.xml` | Interactive Brokers | XML (Flex Query) | 2 stock trades (buy+sell), 1 dividend+WHT, 1 open position |
| `ibkr-434-cycle-2025.xml` | Interactive Brokers | XML (Flex Query) | 2025 USD cycle with manual EUR.USD conversions (issue #434): «Tradicional con divisa» gives 240.38 / −57.36 with the real ECB rates in `tests/integration/ecb-usd-2025.ts` |
| `ibkr-434-afx-2025.xml` | Interactive Brokers | XML (Flex Query) | The same 2025 cycle settled by IBKR auto-conversions (AFx): «Tradicional con divisa» equals monodivisa, 240.38 / 0.00 |
| `ibkr-471-blocked-eur-2025.xml` | Interactive Brokers | XML (Flex Query) | 2025 EUR: ACME bought, sold at −1.000 and bought back 15 days later (loss fully blocked), GLOBEX sold at +500: strip Total +500, cuota 95 (issue #471) |
| `ibkr-471-blocked-usd-2025.xml` | Interactive Brokers | XML (Flex Query) | The same trades in USD, for the three FX methods (issue #471) |
| `ibkr-471-release-eur-2025.xml` | Interactive Brokers | XML (Flex Query) | 2024 loss of 1.000 € blocked by a buy-back, released in 2025 by selling the repurchased shares at +500: strip Total −500 (issue #471) |
| `modelo720-2023-sample.txt` | DeclaRenta output | Modelo 720 (fixed width, ISO-8859-15) | 2023 filing declaring GLOBEX (held in `ibkr-sample.xml`) and INITECH (not held): last year's 720 for the web upload |
| `degiro-transactions-sample.csv` | Degiro | CSV (19-col Spanish) | 13 rows: USD+EUR buys/sells, FX rates, zero-price rights row |
| `degiro-account-sample.csv` | Degiro | CSV (12-col Spanish) | Dividends, withholdings, STT, cash sweep |
| `two-broker-ibkr.xml` + `two-broker-degiro.csv` | Interactive Brokers + Degiro | XML + CSV | Uploaded together: three EUR sales, one at Degiro using shares bought at Interactive Brokers (broker columns in the results table, the annex and the PDFs) |
| `ibkr-withholding-correction-only.xml` | Interactive Brokers | XML (Flex Query, shaped like a real export, dummy security and account) | A "last 30 days" cash query holding only withholding corrections (+0.66 / −0.53 USD on three past dates, no dividend): pins one 0.13 USD lot per date (issue #436) |
| `binance-sample.csv` | Binance | CSV (Trade History) | 2 BTC trades (buy+sell), 1 ETH buy |
| `binance-tx-sample.csv` | Binance | CSV (Transaction History) | Deposit, Convert pair, Strategy Sold+Revenue, Buy+Spend |
| `coinbase-sample.csv` | Coinbase | CSV (v1) | 1 BTC buy, 1 BTC sell, 1 ETH staking income |
| `coinbase-v2-sample.csv` | Coinbase | CSV (v2 with preamble) | Send, Convert, Receive, Buy, Sell, Staking Income |
| `etoro-sample.csv` | eToro | CSV (text) | 2 closed positions (buy+loss), 1 dividend |
| `scalable-sample.csv` | Scalable Capital | CSV (semicolon, EU numbers) | 1 buy, 1 sell, 1 distribution, 1 interest |
| `freedom24-sample.json` | Freedom24 | JSON (nested report) | 2 trades (buy+sell), 1 dividend with WHT |
| `kraken-trades-sample.csv` | Kraken | CSV (double-quoted) | 1 BTC buy, 1 ETH sell |
| `kraken-ledgers-sample.csv` | Kraken | CSV (double-quoted) | 2 staking entries (ETH, DOT) |
