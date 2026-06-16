# Casillas del Modelo 100 — Referencia DeclaRenta

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

## Tipo de cambio

DeclaRenta usa exclusivamente los **tipos de cambio diarios del BCE** (European Central Bank), publicados a las 16:00 CET cada día TARGET. Para fines de semana y festivos, se utiliza el último tipo disponible (día hábil anterior).

**Base legal:** PGC NRV 11a (partidas monetarias en moneda extranjera) y consultas vinculantes de la DGT (V2324-10, V0583-16). No existe ningún artículo en la LGT que prescriba una fuente concreta de tipos de cambio; el BCE constituye un safe harbor por su carácter institucional.

## Método FIFO (Art. 37.2 LIRPF)

> "Cuando existan valores homogéneos se considerará que los transmitidos por el contribuyente son aquellos que adquirió en primer lugar."

DeclaRenta agrupa los lotes por:
- **ISIN** para acciones, ETFs y fondos
- **Símbolo** para opciones (que carecen de ISIN en IBKR)

Los stock splits y reverse splits ajustan la cantidad y el precio por acción de los lotes existentes, manteniendo el coste total invariable.

## Corporate actions

| Tipo IBKR | Acción | Tratamiento DeclaRenta |
|-----------|--------|----------------------|
| **FS** | Stock split / reverse split | Ajusta cantidad × ratio, precio ÷ ratio, coste total sin cambio |
| **SD** | Scrip dividend (dividendo en acciones) | Añade lotes nuevos con coste = importe IBKR × tipo_ECB |
