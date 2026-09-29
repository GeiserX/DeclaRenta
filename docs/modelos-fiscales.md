# Modelos fiscales y motor fiscal

## El problema

Si inviertes con un broker extranjero, hacer la renta es un infierno:

- **Renta Web no importa datos** de brokers extranjeros — todo manual
- **FIFO obligatorio** con tipos ECB oficiales (no los del broker)
- **Regla anti-churning** (2 meses cotizados / 1 año no cotizados) que nadie detecta automáticamente
- **Doble imposición** internacional que hay que calcular a mano
- **Modelo 720** obligatorio si tus activos en el extranjero superan 50.000 EUR
- **Modelo D-6** solo obligatorio si tu participación es ≥10% del capital o derechos de voto (Orden ICT/1408/2021)

DeclaRenta automatiza todo esto.

## Modelos fiscales

| Modelo | Descripción | Formato |
|---|---|---|
| **Modelo 100** (IRPF) | Casillas 0328, 0331, 1633, 1637, 0029, 0027, 0588 (pérdidas bloqueadas: informativo) | JSON, CSV, PDF (con tipos ECB) |
| **Modelo 720** | Declaración de bienes en el extranjero (>50.000 EUR), tipos A/M/C | Fixed-width AEAT (validado contra spec BOE) |
| **Modelo 721** | Revisión orientativa de criptomonedas en el extranjero (>50.000 EUR) | Generación oficial pendiente: AEAT exige XML |
| **Modelo D-6** | Guía orientativa para participaciones significativas (Banco de España / AFORIX) | JSON o guía paso a paso |

## Casillas del Modelo 100

| Casilla | Concepto |
|---|---|
| 0328 | Valor de transmisión — acciones negociadas (importe total de ventas) |
| 0331 | Valor de adquisición — acciones negociadas (coste total FIFO con tipos ECB) |
| 1633 | Valor de transmisión — otros elementos (opciones, cripto, fondos no cotizados) y divisa (FX) |
| 1637 | Valor de adquisición — otros elementos y divisa (FX) |
| 0029 | Dividendos brutos de acciones extranjeras |
| 0027 | Intereses de cuentas, depósitos y activos financieros (Art. 25.2 LIRPF) |
| — | Intereses pagados al broker (margen, no deducible — informativo) |
| — | Pérdidas bloqueadas por regla anti-churning (Art. 33.5.f/g) — informativo, no hay casilla agregada en Renta Web |
| 0588 | Deducción por doble imposición internacional |

> La casilla **0327** es un campo de texto (denominación de los valores), no un importe. Las ganancias por tipo de cambio (Art. 33.1 LIRPF) se declaran junto a los «otros elementos patrimoniales» en las casillas 1633/1637.

Referencia completa de cada casilla, con fórmulas y base legal: [casillas.md](casillas.md).

## Motor fiscal

- **FIFO estricto** con tipos de cambio ECB oficiales por fecha de operación
- **Todos los tipos de activo**: acciones, ETFs, opciones, futuros, forex, bonos, CFDs y criptomonedas
- **Regla anti-churning** (Art. 33.5.f/g LIRPF): bloqueo **proporcional** de la pérdida si se recompra el mismo valor en 2 meses (cotizados en mercado regulado) o 1 año (no cotizados/cripto) — solo se difiere la parte correspondiente a la cantidad recomprada. La pérdida diferida no se suma al coste: se reintegra al transmitir los valores recomprados. Excluye derivados y forex
- **Doble imposición** (Art. 80 LIRPF): deducción por retenciones en origen, desglosado por país
- **Stock splits**: forward y reverse, con liquidación de fracciones (cash-in-lieu)
- **Corporate actions**: fusiones (transferencia de coste) y spin-offs (distribución proporcional)
- **Compensación de pérdidas** (Art. 49 LIRPF): ventana de 4 años con compensación cruzada del 25%
- **Validador Modelo 720**: verificación contra la especificación BOE del formato de registro

Diseño del bloqueo proporcional anti-churning: [antichurning-proportional-design.md](antichurning-proportional-design.md).
