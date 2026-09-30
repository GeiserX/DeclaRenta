# Casillas del Modelo 100

> Ejercicio 2025. Referencias legales actualizadas a Ley 7/2024.

## Base del ahorro — Ganancias y pérdidas patrimoniales

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **0328** | Valor de transmisión (acciones negociadas) | Σ (precio_venta × cantidad × multiplicador − comisión − impuestos) × tipo_ECB_venta | Art. 35.2 y 37.1.a LIRPF |
| **0331** | Valor de adquisición (acciones negociadas) | Σ (precio_compra × cantidad × multiplicador + comisión + impuestos) × tipo_ECB_compra, siguiendo FIFO sobre los lotes consumidos | Art. 35.1 LIRPF |
| **0358** | Pérdidas patrimoniales a compensar | Pérdidas netas NO bloqueadas por regla anti-churning | Art. 49 LIRPF |

**Notas:**
- La casilla **0327** es un campo de texto (denominación de los valores), no un importe. Las opciones, criptomonedas y fondos no cotizados se declaran como «otros elementos patrimoniales» en las casillas **1633/1637**, no en 0328/0331.
- En valores en **moneda extranjera**, el valor de adquisición mostrado se calcula al tipo de cambio del BCE de la fecha de **venta** (no de compra), de modo que transmisión − adquisición coincide exactamente con la ganancia o pérdida (DGT **V2422-20**: la ganancia se calcula en la moneda del valor y solo la diferencia se convierte a euros). Por eso este importe puede diferir del coste histórico en euros de la fecha de compra.
- El motor FIFO (Art. 37.2 LIRPF) determina qué lotes se consumen al vender valores homogéneos.
- La regla anti-churning (Art. 33.5.f/g LIRPF) bloquea **solo la parte proporcional** de la pérdida correspondiente a la cantidad recomprada; el resto se incluye en 0358 y se computa ahora. La parte bloqueada se difiere (no se pierde) y se reporta por separado hasta que se vendan los valores recomprados.
- Los impuestos de transacción (STT, FTT, SEC fees) se incluyen en el coste de adquisición (compras) y se deducen del valor de transmisión (ventas).

## Base del ahorro — Ganancias por transmisión de moneda extranjera

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **1633** | Valor de transmisión (FX) | Σ cantidad_divisa_vendida × tipo_ECB_fecha_venta | Art. 33.1 LIRPF |
| **1637** | Valor de adquisición (FX) | Σ cantidad_divisa × tipo_ECB_fecha_adquisición, consumiendo lotes FIFO | Art. 33.1 LIRPF |

**Notas:**
- La divisa es un elemento patrimonial: la ganancia/pérdida es valor de transmisión − valor de adquisición (Art. **33.1** LIRPF), imputada en la conversión efectiva a euros (Art. 14.2.e). La divisa comparte el bloque «otros elementos patrimoniales» (casillas 1633/1637) con opciones, cripto y fondos no cotizados. La casilla 1626 es «Tipo de elemento patrimonial. Clave», y 1631 es la «Fecha de transmisión» — no son importes.
- Cada conversión EUR→FCY crea un lote en la cola FIFO de esa divisa (DGT V2324-10).
- Cada disposición de divisa (FCY→EUR, o compra de valores en FCY) consume lotes por FIFO.
- Las conversiones automáticas del broker (FXCONV) se excluyen: solo las operaciones deliberadas generan eventos fiscales.
- No existe umbral mínimo (de minimis) — toda conversión es declarable.
- La regla anti-churning (Art. 33.5.f/g) NO se aplica a divisas.

!!! warning

    **Fondos y ETFs:** DeclaRenta clasifica los fondos y ETFs (categoría FUND) y los bonos (BOND) en este bloque «otros elementos» (1633/1637). Si tu fondo/ETF *cotiza* en un mercado regulado, técnicamente correspondería al bloque de acciones negociadas (0328/0331). Los informes de los brokers no indican de forma fiable si un fondo cotiza o no, por lo que se aplica este criterio uniforme. **El impuesto a pagar es idéntico** (ambos bloques tributan en la base del ahorro al mismo tipo); solo cambia la casilla en la que se anota. Si lo prefieres, puedes mover manualmente en Renta Web las ventas de ETFs cotizados a las casillas 0328/0331.

## Base del ahorro — Rendimientos del capital mobiliario

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **0029** | Ingresos íntegros (dividendos brutos) | Σ dividendo_bruto × tipo_ECB_fecha_pago | Art. 25.1.a LIRPF |
| **—** | Intereses pagados al broker (margen, **no deducible** — informativo) | Σ intereses_pagados_al_broker × tipo_ECB | Art. 26.1.a LIRPF (solo admite gastos de administración y custodia) |
| **0027** | Intereses de cuentas, depósitos y activos financieros en general | Σ intereses_recibidos × tipo_ECB | Art. 25.2 LIRPF |

**Notas:**
- Los dividendos incluyen tanto dividendos ordinarios como "Payment In Lieu of Dividends" (dividendos sustitutivos en operaciones de préstamo de valores).
- Las retenciones extranjeras NO se deducen aquí — se declaran en la casilla 0588.
- La conversión a EUR usa el tipo de cambio ECB oficial del día de pago (DGT V0583-16, PGC NRV 11a).
- Los gastos genuinos de administración y depósito de valores negociables (cuando el bróker los detalla) sí son deducibles en la **Casilla 0037** (Art. 26.1.a LIRPF); la casilla 0027 recoge ingresos íntegros, nunca gastos.
- Las cuotas de suscripción del bróker (p. ej. planes de trading de tarifa plana) NO son «gastos de administración y depósito de valores negociables», por lo que no son deducibles.

## Deducciones

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **0588** | Deducción por doble imposición internacional | Por país: min(retención_extranjera, impuesto_español_sobre_esa_renta) | Art. 80 LIRPF |

**Notas:**
- El impuesto español se calcula aplicando los tramos del ahorro al ingreso bruto de cada país.
- La deducción está limitada al impuesto que España hubiera cobrado sobre esa misma renta.

## Tramos del ahorro (ejercicio 2025)

| Base liquidable del ahorro | Tipo gravamen | Referencia |
|---------------------------|---------------|------------|
| 0 – 6.000 € | 19% | Art. 66.1 LIRPF |
| 6.000 – 50.000 € | 21% | Art. 66.1 LIRPF |
| 50.000 – 200.000 € | 23% | Art. 66.1 LIRPF |
| 200.000 – 300.000 € | 27% | Art. 66.1 LIRPF |
| > 300.000 € | 30% | Art. 66.1 LIRPF, modificado por Ley 7/2024, DF 7ª |

## Regla anti-churning (Art. 33.5.f/g LIRPF)

Cuando el contribuyente vende valores con **pérdida** y adquiere valores **homogéneos** dentro de la ventana temporal, la pérdida **no computa de forma proporcional**: solo se bloquea la parte de la pérdida correspondiente a la **cantidad recomprada**; el resto se computa ahora.

- **Art. 33.5.f LIRPF** — valores **cotizados**: ventana de **±2 meses** calendario (antes o después de la venta).
- **Art. 33.5.g LIRPF** — valores **no cotizados**: ventana de **±1 año**.

La pérdida bloqueada **se difiere, no se pierde**: «las pérdidas patrimoniales se integrarán a medida que se transmitan los valores o participaciones que permanezcan en el patrimonio del contribuyente». Es decir, vuelve a computar cuando más adelante se venden los valores recomprados.

Solo se bloquea «la correspondiente a las acciones que se consideran recompradas», y una misma compra no puede bloquear varias pérdidas (lectura proporcional «por paquetes»): DGT **V0913-08**, **V2481-20** y **V3282-18**.

**Ejemplo.** Vender 100 acciones con una pérdida de 1.000 € y recomprar 30 dentro de los 2 meses:
- Se difieren **300 €** (la pérdida correspondiente a 30 acciones).
- Se imputan **700 €** ahora (la pérdida de las 70 acciones no recompradas, que sí entra en la casilla 0358).
- Cuando se vendan esas 30 acciones recompradas, se reintegran los **300 €** diferidos.

**Reintegración.** Si se suben los ficheros de varios años juntos, la reintegración de la pérdida diferida es **automática** (el motor procesa todas las operaciones en un único recorrido cronológico). En declaraciones de un solo año por separado, la pérdida diferida debe seguirse **manualmente** (limitación documentada).

### Ventana de dos meses

La ventana se calcula en meses naturales (no en días). Si vendes el 15 de marzo con pérdida:

- Ventana anterior: desde el 15 de enero.
- Ventana posterior: hasta el 15 de mayo.
- Si has recomprado valores homogéneos dentro de la ventana aplicable, la pérdida puede quedar **bloqueada**. Para no cotizados/cripto se usa la ventana de 1 año.

### Qué hacer en Renta Web

En Renta Web esto **requiere acción**: no es automático. Por el importe bloqueado debes marcar la casilla **«Pérdidas patrimoniales no imputables»**; y cuando vendas los valores recomprados, debes imputar entonces la pérdida diferida.

### Cómo lo detecta DeclaRenta

El motor de anti-churning recorre todas las operaciones en orden cronológico y, para cada valor homogéneo:

1. Identifica las ventas con pérdida (`gainLossEur < 0`).
2. Para cada una, suma la cantidad de valores homogéneos recomprados dentro de la ventana aplicable (2 meses para cotizados, 1 año para no cotizados/cripto), antes o después de la venta.
3. Bloquea la pérdida de forma **proporcional**: `pérdida bloqueada = |pérdida| × cantidad recomprada / cantidad vendida`. La parte restante se computa ahora.
4. La pérdida bloqueada queda **diferida**, asociada a los valores recomprados (no se suma a su coste).
5. **Reintegración:** cuando una venta posterior transmite esos valores recomprados, el motor libera la pérdida diferida correspondiente (de forma proporcional a la cantidad vendida), volviendo a hacerla deducible.
6. Las operaciones con pérdida bloqueada aparecen resaltadas en la tabla de resultados.

!!! warning

    La regla anti-churning se aplica a **valores homogéneos**: acciones (STK), fondos (FUND), bonos (BOND) y **criptomonedas**. Las criptomonedas (y los valores no cotizados) se tratan como no cotizados y usan la **ventana de 1 año (±12 meses)** en lugar de los 2 meses de los valores cotizados. **No se aplica** a opciones (OPT), futuros (FUT), CFDs ni forex (CASH).

## Tipo de cambio

DeclaRenta usa exclusivamente los **tipos de cambio diarios del BCE** (European Central Bank), publicados a las 16:00 CET cada día TARGET. Para fines de semana y festivos, se utiliza el último tipo disponible (día hábil anterior).

**Base legal:** PGC NRV 11a (partidas monetarias en moneda extranjera) y consultas vinculantes de la DGT (V2324-10, V0583-16). No existe ningún artículo en la LGT que prescriba una fuente concreta de tipos de cambio; el BCE constituye un safe harbor por su carácter institucional.

## Método FIFO (Art. 37.2 LIRPF)

> "Cuando existan valores homogéneos se considerará que los transmitidos por el contribuyente son aquellos que adquirió en primer lugar."

DeclaRenta agrupa los lotes por:
- **ISIN** para acciones, ETFs y fondos
- **Símbolo** para opciones (que carecen de ISIN en IBKR)

Los stock splits y reverse splits ajustan la cantidad y el precio por acción de los lotes existentes, manteniendo el coste total invariable.

### Cómo funcionan los lotes

Cada compra crea un **lote** con su fecha de adquisición, cantidad, precio por acción y coste total en euros. Cuando vendes:

- Se consume el lote más antiguo primero.
- Si la venta es mayor que un lote, se consume parcialmente el siguiente.
- El coste base se calcula proporcionalmente: si un lote de 100 acciones con coste de 1.000 EUR pierde 30 acciones, el coste base de esas 30 es 300 EUR.
- El resto del lote (70 acciones, 700 EUR) permanece en la cola para futuras ventas.

### Tipos de cambio del BCE

La legislación fiscal española exige usar tipos de cambio oficiales, no los del broker. DeclaRenta obtiene los tipos diarios del BCE mediante su API SDMX:

- Se usa el tipo del día de la operación (compra o venta).
- Si es fin de semana o festivo, se retrocede hasta 10 días para encontrar el último tipo publicado.
- El BCE publica tipos como "1 EUR = X moneda extranjera". DeclaRenta invierte el tipo para obtener "1 unidad de moneda extranjera = Y EUR".
- La única conexión a Internet que realiza DeclaRenta es a la API pública del BCE.

### FIFO cross-broker

Si tienes el mismo ISIN en varios brokers (por ejemplo, acciones de Apple compradas en IBKR y en Degiro), DeclaRenta unifica las colas FIFO por ISIN. Al subir ficheros de múltiples brokers, todas las operaciones se ordenan cronológicamente y los lotes se consumen en orden global, independientemente del broker de origen.

### Precisión decimal

DeclaRenta utiliza la librería **Decimal.js** con precisión de 20 dígitos significativos y redondeo `ROUND_HALF_UP`. Esto evita los errores de punto flotante típicos de JavaScript (como `0.1 + 0.2 = 0.30000000000000004`), garantizando que los cálculos fiscales sean exactos hasta el céntimo.

## Acciones corporativas

| Tipo IBKR | Acción | Tratamiento DeclaRenta |
|-----------|--------|----------------------|
| **FS** / **RS** | Stock split / reverse split | Ajusta cantidad × ratio, precio ÷ ratio, coste total sin cambio |
| **SD** | Scrip dividend (dividendo en acciones) | Añade lotes nuevos con coste = importe IBKR × tipo_ECB |

Las acciones corporativas modifican los lotes FIFO sin generar hechos imponibles (salvo excepciones). DeclaRenta las procesa cronológicamente junto con las operaciones de compraventa. Los tipos que no aplica (por ejemplo, **IC**, cambio de ISIN) aparecen como aviso informativo para que revises el coste de las ventas posteriores de ese valor.

### Stock splits y reverse splits

Un *split* multiplica el número de acciones por un ratio y divide el precio proporcionalmente. Un *reverse split* hace lo contrario. En ambos casos:

- La **cantidad** de cada lote se multiplica (o divide) por el ratio.
- El **precio por acción** se ajusta inversamente.
- El **coste total en euros** del lote no cambia — es una operación fiscalmente neutra.
- Las fracciones de acción (por ejemplo, 0,5 acciones tras un reverse split de 1 por 10) conservan su parte del coste. Si el bróker las vende y paga la fracción en efectivo (*cash-in-lieu*) con una operación de venta, esa venta consume la fracción con su coste proporcional.
- Si el reverse split cambia el ISIN (IBKR lo informa con una fila RS para el ISIN antiguo y otra para el nuevo), los lotes pasan al ISIN nuevo con su coste y su fecha de adquisición.

### Fusiones (mergers / acquisitions)

Cuando una empresa es adquirida por otra, los lotes del ISIN antiguo se transfieren al ISIN nuevo:

- La cantidad se ajusta por el ratio de canje.
- El **coste base total se conserva** — es un canje fiscalmente neutro.
- El precio por acción se recalcula sobre la nueva cantidad.
- La fecha de adquisición original se mantiene.

### Spin-offs

En un spin-off, una empresa separa una división como entidad independiente. El coste base del lote original se reparte proporcionalmente:

- Se crea un nuevo lote para la entidad escindida con una fracción del coste base original.
- El lote de la empresa matriz reduce su coste base en la misma proporción.
- La fecha de adquisición del nuevo lote hereda la fecha original del lote padre.
- La fracción se estima a partir del ratio de distribución (en la práctica debería basarse en valores de mercado el día de la distribución).

### Scrip dividends (dividendos en acciones)

Un scrip dividend entrega nuevas acciones en lugar de efectivo. DeclaRenta lo trata como:

- Un nuevo lote con el coste base que reporta el broker (importe del dividendo equivalente).
- La fecha de adquisición es la fecha del evento corporativo.
- Estos lotes entran en la cola FIFO como cualquier compra.
