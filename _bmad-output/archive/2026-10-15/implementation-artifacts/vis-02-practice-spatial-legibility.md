# VIS-02 — Referencias espaciales de la práctica limpia

**Estado:** aceptada el 13 de octubre de 2026.

## Problema observable

La arena limpia ya es más clara que el desguace, pero el suelo y las paredes
son casi uniformes. Durante una maniobra aérea resulta difícil leer el centro,
la dirección de cada lado y la altura sin usar elementos que podrían confundirse
con obstáculos.

## Hipótesis y alcance

Marcas originales, planas y no físicas en suelo y paredes mejorarán la lectura
del espacio sin afectar contacto, cámara, red ni el solver. Se usan solo
geometrías Three.js existentes: línea central, anillo de referencia, bandas de
equipo y guías verticales de baja intensidad en esquinas. La selección vive en
el perfil de práctica limpia y el desguace conserva su presentación.

## Criterios de aceptación

1. La arena RocketSim cornered muestra referencias distinguibles de centro,
   equipo y altura sin crear colisiones ni tapas visuales.
2. Las guías verticales siguen la esquina curva y no ocultan el coche.
3. El desguace no recibe estas marcas.
4. La consola del navegador queda sin errores y `npm test` sigue verde.

## Fuera de alcance

No se cambian mallas nativas, radios, techo, iluminación dinámica, cámara,
física, armas, rampas, obstáculos, recursos externos ni UI.

## Resultado

La práctica limpia incorpora una línea central, anillo de referencia, dos
bandas de orientación azul/roja y, únicamente en la arena cornered, cuatro
guías verticales situadas sobre la superficie curva de las esquinas. Son mallas
o líneas de Three.js sin forma de colisión. El perfil de desguace no llama a
esta construcción. El navegador en `5284` recargó el perfil sin errores ni
advertencias de consola; `node --check src/client.js` y `npm test` pasaron,
con **130/130** pruebas.
