# ARENA-05 — primer recurso físico aislado

Estado: **En implementación** · 13 de octubre de 2026

## Problema observable

La arena RocketSim limpia no contiene todavía un recurso de combate con colisión.
La rampa visual existente pertenece al desguace y no puede reutilizarse sin
crear una discrepancia entre Bullet y Three.js.

## Hipótesis

Un bloque bajo, separado en un perfil propio, permite comprobar el contrato
completo de recurso nativo + visual compartido sin alterar la arena cornered
aceptada ni la movilidad base.

## Alcance

- `tools/rocketsim-bridge/main.cpp`: perfil Bullet con un único `btBoxShape` bajo.
- `src/rocketsim-practice-match.js`, `src/client.js`: anunciar y renderizar el
  perfil de forma explícita.
- `tools/rocketsim-bridge/probe-block-practice.mjs`: evidencia determinista de
  contacto y paso libre alrededor del bloque.
- `tests/rocketsim-practice-match.test.mjs`: contrato de selección del perfil.
- documentación de protocolo, tracker y relevo.

## Criterios de aceptación

1. El perfil cornered existente sigue sin el bloque y conserva sus probes.
2. Bullet y Three.js usan el mismo centro, dimensiones y altura del bloque.
3. La sonda observa contacto contra la cara y movimiento libre por un lateral,
   sin penetración ni pérdida de tick.
4. `node --check`, `npm test` y la compilación del bridge pasan.
5. La validación visual queda separada: el navegador debe mostrar el bloque en
   el perfil nuevo sin afirmar todavía una mejora de movilidad.

## Fuera de alcance

No se cambian solver, controles, cámara, dimensiones de la arena cornered,
armas, bots, rampas, obstáculos adicionales, protocolo de red ni matchmaking.

## Línea base

`npm test` 131/131 y las probes MOB-01/GAME-02 verdes. El perfil cornered es el
control físico sin recursos.


## Cierre de implementación — 13/10/2026

**Estado: aceptada en contrato nativo y regresión; visual pendiente de reinicio.**

- El perfil `arsenal-expanded-block-practice` quedó conectado en el bridge,
  práctica Node, protocolo y cliente.
- El probe determinista confirmó contacto frontal, bloqueo, bypass lateral y
  cadencia íntegra; evidencia: `docs/reference-captures/rocketsim-block-practice-arena-05.json`.
- `node --check src/client.js` y `npm test` pasan **132/132**.
- La instancia del usuario en `5189` no fue detenida. Se enlazó la copia
  `rocketsim_bridge-r10.exe` porque R9 estaba bloqueada por el proceso activo.
- La comprobación visual requiere arrancar el perfil opt-in con R10 en otro
  puerto; hasta entonces no se afirma que el bloque esté visible en navegador.
