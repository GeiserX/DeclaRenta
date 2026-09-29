<p align="center">
  <img src="docs/images/banner.png" alt="DeclaRenta banner" width="100%"/>
</p>

<h1 align="center">DeclaRenta</h1>

<p align="center">
  <strong>Herramienta fiscal gratuita para inversores con brokers internacionales.</strong>
</p>
<p align="center">
  <a href="https://github.com/GeiserX/DeclaRenta/releases"><img src="https://img.shields.io/github/v/release/GeiserX/DeclaRenta?style=flat-square&color=dc2626" alt="Release"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/actions"><img src="https://img.shields.io/github/actions/workflow/status/GeiserX/DeclaRenta/ci.yml?style=flat-square&label=CI" alt="CI"/></a>
  <a href="https://github.com/GeiserX/DeclaRenta/blob/main/LICENSE"><img src="https://img.shields.io/github/license/GeiserX/DeclaRenta?style=flat-square&color=dc2626" alt="License"/></a>
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

DeclaRenta lee los informes de tu broker extranjero y calcula las casillas de la renta con FIFO y tipos de cambio oficiales del BCE. Renta Web no importa esos datos, así que sin esto hay que hacerlo a mano.

## Funcionalidades

- Lee 13 brokers: IBKR, Degiro, Flatex, Scalable Capital, eToro, Freedom24, Revolut, Lightyear, Trade Republic, Trading 212, Coinbase, Binance y Kraken. Detecta el broker solo y combina varios para FIFO cruzado.
- Calcula las casillas 0328, 0331, 1633, 1637, 0029, 0027 y 0588 del Modelo 100 y las exporta a JSON, CSV o PDF.
- Genera el Modelo 720 en formato AEAT, validado contra la especificación del BOE, y da una revisión del 721 y una guía del D-6.
- Aplica FIFO estricto con tipos ECB por fecha de operación a acciones, ETFs, opciones, futuros, forex, bonos, CFDs y cripto.
- Aplica la regla anti-churning proporcional (Art. 33.5.f/g LIRPF), la doble imposición por país, splits, fusiones, spin-offs y la compensación de pérdidas de 4 años.
- La web guía paso a paso, con instrucciones por broker, gráficas, comparativa interanual, PWA offline, tema claro/oscuro y 5 idiomas.
- Hay CLI e imagen Docker, con una traza de diagnóstico del motor de divisas.
- Tus datos no salen de tu equipo. Sin analytics ni telemetría.

## Inicio rápido

Entra en [declarenta.com](https://declarenta.com) y arrastra tus ficheros `.xml`, `.csv`, `.json` o `.xlsx`. Para alojarlo tú mismo, usa Docker o uno de los botones.

```bash
docker run -p 8080:80 drumsergio/declarenta:web
```

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GeiserX/DeclaRenta)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/GeiserX/DeclaRenta)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/from?repoUrl=https://github.com/GeiserX/DeclaRenta)

## Documentación

- [Uso](docs/uso.md), con despliegue, web, Docker y todos los comandos de la CLI
- [Brokers soportados](docs/brokers.md) y el formato de fichero de cada uno
- [Modelos fiscales y motor fiscal](docs/modelos-fiscales.md), con las reglas que aplica el motor
- [Casillas del Modelo 100](docs/casillas.md), cada casilla con su base legal
- [Traza del motor de divisas (FX)](docs/traza-fx.md), el modo diagnóstico para auditar las casillas 1633/1637
- [Privacidad](docs/privacidad.md)
- [Desarrollo, contribuir y soporte](docs/desarrollo.md)
- [Roadmap](ROADMAP.md)

Dudas y novedades: [GitHub Issues](https://github.com/GeiserX/DeclaRenta/issues) y el canal de Telegram [@declarenta](https://t.me/declarenta). Listado en [awesome-spain](https://github.com/GeiserX/awesome-spain#readme).

## Licencia

[AGPL-3.0-or-later](LICENSE). Puedes usar, modificar y redistribuir DeclaRenta. Si distribuyes una versión modificada, debes entregar su código fuente, bajo la misma licencia, a quien la reciba. Si ofreces una versión modificada como servicio en red, debes ofrecer su código fuente a los usuarios de ese servicio (sección 13 de la AGPL).
