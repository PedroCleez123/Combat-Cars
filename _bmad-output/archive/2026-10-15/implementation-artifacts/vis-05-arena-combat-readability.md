# VIS-05 — Lectura de arena para combate

Estado: **Aceptada** · 13 de octubre de 2026

## Problema observable

La práctica RocketSim tiene suelo, paredes y esquinas legibles, pero a velocidad
los límites del campo y la orientación de los dos extremos se leen solo por las
marcas del suelo. Esto dificulta distinguir dirección y espacio de combate sin
aportar información física nueva.

## Hipótesis

Dos lavados de equipo muy suaves en las paredes de fondo y una guía perimetral
continua harán más evidente la escala y la orientación del campo. Al ser
materiales visuales sin colisión ni estado de juego, no pueden alterar la
simulación autoritativa.

## Alcance

- `src/arena-visual-profile.js`: colores y opacidad del acento de combate.
- `src/client.js`: planos de orientación y guía perimetral en la arena limpia.
- `tests/arena-visual-profile.test.mjs`: contrato de que el perfil limpio expone
  los acentos y el desguace no cambia.

## Criterios de aceptación

1. Los cuatro modos de práctica limpia muestran dos lavados de extremo y una
   guía perimetral, sin modificar suelo, paredes nativas, cámara o contactos.
2. El perfil scrapyard conserva exactamente sus valores anteriores y no recibe
   estos acentos.
3. La geometría añadida no se registra como cobertura ni participa en el
   protocolo, física, armas o HUD.
4. `node --check src/client.js` y `npm test` pasan.

## Fuera de alcance

No se cambian solver, dimensiones, cámara, controles, red, combate, obstáculos,
rampas, bots, assets externos ni materiales del desguace.

## Línea base

La línea base previa es `npm test`: 131/131. La arena cornered y su observación
visual MOB-01V están aceptadas; esta historia solo añade presentación.

## Resultado

Se añadieron los acentos visuales al perfil de práctica limpia: dos lavados de
extremo con opacidad baja y una línea perimetral sobre el suelo. No se tocaron
la arena nativa, el solver, la cámara, el protocolo, el HUD ni los materiales
del desguace. `node --check src/client.js` y `npm test` pasaron con **131/131**.

La comprobación visual posterior quedó aceptada contra la instancia RocketSim
que el usuario mantuvo en `http://localhost:5189/`: el navegador mostró la
arena cornered, los lavados de extremo, la guía perimetral, coche, HUD y ACK
activo sin error. La captura confirma que los acentos no introducen una nueva
geometría de juego ni oscurecen la lectura base.

