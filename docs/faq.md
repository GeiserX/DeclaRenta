# Preguntas frecuentes

### ¿Mis datos salen de mi ordenador?

No. Todo el procesamiento ocurre en tu navegador. Ningún fichero se sube a ningún servidor. La única conexión de red es a la API pública del BCE para obtener tipos de cambio.

### ¿Qué tipos de cambio se usan?

Los tipos de cambio oficiales diarios del Banco Central Europeo (BCE), obtenidos vía su API SDMX. La normativa fiscal española exige usar tipos oficiales, no los del broker.

### ¿Qué pasa si compré en un broker y vendí en otro?

DeclaRenta implementa FIFO cross-broker. Si subes ficheros de varios brokers, todas las operaciones del mismo ISIN comparten una única cola FIFO ordenada cronológicamente.

### ¿DeclaRenta sustituye a un asesor fiscal?

No. DeclaRenta es una herramienta auxiliar de cálculo. Los resultados deben validarse con un profesional fiscal. La responsabilidad de la declaración es siempre del contribuyente.

### ¿Puedo usar DeclaRenta sin conexión a Internet?

Sí. La aplicación web es una PWA (Progressive Web App) que funciona offline una vez cargada. Sin embargo, necesitarás conexión la primera vez para descargar la aplicación y cada vez que se necesiten tipos de cambio nuevos del BCE.

### ¿Cómo se tratan las opciones?

Las opciones se procesan con FIFO por símbolo (ya que no tienen ISIN). El multiplicador del contrato se aplica automáticamente al calcular el coste base y los importes de venta. La norma anti-churning no se aplica a opciones.

### ¿Se soportan los CFDs?

Sí, parcialmente. Los CFDs de acciones e índices en eToro se procesan como ganancias y pérdidas patrimoniales. Los CFDs de criptomonedas no están soportados. Otros brokers de CFDs (como XTB) están planificados para futuras versiones.

### ¿Los dividendos en especie se incluyen?

Sí. Los scrip dividends (dividendos pagados en acciones) se detectan como acciones corporativas y crean nuevos lotes FIFO con el coste base equivalente al dividendo.

### ¿Cómo se calcula la deducción por doble imposición?

Para cada país, se compara el impuesto retenido en origen (contado hasta el 15% del bruto, el límite de la mayoría de los convenios) con la cuota española que correspondería sobre esa renta (el bruto por tu tipo medio del ahorro). La deducción es el menor de ambos importes. Véase la sección [Doble imposición internacional](modelos-fiscales.md#doble-imposicion-internacional).

### ¿Puedo procesar varios años a la vez?

Sí. Puedes subir ficheros de varios ejercicios. DeclaRenta los ordena cronológicamente para calcular el FIFO correctamente y luego filtra los resultados al ejercicio seleccionado. Esto es fundamental si tienes posiciones abiertas de años anteriores.

### ¿DeclaRenta genera el borrador de la renta?

No. DeclaRenta genera los valores numéricos de cada casilla. Debes introducirlos manualmente en Renta Web (sede.agenciatributaria.gob.es) ya que la AEAT no permite importar estos datos por fichero.

### ¿Qué hago con las pérdidas bloqueadas por anti-churning?

Sí tienes que actuar: **no es automático**. Se bloquea solo la parte proporcional a las acciones recompradas (el resto de la pérdida se imputa con normalidad). Por el importe bloqueado, marca la casilla **«Pérdidas patrimoniales no imputables»** en Renta Web. Esa pérdida bloqueada **no se suma al coste** de la nueva posición: queda diferida y deberás imputarla en el ejercicio en que vendas acciones de ese valor que ninguna recompra en los 2 meses anteriores o posteriores cubre (1 año si el valor no está admitido a negociación ni en un mercado regulado del Espacio Económico Europeo ni en un mercado de un tercer país declarado equivalente por la Comisión Europea, art. 33.5.g LIRPF; como NYSE y Nasdaq, consulta DGT V0778-25): es la transmisión definitiva. Plazo de cada valor: DeclaRenta aplica 2 meses a todo valor con ISIN, salvo que IBKR solo lo muestre en un mercado sin equivalencia (Londres desde 2021, SIX desde julio de 2019, OTC Markets…) o que tú lo marques con 1 año en el panel «Plazo anti-churning por valor» (en la línea de comandos, `--antichurning-1y`). Toronto, Tokio y Singapur tienen una decisión de equivalencia y usan 2 meses, aunque ninguna consulta lo confirma para acciones. Si tu valor también cotiza en un mercado regulado del Espacio Económico Europeo o en NYSE, márcalo con 2 meses. En las criptomonedas solo cuenta la recompra de la misma criptomoneda en el año siguiente a la venta, y DeclaRenta lo aplica así (art. 33.5.e LIRPF, «otros elementos patrimoniales», issue #457): las compras anteriores a la venta no bloquean nada. Es una deducción de la doctrina de la DGT (las criptomonedas no son valores, consulta V0525-25; la letra e se aplica a los dólares, V1613-25), no un criterio que una consulta haya confirmado. Excepción de compra única: una compra en los 2 meses anteriores a la venta no bloquea si fue la única compra de ese valor en ese plazo y al empezarlo no tenías acciones de ese valor (DGT V3282-18, Manual de Renta 2025); una compra en los 2 meses posteriores bloquea siempre. DeclaRenta la aplica solo en el plazo de 2 meses y solo si tus ficheros demuestran que no tenías acciones al empezar el plazo: deben llegar a ese día e incluir las posiciones a fin de periodo de cada bróker (en IBKR, la sección Open Positions), sin más acciones de las que explican sus operaciones; si no, te avisa y no la aplica. La versión 0.66.13 y las anteriores no la aplicaban: si presentaste un año con esa pérdida bloqueada, puedes corregirlo para deducirla. Esas versiones tampoco elegían las recompras en el orden de la DGT (primero la compra más antigua que ninguna venta haya usado, issue #454): si un año presentado con ellas cambia ahora, corrígelo (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: complementaria si sale a ingresar, solicitud de rectificación si sale a devolver). Si recompras parte, solo son definitivas las acciones no recompradas, y cada una libera la pérdida pendiente de una acción, primero la más antigua. Una venta que deja la posición a cero libera todo lo pendiente solo si ninguna recompra de su plazo la cubre. Si declaraste un año con la versión 0.66.5 o anterior, puede que ya dedujeras una pérdida que debía seguir diferida: no la deduzcas otra vez cuando DeclaRenta la libere ahora, o corrige aquel año (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: autoliquidación complementaria). Y al revés: si la versión actual libera una pérdida en un año que ya presentaste, puedes corregir aquel año para deducirla (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: solicitud de rectificación). En las criptomonedas, si declaraste un año con la versión 0.66.13 o anterior, una compra anterior a la venta podía bloquear la pérdida: si DeclaRenta deduce o libera ahora una pérdida de criptomonedas en un año que ya presentaste, corrige aquel año para deducirla (2024 y posteriores: autoliquidación rectificativa; 2023 y anteriores: solicitud de rectificación); si no, no se deduce nunca. Si una versión anterior ya la liberó en un año posterior, corrige también ese año para no deducirla dos veces. DeclaRenta las muestra resaltadas para que lleves el control.

### ¿Puedo exportar los resultados?

Sí. Desde la web puedes exportar en JSON o CSV. Desde el CLI también puedes generar un informe en PDF. El JSON incluye todos los detalles de cada operación, dividendo y cálculo.

### ¿Por qué la ganancia neta no coincide con la diferencia entre el valor de transmisión y el de adquisición?

Ver [Ganancia neta distinta de transmisión menos adquisición](troubleshooting.md#ganancia-neta-distinta-de-transmision-menos-adquisicion) en Solución de problemas.

### ¿Tengo ventas sin lotes previos ("venta sin lotes"). ¿Qué significa?

Ver [Venta sin lotes previos](troubleshooting.md#venta-sin-lotes-previos) en Solución de problemas.

### ¿Necesito declarar si mis posiciones no superan 50.000 EUR?

Depende del modelo. El Modelo 720 y 721 requieren superar 50.000 EUR por categoría. El Modelo D-6, desde la Orden ICT/1408/2021, suele limitarse a participaciones del 10% o más en sociedades cotizadas extranjeras. El IRPF (Modelo 100) se declara siempre, independientemente del importe.

### ¿DeclaRenta maneja criptomonedas?

Parcialmente. Los parsers de Coinbase, Binance y Kraken extraen operaciones de compraventa de criptoactivos. El cálculo FIFO y las ganancias patrimoniales funcionan para cripto. El Modelo 721 está en fase inicial y requiere posiciones manuales.
