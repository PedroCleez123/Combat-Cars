# Migración WASM/P2P — estado actual

> Prioridad: **Combat Cars online WASM/P2P**. La migración de producto está
> aceptada y esta es la única ruta mantenida y desplegable. La ruta local
> Three.js + RocketSim nativo se conserva congelada como referencia de
> comportamiento, diagnóstico y regresión, no como producto alternativo.

> La retirada de la ruta local queda aplazada hasta inventariar imports,
> fixtures, herramientas y pruebas; el orden seguro es archivarla o excluirla
> de builds, conservar una copia recuperable y eliminarla sólo cuando WASM/P2P
> ya no dependa de ella.

## Objetivo

Recrear en navegador el juego local de `src/client.js` conservando la física,
combate y sensación de RocketSim. La ruta de producto es Pages + Worker de
señalización + WebRTC P2P; el host ejecuta RocketSim WASM. No se añade una
segunda autoridad ni se usa la antigua arquitectura hosted/Caddy/JWT.

## Implementado

- Lobby offline/práctica jugable al cargar, con nitro infinito y menú compacto.
- Creación/unión de salas privadas mediante clave corta.
- Host WASM con snapshots, combate, proyectiles, respawn, score y ciclo de ronda.
- Cámara online con el mismo seguimiento local y protección del encuadre junto
  a paredes.
- Arena `combat-alpha` con huella plana retraída, quarter-pipes desde el suelo,
  normales interiores coherentes y una shell continua sin líneas guía.
- Modelo de vehículo único, audio desbloqueado por gesto de escritorio y HUD
  reducido al marcador.
- Smoke público de host e invitado con ticks crecientes y cero errores de consola.

## Fuente de paridad

La implementación se contrasta con `src/client.js`, `src/camera-follow.js`,
`src/aim-lock.js`, `src/audio-mixer.js`, `src/vehicle-visual-model.js` y
`src/rocketsim-combat.js`. RocketSim WASM sigue siendo la autoridad; Three.js,
audio y HUD son presentación.

## Pendiente real

1. Repetir conectividad en más NAT/firewalls y navegadores.
2. Medir paridad de física durante sesiones largas, especialmente dodge,
   aterrizaje, pared y esquina.
3. Ampliar roster y UI a 2v2, 3v3 y FFA (máximo seis) sin cambiar autoridad.
4. Optimizar Opera y otros navegadores a partir de perfiles reproducibles.

El online 1v1 funcional no se considera pendiente de configuración: el gate P2P
está superado. El porcentaje de migración solo sube al cerrar los cuatro gates
anteriores con evidencia, no por acumular archivos o builds.
