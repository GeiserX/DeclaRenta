# Primeros pasos

## Web (recomendado)

Visita [declarenta.com](https://declarenta.com) y arrastra tus ficheros. No hace falta registrarse y los datos no salen de tu equipo.

Soporta `.xml`, `.csv`, `.json` y `.xlsx`. Se pueden subir varios ficheros a la vez para FIFO cruzado entre brokers. El formato de fichero de cada broker está en [Brokers soportados](brokers.md).

## Docker

La imagen publicada sirve la web con nginx en el puerto 80:

```bash
docker run -p 8080:80 drumsergio/declarenta:0.58.27
```

Después abre `http://localhost:8080`. Para la CLI, usa la instalación desde el código de [Uso](usage.md#cli).

## Despliegue en tu hosting

DeclaRenta es una web estática (Vite): funciona en cualquier hosting de archivos estáticos.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GeiserX/DeclaRenta)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/GeiserX/DeclaRenta)
