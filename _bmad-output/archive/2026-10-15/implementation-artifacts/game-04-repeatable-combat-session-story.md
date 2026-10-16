# GAME-04 — sesión LAN de combate repetible

**Estado:** Aceptada · 14 de octubre de 2026

## Problema

`combat-alpha` ya tiene roster, daño, puntos, respawn y reinicio, pero el
objetivo “primero a 15” era solo texto: no había vencedor autoritativo, estado
de espera ni congelación de la puntuación al terminar la ronda.

## Alcance

- Fijar el objetivo de 15 como constante del modo RocketSim combat.
- Publicar estado `waiting`, `active` o `complete` en el snapshot.
- Declarar vencedor al alcanzar el objetivo y congelar reglas de combate.
- Mantener R como reinicio de ronda y conservar la configuración humana 1–6.
- Reflejar espera y cierre de ronda en el HUD.

No incluye bots, matchmaking, despliegue online, cambios de física, cámara,
bridge nativo, geometría o recursos.

## Base / Post / Delta

- **Base:** ARENA-07 y VIS-06 están observadas en `localhost:5300`; `npm test`
  pasa 137/137.
- **Post:** el snapshot tiene objetivo/estado/vencedor coherentes y el HUD no
  anuncia una ronda activa con un único piloto.
- **Delta:** reglas RocketSim combat, adaptador de partida, HUD, pruebas y
  documentación de sesión.

## Aceptación

1. Menos de dos pilotos publica `waiting`; dos o más, `active`.
2. Al llegar a 15, el snapshot publica equipo vencedor y `complete`.
3. Después del vencedor no aparecen puntos, daños ni cohetes nuevos.
4. `restart` reinicia score, vencedor y estado, conservando la capacidad.
5. Las pruebas existentes y la campaña LAN siguen verdes.

## Resultado

`ROCKETSIM_COMBAT.scoreToWin` fija el objetivo de 15. `RocketSimPracticeMatch`
publica `settings.roundState` (`waiting`, `active` o `complete`) y
`settings.scoreToWin`; al ganar, publica `winner`, vacía cohetes pendientes y
deja de avanzar reglas de combate hasta `restart`. El cliente muestra
`ESPERANDO RIVAL` o `RONDA CERRADA` y conserva el aviso de victoria/derrota.

Las pruebas añadidas cubren objetivo, ganador, espera, activación con dos
pilotos, cierre y reinicio. `node --check` y `npm test` pasaron con **139/139**.
En el navegador del host, un piloto mostró espera; al abrir un segundo piloto
local, el HUD pasó a `2/6 PILOTOS` y el sidecar reconstruyó el roster sin error.
