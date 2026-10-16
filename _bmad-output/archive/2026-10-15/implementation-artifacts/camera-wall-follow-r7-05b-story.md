# R7-05b — Cámara legible en transición curva

**Estado:** accepted

## Problema reproducible

En `arsenal-curved-practice`, mantener avance hasta la pared puede elevar la
cámara de seguimiento por encima del techo: su objetivo sumaba altura del coche
y offset vertical sin límite superior. La física nativa siguió publicando apoyo,
pero la vista se volvía poco legible.

## Hipótesis y alcance

Limitar posición y foco de cámara al volumen vertical de las prácticas limpias
mantiene horizonte mundial, rumbo horizontal y orientación completa del coche,
sin cambiar el bridge, la entrada, RocketSim ni la física JavaScript.

## Criterios de aceptación

1. Un coche con el morro vertical conserva su rumbo horizontal de cámara.
2. En prácticas limpias, posición y foco no salen por encima del techo visual.
3. Fuera de las prácticas limpias no cambia la política de cámara existente.
4. `npm test`, la sonda curva WebSocket y una comprobación visual del navegador
   siguen verdes.

## Fuera de alcance

Resolver colisiones físicas de cámara, cambiar la cámara de Rocket League,
ajustar vuelo/salto/dodge o tocar el solver de movimiento.

## Evidencia de aceptación (12 de octubre de 2026)

- La prueba de cámara cubre un coche vertical sobre pared: conserva el rumbo
  horizontal y limita posición/foco a los topes de la práctica limpia.
- `npm run probe:rocketsim-curved-practice` sigue verde: apoyo inclinado,
  pronunciado y pared con cero huecos.
- `npm test`: 108 pasan, 0 fallan.
- La repetición en navegador mantiene el coche visible sobre la pared curva y
  la consola no registra errores. Es una comprobación de legibilidad, no una
  afirmación de equivalencia con la cámara de Rocket League.
