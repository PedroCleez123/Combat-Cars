# CAL-03 — Registro de validación manual de FIS-14E

Actualizado: 10 de octubre de 2026. Estado: contrato de mando y red validado;
la valoración visual de tacto sigue siendo una actividad separada.

## Actualización — CAL-03 automatizada

La prueba reproducible `npm run calibrate:network` reemplaza las pulsaciones
temporizadas del guion anterior. Arranca un servidor aislado en el puerto 5199,
abre un WebSocket local y aplica la misma conversión de mando estándar que usa
el cliente. Cada cambio espera su ACK autoritativo antes de medir el intervalo.
La partida abierta por el usuario en el puerto 5189 no participa ni se altera.

La última ejecución pasó las seis maniobras:

1. `A` y `RT` 401,6 ms: pitch abajo; pico 5,4 rad/s sin yaw ni roll.
2. `A`, `LT` 403,9 ms y `RB` 263,6 ms: pitch arriba y nitro. El control sin
   nitro acabó a −3,93 u/s verticales y el ensayo con nitro a +3,19 u/s.
3. `A` y stick derecho 402,3 ms: yaw derecho; pico 4,4 rad/s.
4. `A` con `X` y, tras reinicio, `B`, unos 300 ms cada uno: rolls opuestos;
   pico 6,15 rad/s.
5. `A`, `LB` y stick derecho 402,5 ms: free air roll; pico 7,2 rad/s y yaw
   mantenido en cero mientras había roll.
6. `A`, `LT` y `RB`: boost observado y aterrizaje con los dos saltos repuestos.

El informe completo, con secuencias ACK, duración medida, picos y snapshots,
está en `docs/automated-cal-03-last-run.json`. Esta evidencia valida entrada,
red y simulación; no autoriza todavía cambiar `TUNING`, porque no mide la
preferencia humana de respuesta ni la presentación de cámara.

## Configuración confirmada

- Servidor local iniciado en `http://localhost:5189`.
- Navegador: carga visible de **CALIBRACIÓN DE MOVILIDAD · SUELO · PAREDES ·
  TECHO**.
- Entorno seleccionado: **Calibración limpia**.
- Capacidad de pilotos: **1**.
- Bots IA: **0**.
- Nitro: ilimitado, sin pads, combate, obstáculos ni rampas.
- Controles visibles: Shift izquierdo para derrape/free air roll; Ctrl izquierdo
  y Espacio para roll direccional; clic derecho para salto y clic izquierdo
  para nitro.
- Sesión FIS-14D.1 iniciada: paso 1 de 6, *Pitch abajo*.

## Evidencia mecánica previa

- `npm test`: 76 pruebas pasan, incluyendo el mapeo de controles y la separación
  entre free air roll y roll direccional.
- `npm run probe`: la traza aérea mantiene
  `airManeuver.cadenceMatches = true`; su fase de yaw + roll registra ambos ejes
  simultáneos mediante la ruta direccional.

## Límite de automatización observado

El navegador integrado puede abrir el juego, configurar la partida e iniciar
la sesión, pero no mantiene de manera fiable foco y teclas/botones retenidos
sobre el canvas 3D. Un intento automatizado de salto y W no produjo evidencia
aérea válida. No se eligió **Sin evidencia** ni se avanzó el paso, para no
contaminar el historial de calibración con una observación que no realizó el
piloto.

## Guion de observación visual

Antes de los seis pasos guiados, comprobar en el canvas:

1. Saltar y mantener Shift + D: el coche debe hacer roll a la derecha sin ganar
   guiñada sostenida.
2. Saltar y mantener D + Espacio: el coche debe ganar guiñada a la derecha y
   roll a la derecha al mismo tiempo. Repetir con Ctrl para el sentido opuesto.

La traza automática ya cubre el contrato físico. Usar las dos sesiones de
FIS-14D.1 solamente si se necesita registrar cámara, legibilidad y sensación.
Un ajuste de `TUNING` solo se abre si el mismo candidato aparece en ambas
sesiones.

## Decisión

No se ajustan constantes todavía. La infraestructura, los gatillos analógicos,
el contrato de controles y la red han pasado pruebas reproducibles; falta la
medida subjetiva que decide qué grupo de respuesta, si alguno, debe cambiar.
