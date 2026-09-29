# Desarrollo

[![Codecov](https://img.shields.io/codecov/c/github/GeiserX/DeclaRenta?style=flat-square&color=f59e0b)](https://codecov.io/gh/GeiserX/DeclaRenta)

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

## Contribuir

Las contribuciones son bienvenidas. Áreas donde más ayuda se necesita:

- **Parsers de brokers**: XTB, MyInvestor
- **Reglas fiscales**: casos edge de FIFO, convenios de doble imposición por país
- **Tests**: más fixtures con operaciones reales anonimizadas
- **Traducciones**: las traducciones a catalán, euskera y gallego son automáticas — se necesita revisión por hablantes nativos

## Comunidad y soporte

- [**GitHub Issues**](https://github.com/GeiserX/DeclaRenta/issues) — bugs, feature requests, preguntas técnicas (preferido)
- [**Telegram @declarenta**](https://t.me/declarenta) — canal de novedades y discusión

## Sponsor

Si DeclaRenta te ahorra tiempo (y dinero), considera apoyar el proyecto:

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-♥-ea4aaa?style=flat-square)](https://github.com/sponsors/GeiserX)
