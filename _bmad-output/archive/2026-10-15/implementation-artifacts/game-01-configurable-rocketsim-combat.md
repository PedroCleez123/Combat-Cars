# GAME-01 — Sesión LAN de combate RocketSim configurable

**Estado:** aceptada para sesiones humanas  
**Hito:** P5 de _bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md  
**Fecha:** 13 de octubre de 2026

## Problema observable

El servidor ya puede ejecutar ROCKETSIM_MODE=combat y R9-01 demostró seis
pilotos, pero el panel web muestra la práctica como calibración y su mensaje
configure es rechazado por RocketSimPracticeMatch. Por ello no existe una
sesión LAN de combate configurable desde el navegador.

## Hipótesis única

Una capacidad de pilotos humana, almacenada por el match RocketSim y expuesta
en su snapshot, permite configurar una sesión LAN de combate sin modificar la
lista de coches nativos activa, las reglas de combate o la autoridad de
movimiento.

## Alcance

- Añadir capacidad humana 1–6 a RocketSimPracticeMatch.
- Aceptar configure solo para dicha capacidad, rechazando bots no nativos,
  valores inválidos y una capacidad inferior a los pilotos conectados.
- Adaptar el panel y HUD del navegador al perfil RocketSim: sesión, capacidad
  y marcador de combate visibles; bots y selector de entorno desactivados.
- Añadir una regresión unitaria y un runner WebSocket de configuración.

## Cambio de invariante

No cambia la autoridad ni el formato de state: el servidor continúa asignando
IDs, equipos, daño, puntuación y poses. vehicleLimit, ya publicado en settings,
deja de ser siempre seis en RocketSim y pasa a reflejar el límite autoritativo
configurado. El cliente sigue enviando una solicitud, nunca una lista de coches
ni una pose.

## Criterios de aceptación

1. Una solicitud válida de capacidad entre uno y seis se refleja en el snapshot
   sin reiniciar el bridge ni alterar coches ya activos.
2. Una capacidad inferior a los humanos activos, bots distintos de cero o un
   valor inválido se rechazan sin cambiar la capacidad anterior.
3. El panel muestra sesión RocketSim, permite cambiar capacidad y no promete
   bots o entorno intercambiable.
4. En combate RocketSim, el HUD muestra el marcador y el objetivo de combate.
5. Una sonda WebSocket confirma configuración, límite de altas y ACK/movimiento
   posterior. npm test queda verde.

## Comprobaciones

| Criterio | Base | Post esperado |
| --- | --- | --- |
| Contrato del match | tests/rocketsim-practice-match.test.mjs | Capacidad válida e inválida aisladas |
| Sesión LAN | runner GAME-01 | Configuración, límite y entrada confirmada |
| Regresión | npm test | Verde |
| Presentación | navegador local | Panel y HUD del modo combate sin error de consola |

## Fuera de alcance

Bots RocketSim, IA, reconexión, host/autorización del configurador, cambio de
arena durante una sesión, combate de seis con bot, matchmaking y online público.

Una ráfaga de altas mientras el sidecar reconstruye una lista anterior se
registra como robustez de transporte pendiente. Las campañas LAN aceptadas
esperan el snapshot de roster tras cada alta; GAME-01 no cambia la semántica de
admisión ni la concurrencia del bridge.

## Evidencia y cierre

`npm run probe:rocketsim-combat-session` generó
`docs/reference-captures/rocketsim-configurable-combat-game-01.json`. Aceptó
capacidad 3, formó el roster azul-rojo-azul, rechazó la cuarta plaza y rechazó
reducir el límite por debajo de los tres pilotos. Después confirmó ACK y
movimiento del piloto configurador, con snapshots de `0,01/0,02 s` y sin error
inesperado. La prueba unitaria cubre la validación de capacidad y la regresión
completa terminó en **127/127**. Se comprobó en navegador el HUD de combate,
el marcador y el panel con entorno/bots bloqueados; el navegador se desconectó
antes de repetir la mínima corrección textual final, ya cubierta por la lectura
de código y `node --check`.

