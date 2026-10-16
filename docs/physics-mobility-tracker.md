# Tracker actual de física y movilidad — 15 de octubre de 2026

El historial completo de calibraciones y observaciones está en
[`archive/2026-10-14/physics-mobility-tracker.md`](archive/2026-10-14/physics-mobility-tracker.md).
Este archivo contiene solo el estado que puede cambiar la siguiente decisión.

## Objetivo

Conseguir una respuesta aérea legible y cercana a Rocket League/RocketSim en
salto, segundo salto, dodge, vuelo, air roll, pared y aterrizaje, conservando
una implementación original y autoritativa para el juego web.

## Contratos que no se reabren sin evidencia

- RocketSim posee pose, velocidad, orientación, suspensión, contactos,
  saltos y colisiones del vehículo.
- Node posee WebSocket, cohetes, daño, cooldown, puntuación y respawn.
- Three.js presenta snapshots interpolados; no corrige la simulación.
- No se copia código, WebAssembly, constantes, assets ni mallas de Rocket
  League o Car Soccer.
- No existe auto-enderezado al aterrizar: contacto y suspensión conservan la
  actitud del coche.

## Estado por área

| Área | Estado | Evidencia |
| --- | --- | --- |
| Bridge R13 | Aceptado para arranque normal | Smoke del bridge y host operativo; el lanzador actual usa R19 |
| Combate 1v1 | Aceptado | `rocketsim-combat-websocket-r8-02.json` |
| Combate 6v6 | Aceptado | `probe:rocketsim-combat-six` |
| Cámara aérea | Instrumentada | `camera-follow.js`; no retocar sin delta reproducible |
| MOB-AIR front | Aceptado | Campaña `?mobair01=1` con J/2/D |
| MOB-AIR side | No verificado | Intentos afectados por roster/estado congelado |
| MOB-AIR diagonal | No verificado | Intentos afectados por roster/estado congelado |
| Liveness de cliente | Unitario aceptado; host pendiente | `tests/lan-client-liveness.test.mjs` |
| Alineación visual del chasis | Implementada con envolvente Octane; vuelco visual pendiente | `tests/vehicle-visual-alignment.test.mjs`, `hitbox-01-visual-pivot-story.md` |
| Arena pared→techo | Bridge R19 aceptado; visual web pendiente | `probe:rocketsim-cornered-arena`, traza SHA `cee24af...`, misma escala y dimensiones en `src/client.js` |
| Lectura visual de límites | Implementada | Paredes y curvas translúcidas, techo con material emisivo y retícula superior; no crea colisión en cliente |

## Historia activa

La geometría de `ARENA-CEILING-01` ya está aceptada en el bridge R19; falta una
observación visual con ese ejecutable. Primero cerrar la observación invertida
de `HITBOX-01`. Después, ejecutar
`MOB-AIR-02-OBS-ISOLATED`: repetir side y diagonal con un solo piloto, ACK
monotónico, snapshots vivos, seriales J/2/D, recuperación visible y cero
errores. Si falta aislamiento o el estado se congela, el resultado es **no
verificado**; no se abre una calibración.

## Puertas de decisión

1. Con las tres variantes observadas, comparar trazas web con R13.
2. Si aparece una diferencia reproducible, abrir una única historia para eje,
   impulso, rotación o cámara.
3. Si la pose es correcta pero la cámara es brusca, tocar solo
   `src/camera-follow.js`.
4. Después, ampliar y aclarar la arena sin cambiar mallas físicas ni contratos.

## Verificación vigente

La última suite de código registrada después de la geometría de arena es
`npm test`: 160/160. Las sondas R19 de esquina, arena ampliada y smoke del
bridge terminaron sin errores. En una sesión anterior el HUD mostró
`COMBATE ROCKETSIM · COMBAT-ALPHA · R19` con ACK creciente; la última orden
manual del usuario volvió a apuntar a R13, por lo que no se debe interpretar
esa instancia como R19. Para continuar con la geometría nueva hay que detener
la instancia y ejecutar `npm run start:watch:combat`. Todavía falta una maniobra controlada de contacto
pared→techo para cerrar la aceptación visual de colisión. Las ediciones
documentales se verifican con `git diff --check`.
