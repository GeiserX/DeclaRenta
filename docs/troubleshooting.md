# Solución de problemas

## Síntoma, causa, solución

### No se detectó tu broker

El fichero no coincide con ningún formato conocido, o coincide con el de otro broker. Debajo de la zona de subida, abre «¿No se detectó tu broker?»: ahí puedes forzar el broker y seguir la guía de exportación de cada uno (también en [Brokers soportados](brokers.md#como-exportar-el-informe-de-cada-broker)). En la CLI, fuerza el broker con `--broker <nombre>`.

### Venta sin lotes previos

Significa que DeclaRenta encontró una venta sin compras previas para ese ISIN. Puede deberse a: (a) una posición corta, (b) falta de datos de ejercicios anteriores, o (c) una transferencia de otro broker sin historial. En estos casos, el coste base se asume como 0 EUR y aparece una advertencia.

Si las acciones vienen de otro broker, introduce los lotes de compra originales en el panel «Lotes manuales para posiciones transferidas» de los resultados, o sube también los ficheros de los años anteriores.

### El ejercicio no coincide con los ficheros

Los resultados muestran el ejercicio más reciente que aparece en los ficheros. Si esperabas otro, elige el año en el selector «Ejercicio» de la barra superior de los resultados. Si el año no aparece, el fichero no contiene operaciones de ese ejercicio: exporta el rango de fechas completo.

### Faltan tipos de cambio

Los tipos se descargan de la API pública del BCE (`data-api.ecb.europa.eu`), que tiene que estar accesible desde tu navegador. Sin conexión, la PWA solo tiene los tipos que ya descargó en visitas anteriores. Si una red corporativa o un bloqueador corta esa petición, pruébalo desde otra red.

### El Modelo 720 pide el perfil fiscal

El fichero del 720 necesita NIF, nombre y apellidos. La sección del Modelo 720 muestra un aviso con un enlace a Perfil fiscal (`#perfil`): rellénalo una vez y vuelve al 720. Ver [Perfil fiscal](modelos-informativos.md#perfil-fiscal).

### Ganancia neta distinta de transmisión menos adquisición

Si hay pérdidas bloqueadas por la norma anti-churning, la ganancia neta "real" es menor que la aritmética. Las casillas de valor de transmisión (0328/1633) y de adquisición (0331/1637) reflejan los importes brutos; las pérdidas bloqueadas se declaran por separado.

Ver [Regla anti-churning](casillas.md#regla-anti-churning-art-335fg-lirpf).

## Informar de un error

Abre una incidencia en [GitHub Issues](https://github.com/GeiserX/DeclaRenta/issues) con:

- el broker y, si puedes, el fichero anonimizado (cambia cuentas, nombres e importes que no quieras compartir);
- el ejercicio;
- la versión que muestra el pie de la web;
- la traza del motor de divisas cuando la cifra dudosa es la 1633 o la 1637 (ver [Traza del motor de divisas](traza-fx.md)).
