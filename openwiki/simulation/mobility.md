---
type: simulation
title: Simulación y movilidad
description: Estados autoritativos de suelo, aire, saltos, dodge y contactos de RocketSim.
tags: [simulation, mobility, jump, dodge, wall-ride, rocketsim]
sources:
  - id: openwiki-source-da4bd3de86947a180c88d37d
    resource: repo://_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md
  - id: openwiki-source-ed91f65a5e7a3852eeb9fc5e
    resource: repo://src/rocketsim-practice-match.js
  - id: openwiki-source-a419d1e8d5b3c26fe9e758e0
    resource: repo://src/simulation.js
generated: { by: "codex", at: "2026-10-16T08:35:40.163Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-17T10:18:51.966Z
---

# Simulación y movilidad

## Autoridad y publicación

En el backend RocketSim cada snapshot usa el mismo input para sus pasos fijos.
El bridge avanza dos ticks nativos por snapshot, valida que el tick y el conjunto
de IDs recibidos coincidan con la alineación esperada y conserva la pose nativa.
La vista pública convierte posición, velocidad, orientación, contactos, estado de
salto, ventana de segundo salto, dodge, boost y contacto con pared a unidades de
Arsenal.

## Estados observables

Cada coche expone `grounded`, `surfaceType`, normal de superficie y contactos,
además de `jumpState`, `jumps`, `jumpWindowRemaining`, `dodging`, dirección y
tiempo restante del dodge. Los seriales de primer salto, segundo salto y dodge
se generan al detectar los flags ascendentes del coche nativo. El aterrizaje
registra actitud y velocidad normal para que la cámara y las campañas de
calibración puedan observarlo sin alterar el solver.

## Contrato de acciones

El input normalizado limita throttle, steer y roll al intervalo [-1, 1] y
mantiene separadas las acciones jump, boost, drift y airRoll. El primer salto
consume un salto y conserva la ventana de salto sostenido; el segundo edge sin
dirección aplica el segundo salto vertical. Si hay WASD o roll suficiente, ese
edge se convierte en un dodge direccional normalizado en el espacio del coche,
con burst horizontal y torque de pitch o roll durante una ventana corta.

El air roll es un modificador de control en vuelo: mientras está activo, el
steer deja de aportar yaw y se interpreta como roll; sin el modificador, steer
mantiene yaw y el eje de roll permanece independiente. El dodge conserva la
dirección comprometida y no inventa yaw. W/S siguen siendo el eje de pitch en
vuelo y el boost aplica empuje alineado con el morro.

## Pared y techo

El contacto se clasifica por la normal: una componente vertical pequeña indica
pared, una normal hacia abajo indica techo y una normal de suelo indica apoyo.
La presentación publica `wallRide`, `wallNormal` y `ceilingContact`; el salto
desde pared consume un salto, separa el coche de la superficie y aplica impulso
vertical. El solver nativo conserva la orientación y la velocidad angular; no se
autoendereza el coche al aterrizar.

## Fallback legado

El módulo `simulation.js` conserva el solver JavaScript para pruebas y fallback.
Su implementación separa suelo, pared y aire, mantiene damping angular y limita
la velocidad durante el dodge, pero la partida RocketSim en producción toma la
autoridad del bridge nativo. Las campañas de movilidad deben distinguir una
observación no verificada de una discrepancia reproducible antes de ajustar
constantes.

## Fuentes

- `src/rocketsim-practice-match.js`
- `src/simulation.js`
- `_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md`
