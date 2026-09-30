# Modelo 720, 721 y D-6

Las tres declaraciones informativas que DeclaRenta prepara a partir de los mismos ficheros: el fichero del 720, la revisión del 721 y la guía del D-6.

## Modelo 720

![La sección Modelo 720 del ejercicio 2024: los datos del perfil fiscal, la barra del umbral de 50.000 euros, la posición declarable y el botón Generar fichero Modelo 720](images/screenshots/modelo-720.png)

### Qué es

El Modelo 720 es una declaración informativa de bienes y derechos situados en el extranjero. No tiene cuota a pagar; es puramente informativo. Lo gestiona la Agencia Tributaria (AEAT).

### Quién debe presentarlo

Cualquier residente fiscal en España que a 31 de diciembre posea bienes en el extranjero cuyo valor **por categoría** supere los **50.000 EUR**. Las tres categorías independientes son:

- **Valores y derechos** (acciones, fondos, bonos) — la que DeclaRenta calcula.
- **Cuentas en entidades financieras** — no aplica a posiciones del broker.
- **Bienes inmuebles** — no aplica a posiciones del broker.

Cada categoría se evalúa de forma independiente. Solo se declaran las categorías que superan el umbral.

### Plazo de presentación

Del **1 de enero al 31 de marzo** del ejercicio siguiente.

### Qué genera DeclaRenta

Un fichero de texto de **ancho fijo** (500 bytes por registro) codificado en **ISO-8859-15**, listo para subir a la AEAT. El fichero contiene:

- Un **registro resumen** (tipo 1) con datos del declarante y totales.
- Un **registro detalle** (tipo 2) por cada posición: clave V para acciones (subclave 1) y bonos (subclave 2), clave I para fondos extranjeros; el país donde está depositada (el del bróker) o, en un fondo, el país del fondo; ISIN, valoración a 31/dic, cantidad y porcentaje de titularidad (100 entre el número de titulares del perfil, con el valor completo sin prorratear).
- Un registro de **cuenta** (clave C) por cada saldo en efectivo con media del cuarto trimestre, con el número de cuenta en el campo de código de cuenta.
- Registros de tipo **A** (alta), **M** (modificación) o **C** (cancelación) según si la posición es nueva, ya existía o se ha vendido.

Las posiciones sin ISIN y los bienes o cuentas sin país conocido no caben en el fichero: DeclaRenta los lista para que los declares a mano en el formulario.

Para acciones (STK), la valoración se calcula con el **tipo medio del cuarto trimestre** del BCE. Para fondos y bonos, se usa el tipo a 31 de diciembre.

### Cómo presentarlo en sede electrónica

1. Accede a **sede.agenciatributaria.gob.es**.
2. Busca "Modelo 720" o navega a *Todas las gestiones > Modelos y formularios > 720*.
3. Selecciona **TGVI Online** (Transmisión de Grandes Volúmenes de Información).
4. Identifícate con certificado digital, DNIe o Cl@ve PIN.
5. Sube el fichero generado por DeclaRenta.
6. Revisa el resumen y confirma el envío.

## Modelo 721

### Qué es

El Modelo 721 es la declaración informativa de monedas virtuales situadas en el extranjero. Es el equivalente del Modelo 720 para criptoactivos.

### Quién debe presentarlo

Cualquier residente fiscal en España que a 31 de diciembre posea criptomonedas en exchanges extranjeros cuyo valor total supere los **50.000 EUR**.

### Exchanges aplicables

Cualquier exchange con sede fuera de España. Los más comunes son Coinbase, Binance y Kraken. Si el exchange tiene sede en España (como Bit2Me), no es necesario declararlo en el 721.

### Qué genera DeclaRenta

La presentación oficial para programas externos se hace en XML según la Orden HFP/886/2023.

!!! warning

    DeclaRenta muestra una revisión orientativa de posiciones cripto, pero la generación oficial del Modelo 721 está desactivada hasta implementar y validar el XML AEAT.

## Modelo D-6

### Qué es

El Modelo D-6 es la declaración de inversiones españolas en el exterior, regulada por el Banco de España. Es independiente del Modelo 720 y se presenta ante la Dirección General de Comercio Internacional e Inversiones.

### Quién debe presentarlo

Desde la Orden ICT/1408/2021, el D-6 suele quedar limitado a participaciones que representen el **10% o más** del capital o derechos de voto de una sociedad cotizada extranjera. La mayoría de carteras minoristas están fuera de este supuesto.

### Plazo de presentación

Del **1 al 31 de enero** del ejercicio siguiente.

### Formulario web AFORIX

A diferencia del Modelo 720, el D-6 **no admite carga de fichero**. Se cumplimenta manualmente en el formulario web AFORIX del Banco de España, posición por posición.

### Qué genera DeclaRenta

Una **guía orientativa de cumplimentación** con los datos que necesitarías introducir en AFORIX si confirmas que existe obligación de presentar:

- ISIN, denominación y país emisor.
- Código de mercado (NYSE, Xetra, LSE, etc.).
- Número de títulos a 31 de diciembre.
- Valor de mercado en EUR al tipo ECB de 31 de diciembre.

Si proporcionas el D-6 del año anterior (vía `--previous-d6`), DeclaRenta genera también las **cancelaciones** para posiciones que ya no mantienes.

### Cómo acceder a AFORIX

1. Accede a **sefreca.bde.es/sefreca/**.
2. Selecciona "Modelo D-6 (Inversiones en el exterior)".
3. Identifícate con certificado digital o Cl@ve.
4. Introduce cada posición siguiendo la guía generada por DeclaRenta.
5. Revisa y envía.

## Perfil fiscal

Los tres necesitan el NIF, el nombre y los apellidos del declarante. En la web se rellenan una vez en la sección Perfil fiscal (`#perfil`) y se guardan en el navegador.

La CLI los recibe como `--nif` y `--name` (ver [Uso](usage.md#cli)).
