# COMBAT-GEO-01 — consulta nativa de geometría estática

Estado: **Aceptada** · 13 de octubre de 2026

## Problema observable

El perfil `arsenal-expanded-block-practice` ya tiene un bloque físico nativo que detiene coches, pero un cohete del modo RocketSim se simula como regla Node y sólo detecta coche enemigo o límites de arena. En una futura partida con recursos atravesaría el bloque.

## Hipótesis causal

`stepRocketSimCombat` no recibe una consulta de mundo estático del bridge. El bridge ya posee `Arena::_bulletWorld`, donde viven los `btBoxShape` y las mallas de la arena, pero el protocolo JSONL no expone un segmento de consulta ni las capacidades del ejecutable.

## Alcance

- Spike mínimo que comprueba `rayTest` o equivalente contra el bloque ARENA-05.
- Diseño e implementación aditiva de una consulta de segmentos estáticos, si el spike permite excluir coches de forma estable.
- Capacidad explícita en `ready` y rechazo claro de una build sin ella cuando se seleccione combate con recursos.
- Sonda nativa determinista de impacto frontal, paso lateral, pared/techo y orden de resultados.
- Pruebas de protocolo y adaptación de bridge, sin integrar aún daño, reglas de cohete, rampa ni composición de arena.

## Fuera de alcance

No cambiar física de coche, controles, cámara, constantes de proyectil, reglas de daño, perfiles existentes, malla visual, bots ni red WebSocket del navegador.

## Criterios de aceptación

1. Un segmento que cruza el bloque devuelve el primer impacto estático, con tick, fracción `[0,1]`, punto y normal finitos.
2. Un segmento que pasa junto al bloque no impacta.
3. El resultado distingue estático de vehículo sin cambiar la autoridad de RocketSim sobre contactos.
4. Dos ejecuciones de la sonda son idénticas.
5. `npm test`, la compilación del bridge y la prueba de protocolo quedan verdes.
6. Si el filtro fiable no es posible, se publica el spike y se aplaza sin sustituirlo por geometría duplicada en Node.

## Comprobaciones aplicables

| Criterio | Base | Post esperado |
| --- | --- | --- |
| Bloque detiene coche | `probe:rocketsim-block-arena` verde | Sigue verde |
| Cohete contra recurso | No existe consulta nativa | Sonda de segmentos determinista |
| Protocolo | `npm test` 132/132 | Suite completa verde |
| Navegador | Perfil ARENA-05 observado por usuario | No requerido: no cambia presentación |

## Decisión de salida

Sólo después de aceptar esta historia se abre COMBAT-GEO-02 para hacer que el cohete se detenga contra el recurso. Una rampa o `combat-alpha` antes de esa puerta produciría reglas inconsistentes.

## Evidencia de cierre

- `npm test`: **133/133**.
- `npm run probe:rocketsim-static-raycast` con R11: dos ejecuciones idénticas,
  SHA `a11588fe9e2632afb145a0c6733ab8fc927297922e6096989958a5b0045c19e3`.
- `npm run probe:rocketsim-block-arena` con R11: contacto del bloque, bypass
  lateral y ticks consecutivos sin regresión.
- Coordenadas del contrato: RocketSim público y-up; la conversión a Bullet y
  el filtrado de cuerpos dinámicos viven únicamente en el bridge.
- No se requiere navegador: no cambia render, controles ni movilidad.

COMBAT-GEO-02 queda fuera de esta historia: aún debe consumir la consulta al
avanzar un cohete y resolver el primer impacto entre recurso estático y coche.
