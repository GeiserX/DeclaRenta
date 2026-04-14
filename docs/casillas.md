# Casillas del Modelo 100 — Referencia DeclaRenta

> Ejercicio 2025. Referencias legales actualizadas a Ley 7/2024.

## Base del ahorro — Ganancias y pérdidas patrimoniales

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **0327** | Valor de transmisión | Σ (precio_venta × cantidad × multiplicador − comisión − impuestos) × tipo_ECB_venta | Art. 35.2 LIRPF |
| **0328** | Valor de adquisición | Σ coste FIFO en EUR de los lotes consumidos (precio × cantidad × multiplicador + comisión + impuestos) × tipo_ECB_compra | Art. 35.1 LIRPF |
| **0358** | Pérdidas patrimoniales a compensar | Pérdidas netas NO bloqueadas por regla anti-churning | Art. 49 LIRPF |

**Notas:**
- El motor FIFO (Art. 37.2 LIRPF) determina qué lotes se consumen al vender valores homogéneos.
- Las pérdidas bloqueadas por la regla anti-churning (Art. 33.5.f LIRPF) se reportan por separado y no se incluyen en 0358 hasta que se vendan los valores recomprados.
- Los impuestos de transacción (STT, FTT, SEC fees) se incluyen en el coste de adquisición (compras) y se deducen del valor de transmisión (ventas).

## Base del ahorro — Rendimientos del capital mobiliario

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **0029** | Ingresos íntegros (dividendos brutos) | Σ dividendo_bruto × tipo_ECB_fecha_pago | Art. 25.1.a LIRPF |
| **0032** | Gastos deducibles (intereses de margen) | Σ intereses_pagados_al_broker × tipo_ECB | Art. 26.1.a LIRPF |
| **0033** | Intereses de cuentas y depósitos | Σ intereses_recibidos × tipo_ECB | Art. 25.2 LIRPF |

**Notas:**
- Los dividendos incluyen tanto dividendos ordinarios como "Payment In Lieu of Dividends" (dividendos sustitutivos en operaciones de préstamo de valores).
- Las retenciones extranjeras NO se deducen aquí — se declaran en la casilla 0588.
- La conversión a EUR usa el tipo de cambio ECB oficial del día de pago (Art. 47 LGT).

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

## Regla anti-churning (Art. 33.5.f LIRPF)

Las pérdidas derivadas de la venta de valores **no computan** si el contribuyente ha adquirido valores homogéneos dentro de los **2 meses calendario** anteriores o posteriores a la venta (para valores cotizados) o **1 año** (para no cotizados).

Las pérdidas bloqueadas se integran cuando se transmiten los valores que permanecen en el patrimonio.

## Tipo de cambio

DeclaRenta usa exclusivamente los **tipos de cambio diarios del BCE** (European Central Bank), publicados a las 16:00 CET cada día TARGET. Para fines de semana y festivos, se utiliza el último tipo disponible (día hábil anterior).

**Base legal:** Art. 47 LGT (Ley General Tributaria) y consultas vinculantes de la DGT (Dirección General de Tributos).

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
