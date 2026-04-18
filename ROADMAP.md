# Roadmap de DeclaRenta

> Última actualización: abril 2026

---

## Visión

DeclaRenta será la herramienta open source de referencia para que cualquier residente fiscal español con inversiones en brokers extranjeros pueda cumplir con todas sus obligaciones tributarias — Modelo 100 (IRPF), Modelo 720, Modelo D-6 y Modelo 721 — sin pagar cientos de euros a un asesor ni introducir miles de datos a mano.

**Privacidad radical**: los datos financieros del usuario nunca abandonan su navegador ni su máquina. La única conexión de red es al API público del BCE para tipos de cambio.

---

## Calendario fiscal de referencia

DeclaRenta se alinea con el calendario tributario español. Cada release se planifica para estar lista **antes** del deadline correspondiente.

```
 ENE        FEB        MAR        ABR        MAY        JUN
 ├──────────┤          ├──────────┤                     │
 │ D-6      │          │ 720/721  │                     │
 │ (31 ene) │          │ (31 mar) │                     │
 │          │          │          ├─────────────────────┤
 │          │          │          │  Campaña IRPF        │
 │          │          │          │  Modelo 100 + 714    │
 │          │          │          │  (abr - 30 jun)      │
 └──────────┘          └──────────┘                     │
```

| Modelo | Qué declara | Deadline | Formato AEAT |
|--------|-------------|----------|--------------|
| **100 (IRPF)** | Renta: ganancias, dividendos, intereses | abr-jun (año siguiente) | XSD (`Renta20XX.xsd`), pero Renta Web NO importa ficheros — entrada manual por casillas |
| **720** | Bienes y derechos en el extranjero (>50.000 €) | 1 ene - 31 mar | Fixed-width 500 bytes/registro, ISO-8859-15, vía TGVI Online |
| **721** | Criptomonedas en el extranjero (>50.000 €) | 1 ene - 31 mar | XML (Orden HFP/886/2023) |
| **D-6** | Inversiones españolas en el exterior | 1-31 ene | Formulario Banco de España (no AEAT) |
| **714 (Patrimonio)** | Patrimonio neto (>700.000 € o norma CCAA) | abr-jun (con IRPF) | XSD similar a Modelo 100 |

---

## Estado actual (v0.9.0)

### Lo que ya funciona

| Componente | Estado | Fichero |
|-----------|--------|---------|
| Parser IBKR Flex Query XML | Implementado | `src/parsers/ibkr.ts` |
| Parser Degiro (Transacciones CSV + Cuenta CSV) | Implementado | `src/parsers/degiro.ts` |
| Parser Scalable Capital (CSV) | Implementado | `src/parsers/scalable.ts` |
| Parser Freedom24 (JSON) | Implementado | `src/parsers/freedom24.ts` |
| Parser eToro (XLSX) | Implementado | `src/parsers/etoro.ts` |
| Utilidades CSV compartidas | Implementado | `src/parsers/csv-utils.ts` |
| Motor FIFO con tipos ECB oficiales | Implementado | `src/engine/fifo.ts` |
| Corporate actions: splits, reverse splits, scrip dividends | Implementado | `src/engine/fifo.ts` |
| Corporate actions: mergers (TC) y spin-offs (SO) | Implementado | `src/engine/fifo.ts` |
| Detección regla anti-churning (2 meses) | Implementado | `src/engine/wash-sale.ts` |
| Procesamiento dividendos + retenciones | Implementado | `src/engine/dividends.ts` |
| Cálculo doble imposición (Art. 80) | Implementado | `src/engine/double-taxation.ts` |
| Compensación de pérdidas (Art. 49 LIRPF) | Implementado | `src/engine/loss-carryforward.ts` |
| Generador Modelo 720 (fixed-width, país ISIN, fecha adquisición) | Implementado | `src/generators/modelo720.ts` |
| Generador Modelo 721 stub (crypto) | Implementado | `src/generators/modelo721.ts` |
| Generador Modelo D-6 (guía AFORIX) | Implementado | `src/generators/d6.ts` |
| Generador informe PDF | Implementado | `src/generators/pdf.ts` |
| Mapeo a casillas Modelo 100 | Implementado | `src/generators/report.ts` |
| CLI (`convert`, `modelo720`, `d6`, `modelo721`) | Implementado | `src/cli/index.ts` |
| Web UI: selector broker, tabla operaciones, filtros, búsqueda, ordenación | Implementado | `src/web/` |
| Web UI: wizard 4 pasos (subir → revisar → configurar → resultados) | Implementado | `src/web/wizard.ts` |
| Web UI: casillas expandibles con desglose de operaciones | Implementado | `src/web/casilla-detail.ts` |
| Web UI: comparador año a año (localStorage) | Implementado | `src/web/year-compare.ts`, `src/web/storage.ts` |
| Web UI: modo oscuro/claro con detección de preferencia del sistema | Implementado | `src/web/` |
| Web UI: responsive (tablet, móvil, móvil pequeño) | Implementado | `src/web/` |
| Interfaz `BrokerParser` + registry auto-detección (5 brokers) | Implementado | `src/types/broker.ts`, `src/parsers/index.ts` |
| FIFO cross-broker (orden cronológico global) | Implementado | `src/cli/index.ts`, `src/web/main.ts` |
| Parser Coinbase (CSV) | Implementado | `src/parsers/coinbase.ts` |
| Parser Binance (CSV) | Implementado | `src/parsers/binance.ts` |
| Parser Kraken (CSV/Ledger) | Implementado | `src/parsers/kraken.ts` |
| Validador Modelo 720 (BOE) | Implementado | `src/generators/modelo720-validator.ts` |
| Web UI: gráficos SVG (activos, G/P mensual, divisas, retenciones) | Implementado | `src/web/charts.ts` |
| Web UI: disclaimer modal | Implementado | `src/web/disclaimer.ts` |
| Web UI: i18n 5 idiomas (es, en, ca, eu, gl) | Implementado | `src/i18n/` |
| Web UI: accesibilidad WCAG 2.1 AA | Implementado | `src/web/` |
| PWA: Service Worker + manifest | Implementado | `src/web/sw.ts`, `src/web/manifest.json` |
| Deploy GitHub Pages | Configurado | `.github/workflows/deploy.yml` |
| 412+ tests | Passing | `tests/` |
| CI/CD GitHub Actions | Configurado | `.github/workflows/` |

### v0.1.0 completado

- [x] Validado con datos IBKR reales (1063 operaciones, 3 ejercicios)
- [x] Tramos del ahorro 2025 verificados (30% >300K, Ley 7/2024)
- [x] v0.1.0 publicado

### Tipos de activo soportados

| Tipo | IBKR code | FIFO | Dividendos | 720 | Estado |
|------|-----------|------|------------|-----|--------|
| Acciones | `STK` | Sí | Sí | Sí | v0.1 |
| ETFs / Fondos | `FUND` | Sí | Sí | Sí | v0.1 |
| Opciones | `OPT` | Sí | — | — | v0.1 (multiplicador, FIFO por símbolo) |
| Futuros | `FUT` | Sí | — | — | v0.10 |
| Bonos | `BOND` | Sí | Sí (cupones) | Sí | v0.10 |
| Forex | `CASH` | Sí | — | — | v0.10 |
| Warrants | `WAR` | — | — | — | Planificado |
| Crypto | N/A | Sí | — | — (721) | v0.7 |
| CFDs | N/A | Sí | — | — | v0.10 (eToro) |

---

## Panorama competitivo

| Herramienta | Tipo | Precio | Brokers | Modelos | Privacidad | Limitaciones |
|-------------|------|--------|---------|---------|------------|-------------|
| **TaxDown** | SaaS | 75-239 €/año | Varios (manual) | 100 | Suben datos a sus servidores | Sin automatización real para brokers extranjeros; el plan para inversores solo está disponible en el tier FULL (239 €) |
| **TaxScouts → TaxFix** | SaaS | ~69-149 € | Manual | 100 | Datos en la nube | Redirigido a TaxFix; sin soporte específico para IBKR/Degiro |
| **burocratin** | OSS (AGPL-3.0) | Gratis | IBKR, Degiro | 720, D-6 | Browser (WASM) | Solo genera 720 y D-6, no calcula IRPF; escrito en Rust/WASM (19 stars) |
| **IBKR-RENTA** | OSS | Gratis | IBKR (CSV) | 100 | Browser | Single-file HTML; solo IBKR CSV (no Flex XML); sin 720/D-6; 1 star, creado mar 2026 |
| **Asesor fiscal** | Servicio | 150-500 € | Cualquiera | Todos | Datos compartidos | Coste elevado, dependencia de tercero, tiempos de espera |
| **DeclaRenta** | OSS (GPL-3.0) | **Gratis** | IBKR, Degiro, Scalable, eToro, Freedom24, Coinbase, Binance, Kraken | **100, 720, D-6** + 721 | **Browser-first, zero-server** | En desarrollo activo |

**Hueco que cubre DeclaRenta**: no existe ninguna herramienta open source que cubra el ciclo completo (IRPF + 720 + D-6) con soporte multi-broker y privacidad total. burocratin solo hace 720/D-6. IBKR-RENTA solo hace Modelo 100 desde CSV. TaxDown cobra 239 € y sube los datos a la nube.

---

## Fases del roadmap

### Fase 0: Cimientos (abr 2026) — EN CURSO

> **Objetivo**: MVP funcional que genera casillas Modelo 100 y fichero 720 desde IBKR Flex XML.
>
> **Target**: campaña renta 2025 (abr-jun 2026) — uso personal inmediato.

- [x] Estructura TypeScript, licencia GPL-3.0, CI/CD
- [x] Parser IBKR Flex Query XML (`fast-xml-parser`, manejo de arrays)
- [x] Motor ECB (SDMX API, cache, fallback festivos/fines de semana)
- [x] Motor FIFO (lots, consumo parcial, `Decimal.js` everywhere)
- [x] Detección anti-churning (Art. 33.5.f LIRPF, ventana de 2 meses — aplica a STK, FUND, BOND; excluye OPT, FUT, CFD, CASH, CRYPTO)
- [x] Procesamiento dividendos + matching retenciones extranjeras
- [x] Cálculo doble imposición (Art. 80 LIRPF, tramos del ahorro)
- [x] Generador Modelo 720 (fixed-width 500 bytes, ISO-8859-15)
- [x] CLI: `declarenta convert`, `declarenta modelo720`
- [x] Web UI: upload XML → tabla casillas → exportar JSON
- [x] Tests: 15 tests (parser, FIFO, wash sale)
- [x] Docker image
- [x] Validar con datos IBKR reales propios (ejercicio 2025) — 1063 operaciones, 3 años, resultados dentro de 1.8K EUR del cálculo de referencia (diferencia por tipos ECB vs broker)
- [x] Soporte opciones (`OPT`): multiplicador IBKR, FIFO por símbolo (opciones no tienen ISIN)
- [x] Soporte stock splits: corporate actions tipo FS, deduplicación
- [x] Resiliencia ventas cortas: warning + coste base 0 en vez de crash
- [x] Multi-fichero: `--input` acepta múltiples XMLs para FIFO cross-year
- [x] Verificar tramos del ahorro 2025: **30%** para >300K (Ley 7/2024, Disposición final 7ª)
- [x] Impuestos de transacción (STT, FTT) incluidos en coste/importe de venta
- [x] Exportación CSV: `--format csv` para detalle por operación
- [x] ESLint strictTypeChecked + Prettier
- [x] 75 tests passing (FIFO, dividendos, doble imposición, wash sale, fechas, parser, ECB, CSV, report)
- [x] Publicar **v0.1.0**
- [x] Automated release pipeline (auto-tag + changelog)

**Entregable**: CLI y web que producen casillas Modelo 100 + fichero 720 desde IBKR Flex Query XML.

**Criterio de éxito**: los cálculos coinciden con los del borrador AEAT para el ejercicio 2025 del autor.

---

### Fase 1: Precisión al céntimo (may 2026)

> **Objetivo**: que cada número sea correcto al céntimo, validado contra datos reales y contra cálculo manual.

- [x] Contrastar resultados IBKR 2024/2025 con referencia Python (validado en Fase 0)
- [x] Stock splits en FIFO: parse corporate actions, deduplicación, formato fecha YYYYMMDD
- [x] Reverse splits: ratio < 1 (SPLIT 1 FOR 10), limpieza de lotes con cantidad 0
- [x] Corporate actions avanzadas: mergers, spin-offs
  - Merger: cerrar lots del símbolo antiguo, abrir lots del nuevo con mismo coste
  - Spin-off: distribuir coste entre parent y spin-off según ratio de mercado
- [x] Posiciones cross-year: multi-fichero `--input` carga lots de ejercicios anteriores
- [x] Comisiones: impuestos de transacción (STT, FTT) incluidos en coste/importe
- [x] Multi-divisa simultáneo: compras en USD pagadas con GBP manejadas correctamente con tipos ECB separados
- [x] Informe detallado por operación: divisa, tipo ECB compra/venta en JSON y CSV
- [x] Dividendos en especie (scrip dividends): lotes con coste base de IBKR
- [x] Payment In Lieu of Dividends: clasificación correcta como rendimiento
- [x] Edge cases: cantidad 0 post-split (lotes eliminados automáticamente)
- [x] 75 tests (>30 target), 56.65% coverage
- [x] ESLint strictTypeChecked + Prettier
- [x] Web UI: tabla de operaciones con ordenación, filtros, búsqueda, exportar CSV
- [x] Documentación de cada casilla y cómo se calcula (`docs/casillas.md`)
- [x] Publicar **v0.2.0**

**Criterio de éxito**: ≤0.01 € de desviación respecto a cálculo manual en 100+ operaciones reales.

---

### Fase 2: Multi-broker (jun-jul 2026)

> **Objetivo**: cubrir los brokers que usan la mayoría de inversores españoles con cuentas en el extranjero.

**Investigación de integración fiscal (abril 2026)**:

| Broker | Reporta a AEAT | Retenciones | Informe fiscal | 720 necesario | Prioridad DeclaRenta |
|--------|----------------|-------------|----------------|---------------|---------------------|
| **Degiro** | No (solo CRS) | No | PDF anual | Sí | **Alta** — máximo dolor |
| **Scalable Capital** | No | No | PDF anual | Sí | **Alta** — mismo problema que Degiro |
| **eToro** | No (solo CRS) | No | Solo Club members | Sí | **Media** — CFDs complican |
| **Freedom24** | No | No | PDF (solo inglés) | Sí | **Media** |
| **Trade Republic** | **Sí** (desde mid-2025) | **Sí** | PDF anual | **No** (DGT ruling, IBAN español) | Baja — ya integrado con AEAT |
| **XTB** | **Sí** (entidad española) | Sí | Sí | No | Baja — pre-rellena borrador |
| **Revolut** | Sí (lado bancario) | Parcial | Limitado | Parcial | Baja — inversiones secundarias |

**Hallazgo clave**: ningún broker genera XML Modelo 100 importable en Renta Web. DeclaRenta cubre ese hueco.

**Brokers target (ordenados por valor añadido)**:

| Broker | Formato | Particularidades |
|--------|---------|-----------------|
| **Degiro** | CSV (Transacciones + Cuenta) | Multi-idioma (ES/EN/NL/DE); números formato EU; pares valor+divisa |
| **Scalable Capital** | CSV/PDF | Formato similar a TR; sin reporting AEAT |
| **eToro** | XLS (Account Statement) | Incluye CFDs y crypto; informe fiscal solo para Club members |
| **Freedom24** | CSV (Trade Report) | Solo inglés; formato propietario |

Tareas:

- [x] **Interfaz común de parser** (`BrokerParser`): `detect(input)` + `parse(input) → Statement`
- [x] **Registry con auto-detección**: `detectBroker()`, `getBroker()`, `--broker` flag en CLI
- [x] **Parser Degiro**: Transactions CSV (trades) + Account CSV (dividendos/retenciones). Multi-idioma ES/EN/NL/DE, auto-detect delimitador coma/punto y coma, números EU
- [x] **Parser Scalable Capital**: CSV export (semicolon-delimited, EU numbers, filter `status=Executed`)
- [x] **Parser eToro**: XLSX Account Statement (acciones, ETFs y CFDs). Soporta 6+ versiones de columnas
- [x] **Parser Freedom24**: JSON report (`trades.detailed[]`, `corporate_actions.detailed[]`)
- [x] **FIFO cross-broker**: consolidar lots de múltiples brokers por ISIN
  - Un mismo ISIN comprado en IBKR y Degiro usa una sola cola FIFO
  - Orden cronológico global, no por broker
- [x] Web UI: selector de broker → formato esperado → upload multi-fichero
- [x] Tests por broker con fixtures sintéticos (Scalable 15, Freedom24 16, eToro 5, corporate actions 7)
- [x] Publicar **v0.3.0**

**Criterio de éxito**: procesamiento correcto de exports reales de al menos 3 brokers distintos.

---

### Fase 3: Todos los modelos fiscales (ago-sep 2026)

> **Objetivo**: cubrir 100% de las obligaciones fiscales de un inversor con broker extranjero.
>
> **Target**: que 720, 721 y D-6 estén listos antes de los deadlines de enero-marzo 2027.

#### Modelo D-6 (Banco de España)

- [x] Investigar formato exacto de presentación D-6 (Banco de España, no AEAT). No existe fichero de carga: se rellena vía AFORIX web
- [x] Generador D-6: guía AFORIX con valores pre-calculados por posición (ISIN, país, exchange, valor EUR)
- [x] Detección automática de obligación D-6 (cualquier valor en el extranjero a 31/dic)
- [x] Soporte para declaración negativa (cancelación de posiciones)

#### Modelo 720 — mejoras

- [x] Detección automática de umbral 50.000 € por categoría (valores, cuentas, inmuebles)
- [x] Tipo de declaración: A (alta), M (mantenimiento), C (cancelación)
- [x] Primera fecha de adquisición por posición (desde lotes FIFO)
- [x] Valoración correcta según Ley del Impuesto sobre el Patrimonio:
  - Acciones cotizadas: media del último trimestre; conversión a EUR con tipo BCE
  - ETFs: valor liquidativo a 31/dic
- [x] País de emisión extraído del ISIN (primeros 2 caracteres)
- [x] Validación contra diseño de registro BOE antes de generar fichero

#### Modelo 721 (crypto en el extranjero)

- [x] Parser Coinbase (CSV)
- [x] Parser Binance (CSV)
- [x] Parser Kraken (CSV/ledger)
- [x] Generador 721: stub (formato real es XML per Orden HFP/886/2023 — pendiente de migrar)
- [x] Umbral 50.000 € en criptomonedas en exchanges extranjeros

#### Multi-year

- [x] Compensación de pérdidas (Art. 49 LIRPF): arrastre a 4 años siguientes
- [x] Importar datos de ejercicios anteriores (JSON de DeclaRenta o `--prior-losses`)
- [x] Tracking de pérdidas pendientes de compensar por año de origen (FIFO oldest-first)
- [x] Compensación cruzada: hasta 25% de rendimientos positivos con saldo negativo de ganancias (y viceversa)

#### Informe PDF

- [x] Informe PDF descargable: resumen ejecutivo + detalle por operación (pdfkit)
- [x] Formato orientado a llevar al asesor fiscal o adjuntar a la declaración
- [x] Incluir tipo ECB utilizado en cada operación para auditoría

- [x] Publicar **v0.5.0**

**Criterio de éxito**: ficheros 720 y D-6 generados pasan validación de formato AEAT/BdE sin errores.

---

### Fase 4: Web UI profesional (oct-nov 2026)

> **Objetivo**: experiencia web de calidad que elimine cualquier barrera de entrada. Zero-server.

- [x] **Wizard multi-paso**: elige broker(s) → sube fichero(s) → revisa datos → configura (NIF, año) → genera resultados → descarga
- [x] **Tabla interactiva de operaciones**: ordenación, filtros por ISIN/fecha/tipo, búsqueda
- [x] **Vista por casillas**: cada casilla expandible con desglose de las operaciones que la componen
- [x] **Gráficos**: distribución por tipo de activo, G/P por mes, composición por divisa, retenciones por país
- [x] **Comparador año a año**: si el usuario procesa múltiples años (localStorage)
- [x] **Modo oscuro/claro** con detección de preferencia del sistema
- [x] **PWA**: funciona offline una vez cargada (Service Worker + manifest)
- [x] **Accesibilidad WCAG 2.1 AA**: skip-link, focus-visible, ARIA roles, keyboard navigation
- [x] **i18n**: castellano (default), catalán, euskera, gallego, inglés — selector de idioma en la UI
- [x] **Deploy GitHub Pages**: workflow configurado, dominio custom ready
- [x] **Responsive**: móvil, tablet, desktop
- [x] Publicar **v0.8.0**

**Criterio de éxito**: un usuario sin experiencia técnica puede generar su informe en <3 minutos desde la web.

---

### Fase 5: Más tipos de activo (nov-dic 2026)

> **Objetivo**: cubrir los instrumentos financieros más allá de acciones y ETFs.

#### Opciones y futuros (IBKR)

- [x] Parser de opciones IBKR: strike, expiry, put/call, multiplicador (campos putCall, strike, expiry, underlyingSymbol, underlyingIsin en Trade)
- [x] Tratamiento fiscal: prima como coste/ingreso, expiración y cierre vía FIFO
- [ ] Opciones ejercidas: coste de la prima se suma al coste de adquisición de las acciones (pendiente: detectar ejercicio C;O y transferir prima a lote STK)
- [x] Futuros: FIFO con multiplicador, ganancias/pérdidas como ganancia patrimonial

#### Forex

- [x] Operaciones forex spot: clasificación como ganancia/pérdida patrimonial
- [x] Conversiones de divisa en IBKR (CASH asset category, FIFO por símbolo)
- [ ] Distinguir entre forex trading y conversiones de divisa para depósitos (pendiente: detectar FXCONV vs trades en Flex Query)

#### Bonos y renta fija

- [x] Cupones: rendimiento del capital mobiliario (Casilla 0033) — ya soportado vía Bond Interest Received/Paid
- [x] Compraventa de bonos: ganancia/pérdida patrimonial vía FIFO
- [x] Letras del Tesoro extranjeras: tratamiento fiscal como BOND

#### CFDs

- [x] CFDs tributan como ganancia/pérdida patrimonial (no como rendimiento)
- [x] Parser eToro CFDs (tipo CFD detectado por leverage > 1 o type "cfd")
- [x] Soporte para posiciones cortas (warning + coste base 0)

- [x] Publicar **v0.9.0**

---

### Fase 6: Lanzamiento v1.0 (ene 2027)

> **Objetivo**: herramienta completa, validada, documentada, lista para la campaña de renta 2026 (abr-jun 2027) y los modelos 720/D-6 (ene-mar 2027).

- [ ] Todos los tests pasan con datos reales de 4+ brokers
- [ ] Ficheros 720 y D-6 validados contra formato AEAT/BdE
- [ ] Documentación completa:
  - Guía de uso paso a paso (web + CLI)
  - FAQ con los 20 casos más frecuentes
  - Vídeo tutorial de 5 minutos
  - Guía para contribuir parsers de nuevos brokers
- [ ] Security audit: CSP headers, input sanitization, OWASP checklist
- [ ] Performance: procesar 10.000 operaciones en <2 segundos (browser)
- [ ] Publicar **v1.0.0** en npm + GitHub Releases + Docker Hub
- [ ] Publicar en awesome-selfhosted, awesome-spain

**Criterio de éxito**: 10+ usuarios externos completan su declaración usando DeclaRenta sin soporte.

---

## Post-v1.0: Crecimiento (2027+)

### Comunidad y difusión

| Canal | Acción | Timing |
|-------|--------|--------|
| Hacker News | Show HN: "Open-source tool: broker reports → Spanish tax declarations, all in-browser" | Feb 2027 |
| Rankia | Post en subforo Fiscalidad + subforo Brokers | Feb 2027 |
| Reddit | r/SpainFIRE + r/SpainPersonalFinance | Feb 2027 |
| YouTube | Contactar Value School, Gregorio Hernández, Buscando Mi Libertad | Mar 2027 |
| Telegram | Inversores Españoles, FIRE España, Indexa/Myinvestor | Mar 2027 |
| Foros Bogleheads ES | Post con tutorial | Mar 2027 |
| dev.to / Medium | Artículo técnico sobre el motor FIFO y tipos ECB | Abr 2027 |

### Más brokers

| Broker | Formato | Prioridad | Notas |
|--------|---------|-----------|-------|
| **Trade Republic** | CSV/PDF | Alta | Broker más popular en España; ya reporta a AEAT pero usuarios necesitan verificar datos |
| **Revolut** | CSV | Alta | Inversiones + crypto; base de usuarios masiva en España |
| **XTB** | CSV | Media | Entidad española, pero muchos usuarios quieren verificar el borrador |
| **MyInvestor** | PDF/CSV | Media | Roboadvisor español; fondos indexados con FIFO complejo |

### Funcionalidades avanzadas

- [ ] **Modelo 100 XML pre-relleno**: generar XML importable en Renta Web usando el XSD anual (`Renta20XX.xsd`). Ningún competidor lo ofrece gratis — sería el mayor diferenciador del mercado. AEAT no documenta el proceso de importación pero el esquema es público.
- [ ] **Complementarias y rectificativas**: detectar errores en declaraciones de años anteriores y generar complementaria
- [ ] **Doble imposición avanzada**: aplicar convenios bilaterales específicos por país (ej. W-8BEN USA → retención 15% vs 30%)
- [ ] **Optimizador fiscal (tax-loss harvesting)**: alertas proactivas: "Tienes pérdidas latentes en X que compensarían Y ganancias antes del 31/dic, ahorrando Z EUR". Simulador de escenarios.
- [ ] **Importar borrador AEAT**: comparar datos declarados con datos calculados para detectar discrepancias
- [ ] **Deducciones autonómicas por CCAA**: usar la CCAA del perfil fiscal para mostrar deducciones aplicables (Madrid: inversión en empresas; Cataluña: alquiler; etc.)
- [ ] **DeFi / staking / yield farming**: clasificación fiscal correcta de staking rewards (¿rendimiento del capital mobiliario o ganancia patrimonial?), liquidity pool income, airdrops. Zona gris regulatoria — guía informativa con referencias a consultas vinculantes de la DGT.
- [ ] **Modelo 721 XML real**: migrar el stub de fixed-width a XML conforme a Orden HFP/886/2023 con schemas AEAT
- [ ] **Continuidad FIFO multi-year**: persistir lotes FIFO entre años en localStorage/IndexedDB para que los usuarios no tengan que subir todo el histórico cada vez. Exportar/importar estado FIFO.
- [ ] **Informe PDF profesional desde web**: versión rica del informe para llevar al asesor fiscal o adjuntar a la declaración — resumen ejecutivo, detalle por operación, tipos ECB, gráficos, normativa. El CLI ya genera PDF básico.
- [ ] **Modelo 714 (Patrimonio)**: para patrimonios >700.000 € (o umbral según CCAA)
- [ ] **MCP server**: integración con Claude Code / ChatGPT para consultas fiscales contextuales
- [ ] **n8n node**: automatización de procesamiento periódico

### Monetización (preservando core OSS GPL-3.0)

El core siempre será gratuito. La monetización viene de conveniencia y servicios profesionales:

| Tier | Precio | Qué incluye |
|------|--------|-------------|
| **Community** | Gratis | Todo el core: parsers, FIFO, casillas, 720, D-6, web y CLI |
| **Cloud** | 9-19 €/año | Versión hosted (sin instalar nada), historial multi-year automático, alertas de deadlines |
| **Gestoría** | 29-49 €/mes | Procesamiento batch multi-cliente, dashboard de clientes, exportación a A3/Sage/ContaPlus |
| **API** | Usage-based | REST API para integraciones con software de gestorías |

Posibilidades adicionales (a evaluar):
- [ ] Envío directo a AEAT con certificado digital o Cl@ve (si AEAT lo permite técnicamente)
- [ ] Integración con Renta Web vía automatización de navegador (frágil, último recurso)

### Oportunidad de mercado

| Métrica | Valor | Fuente |
|---------|-------|--------|
| Residentes fiscales españoles con broker extranjero | ~1.5M | Estimación CNMV + apertura cuentas IBKR/Degiro 2020-2025 |
| Coste medio de asesor fiscal para inversores | 150-500 €/año | Rankia, foros |
| Precio TaxDown para inversores extranjeros | 239 € (FULL obligatorio) | taxdown.es/precios (abr 2026) |
| Herramientas OSS competidoras con cobertura completa | **0** | Investigación propia |

**Escenarios de ingresos anuales (año 2-3)**:

| Canal | Supuesto | ARR |
|-------|----------|-----|
| Cloud (B2C) | 1% de 1.5M × 15 € medio | ~225K € |
| Gestorías (B2B) | 500 gestorías × 39 €/mes | ~234K € |
| API | 200 integradores × 50 €/mes | ~120K € |
| **Total potencial** | | **~579K €** |

---

## Principios de diseño

1. **Privacidad primero**: los datos fiscales son los más sensibles que existen. Nunca salen de la máquina del usuario. Sin analytics, sin tracking, sin telemetría, sin cuentas de usuario. La única conexión de red es al API público del BCE.

2. **Precisión absoluta**: `Decimal.js` en todo cálculo monetario, tipos ECB oficiales, FIFO estricto. Un céntimo de error es inaceptable — estamos generando datos para Hacienda.

3. **Open source real**: el core es GPL-3.0 y siempre será gratis. La monetización viene de conveniencia (hosting, gestión multi-cliente), nunca de features básicas que necesita un contribuyente individual.

4. **Browser-first**: la mayoría de usuarios usarán la web. CLI y Docker son para power users y gestorías. Todo lo que funciona en la web debe funcionar offline (PWA).

5. **Modular y extensible**: cada broker es un módulo independiente con interfaz común. Cualquiera puede contribuir un parser nuevo sin tocar el motor fiscal.

6. **Alineado con la ley**: cada cálculo referencia el artículo de ley correspondiente (LIRPF, Ley del Patrimonio, Orden EHA). Si la ley cambia, el código se actualiza.

---

## Casillas del Modelo 100 (IRPF)

Referencia rápida de las casillas que DeclaRenta calcula:

### Base del ahorro — Ganancias y pérdidas patrimoniales

| Casilla | Concepto | Cómo se calcula |
|---------|----------|-----------------|
| **0327** | Valor de transmisión | Suma de (precio_venta × cantidad - comisión_venta) × tipo_ECB para cada venta |
| **0328** | Valor de adquisición | Suma del coste FIFO en EUR de los lotes consumidos por cada venta |
| **0358** | Pérdidas patrimoniales a compensar | Pérdidas netas no bloqueadas por anti-churning |

### Base del ahorro — Rendimientos del capital mobiliario

| Casilla | Concepto | Cómo se calcula |
|---------|----------|-----------------|
| **0029** | Dividendos íntegros | Suma bruta de dividendos × tipo_ECB |
| **0033** | Intereses de cuentas y depósitos | Intereses recibidos del broker × tipo_ECB |
| **0032** | Gastos deducibles | Intereses de margen pagados al broker × tipo_ECB |

### Deducciones

| Casilla | Concepto | Cómo se calcula |
|---------|----------|-----------------|
| **0588** | Deducción por doble imposición internacional | Por país: min(retención extranjera, impuesto español sobre esa renta) |

### Tramos del ahorro (ejercicio 2025)

| Base liquidable | Tipo |
|----------------|------|
| 0 – 6.000 € | 19% |
| 6.000 – 50.000 € | 21% |
| 50.000 – 200.000 € | 23% |
| 200.000 – 300.000 € | 27% |
| > 300.000 € | 30% (Ley 7/2024, Disposición final 7ª) |

### Reglas de compensación (Art. 49 LIRPF)

- Las **pérdidas patrimoniales** se compensan primero con ganancias patrimoniales del mismo ejercicio.
- El exceso se puede compensar con hasta el **25%** de los rendimientos positivos del capital mobiliario.
- Las pérdidas no compensadas se arrastran a los **4 ejercicios siguientes**.
- Regla simétrica: rendimientos negativos del capital mobiliario se compensan con hasta el 25% de las ganancias patrimoniales.

---

## Marco legal y referencias técnicas

### Normativa fiscal

| Referencia | Contenido |
|-----------|-----------|
| **Art. 37.2 LIRPF** | FIFO obligatorio para valores homogéneos |
| **Art. 33.5.f LIRPF** | Regla anti-churning: pérdidas no computables si se recompra el mismo valor en los 2 meses anteriores o posteriores a la venta |
| **Art. 80 LIRPF** | Deducción por doble imposición internacional |
| **Art. 49 LIRPF** | Compensación de pérdidas: arrastre 4 años, compensación cruzada 25% |
| **Art. 46 LIRPF** | Base liquidable del ahorro: ganancias + rendimientos del capital mobiliario |
| **Ley 19/1991 (Patrimonio)** | Valoración de acciones cotizadas: media Q4 |
| **Orden EHA/3290/2008** | Diseño de registro Modelo 720 |
| **RD 1065/2007, DA 18ª** | Obligación de información sobre bienes en el extranjero |

### Formatos técnicos

| Formato | Especificación |
|---------|---------------|
| **IBKR Flex Query XML** | 40+ secciones, `fast-xml-parser` con `isArray` para arrays correctos |
| **Modelo 720** | Fixed-width 500 bytes/registro, ISO-8859-15, tipo 1 (resumen) + tipo 2 (detalle) |
| **ECB SDMX API** | `https://data-api.ecb.europa.eu/service/data/EXR` — tipos diarios, invertidos a EUR/FCY |
| **AEAT Modelo 100 XSD** | `Renta20XX.xsd` (~793 KB), publicado anualmente por AEAT |

