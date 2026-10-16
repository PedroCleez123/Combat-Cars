# ARENA-06 — Rampa aislada, navegación y cobertura

**Estado:** Aceptada · 13 de octubre de 2026

## Problema observable

Después de validar bloque y oclusión estática, el mapa aún no contiene una
superficie inclinada que se pueda recorrer y que cubra una línea de tiro. Una
rampa creada sólo en Three.js no demostraría la respuesta del vehículo; una
rampa sólo nativa no permitiría observar la misma arena en el navegador.

## Hipótesis y alcance

Un único prisma triangular propio de **20 × 18 × 4,5** unidades Arsenal,
centrado en la arena `arsenal-expanded-cornered-practice`, permite medir
aproximación, apoyo inclinado, salida y aterrizaje en RocketSim. La misma lista
de seis vértices se representa en Three.js. El carril `z=+1200` UU queda libre
como control de bypass.

Incluye:

- perfil opt-in `arsenal-expanded-ramp-practice` en bridge, Node y cliente;
- malla Bullet cacheada, con los ejes y la escala documentados en el código;
- sonda nativa determinista y prueba de cohete en el modo de combate
  RocketSim;
- documentación de inicio que señale la build que incorpora `staticRaycast`.

No incluye cambios a vuelo, salto, dodge, cámara, suspensión, daño, velocidad,
bots, composición final del mapa ni activos.

## Línea base

- `npm test`: 135/135.
- COMBAT-GEO-02 confirma que un recurso estático nativo puede interceptar un
  cohete sin transferir la autoridad física a Node.
- `arsenal-expanded-cornered-practice` permanece como control sin recursos.

## Criterios de aceptación

1. La rampa tiene la misma geometría declarada en RocketSim y Three.js y el
   perfil anterior no cambia.
2. Dos ejecuciones nativas iguales producen la misma traza: aproximación,
   apoyo inclinado, subida, salida aérea, aterrizaje y bypass lateral.
3. Un cohete rojo contra un coche azul, separados por la rampa, publica
   `COHETE INTERCEPTADO` y conserva los 100 PV de ambos.
4. `npm test` y las sondas de bloque y raycast existentes siguen verdes.
5. La comprobación de navegador se registra por separado si hay una instancia
   local accesible; no se deduce de las pruebas de Node.

## Reversión

Eliminar el perfil opt-in, la malla y sus dos sondas deja intactos perfiles y
reglas existentes. La nueva build nativa se publica bajo otro nombre y nunca
sobrescribe una instancia que el usuario pueda estar usando.
