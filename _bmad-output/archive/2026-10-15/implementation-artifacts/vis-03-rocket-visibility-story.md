# VIS-03.1 — captura reproducible de cohete

Estado: **Aceptada parcialmente** · 13 de octubre de 2026

## Problema observable

La observación de dos pilotos validó coche, equipos y HUD, pero una pulsación
automatizada no permitió capturar un proyectil inequívoco en vuelo.

## Hipótesis

Una secuencia de navegador que espera el roster de dos pilotos y emite un único
flanco de `fire` desde el segundo spawn del perfil nativo `combat-lineup`
mantendrá el cohete ante la cámara del tirador durante al menos un snapshot.

## Alcance

- `src/vis03-browser-playback.js`: timeline pura de entrada.
- `src/client.js`: activar la timeline sólo con `?vis03=1`.
- prueba unitaria del timeline y comprobación de navegador con dos pestañas.

## Criterios de aceptación

1. La timeline permanece neutral hasta que existen dos coches y el piloto es
   rojo, y después emite un único pulso de fuego.
2. No altera poses, física, red, cámara, combate ni la geometría del bridge.
3. La prueba unitaria y `npm test` pasan.
4. En `combat-lineup`, una captura del navegador muestra un cohete y la consola
   no registra errores ni advertencias. **Pendiente por limitación del navegador
   integrado; la sonda WebSocket equivalente sí está aceptada.**

## Resultado actual

La sonda `npm run probe:rocketsim-projectile-visibility` pasó todos sus
criterios: roster azul/rojo, ACK, cohete publicado en un snapshot autoritativo,
posición/velocidad finitas y distancia `3,8775` unidades desde el tirador, sin
errores de runtime. La evidencia queda en
`docs/reference-captures/rocketsim-projectile-visibility-vis03.json`.

La captura de píxeles no se pudo repetir porque el navegador integrado no pudo
alcanzar el servidor temporal ligado a esta sesión; una instancia externa
requerida para ese alcance fue rechazada por la revisión automática del entorno.
No se presenta la comprobación visual como hecha.

## Fuera de alcance

No se usan las arenas de jugador para este test técnico, no se añaden armas ni
se ajustan daños, velocidades, cámara, HUD o colores.
