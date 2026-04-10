# Roadmap de DeclaRenta

> Ultima actualizacion: abril 2026

## Vision

DeclaRenta es la herramienta open source de referencia para que los residentes fiscales espanoles con brokers extranjeros hagan su declaracion de la renta sin dolor. Privacidad absoluta: los datos nunca salen de la maquina del usuario.

---

## Fase 0: Foundation (abr 2026) — EN CURSO

Objetivo: esqueleto funcional con IBKR → casillas Modelo 100.

- [x] Repo, licencia GPL-3.0, estructura TypeScript
- [x] Tipos: IBKR Flex XML, Tax (Lot, Disposal, Dividend), ECB rates
- [x] Parser IBKR Flex Query XML (`fast-xml-parser`)
- [x] Motor ECB: fetch tipos diarios via SDMX API, cache, fallback festivos
- [x] Motor FIFO: lots, consumo parcial, Decimal.js everywhere
- [x] Deteccion regla anti-churning (Art. 33.5.f LIRPF, 2 meses)
- [x] Procesamiento dividendos + retenciones extranjeras
- [x] Calculo doble imposicion internacional (Art. 80 LIRPF)
- [x] Generador Modelo 720 (fixed-width 500 bytes/registro, ISO-8859-15)
- [x] CLI: `declarenta convert`, `declarenta modelo720`
- [x] Web UI basica: upload XML → ver casillas → exportar JSON
- [x] Tests: parser, FIFO, wash sale
- [x] CI/CD: GitHub Actions, lint, typecheck, test
- [x] Docker image
- [ ] `npm install` + verificar que tests pasan
- [ ] Validar con datos IBKR reales (tus propios datos 2025)
- [ ] Publicar v0.1.0

**Entregable**: CLI y web que producen casillas Modelo 100 desde IBKR Flex XML.

---

## Fase 1: Pulido y validacion (may 2026)

Objetivo: que los calculos sean correctos al centimo, validados contra datos reales.

- [ ] Test con tus datos IBKR 2024/2025 — verificar contra calculo manual
- [ ] Manejo de corporate actions (splits, mergers) en FIFO
- [ ] Soporte multi-divisa simultaneo (USD, GBP, CHF, etc.)
- [ ] Comisiones incluidas correctamente en coste/venta (ya parcial)
- [ ] Informe detallado por operacion con tipo ECB usado
- [ ] Manejo de posiciones abiertas cross-year (lots comprados en anos anteriores)
- [ ] Edge cases: ventas parciales, lotes de 0, dividendos en especie
- [ ] Mas tests con fixtures realistas (10+ escenarios)
- [ ] Documentacion de cada casilla y como se calcula
- [ ] ESLint config estricta
- [ ] Web UI: tabla de operaciones con filtros, exportar CSV
- [ ] Publicar v0.2.0

---

## Fase 2: Mas brokers (jun-jul 2026)

Objetivo: soporte multi-broker para cubrir el grueso del mercado espanol.

- [ ] **Parser Degiro**: CSV annual report (acciones, ETFs, dividendos)
- [ ] **Parser Trade Republic**: CSV/PDF export
- [ ] **Parser Revolut**: CSV trading statement
- [ ] **Parser eToro**: account statement XLS
- [ ] FIFO cross-broker: consolidar lots de multiples brokers para el mismo ISIN
- [ ] Interfaz web: seleccionar broker → subir fichero
- [ ] Tests por broker con fixtures anonimizados
- [ ] Publicar v0.3.0

---

## Fase 3: Modelo 720 + D-6 completos (ago-sep 2026)

Objetivo: cubrir todas las obligaciones fiscales de un inversor con broker extranjero.

- [ ] **Generador D-6**: inversiones en el exterior (deadline: 31 enero)
- [ ] Mejora Modelo 720: deteccion automatica de umbral 50K, tipo declaracion (A/M/C)
- [ ] Valoracion 720 correcta: media Q4 o cierre 31 dic segun Ley Patrimonio
- [ ] Soporte 721 (crypto en el extranjero)
- [ ] Multi-year: carryforward de perdidas (Art. 49 LIRPF, 4 anos)
- [ ] Informe PDF descargable (resumen ejecutivo + detalle operaciones)
- [ ] Publicar v0.5.0

---

## Fase 4: Web UI completa (oct-nov 2026)

Objetivo: experiencia web de calidad profesional, zero-server.

- [ ] Wizard multi-paso: elige broker → sube fichero → revisa → descarga
- [ ] Tabla interactiva de operaciones con ordenacion y filtros
- [ ] Graficos: distribucion por tipo de activo, ganancia/perdida por mes
- [ ] Modo oscuro/claro
- [ ] PWA: funciona offline una vez cargada
- [ ] i18n: catalan, euskera, gallego
- [ ] Deploy en GitHub Pages (coste cero)
- [ ] Accesibilidad WCAG 2.1 AA
- [ ] Publicar v0.8.0

---

## Fase 5: Lanzamiento v1.0 (dic 2026 - ene 2027)

Objetivo: listo para la campana de renta 2026 (abr-jun 2027).

- [ ] Todos los tests pasan con datos reales de 3+ brokers
- [ ] XML validado contra XSD de AEAT (Renta2026.xsd)
- [ ] Documentacion completa: guia de uso, FAQ, video tutorial
- [ ] Security audit (OWASP, CSP headers en web)
- [ ] Performance: procesar 10.000 operaciones en <2 segundos
- [ ] Publicar v1.0.0
- [ ] Publicar en awesome-spain
- [ ] Publicar en npm

---

## Post-v1.0: Crecimiento (2027+)

### Comunidad
- [ ] Show HN: "Open-source tool: broker reports → Spanish tax declarations, all in-browser"
- [ ] Post en Rankia (subforo Fiscalidad)
- [ ] Post en r/SpainFIRE + r/SpainPersonalFinance
- [ ] Contactar Value School, Gregorio Hernandez (YouTube)
- [ ] Grupos Telegram: Inversores Espanoles, FIRE Espana

### Funcionalidades avanzadas
- [ ] Crypto: Binance, Kraken, Coinbase, wallets on-chain
- [ ] Opciones y futuros (IBKR)
- [ ] Bonos y letras del tesoro
- [ ] Doble imposicion avanzada: aplicar convenios bilaterales por pais
- [ ] Complementarias: detectar errores en declaraciones anteriores
- [ ] MCP server para integracion con Claude/ChatGPT
- [ ] n8n node

### Monetizacion potencial (preservando core OSS GPL-3.0)
- [ ] Cloud hosted (conveniencia, sin instalar nada)
- [ ] Modo gestoria: procesamiento batch multi-cliente
- [ ] Optimizador fiscal IA: sugerencias de tax-loss harvesting
- [ ] API para integraciones con software de gestorias (A3, Sage)
- [ ] Envio directo a AEAT con certificado digital (si AEAT lo permite)

### Numeros potenciales
- ~1.5M residentes espanoles usan brokers extranjeros
- TaxDown cobra 75-239 EUR/ano → DeclaRenta gratis o 29-49 EUR para premium
- B2C: 1% conversion × 35 EUR = ~525K ARR
- B2B: 500 gestorias × 300 EUR/ano = ~150K ARR
- Potencial ano 2-3: ~675K+ ARR

---

## Principios de diseno

1. **Privacidad primero**: los datos fiscales son los datos mas sensibles. Nunca salen de la maquina del usuario.
2. **Precision absoluta**: Decimal.js everywhere, tipos ECB oficiales, FIFO estricto. Un centimo de error es inaceptable.
3. **Open source real**: el core es GPL-3.0 y siempre sera gratis. La monetizacion viene de conveniencia y servicios adicionales, no de features basicas.
4. **Browser-first**: la mayoria de usuarios usaran la web. CLI y Docker son para power users y gestorias.
5. **Comunidad**: los parsers de brokers los puede mantener la comunidad. Cada broker es un modulo independiente.

---

## Referencias tecnicas

- **AEAT Modelo 100 XSD**: `Renta2025.xsd` (793 KB, publicado por AEAT anualmente)
- **AEAT Modelo 720**: formato fixed-width 500 bytes/registro, ISO-8859-15
- **Art. 37.2 LIRPF**: FIFO obligatorio para valores homogeneos
- **Art. 33.5.f LIRPF**: regla anti-churning (2 meses)
- **Art. 80 LIRPF**: deduccion por doble imposicion internacional
- **ECB SDMX API**: tipos de cambio diarios oficiales
- **IBKR Flex Query XML**: 40+ secciones, parser basado en `fast-xml-parser`
- **burocratin** (vaijira): referencia para formato AEAT 720 (Rust/WASM, AGPL-3.0)
- **IBKR-RENTA** (AlbertoPorras): referencia para mapeo casillas Modelo 100 (JS)
- **ibflex** (csingley): referencia para campos Flex Query (Python, BSD)
