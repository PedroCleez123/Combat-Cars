---
type: arena
title: Arena y geometría física
description: Perfiles nativos RocketSim y representación Three.js de suelo, paredes, techo y transiciones curvas.
tags: [arena, geometry, rocketsim, threejs]
sources:
  - id: openwiki-source-4c3989ef3101af67d167f4b8
    resource: repo://src/client.js
  - id: openwiki-source-e8234c4d5cfb74d2788b408a
    resource: repo://src/rocketsim-arena-profile.js
  - id: openwiki-source-f38e87ffd2cc89e14cb53e86
    resource: repo://tools/rocketsim-bridge/main.cpp
generated: { by: "codex", at: "2026-10-16T20:19:08.736Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-17T09:48:31.775Z
---

# Arena y geometría física

La colisión de las arenas RocketSim pertenece al bridge nativo. El cliente no
deriva colisiones de sus mallas: construye una piel Three.js equivalente para
que la presentación corresponda al perfil informado en el snapshot.

## Perfiles

El bridge acepta perfiles limpios, curvos, ampliados, con esquinas, bloque,
rampa y `combat-alpha`. Los perfiles ampliados usan cuatro quarter pipes para
unir suelo-pared y pared-techo. La variante con esquinas añade fillets en las
cuatro uniones de suelo, las cuatro uniones de techo y las cuatro esquinas
verticales. `combat-alpha` parte de esa variante y añade un bloque y una rampa
en posiciones simétricas respecto al carril central.

`src/rocketsim-arena-profile.js` mantiene ahora un registro nominal para los
perfiles que cruzan el plano de control JavaScript. Las arenas limpias usan
62 × 46 × 24 unidades; las ampliadas, incluida `combat-alpha`, usan 72 × 54 ×
30. El registro también conserva el radio de curva y si el perfil tiene
esquinas, pero no sustituye a las shapes ni al raycast del bridge.

## Presentación

`client.js` construye el mundo desde `settings.practiceArena` y resuelve el
nombre a través del registro común. En el perfil ampliado usa 144 × 108 × 30
unidades de presentación y radio de curva 8. Las
paredes y techo son materiales transparentes de doble cara y el techo contiene
una rejilla propia para hacerlo legible desde el interior.

La representación de cada borde dibuja dos arcos: suelo-pared y pared-techo.
Cuando el perfil tiene esquinas, añade superficies de cuarto de esfera en los
extremos inferior y superior, además de un tramo curvo vertical que evita un
corte visual a media altura.

## Regla de alineación

Los cambios de geometría física se realizan primero en el bridge y se validan
con sus sondas. El registro JS alinea dimensiones de presentación y el límite
de seguridad de proyectiles con el perfil nominal, pero RocketSim conserva la
autoridad sobre colisiones y el raycast estático. La transparencia es solo una
decisión de presentación y nunca sustituye a la colisión nativa.

## Fuentes

- `tools/rocketsim-bridge/main.cpp`: perfiles y shapes físicos nativos.
- `src/rocketsim-arena-profile.js`: registro nominal compartido por cliente y
  lógica Node.
- `src/rocketsim-practice-match.js`: perfil publicado en snapshots.
- `src/client.js`: selección de modo y construcción Three.js.
