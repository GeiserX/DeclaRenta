# DeclaRenta

[![codecov](https://codecov.io/gh/GeiserX/DeclaRenta/graph/badge.svg)](https://codecov.io/gh/GeiserX/DeclaRenta)
[![listed on awesome-spain](https://img.shields.io/badge/listed%20on-awesome--spain-c60b1e?style=flat-square&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDIwIDE0Ij48cmVjdCB3aWR0aD0iMjAiIGhlaWdodD0iMTQiIGZpbGw9IiNjNjBiMWUiLz48cmVjdCB5PSIzLjUiIHdpZHRoPSIyMCIgaGVpZ2h0PSI3IiBmaWxsPSIjZmZjNDAwIi8+PC9zdmc+&labelColor=ffc400)](https://github.com/GeiserX/awesome-spain#readme)

**Convierte reportes de brokers extranjeros en tu declaración de la renta española.**

IBKR, Degiro, Trade Republic → Modelo 100 (IRPF), Modelo 720, D-6.

100% open source. 100% en tu navegador. Tus datos nunca salen de tu ordenador.

---

## El problema

Si inviertes con un broker extranjero (Interactive Brokers, Degiro, Trade Republic...), hacer la renta es un infierno:

- **Renta Web no importa datos** de brokers extranjeros — todo manual
- **FIFO obligatorio** con tipos ECB oficiales (no los del broker)
- **Regla anti-churning** de 2 meses que nadie detecta automáticamente
- **Doble imposición** internacional que hay que calcular a mano
- **Modelo 720** si tus activos en el extranjero superan 50.000 EUR

TaxDown cobra 75-239 EUR/año sin automatización real. DeclaRenta lo hace gratis.

## Qué hace

| Funcionalidad | Estado |
|---|---|
| Parser IBKR Flex Query XML | v0.1 |
| Motor FIFO con tipos ECB oficiales | v0.1 |
| Detección regla anti-churning (2 meses) | v0.1 |
| Mapeo a casillas Modelo 100 | v0.1 |
| Cálculo doble imposición (Art. 80 LIRPF) | v0.1 |
| Generador Modelo 720 (AEAT fixed-width) | v0.1 |
| Web UI (browser-only) | v0.1 |
| CLI | v0.1 |
| Parser Degiro | Planificado |
| Parser Trade Republic | Planificado |
| Generador D-6 | Planificado |
| Informe PDF | Planificado |

## Inicio rápido

### Web (recomendado)

Visita [declarenta.es](https://declarenta.es) — arrastra tu Flex Query XML y listo. Todo se procesa en tu navegador.

### CLI

```bash
npm install -g declarenta

# Generar informe para Modelo 100
declarenta convert --input flex_query.xml --year 2025

# Generar informe y guardar en fichero
declarenta convert --input flex_query.xml --year 2025 --output informe.json

# Generar Modelo 720
declarenta modelo720 --input flex_query.xml --year 2025 --nif 12345678A --name "APELLIDOS, NOMBRE"
```

### Docker

```bash
docker run --rm -v $(pwd):/data declarenta convert --input /data/flex_query.xml --year 2025
```

## Cómo obtener el Flex Query XML de IBKR

1. Inicia sesión en [IBKR Client Portal](https://www.interactivebrokers.com/sso/Login)
2. Ve a **Reports** → **Flex Queries** → **Custom Flex Queries**
3. Crea una nueva query con estas secciones: `Trades`, `CashTransactions`, `CorporateActions`, `OpenPositions`, `SecuritiesInfo`
4. Período: `01/01/YYYY` a `31/12/YYYY` (año fiscal completo)
5. Formato: **XML**
6. Ejecuta y descarga

## Casillas del Modelo 100

DeclaRenta calcula automáticamente estas casillas:

| Casilla | Concepto |
|---|---|
| 0327 | Valor de transmisión (importe total de ventas) |
| 0328 | Valor de adquisición (coste total FIFO con tipos ECB) |
| 0029 | Dividendos brutos de acciones extranjeras |
| 0032 | Gastos deducibles (intereses de margen) |
| 0033 | Intereses de cuentas y depósitos |
| 0588 | Deducción por doble imposición internacional |

## Privacidad

- **Modo web**: todo se procesa en JavaScript en tu navegador. Las únicas llamadas de red son para obtener tipos de cambio del BCE (datos públicos).
- **Modo CLI**: se ejecuta enteramente en tu máquina. Solo se conecta al API del BCE para tipos de cambio.
- **Sin analytics, sin tracking, sin telemetría.**
- **Sin cuentas de usuario, sin autenticación.**

## Desarrollo

```bash
git clone https://github.com/GeiserX/DeclaRenta.git
cd DeclaRenta
npm install

# Tests
npm test

# Desarrollo web
npm run dev

# Build
npm run build

# CLI en desarrollo
npm run cli -- convert --input test.xml --year 2025
```

## Contribuir

Las contribuciones son bienvenidas. Áreas donde más ayuda se necesita:

- **Parsers de brokers**: Degiro CSV, Trade Republic PDF
- **Reglas fiscales**: casos edge de FIFO, doble imposición por convenio
- **Traducciones**: interfaz web en catalán, euskera, gallego
- **Tests**: más fixtures con operaciones reales anonimizadas

