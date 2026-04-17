<p align="center">
  <img src="docs/images/logo.png" alt="DeclaRenta logo" width="200"/>
</p>

<h1 align="center">DeclaRenta</h1>

<p align="center">
  <strong>Convierte reportes de brokers extranjeros en tu declaración de la renta española.</strong>
</p>

<p align="center">
  <a href="https://github.com/GeiserX/DeclaRenta/blob/main/LICENSE"><img src="https://img.shields.io/github/license/GeiserX/DeclaRenta?style=flat-square&color=dc2626" alt="License"/></a>
  <a href="https://codecov.io/gh/GeiserX/DeclaRenta"><img src="https://img.shields.io/codecov/c/github/GeiserX/DeclaRenta?style=flat-square&color=f59e0b" alt="Codecov"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/actions"><img src="https://img.shields.io/github/actions/workflow/status/GeiserX/DeclaRenta/ci.yml?style=flat-square&label=CI" alt="CI"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/stargazers"><img src="https://img.shields.io/github/stars/GeiserX/DeclaRenta?style=flat-square&color=f59e0b" alt="Stars"/></a>
  <a href="https://github.com/GeiserX/awesome-spain#readme"><img src="https://img.shields.io/badge/listed%20on-awesome--spain-c60b1e?style=flat-square&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDIwIDE0Ij48cmVjdCB3aWR0aD0iMjAiIGhlaWdodD0iMTQiIGZpbGw9IiNjNjBiMWUiLz48cmVjdCB5PSIzLjUiIHdpZHRoPSIyMCIgaGVpZ2h0PSI3IiBmaWxsPSIjZmZjNDAwIi8+PC9zdmc+&labelColor=ffc400" alt="awesome-spain"/></a>
</p>

<p align="center">
  IBKR · Degiro · Scalable Capital · eToro · Freedom24 · Coinbase · Binance · Kraken → Modelo 100 · Modelo 720 · D-6
</p>

<p align="center">
  Self-hosted · Privacidad total · Tus datos no salen de tu equipo
</p>

---

## El problema

Si inviertes con un broker extranjero, hacer la renta es un infierno:

- **Renta Web no importa datos** de brokers extranjeros — todo manual
- **FIFO obligatorio** con tipos ECB oficiales (no los del broker)
- **Regla anti-churning** de 2 meses que nadie detecta automáticamente
- **Doble imposición** internacional que hay que calcular a mano
- **Modelo 720** obligatorio si tus activos en el extranjero superan 50.000 EUR
- **Modelo D-6** para titulares de valores extranjeros a 31 de diciembre (verificar normativa vigente)

DeclaRenta automatiza todo esto.

## Brokers soportados

| Broker | Formato | Notas |
|---|---|---|
| Interactive Brokers | Flex Query XML | Trades, dividendos, corporate actions, posiciones |
| Degiro | CSV (transacciones + cartera) | Delimitador auto-detectado (coma/punto y coma) |
| Scalable Capital | CSV (14 columnas) | Incluye savings plans y distribuciones |
| eToro | XLSX (cuenta completa) | Posiciones cerradas + dividendos + CFDs, 6+ versiones de cabeceras |
| Freedom24 | JSON (report export) | Trades, dividendos, retenciones |
| Coinbase | CSV (historial de transacciones) | Crypto trades y conversiones |
| Binance | CSV (historial de trades) | Spot trades de criptomonedas |
| Kraken | CSV (trades/ledger) | Crypto trades y staking |

Se pueden combinar ficheros de varios brokers en una sola ejecución para FIFO cruzado.

## Modelos fiscales

| Modelo | Descripción | Formato |
|---|---|---|
| **Modelo 100** (IRPF) | Casillas 0327, 0328, 0029, 0032, 0033, 0588 | JSON, CSV, PDF (con tipos ECB) |
| **Modelo 720** | Declaración de bienes en el extranjero (>50.000 EUR), tipos A/M/C | Fixed-width AEAT |
| **Modelo D-6** | Inversiones en el exterior (Banco de España / AFORIX) | Guía paso a paso |

## Casillas del Modelo 100

| Casilla | Concepto |
|---|---|
| 0327 | Valor de transmisión (importe total de ventas) |
| 0328 | Valor de adquisición (coste total FIFO con tipos ECB) |
| 0029 | Dividendos brutos de acciones extranjeras |
| 0032 | Gastos deducibles (intereses de margen) |
| 0033 | Intereses de cuentas y depósitos |
| 0588 | Deducción por doble imposición internacional |

## Inicio rápido

### Web (recomendado)

Visita [declarenta.es](https://declarenta.es) — arrastra tus ficheros y listo.

Soporta `.xml`, `.csv`, `.json` y `.xlsx`. Se pueden subir varios ficheros a la vez para FIFO cruzado entre brokers.

### CLI

```bash
npm install -g declarenta

# Informe Modelo 100 (JSON a stdout)
declarenta convert --input flex_query.xml --year 2025

# Varios ficheros de distintos brokers
declarenta convert --input ibkr.xml --input degiro.csv --input etoro.xlsx --year 2025

# Exportar en CSV
declarenta convert --input flex_query.xml --year 2025 --format csv --output detalle.csv

# Exportar en PDF
declarenta convert --input flex_query.xml --year 2025 --format pdf --output informe.pdf

# Con compensación de pérdidas de años anteriores (Art. 49 LIRPF)
declarenta convert --input flex_query.xml --year 2025 --prior-losses perdidas.json

# Modelo 720
declarenta modelo720 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE"

# Modelo 720 con tipos A/M/C (comparando con declaración del año anterior)
declarenta modelo720 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE" --previous-720 720_2024.txt

# Modelo D-6 (guía AFORIX)
declarenta d6 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE"
```

El broker se auto-detecta a partir del contenido del fichero. Se puede forzar con `--broker <nombre>`.

## Motor fiscal

- **FIFO estricto** con tipos de cambio ECB oficiales por fecha de operación
- **Todos los tipos de activo**: acciones, ETFs, opciones, futuros, forex, bonos, CFDs y criptomonedas
- **Regla anti-churning** (Art. 33.5.f LIRPF): bloqueo de pérdidas si se recompra el mismo valor en 2 meses (aplica a acciones, fondos y bonos; excluye derivados, forex y crypto)
- **Doble imposición** (Art. 80 LIRPF): deducción por retenciones en origen, desglosado por país
- **Stock splits**: forward y reverse, con liquidación de fracciones (cash-in-lieu)
- **Corporate actions**: fusiones (transferencia de coste) y spin-offs (distribución proporcional)
- **Compensación de pérdidas** (Art. 49 LIRPF): ventana de 4 años con compensación cruzada del 25%

## Privacidad

- **Self-hosted**: los datos se procesan en tu equipo. La única conexión externa es al API del BCE para tipos de cambio (datos públicos).
- Sin analytics, sin tracking, sin telemetría.

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
npm run cli -- convert --input test.xml --year 2025
```

## Contribuir

Las contribuciones son bienvenidas. Áreas donde más ayuda se necesita:

- **Parsers de brokers**: Trade Republic, Revolut, XTB, MyInvestor
- **Reglas fiscales**: casos edge de FIFO, convenios de doble imposición por país
- **Tests**: más fixtures con operaciones reales anonimizadas
- **Traducciones**: interfaz web en catalán, euskera, gallego

