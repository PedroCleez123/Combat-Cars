# ARENA-02 — Esquinas curvadas de práctica

**Estado:** aceptada el 13 de octubre de 2026.

## Problema observable

La arena ampliada tenía cuatro transiciones continuas suelo-pared, pero cada
quarter-pipe terminaba un radio antes de un vértice. Las esquinas cambiaban de
superficie de forma brusca, aunque la presentación no lo señalase.

## Decisión y alcance

Se añadió `arsenal-expanded-cornered-practice` como perfil opt-in. Conserva
`arsenal-expanded-curved-practice` sin cambios para comparar regresiones. Cada
vértice añade un parche esférico propio de radio 8 Arsenal: `theta` recorre
suelo a pared y `phi` une las dos paredes. Los paneles verticales del nuevo
perfil son finitos; un plano infinito se solapaba con la esquina y causaba un
cambio de normal de 45 grados en la primera sonda.

El bridge y Three.js usan la misma parametrización, 32 segmentos verticales y
16 horizontales. No se importan mallas, medidas ni recursos de Rocket League o
Car Soccer. Pared-techo, arte final, obstáculos y rampas quedan fuera.

## Criterios y evidencia

`npm run probe:rocketsim-cornered-arena` inicia cuatro coches, uno por esquina,
a 120 Hz. Exige apoyo inclinado, llegada a pared, ningún hueco antes de pared,
normal no invertida y cambios consecutivos de normal de como máximo 8 grados.
Repite la traza y compara ambos resultados.

La captura `docs/reference-captures/rocketsim-cornered-practice-arena-02.json`
registró cuatro recorridos deterministas de 180 ticks, 133 ticks de apoyo por
coche, sin hueco previo a pared y un salto máximo de normal de **4,474°**.
El HUD identifica el perfil como `ESQUINAS CURVAS` para no confundirlo con la
arena de cuatro paredes anterior.
La regresión `tests/camera-follow.test.mjs` añade una secuencia suelo → esquina
→ pared: limita el giro de rumbo por modo y exige posiciones/foco finitos.
La sonda `npm run probe:rocketsim-cornered-camera` reproduce 180 muestras de
pose nativa a 60 Hz y pasa por los modos ground, wall y air. El mayor cambio de
rumbo fue **0,0467 rad/frame**, por debajo del límite de 0,1 rad/frame; la
posición y el foco permanecieron dentro de los límites de la arena ampliada.

La prueba real en `http://127.0.0.1:5284/?mob02=1` cargó el perfil, mostró el
HUD `ESQUINAS CURVAS`, recibió ACK y recorrió `drive → settle → jump → aerial
→ recover → done` sin errores de consola. La recuperación terminó con
`no-wheel-support`: RocketSim no auto-endereza un coche apoyado sobre la
carrocería y la prueba lo registra sin alterar la física.

## Próximo paso

Hacer una reproducción de navegador sobre este perfil para comprobar cámara y
legibilidad al recorrer una esquina. No promover este perfil a predeterminado
ni ajustar la física del vehículo hasta tener esa observación.

