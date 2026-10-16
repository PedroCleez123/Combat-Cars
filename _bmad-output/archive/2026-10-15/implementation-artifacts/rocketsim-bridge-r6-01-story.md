# R6-01 — Trazas de suelo fiables del puente RocketSim

## Historia

Como desarrollador de Car Soccer: Arsenal, quiero convertir las respuestas del
sidecar RocketSim en trazas de movilidad verificables a 120 Hz, para comparar
las acciones de suelo, salto y dodge sin conectar todavía RocketSim a la
partida autoritativa.

## Problema observable y causa

R5 podía ejecutar un salto aislado, pero no podía alimentar
`compareCurveTraces`: su salida no incluía muestras de escenario y sus tasas
locales tenían nombres incompatibles. La revisión independiente detectó además
que pared y techo se entregaban a Bullet en Unreal Units, que el free air roll
conservaba yaw y que el sidecar ignoraba la configuración y el número de tick.

## Alcance

- `tools/rocketsim-bridge/main.cpp`: contrato estricto, conversión de unidades
  y controles, y telemetría necesaria para una traza.
- `src/rocketsim-protocol.js`: validación estricta de la frontera Node.
- Adaptador y capturador de los seis escenarios con inicio en suelo.
- Pruebas de esquema y documentación de la evidencia.

## Fuera de alcance

- Backend de producción, WebSocket, combate, bots, contactos de juego y ajustes
  del solver JavaScript.
- Perfiles de inicio aéreo; pertenecen a R6-02.
- Cambios en constantes de vuelo, salto o dodge de Arsenal.

## Comprobaciones

| Criterio | Base | Post esperado |
| --- | --- | --- |
| Regresión Node | `npm test` 98/98 | Verde, sin regresión |
| Smoke nativo | Hash R5 repetible | Compila y se ejecuta con el nuevo contrato |
| Captura R6 | No existe | Dos capturas de seis trazas, 144 pasos cada una y resumen repetible |
| Comparador | No aplicable | Acepta las trazas sin transformación externa |

## Cambio de invariante

No hay cambio de invariante de producción. El contrato de desarrollo del
sidecar se hace más estricto para evitar que una traza inválida se use como
evidencia física. El rollback consiste en mantener `MOVEMENT_BACKEND=js`, que
es el único backend de producción en R6-01.
