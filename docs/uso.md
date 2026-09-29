# Uso

## Despliegue rápido

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GeiserX/DeclaRenta)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/GeiserX/DeclaRenta)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/from?repoUrl=https://github.com/GeiserX/DeclaRenta)

DeclaRenta es una web estática (Vite) — funciona en cualquier hosting de archivos estáticos. También disponible como imagen Docker (la web servida con nginx): `drumsergio/declarenta:0.58.27`.

## Inicio rápido

### Web (recomendado)

Visita [declarenta.com](https://declarenta.com) — arrastra tus ficheros y listo.

Soporta `.xml`, `.csv`, `.json` y `.xlsx`. Se pueden subir varios ficheros a la vez para FIFO cruzado entre brokers.

### Docker

La imagen publicada sirve la web con nginx; para la CLI, usa la instalación de abajo.

```bash
docker run -p 8080:80 drumsergio/declarenta:0.58.27
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
