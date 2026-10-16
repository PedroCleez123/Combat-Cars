# MOB-03 — Campaña WebSocket de dos pilotos sobre RocketSim

**Estado:** aceptada el 13 de octubre de 2026.

## Problema observable

R8-02 demostró dos clientes, ACK, disparo, cooldown, daño, eliminación,
desactivación nativa y respawn en el perfil interno `combat-lineup`. Ese perfil
coloca los coches para que el disparo sea determinista, pero no demuestra
movimiento simultáneo ni contacto de vehículos en una arena jugable.

## Hipótesis

Una campaña WebSocket separada puede medir primero movimiento e independencia
de entradas en `arsenal-expanded-curved-practice`, y después conservar la fase de
combate alineado de `combat-lineup`. Separar las fases evita atribuir a la
física una diferencia causada por spawns o por los límites de la arena de
combate.

## Alcance

- Nueva sonda de dos pilotos y su captura JSON.
- Dos fases: movilidad multicar en la arena ampliada y combate alineado.
- ACK, IDs, equipos, poses finitas, continuidad de snapshots y errores.
- Cohetes, cooldown, daño, eliminación, desactivación nativa y respawn en la
  fase determinista.

## Fuera de alcance

- Cambios en `src/simulation.js`, RocketSim, bridge o protocolo.
- Ajuste de constantes, cámara, bots o arena pública 3v3.
- Afirmar colisión entre coches si la traza no la observa de forma reproducible.

## Criterios de aceptación

1. Dos WebSockets reciben equipos distintos, IDs estables y ACK independientes.
2. La fase ampliada registra desplazamiento o velocidad de cada piloto con
   inputs separados, sin escribir poses desde Node.
3. La captura conserva cadencia nativa, poses finitas y errores vacíos.
4. La fase `combat-lineup` conserva las garantías de R8-02: dos impactos,
   cooldown, eliminación, desactivación y respawn.
5. `npm test` permanece verde y la sonda cierra sus procesos.

## Decisión

- Todo verde: aceptar MOB-03 y abrir R9-01 para seis coches LAN.
- Movimiento verde y combate rojo: corregir solo `rocketsim-combat` o sus
  límites, sin tocar el solver nativo.
- Contacto no observable: conservarlo como pendiente de una historia de
  geometría/spawn; no inventar una colisión.

## Evidencia de cierre

`npm run probe:rocketsim-two-pilot` generó
`docs/reference-captures/rocketsim-two-pilot-mob-03.json`. La fase de movilidad
en `arsenal-expanded-curved-practice` mantuvo dos pilotos, equipos, IDs, ACKs,
poses finitas, desplazamiento independiente y cadencia `0,01/0,02 s`.

La fase `combat-lineup` observó contacto nativo (`minSeparation=9,44` frente a
`14,6` iniciales), reinicio nativo, dos impactos aceptados, rechazo del disparo
en cooldown, eliminación, desactivación por debajo de `h=-100` y respawn. La
campaña terminó sin errores y con todas sus aserciones verdes. El contacto se
mide en el perfil de alineación limpia; no se presenta como geometría final de
la arena ampliada.
