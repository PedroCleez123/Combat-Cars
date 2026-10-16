# Plan de ruta vigente — post ARENA-05

Estado: **ARENA-07, VIS-06 y GAME-04 aceptadas; ONLINE-01 es la siguiente historia** · 14 de octubre de 2026

## Punto de partida comprobado

- La movilidad, salto, dodge, vuelo, paredes y esquinas se ejecutan en RocketSim a 120 Hz; Node sólo traduce entradas, red y reglas de combate.
- La campaña MOB-01, la LAN de seis pilotos y el ciclo de combate básico están aceptados por sondas autoritativas. La observación de navegador de movilidad y la del perfil ARENA-05 también están realizadas.
- `arsenal-expanded-block-practice` añade un bloque con colisión Bullet y representación Three.js coincidentes. La sonda nativa demuestra contacto frontal y bypass lateral.
- La regresión de referencia termina en **132/132**.

## Hallazgo que decide el orden

`src/rocketsim-combat.js` integra cohetes como reglas de Node. Actualmente sólo contrasta su posición contra coches y límites de arena. No consulta los `btBoxShape` ni las mallas del bridge. Por tanto, introducir recursos en una partida de combate antes de resolver esta frontera produciría cohetes que atraviesan bloque, rampa o cobertura.

La corrección no consiste en duplicar la geometría en JavaScript ni en pasar la física del coche a Node. La solución a evaluar es una consulta de segmento contra las formas estáticas del `Arena::_bulletWorld`, expuesta por el bridge y consumida por las reglas de Node. RocketSim sigue siendo dueño de vehículos y colisión del mapa; Node conserva proyectiles, daño, puntuación y respawn.

## Invariantes vigentes

1. Three.js + Node continúan como cliente y servidor web; no hay migración de motor ni nuevas dependencias.
2. RocketSim mantiene pose, velocidad, rotación, saltos, contactos, respawn y colisión de vehículos. El cliente sólo presenta snapshots e inputs.
3. Cada perfil de arena debe mantener la misma geometría nativa y visual, con prueba propia. El perfil cornered limpio se conserva como control.
4. No se retocan vuelo, salto, dodge, suspensión ni cámara sin una discrepancia reproducible. No se añade autoenderezado.
5. Ninguna mecánica de combate usa una fuente de colisión alternativa cuando el recurso físico ya existe en RocketSim.

## Hito C — recursos de combate con autoridad compartida

### COMBAT-GEO-01 — consulta nativa de geometría estática

**Prioridad: siguiente historia implementable.**

**Problema:** el bloque de ARENA-05 detiene coches pero no proyectiles del modo combate.

**Hipótesis:** una consulta segmentada en el bridge contra `Arena::_bulletWorld` puede devolver el primer impacto estático de cada cohete, con tick, fracción, punto, normal y tipo de superficie, sin aceptar poses desde Node.

**Alcance previsto:**

- Probar primero la consulta de Bullet sobre el bloque aislado y distinguir recurso estático de coche.
- Extender el protocolo de bridge de forma aditiva y declarar una capacidad en `ready`; una build antigua debe fallar de forma explícita para un perfil de combate con recursos, nunca caer a una colisión JavaScript silenciosa.
- Crear una sonda determinista de segmentos: impacto frontal, paso lateral, techo/pared y orden estable de resultados.
- No cambiar las constantes de cohete, daños, movimiento, cámara, perfiles existentes ni la composición de la arena.

**Aceptación:** dos ejecuciones producen la misma traza; un segmento que cruza el bloque devuelve un único primer impacto estático con normal y fracción finitas; un segmento lateral no impacta; `npm test`, build nativa y prueba de protocolo permanecen verdes.

**Decisión de salida:** si `Arena::_bulletWorld` no permite filtrar de manera estable coche y mundo estático, se detiene la historia con un spike documentado. No se sustituye por hitboxes duplicados.

### COMBAT-GEO-02 — cohetes contra recursos

**Dependencia:** COMBAT-GEO-01 aceptada.

Integrar la respuesta nativa en `stepRocketSimCombat`: el primer impacto entre segmento de cohete, vehículo enemigo y recurso decide la detonación. El daño continúa siendo regla Node, usando poses nativas; un recurso intercepta sin daño a través de él. Se medirá impacto directo, pantalla parcial, impacto de pared y cooldown, con una campaña WebSocket. Sin rampa nueva ni arte.

### ARENA-06 — rampa aislada y navegable

**Dependencia:** COMBAT-GEO-02 aceptada.

Añadir una sola rampa de perfil propio, con malla Bullet, visual Three.js y contrato de dimensiones compartido. La sonda debe recorrer aproximación, apoyo, ascenso, salida, aterrizaje y bypass; el modo combate debe verificar que un cohete la intercepta. La rampa se acepta por comportamiento medido del solver RocketSim, no por aproximación del antiguo solver JavaScript.

### ARENA-07 — composición `combat-alpha`

**Dependencia:** ARENA-06 aceptada.

Crear un perfil independiente, simétrico y pequeño con los recursos ya validados, spawns seguros y líneas de visión deliberadas. Ejecutar seis pilotos humanos, colisiones coche-recurso, cohetes con cobertura, respawn y limpieza de sidecar. La arena limpia cornered sigue disponible para calibración.

**Salida:** una partida LAN de combate con entorno jugable, sin bots ni online público todavía.

## Hito D — presentación y bucle de partida

### VIS-06 — lenguaje visual de `combat-alpha`

**Dependencia:** ARENA-07 aceptada.

Mejorar luz, materiales, balizas de equipo, silueta de recursos, suelo y horizonte mediante Three.js procedural. Se mide legibilidad de coche, cohete, rampa y cobertura en navegador. `img2threejs` sólo se considerará si existe una referencia de arte concreta y licenciada; no hace falta para esta fase.

### GAME-04 — sesión repetible de combate LAN

**Dependencia:** ARENA-07 y VIS-06 aceptadas.

Definir victoria, reinicio de ronda, configuración humana 1–6, estados de espera y cierre/desconexión en la arena `combat-alpha`. Bots siguen fuera hasta contar con entradas RocketSim probadas.

## Hito E — preparación online, no despliegue

### ONLINE-01 — diseño del envoltorio de sala

**Dependencia:** GAME-04 repetible en seis pilotos.

Diseñar y probar localmente versión de protocolo, sala, identidad efímera, heartbeat, reconexión, límites de frame, allowlist de origen, rate limiting y cierre de sidecar. HTTPS/WSS y despliegue se tratan después, con una historia separada. No se añaden cuentas ni matchmaking en esta fase.

## Trabajo aplazado de forma consciente

- Ajustes de movilidad, cámara o aterrizaje sin un caso reproducible.
- Más de un recurso de arena por historia.
- Bots, pads, economía de nitro, matchmaking, cuentas y persistencia.
- Activos externos, generación de modelos o cambio de motor.

## Protocolo de ejecución

Cada historia crea una ficha BMad, define Base/Post/Delta, conserva los perfiles anteriores y termina con sonda determinista, `npm test` y observación de navegador cuando proceda. Un fallo de entorno se registra como **No verificado** y no autoriza cambios compensatorios de física.
