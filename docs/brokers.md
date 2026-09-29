# Brokers soportados

| Broker | Formato | Notas |
|---|---|---|
| Interactive Brokers | Flex Query XML | Trades, dividendos, corporate actions, posiciones |
| Degiro | CSV (transacciones + cartera) | Delimitador auto-detectado (coma/punto y coma) |
| Flatex | CSV (Depotumsätze + Kontoumsätze) | Dos ficheros: operaciones y movimientos de caja (dividendos/comisiones) |
| Scalable Capital | CSV (14 columnas) | Incluye savings plans y distribuciones |
| eToro | XLSX (cuenta completa) | Posiciones cerradas + dividendos + CFDs, 6+ versiones de cabeceras |
| Freedom24 | JSON (report export) | Trades, dividendos, retenciones |
| Revolut | XLSX (Trading Account Statement) | Posiciones cerradas (acciones y cripto) con PnL y comisiones |
| Lightyear | CSV (Transaction Report) | Compras, ventas, dividendos, distribuciones, intereses |
| Trade Republic | CSV (Actividad) | Operaciones de compraventa y dividendos |
| Trading 212 | CSV (Historial de transacciones) | Operaciones de compraventa y dividendos |
| Coinbase | CSV (historial de transacciones) | Crypto trades y conversiones |
| Binance | CSV (historial de transacciones) | Spot trades, conversiones e ingresos cripto |
| Kraken | CSV (trades/ledger) | Crypto trades y staking |

Se pueden combinar ficheros de varios brokers en una sola ejecución para FIFO cruzado.

Cada broker tiene su guía paso a paso para obtener el informe dentro de la web ([declarenta.com](https://declarenta.com)).
