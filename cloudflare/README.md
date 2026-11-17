# Combat Cars · señalización WebRTC P2P

Este Worker es únicamente el rendezvous efímero de partidas privadas de
Combat Cars. El host ejecuta RocketSim WASM dentro de su navegador y los
clientes intercambian gameplay por WebRTC directo. No hay servidor de juego,
física remota, matchmaking público, JWT ni ruta Caddy.

La configuración publicada es:

- Pages: `https://combat-cars.pages.dev`
- Worker: `https://combat-cars-signal.combat-cars-pedro.workers.dev`
- `ALLOWED_ORIGINS`: sólo el origen Pages exacto.

## Rutas públicas

La ruta 1v1 ya validada usa `/v1` y permanece aislada de la ampliación:

- `POST /v1/rooms`: crea 1v1; devuelve credenciales host/invitado.
- `POST /v1/rooms/join`: resuelve una clave corta 1v1.
- `GET /v1/rooms/:roomId/signal`: WebSocket de señalización 1v1.

La ruta multijugador host-star usa `/v2`:

- `POST /v2/rooms` sin cuerpo de modo: crea una sala persistente `room-open`,
  reserva seis plazas y devuelve al host una clave Crockford de diez
  caracteres más su credencial de propietario.
- `POST /v2/rooms/join` con `{ roomCode }`: asigna atómicamente la primera
  plaza libre o recupera la plaza del ticket persistente y devuelve la
  credencial temporal del jugador que se une.
- `POST /v2/rooms/configure` con `{ roomCode, hostSecret, mode, maxPlayers }`:
  permite únicamente al propietario fijar el modo/capacidad y pasar a
  `team-selection`.
- `GET /v2/rooms/:roomId/signal`: WebSocket con enrutado por plaza entre cada
  invitado y el host.

Las claves cortas son identificadores públicos de búsqueda, no credenciales.
Los secretos tienen 256 bits, se devuelven únicamente al navegador que los
necesita y se guardan en los Durable Objects sólo como SHA-256. No aparecen en
una URL, en el HUD, en logs ni se retransmiten a pares.

## Límites y comportamiento

- Vida de sala persistente: siete días; los tickets de participante conservan
  la plaza durante una gracia de diez minutos (limitada por la caducidad).
- Máximo: un host y cinco invitados (seis pilotos totales).
- Modos exactos: `1v1` (2), `2v2` (4), `3v3` (6), `ffa` (2–6).
- La reserva de una plaza dura 45 segundos para permitir la negociación
  WebRTC; salas llenas, caducadas o con modo incompatible fallan cerradas.
- Las tramas de señalización se validan y limitan; SDP/candidatos siguen sin
  persistirse.
- Si el host abandona, el primer invitado por `joinOrder` se convierte en el
  nuevo host y conserva la misma clave. La autoridad RocketSim no se finge
  reanudada: el sucesor reconstruye el lobby y debe iniciar una ronda nueva.

Las restricciones NAT/firewall/STUN pueden impedir una conexión directa. Eso
es una limitación inherente a la arquitectura P2P gratuita, no un servidor de
partida oculto ni una razón para configurar la ruta hosted.

## Despliegue

Desde la raíz del repositorio, con una sesión autenticada en Cloudflare:

```powershell
npx wrangler whoami
npx wrangler deploy --config cloudflare/wrangler.toml
npm run build:pages-beta
npx wrangler pages deploy dist-pages-beta --project-name combat-cars --branch main --commit-dirty=true
npm run verify:pages-beta
```

Si `whoami` falla, ejecutar primero `npx wrangler login`. Publicar Worker y
Pages en el mismo ciclo cuando cambie un contrato `/v2`; la opción
`--commit-dirty=true` es necesaria porque este árbol de trabajo contiene los
ficheros implementados aún no confirmados en Git. Después ejecutar la prueba
humana desde varios navegadores/redes. No usar `check:online-readiness`: evalúa
la arquitectura hosted distinta que este juego no utiliza.
