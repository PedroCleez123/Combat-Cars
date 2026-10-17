---
type: combat
title: Combate, cohetes y respawn
description: Capa autoritativa de combate sobre las poses físicas de RocketSim.
tags: [combat, rockets, respawn, rocketsim]
sources:
  - id: openwiki-source-e8234c4d5cfb74d2788b408a
    resource: repo://src/rocketsim-arena-profile.js
  - id: openwiki-source-1d797791bf9ab33cf486b096
    resource: repo://src/rocketsim-combat.js
  - id: openwiki-source-ed91f65a5e7a3852eeb9fc5e
    resource: repo://src/rocketsim-practice-match.js
  - id: openwiki-source-c8a2a7e26d22bc6a03824489
    resource: repo://tests/rocketsim-combat.test.mjs
generated: { by: "codex", at: "2026-10-16T20:19:08.736Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-17T09:27:48.379Z
---

# Combate, cohetes y respawn

El modo de combate mantiene RocketSim como autoridad de poses y contactos. La
capa JavaScript de combate usa esas poses para resolver cohetes, salud,
puntuación y el ciclo de eliminación, y solicita al bridge la desactivación o
reaparición del coche nativo.

## Cohetes

Un disparo solo se acepta en el flanco de pulsación, cuando no hay cooldown, el
piloto está activo y conserva vida. El cohete nace delante del morro, hereda la
velocidad del coche y tiene vida limitada. En cada paso se prueba contra coches
enemigos y contra raycasts estáticos del bridge; una superficie estática que
aparece antes que el coche intercepta el cohete.

El límite de seguridad de Node se obtiene del perfil activo de arena. Para
`combat-alpha` es 72 × 54 × 30 unidades, por lo que el fallback no elimina un
cohete que aún está dentro de la arena ampliada; el raycast estático sigue
decidiendo la oclusión real.

## Daño y ronda

Un impacto reduce salud. Al llegar a cero, inicia el temporizador de respawn,
registra muerte y kill y suma un punto al equipo atacante. Cuando acaba el
temporizador, el jugador recupera salud máxima y el adaptador pide el respawn
nativo. El primer equipo que alcanza la puntuación objetivo gana; la ronda deja
de avanzar y elimina los cohetes pendientes.

## Frontera con RocketSim

Antes de resolver un paso de combate, el adaptador convierte pose y velocidad
nativas a unidades Arsenal. Envía segmentos de los cohetes existentes al
raycast estático, integra la capa de combate y llama a `setCombatActive` o
`respawn` por cada transición. Ningún pose de coche se envía desde JavaScript
al bridge como resultado del combate. También pasa a la regla de proyectiles
los límites nominales de `src/rocketsim-arena-profile.js` para el perfil activo.

## Fuentes

- `src/rocketsim-combat.js`: reglas, cohetes, daño y puntuación.
- `src/rocketsim-practice-match.js`: adaptación a coches nativos y bridge.
- `src/rocketsim-arena-profile.js`: límites nominales de seguridad por arena.
