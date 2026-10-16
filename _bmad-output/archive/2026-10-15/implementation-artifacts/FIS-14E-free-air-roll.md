# FIS-14E — Semántica de free air roll

**Estado:** completada el 10 de octubre de 2026.

## Historia

Como piloto, quiero que Shift convierta A/D en alabeo libre y que Ctrl/Espacio
sean alabeo direccional independiente, para que las maniobras aéreas sean
predecibles y compatibles con el contrato observado en Car Soccer.

## Criterios de aceptación

- Con Shift y A/D, el objetivo de guiñada es cero y el de alabeo sigue la dirección.
- Con Ctrl/Espacio sin Shift, A/D conservan la guiñada y el alabeo se aplica simultáneamente.
- La suma de entradas de alabeo queda limitada a `[-1, 1]`.
- W/S, salto, nitro y disparo no cambian de significado.
- La traza determinista agrupada sigue coincidiendo con la de 120 Hz.

## Implementación

- `src/control-mapping.js` concentra la composición de teclado.
- `src/client.js` usa esa función y ya no infiere free roll a partir de un valor de roll distinto de cero.
- `src/simulation.js` diferencia el modificador `airRoll` de `roll` y adapta el objetivo de guiñada/alabeo sin copiar código ni constantes de terceros.
- `src/mobility-probes.js` mide yaw + roll con la ruta direccional.

## Evidencia

- REA estático: `docs/car-soccer-rea-physics-contract.md`.
- `npm test`: 76 pruebas pasan.
- `npm run probe`: `airManeuver.cadenceMatches` permanece en `true`.
- `node --check` pasó para los módulos modificados.

## Riesgo restante

La respuesta subjetiva de las tasas y amortiguación aún requiere una sesión
manual repetida. FIS-14E no ajusta `TUNING` ni afirma coincidencia completa con
Rocket League o Car Soccer.
