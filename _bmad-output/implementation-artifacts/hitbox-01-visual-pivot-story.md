# HITBOX-01 — Alineación del chasis visible con el pivote físico

**Fecha:** 14 de octubre de 2026  
**Estado:** implementación aceptada; contacto nativo invertido aceptado; verificación visual pendiente
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
- `npm test`: **177/177**.
- `npm run probe:rocketsim-hitbox-01` con R19 y un solo coche: `upY=-1`,
  inversión observada en el tick 96 y contacto de carrocería en el tick 170,
  con normal de suelo `y=1`, `wheelCount=0` y sin ruedas apoyadas. La sonda
  recorre 1200 ticks para distinguir contacto real de un salto largo.
- La campaña navegable `?hitbox01=1` espera R19, un solo piloto y respawn
  autoritativo; detecta ese contacto mediante `contacts` y `wheelCount`, sin
  modificar el solver ni juzgar los píxeles por sí sola.
- Al registrar el contacto, la campaña libera todos los controles. No existe
  auto-upright, impulso de recuperación ni cambio de orientación: recuperar
  ruedas sigue siendo responsabilidad del jugador y de RocketSim.
- Durante la preparación automática, HITBOX-01 reserva las entradas hasta el
  contacto para que la maniobra sea reproducible. Después del contacto, con
  bridge no compatible o con varios pilotos, devuelve la entrada manual; el
  HUD distingue `CONTROLES AUTOMÁTICOS` de `CONTROL DEL JUGADOR`.
- El canvas reclama foco al primer clic y al volver visible el documento. Esto
  cubre el navegador integrado cuando conserva el foco fuera de la página; no
  altera las acciones ni la autoridad de RocketSim.
- Host `http://localhost:5300/?arena=combat-alpha` recargado después del cambio,
  HUD y partida visibles, coche en suelo, sin warnings ni errores de consola
  observados. Esta es una comprobación visual de arranque y reposo, no del
  vuelco.

## Limitación

La traza nativa confirma el contacto invertido, pero la automatización de
interfaz de esta sesión no pudo abrir el navegador para inspeccionar píxeles.
Por ello la ausencia de penetración visual queda **no verificada visualmente**;
la transformación, escala y contacto autoritativo sí están cubiertos de forma
determinista.

## Siguiente decisión

Abrir `http://localhost:5300/?arena=combat-alpha&hitbox01=1` en una sesión
R19 limpia. Si la carrocería queda contenida en el contacto marcado por el HUD,
cerrar HITBOX-01 y pasar a `ARENA-CEILING-01`; si penetra, conservar la captura
y corregir solo la presentación visual.
