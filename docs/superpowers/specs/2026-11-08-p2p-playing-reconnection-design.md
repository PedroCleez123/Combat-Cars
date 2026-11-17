# PR3a — reconexión P2P durante partida

## Intención

Mejorar la continuidad de una partida privada de Combat Cars sin abandonar la
arquitectura gratuita `Pages → Worker de señalización → WebRTC P2P → RocketSim
WASM en el host`. Cuando un invitado pierde temporalmente WebRTC, debe volver a
su mismo coche si el host original continúa vivo. La ronda, score, equipos y
autoridad del host no se reconstruyen en el Worker.

## Objetivos

- Reutilizar el `participantId` y `reconnectToken` existentes durante
  `playing`, conservando el slot y el `carId` originales.
- Neutralizar autoritativamente el comando del coche desconectado y aceptar una
  nueva secuencia de entrada sólo después de que la conexión de reemplazo abra
  su canal.
- Mantener los restantes jugadores y el reloj de RocketSim WASM activos durante
  la ausencia de un invitado.
- Evitar que callbacks o frames de un transporte antiguo creen un segundo coche,
  alteren score/equipos o reactiven controles antiguos.
- Informar de que se está recuperando la conexión, sin enviar al usuario a la
  práctica offline mientras el host original continúe disponible.

## No objetivos

- No introducir un servidor de juego, relay de snapshots, TURN de pago, cuentas
  ni una dependencia nueva.
- No prometer continuidad si desaparece el host: la simulación vive en su
  navegador. La promoción existente vuelve de forma segura a `room-open` y
  exige iniciar otra ronda.
- No implementar predicción local de física ni cambiar hitboxes, RocketSim,
  cámara, render, score o las reglas de combate.

## Decisiones

### Opción elegida: recuperación de invitado sobre la autoridad P2P existente

El Durable Object conserva ya tickets por participante durante
`P2P_MULTI_PARTICIPANT_GRACE_MS` (10 minutos), pero sólo coordina señalización
y una plaza. El navegador host conserva el `P2PWasmMultiplayerCombatHost` y
reemplaza exclusivamente la sesión WebRTC de ese slot. El nuevo piloto empieza
con un contador de comandos nuevo, tras neutralizar el comando anterior.

Esta opción añade continuidad real sin coste por partida. Un servidor
autoritativo o un relay Worker de juego serían más resistentes al host malicioso
o a la caída del host, pero contradicen el producto y añaden coste/estado de
partida externo.

### Flujo

```text
guest DataChannel cae
  ├─ host: neutraliza slot → conserva WASM/round → prepara nueva sesión
  └─ guest: espera brevemente promoción de host
             ├─ host promovido → room-open seguro (ruta existente)
             └─ host sigue vivo → redime mismo ticket → WebRTC nuevo
                                  → host reinicia secuencia del slot
                                  → snapshots existentes recuperan el coche
```

El ticket autentica la recuperación de plaza. La frontera WebRTC nueva y un
reset explícito del contador de secuencia del slot aíslan mensajes previos. El
host no crea otro jugador ni recrea RocketSim.

## Invariantes

- Sólo `P2PWasmMultiplayerCombatHost` avanza RocketSim y decide física, daño,
  kills, score, respawn y reloj.
- Un slot conserva exactamente un `playerId`/`carId`; una reconexión no llama a
  `addHuman`, no reconstruye el roster y no cambia los equipos.
- Mientras no exista un canal nuevo, el host aplica un comando neutral a ese
  jugador. El primer comando de la nueva conexión puede usar secuencia `1`.
- Los snapshots siguen su secuencia autoritativa creciente; el piloto nuevo
  acepta el primer snapshot válido de su nueva frontera WebRTC.
- Un host que abandona durante `playing` no migra físicamente la ronda: el
  sistema restablece la sala de espera tal como ya hace la promoción vigente.

## Criterios de aceptación

1. Tras perder el canal de un invitado durante una ronda, el host continúa
   avanzando ticks y no envía a los demás jugadores a práctica offline.
2. El invitado reingresa con el mismo ticket dentro de la gracia, el mismo slot
   y el mismo `carId`, sin un segundo coche ni score duplicado.
3. Antes del primer comando nuevo, el coche desconectado recibe sólo controles
   neutrales; una secuencia antigua se rechaza y la secuencia `1` de la nueva
   conexión se acepta.
4. Una promoción de host durante `playing` conserva la política segura: ronda
   descartada, sala persistente abierta y ningún intento de reanudar física.
5. Las pruebas cubren reset de slot, reingreso del piloto, callbacks repetidos y
   la regresión completa de los contratos P2P afectados.

## Riesgos y rollback

El riesgo principal es aceptar comandos antiguos tras un reemplazo de
transporte. El cambio se acota a un reset explícito de la secuencia del slot
después de neutralizarlo; no toca la versión del snapshot ni el ABI de
RocketSim. Si las pruebas muestran una duplicación o un avance no autoritativo,
se revierte el uso durante `playing` y vuelve la ruta segura actual a práctica
offline.

## Estado de implementación — 08/11/2026

La ruta local está implementada: el host reincia de forma acotada la entrada
del slot, la sesión WebRTC del invitado se sustituye de forma idempotente y el
invitado reusa su ticket conservando el contexto de combate. Las pruebas
unitarias/focales cubren secuencias, roster, sustitución repetida y preservación
de `playing`. La validación manual de un corte de red real y la batería completa
de build siguen siendo condición de cierre antes de publicar.
