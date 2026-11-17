# Combat Cars

Combat Cars es un juego web multijugador. La migración de producto a WASM/P2P
está realizada y la ruta **online WASM es la única versión prioritaria,
mantenida y desplegable**:

- **Online:** [combat-cars.pages.dev](https://combat-cars.pages.dev) sirve el
  cliente WASM; el Worker solo señaliza y WebRTC conecta los navegadores. El
  anfitrión ejecuta RocketSim WASM y conserva la autoridad de la partida.
- **Local histórica:** `npm run play` arranca la antigua ruta Three.js +
  RocketSim nativo. Está congelada como referencia de comportamiento,
  diagnóstico y regresión; no es una segunda versión de producto.

La ruta WASM conserva la semántica que necesitamos del juego local, pero la
referencia local no debe considerarse una implementación paralela que haya que
mantener al mismo ritmo.

### Política de retirada de la ruta local

No se elimina todavía `server.mjs`, el cliente Three.js local ni sus fixtures.
Antes hay que inventariar dependencias, pruebas, herramientas de comparación y
capturas; después se puede archivarla y excluirla de las builds públicas. La
eliminación definitiva sólo procede cuando las pruebas WASM/P2P ya no la
consuman y exista una copia histórica recuperable.

El nombre técnico del paquete y algunas rutas históricas conservan el slug
`car-soccer-arsenal` para no romper compatibilidad.

## Flujo de juego

Al entrar se abre la práctica jugable y se crea o restaura automáticamente tu
sala personal. La clave se muestra para compartirla; se conserva en ese
navegador mientras la sala siga dentro de la retención de siete días del
Worker. La clave identifica la sala, no es un secreto de autenticación.

Los jugadores con esa clave aparecen en la misma arena y pueden conducir con
nitro infinito mientras esperan, sin PvP, daño ni puntuación. El nombre es
obligatorio para unirse. El host elige el modo y los equipos antes de empezar:
1v1 requiere 2 pilotos, 2v2 requiere 4, 3v3 requiere 6 y FFA admite de 2 a 6.
Los equipos deben quedar equilibrados en los modos por equipos. **Empezar
partida** inicia una ronda de cinco minutos. Al abandonar una sala ajena, el
navegador puede volver a su propia sala personal; si el host se marcha, otro
jugador asume la sala compartida y el antiguo host recupera una clave personal
propia al volver.

## Controles de escritorio

- `WASD`: conducir y controlar el coche en el aire.
- `Shift izquierdo`: derrape / air roll libre.
- `Ctrl izquierdo` y `Espacio`: air roll direccional.
- Clic derecho: saltar / doble salto.
- Clic izquierdo: nitro.
- `F`: lanzar cohete; `Q`: fijar objetivo.

La partida online no tiene una tecla para reiniciarla. La ruta local congelada
(`npm run play`) conserva el reinicio histórico para pruebas de desarrollo.

## Desarrollo

```powershell
npm install
npm run play              # referencia local con RocketSim nativo
npm run play:wasm         # referencia local con backend WASM
npm test                  # suite local y online
npm run build:pages-beta
npm run verify:pages-beta
npm run smoke:p2p-causal-beta:public-electron
```

La publicación no usa Caddy, JWT ni `ARSENAL_ONLINE_ADAPTER=hosted`: esa era
otra arquitectura y no forma parte de Pages + Worker + WebRTC. La prueba
pública de una pestaña valida lobby, canvas, conexión y avance de ticks; la
presencia de un rival se valida con dos navegadores.

## Fuente de verdad

La paridad con el juego local se compara siempre contra:
`src/client.js`, `src/camera-follow.js`, `src/aim-lock.js`,
`src/audio-mixer.js`, `src/vehicle-visual-model.js` y `src/rocketsim-combat.js`.
La simulación sigue siendo autoritativa en RocketSim; el renderer online solo
presenta snapshots.

La documentación canónica está en [`docs/README.md`](docs/README.md) y el
estado de trabajo en [`_bmad-output/current-roadmap.md`](_bmad-output/current-roadmap.md).
