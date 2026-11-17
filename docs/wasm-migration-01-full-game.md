# Migración WASM/P2P — estado aceptado y validación pendiente

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

## Implementado en la ruta de producto

- Lobby offline/práctica jugable al cargar, con nitro infinito y menú compacto.
- Creación/unión de salas privadas mediante clave corta.
- Sala personal automática y persistente por navegador, con lobby compartido
  `room-open`, alta/baja de pilotos y retorno desde una sala ajena.
- Configuración del host y roster para 1v1, 2v2, 3v3 y FFA; equipos
  equilibrados para modos por equipos y límite de seis plazas.
- Inicio explícito por el host y ronda de cinco minutos.
- Host WASM con snapshots, combate, proyectiles, respawn, score y ciclo de ronda.
- Cámara online con el mismo seguimiento local y protección del encuadre junto
  a paredes.
- Arena `combat-alpha` con huella plana retraída, quarter-pipes desde el suelo,
  normales interiores coherentes y una shell continua sin líneas guía.
- Modelo de vehículo único, audio desbloqueado por gesto de escritorio y HUD
  reducido al marcador.
- Smoke público de host e invitado con ticks crecientes y cero errores de consola.
- Nitro de partida con regeneración autoritativa; el lobby/práctica conserva
  nitro infinito.

La clave de sala permanece válida durante la retención configurada por el
Worker (siete días); no es una identidad permanente ni una garantía de que el
host pueda simular una ronda después de desconectarse.

## Fuente de paridad

La implementación se contrasta con `src/client.js`, `src/camera-follow.js`,
`src/aim-lock.js`, `src/audio-mixer.js`, `src/vehicle-visual-model.js` y
`src/rocketsim-combat.js`. RocketSim WASM sigue siendo la autoridad; Three.js,
audio y HUD son presentación.

## Validación aún pendiente

1. Probar conectividad en más NAT/firewalls; la ruta STUN directa no garantiza
   conectividad universal y no incorpora TURN.
2. Completar QA humana de COV-04/COV-06 y de la presentación online en dos
   navegadores, según el roadmap.
3. Completar la validación manual de reconexión durante `playing` y PR3b
   (epochs y pruebas adversariales).
4. Completar la QA HTTPS de los cambios visuales ART en dos navegadores.
5. Seguir perfilando Opera y otros navegadores cuando haya mediciones
   reproducibles que identifiquen una regresión.

El estado aceptado es **P2P online funcional**. Los modos múltiples, el lobby
persistente y la ronda están implementados; la comprobación automatizada no
sustituye la QA humana por navegador, modo y tipo de red. Los criterios y
prioridades vigentes están en
[`../_bmad-output/current-roadmap.md`](../_bmad-output/current-roadmap.md), no
en porcentajes de migración.
