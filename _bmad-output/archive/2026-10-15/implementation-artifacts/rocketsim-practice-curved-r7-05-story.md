# R7-05 — Práctica navegable con perfil curvo

**Estado:** accepted (R7-05a/b; R7-05c pendiente)

## Historia

Como piloto de la práctica RocketSim, quiero seleccionar la arena curva propia
en el servidor y verla en Three.js para comprobar el vuelo, el aterrizaje y el
contacto suelo-pared con la misma autoridad nativa.

## Alcance

- Permitir `ROCKETSIM_ARENA=arsenal-practice|arsenal-curved-practice` en el
  servidor RocketSim.
- Mantener `settings.arena=calibration` y añadir `settings.practiceArena` para
  no romper el selector ni la sesión de calibración existente.
- Dibujar en el cliente el cuarto de cilindro con la misma escala, radio,
  anchura y posición que el sidecar nativo.
- Añadir pruebas de allowlist, selección de bridge y rechazo de perfiles
  desconocidos.

## Criterios de aceptación

1. Solo se aceptan los dos perfiles de práctica propios; no se cargan mallas
   externas ni se habilita `Arena::Create(SOCCAR)`.
2. El perfil seleccionado llega en el snapshot sin cambiar la autoridad de
   inputs, la cadencia de 120/60 Hz ni la forma de las entradas.
3. La vista `arsenal-curved-practice` conserva suelo, paredes y techo y añade
   la curva visible; no añade obstáculos, pads, bots ni combate.
4. La práctica plana, las sondas nativas y `npm test` no regresan.
5. La documentación deja claro que la curva es geometría original de prueba y
   que la comprobación visual del tacto queda separada de la evidencia
   automatizada.

## Fuera de alcance

Multivehículo, combate, bots, migración por defecto, cambios de constantes de
vuelo, cámara nueva y cualquier malla o código propietario.

## Comprobaciones

```powershell
$env:ROCKETSIM_ARENA = "arsenal-curved-practice"
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r5-z7/rocketsim_bridge.exe)
npm run start:rocketsim
```

Después se comprueban HTTP 200, handshake WebSocket, `settings.practiceArena`
y cierre limpio. También se ejecutan `npm run probe:rocketsim-practice`,
`npm run probe:rocketsim-curved-arena` y `npm test`.

## Evidencia de R7-05a (12 de octubre de 2026)

- `ROCKETSIM_ARENA` solo acepta los dos perfiles propios y el bridge recibe el
  perfil curvo explícito.
- El cliente conserva `settings.arena=calibration`, muestra el encabezado
  `PRÁCTICA ROCKETSIM · TRANSICIÓN CURVA · SUELO · PARED · TECHO` y construye
  la superficie visual con la misma escala y 32 segmentos.
- HTTP 200, WebSocket autoritativo con un coche `grounded`, ACK y consola del
  cliente sin errores en `http://localhost:5211/`.
- `npm test`: 107 pruebas pasan, 0 fallan; ambos `node --check` pasan.
- La inspección posterior aisló la práctica curva del panel de calibración y
  limitó la cámara bajo el techo durante el recorrido. R7-05b queda aceptada
  con la sonda y la inspección visual descritas en el tracker; la validación de
  tacto subjetivo sigue separada de esta evidencia automatizada.

## Evidencia de R7-05c (12 de octubre de 2026)

`npm run probe:rocketsim-wall-actions` arranca el servidor real y ejecuta cuatro
fases desde `wallRide=true`, `surfaceType=wall` y cuatro ruedas en contacto:
salto, segundo salto/dodge dirigido, air roll con nitro y recuperación. Las
cuatro fases cumplieron el apoyo inicial; los contadores autoritativos
observaron salto `1`, dodge `1`, velocidad angular superior a `0,01`, consumo
de `8,89` unidades de nitro y recuperación a apoyo de techo. La captura
completa está en `docs/reference-captures/rocketsim-wall-actions-r7-05c.json`;
la cadencia observada fue `0,01666 s` por snapshot con dos ticks nativos.

R7-05c queda aceptada como medición automatizada de acciones desde pared. No
modifica fuerzas ni demuestra todavía que el tacto sea idéntico a Rocket
League; la comparación visual y subjetiva sigue siendo una actividad aparte.
