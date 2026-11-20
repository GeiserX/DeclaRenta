# Modelos fiscales y motor fiscal

## El problema

Si inviertes con un broker extranjero, hacer la renta es un infierno:

- **Renta Web no importa datos** de brokers extranjeros — todo manual
- **FIFO obligatorio** con tipos ECB oficiales (no los del broker)
- **Regla anti-churning** (2 meses en mercado regulado o equivalente / 1 año en el resto) que nadie detecta automáticamente
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
| **Modelo D-6** | Guía orientativa para participaciones significativas (programa AFORIX y eAFORIX, Secretaría de Estado de Comercio) | JSON o guía paso a paso |

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
| — | Pérdidas bloqueadas por regla anti-churning (Art. 33.5.f/g; 33.5.e en cripto) — informativo, no hay casilla agregada en Renta Web |
| 0588 | Deducción por doble imposición internacional |

> La casilla **0327** es un campo de texto (denominación de los valores), no un importe. Las ganancias por tipo de cambio (Art. 33.1 LIRPF) se declaran junto a los «otros elementos patrimoniales» en las casillas 1633/1637.

Referencia completa de cada casilla, con fórmulas y base legal: [casillas.md](casillas.md).

## Motor fiscal

- **FIFO estricto** con tipos de cambio ECB oficiales por fecha de operación
- **Todos los tipos de activo**: acciones, ETFs, opciones, futuros, forex, bonos, CFDs y criptomonedas
- **Regla anti-churning** (Art. 33.5.f/g LIRPF; en las criptomonedas, art. 33.5.e): bloqueo **proporcional** de la pérdida si se recompra el mismo valor en 2 meses (admitido a negociación en un mercado regulado del Espacio Económico Europeo o en un mercado declarado equivalente por la Comisión Europea, como NYSE o Nasdaq: DGT V0778-25) o 1 año (en ninguno de ellos: no cotizados, solo OTC, o solo en una bolsa de un tercer país sin equivalencia, como Londres desde 2021 o SIX fuera del periodo del 24/12/2017 al 30/06/2019). DeclaRenta aplica 2 meses a todo valor con ISIN, salvo que IBKR solo lo muestre en un mercado sin equivalencia en la fecha de la venta (Londres desde 2021, SIX fuera de ese periodo, OTC Markets…) o que lo marques con 1 año en el panel «Plazo anti-churning por valor» (`--antichurning-1y` en la línea de comandos). IBKR solo muestra el mercado de las líneas que has operado: si IBKR muestra un valor solo en Londres pero también cotiza en Ámsterdam, DeclaRenta le aplica 1 año; márcalo con 2 meses en ese panel (`--antichurning-2m`); ver [Plazo de 2 meses o de 1 año por valor](casillas.md#plazo-de-2-meses-o-de-1-ano-por-valor). En las criptomonedas solo cuenta la recompra de la misma criptomoneda en el año siguiente a la venta, nunca una compra anterior (art. 33.5.e, [issue #457](https://github.com/GeiserX/DeclaRenta/issues/457)). Solo se difiere la parte correspondiente a la cantidad recomprada. La pérdida diferida no se suma al coste: se integra, primero la más antigua, a medida que se venden acciones del mismo valor que ninguna recompra en su plazo cubre (transmisión definitiva); si se recompra parte, solo cuentan las acciones no recompradas. En las criptomonedas, la pérdida diferida se integra cuando se venden las unidades de la recompra que la bloqueó (art. 33.5.e); la venta de otras unidades no la integra. Excluye derivados y forex
- **Doble imposición** (Art. 80 LIRPF): deducción por retenciones en origen, desglosado por país
- **Stock splits**: forward y reverse (tipos FS y RS de IBKR); las fracciones de acción conservan su coste y, si el split cambia el ISIN, los lotes pasan al nuevo
- **Corporate actions**: fusiones (transferencia de coste) y spin-offs (distribución proporcional)
- **Compensación de pérdidas** (Art. 49 LIRPF): ventana de 4 años con compensación cruzada del 25%; solo en la CLI, con `--prior-losses`
- **Validador Modelo 720**: verificación contra la especificación BOE del formato de registro

Diseño del bloqueo proporcional anti-churning: [antichurning-proportional.md](https://github.com/GeiserX/DeclaRenta/blob/main/docs/design/antichurning-proportional.md).

## Doble imposición internacional

### Art. 80 LIRPF

Cuando recibes dividendos de una empresa extranjera, el país de origen suele retener un porcentaje en concepto de impuestos (por ejemplo, EE.UU. retiene un 15% si tienes el W-8BEN firmado, o un 30% sin él). España permite deducir ese impuesto pagado en el extranjero para evitar la doble tributación.

### Cálculo de la deducción

Para cada país, la deducción es el **menor** de:

- **Impuesto efectivamente pagado** en el país de origen (la retención), hasta el 15% del bruto, el límite de la mayoría de los convenios. Lo retenido de más se reclama en el país de origen.
- **Cuota que correspondería en España** sobre esa misma renta, que es el bruto de ese país por tu tipo medio del ahorro. Ese tipo medio es la cuota de los tramos sobre toda tu base del ahorro, dividida entre esa base.

Los tramos del ahorro que usa el cálculo están en [Casillas del Modelo 100](casillas.md#tramos-del-ahorro-ejercicio-2025).

### Desglose por país

DeclaRenta agrupa los dividendos por país de retención y calcula la deducción permitida para cada uno. En el detalle de la casilla 0588 verás, por país, el rendimiento bruto, el impuesto pagado y la deducción máxima, y debajo el total de rendimientos extranjeros. Ese bruto por país es lo que pide Renta Web como rendimiento obtenido en el extranjero; no uses la casilla 0029, que también incluye los dividendos españoles y los de países sin retención.

### Correcciones de la retención

A veces el bróker corrige una retención después de cobrarla: devuelve una parte (−1,50 USD y, días después, +0,50 USD) o la anula y vuelve a retener otra cantidad en otra fecha (−1,50, +1,50, −1,00). La deducción solo admite el impuesto pagado de verdad, así que DeclaRenta suma con su signo todas las filas de retención de cada dividendo, del mismo valor y a menos de 7 días de él. En los dos ejemplos la retención es de 1,00 USD. Una devolución nunca resta a un dividendo más de lo que se le retuvo: si es mayor, el resto corrige otro dividendo del mismo valor en esos días. Si ningún dividendo de esos 7 días puede tomar la devolución, DeclaRenta la resta de un dividendo anterior del mismo valor y del mismo año. Una devolución del 1 al 7 de enero también puede restarse de un dividendo del año anterior. Si no hay ningún dividendo así, DeclaRenta no la resta y te avisa con la fila. Si dos devoluciones compiten por el mismo dividendo, DeclaRenta las reparte para que cuenten las dos siempre que quepan. Un dividendo anulado (un importe negativo) no lleva retención; la anulación de su retención vuelve al dividendo original. Cada fila se valora en su propia divisa, al tipo del BCE del día del dividendo si está en la misma divisa, o al de su propia fecha si no.

IBKR fecha estas correcciones el día del dividendo, aunque las anote más tarde, a veces en el extracto del año siguiente. Otros brókeres fechan la devolución el día que la hacen, por ejemplo en enero para un dividendo de finales de diciembre. Si el fichero del año que calculas trae correcciones de un año anterior que bajan la retención, verás un aviso con el importe. Esas correcciones no cambian las casillas del año que calculas. La casilla de aquel año pudo salir alta: la 0588 si la retención era extranjera, o la 0597 si era española (un emisor español, ISIN ES…). Sube los ficheros de aquel año junto con este, calcula aquel año y, si esa casilla baja respecto a la que presentaste, corrige aquel año: con una autoliquidación rectificativa si es 2024 o posterior, el único procedimiento desde ese ejercicio, o con una autoliquidación complementaria si es 2023 o anterior.

### W-8BEN y convenios de doble imposición

El formulario **W-8BEN** es un certificado que presentas ante brokers estadounidenses para acogerte al convenio de doble imposición entre España y EE.UU. Con él firmado, la retención sobre dividendos de EE.UU. se reduce del 30% al 15%. Es fundamental firmarlo para maximizar la deducción por doble imposición.

España tiene convenios con la mayoría de países. La retención aplicable depende de cada convenio bilateral.

## Compensación de pérdidas

### Art. 49 LIRPF

Las pérdidas patrimoniales que no se hayan compensado en el ejercicio en que se generaron pueden arrastrarse durante los **cuatro ejercicios siguientes**.

### Compensación en la misma categoría

- Las pérdidas de ganancias patrimoniales (ventas con pérdida) se compensan primero con ganancias del mismo tipo.
- Las pérdidas de rendimientos del capital mobiliario (si las hubiera) se compensan con rendimientos positivos del mismo tipo.

### Compensación cruzada (límite del 25%)

Si después de la compensación en la misma categoría quedan pérdidas pendientes:

- Las pérdidas de ganancias patrimoniales pueden compensar hasta el **25%** de los rendimientos positivos del capital mobiliario (dividendos + intereses).
- Las pérdidas de rendimientos del capital mobiliario pueden compensar hasta el **25%** de las ganancias patrimoniales positivas.

### Cómo lo gestiona DeclaRenta

Mediante la opción `--prior-losses` del CLI, puedes proporcionar un fichero JSON con las pérdidas de ejercicios anteriores. DeclaRenta:

1. Descarta las pérdidas con más de 4 años de antigüedad (expiradas).
2. Compensa el saldo negativo del ejercicio con el saldo positivo de la otra categoría del mismo año, hasta el 25% de ese saldo positivo.
3. Aplica compensación en la misma categoría de las pérdidas anteriores (las más antiguas primero).
4. Aplica compensación cruzada de las pérdidas anteriores. El límite del 25% se calcula sobre el saldo positivo del año antes de compensar y es uno solo, compartido con el paso 2.
5. Añade al arrastre lo que quede del saldo negativo del ejercicio.

Las ganancias por divisa (casillas 1633/1637) cuentan en el saldo de ganancias y pérdidas patrimoniales, y las pérdidas bloqueadas por la regla antiaplicación (Art. 33.5.f/g, o 33.5.e en las criptomonedas) no cuentan como pérdida del año: se integran a medida que se venden acciones del mismo valor que ninguna recompra en su plazo cubre (transmisión definitiva). En las criptomonedas, la pérdida se integra cuando se venden las unidades de la recompra que la bloqueó, en proporción a la cantidad vendida, aunque después vuelvas a comprar la misma criptomoneda.

El formato del fichero JSON es:

```json
[
{ "year": 2022, "amount": "-1500.00", "remaining": "-1200.00", "category": "gains" },
{ "year": 2023, "amount": "-800.00", "remaining": "-800.00", "category": "income" }
]
```

DeclaRenta no usa una entrada cuyo importe llega a un billón de euros (más de 12 cifras enteras), y la línea de comandos avisa con el año de esa entrada. Ninguna pérdida real llega a esa cifra, y sin esa pérdida solo puedes pagar de más.

## Otros tipos de activo

Además de acciones (STK) y fondos (FUND), DeclaRenta procesa estos instrumentos financieros:

### Opciones (OPT)

Las opciones se procesan con FIFO por símbolo (no tienen ISIN). El multiplicador del contrato (normalmente 100) se aplica automáticamente al calcular costes e importes de venta. DeclaRenta extrae los campos `putCall`, `strike`, `expiry` y `underlyingSymbol` del Flex Query XML de IBKR.

- **Compraventa de opciones**: la prima pagada es el coste de adquisición; la prima recibida al vender es el valor de transmisión.
- **Opciones ejercidas**: en el futuro, el coste de la prima se integrará en el coste de adquisición de las acciones subyacentes. Actualmente, el ejercicio se procesa como cierre estándar de la posición de opciones.
- **Opciones que expiran sin valor**: la prima pagada se declara como pérdida patrimonial total.

La regla anti-churning (Art. 33.5.f) no se aplica a opciones.

### Futuros (FUT)

Los contratos de futuros se procesan con FIFO por símbolo, aplicando el multiplicador del contrato. Las ganancias y pérdidas tributan como ganancias patrimoniales en la base del ahorro.

La regla anti-churning no se aplica a futuros.

### Forex (CASH) — Art. 33.1 LIRPF

Las operaciones de compraventa de divisas tributan como ganancias y pérdidas patrimoniales (Art. 33.1 LIRPF, imputadas al cobro o pago según el Art. 14.2.e). DeclaRenta implementa un **motor FX FIFO independiente** que genera dos eventos fiscales al operar en divisa extranjera:

1. **Ganancia/pérdida del valor** (acciones cotizadas → casillas 0328/0331; resto de elementos → 1633/1637): calculada sobre el precio del activo × tipo ECB en cada fecha.
2. **Ganancia/pérdida FX** (casillas 1633/1637): diferencia entre el tipo de cambio al adquirir la divisa y el tipo al disponer de ella.

Cada adquisición de divisa extranjera (conversión EUR→USD, dividendo o interés cobrado en USD) crea un lote en la cola FIFO de esa divisa. Cada conversión de esa divisa (por ejemplo, USD→EUR) consume lotes por orden cronológico y realiza una ganancia o pérdida de divisa, igual que los intereses y comisiones que pagas en USD. Comprar acciones en USD no realiza nada. Los dólares gastados quedan apartados con su coste de origen y vuelven a la cola cuando vendes las acciones, junto con el beneficio de la venta al tipo de ese día.

Las conversiones automáticas del broker (AFx/FXCONV de IBKR) se procesan por defecto como cualquier otra conversión, porque IBKR no convierte a euros al vender y la divisa que tienes es real. Si tu broker sí la convierte en el acto, puedes excluirlas desmarcando «Procesar autoconversiones del bróker (AFx/FXCONV)» en el paso «Revisar y elegir método», o con `--skip-auto-convert` en la CLI.

Esto describe el método por defecto, el «Criterio DGT (multidivisa)». Hay otros dos métodos: «Tradicional con divisa» (acciones al tipo del día de compra y de venta, y la divisa tributa por FIFO cuando sale de la cuenta) y «Tradicional sin divisa (monodivisa)» (la misma valoración de acciones, sin ningún resultado de divisa). La comparación casilla por casilla está en [Los tres métodos](casillas.md#los-tres-metodos-para-acciones-en-divisa).

La regla anti-churning no se aplica a operaciones forex.

### Bonos y renta fija (BOND)

La compraventa de bonos tributa como ganancia o pérdida patrimonial, procesada con FIFO. Los cupones (intereses de bonos) se declaran como rendimiento del capital mobiliario en la Casilla 0027, al igual que los intereses de cuentas.

Las letras del Tesoro extranjeras reciben el mismo tratamiento fiscal que los bonos corporativos.

La regla anti-churning sí se aplica a bonos (son valores homogéneos).

### CFDs (Contratos por Diferencia)

Los CFDs tributan como ganancias y pérdidas patrimoniales, no como rendimientos del capital mobiliario. DeclaRenta detecta CFDs en eToro por el campo `leverage > 1`, el tipo `"CFD"`, o un tipo de materias primas (`"Commodity"`, `"Materias primas"`) o de divisas (`"Currencies"`, `"Divisas"`), que en eToro son siempre CFDs. Se soportan acciones, índices, materias primas y divisas como CFDs. Las posiciones de criptomonedas no se importan y se avisa de ellas.

Cada CFD es un contrato propio, no un valor homogéneo con las acciones de su ISIN. DeclaRenta calcula el resultado de cada CFD de eToro solo con su apertura y su cierre. No lo mezcla con las acciones ni con otros CFDs en el FIFO.

Las posiciones cortas en CFDs se soportan: si vendes primero sin lotes previos, DeclaRenta registra un coste base de 0 EUR y emite un aviso.

La regla anti-churning no se aplica a CFDs. Los CFDs de criptomonedas no están soportados actualmente.

## Referencia legal

DeclaRenta implementa las siguientes normas de la legislación fiscal española:

| Norma | Descripción |
|---|---|
| Art. 25.1.a LIRPF | Rendimientos del capital mobiliario: dividendos y participaciones en beneficios de entidades. |
| Art. 25.2 LIRPF | Rendimientos del capital mobiliario: intereses de cuentas, depósitos y activos financieros. |
| Art. 26.1.a LIRPF | Gastos deducibles de los rendimientos del capital mobiliario (gastos de administración y custodia). |
| Art. 33.5.f/g LIRPF | Norma anti-churning: no se computa la parte proporcional de la pérdida por venta de valores si se recompran homogéneos en 2 meses (mercado regulado del Espacio Económico Europeo o mercado de un tercer país declarado equivalente, como NYSE o Nasdaq: DGT V0778-25) o 1 año (en ningún mercado de esos: no cotizados, solo OTC, o solo en una bolsa de un tercer país sin equivalencia, como Londres desde 2021 o SIX). La pérdida bloqueada se difiere y se integra, primero la más antigua, a medida que se venden acciones del mismo valor que ninguna recompra en su plazo cubre (transmisión definitiva). |
| Art. 33.5.e LIRPF | Criptomonedas: la pérdida no se computa si se recompra la misma criptomoneda en el año siguiente a la venta; las compras anteriores no cuentan. Las criptomonedas no son valores (DGT V0525-25), así que no les alcanzan las letras f y g. |
| Art. 35 LIRPF | Transmisiones onerosas: valor de transmisión y valor de adquisición de elementos patrimoniales. |
| Art. 37.2 LIRPF | Método FIFO obligatorio para valores homogéneos: las primeras adquiridas se consideran las primeras transmitidas. |
| Art. 46 LIRPF | Base del ahorro: ganancias y pérdidas patrimoniales derivadas de transmisión de elementos patrimoniales. |
| Art. 49 LIRPF | Compensación de pérdidas patrimoniales: arrastre 4 años, compensación cruzada con límite del 25%. |
| Art. 80 LIRPF | Deducción por doble imposición internacional: menor entre impuesto pagado en origen y cuota española. |
| Ley 46/1998 art. 36 | Tipos de cambio: el cambio oficial del euro frente a otras divisas es el que publica el Banco Central Europeo. |
| Ley 7/2024 | Introduce el tramo del 30% en la base del ahorro para rentas superiores a 300.000 EUR. |
| RD 1065/2007 | Reglamento general de gestión e inspección tributaria. Regula la obligación de informar sobre bienes en el extranjero (Modelo 720). |
| Orden EHA/3290/2008 | Regula la declaración de inversiones españolas en el exterior (Modelo D-6). |
| Ley 19/1991 | Impuesto sobre el Patrimonio. Relevante para la valoración de activos en el extranjero. |

LIRPF = Ley 35/2006, de 28 de noviembre, del Impuesto sobre la Renta de las Personas Físicas. LGT = Ley 58/2003, General Tributaria.
