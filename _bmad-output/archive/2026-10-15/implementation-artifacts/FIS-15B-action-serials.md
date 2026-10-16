# FIS-15B — Seriales de acciones discretas

Fecha: 10 de octubre de 2026  
Estado: completada

## Objetivo

Separar las transiciones de movilidad de su representación visual para que una
entrega repetida de snapshots no reproduzca un salto, doble salto, dodge o
respawn varias veces.

## Diseño

La simulación publica seriales monotónicos propios para primer salto, doble
salto, dodge y respawn. El cliente almacena el último serial visto por coche y
activa un pulso visual breve solo cuando aumenta. El estado físico permanece
separado: pose, ventanas de salto, impulso y contactos no dependen de este
efecto.

## Cambios

- src/simulation.js incrementa los seriales en las transiciones y los añade a
  cars[].actionSerials del snapshot.
- src/client.js consume los incrementos una única vez y dibuja un pulso breve
  ligado al coche.
- tests/simulation.test.mjs verifica seriales de primer salto, pulsación
  mantenida, dodge, doble salto y respawn.

## Validación

- npm test: 62 pruebas pasan, 0 fallos.
- npm run probe: airManeuver.cadenceMatches sigue siendo verdadero.
- No se cambiaron TUNING, fuerzas, ventanas ni reglas de contacto.

## Siguiente paso

Medir latencia de respuesta en LAN antes de diseñar FIS-15C. Solo si se observa
demora perceptible debe añadirse reconocimiento de entrada y conciliación del
coche local.
