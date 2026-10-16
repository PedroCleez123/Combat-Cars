# HITBOX-01 — Alineación del chasis visible con el pivote físico

**Fecha:** 14 de octubre de 2026  
**Estado:** implementación aceptada; observación invertida pendiente
**Propietario:** cliente Three.js / contrato de coordenadas

## Problema

El estado RocketSim publica la posición del coche desde su pivote nativo y el
adaptador web resta la altura de reposo para que un coche nivelado lea `h=0` en
el suelo de Arsenal. El modelo provisional se rotaba alrededor de ese plano de
suelo; al invertir el coche, esa diferencia podía hacer que la carrocería
renderizada entrara en el suelo aunque la colisión nativa siguiera siendo la
autoridad.

## Cambio mínimo

- `src/vehicle-visual-alignment.js` define el desplazamiento del pivote
  RocketSim (`17 * 56 / 2300`), importa el tamaño y offset Octane del
  RocketSim público local y calcula una escala vertical uniforme para el
  prototipo. El borde de ruedas se apoya en el suelo en posición normal y el
  techo alcanza el plano de contacto nativo al invertir el coche.
- `src/client.js` coloca la raíz visual en el pivote y desplaza la malla como
  hija antes de aplicar el quaternion autoritativo; aplica la escala calculada
  únicamente a la presentación del coche.
- No se cambian hitboxes nativas, fuerzas, contactos, snapshots ni el contrato
  de red.

## Criterios y evidencia

- La posición nivelada conserva la apariencia previa: prueba
  `vehicle-visual-alignment.test.mjs`.
- Una orientación invertida gira alrededor del pivote físico, no del suelo:
  prueba `vehicle-visual-alignment.test.mjs`.
- La prueba verifica el contacto normal y el contacto invertido contra el
  plano superior de la hitbox Octane, sin alterar el solver.
- Fallback JavaScript sin cambios de origen: prueba correspondiente.
- `node --check src/client.js`: correcto.
- `npm test`: **160/160**.
- Host `http://localhost:5300/?arena=combat-alpha` recargado después del cambio,
  HUD y partida visibles, coche en suelo, sin warnings ni errores de consola
  observados. Esta es una comprobación visual de arranque y reposo, no del
  vuelco.

## Limitación

Todavía no se ha ejecutado una maniobra visual reproducible que termine boca
abajo con contacto de suelo en una sesión aislada. Por ello el resultado de
penetración invertida queda **no verificado visualmente**, aunque la
transformación, escala y contactos límite están cubiertos de forma
determinista.

## Siguiente decisión

Observar un vuelco aislado. Si la carrocería sigue penetrando, medir el contacto
nativo y abrir una corrección del bridge; si queda contenida, cerrar HITBOX-01 y
pasar a `ARENA-CEILING-01`.
