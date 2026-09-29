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

> En modo monodivisa, o si no hay movimientos de divisa, el botón avisa de que «no hay movimientos FX que trazar».

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
| `lotId` | Identificador del lote consumido (`UNKNOWN` = sin lote previo suficiente → ganancia FX forzada a 0). **Es un contador de orden de creación, compartido entre divisas — NO indica el orden FIFO.** |
| `lotAcquireDate` | Fecha de adquisición original del lote consumido. **Esta es la prueba del FIFO:** en `dispose` consecutivos de una misma divisa es no decreciente (se consume siempre el dólar más antiguo primero). |
| `note` | Aclaración del movimiento |

> **Por qué `lotId` (FX-N) no va en orden ascendente:** el número de lote se asigna al **crearse** el lote y es único para todas las divisas. Cuando vendes un valor en divisa, su principal vuelve a la *pool* conservando su **fecha de adquisición original** (antigua) pero con un número de lote **nuevo** (distinto, no necesariamente mayor), e insertado en su posición por fecha — así que una conversión puede consumir `FX-5` antes que `FX-2` si `FX-5` es más antiguo por fecha. Eso es FIFO correcto. La columna que hay que mirar para verificarlo es **`lotAcquireDate`**, no `lotId`.

Tipos de movimiento (`kind`):

| `kind` | Qué representa |
|---|---|
| `acquire` | Entra divisa al *pool* (conversión EUR→divisa, dividendo o interés recibido) |
| `dispose` | Sale divisa y se **realiza** la ganancia/pérdida FX (conversión divisa→EUR) |
| `park` | Una compra de valor en divisa consume divisa del *pool* y aparca su coste de adquisición |
| `unpark` | Una venta re-añade al *pool* el principal aparcado, a su coste original |
| `discard` | Principal perdido en una venta con minusvalía (esa divisa nunca se convirtió a EUR) |
| `profit` | El beneficio de una venta entra como divisa nueva, al tipo de la fecha de venta |
