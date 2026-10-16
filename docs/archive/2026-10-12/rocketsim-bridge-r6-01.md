# R6-01 — Trazas RocketSim desde suelo

Fecha: 12 de octubre de 2026  
Estado: **aceptada como infraestructura de medición**.

## Propósito

Convertir el sidecar RocketSim de R5 en una fuente de trazas que use el mismo
esquema de 120 Hz que las pruebas de movilidad de Arsenal. Esta entrega no
cambia `src/simulation.js`, `server.mjs` ni el backend de producción.

## Correcciones de frontera

- La posición de cada plano se convierte de Unreal Units a Bullet mediante
  `UU_TO_BT`. R5 entregaba paredes y techo directamente en unidades Unreal;
  el suelo seguía funcionando por estar en cero, pero los otros cinco planos
  quedaban 50 veces más lejos de lo declarado.
- El `airRoll` libre ahora anula `yaw`; `roll` ya llega compuesto por el
  adaptador de entradas. Un probe nativo comparó 48 muestras de free air roll
  con un roll direccional equivalente: los dos SHA-256 fueron
  `a98efd755bc87ff0be0e5a7f955b97721b8a555e7be9c4c6e9ce21843e3636d0`.
- `init` admite solo esquema 1, 120 Hz, una arena limpia y un coche id 1. Los
  ticks deben avanzar de uno en uno. Se comprobaron una configuración a 60 Hz
  y un tick duplicado: ambos se rechazaron y el tick 2 posterior se procesó.
- La frontera valida campos finitos y no sustituye datos ausentes por cero. Las
  tasas locales se nombran explícitamente `pitch`, `yaw` y `roll`.

## Captura reproducible

Comando, tras compilar el bridge:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r5-z7/rocketsim_bridge.exe)
npm run capture:rocketsim-ground
```

La captura resultante es
`docs/reference-captures/rocketsim-bridge-r6-01-ground.json`. Contiene 144
muestras para `ground-control`, `first-jump`, `double-jump`, `dodge-forward`,
`dodge-side` y `dodge-diagonal-roll`. Dos ejecuciones independientes dieron el
mismo hash completo:

```text
0f545e59138085ec09d3a58671e1d45b1a29b887c19eb5a809864d11daf4a4e6
```

## Comparación con la captura RocketSim R3

Las dos trazas se generan con el mismo commit fijado y el mismo manifiesto. La
comparación verifica el adaptador, la conversión y la alineación temporal; no
es una comparación de Arsenal con RocketSim.

| Escenario | Activación ref./bridge | Error de forma altura / velocidad vertical | Máximo de actitud |
| --- | --- | ---: | ---: |
| first-jump | 1 / 1 | 0 / 0 | 0,056° |
| double-jump | 12 / 12 | 0 / 0 | 0,056° |
| dodge-forward | 12 / 12 | 0 / 0 | 0,0694° |
| dodge-side | 12 / 12 | 0 / 0 | 0,0656° |
| dodge-diagonal-roll | 12 / 12 | 0 / 0 | 0,0682° |

La pequeña diferencia de actitud procede de la fase de asentamiento del coche
y del redondeo de la salida JSON; no altera la activación ni la trayectoria.

## Validación

- Build nativa MSVC/CMake/Ninja: correcta.
- `npm test`: **100 pasan, 0 fallan**.
- La simulación autoritativa de producción sigue siendo JavaScript.

## Siguiente historia

R6-02 añadirá perfiles nativos reproducibles para `airborne` y
`second-action-airborne`. Solo entonces se capturarán los ejes de aire, el
free air roll y los dodges iniciados ya en vuelo. Paredes, esquina y techo
requieren una historia de contactos separada: R6-01 corrige su escala, pero
sus colisiones no forman parte de estas trazas de salto.

Al abrir R6-02 se corrigió el manifiesto de `free-air-roll`: los controles
reales ya componen Shift + dirección como `roll=±1`, pero el escenario de
prueba había retenido por error `roll=0`. Era un hueco del arnés, no un cambio
en la física ni en los controles del navegador.
