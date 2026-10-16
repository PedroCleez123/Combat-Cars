# ARENA-07 — `combat-alpha`, composición mínima de combate

**Estado:** Aceptada en autoridad nativa y LAN · visual no verificada · 14 de octubre de 2026

## Problema observable

El bloque de ARENA-05 y la rampa de ARENA-06 funcionan de forma aislada, pero
no existe una arena de combate que demuestre que ambos recursos, seis spawns,
las rutas alternativas y la oclusión de cohetes conviven bajo el sidecar
RocketSim.

## Hipótesis y alcance

El perfil independiente `combat-alpha` puede conservar la arena cornered y
componer exactamente los dos recursos ya aceptados: bloque en `(0, -20)` y
rampa en `(0, +20)` Arsenal. Deja el corredor central libre y crea dos rutas
laterales equivalentes. Seis spawns alternos en extremos `x=±48` miran hacia el
centro, separados por `z=-30, 0, +30`.

Incluye bridge, selección de perfil, representación Three.js, orientación
consistente de spawn/respawn y una campaña WebSocket de seis pilotos.

No incluye recursos nuevos, cambios a geometría de bloque/rampa, ajustes de
física aérea, cámara, daño, reglas, bots, UI de selección ni online público.

## Autoridad e invariantes

- RocketSim/Bullet posee las colisiones, pose, orientación y respawn nativos.
- Node posee los cohetes, daño, score y roster LAN.
- Three.js solo dibuja el bloque y la rampa con los mismos centros y tamaños.
- `arsenal-expanded-cornered-practice`, bloque y rampa aislados se mantienen
  como perfiles de control.

## Línea base

- `npm test`: 136/136.
- ARENA-05 y ARENA-06 tienen trazas deterministas y oclusión estática verde.
- Jev/System One estuvo disponible; su comparación de alternativas excedió el
  tiempo. La elección de carriles simétricos se deriva del contrato explícito
  del roadmap, no de esa respuesta probabilística.

## Criterios de aceptación

1. `combat-alpha` es un perfil opt-in con bloque y rampa en coordenadas
   compartidas y seis spawns finitos, únicos y separados.
2. Cada equipo mira al rival al aparecer y vuelve a esa orientación tras
   respawn nativo.
3. Una campaña LAN de seis pilotos valida movimiento, ACK, cohetes publicados,
   cobertura por recurso, desconexión y reconstrucción del sidecar.
4. `npm test`, las sondas ARENA-05/06 y el raycast estático siguen verdes.
5. La comprobación de navegador se marca separadamente si hay un servidor
   accesible; una limitación del navegador integrado no cambia la aceptación de
   la evidencia autoritativa.

## Reversión

Eliminar el perfil opt-in, su visual y su campaña deja intactos los tres
perfiles de control. La build se publica bajo un nombre nuevo y no sobrescribe
un proceso que pueda estar en uso.

## Relevo de validación

Durante la preparación, la capa JavaScript y los contratos pasaron
**137/137**. La revisión automática bloqueó inicialmente el compilado por
límite de uso, pero el usuario lo ejecutó manualmente y publicó R13. La
receta reproducible desde la raíz es:

```powershell
& cmd.exe /d /c 'call "C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 -host_arch=x64 && cmake --build .rocketsim-bridge-build-r9 --target rocketsim_bridge'
Copy-Item .rocketsim-bridge-build-r9\\rocketsim_bridge.exe .rocketsim-bridge-build-r9\\rocketsim_bridge-r13.exe
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\\rocketsim_bridge-r13.exe)
npm run probe:rocketsim-combat-alpha-geometry
$env:ROCKETSIM_COMBAT_SIX_ARENA = 'combat-alpha'
$env:ROCKETSIM_COMBAT_SIX_TEST_PORT = '5238'
$env:ROCKETSIM_COMBAT_SIX_STORY = 'ARENA-07'
npm run probe:rocketsim-combat-alpha-lan
```

Después de compilar, repetir `npm test`, las sondas de raycast, bloque y rampa,
y abrir un servidor local con `ROCKETSIM_ARENA=combat-alpha` para la
comprobación visual.

## Resultado de validación — 14 de octubre de 2026

La compilación produjo `.rocketsim-bridge-build-r9/rocketsim_bridge-r13.exe`.
La geometría pasó dos ejecuciones deterministas con SHA
`da62d6431aebbb53e63ebb7145c30c5336b1c0f6ee9e58608b1eb629a33fb8a1`; raycast,
bloque, rampa y oclusión de cohete conservaron sus regresiones. La campaña
LAN de seis pilotos pasó todas sus aserciones (ACK, movimiento independiente,
seis disparos, cohetes, desconexión y reconstrucción) sin errores. Capturas:

- `docs/reference-captures/rocketsim-combat-alpha-geometry-arena-07.json`
- `docs/reference-captures/rocketsim-combat-six-pilot-arena-07.json`

La suite final queda en **137/137**. La observación web se intentó con un
servidor R13 en `localhost:5298`, pero el navegador integrado devolvió
`ERR_CONNECTION_TIMED_OUT`; por ello la presentación Three.js queda marcada
como no verificada y no se infiere una confirmación visual.
