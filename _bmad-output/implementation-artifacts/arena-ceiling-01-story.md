# ARENA-CEILING-01 — Curva pared-techo y techo visible

## Estado

Bridge R19 aceptado por sonda nativa; observación visual web pendiente. Esta
historia no cambia el solver de movimiento ni las reglas de combate.

## Objetivo

Hacer que la arena ampliada tenga una transición continua desde el suelo hasta
la pared y desde la pared hasta el techo, incluidas las esquinas, con la misma
geometría en RocketSim y Three.js.

## Alcance

- Cuarto de cilindro inferior y superior por pared.
- Paneles planos finitos entre ambas curvas.
- Techo central visible.
- Parches de esquina inferiores, verticales y superiores.
- Perfil opt-in `arsenal-expanded-cornered-practice`; no sustituye todavía el
  perfil que usa el host persistente del usuario.

## Evidencia de salida

`npm run probe:rocketsim-cornered-arena` con
`.rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe`:

- 720 ticks a 120 Hz, cuatro coches.
- Contacto continuo antes de la pared (`gapsBeforeSteep=0`).
- Curva inferior, pared vertical, esquina y curva superior observadas.
- `minNormalY=-1` y variación máxima de normal entre ticks de 3,124 grados.
- SHA de la traza: `cee24afabe3640dcc2eaaaffe312a010d8568d244fe36980ae29c6549667e5f2`.

La suite JavaScript posterior pasa `160/160`. La presentación de límites se
observó en `localhost:5300`: paredes y curvas translúcidas, y techo con
retícula emisiva legible. La aceptación de contacto pared→techo queda pendiente
de una captura del navegador ejecutando un servidor con R19. El lanzador
`npm run start:watch:combat` fija R19 para evitar que una malla nueva se sirva
contra la física R13. Tras la recarga de esta iteración, el HUD confirmó
`COMBATE ROCKETSIM · COMBAT-ALPHA · R19`; queda únicamente ejecutar una
maniobra controlada de contacto para cerrar la historia.

El HUD identifica el bridge y advierte explícitamente cuando `combat-alpha`
recibe una revisión conocida anterior a R19. Así una curva visual sin contacto
no se interpreta como una regresión de la geometría R19.

## Fuera de alcance

- No se copian mallas ni código propietario de Rocket League o Car Soccer.
- No se cambian constantes de vuelo, cámara, hitboxes ni combate.
- No se marca la historia como aceptación visual hasta observar el host R19.
