<p align="center">
  <img src="docs/images/banner.png" alt="DeclaRenta banner" width="100%"/>
</p>

<h1 align="center">DeclaRenta</h1>

<p align="center">
  <strong>Herramienta fiscal gratuita para inversores con brokers internacionales.</strong>
</p>

<p align="center">
  <a href="https://declarenta.com"><img src="https://img.shields.io/badge/DeclaRenta-declarenta.com-DC2626?style=flat-square&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik02IDlDMiA5IDAgOCAwIDVWMUMxIDAgMiAxIDMgM1Y2QzMgOCA1IDggOCA4VjlaIi8+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xOCA5QzIyIDkgMjQgOCAyNCA1VjFDMjMgMCAyMiAxIDIxIDNWNkMyMSA4IDE5IDggMTYgOFY5WiIvPjxwYXRoIGZpbGw9IndoaXRlIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik01IDhDNSA3IDggNiAxMiA2QzE2IDYgMTkgNyAxOSA4VjE3QzE5IDIxIDE2IDIzIDEyIDIzQzcgMjMgNSAyMSA1IDE3Wk03IDEwSDExVjEzSDdaTTEzIDEwSDE3VjEzSDEzWiIvPjxyZWN0IHg9IjExIiB5PSIxMSIgd2lkdGg9IjIiIGhlaWdodD0iMSIgcng9Ii41IiBmaWxsPSJ3aGl0ZSIvPjxjaXJjbGUgY3g9IjEwIiBjeT0iMTkiIHI9Ii44IiBmaWxsPSJ3aGl0ZSIvPjxjaXJjbGUgY3g9IjE0IiBjeT0iMTkiIHI9Ii44IiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPgo=&logoColor=white" alt="DeclaRenta"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/blob/main/LICENSE"><img src="https://img.shields.io/github/license/GeiserX/DeclaRenta?style=flat-square&color=dc2626" alt="License"/></a>
  <a href="https://codecov.io/gh/GeiserX/DeclaRenta"><img src="https://img.shields.io/codecov/c/github/GeiserX/DeclaRenta?style=flat-square&color=f59e0b" alt="Codecov"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/actions"><img src="https://img.shields.io/github/actions/workflow/status/GeiserX/DeclaRenta/ci.yml?style=flat-square&label=CI" alt="CI"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/stargazers"><img src="https://img.shields.io/github/stars/GeiserX/DeclaRenta?style=flat-square&color=f59e0b" alt="Stars"/></a>
  <a href="https://github.com/GeiserX/awesome-spain#readme"><img src="https://img.shields.io/badge/listed%20on-awesome--spain-c60b1e?style=flat-square&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDIwIDE0Ij48cmVjdCB3aWR0aD0iMjAiIGhlaWdodD0iMTQiIGZpbGw9IiNjNjBiMWUiLz48cmVjdCB5PSIzLjUiIHdpZHRoPSIyMCIgaGVpZ2h0PSI3IiBmaWxsPSIjZmZjNDAwIi8+PC9zdmc+&labelColor=ffc400" alt="awesome-spain"/></a>
</p>

<p align="center">
  <a href="https://declarenta.com"><strong>declarenta.com</strong></a> — Úsalo gratis, sin registro
</p>

<p align="center">
  IBKR · Degiro · Flatex · Scalable Capital · eToro · Freedom24 · Trade Republic · Revolut · Lightyear · Coinbase · Binance · Kraken · Trading 212 → Modelo 100 · Modelo 720 · Modelo 721 · D-6
</p>

<p align="center">
  Self-hosted · Privacidad total · Tus datos no salen de tu equipo
</p>

---

## Despliegue rápido

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GeiserX/DeclaRenta)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/GeiserX/DeclaRenta)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/from?repoUrl=https://github.com/GeiserX/DeclaRenta)

DeclaRenta es una web estática (Vite) — funciona en cualquier hosting de archivos estáticos. También disponible como imagen Docker: `drumsergio/declarenta:web`.

---

## El problema

Si inviertes con un broker extranjero, hacer la renta es un infierno:

- **Renta Web no importa datos** de brokers extranjeros — todo manual
- **FIFO obligatorio** con tipos ECB oficiales (no los del broker)
- **Regla anti-churning** (2 meses cotizados / 1 año no cotizados) que nadie detecta automáticamente
- **Doble imposición** internacional que hay que calcular a mano
- **Modelo 720** obligatorio si tus activos en el extranjero superan 50.000 EUR
- **Modelo D-6** solo obligatorio si tu participación es ≥10% del capital o derechos de voto (Orden ICT/1408/2021)

DeclaRenta automatiza todo esto.

## Brokers soportados

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

## Interfaz web

La web incluye:

- **Wizard guiado**: subida de ficheros → revisión de datos → resultados con casillas detalladas
- **Guías por broker**: instrucciones paso a paso para obtener el informe de cada broker
- **Perfil fiscal**: NIF, nombre, CCAA y teléfono para generar 720/D-6 correctamente
- **Secciones dedicadas**: Modelo 100, Modelo 720, Modelo D-6 con navegación lateral
- **Gráficas interactivas**: distribución por activo, G/P mensual, composición de divisas, retenciones por país
- **Comparativa interanual**: guarda informes en localStorage y compara variaciones año a año
- **Detalle de casillas**: desplegable con explicación de cada casilla y su normativa
- **PWA instalable**: funciona offline tras la primera visita
- **Tema claro/oscuro**
- **5 idiomas**: español, inglés, catalán, euskera, gallego

## Inicio rápido

### Web (recomendado)

Visita [declarenta.com](https://declarenta.com) — arrastra tus ficheros y listo.

Soporta `.xml`, `.csv`, `.json` y `.xlsx`. Se pueden subir varios ficheros a la vez para FIFO cruzado entre brokers.

### Docker

```bash
# Web (nginx)
docker run -p 8080:80 drumsergio/declarenta:web

# CLI
docker run --rm -v $(pwd):/data drumsergio/declarenta convert --input /data/flex_query.xml --year 2025
```

### CLI

```bash
git clone https://github.com/GeiserX/DeclaRenta.git
cd DeclaRenta && npm install && npm run build

# Informe Modelo 100 (JSON a stdout)
node dist/cli.js convert --input flex_query.xml --year 2025

# Varios ficheros de distintos brokers
node dist/cli.js convert --input ibkr.xml --input degiro.csv --input etoro.xlsx --year 2025

# Exportar en CSV
node dist/cli.js convert --input flex_query.xml --year 2025 --format csv --output detalle.csv

# Exportar en PDF
node dist/cli.js convert --input flex_query.xml --year 2025 --format pdf --output informe.pdf

# Con compensación de pérdidas de años anteriores (Art. 49 LIRPF)
node dist/cli.js convert --input flex_query.xml --year 2025 --prior-losses perdidas.json

# Modelo 720
node dist/cli.js modelo720 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE"

# Modelo 720 con tipos A/M/C (comparando con declaración del año anterior)
node dist/cli.js modelo720 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE" --previous-720 720_2024.txt

# Modelo D-6 (guía AFORIX)
node dist/cli.js d6 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE"

# Modelo D-6 con detección de bajas (comparando con año anterior)
node dist/cli.js d6 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE" --previous-d6 d6_2024.json --format json
```

El broker se auto-detecta a partir del contenido del fichero. Se puede forzar con `--broker <nombre>`.

## Motor fiscal

- **FIFO estricto** con tipos de cambio ECB oficiales por fecha de operación
- **Todos los tipos de activo**: acciones, ETFs, opciones, futuros, forex, bonos, CFDs y criptomonedas
- **Regla anti-churning** (Art. 33.5.f/g LIRPF): bloqueo **proporcional** de la pérdida si se recompra el mismo valor en 2 meses (cotizados en mercado regulado) o 1 año (no cotizados/cripto) — solo se difiere la parte correspondiente a la cantidad recomprada. La pérdida diferida no se suma al coste: se reintegra al transmitir los valores recomprados. Excluye derivados y forex
- **Doble imposición** (Art. 80 LIRPF): deducción por retenciones en origen, desglosado por país
- **Stock splits**: forward y reverse, con liquidación de fracciones (cash-in-lieu)
- **Corporate actions**: fusiones (transferencia de coste) y spin-offs (distribución proporcional)
- **Compensación de pérdidas** (Art. 49 LIRPF): ventana de 4 años con compensación cruzada del 25%
- **Validador Modelo 720**: verificación contra la especificación BOE del formato de registro

## Observabilidad: traza del motor de divisas (FX)

Para auditar o depurar cómo se construye una cifra de divisa (casillas 1633/1637), DeclaRenta puede emitir una **traza completa de los movimientos internos del motor FX**: el libro mayor `acquire → park → unpark → discard → profit → dispose`, con el saldo del *pool* gastable y del principal aparcado tras cada paso. Permite reconstruir lote a lote, con tus propios datos, cómo se llegó a cada importe. Es una herramienta para usuarios avanzados y asesores; disponible desde la v0.52.0.

Está **desactivada por defecto** y nunca aparece en la interfaz normal (coste cero cuando está apagada).

### En la web (modo diagnóstico)

El modo diagnóstico se activa de dos formas:

- Añadiendo `#debug` a la URL: **`https://declarenta.com/#debug`**
- O, de forma persistente, en la consola del navegador: `localStorage.declarenta_debug = "1"` y recargar.

**El orden importa:** la traza solo se calcula si el modo diagnóstico está activo *al generar* el informe. Receta fiable:

1. Entra directamente en `https://declarenta.com/#debug`.
2. Sube tus ficheros y genera el informe.
3. Pulsa **«Descargar traza de cálculo FX (diagnóstico)»** → se descarga `declarenta_fxtrace_<año>.csv`.

> En modo monodivisa, o si no hay movimientos de divisa, el botón avisa de que «no hay movimientos FX que trazar».

### En la CLI

```bash
# Traza a un fichero, en CSV
node dist/cli.js convert --input flex_query.xml --year 2025 --fx-trace traza.csv --fx-trace-format csv

# Traza a stderr (sin ruta), en JSONL (por defecto)
node dist/cli.js convert --input flex_query.xml --year 2025 --fx-trace
```

- `--fx-trace [fichero]` — sin valor vuelca a *stderr*; con una ruta, escribe el fichero (nunca contamina la salida estándar del informe).
- `--fx-trace-format jsonl|csv` — `jsonl` (por defecto: una línea JSON por evento, ideal para máquinas/tests) o `csv` (tabla legible).

### Formato de la traza

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

## Privacidad

- **Self-hosted**: los datos se procesan en tu equipo. La única conexión externa de la app es al API del BCE para tipos de cambio (datos públicos).
- Sin analytics, sin tracking, sin telemetría.
- La web guarda perfil fiscal y resúmenes interanuales en `localStorage` del navegador para evitar subir datos a servidores. Puedes borrarlos desde la comparativa interanual o limpiando los datos del sitio.
- La interfaz web muestra la versión y commit exacto desplegado — puedes verificar que coincide con el código fuente en GitHub.

## Desarrollo

```bash
git clone https://github.com/GeiserX/DeclaRenta.git
cd DeclaRenta
npm install

npm test              # Ejecuta la suite de tests
npm run dev           # Servidor web de desarrollo
npm run build         # Build completo (lib + web)
npm run lint          # ESLint
npm run typecheck     # TypeScript
node dist/cli.js convert --input test.xml --year 2025
```

## Comunidad y soporte

- [**GitHub Issues**](https://github.com/GeiserX/DeclaRenta/issues) — bugs, feature requests, preguntas técnicas (preferido)
- [**Telegram @declarenta**](https://t.me/declarenta) — canal de novedades y discusión

## Contribuir

Las contribuciones son bienvenidas. Áreas donde más ayuda se necesita:

- **Parsers de brokers**: XTB, MyInvestor
- **Reglas fiscales**: casos edge de FIFO, convenios de doble imposición por país
- **Tests**: más fixtures con operaciones reales anonimizadas
- **Traducciones**: las traducciones a catalán, euskera y gallego son automáticas — se necesita revisión por hablantes nativos

## Sponsor

Si DeclaRenta te ahorra tiempo (y dinero), considera apoyar el proyecto:

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-♥-ea4aaa?style=flat-square)](https://github.com/sponsors/GeiserX)
