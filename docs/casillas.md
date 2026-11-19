# Casillas del Modelo 100

> Ejercicio 2025. Referencias legales actualizadas a Ley 7/2024.

## Base del ahorro — Ganancias y pérdidas patrimoniales

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **0328** | Valor de transmisión (acciones negociadas) | Σ (precio_venta × cantidad × multiplicador − comisión − impuestos) × tipo_ECB_venta | Art. 35.2 y 37.1.a LIRPF |
| **0331** | Valor de adquisición (acciones negociadas) | Σ (precio_compra × cantidad × multiplicador + comisión + impuestos) × tipo_ECB_compra, siguiendo FIFO sobre los lotes consumidos | Art. 35.1 LIRPF |

**Notas:**
- La casilla **0327** es un campo de texto (denominación de los valores), no un importe. Las opciones, criptomonedas y fondos no cotizados se declaran como «otros elementos patrimoniales» en las casillas **1633/1637**, no en 0328/0331.
- En valores en **moneda extranjera**, el valor de adquisición mostrado se calcula al tipo de cambio del BCE de la fecha de **venta** (no de compra), de modo que transmisión − adquisición coincide exactamente con la ganancia o pérdida (DGT **V2422-20**: la ganancia se calcula en la moneda del valor y solo la diferencia se convierte a euros). Por eso este importe puede diferir del coste histórico en euros de la fecha de compra.
- El motor FIFO (Art. 37.2 LIRPF) determina qué lotes se consumen al vender valores homogéneos.
- La regla anti-churning (Art. 33.5.f/g LIRPF) bloquea **solo la parte proporcional** de la pérdida correspondiente a la cantidad recomprada; el resto se computa ahora. La pérdida entera va dentro de la diferencia entre 0328 y 0331 (o entre 1633 y 1637); la parte bloqueada se difiere (no se pierde) y se reporta por separado hasta que la liberan las acciones vendidas después de forma definitiva (las que ninguna recompra en su plazo cubre).
- Los impuestos de transacción (STT, FTT, SEC fees) se incluyen en el coste de adquisición (compras) y se deducen del valor de transmisión (ventas).

## Base del ahorro — Ganancias por transmisión de moneda extranjera

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **1633** | Valor de transmisión (FX) | Σ cantidad_divisa_vendida × tipo_ECB_fecha_venta | Art. 33.1 LIRPF |
| **1637** | Valor de adquisición (FX) | Σ cantidad_divisa × tipo_ECB_fecha_adquisición, consumiendo lotes FIFO | Art. 33.1 LIRPF |

**Notas:**
- La divisa es un elemento patrimonial: la ganancia/pérdida es valor de transmisión − valor de adquisición (Art. **33.1** LIRPF), imputada en la conversión efectiva a euros (Art. 14.2.e). La divisa comparte el bloque «otros elementos patrimoniales» (casillas 1633/1637) con opciones, cripto y fondos no cotizados. La casilla 1626 es «Tipo de elemento patrimonial. Clave», y 1631 es la «Fecha de transmisión» — no son importes.
- Cada conversión EUR→FCY crea un lote en la cola FIFO de esa divisa, valorado por lo que realmente costó (Art. 35.1 LIRPF): el importe en euros que aplicó el bróker cuando el extracto lo da, y si no, el tipo BCE del día de la conversión. La transmisión se valora igual. La ley no fija en qué orden sale la divisa: aplicar FIFO es una inferencia por analogía con el Art. 37.2, que solo habla de valores.
- Cada conversión de la divisa (por ejemplo, USD→EUR) consume lotes por FIFO y realiza una ganancia o pérdida de divisa. Lo mismo ocurre con los intereses y comisiones que pagas en esa divisa.
- Un dividendo o unos intereses en divisa crean un lote por lo que de verdad recibiste. Si el bróker anula un abono y lo vuelve a hacer, cuenta una sola vez. Una anulación de otro día o de otro importe resta su cantidad de lo que cobras ese día; lo que sobra sale de la cuenta como una comisión.
- Cada movimiento de divisa va en su **fecha de operación**, no en la de liquidación: esa fecha da el tipo del BCE, el orden y el año. Un cambio que haces el 31 de diciembre y se liquida el 2 de enero va al año en que lo hiciste, al tipo del 31. La ganancia se imputa cuando hay alteración patrimonial (Art. 14.1.c LIRPF), al tipo vigente en el momento de la transmisión (V2422-20). La DGT sitúa el «cobro o pago» del Art. 14.2.e en el momento en que la conversión se realiza efectivamente (V0463-21, V1613-25). Es la misma fecha que usa la venta de las acciones. Así un cambio y una compra de acciones del mismo día van juntos, aunque las acciones se liquiden en un día (T+1) y la divisa en dos (T+2).
- Dentro de un mismo día entra primero la divisa (cambios, dividendos, intereses), después van las compras y ventas de valores y al final sale la divisa. Entre las compras y ventas del día, primero van las ventas de valores que no compraste ese día, así su divisa paga las compras del día. También va primero la venta de un valor que ya tenías y vuelves a comprar ese día: la recompra usa la divisa que devuelve la venta.
- Si compras valores sin divisa en la cuenta y cambias euros a esa divisa **de 1 a 7 días naturales después** (o te llega un dividendo o unos intereses en ella), esa entrada paga la compra, con su propio tipo. El resultado es el mismo que si la divisa hubiera llegado antes de la compra. Si la compra se pagó con divisa que ya tenías y que no está en tus archivos, la entrada posterior no la cubre: es dinero nuevo.
- Comprar valores en divisa no realiza nada. La divisa gastada queda apartada con su coste de origen y vuelve a la cola cuando vendes los valores.
- Si vendes en otra moneda unos valores que compraste en divisa (el mismo ISIN en otra bolsa), esa divisa no vuelve. Su variación desde que la compraste hasta que compraste los valores se declara en la venta, también si vendes con pérdidas: la casilla 0331 ya valora esos valores al tipo del día de compra. Ejemplo: cambias 800 € por 1000 USD, compras a 0,90 €/USD y vendes por 1000 €: 100 € en la acción y 100 € en la divisa. Si vendes en otra divisa, esa divisa entra nueva al tipo del día de la venta.
- Las conversiones automáticas del broker (AFx/FXCONV de IBKR) se procesan por defecto como cualquier otra conversión, porque IBKR no convierte a euros al vender y la divisa que tienes es real. Si tu broker sí la convierte en el acto, puedes excluirlas desmarcando «Procesar autoconversiones del bróker (AFx/FXCONV)» en el paso «Revisar y elegir método», o con `--skip-auto-convert` en la CLI.
- No existe umbral mínimo (de minimis) — toda conversión es declarable.
- La regla anti-churning (Art. 33.5.f/g) NO se aplica a divisas.

### Los tres métodos para acciones en divisa

Las notas de arriba describen el método por defecto. Puedes elegir otro en el paso «Revisar y elegir método», o con `--fx-method` en la CLI. Usa el mismo método todos los años.

| | «Criterio DGT (multidivisa)» (por defecto, recomendado) | «Tradicional con divisa» | «Tradicional sin divisa (monodivisa)» |
|---|---|---|---|
| **0331** de una acción en divisa | Al tipo del día de **venta** (V2422-20) | Al tipo del día de **compra** (Art. 35.1) | Al tipo del día de **compra** (Art. 35.1) |
| **0328 − 0331** | Ganancia en divisa pasada a euros al tipo de la venta | Incluye la variación de la divisa entre la compra y la venta | Igual que «Tradicional con divisa» |
| **1633/1637** | Cuando conviertes la divisa a euros, pagas comisiones o intereses en divisa | Cuando la divisa **sale de tu cuenta**: conversiones, comisiones, intereses pagados y divisa perdida en una venta con pérdidas | Nunca: no calcula ningún resultado de divisa |
| Coste de la divisa que devuelve una venta | Su coste de origen | Su coste de origen **más** la variación ya declarada en la acción | — |
| Venta con pérdidas sin conversión | 1633/1637 = 0 | Fila de divisa perdida en 1633/1637 ese año | 1633/1637 = 0 |

- En un ciclo completo (euros → divisa → acciones → divisa → euros) sin ventas con pérdidas, «Criterio DGT (multidivisa)» y «Tradicional con divisa» dan el mismo total, también si el mismo día vendes un valor que ya tenías y lo vuelves a comprar, y además cambias euros a divisa unos días después de una compra. También si compras y vendes valores el mismo día sin divisa propia. Si una compra gasta más divisa de la que tienes, la cuenta queda en negativo: es un descubierto o un préstamo de margen del bróker. Si subes el extracto de IBKR con la sección «Cash Report» y cuadra con tus operaciones, DeclaRenta lo trata como un préstamo en divisa, y los dos métodos dan también el mismo total (ver el punto sobre préstamos más abajo). Sin ese extracto, o con otro bróker, esa divisa se toma como divisa sin origen en tus archivos, y si la pagas con la venta de otras acciones en un día posterior, el total puede no cuadrar. Lo que cambia es en qué año y en qué casilla sale cada parte, y la deducción por doble imposición (casilla 0588) puede cambiar. Con ventas con pérdidas, «Tradicional con divisa» declara además la divisa perdida. «Tradicional sin divisa» no declara tus conversiones, así que su total puede ser muy distinto.
- «Tradicional con divisa» da en 0328/0331 exactamente las cifras de «Tradicional sin divisa» en todos los años. En 1633/1637, el coste de la divisa que devuelve una venta tiene dos partes: lo que te costó la divisa y la variación que ya declaraste en la acción. Así cada variación se declara una sola vez.
- «Tradicional con divisa» fecha, ordena y cubre la divisa como el método por defecto (fecha de operación; dentro de un mismo día, una venta libera su divisa antes de una compra de otro valor, sea cual sea la hora, y la venta de un valor que ya tenías va antes de su recompra de ese día; un cambio de euros a divisa **de 1 a 7 días naturales después** de comprar las acciones paga esa compra, salvo que se pagara con divisa que ya tenías y que no está en tus archivos).
- **Saldo negativo en divisa (préstamo del bróker).** DeclaRenta solo trata un saldo negativo como préstamo cuando el «Cash Report» de IBKR lo prueba: una sola cuenta y un solo bróker, con su número de cuenta, fechas reales y el saldo final escrito, un saldo inicial conocido y no negativo, y en cada periodo el saldo inicial más tus operaciones da el saldo final (con 1 unidad de margen). Además, cada movimiento de esa divisa tiene que ser uno que DeclaRenta lee: cambios, compras y ventas de acciones, fondos o bonos, dividendos, retenciones, intereses y comisiones. Un depósito, una retirada o una transferencia en esa divisa (aunque se compensen en el año), una retención sin dividendo ese día, un movimiento sin tipo del BCE, una opción, una posición corta (también la venta que la abre), otra cuenta (también una sin «Cash Report») o los cambios automáticos (AFx) que decides no contar lo impiden, y esa divisa sigue el camino de siempre. Los dos métodos llegan siempre a la misma decisión. El saldo inicial se gasta antes que cualquier otra divisa de tus archivos y antes de abrir ningún préstamo. Lo que falta se toma prestado al tipo del día. Las entradas siguientes (un cambio de euros, un dividendo, la venta de otras acciones) devuelven primero el préstamo, el más antiguo antes, y cada devolución declara en 1633/1637 cantidad × (tipo del día en que se abrió − coste de la divisa que lo paga). Los intereses que cobra el bróker mientras el saldo es negativo se suman al préstamo. Una cobertura tardía (1 a 7 días) va antes que el préstamo. Si compras y vendes el mismo día, la venta devuelve primero lo prestado, sin diferencia de cambio, como en una compraventa del mismo día sin divisa. Con el «Criterio DGT (multidivisa)», un préstamo devuelto el mismo día en que se abrió no declara nada: si una venta de parte de las acciones devuelve ese día otra divisa, esa divisa paga las acciones en lugar del préstamo y les da su coste. El informe lo explica con `fx_loan_repayment` y da la variación de la propia deuda (cantidad × (tipo de apertura − tipo del día de la devolución)) de todas las devoluciones del año, la ganancia y la pérdida por separado. Es la misma con los dos métodos, aunque con el «Criterio DGT (multidivisa)» parte de ella ya esté en el resultado de las acciones y no en 1633/1637. El Tribunal Supremo (STS 71/2021, ECLI:ES:TS:2021:345) lleva esa variación a la base general; la DGT, a la base del ahorro (V2414-12), como DeclaRenta. Si sigues al Supremo, declara la ganancia en la casilla 0304 y la pérdida en la 0305, y quítalas de 1633/1637: baja el valor de transmisión (1633) en la ganancia y súbelo en la pérdida. Eso solo vale para la parte que está en 1633/1637. Una devolución que declara una ganancia o una pérdida está siempre en 1633/1637. Si parte de la variación está en el resultado de las acciones (con el «Criterio DGT (multidivisa)», cuando la divisa prestada vuelve de las acciones y devuelve con diferencia de cambio 0 su propio préstamo u otro; otro, solo con la parte que sigue prestada: la de su préstamo que aún no ha pagado una devolución en 1633/1637 (con tu divisa, o con la divisa prestada de otras acciones y una ganancia o una pérdida), también si ya pagó otra parte), el aviso es `fx_loan_repayment_manual`: da la parte que está en 1633/1637 y te pide cuadrar el resto a mano, porque DeclaRenta no puede decir qué casilla corregir. Lo que la divisa prestada de un préstamo ya ha devuelto, con diferencia de cambio o sin ella, deja de contar en la parte de ese préstamo que sigue prestada.
- Hacienda aplica a las acciones el «Criterio DGT (multidivisa)» (V1740-17). En 2025 rechazó la valoración de «Tradicional con divisa» para un piso comprado y vendido en dólares (V1615-25). Ninguna consulta de la DGT respalda «Tradicional con divisa» para acciones: la DGT valora así las participaciones de **fondos** en divisa (V2324-10, V0775-21).
- Límites conocidos de «Tradicional con divisa»: un cambio de ISIN, una fusión o una escisión dejan la divisa aparcada en el valor antiguo (el informe avisa con `fx_traditional_orphan`); un dividendo en acciones (scrip) no aparca divisa; una baja de cotización sin venta no libera nada. Las opciones, las posiciones cortas y los tipos de movimiento de efectivo desconocidos quedan fuera de este método.

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
- El informe convierte a EUR con el tipo oficial del BCE (Ley 46/1998 art. 36) del día de pago que da el extracto. La regla de la DGT es el tipo vigente el día en que el cobro es exigible (V1024-11 para dividendos, V0463-21 para intereses). Normalmente coincide con el día de pago; si el bróker paga más tarde, los dos tipos pueden diferir.
- Los gastos genuinos de administración y depósito de valores negociables (cuando el bróker los detalla) sí son deducibles en la **Casilla 0037** (Art. 26.1.a LIRPF); la casilla 0027 recoge ingresos íntegros, nunca gastos.
- Las cuotas de suscripción del bróker (p. ej. planes de trading de tarifa plana) NO son «gastos de administración y depósito de valores negociables», por lo que no son deducibles.

## Deducciones

| Casilla | Concepto | Cómo calcula DeclaRenta | Referencia legal |
|---------|----------|------------------------|------------------|
| **0588** | Deducción por doble imposición internacional | Por país: min(retención_extranjera hasta el 15% del bruto, bruto_del_país × tipo_medio_del_ahorro) | Art. 80 LIRPF |

**Notas:**
- El tipo medio del ahorro es la cuota que dan los tramos del ahorro sobre toda tu base del ahorro, dividida entre esa base. Si la base es cero o negativa, se aplican los tramos al bruto de cada país.
- La retención extranjera solo cuenta hasta el 15% del bruto, el límite de la mayoría de los convenios con España. Lo retenido de más (por ejemplo, el 30% de EE.UU. sin W-8BEN) no se deduce aquí, se reclama en el país de origen.
- La deducción está limitada al impuesto que España hubiera cobrado sobre esa misma renta.
- La retención de cada dividendo es la suma, con su signo, de todas sus filas de retención: si el bróker la corrige (devolución parcial, o anulación y nueva retención en otra fecha), cuenta lo retenido al final. Por ejemplo, −1,50 USD y luego +0,50 USD es una retención de 1,00 USD. Ver [Correcciones de la retención](modelos-fiscales.md#correcciones-de-la-retencion).

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

- **Art. 33.5.f LIRPF** — valores **admitidos a negociación en un mercado regulado del Espacio Económico Europeo (la UE, Noruega, Islandia y Liechtenstein) o en un mercado de un tercer país declarado equivalente por la Comisión Europea**: ventana de **±2 meses** calendario (antes o después de la venta). Solo hay decisiones de equivalencia en vigor para Estados Unidos (NYSE, Nasdaq y las demás bolsas nacionales registradas en la SEC: Decisión de Ejecución (UE) 2017/2320), Australia (ASX y Chi-X Australia: 2017/2318) y Hong Kong (2017/2319). Una acción que solo cotiza en NYSE o Nasdaq también usa 2 meses (consulta vinculante DGT **V0778-25**). La decisión de Suiza caducó el 30/06/2019 y el Reino Unido no tiene ninguna.
- **Art. 33.5.g LIRPF** — valores **no admitidos en ninguno de esos mercados** (acciones no cotizadas, valores que solo se negocian en OTC Markets, acciones que solo cotizan en un tercer país sin decisión de equivalencia, como la Bolsa de Londres, SIX, Toronto o Tokio): ventana de **±1 año**.
- **Art. 33.5.e LIRPF** — **criptomonedas** (elementos patrimoniales que no son valores): solo cuenta la recompra de la misma criptomoneda **en el año siguiente** a la venta, de fecha a fecha (una venta del 01/06/2025 cuenta las compras hasta el 01/06/2026, ese día incluido). Las compras anteriores a la venta, o del mismo día, no cuentan.

La ley no nombra las criptomonedas. DeclaRenta les aplica la letra e porque la DGT dice que no son valores negociables ni «valores homogéneos» del art. 8 RIRPF (consultas vinculantes **V0648-24** y **V0525-25**), y porque aplica la letra e, «y no las letras f) y g)», a otro bien fungible que no es un valor: el dólar (**V1613-25**). La Orden HFP/310/2023 coloca las criptomonedas dentro de «otros elementos patrimoniales», y el Manual de Renta de la AEAT da a esos elementos «un año posterior a la transmisión». Ninguna consulta de la DGT, resolución del TEAC ni sentencia trata a la vez las criptomonedas y el artículo 33.5 de la LIRPF: es una deducción firme de esa doctrina, no un criterio confirmado.

En las criptomonedas, DeclaRenta cuenta como recompra cualquier compra de la misma criptomoneda (el mismo símbolo) en cualquier exchange o monedero, también la que recibes en una permuta de otra criptomoneda (DGT **V1149-18**). Otra criptomoneda, o un token envuelto (WBTC frente a BTC), es otro elemento. Si recompras solo una parte, se bloquea la parte proporcional. Las recompensas de staking, los airdrops y las demás criptomonedas que recibes sin comprarlas no cuentan como recompra: ninguna fuente lo resuelve, y es la lectura menos estricta. Todo lo que el fichero marca como criptomoneda usa la letra e: un token que fuera un valor negociable seguiría las letras f o g, y el fichero no permite distinguirlo. La pérdida diferida se libera con la misma prueba de transmisión definitiva que en los valores. La letra e solo dice que «se integrará cuando se produzca la posterior transmisión del elemento patrimonial», y no aclara si esa transmisión es cualquier venta posterior de la criptomoneda o la venta de las unidades recompradas. Esta prueba nunca libera la pérdida antes que la lectura «cualquier venta posterior la libera». Pero puede liberarla antes de que vendas las unidades recompradas: si vendes otras unidades, compradas antes, y ninguna recompra de su plazo las cubre, la pérdida se libera aunque sigas teniendo las recompradas. Es un punto abierto.

DeclaRenta no sabe en qué mercado está admitido cada valor: aplica 2 meses a toda acción, fondo o bono con ISIN, 1 año antes o después a lo que no tiene ISIN, y solo el año siguiente a la venta a las criptomonedas (art. 33.5.e, issue #457). Esto se aparta de la ley en un caso. Si tu valor tiene ISIN pero no está admitido en ningún mercado regulado ni equivalente (por ejemplo, solo se negocia en OTC Markets, la Bolsa de Londres, SIX o Toronto), la ley da 1 año y DeclaRenta aplica 2 meses (issue #452).

La pérdida bloqueada **se difiere, no se pierde**: «las pérdidas patrimoniales se integrarán a medida que se transmitan los valores o participaciones que permanezcan en el patrimonio del contribuyente». Queda **pendiente** hasta una **transmisión definitiva** del mismo valor. En cada venta posterior, con ganancia o con pérdida, solo son definitivas las acciones que ninguna recompra de valores homogéneos en sus 2 meses anteriores o posteriores (1 año en los valores del art. 33.5.g; en las criptomonedas, solo el año siguiente a la venta) cubre. Cada una de esas acciones libera la pérdida pendiente de una acción, empezando por la más antigua; las acciones recompradas mantienen diferida la pérdida. Si la venta deja la posición a cero y ninguna recompra de su plazo la cubre, se libera todo lo pendiente (DGT **V3282-18**, **V2481-20**, **V0571-21**, **V1760-23**, **V0754-26**).

Solo se bloquea «la correspondiente a las acciones que se consideran recompradas», y una misma compra no puede bloquear varias pérdidas (lectura proporcional «por paquetes»): DGT **V0913-08**, **V2481-20** y **V3282-18**.

### Excepción de compra única

Las compras de los 2 meses **anteriores** a la venta no cuentan como recompra si fueron **una sola operación de compra** y al empezar ese plazo **no tenías acciones** de ese valor: «esta regla no resulta de aplicación cuando dentro del plazo de los dos meses anteriores a la transmisión sólo se hubiera efectuado una operación de compra y, además, al inicio de ese período no se tuvieran acciones o participaciones homogéneas» (DGT **V3282-18**, repetida en consultas posteriores; Manual práctico de Renta 2025 de la AEAT). Ejemplo: compras 100 acciones el 01/03, no tenías ninguna antes y vendes 50 con 100 € de pérdida el 15/03. Si no compras más en los 2 meses siguientes, los 100 € se imputan ese año.

Cómo la aplica DeclaRenta:

- **Solo levanta la regla de las compras anteriores.** Una compra en los 2 meses **posteriores** a la venta sigue bloqueando la pérdida (V3282-18: «sin perjuicio de que las recompras efectuadas en el plazo de los dos meses posteriores a la transmisión impidan también la imputación»).
- **Solo en el plazo de 2 meses** (art. 33.5.f). La doctrina la formula para ese plazo; no hay doctrina que la extienda al de 1 año, así que DeclaRenta no la aplica a los valores sin ISIN ni a las criptomonedas.
- **Una operación de compra es una orden en un día.** Las ejecuciones parciales de una misma orden cuentan como una compra (IBKR las agrupa por número de orden; DEGIRO y Flatex les dan el mismo «ID Orden»). Dos órdenes, aunque sean del mismo día, son dos compras. Una compra el mismo día de la venta cuenta como otra compra, porque sin hora no se sabe si fue antes o después.
- **«Al inicio de ese período»** es el primer día del plazo: si ese día tenías acciones, aunque las vendieras después dentro del plazo, la excepción no se aplica. Cuentan las acciones de todos los ficheros subidos (también de otros brókers), los lotes de apertura que añadas y las que llegan sin compra (dividendo en acciones, fusión, escisión). Una venta en corto no son acciones que tengas: un corto abierto y cerrado antes del plazo no impide la excepción.
- **Solo se aplica si tus ficheros demuestran que no tenías acciones.** La fecha inicial de un fichero no dice nada de las acciones que compraste antes, en ese bróker o en otro. Por eso DeclaRenta exige tres cosas; si falta alguna, no aplica la excepción y avisa:
    - Los ficheros llegan al inicio del plazo: el plazo no empieza antes de la fecha inicial del fichero (o de su primera operación, si no la indica), ni antes de la de cualquier bróker que opere ese valor.
    - Ninguna venta se lleva más acciones de las que muestran los ficheros.
    - Cada bróker que opera ese valor incluye sus posiciones a fin de periodo (en IBKR, la sección **Open Positions** de la Flex Query), y esas posiciones son justo las que dejan sus operaciones y tus lotes de apertura. Si un bróker tiene más acciones de las que explican sus operaciones, las compraste antes de los ficheros. Las acciones que pasaste de un bróker subido a otro se compensan.

    Un fichero que solo incluye operaciones, como los CSV de DEGIRO o Trade Republic, no lista posiciones (Revolut las calcula con sus propias operaciones, así que no sirven): con él DeclaRenta no aplica la excepción y te avisa.
- Cuando la aplica, DeclaRenta lo avisa. Si al empezar el plazo tenías acciones de ese valor en un bróker o cuenta que no has subido, o las traspasaste después a otra entidad, la excepción no vale y esa pérdida queda bloqueada.
- La misma excepción decide si una venta es una **transmisión definitiva** (V3282-18: «deberán observarse los mismos criterios»): una venta cuya única compra anterior en el plazo cumple la excepción libera las pérdidas pendientes.

**Ejemplo.** Vender 100 acciones con una pérdida de 1.000 € y recomprar 30 dentro de los 2 meses:
- Se difieren **300 €** (la pérdida correspondiente a 30 acciones).
- Se imputan **700 €** ahora (la pérdida de las 70 acciones no recompradas).
- Cuando vendas 30 acciones de ese valor sin recomprar en el plazo, se integran los **300 €** diferidos. Si en sus 2 meses anteriores o posteriores recompras, por ejemplo, 10 acciones, solo 20 son definitivas: se integran **200 €** y los otros **100 €** siguen diferidos.

**Reintegración.** Si se suben los ficheros de varios años juntos, la reintegración de la pérdida diferida es **automática** (el motor procesa todas las operaciones en un único recorrido cronológico). En declaraciones de un solo año por separado, la pérdida diferida debe seguirse **manualmente** (limitación documentada). Si el plazo de recompra de una venta termina después de la última fecha que cubren los ficheros subidos, DeclaRenta lo avisa: no ve las compras posteriores, que podrían bloquear parte de esa pérdida o hacer que la venta no sea definitiva. Sube también el fichero del año siguiente y calcula de nuevo. Con varios brókers, cada valor se compara con los ficheros de los brókers donde lo operas: cuenta el que termina antes. Si el plazo termina después del 30 de junio del año siguiente, último día para presentar la declaración (por ejemplo, el año de una criptomoneda vendida en julio), seguirá abierto cuando presentes: si compras el mismo valor antes de que termine, corrige la declaración presentada con una autoliquidación rectificativa.

### Ventana de dos meses

La ventana se calcula en meses naturales (no en días). Si vendes el 15 de marzo con pérdida:

- Ventana anterior: desde el 15 de enero.
- Ventana posterior: hasta el 15 de mayo.
- Si has recomprado valores homogéneos dentro de la ventana aplicable, la pérdida puede quedar **bloqueada**. Para los valores no admitidos en un mercado regulado ni equivalente (art. 33.5.g) se usa la ventana de 1 año antes o después; para las criptomonedas, solo el año siguiente a la venta (art. 33.5.e).

### Qué hacer en Renta Web

En Renta Web esto **requiere acción**: no es automático. Por el importe bloqueado debes marcar la casilla **«Pérdidas patrimoniales no imputables»**; y en el ejercicio de la transmisión definitiva que la libera, debes imputar entonces la pérdida diferida. DeclaRenta marca en la tabla de operaciones qué venta libera pérdidas pendientes y de qué ventas proceden.

!!! warning "Si declaraste con la versión 0.66.13 o anterior"

    La versión 0.66.5 y las anteriores liberaban una pérdida al vender las acciones recompradas aunque esa venta volviera a tener recompra en su plazo. Si ya dedujiste esa pérdida en un año presentado, no la deduzcas otra vez cuando DeclaRenta la libere ahora en un año posterior, o corrige aquel año: con una autoliquidación rectificativa si es 2024 o posterior, o con una autoliquidación complementaria si es 2023 o anterior. Ejemplo: con el caso de la issue #451, la 0.66.5 dedujo 20 € en 2025; la versión actual los mantiene diferidos y libera 25 € en 2026 en lugar de 5 €.

    También puede pasar al revés: la versión actual puede liberar una pérdida en un año anterior al que la liberaba la 0.66.5 (por ejemplo, cuando una venta definitiva vende lotes antiguos, DGT **V0046-20**). Si ese año ya está presentado, puedes corregirlo para deducirla: con una autoliquidación rectificativa si es 2024 o posterior, o con una solicitud de rectificación de la autoliquidación si es 2023 o anterior. Si no lo corriges, esa pérdida no se deduce nunca.

    La versión 0.66.13 y las anteriores no aplicaban la excepción de compra única (issue #453): bloqueaban la pérdida de una venta cuya única compra en los 2 meses anteriores se hizo sin tener acciones antes. Si presentaste un año con esa pérdida bloqueada, puedes corregirlo para deducirla: con una autoliquidación rectificativa si es 2024 o posterior, o con una solicitud de rectificación de la autoliquidación si es 2023 o anterior.

    La versión 0.66.13 y las anteriores tampoco elegían las recompras en el orden de la DGT (issue #454): tomaban primero las compras posteriores a la venta y después las anteriores, de la más reciente a la más antigua. Por eso podían liberar una pérdida antes de tiempo (con los datos de la consulta DGT **V0248-18** liberaban 400 € en 2017; la DGT no libera nada ese año) o bloquear una pérdida que ya podías deducir. Si un año que ya presentaste cambia ahora, corrígelo: con una autoliquidación rectificativa si es 2024 o posterior; si es 2023 o anterior, con una autoliquidación complementaria si sale a ingresar o con una solicitud de rectificación si sale a devolver.

    La versión 0.66.13 y las anteriores tampoco contaban bien una compra hecha el mismo día de la venta (issue #454). Para la DGT es una recompra (consulta **V0571-21**), y ahora DeclaRenta la cuenta por las acciones que te quedan de ella. Una pérdida vendida y recomprada el mismo día podía deducirse con la 0.66.13, aunque la ley la difiere. Ejemplo: compras 100 acciones el 01/12/2024, las vendes el 10/03/2025 con 100 € de pérdida y ese día compras 50. La 0.66.13 deducía los 100 €; la versión actual bloquea 50 € y deduce 50 €. También puede cambiar si una venta posterior es definitiva. Si un año que ya presentaste cambia ahora, corrígelo: con una autoliquidación rectificativa si es 2024 o posterior; si es 2023 o anterior, con una autoliquidación complementaria si sale a ingresar o con una solicitud de rectificación si sale a devolver.

    Desde el ejercicio 2024, la autoliquidación rectificativa es el único procedimiento para corregir una declaración de IRPF, tanto si el resultado sale a ingresar como a devolver. La complementaria y la solicitud de rectificación solo siguen para 2023 y años anteriores (Manual práctico de Renta 2025 de la AEAT, «Regularización de situaciones tributarias: la autoliquidación rectificativa»).

!!! warning "Criptomonedas: si declaraste con la versión 0.66.13 o anterior"

    Esas versiones daban a las criptomonedas el plazo de los valores no cotizados: 1 año antes o después de la venta. Una compra anterior a una venta con pérdida podía bloquear esa pérdida. La versión actual no cuenta esas compras (art. 33.5.e, issue #457). Por eso deduce la pérdida en el año de la venta, o la libera antes, y ningún año posterior la vuelve a liberar.

    Si DeclaRenta deduce o libera ahora una pérdida de criptomonedas en un año que ya presentaste, corrige aquel año para deducirla: con una autoliquidación rectificativa si es 2024 o posterior, o con una solicitud de rectificación de la autoliquidación si es 2023 o anterior. Si no lo corriges, esa pérdida no se deduce nunca. Si ya la dedujiste en un año posterior, porque la versión anterior la liberó allí, corrige también ese año para quitarla (autoliquidación rectificativa si es 2024 o posterior, autoliquidación complementaria si es 2023 o anterior): no la deduzcas dos veces.

    Ejemplo: compras 1 BTC el 01/12/2024 por 200 €, otro el 01/03/2025 por 100 € y vendes 1 el 01/06/2025 por 100 €. La 0.66.13 bloqueaba los 100 € de pérdida en 2025 y los liberaba al vender el otro BTC. La versión actual deduce los 100 € en 2025 y no libera nada después.

### Cómo lo detecta DeclaRenta

El motor de anti-churning recorre todas las operaciones en orden cronológico y, para cada valor homogéneo:

1. Identifica las ventas con pérdida (`gainLossEur < 0`).
2. Para cada día de venta, suma la cantidad de valores homogéneos recomprados dentro de la ventana aplicable (2 meses para los valores con ISIN y 1 año para los valores sin ISIN, antes o después de la venta; para las criptomonedas, solo el año siguiente a la venta). Toma las compras en el orden de la DGT: primero la más antigua que ninguna venta anterior haya usado, así que las compras anteriores a la venta van antes que las posteriores (DGT **V3282-18**, **V0248-18**, **V1760-23**). Una compra anterior solo cuenta por las acciones que sigues teniendo después de la venta. El resto del lote que vende la propia venta se usa el último, después de las compras posteriores. Las compras anteriores no cuentan si se cumple la excepción de compra única (ver arriba).
3. Bloquea la pérdida de forma **proporcional**: `pérdida bloqueada = |pérdida| × cantidad recomprada / cantidad vendida`. La parte restante se computa ahora. Si una venta consume varios lotes FIFO, las acciones recompradas son las últimas adquiridas: la parte deducible es la de las acciones adquiridas en primer lugar (DGT **V0913-08**, **V1294-22**), y un lote con pérdida queda bloqueado antes que uno con ganancia.
4. La pérdida bloqueada queda **pendiente** en una cola por valor, contada en acciones (no se suma al coste de ninguna compra).
5. **Liberación:** en cada venta posterior del mismo valor, con ganancia o con pérdida, el motor descuenta las recompras de su plazo que ninguna venta anterior haya usado. Las acciones restantes son una transmisión definitiva y liberan, una por una, la pérdida pendiente más antigua. Si la venta deja la posición a cero y ninguna recompra de su plazo la cubre, se libera todo lo pendiente. El cierre de una posición corta (la compra que la cubre) no transmite acciones que tuvieras, así que no libera nada. La posición cuenta también las acciones que llegan sin compra (dividendo en acciones, fusión, escisión).
6. Las operaciones con pérdida bloqueada aparecen resaltadas en la tabla de resultados.

!!! warning

    La regla anti-churning se aplica a **valores homogéneos**, acciones (STK), fondos (FUND) y bonos (BOND), y a las **criptomonedas**. Los valores sin ISIN usan la **ventana de 1 año antes o después**; las criptomonedas, **solo el año siguiente a la venta** (art. 33.5.e); las acciones, fondos y bonos con ISIN, la de 2 meses (también los que solo cotizan en NYSE o Nasdaq, mercados equivalentes según la DGT **V0778-25**). **No se aplica** a opciones (OPT), futuros (FUT), CFDs ni forex (CASH).

## Tipo de cambio

DeclaRenta usa exclusivamente los **tipos de cambio diarios del BCE** (European Central Bank), publicados a las 16:00 CET cada día TARGET. Para fines de semana y festivos, se utiliza el último tipo disponible (día hábil anterior).

**Base legal:** el art. 36 de la Ley 46/1998 fija como cambio oficial del euro frente a otras divisas el que publica el Banco Central Europeo. La DGT valora las rentas en divisa al tipo vigente en la fecha de la operación o del cobro (V1024-11, V0463-21, V2422-20).

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

Por eso una venta en un broker puede consumir acciones compradas en otro. La tabla de operaciones de los resultados, el anexo de operaciones y los PDF muestran el broker de compra y el de venta de cada línea cuando hay más de un broker; con uno solo, esas columnas no aparecen. En la tabla de resultados se puede ordenar por cada broker y el buscador encuentra también el nombre del broker. El CSV (`Broker_Venta`, `Broker_Compra`) y el JSON de la CLI (`broker_venta`, `broker_compra`) los incluyen también cuando hay un solo broker.

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
