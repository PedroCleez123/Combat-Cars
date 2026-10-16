# GAME-02 — Combate RocketSim extremo a extremo en LAN

Estado: **aceptada para la integración LAN autoritativa; observación web pendiente en MOB-01V** · 13 de octubre de 2026

## Problema observable

El movimiento RocketSim multivehículo y el ciclo de combate 1v1 ya tienen
sondas separadas, pero aún falta comprobar que una sesión de combate con seis
pilotos humanos conserva roster, entradas, disparos y estado autoritativo sin
introducir una segunda autoridad.

## Hipótesis

Si el backend mantiene RocketSim como dueño de las poses y Node conserva solo
cohetes, daño, puntuación y respawn, seis clientes pueden compartir una sesión
de combate sin perder ACK, IDs, equipos ni estados finitos. La sonda de seis
pilotos validará la integración de sesión; la sonda 1v1 existente mantendrá la
puerta de impacto, eliminación y respawn.

## Alcance

- Nueva sonda WebSocket de seis pilotos en `ROCKETSIM_MODE=combat`.
- Registro de roster, equipos, ACK, movimiento independiente, flancos de
  disparo y publicación de cohetes.
- Reutilización de `probe:rocketsim-combat-websocket` para daño, cooldown,
  eliminación, desactivación y respawn 1v1.
- No se cambian fuerzas, cámara, geometría, protocolo ni reglas de combate.

## Criterios de aceptación

1. La sesión de seis pilotos publica seis IDs únicos, equipos alternos, poses
   finitas y ACK por piloto; una desconexión reconstruye el roster y deja al
   resto de la sesión operativa.
2. Cada piloto conserva su input de movimiento; los seis flancos de disparo
   son aceptados una sola vez y publican cohetes vivos.
3. La sesión mantiene `rules.combat=true`, `movementBackend=rocketsim`, sin
   errores de runtime ni coches fantasma.
4. La sonda 1v1 existente sigue verde para cooldown, daño, eliminación y
   respawn.
5. `npm test` permanece verde.

## Fuera de alcance

No se añaden bots, matchmaking, online público, obstáculos, predicción local ni
ajustes de física. La comprobación visual de navegador queda en MOB-01V y no se
mezcla con esta historia.

## Resultado

`npm run probe:rocketsim-combat-six` abrió seis clientes contra
`arsenal-expanded-curved-practice` en `ROCKETSIM_MODE=combat`. La captura
`docs/reference-captures/rocketsim-combat-six-pilot-game-02.json` confirma seis
IDs únicos y equipos azul/rojo alternos, poses finitas, movimiento independiente
de los seis, ACK por piloto, seis flancos de disparo, hasta seis cohetes vivos,
cadencia `0,01/0,02 s` y cero errores de runtime. Después de la desconexión
del sexto piloto, el bridge reconstruyó un roster de cinco coches y confirmó
una nueva entrada del piloto restante.

`npm run probe:rocketsim-combat-websocket` conservó la puerta complementaria
1v1: cooldown, dos impactos aceptados, eliminación, desactivación física por el
bridge y respawn nativo. La ejecución nueva también mantuvo ACK y cadencia sin
errores. `npm test` pasó **131/131**. No se modificó física, cámara, geometría,
protocolo ni reglas de combate.

La observación visual de esta secuencia sigue pendiente por la limitación ya
registrada en MOB-01V; no se afirma aún una prueba de píxeles multijugador.
