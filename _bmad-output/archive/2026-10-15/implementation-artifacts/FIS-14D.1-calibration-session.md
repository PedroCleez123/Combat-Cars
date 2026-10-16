# FIS-14D.1 — Sesión guiada de calibración aérea

**Estado:** completada  
**Fecha:** 10 de octubre de 2026  
**Hito:** física y hitboxes del vehículo, CALIBRACIÓN LIMPIA

## Objetivo

Convertir el guion manual FIS-14D en una sesión repetible dentro del juego,
sin modificar fuerzas, ventanas, contactos, autoridad ni predicción. La
sesión debe dejar evidencia suficiente para decidir un único ajuste de
movilidad, o para conservar la línea base si no aparece un defecto dominante.

## Criterios de aceptación

- [x] La arena de calibración muestra seis maniobras: pitch abajo, pitch
  arriba con nitro, yaw, air roll, combinación con liberación y aterrizaje.
- [x] Cada paso registra únicamente snapshots autoritativos del coche local:
  actitud inicial y final, picos de velocidad angular, velocidad, altura,
  estado, saltos y ACK observado.
- [x] Un resultado distinto de **Sin evidencia** exige al menos dos snapshots
  y evidencia de la maniobra. La lógica interna también exige dos snapshots
  para cerrar cualquier paso.
- [x] El informe copiable no propone modificar varios grupos a la vez. Si
  detecta cámara, red o contactos, redirige al subsistema responsable.
- [x] Los campos de texto, selectores y botones no alimentan controles de
  conducción. Si el portapapeles falla, el informe queda visible y seleccionado
  para copiarlo manualmente.
- [x] La sesión no modifica entradas, simulación, `TUNING`, red ni
  interpolación.
- [x] Las pruebas cubren agregados, muestras malformadas, cierre de seis pasos
  y la regla de decisión.

## Implementación

- `index.html` y `src/style.css` añaden el panel compacto de sesión solo para
  CALIBRACIÓN LIMPIA.
- `src/calibration-session.js` concentra las seis instrucciones, los
  agregados de telemetría y la regla que propone o bloquea un ajuste.
- `src/client.js` captura los snapshots del coche local, muestra el progreso
  y permite copiar o recuperar visualmente el informe sin enviar mensajes
  nuevos al servidor.
- `tests/calibration-session.test.mjs` valida la lógica sin navegador,
  incluidos el umbral de evidencia, las muestras malformadas y el cierre
  explícito sin evidencia.

## Validación

- `npm test`: 68 pruebas pasan, 0 fallos.
- `npm run probe`: perfil de calibración a 120 Hz y
  `airManeuver.cadenceMatches = true`.
- `node --check src/client.js`, `src/calibration-session.js` y `server.mjs`:
  correcto.

## Próxima decisión

Ejecutar la sesión con teclado y ratón físicos. Si un mismo defecto aparece en
dos pasadas y el informe propone un único grupo, ajustar solo ese grupo y
repetir `npm test`, `npm run probe` y las seis maniobras. Si el informe señala
cámara, red o contactos, volver al hito propietario; no compensarlo con
constantes de vuelo.
