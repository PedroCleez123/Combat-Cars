# R7-03 — Contacto nativo y límite de geometría

## Problema observable

El backend RocketSim ya ejecuta el solver nativo del coche en una práctica,
pero la arena de esa práctica usa seis planos sintéticos. La transición contra
la pared debe quedar medida y separada de una futura integración de combate.

## Hipótesis

Si el sidecar publica la normal de `CarState.worldContact` y el recuento de
ruedas, se puede comprobar la respuesta nativa de Bullet sin añadir un rebote
en JavaScript. La curva real de Soccar requiere, además, sus mallas de
colisión: el código público no las embebe en `InitFromMem({}, true)`.

## Alcance

- `tools/rocketsim-bridge/probe-practice-contacts.mjs`: sonda acotada y captura.
- `docs/reference-captures/rocketsim-practice-contacts-r7-03.json`: evidencia.
- Tracker, roadmap y relevo: límites y siguiente decisión.

No cambia el solver JavaScript, el contrato de combate, la cámara ni los
activos visuales. No incorpora mallas propietarias ni cambia el backend por
defecto.

## Criterios de aceptación

1. La sonda arranca el bridge `arsenal-practice`, ejecuta 360 ticks a 120 Hz
   y termina limpiamente.
2. Existe un contacto de pared con normal horizontal y un tick posterior que
   conserva el contacto para observar la respuesta.
3. La captura solo guarda checkpoints y los dos eventos relevantes, no miles
   de frames redundantes.
4. La documentación distingue contacto nativo contra plano de equivalencia
   visual con la arena Soccar.

## Comprobaciones

- `npm run probe:rocketsim-contacts` — pasa; tick 220 y 221 medidos.
- `npm test` — obligatorio después de integrar este cambio.
- Navegador — no se afirma una prueba visual de la maniobra; la sonda es la
  evidencia autoritativa disponible.

## Resultado

Medido, no aceptación visual. La migración del solver de movimiento está
disponible mediante `npm run start:rocketsim`; la geometría curva de Soccar es
una dependencia independiente que queda para la siguiente historia.
