# VIS-06 — lenguaje visual de `combat-alpha`

**Estado:** Aceptada · 14 de octubre de 2026

## Objetivo

Mejorar la lectura espacial del perfil `combat-alpha` en Three.js después de
validar su geometría nativa. El jugador debe distinguir el bloque, la rampa,
el corredor central y los extremos de cada equipo sin depender del HUD.

## Alcance

- Añadir siluetas/contornos visuales de baja carga a bloque y rampa.
- Añadir balizas de equipo en los seis extremos de spawn y una guía central.
- Mantener materiales procedurales existentes y el perfil limpio brillante.
- No modificar física, cámara, colisiones, RocketSim, Node, protocolo, daño,
  cohetes, controles ni dimensiones de arena.

## Base / Post / Delta

- **Base:** ARENA-07 aceptada en R13, navegador accesible y `npm test` 137/137;
  la arena carga y W actualiza velocidad y ACK.
- **Post:** la captura visual muestra siluetas distinguibles, colores de equipo
  y corredor central; la interacción de movimiento sigue funcionando.
- **Delta:** solo `src/client.js`, su prueba visual existente y documentación.

## Aceptación

1. `combat-alpha` conserva la misma geometría nativa y los perfiles anteriores.
2. El bloque y la rampa tienen un contorno legible sin tapar su superficie.
3. Los spawns azules y rojos tienen balizas visibles y simétricas.
4. `npm test` pasa y el navegador muestra el perfil con velocidad/ACK tras W.

## Reversión

Eliminar los adornos de `combat-alpha` deja sin cambios el solver, el mapa
nativo y los perfiles de práctica anteriores.

## Resultado y relevo

La implementación corrige el eje de los lavados de equipo: en `combat-alpha`
azul aparece en X negativo y rojo en X positivo, como sus spawns nativos. Añade
un contorno de bloque, las seis balizas simétricas de spawn, dos guías que
delimitan el corredor central y un anillo central; son únicamente nodos
Three.js. `node --check src/client.js` y `npm test` pasaron con **137/137**.

Antes del cambio, el navegador integrado confirmó que R13 mostraba
`COMBATE ROCKETSIM · COMBAT-ALPHA` y que W actualizaba velocidad y ACK. Tras
el cambio, su recarga dejó de recibir snapshot de la instancia externa; una
instancia R13 aislada en 5300 arrancó correctamente, pero el navegador
integrado devolvió `ERR_CONNECTION_TIMED_OUT`. Es una limitación de aislamiento
del entorno, no un resultado visual negativo. No se declara VIS-06 aceptada
hasta observar la instancia del usuario tras Ctrl+F5. La causa del timeout y
el procedimiento para compartir host están en
`docs/local-server-browser-bridge.md`.

## Observación visual de cierre

La instancia persistente del usuario en `localhost:5300` cargó la revisión:
HUD `COMBATE ROCKETSIM · COMBAT-ALPHA`, coche, bloque/rampa, guías de corredor
y balizas fueron visibles. W elevó la velocidad a 16 y el ACK de red continuó
actualizándose. VIS-06 queda aceptada; no se observó ni se modificó física,
cámara, autoridad o geometría nativa.
