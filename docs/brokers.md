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

Si una fila de compra o venta nombra un valor pero no se puede leer (una fecha que falta o no es válida, un ticker o un ISIN que falta, un tipo de operación desconocido, un importe vacío), DeclaRenta no la descarta ni la cuenta como compra. La guarda sin acciones ni importes y te avisa con la fila y la celda que falla. Esa fila puede ser una segunda compra, así que DeclaRenta no aplica la excepción de una sola compra (art. 33.5.f LIRPF) a ese valor mientras esa fila no se pueda leer. Vuelve a exportar el fichero o corrige la fila y súbelo de nuevo.

Lo mismo pasa con una fila que mueve acciones sin precio, como un desdoblamiento, un traspaso de entrada, unas acciones gratuitas o unos derechos con precio 0. DeclaRenta no la aplica, pero tampoco la descarta. Te avisa con la fila. En Freedom24 esto vale para toda operación societaria que no sea un dividendo o un cupón, como un canje, un vencimiento o un reembolso. También vale para una fila sin un tipo legible (type_id), porque puede ser un desdoblamiento. Si esa fila te pagó dinero, esa venta no está en el informe y tienes que añadirla a mano. Un dividendo sin ticker se calcula por su ISIN. Si no trae ni ticker ni ISIN, no tiene una fecha legible o no tiene un importe legible, DeclaRenta no lo suma. Te avisa con la fila para que lo añadas a mano. Si la retención (tax_amount) no se puede leer o es mayor que el dividendo, DeclaRenta suma el dividendo sin retención y te avisa con la celda. Si una compra o una venta de Freedom24 no tiene un precio (p) legible, o no dice su divisa (curr_c), DeclaRenta no la calcula y te avisa con la celda. Un dividendo sin divisa tampoco se suma. DeclaRenta nunca supone que es en dólares. En Revolut, un desdoblamiento con la cantidad a 0 o vacía tampoco se aplica: te avisa con la fila.

En el historial de transacciones de Binance, una fila sin fecha y hora legible, sin importe legible o sin moneda no se puede emparejar con el resto de su operación. Un importe vacío también cuenta como no legible. DeclaRenta no calcula esa fila, pero te avisa con la operación, la celda que falla y lo que sí se lee: la moneda, la cantidad o la fecha. Cada compra, venta o conversión son dos filas con la misma hora, la moneda que entra y la que sale. DeclaRenta las empareja si están a 1 segundo o menos. Si una fila no tiene su pareja, no la calcula y te avisa con la moneda, la operación, la cantidad y la hora. Si compras varias criptomonedas en el mismo segundo y el fichero no dice qué pago va con cada una, DeclaRenta reparte el pago y te avisa con todas esas filas, porque el coste de cada criptomoneda no es fiable. Si en el mismo segundo conviertes una criptomoneda en otra y vuelves a la primera, las filas de esa criptomoneda se anulan entre sí. DeclaRenta no sabe qué fila va con cada conversión. Por eso no las calcula y te avisa con cada fila para que añadas las conversiones a mano.

En Coinbase, Kraken y el historial de operaciones de Binance, una compra o una venta sin una cantidad legible, sin moneda o sin un lado (compra o venta) legible no se calcula. DeclaRenta te avisa con la moneda, la fecha y la celda que falla. Una fecha con el día delante, como 01-06-2025, tampoco se lee en el historial de operaciones de Binance, porque Binance escribe 2025-06-01. Suele salir al guardar el fichero con una hoja de cálculo. Vuelve a descargar el fichero original y súbelo sin editarlo. Si esa fila es una recompra de una criptomoneda que vendiste con pérdidas, DeclaRenta no puede comprobar la regla del año siguiente (art. 33.5.e LIRPF).

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

**Notas:** IBKR es el broker con soporte más completo. Las comisiones en divisa distinta a la operación se convierten correctamente. El multiplicador de opciones se aplica automáticamente. El campo **Listing Exchange** de Trades y de Financial Instrument Information decide el plazo anti-churning de cada valor: 1 año si IBKR solo lo muestra en un mercado sin equivalencia, como Londres desde 2021 (ver [Plazo de 2 meses o de 1 año por valor](casillas.md#plazo-de-2-meses-o-de-1-ano-por-valor)).

### Degiro

1. Inicia sesión en la **web de Degiro** (no la app).
2. Abre el panel lateral **Buzón** (icono de sobre).
3. Haz clic en **Transacciones** (historial de transacciones de tus productos).
4. Selecciona el rango de fechas deseado (incluye **todo el histórico** para FIFO).
5. Haz clic en **Exportar** y descarga el fichero CSV.
6. Para dividendos: vuelve al **Buzón** → **Cuenta** (historial de movimientos de tu cuenta) → misma fecha → **Exportar** CSV.

**Formato:** CSV con cabeceras que incluyen ISIN, cantidad y precio.

**Datos extraídos:** Operaciones de compraventa, dividendos, retenciones e intereses cobrados (CSV de Cuenta).

**Limitaciones:** Degiro no exporta acciones corporativas. Los splits deben reflejarse ya en el historial de operaciones. Si tienes operaciones en varios ejercicios, exporta todos los años.

### Flatex

1. Inicia sesión en la **web de Flatex**.
2. Ve a **Movimientos** → **Depotumsätze** (movimientos de la cartera).
3. Selecciona **todo el histórico** (necesario para el cálculo FIFO) y exporta el fichero CSV.
4. Para dividendos: ve a **Kontoumsätze** (movimientos de la cuenta), mismo rango de fechas, y exporta el CSV. Ojo: ahí los dividendos aparecen por el importe neto, ya descontada la retención; toma el importe íntegro y la retención del justificante en PDF de cada dividendo.
5. Sube **ambos ficheros** CSV (Depotumsätze para operaciones y Kontoumsätze para dividendos).

**Formato:** CSV alemán (separador punto y coma). Dos ficheros: Depotumsätze (operaciones) y Kontoumsätze (movimientos de caja: dividendos, comisiones).

**Datos extraídos:** Operaciones de compraventa, dividendos y comisiones.

**Limitaciones:** Para que cada comisión se asigne a su operación, sube también el CSV de Kontoumsätze junto con el de Depotumsätze. Flatex anota cada dividendo como un único abono neto (ya descontada la retención en origen o la española) y el CSV no trae la retención, así que DeclaRenta avisa de que el importe es neto: corrige a mano las casillas 0029 (importe íntegro), 0588 (retención extranjera) y 0597 (retención española) con los datos del justificante en PDF de cada dividendo. Si cada dividendo trae su fila de Quellensteuer en el CSV, esa fila se usa como retención y el aviso no aparece. Los intereses (Habenzinsen, Zinsen) y los cupones (Zinszahlung) se suman como intereses (casilla 0027). Si un dividendo, una retención o un interés no tiene un importe o una divisa legible, DeclaRenta no lo suma y te avisa con la fila. Tampoco suma la retención de ese dividendo. Si los apuntes de caja de una orden no cuadran con la operación, DeclaRenta deja su comisión en 0 y te avisa con la orden. Puede faltar un apunte, sobrar uno o tener un importe ilegible.

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

**Limitaciones:** Lightyear no incluye posiciones abiertas en el CSV. Para Modelo 720/D-6 se necesita información adicional. Las conversiones de divisa (FX) generan ganancias o pérdidas patrimoniales sujetas a tributación (DGT V2324-10, Art. 33.1 LIRPF); DeclaRenta las calcula salvo que elijas «Tradicional sin divisa (monodivisa)» en el paso «Revisar y elegir método».

### Freedom24

1. Inicia sesión en la **plataforma web de Freedom24**.
2. Ve a **Informes → Informe de operaciones**.
3. Selecciona el período y formato **JSON**.
4. Descarga el fichero.

**Formato:** JSON con arrays de `trades`, `corporate_actions` y `cash_flows`.

**Datos extraídos:** Operaciones, dividendos y cupones con su retención. Las demás acciones corporativas no se aplican: DeclaRenta te avisa con la fila. Los flujos de caja (`cash_flows`) no se calculan. DeclaRenta te avisa con cada fila que no sea un ingreso o una retirada de dinero, como un interés o una comisión.

**Limitaciones:** El formato JSON de Freedom24 puede variar entre versiones. Si la estructura no coincide, el auto-detector no reconocerá el fichero.

### Coinbase

1. Inicia sesión en **Coinbase**.
2. Ve a **Impuestos → Documentos**.
3. Haz clic en **Generar informe**.
4. Descarga el historial de transacciones en formato CSV.

**Formato:** CSV con cabeceras `Transaction Type` y `Spot Price`. También lee los ficheros anteriores a 2021, que ponen la divisa delante del nombre de la columna (`EUR Spot Price at Transaction`).

**Datos extraídos:** Compras, ventas, conversiones y posiciones de criptomonedas.

**Limitaciones:** Solo operaciones de criptoactivos. Los staking rewards se interpretan como ingresos. Un ingreso en dólares u otra divisa se pasa a euros con el tipo del BCE de ese día. Si el precio de una operación no se puede leer, DeclaRenta lo calcula con el subtotal dividido por la cantidad. Si tampoco hay subtotal, o si falta la divisa de la fila (`Price Currency`), DeclaRenta no calcula esa fila y te avisa con la celda que falla.

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

Las compraventas se leen solo del archivo Trades. Si subes también el libro mayor (Ledgers) para las recompensas de staking, sube el archivo Trades de las mismas fechas. DeclaRenta avisa de cada compraventa del libro mayor que no está en ningún archivo Trades subido. Del libro mayor se leen las recompensas de staking y Earn (base del ahorro) y los airdrops (base general).

**Limitaciones:** Solo operaciones spot. Kraken usa pares propios (como XXBTZEUR) que DeclaRenta normaliza automáticamente. También lee los pares escritos con barra (BTC/EUR). Solo los códigos antiguos de Kraken (XXBT, XETH, ZEUR…) pierden su prefijo X o Z. Una moneda cuyo nombre empieza por X o Z (ZETA, XAUT, XTZ) se lee tal cual.

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
