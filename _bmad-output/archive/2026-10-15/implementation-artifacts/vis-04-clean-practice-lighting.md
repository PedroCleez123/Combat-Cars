# VIS-04 — Iluminación y contraste de práctica limpia

Estado: **Aceptada** · 13 de octubre de 2026

## Problema observable

La arena limpia ya tiene referencias espaciales, pero la luz global es idéntica
al perfil oscuro del desguace. El coche y las transiciones se pierden en zonas
de sombra cuando se practica en pared o aire.

## Hipótesis

Separar los parámetros de luces existentes por perfil y aumentar con moderación
la luz de hemisferio, sol y lavados de equipo en práctica limpia mejora la
lectura del chasis y paredes sin introducir geometría, colisiones ni activos.

## Alcance

- `src/arena-visual-profile.js`: parámetros originales de luz por perfil.
- `src/client.js`: aplicar esos parámetros a luces existentes.
- `tests/arena-visual-profile.test.mjs`: contrato de contraste por perfil.

## Criterios

1. Los modos de práctica usan más iluminación que el desguace y preservan
   separación azul/rojo.
2. El desguace mantiene exactamente sus parámetros previos.
3. No se cambian física, arena nativa, cámara, red, HUD ni geometría.
4. `node --check` y `npm test` pasan.

## Fuera de alcance

No se añaden modelos, decoraciones, obstáculos, texturas, sombras dinámicas,
assets externos ni cambios de combate.

## Resultado

Los perfiles ya controlan la intensidad del hemisferio, sol, lavados azul/rojo
y la exposición. La práctica limpia sube de `2,1/3,45/28/1,1` a
`2,55/4,1/38/1,2`; el desguace conserva exactamente los valores previos.
Las luces existentes se actualizan al cambiar de perfil y no se crea geometría
ni estado de juego. `node --check` pasó; `npm test` terminó en **131/131**.
La inspección visual de píxeles sigue pendiente por el aislamiento del navegador
integrado, por lo que este cierre afirma el contrato y la regresión, no una
observación visual nueva.
