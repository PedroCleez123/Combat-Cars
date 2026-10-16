# Plan de estabilidad de cámara

Actualizado: 10 de octubre de 2026.

## Problema observado

Durante un giro aéreo o un air roll, el coche responde con la orientación
correcta, pero la cámara copiaba el quaternion completo del chasis. El vector
`up` del coche se usaba para construir el foco, así que el alabeo desplazaba el
foco de lado y podía hacer girar el horizonte. Cerca de un cabeceo vertical, el
vector delantero también podía dejar de tener una proyección horizontal válida.
El resultado era un cambio brusco y confuso aunque la simulación fuese estable.

## Evidencia y límite de las referencias

La ingeniería inversa disponible de Car Soccer confirma una presentación
interpolada del estado autoritativo, orientación completa y cadencia de 120 Hz;
no expone en JavaScript una política de cámara equivalente porque la física
está enlazada a WebAssembly. El registro de Rocket League y la observación de
la experiencia objetivo indican que el jugador debe conservar un horizonte
legible mientras el coche rota en el aire. No se copian código, constantes ni
recursos externos: la política se implementa como una capa propia de
presentación.

## Decisiones

1. El chasis sigue renderizando su quaternion completo para que pitch, yaw y
   roll sean visibles en el vehículo.
2. La cámara deriva el rumbo solo de la proyección horizontal del morro. Si el
   morro queda casi vertical, conserva el último rumbo válido.
3. El rumbo cambia con una velocidad máxima de `7,5 rad/s`, evitando saltos de
   180° por una muestra interpolada o por atravesar el eje vertical.
4. La cámara mantiene `up=(0,1,0)`. El air roll no rota el horizonte.
5. El foco conserva un pequeño sesgo vertical según el pitch, limitado a
   `[-0,45, 0,75]` rad, y no usa el vector `up` del coche; el roll no mueve el
   foco lateralmente.
6. La posición y el foco se amortiguan por separado. La colisión con coberturas,
   paredes, límites y reaparición se aplica después de calcular el objetivo.

## Implementación

- `src/camera-follow.js` contiene la política numérica sin dependencias del
  renderizador, para poder probarla con Node.
- `src/client.js` conserva la actitud completa en la malla, pero usa el rumbo
  amortiguado y el horizonte mundial para la cámara.
- La conexión y cada nueva vida reinician el rumbo de seguimiento para no
  heredar la orientación de una vida anterior.
- `tests/camera-follow.test.mjs` cubre air roll sin giro de horizonte, cruce
  casi vertical con rumbo acotado y sesgo de pitch sin contaminación de roll.

## Verificación

`npm test` pasa 86 pruebas. Las cuatro nuevas regresiones de cámara no requieren
navegador ni mando físico. Falta la comprobación visual en la pestaña del juego
después de reiniciar el servidor: debe probar air roll libre, roll direccional,
backflip y aterrizaje, mirando si el horizonte permanece legible y si el foco
acompaña al coche sin tirones.

## Siguiente decisión

No ajustar todavía la física aérea. Si la sesión visual confirma que el giro de
cámara sigue siendo brusco, se modificará solo el grupo de presentación
`headingRate`, `chasePositionSmoothing` o `focusSmoothing`; si el problema es un
salto del rumbo al salir de un flip, se medirá primero la proyección horizontal
válida y el tiempo de recuperación. La física, el quaternion del coche y los
contactos quedan fuera de ese ajuste.
