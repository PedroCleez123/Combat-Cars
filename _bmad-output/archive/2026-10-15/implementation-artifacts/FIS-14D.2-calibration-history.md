# FIS-14D.2 — Historial y comparación de calibraciones

**Estado:** completada  
**Fecha:** 10 de octubre de 2026  
**Hito:** física y hitboxes del vehículo, CALIBRACIÓN LIMPIA

## Objetivo

Conservar las sesiones completas de FIS-14D.1 en el navegador para que dos
pasadas de juego real se puedan comparar sin depender del portapapeles ni de
una página sin recargar. La comparación solo organiza evidencia; nunca ajusta
ni propone aplicar valores físicos de manera automática.

## Criterios de aceptación

- [x] Solo se guardan sesiones con los seis pasos cerrados; el historial acepta
  como máximo seis sesiones y tolera datos locales corruptos.
- [x] La interfaz muestra cuántas sesiones se conservan, permite borrar el
  historial local y ofrece comparar las dos últimas.
- [x] La comparación identifica un único candidato repetido o solicita repetir
  el guion; no convierte una mezcla de hallazgos en ajuste físico.
- [x] El informe comparativo queda visible y copiable con el mismo fallback
  manual de FIS-14D.1.
- [x] No hay cambios en `TUNING`, mensajes WebSocket, autoridad, predicción ni
  simulación.

## Implementación

- `src/calibration-history.js` valida, acota, persiste en formato serializable
  y compara sesiones completadas.
- `src/client.js` guarda una sesión solo al cerrar el sexto paso, muestra la
  conclusión de las dos últimas y permite borrar la copia local.
- `index.html` y `src/style.css` añaden controles compactos de historial al
  panel de calibración.
- `tests/calibration-history.test.mjs` cubre corrupción, límite, candidato
  repetido y candidatos mezclados.

## Validación

- `npm test`: 71 pruebas pasan, 0 fallos.
- `npm run probe`: perfil de calibración a 120 Hz y
  `airManeuver.cadenceMatches = true`.
- `node --check src/client.js`, `src/calibration-session.js`,
  `src/calibration-history.js` y `server.mjs`: correcto.

## Próxima decisión

Realizar dos sesiones con teclado y ratón físicos. Si **Comparar 2 sesiones**
muestra el mismo candidato, implementar una sola corrección en el grupo
indicado, medirla y volver a ejecutar el guion. Si informa hallazgos mezclados
o sin candidato, repetir una pasada antes de cambiar física.
