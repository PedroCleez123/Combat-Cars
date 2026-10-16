# R7-05c — Acciones nacidas del apoyo de pared

**Estado:** ready-for-dev

## Historia

Como piloto de la práctica RocketSim, quiero que salto, segundo salto/dodge,
air roll, nitro y la recuperación se midan desde un apoyo real de pared curva,
para separar un fallo de acciones de un fallo de fuerzas o de presentación.

## Alcance

- Automatizar una sesión WebSocket contra `arsenal-curved-practice`.
- Llegar a la pared usando el solver nativo y registrar la muestra de apoyo que
  precede a cada acción.
- Pulsar salto, segundo salto con dirección, air roll y nitro con entradas
  sintéticas temporizadas por el propio script.
- Registrar si el coche abandona el apoyo, conserva movimiento angular, consume
  nitro y vuelve a encontrar apoyo después de la maniobra.

## Criterios de aceptación

1. Cada fase empieza con `wallRide=true`, `surfaceType=wall`, ruedas en contacto
   y una normal de apoyo no horizontal.
2. El salto, el segundo salto/dodge y el air roll se observan mediante los
   contadores y velocidades angulares autoritativos del snapshot; no se infiere
   el resultado desde la entrada enviada.
3. El nitro reduce el depósito durante el vuelo y la fase de recuperación
   vuelve a observar apoyo autoritativo dentro del tiempo de la sonda.
4. La prueba usa el bridge nativo y dos ticks por snapshot, sin modificar
   constantes de fuerzas, reglas de salto ni el backend de producción.
5. La captura se guarda en `docs/reference-captures` y el tracker deja claro
   qué queda probado y qué sigue siendo una comparación subjetiva.

## Fuera de alcance

Cambiar el solver, calibrar constantes, migrar el modo de combate, añadir bots,
importar geometría de Soccar o afirmar equivalencia exacta con Rocket League.

## Comprobaciones

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r5-z7/rocketsim_bridge.exe)
npm run probe:rocketsim-wall-actions
npm test
```
