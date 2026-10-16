# FIS-15A — Interpolación temporal de snapshots

Fecha: 10 de octubre de 2026  
Estado: completada

## Objetivo

Suavizar la presentación LAN sin cambiar la simulación autoritativa ni usar
predicción física.

## Decisión

La investigación estática de Car Soccer separa snapshots, presentación y motor
físico. Se adoptó un patrón original: buffer de snapshots confirmados,
interpolación lineal de posición y slerp quaternion de orientación. La
presentación va una actualización por detrás de la muestra más reciente.

Si falta un paquete, la presentación se detiene en la última pose. No
extrapola velocidad, contactos ni acciones.

## Cambios

- Añadido src/snapshot-interpolation.js.
- Integrado el buffer con reloj de presentación en src/client.js.
- Eliminado el segundo suavizado del chasis.
- Añadida cobertura en tests/snapshot-interpolation.test.mjs.
- Añadida trazabilidad en docs/car-soccer-rea-integration.md.

## Invariantes y validación

- El servidor y la simulación siguen siendo autoritativos.
- La física conserva paso fijo de 120 Hz.
- Respawn, teletransporte, cambio de arena, reloj no creciente y huecos grandes
  reinician el buffer.
- La orientación usa el arco corto de quaternions.
- Una conexión detenida muestra la última pose; no crea movimiento fantasma.
- npm test: 62 pruebas pasan, 0 fallos.
- npm run probe: airManeuver.cadenceMatches sigue siendo verdadero.
