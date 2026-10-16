# R5 — Puente RocketSim aislado

## Historia

Como desarrollador de Car Soccer: Arsenal, quiero ejecutar RocketSim como
backend de movimiento aislado para comparar su vuelo y sus contactos con el
solver actual sin cambiar todavía la partida de producción.

## Alcance

- Ejecutable C++ persistente y protocolo JSONL.
- Cliente Node de ciclo de vida y validación de protocolo.
- Arena limpia y un coche.
- Documentación y script reproducible.

## Fuera de alcance

Combate, bots, respawns, pads, rampas, mallas de Rocket League, cambio del
backend por defecto y ajustes de constantes del solver JavaScript.

## Criterios de aceptación

1. `init` devuelve `ready` con `schemaVersion` y `fixedStepHz=120`.
2. `tick` devuelve un estado por coche con posición, velocidad, orientación,
   apoyo, saltos y dodge.
3. La frontera publica y-up y no expone coordenadas RocketSim sin convertir.
4. `shutdown` cierra el proceso y no deja stdin/stdout bloqueados.
5. El mismo guion produce el mismo hash de resumen en dos ejecuciones.
6. `npm test` permanece en verde; el backend de producción no cambia.

## Comprobación

La compilación nativa es una comprobación de disponibilidad del entorno. La
prueba Node del protocolo puede ejecutarse aunque no esté instalado MSVC/CMake;
en ese caso la compilación queda como `No verificada`, nunca como aceptada.
