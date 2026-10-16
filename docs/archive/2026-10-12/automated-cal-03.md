# CAL-03 automatizada — entrada de mando y red

Esta comprobación reemplaza las pulsaciones temporizadas que antes exigían al
piloto. `npm run calibrate:network` inicia un servidor local temporal en el
puerto 5199, conecta un cliente WebSocket y envía la misma estructura de entrada
que crea el adaptador XInput del navegador. Cada pulsación se confirma mediante
el ACK autoritativo antes de iniciar el intervalo medido.

## Trazas cubiertas

1. A + RT durante 400 ms: pitch abajo.
2. A + LT durante 400 ms, después RB 250 ms: pitch arriba y nitro.
3. A + stick a la derecha durante 400 ms: yaw derecho.
4. A + X 300 ms, después B 300 ms: rolls direccionales opuestos.
5. A + LB + stick a la derecha durante 400 ms: free air roll sin yaw.
6. A + LT 400 ms y RB 300 ms: nitro y recuperación de dos saltos al
   aterrizar.

El informe de la última ejecución se guarda en
`docs/automated-cal-03-last-run.json`. Registra duración solicitada y observada,
secuencias ACK, picos y snapshots autoritativos. El resultado valida el
contrato de entrada, la red y el servidor; no sustituye una evaluación humana de
sensación, cámara o legibilidad visual.

## Mando virtual opcional

`C:\Users\Pedro José\Desktop\SK\vgamepad-main` contiene una librería Python
que puede crear un mando XInput real mediante ViGEmBus. En esta máquina la
librería llega a `VIGEM_ERROR_BUS_ACCESS_FAILED`: el bus no está disponible y
los dos instaladores silenciosos se bloquearon sin registrar el controlador.
No se deja ningún instalador activo. La prueba de red mantiene las duraciones
exactas sin depender del controlador. Si se instala ViGEmBus correctamente más
adelante, el navegador ya puede leerlo con `navigator.getGamepads()` mediante
`src/gamepad-input.js`.
