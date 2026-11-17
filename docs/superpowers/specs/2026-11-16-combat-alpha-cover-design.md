# Combat-alpha: cobertura industrial autoritativa

## Estado

Diseño aprobado por el usuario el 16/11/2026. Este documento define el hito
COV y no introduce código, geometría física ni assets runtime.

## Intención

La arena industrial debe ofrecer decisiones de posición y líneas de tiro sin
convertirse en un laberinto. El jugador debe poder esconderse temporalmente de
un cohete, cambiar de carril o ganar un ángulo, pero también debe poder rodear
la cobertura o volar por encima de ella. La cobertura debe funcionar igual en
la práctica local, el lobby y la partida P2P porque la misma arena WASM del host
es autoritativa para los tres estados.

## Objetivos

- Añadir pocas coberturas industriales reconocibles: cuatro barreras de
  contenedor y dos barricadas de neumáticos.
- Hacer que coches y cohetes consulten el mismo proxy estático RocketSim.
- Mantener paridad entre el bridge nativo de regresión, el wrapper WASM y los
  renderers local/P2P.
- Conservar un carril central, rutas exteriores, zonas de aparición y la
  recuperación tras impactos sin obstáculos peligrosos.
- Mantener el coste visual dentro del presupuesto ART-05/06 y no añadir luces
  dinámicas por prop.

## No objetivos

- No cambiar la topología de suelo, curvas, paredes, techo, rampas existentes,
  spawns, tick, controles, red, equipos, scoreboard o respawn.
- No reintroducir pickups de nitro: el recurso sigue siendo regenerable.
- No usar mallas artísticas como colisionadores ni añadir un motor de física.
- No crear un laberinto de chatarra, obstáculos móviles o destrucción en este
  hito.
- No requerir nuevas texturas para arrancar. Los neumáticos empiezan con un
  material oscuro compartido; una textura específica es una mejora posterior,
  sólo si el playtest la justifica.

## Restricciones del proyecto

- `combat-alpha` mide 264 × 408 × 108 UU con curva de borde de 30 UU.
- RocketSim WASM ejecutado por el host es la autoridad online; la ruta local
  nativa sólo es referencia y regresión.
- El raycast estático del host ya intercepta cohetes antes de aplicar daño.
- `src/combat-alpha-map.js` es el contrato declarativo de lectura y el bridge
  C++ debe reflejarlo con constantes verificadas por tests.
- El paquete visual conserva los cuatro WebP ART-02 existentes.

## Alternativas consideradas

### A. Decoración sin colisión

Es barata y segura para rendimiento, pero no bloquea cohetes ni crea la decisión
jugable solicitada. Se descarta.

### B. Colisionar contra mallas detalladas

Da una silueta aparentemente exacta, pero introduce demasiados triángulos,
seams, túneles y divergencias entre RocketSim nativo/WASM. Se descarta.

### C. Proxies estáticos simples con revestimiento visual — elegida

Cada cobertura tiene un ID y un volumen `box` autoritativo. La presentación
construye un contenedor o una pila de neumáticos visual con geometría/materiales
compartidos y conserva una referencia a ese ID. Así el raycast y el contacto de
coche no dependen de Three.js.

## Layout inicial aprobado

Los valores son una primera hipótesis en unidades Arsenal; COV-02 puede mover un
elemento dentro del sobre seguro indicado si una sonda de contacto o de línea de
tiro lo exige, pero no puede romper simetría ni los límites de despeje.

### Barreras de contenedor

Cuatro registros, en parejas rotadas 180° alrededor del centro:

- posiciones nominales `(x, z) = (-45, -58), (-45, 58), (45, -58), (45, 58)`;
- proxy `box`, ancho X 10, profundidad Z 24 y altura 6;
- el eje largo queda transversal al tiro principal X, para cortar la línea
  directa y conservar un rodeo superior/lateral;
- acabado visual: metal corrugado, tapa estructural y banda hazard estrecha.

### Barricadas de neumáticos

Dos registros, uno por lado de equipos:

- posiciones nominales iniciales `(x, z) = (-68, 0), (68, 0)`; COV-02 las
  ajusta a `(-68, -30), (68, 30)` para no cortar el trazado autoritativo de
  pared en `z = 0`, manteniendo el espejo 180° y la cobertura lateral;
- proxy `box`, ancho X 8, profundidad Z 8 y altura 2.4;
- la pila visual usa tres o cuatro anillos instanciados, pero el proxy sigue
  siendo un único volumen cerrado para evitar microcolisiones;
- acabado visual: caucho oscuro compartido, pequeño aro metálico opcional y sin
  luces.

### Reglas espaciales

- La transformación espejo es `x -> -x, z -> -z`; cada pareja de equipos tiene
  la misma cobertura, bypass y exposición.
- Ninguna cobertura entra en el radio de seguridad de un spawn (`vehicleRadius`
  más el margen del obstáculo).
- No se colocan coberturas dentro de la envolvente de `central-block` o
  `south-ramp`, ni sobre la curva de pared/suelo.
- Deben quedar libres un corredor central alrededor de `z = 0` y dos corredores
  exteriores; una línea de tiro no bloqueada debe seguir siendo posible rodeando
  cada prop.
- La altura de contenedor bloquea el cohete a la altura de un coche apoyado,
  pero permite sobrevuelo de un coche que gane altura; la barricada de neumáticos
  es cobertura baja, no una pared total.

## Contrato de autoridad

Cada registro de `COMBAT_ALPHA_OBSTACLES` tendrá `id`, `kind`, posición,
dimensiones, `role: "cover"`, `visualKind` y `symmetryGroup`. El descriptor se
usará para comprobar bounds, solapes y despejes, pero no para escribir la pose
de un coche.

El wrapper WASM y `tools/rocketsim-bridge/main.cpp` añadirán los mismos cuerpos
estáticos con cajas Bullet/RocketSim. Ambos deben mantener `useCustomBroadphase`
desactivado para `combat-alpha`. `raycastStatic` debe devolver el primer proxy
cuando el segmento atraviesa una cobertura y no debe devolver hit cuando el
segmento pasa por encima o por un carril lateral.

El host conserva la decisión existente: si el hit estático llega antes que el
objetivo, el cohete se consume como intercepción y no aplica daño. No se añade
estado de cobertura a snapshots ni a mensajes P2P.

## Contrato de presentación

`src/arena-decoration.js`, `src/client.js` y
`tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs` consumen el mismo
descriptor de obstáculos. Las mallas visuales se marcan `visualOnly: true` y
guardan `nativeColliderId`; esa marca no convierte el prop visual en autoridad.

- Contenedores: geometría de caja compartida, material ART-03, tapa metálica y
  hazard sólo en una banda estrecha.
- Neumáticos: geometría de anillo/cilindro compartida e `InstancedMesh`; no se
  crea una malla ni una luz por neumático.
- Fallback: si el material industrial falla, las coberturas siguen visibles con
  material opaco legible.
- Objetivo incremental: como máximo 6 draw calls, 6.000 triángulos y cero luces
  dinámicas nuevas para las seis coberturas.

## Verificación y aceptación

1. Tests del descriptor: seis nuevos IDs, simetría, bounds, no solape con
   spawns/rampa/bloque/curvas, cero pickups y al menos tres corredores libres.
2. Tests nativos/WASM: coche no atraviesa un contenedor ni una barricada a
   velocidad alta; el raycast bajo intercepta; el raycast alto y los rodeos
   laterales quedan libres; las paredes, curvas, techo y rampa conservan sus
   contactos.
3. Tests de combate: cohete interceptado no daña ni puntúa; el mismo tiro por
   un carril libre conserva daño/resultado actual; lobby no convierte un choque
   en kill.
4. Tests de paridad visual: mismo ID, posición, dimensiones y escala en local y
   P2P; materiales/fallback/disposal correctos; ningún prop entra en snapshots.
5. QA manual: práctica, lobby y partida de dos navegadores; aproximación a
   cada cara, rodeo, sobrevuelo, impacto de coche, cohete bajo/alto y recuperación
   de borde; registrar FPS, draw calls y cualquier oclusión del coche/HUD.

## Entregables y orden

1. COV-01: contrato de layout y pruebas puras.
2. COV-02: proxies nativos/WASM y pruebas físicas/raycast.
3. COV-03: revestimiento visual local/P2P y pruebas de paridad.
4. COV-04: balance, rendimiento, QA y actualización final del roadmap.

No se despliega Pages hasta cerrar COV-04 y ejecutar la comprobación online
manual solicitada.
