# VIS-03 — Observación multijugador de presentación

Estado: **No verificado parcialmente** · 13 de octubre de 2026

## Problema y alcance

VIS-02 dejó una arena limpia más legible, pero aún faltaba comprobar la lectura
con más de un piloto antes de añadir decoración u obstáculos. Esta historia
observa dos pestañas del navegador en una instancia temporal de combate
RocketSim. No cambia física, red, cámara, HUD ni geometría.

## Criterios

- Dos pilotos humanos conectan al mismo servidor y el HUD publica `2/6`.
- Los equipos y coches azul/rojo son distinguibles.
- El marcador, la capacidad y el estado de red siguen siendo legibles.
- Ambas pestañas cargan sin errores ni advertencias de consola.
- Un disparo de cohete queda observado visualmente o se registra como pendiente.

## Evidencia

- Instancia temporal: `ROCKETSIM_MODE=combat`,
  `ROCKETSIM_ARENA=arsenal-expanded-cornered-practice`, puerto `5292`.
- Dos pestañas: `?mob02=1` y la entrada normal. El HUD confirmó `2/6 PILOTOS`,
  `TÚ · EQUIPO AZUL` / `TÚ · EQUIPO ROJO` y ACK continuo.
- La captura visual mostró claramente el coche azul en la esquina redondeada y
  el coche rojo en su pestaña; no se observaron errores ni advertencias en
  ninguna consola.
- La entrada automatizada de disparo no produjo una captura inequívoca del
  proyectil. El criterio de cohete queda **No verificado**; no se afirma que la
  lectura de proyectiles esté cerrada.

## Decisión

La legibilidad base de coches, equipos, marcador y HUD queda aceptada para
seguir, sin añadir decoración todavía. Antes de cerrar VIS-03 hay que crear una
comprobación reproducible de cohete visible (posición inicial controlada o
captura de estado/render) y repetirla sin depender de una pulsación manual.

## Fuera de alcance

No se cambian constantes de RocketSim, cámara, colisiones, armas, bots,
obstáculos, assets externos ni protocolo WebSocket.
