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

La web muestra la misma guía de cada broker bajo «¿No se detectó tu broker?», en el paso de subida.

## Cómo exportar el informe de cada broker

### Interactive Brokers (IBKR)

1. Inicia sesión en el **Portal del Cliente** de IBKR.
2. Ve a **Rendimiento e informes** → pestaña **Consultas Flex**.
3. En **Consulta flex de actividad**, haz clic en el **+** para crear una nueva consulta.
4. En la configuración, activa las secciones:

    - **Trades** (obligatorio)
    - **Cash Transactions** — dividendos y retenciones (obligatorio)
    - **Open Positions** — para Modelo 720/D-6 (recomendado)
    - **Financial Instrument Information** (recomendado)
5. En cada sección, **selecciona todos los campos disponibles** (marca todas las casillas). Cuantos más datos incluyas, más preciso será el cálculo. Como mínimo asegúrate de incluir el campo **Notes** en Trades — es necesario para detectar conversiones automáticas de divisa.
6. Formato de salida: **XML**.
7. Incluye **todos los años disponibles** para cálculo FIFO correcto.
8. Guarda la consulta, ejecútala y descarga el fichero `.xml`.

**Formato:** XML con estructura `<FlexQueryResponse>`.

**Datos extraídos:** Operaciones de compraventa (STK, FUND, OPT), dividendos, intereses, retenciones, acciones corporativas (splits, fusiones, spin-offs, scrip dividends) y posiciones abiertas.

**Notas:** IBKR es el broker con soporte más completo. Las comisiones en divisa distinta a la operación se convierten correctamente. El multiplicador de opciones se aplica automáticamente.

### Degiro

1. Inicia sesión en la **web de Degiro** (no la app).
2. Abre el panel lateral **Buzón** (icono de sobre).
3. Haz clic en **Transacciones** (historial de transacciones de tus productos).
4. Selecciona el rango de fechas deseado (incluye **todo el histórico** para FIFO).
5. Haz clic en **Exportar** y descarga el fichero CSV.
6. Para dividendos: vuelve al **Buzón** → **Cuenta** (historial de movimientos de tu cuenta) → misma fecha → **Exportar** CSV.

**Formato:** CSV con cabeceras que incluyen ISIN, cantidad y precio.

**Datos extraídos:** Operaciones de compraventa, dividendos y posiciones.

**Limitaciones:** Degiro no exporta acciones corporativas. Los splits deben reflejarse ya en el historial de operaciones. Si tienes operaciones en varios ejercicios, exporta todos los años.

### Flatex

1. Inicia sesión en la **web de Flatex**.
2. Ve a **Movimientos** → **Depotumsätze** (movimientos de la cartera).
3. Selecciona **todo el histórico** (necesario para el cálculo FIFO) y exporta el fichero CSV.
4. Para dividendos: ve a **Kontoumsätze** (movimientos de la cuenta), mismo rango de fechas, y exporta el CSV. Ojo: ahí los dividendos aparecen por el importe neto, ya descontada la retención; toma el importe íntegro y la retención del justificante en PDF de cada dividendo.
5. Sube **ambos ficheros** CSV (Depotumsätze para operaciones y Kontoumsätze para dividendos).

**Formato:** CSV alemán (separador punto y coma). Dos ficheros: Depotumsätze (operaciones) y Kontoumsätze (movimientos de caja: dividendos, comisiones).

**Datos extraídos:** Operaciones de compraventa, dividendos y comisiones.

**Limitaciones:** Para que cada comisión se asigne a su operación, sube también el CSV de Kontoumsätze junto con el de Depotumsätze. Flatex anota cada dividendo como un único abono neto (ya descontada la retención en origen o la española) y el CSV no trae la retención, así que DeclaRenta avisa de que el importe es neto: corrige a mano las casillas 0029 (importe íntegro), 0588 (retención extranjera) y 0597 (retención española) con los datos del justificante en PDF de cada dividendo. Si cada dividendo trae su fila de Quellensteuer en el CSV, esa fila se usa como retención y el aviso no aparece.

### Scalable Capital

1. Inicia sesión en **Scalable Capital**.
2. Ve a **Perfil → Documentos fiscales**.
3. Descarga el informe de transacciones en formato **CSV**.

**Formato:** CSV con cabeceras `date;time;status;reference` (separador punto y coma).

**Datos extraídos:** Operaciones de compraventa y dividendos.

**Limitaciones:** Los informes de Scalable no incluyen posiciones abiertas para el Modelo 720. Necesitarás esa información por separado.

### eToro

1. Inicia sesión en **eToro**.
2. Ve a **Ajustes → Extracto de cuenta**.
3. Selecciona el período del ejercicio fiscal.
4. Descarga el fichero **XLSX** (Excel).

**Formato:** XLSX (Excel) con pestaña "Closed Positions".

**Datos extraídos:** Posiciones cerradas con precios de apertura y cierre, dividendos.

**Limitaciones:** eToro no proporciona ISINs directamente; DeclaRenta solo los utiliza si están presentes en el extracto exportado (no se infieren desde el nombre del activo). Los CFDs de acciones e índices se procesan; los CFDs de criptomonedas no están soportados.

### Revolut

1. Inicia sesión en la **web de Revolut** (app.revolut.com o app móvil).
2. Ve a **Trading/Cripto → Extractos**.
3. Selecciona **Trading Account Statement** del ejercicio fiscal.
4. Descarga en formato **XLSX** (Excel).

**Formato:** XLSX (Excel) con columnas Date acquired, Date sold, Symbol, Quantity, Cost basis, Gross proceeds, Fees, etc.

**Datos extraídos:** Posiciones cerradas (compra + venta) con PnL y comisiones. Soporta acciones y criptomonedas.

**Limitaciones:** Revolut no incluye ISINs, dividendos ni posiciones abiertas en este extracto. Para dividendos se necesita el Account Statement (no soportado aún). Para posiciones abiertas (Modelo 720/D-6), se necesita información adicional.

### Lightyear

1. Abre la app de **Lightyear**.
2. Ve a **Perfil → Informes**.
3. Selecciona **Transaction report** y el período.
4. Descarga el fichero CSV y envíalo a tu ordenador.

**Formato:** CSV con cabeceras `Date, Reference, Ticker, ISIN, Type, Quantity, CCY, Price/share, Gross Amount, FX Rate, Fee, Net Amt., Tax Amt.`

**Datos extraídos:** Compras, ventas, dividendos, distribuciones (ETFs monetarios), intereses y retenciones fiscales.

**Limitaciones:** Lightyear no incluye posiciones abiertas en el CSV. Para Modelo 720/D-6 se necesita información adicional. Las conversiones de divisa (FX) generan ganancias o pérdidas patrimoniales sujetas a tributación (DGT V2324-10, Art. 33.1 LIRPF); DeclaRenta las calcula por defecto (salvo que actives el modo monodivisa en tu perfil fiscal).

### Freedom24

1. Inicia sesión en la **plataforma web de Freedom24**.
2. Ve a **Informes → Informe de operaciones**.
3. Selecciona el período y formato **JSON**.
4. Descarga el fichero.

**Formato:** JSON con arrays de `trades`, `corporate_actions` y `cash_flows`.

**Datos extraídos:** Operaciones, dividendos, acciones corporativas y flujos de caja.

**Limitaciones:** El formato JSON de Freedom24 puede variar entre versiones. Si la estructura no coincide, el auto-detector no reconocerá el fichero.

### Coinbase

1. Inicia sesión en **Coinbase**.
2. Ve a **Impuestos → Documentos**.
3. Haz clic en **Generar informe**.
4. Descarga el historial de transacciones en formato CSV.

**Formato:** CSV con cabeceras `Transaction Type` y `Spot Price`.

**Datos extraídos:** Compras, ventas, conversiones y posiciones de criptomonedas.

**Limitaciones:** Solo operaciones de criptoactivos. Los staking rewards se interpretan como ingresos.

### Binance

1. Inicia sesión en **Binance**.
2. **Historial de operaciones spot:** Órdenes → Orden spot → Exportar historial de operaciones (↑) → Spot - Historial de Operaciones → Personalizar tiempo (UTC+1) → CSV.
3. **Historial de transacciones:** Órdenes → Historial de Activos → Exportar registros de transacciones (↑) → Historial de Transacciones → Personalizar tiempo (UTC+1) → CSV.
4. Puedes subir uno o ambos ficheros — se aceptan tanto en español como en inglés.

**Formato:** CSV con cabeceras `Date(UTC),Pair,Side,Price`.

**Datos extraídos:** Operaciones de compraventa en mercado spot.

**Limitaciones:** Solo mercado spot. Operaciones de futuros o derivados no están soportadas. Las distribuciones y staking pueden requerir exportaciones adicionales.

### Kraken

1. Inicia sesión en **Kraken**.
2. Ve a **History → Export**.
3. Selecciona **Trades** y el rango de fechas.
4. Formato: **CSV**, descarga el fichero.

**Formato:** CSV con cabeceras `txid`, `pair`/`ordertxid` o `refid`/`aclass`.

**Datos extraídos:** Operaciones de compraventa y movimientos de fondos.

**Limitaciones:** Solo operaciones spot. Kraken usa pares propios (como XXBTZEUR) que DeclaRenta normaliza automáticamente.

### Trade Republic

1. Abre la app de **Trade Republic**.
2. Ve a **Perfil → Actividad**.
3. Pulsa los tres puntos (⋯) y selecciona **Exportar**.
4. Selecciona el rango de fechas y formato **CSV**.
5. Descarga el fichero y envíalo a tu ordenador.

**Formato:** CSV con cabeceras de transacción.

**Datos extraídos:** Operaciones de compraventa y dividendos.

### Trading 212

1. Inicia sesión en la **web de Trading 212**.
2. Ve a **Historial → Transacciones**.
3. Filtra por el rango de fechas deseado.
4. Haz clic en **Descargar CSV**.

**Formato:** CSV con cabeceras de transacción.

**Datos extraídos:** Operaciones de compraventa y dividendos.

### MEXEM (no soportado todavía — planeado)

MEXEM no tiene todavía un parser propio en DeclaRenta. No obstante, MEXEM utiliza la misma plataforma que Interactive Brokers y exporta en **Flex Query XML**: si generas una Activity Flex Query (Trades, Cash Transactions y Open Positions, con todos los campos y el campo **Notes** en Trades), el fichero `.xml` se auto-detecta como IBKR y se procesa con el parser de IBKR. Un parser específico de MEXEM está planeado.

### Swissquote (no soportado todavía — planeado)

Swissquote no tiene todavía un parser en DeclaRenta. El soporte está planeado. Mientras tanto, si tu informe coincide con el formato de otro broker soportado puedes intentar subirlo, pero no hay un parser específico de Swissquote.
