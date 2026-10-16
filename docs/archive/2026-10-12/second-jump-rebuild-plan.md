# FIS-14J — Reconstrucción del segundo salto

Actualizado: 11 de octubre de 2026. Estado: histórico de FIS-14J; el contrato
vigente fue corregido por FIS-19.

> **Corrección FIS-19.** La revisión directa de RocketSim no respalda añadir
> una elevación vertical al dodge. El solver vigente mantiene el impulso
> horizontal, el giro temporal y la amortiguación vertical pública; solo el
> doble salto sin dirección aporta el impulso vertical. Este documento conserva
> el diagnóstico original para explicar por qué se retiró esa separación
> vertical.

## Evidencia que limita el diseño

La inspección estática de Rocket League registra salto, doble salto y dodge
como ventanas temporales separadas. La de Car Soccer publica estados y seriales
separados para doble salto y dodge, además de una dirección local normalizada.
Ninguna de las dos aporta una curva de fuerza o constantes que se puedan
trasladar. La implementación seguirá siendo propia.

## Diagnóstico

El segundo salto vertical de Arsenal añadía elevación explícita, mientras que
cualquier entrada por encima del umbral convertía la acción en un dodge que
añadía únicamente su componente local. Con el coche nivelado, el componente
vertical de un dodge lateral era cero y la gravedad lo reducía en el mismo
paso. El resultado era un empujón plano, de escasa duración aérea, en vez de
una segunda acción aérea legible.

## Decisión

Mantener estas diferencias:

- Sin dirección: doble salto vertical, con más elevación y sin follow-through
  de dodge.
- Con dirección: dodge normalizado en ejes locales, giro comprometido y empuje
  hacia su dirección durante una ventana breve.

La decisión vigente no añade una separación vertical al dodge. La dirección se
captura en el flanco del segundo salto y se
aplica en los ejes delantero y lateral del quaternion actual del chasis; no se
proyecta sobre el suelo ni se retargetea con una entrada posterior.

## FIS-14K — contrato del input en el segundo salto

La entrada que decide un dodge es el estado aceptado en el mismo subpaso de la
pulsación de salto. `throttle` aporta el eje delantero; `steer` aporta la
guiñada si no está activo `airRoll`; `roll` aporta el eje lateral y, con free
air roll, evita contar dos veces la dirección del stick. La pareja se normaliza
antes de aplicar el impulso. Esto permite que W/S, A/D, diagonales y air roll
direccional produzcan acciones distintas sin regalar magnitud a una diagonal.

Durante la ventana comprometida no se vuelve a leer el input para cambiar la
dirección del impulso. Solo la entrada opuesta puede cancelar la rotación de la
acción; la velocidad ya aplicada permanece. Esta separación evita que una
pulsación tardía se convierta en una segunda dirección inventada.

REA confirma el contrato de ejes, estados separados y dirección local, pero no
expone la curva interna de fuerza del dodge. Por eso no se copian constantes ni
se afirma equivalencia numérica con Rocket League o Car Soccer.

## Métricas y puerta de salida

`npm run probe:envelope` publicará para doble salto, dodge frontal y dodge
lateral: cambio inicial de velocidad vertical, ápice a 0,175 s y serial de
acción. Debe cumplirse:

1. Ambos dodges nivelados no reciben un impulso vertical propio; el siguiente
   subpaso solo conserva la velocidad existente y aplica gravedad.
2. El doble salto sin dirección sí recibe el impulso vertical público.
3. Dirección, normalización, cancelación, ventana, contactos y cadencia de
   120 Hz conservan sus pruebas existentes.

La calibración visual posterior comparará salto + flip frontal, lateral,
diagonal, backflip y acción tardía. Una lectura subjetiva no autoriza cambiar
contactos, cámara o tasas aéreas en la misma iteración.

## Resultado FIS-14J y corrección FIS-19

La envolvente actual registra `+6,968 u/s` para el doble salto vertical y
`−0,133 u/s` para el dodge frontal y lateral en el primer subpaso. La pequeña
variación negativa es la gravedad; no es una elevación dirigida. La dirección
del dodge sigue capturándose en el flanco y sus ejes permanecen normalizados.

`npm test` mantiene 94 pruebas sin fallos. Las regresiones comprueban que el
dodge no añade elevación vertical, que el doble salto sí recibe su impulso, que
la dirección queda comprometida y que el pulso mínimo del primer salto abre la
ventana en el momento correcto. También comprueban que la dirección no se
aplica de nuevo en el subpaso siguiente y se
recupera al activar el dodge tarde dentro de la ventana. También comprueban
que W/S y air roll direccional quedan capturados en el flanco, que las
diagonales se normalizan y que el chasis inclinado usa su base local. La
prueba visual sigue pendiente porque `src/simulation.js` requiere reiniciar el
servidor autoritativo para que la pestaña local cargue esta física.
