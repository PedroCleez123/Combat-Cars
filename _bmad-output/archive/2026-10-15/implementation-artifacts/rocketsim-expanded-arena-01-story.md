# ARENA-01 — Arena limpia ampliada con cuatro transiciones curvas

**Estado:** accepted como perfil opt-in nativo y visual; no cambia el modo por defecto.

## Resultado observable

La práctica RocketSim puede usar una arena propia de `144 × 108 × 30` unidades
Arsenal. Sus cuatro lados tienen una transición suelo-pared curva de radio `8`
y 32 segmentos. El bridge nativo y Three.js regeneran la misma geometría y
conservan la escala `56 / 2300`. Las esquinas y las transiciones pared-techo
siguen fuera de alcance.

## Alcance

- `tools/rocketsim-bridge/main.cpp`: perfil `arsenal-expanded-curved-practice`,
  cuatro BVH propios y spawns de sonda.
- `src/rocketsim-practice-match.js`: allowlist del perfil, sin cambiar defaults.
- `src/client.js`: visual de cuatro curvas, límites de cámara y modo expandido.
- `tools/rocketsim-bridge/probe-expanded-curved-practice.mjs`: traza nativa
  determinista de cuatro coches.
- `tests/rocketsim-practice-match.test.mjs` y `package.json`: contrato y sonda.

## Criterios y evidencia

1. El perfil mantiene schema 1, 120 Hz e IDs/equipos existentes.
2. Cuatro coches alcanzan apoyo inclinado y pronunciado sin huecos; la normal
   cambia menos de 8° por tick.
3. Dos ejecuciones producen el mismo resumen SHA-256
   `4b548e8e02c7d9c40b99e53364fe1676ea7511739f66db74b072ede923f028dd`.
4. El perfil R7-04 conserva su SHA `7da59d6caacd75a3ab9e24d302c203913f1d342fad3d1a51f822791ed6c0757d`.
5. `npm test` pasa 119/119. La comprobación HTTP/HUD RocketSim se hizo en
   navegador; la maniobra aérea completa queda pendiente de automatización de
   entradas del lienzo.
6. El caché nativo distingue ancho, profundidad, radio y recorte de esquinas,
   y descarta sus cuatro referencias al cambiar de perfil para no mezclar
   formas Bullet entre inicializaciones.

## Fuera de alcance

No se cambian `src/simulation.js`, combate, red, backend JS por defecto, mallas
de Rocket League, esquinas, techo-pared, rampas ni activos externos.
