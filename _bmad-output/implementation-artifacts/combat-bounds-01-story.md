# COMBAT-BOUNDS-01 — límites de cohete por perfil de arena

**Estado:** aceptada en pruebas de código; verificación visual/LAN pendiente.
**Fecha:** 16 de octubre de 2026

## Resultado observable

Un cohete de `combat-alpha` que cruza x=62 pero sigue dentro de la arena
expandida no desaparece por el fallback de Node. El cliente y la lógica de
combate consultan el mismo perfil nominal de arena, mientras RocketSim conserva
la autoridad sobre colisiones y raycast estático.

## Problema reproducible

`stepRocketSimCombat` tenía por defecto `halfWidth=62`, `halfDepth=46` y altura
30. `combat-alpha` usa la arena expandida nativa de 72×54×30 Arsenal. Un
cohete en x=61,5 con velocidad x=120 era eliminado al siguiente paso aunque
seguía dentro del volumen jugable.

## Autoridad e invariantes

- RocketSim sigue siendo la autoridad de movimiento y colisiones.
- El raycast estático del bridge sigue decidiendo la oclusión de un cohete.
- Node conserva daño, cooldown, puntuación y respawn.
- El perfil JS solo fija el límite de seguridad y las dimensiones de
  presentación; no sustituye la geometría nativa.
- Las arenas anteriores mantienen sus dimensiones nominales y los perfiles no
  reconocidos no inventan una geometría nueva.

## Implementación

- `src/rocketsim-arena-profile.js` registra perfiles y la traducción de modos
  visuales a nombres de arena.
- `src/rocketsim-combat.js` usa los límites expandidos de `combat-alpha` como
  fallback seguro e incorpora altura configurable.
- `src/rocketsim-practice-match.js` pasa los límites del perfil activo al
  combate Node.
- `src/client.js` consume el mismo perfil para ancho, profundidad, altura,
  curvas y esquinas de la malla visual.
- El módulo se añadió a la allowlist HTTP de `LAN-HARDEN-01`.

## Verificación

- `npm test`: 166/166.
- `node --check` de servidor, cliente, perfil, combate y práctica: correcto.
- Regresión directa: el cohete termina en x>62 y permanece vivo con los
  límites de `combat-alpha`.
- La prueba visual/LAN con el host R19 queda no verificada desde este sandbox.

## Siguiente unidad pequeña

Cerrar la verificación viva de `LAN-HARDEN-01` y `COMBAT-BOUNDS-01` en el host
PowerShell; después volver a `HITBOX-01` invertida sin modificar fuerzas por
intuición visual.
