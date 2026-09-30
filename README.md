<p align="center">
  <img src="docs/images/banner.svg" alt="DeclaRenta" width="100%"/>
</p>

<p align="center">
  <a href="https://github.com/GeiserX/DeclaRenta/releases"><img src="https://img.shields.io/github/v/release/GeiserX/DeclaRenta?style=flat-square" alt="Última versión"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/GeiserX/DeclaRenta/ci.yml?style=flat-square&label=CI" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GeiserX/DeclaRenta?style=flat-square" alt="Licencia"/></a>
  <a href="https://hub.docker.com/r/drumsergio/declarenta"><img src="https://img.shields.io/docker/pulls/drumsergio/declarenta?style=flat-square&logo=docker" alt="Descargas en Docker Hub"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/stargazers"><img src="https://img.shields.io/github/stars/GeiserX/DeclaRenta?style=flat-square&logo=github" alt="Estrellas"/></a>
</p>

DeclaRenta es una aplicación web gratuita que lee los informes de tu broker extranjero y calcula las casillas de la renta con FIFO y los tipos de cambio oficiales del BCE. Renta Web no importa esos datos, así que sin esto hay que hacerlo a mano. Funciona en [declarenta.com](https://declarenta.com) sin registro, o en tu propio equipo con Docker.

<p align="center"><img src="docs/images/screenshots/resultados.png" alt="Resultados del Modelo 100 en DeclaRenta: las casillas 0328, 0331, 0029, 0027 y 0588 del ejercicio 2024 calculadas a partir de informes de cinco brokers" width="100%"/></p>

## Funcionalidades

- Tus ventas de IBKR, Degiro y otros 11 brokers en un solo FIFO, con el tipo del BCE del día de cada operación.
- Las casillas 0328, 0331, 1633, 1637, 0029, 0027 y 0588 del Modelo 100 con su importe, y una guía de dónde escribir cada una en Renta Web.
- El fichero del Modelo 720 listo para subir a la AEAT, validado contra la especificación del BOE, y el aviso de si superas los 50.000 EUR.
- La revisión del Modelo 721 (cripto) y la guía del D-6 a partir de los mismos ficheros.
- La regla anti-churning aplicada de forma proporcional, la deducción por doble imposición por país y la compensación de pérdidas de cuatro años.
- Splits, fusiones, spin-offs y scrip dividends tratados según la LIRPF, para acciones, ETFs, opciones, futuros, forex, bonos, CFDs y cripto.
- Gráficas, comparativa con años anteriores, exportación a JSON, CSV y PDF, y una traza del motor de divisas para auditar cada cifra.
- Todo se calcula en tu navegador: sin cuenta, sin analítica y sin subir nada; la única conexión es al BCE para los tipos de cambio.

## Inicio rápido

Entra en [declarenta.com](https://declarenta.com), pulsa Comenzar y arrastra el informe de tu broker (`.xml`, `.csv`, `.json` o `.xlsx`). En tres pasos verás cada casilla del Modelo 100 con su importe. Para alojarlo tú mismo:

```bash
docker run -p 8080:80 drumsergio/declarenta:0.58.30
```

Luego abre `http://localhost:8080`. Ficheros de ejemplo, la CLI y el hosting estático están en [Primeros pasos](https://geiserx.github.io/DeclaRenta/docs/getting-started/).

## Documentación

La documentación completa está en **[geiserx.github.io/DeclaRenta/docs](https://geiserx.github.io/DeclaRenta/docs/)**. La aplicación está en [declarenta.com](https://declarenta.com).

- [Primeros pasos](https://geiserx.github.io/DeclaRenta/docs/getting-started/): la web, tu primera declaración, Docker y la CLI
- [Uso](https://geiserx.github.io/DeclaRenta/docs/usage/): las secciones de la web y todos los comandos
- [Brokers soportados](https://geiserx.github.io/DeclaRenta/docs/brokers/): el fichero que exportar de cada broker
- [Modelos fiscales y motor fiscal](https://geiserx.github.io/DeclaRenta/docs/modelos-fiscales/): las reglas que aplica el motor
- [Casillas del Modelo 100](https://geiserx.github.io/DeclaRenta/docs/casillas/): cada casilla con su fórmula y su base legal
- [Modelo 720, 721 y D-6](https://geiserx.github.io/DeclaRenta/docs/modelos-informativos/): umbrales, ficheros y guías
- [Traza del motor de divisas](https://geiserx.github.io/DeclaRenta/docs/traza-fx/): el modo diagnóstico para las casillas 1633 y 1637
- [Preguntas frecuentes](https://geiserx.github.io/DeclaRenta/docs/faq/): las dudas de cada campaña
- [Solución de problemas](https://geiserx.github.io/DeclaRenta/docs/troubleshooting/): síntoma, causa y solución
- [Privacidad](https://geiserx.github.io/DeclaRenta/docs/privacidad/): qué se procesa, dónde y qué sale de tu equipo
- [Desarrollo](https://geiserx.github.io/DeclaRenta/docs/development/): build, tests, contribuir y soporte

Errores y propuestas: [GitHub Issues](https://github.com/GeiserX/DeclaRenta/issues). Novedades: el canal de Telegram [@declarenta](https://t.me/declarenta). Listado en [awesome-spain](https://github.com/GeiserX/awesome-spain#readme).

## Descargo de responsabilidad

DeclaRenta es una ayuda de cálculo, no asesoramiento fiscal. Comprueba cada importe, o pídeselo a un profesional, antes de presentarlo a la Agencia Tributaria: la declaración es responsabilidad de quien la firma.

## Licencia

[AGPL-3.0-or-later](LICENSE). Si ofreces una versión modificada como servicio en red, debes ofrecer su código fuente a sus usuarios.
