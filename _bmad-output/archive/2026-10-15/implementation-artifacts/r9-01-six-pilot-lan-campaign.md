# R9-01 — Campaña LAN de seis pilotos RocketSim

**Estado:** aceptada  
**Hito:** P4 de _bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md  
**Fecha:** 13 de octubre de 2026

## Problema observable

R9 acepta hasta seis coches en el bridge nativo y MOB-03 cubre dos clientes, pero
todavía faltaba una evidencia de que seis conexiones WebSocket reales mantienen
identidad, equipo, entrada y limpieza de roster bajo la autoridad RocketSim.

## Hipótesis única

El adaptador RocketSimPracticeMatch puede reconstruir su roster nativo tras
cada alta o baja y conservar la relación piloto → ID → coche en seis plazas,
sin introducir un segundo solver ni un coche residual.

## Alcance

- Añadir una campaña externa con seis WebSockets contra
  arsenal-expanded-curved-practice.
- Registrar bienvenidas, equipos, ACK, snapshots, entradas distintas, salida
  del sexto piloto y la entrada posterior de un piloto restante.
- Guardar una captura reproducible bajo docs/reference-captures.

## Fuera de alcance

Bots, matchmaking, reconexión, combate, cámaras, arte, ajustes de fuerzas y
online público.

## Criterios de aceptación

1. Seis IDs únicos y equipos alternados azul/rojo se publican en un roster
   estable.
2. Cada entrada recibe ACK y conserva su steer en el coche del mismo ID.
3. Las seis poses son finitas, todos los coches se desplazan y los snapshots
   mantienen cadencia de 60 Hz sobre dos pasos nativos.
4. Al cerrar un socket, el roster queda en cinco coches y el ID salido no
   vuelve a aparecer; una entrada restante sigue recibiendo ACK.
5. No hay errores de runtime; npm test permanece verde.

## Hoja de cambio

| Archivo | Cambio | Motivo |
| --- | --- | --- |
| tools/rocketsim-six-pilot-lan-probe.mjs | Nueva campaña WebSocket de seis pilotos | Evidencia LAN de R9-01 |
| package.json | Script del runner | Ejecución reproducible |
| docs/reference-captures/rocketsim-six-pilot-lan-r9-01.json | Captura generada | Evidencia de la ejecución |

## Comando

    $env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path '.rocketsim-bridge-build-r9\rocketsim_bridge.exe').Path
    npm run probe:rocketsim-six-pilot

## Evidencia y cierre

La campaña se ejecutó el 13/10/2026 y generó
`docs/reference-captures/rocketsim-six-pilot-lan-r9-01.json`. Sus once
aserciones pasaron: seis IDs estables, reparto azul/rojo, poses finitas,
ACK por piloto, `steer` asociado al coche correcto, movimiento de los seis,
cadencia `0,01/0,02 s`, reconstrucción a cinco coches tras una desconexión y
entrada posterior confirmada. No se registraron errores. `npm test` también
pasó **125/125**.

