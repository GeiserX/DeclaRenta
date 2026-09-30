# Privacidad

## Arquitectura sin servidor

DeclaRenta no tiene backend. No hay servidor que reciba tus datos. La aplicación web es un conjunto de ficheros estáticos (HTML, CSS, JavaScript) que se ejecutan íntegramente en tu navegador.

## Sin analítica, sin tracking, sin telemetría

No hay Google Analytics, ni cookies de terceros, ni píxeles de seguimiento, ni ninguna forma de telemetría. No se recopila ningún dato de uso.

## Única conexión de red

La única petición que DeclaRenta realiza a Internet es a la **API pública del BCE** (`data-api.ecb.europa.eu`) para obtener tipos de cambio oficiales. Esta petición no contiene ningún dato personal ni financiero: solo solicita tipos de cambio para un año y divisa concretos.

## Procesamiento local

Todos los cálculos — parseo de ficheros, FIFO, detección de anti-churning, generación de modelos — se ejecutan en tu navegador mediante JavaScript. Tus extractos del broker nunca salen de tu equipo.

Lo que sí queda en tu equipo: la web guarda el perfil fiscal y los resúmenes por año en el `localStorage` del navegador, para no subirlos a ningún servidor. Puedes borrarlos desde la comparativa interanual o limpiando los datos del sitio.

## Código abierto

El código fuente está disponible en [GitHub](https://github.com/GeiserX/DeclaRenta) bajo licencia AGPL-3.0. Cualquiera puede auditar el código, verificar que no hay transmisión de datos y contribuir mejoras.

El pie de la web muestra la versión y el commit exactos desplegados, para que compruebes que coinciden con el código fuente en GitHub.
