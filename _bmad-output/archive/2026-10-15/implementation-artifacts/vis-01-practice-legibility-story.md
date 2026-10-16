# VIS-01 — Legibilidad visual de la práctica limpia

**Estado:** accepted. Contrato de configuración y comprobación perceptual
inicial aceptados; la maniobra aérea temporizada sigue separada.

## Resultado observable

Las prácticas `calibration`, `rocketsim-curved-practice` y
`rocketsim-expanded-curved-practice` usan un fondo y una niebla más claros,
materiales diferenciados para suelo, paredes, techo y curvas, y una rejilla con
mayor contraste. El desguace conserva su perfil oscuro original.

## Alcance y evidencia

- `src/arena-visual-profile.js` contiene la selección pura por modo.
- `src/client.js` aplica el perfil al cambiar de arena sin tocar geometría,
  cámara, inputs, física, red o autoridad.
- En las prácticas curvas, las paredes visuales empiezan sobre el radio de la
  quarter-pipe para evitar solapamiento de superficies en la transición.
- `tests/arena-visual-profile.test.mjs` cubre los tres modos limpios y la
  conservación del perfil de desguace.
- `npm test` pasa 121/121.
- La práctica ampliada arrancó en `http://localhost:5222/` con el bridge R9,
  mostró HUD RocketSim y la arena de cuatro curvas, y no produjo errores de
  consola en la inspección del navegador.

## Pendiente

Comprobar con entradas reproducibles el contraste de coche y proyectil durante
conducción por suelo, pared y techo. Si la niebla oculta los límites o los
emisivos saturan, abrir una corrección visual aislada; no ajustar el solver por
esta historia.
