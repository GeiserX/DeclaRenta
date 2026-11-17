# Traza del motor de divisas (FX)

Para auditar o depurar cómo se construye una cifra de divisa (casillas 1633/1637), DeclaRenta puede emitir una **traza completa de los movimientos internos del motor FX**: el libro mayor `acquire → park → unpark → discard → profit → dispose`, con el saldo del *pool* gastable y del principal aparcado tras cada paso. Permite reconstruir lote a lote, con tus propios datos, cómo se llegó a cada importe. Es una herramienta para usuarios avanzados y asesores; disponible desde la v0.52.0.

Está **desactivada por defecto** y nunca aparece en la interfaz normal (coste cero cuando está apagada).

## En la web (modo diagnóstico)

El modo diagnóstico se activa de dos formas:

- Añadiendo `#debug` a la URL: **`https://declarenta.com/#debug`**
- O, de forma persistente, en la consola del navegador: `localStorage.declarenta_debug = "1"` y recargar.

**El orden importa:** la traza solo se calcula si el modo diagnóstico está activo *al generar* el informe. Receta fiable:

1. Entra directamente en `https://declarenta.com/#debug`.
2. Sube tus ficheros y genera el informe.
3. Pulsa **«Descargar traza de cálculo FX (diagnóstico)»** → se descarga `declarenta_fxtrace_<año>.csv`.

> Con el método «Tradicional sin divisa (monodivisa)», o si no hay movimientos de divisa, el botón avisa de que «no hay movimientos FX que trazar».

## En la CLI

```bash
# Traza a un fichero, en CSV
node dist/cli.js convert --input flex_query.xml --year 2025 --fx-trace traza.csv --fx-trace-format csv

# Traza a stderr (sin ruta), en JSONL (por defecto)
node dist/cli.js convert --input flex_query.xml --year 2025 --fx-trace
```

- `--fx-trace [fichero]` — sin valor vuelca a *stderr*; con una ruta, escribe el fichero (nunca contamina la salida estándar del informe).
- `--fx-trace-format jsonl|csv` — `jsonl` (por defecto: una línea JSON por evento, ideal para máquinas/tests) o `csv` (tabla legible).

## Formato de la traza

Cada fila es un movimiento del motor, con estas columnas:

| Columna | Significado |
|---|---|
| `seq` | Número de orden del movimiento |
| `date` | Fecha del evento |
| `kind` | Tipo de movimiento (ver abajo) |
| `currency` | Divisa (p. ej. USD) |
| `trigger` | Origen del movimiento (conversión, dividendo, interés, compra/venta de valor…) |
| `quantityFcy` | Cantidad de divisa movida |
| `rate` | Tipo de cambio aplicado (EUR por 1 unidad de divisa) |
| `costBasisEur` | Valor de adquisición en EUR |
| `proceedsEur` | Valor de transmisión en EUR |
| `gainLossEur` | Ganancia/pérdida FX realizada (solo en `dispose`) |
| `poolBalanceFcy` | Saldo de divisa «gastable» tras el movimiento |
| `parkedBalanceFcy` | Saldo de principal aparcado (en posiciones aún abiertas) |
| `positionKey` | Posición a la que pertenece el principal aparcado |
| `lotId` | Lote afectado. En `acquire`, `unpark` y `profit` es el lote **creado**; en `park` y `dispose`, el lote **consumido** (`UNKNOWN` = sin lote previo suficiente → ganancia FX forzada a 0). Vacío en `discard` y en un `park` que no sale de un lote de la *pool* (sin origen rastreado, o de un lote manual). **Es un contador de orden de creación, compartido entre divisas — NO indica el orden FIFO.** |
| `lotAcquireDate` | Fecha de adquisición del lote de `lotId`. En `unpark` es la fecha original que conserva el principal (la de la venta si no había compra rastreada); en `profit`, la de la venta; en el `park` de un lote manual, la de ese lote. **Esta es la prueba del FIFO:** en `dispose` consecutivos de una misma divisa es no decreciente (se consume siempre el dólar más antiguo primero). |
| `note` | Aclaración del movimiento |
| `brokerSource` | Broker del fichero del que sale el movimiento (vacío si no consta) |

> **Por qué `lotId` (FX-N) no va en orden ascendente:** el número de lote se asigna al **crearse** el lote y es único para todas las divisas. Cuando vendes un valor en divisa, su principal vuelve a la *pool* conservando su **fecha de adquisición original** (antigua) pero con un número de lote **nuevo** (distinto, no necesariamente mayor), e insertado en su posición por fecha — así que una conversión puede consumir `FX-5` antes que `FX-2` si `FX-5` es más antiguo por fecha. Eso es FIFO correcto. La columna que hay que mirar para verificarlo es **`lotAcquireDate`**, no `lotId`.
>
> **Para ver dónde nació un lote**, busca la fila `acquire`, `unpark` o `profit` con el mismo `lotId`: cada lote que consume un `dispose` o un `park` aparece antes en una de ellas, con la misma divisa y la misma `lotAcquireDate`. Un principal re-añadido en `unpark` lleva número nuevo, así que su `park` de origen no se encuentra por `lotId`. Búscalo entre los `park` de la misma divisa y `positionKey`: las ventas devuelven los tramos aparcados de una posición en el mismo orden en que se aparcaron (el primero aparcado es el primero devuelto), y un `park` puede repartirse entre varios `unpark` o al revés, así que empareja por ese orden y por `quantityFcy`. `positionKey` y `lotAcquireDate` no bastan: dos lotes de la misma fecha aparcados en la misma posición dan dos `park` con los mismos valores.

Tipos de movimiento (`kind`):

| `kind` | Qué representa |
|---|---|
| `acquire` | Entra divisa al *pool* (conversión EUR→divisa, dividendo o interés recibido) |
| `dispose` | Sale divisa y se **realiza** la ganancia/pérdida FX (conversión divisa→EUR). También la divisa de unas acciones vendidas en otra moneda (`trigger` = `stock_sale_cross`, ver abajo). Con «Tradicional con divisa», también la divisa perdida en una venta con pérdidas (`trigger` = `stock_sale`) |
| `park` | Una compra de valor en divisa consume divisa del *pool* y aparca su coste de adquisición |
| `unpark` | Una venta re-añade al *pool* el principal aparcado, a su coste original. Con «Tradicional con divisa», a su coste original más la variación ya declarada en la acción (ver abajo) |
| `discard` | Principal perdido en una venta con minusvalía (esa divisa nunca se convirtió a EUR). Con «Tradicional con divisa», solo el que no tiene variación que declarar (sin origen rastreado o con ganancia 0). También la divisa que devuelve la venta de acciones compradas ese mismo día sin divisa, y la divisa de una venta posterior de ese día que paga lo que esa venta no devolvió (nota `compraventa del mismo día sin divisa`, ver «Cobertura tardía») |
| `profit` | El beneficio de una venta entra como divisa nueva, al tipo de la fecha de venta |

**Fechas y orden.** Cada movimiento de divisa va en su **fecha de operación**: conversiones, compras y ventas de valores. Los dividendos, intereses, comisiones y retenciones van en la fecha en que se cargan o abonan, no en su fecha de liquidación. Dentro de un mismo día, primero entra la divisa, después van las compras y ventas de valores y al final sale la divisa. Entre las compras y ventas del día, primero van las ventas de valores que no se compraron ese día. La venta de acciones que ya tenías antes de ese día también va con las primeras, aunque vuelvas a comprar el mismo valor ese día: la recompra usa la divisa que devuelve la venta. Después va cada compraventa del mismo valor en el día (primero la compra, luego la venta de las acciones compradas ese día). Al final van las compras de valores que no se vendieron ese día. La hora de cada operación no cuenta: todas las del día se liquidan juntas. Vale para los dos métodos que calculan la divisa. Con la fecha de liquidación, un cambio y una compra de acciones del mismo día (acciones en T+1, divisa en T+2) dejarían en el *pool* dólares que ya no existen.

**Cobertura tardía (7 días).** Si compras acciones sin divisa en la cuenta y recibes esa divisa **de 1 a 7 días naturales después** (un cambio de euros, un dividendo o unos intereses), esa entrada cubre la compra. La parte que cubre se adelanta al día de la compra, con su propio tipo y su propia fecha. En la traza es una fila `acquire` con la nota `cobertura tardía`. El cálculo es el mismo que si la divisa hubiera llegado antes de la compra, aunque vendas parte de las acciones antes de recibirla. Si compras y vendes acciones el mismo día sin divisa en la cuenta, la cuenta queda en negativo durante el día. La venta devuelve primero esa divisa: sale sin diferencia de cambio y sin lote en el *pool* (fila `discard` con la nota `compraventa del mismo día sin divisa`), y solo el beneficio entra en el *pool*. Así la compraventa no deja en el *pool* dólares que no existen, y no anula la cobertura tardía de otra compra. Si la venta da pérdidas y no devuelve toda la divisa que faltó, la cuenta sigue en negativo: la próxima divisa que devuelva una venta ese mismo día paga primero esa deuda (otra fila `discard` con la misma nota, al coste de esa divisa; con «Tradicional con divisa», una fila de divisa perdida si ese coste no es el tipo de la compra). Así da igual en qué orden aparecen en tu archivo las compraventas del día. Lo que siga sin pagar al acabar el día es principal perdido sin origen rastreado, y «Tradicional con divisa» lo avisa con `fx_traditional_uncovered`. Si la compra usó divisa que ya tenías y no está en tus archivos, esa divisa sigue sin lote: un cambio posterior a euros la avisa con `fx.missing_prior_lots`, igual que sin la compraventa. La divisa que devuelve la venta de acciones compradas ese mismo día también cubre las compras sin divisa de ese día que ya se procesaron, en el orden en que se hicieron (fila `park` con la nota `cobertura del mismo día`). La entrada cubre primero la compra sin divisa, aunque sin cobertura hubiera pagado una compra posterior. Esa compra posterior, sin divisa ahora, la cubre a su vez su propia entrada de 1 a 7 días después, y así sucesivamente, por larga que sea la cadena. Una cobertura nunca puede dejar sin lotes una salida posterior ni dejar sin origen otra compra. Si eso pasa, la compra se pagó con divisa que ya tenías y no está en tus archivos, y esa cobertura no se aplica. Las demás sí. Cada cobertura se juzga con todos los datos que subes, también los de años posteriores. Así, una compra del 29 de diciembre cubierta con un cambio del 2 de enero se juzga con los datos del año siguiente. Hay una excepción. Si la cobertura solo falla por datos de un año posterior al de la compra y al de la entrada, y quitarla cambiaría las cifras de un año anterior a ese, la cobertura se mantiene: un año ya declarado no cambia por datos de un año posterior. El año en que falla lo avisa con `fx.missing_prior_lots` (con «Tradicional con divisa», también con `fx_traditional_uncovered`). Una compra que nadie cubre conserva el camino de «sin origen rastreado». Con «Tradicional con divisa», el informe avisa con `fx_traditional_uncovered`, pero solo cuando una venta devuelve esa divisa, y lo hace en el año de la venta. Mientras conservas las acciones, el aviso todavía no sale. Por eso, que no haya aviso no prueba que la compra estuviera cubierta: búscala en la traza, en las filas `park` con la nota `uncovered`. Vale para los dos métodos que calculan la divisa.

**Acciones vendidas en otra moneda.** Si compras un valor en una moneda y lo vendes en otra (el mismo ISIN en otra bolsa), la divisa de la compra no vuelve. Una fila `dispose` con `trigger` = `stock_sale_cross` declara su variación desde que compraste la divisa hasta que compraste las acciones (transmisión = cantidad × tipo del día de compra de las acciones, adquisición = cantidad × coste del lote), también en una venta con pérdidas. Si la venta es en otra divisa, esa divisa entra nueva al tipo del día de la venta (fila `profit`). Ejemplo: cambias 800 € por 1000 USD, compras a 0,90 €/USD y vendes por 1000 €: 100 € en la acción y 100 € en la divisa. Vale para los dos métodos que calculan la divisa.

## Con el método «Tradicional con divisa»

La traza usa los mismos tipos de movimiento y las mismas fechas, con estas diferencias:

- **`unpark` con coste desplazado.** La divisa que devuelve una venta cuesta lo que costó más la variación ya declarada en la acción. La nota lo dice en dos partes, por ejemplo `coste = 0.9 €/USD (coste de la divisa) + -0.1 €/USD (variación ya declarada en la acción)`. La segunda parte es tipo de venta − tipo de compra de las acciones. En la conversión que consume ese lote, el `dispose` lleva en `costBasisEur` las dos partes juntas.
- **Divisa perdida.** En una venta con pérdidas, la divisa que no vuelve sale de tu cuenta. Una fila `dispose` con `trigger` = `stock_sale` declara su variación desde que compraste la divisa hasta que compraste las acciones: transmisión = cantidad × tipo del día de compra de las acciones, adquisición = cantidad × coste del lote. Las filas con ganancia 0 no se escriben. Si la comisión de la venta supera su importe bruto, no vuelve nada: toda la divisa invertida se pierde, y la comisión que sobra sale de tu cuenta como cualquier comisión (fila `dispose` con `trigger` = `commission`). Esto se aparta a propósito de la regla del método por defecto (venta con pérdidas = 0 en 1633/1637). La DGT trata así los fondos en divisa: la variación entre la compra de la divisa y la del fondo se imputa en el año del reembolso (V0775-21 3º, V2324-10).
- **Coste negativo.** Si el coste desplazado quedaría por debajo de 0, la variación hasta la compra se declara en la venta (fila `dispose` con `trigger` = `stock_sale_guard`) y la divisa vuelve al tipo de la venta. No es divisa perdida: la venta la devolvió. La nota dice `guarda de coste negativo`, y el informe lo explica con su propio aviso (`fx_traditional_guard`).
