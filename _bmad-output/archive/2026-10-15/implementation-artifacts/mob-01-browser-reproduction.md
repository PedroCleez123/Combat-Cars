# MOB-01 — Reproducción de movilidad ampliada en navegador

Estado: **Aceptada para la campaña autoritativa; observación visual pendiente por el entorno** · 13 de octubre de 2026

## Problema observable

La campaña MOB-01 necesitaba demostrar una única secuencia reproducible de
curva, pared, salto, dodge, vuelo con air roll/boost y retorno al suelo. Las
sondas WebSocket ya existían, pero faltaba repetirla contra la build actual y
comprobar si el navegador integrado podía alcanzar el servidor de prueba.

## Hipótesis

Si el bridge RocketSim mantiene su contrato de 120 Hz y el navegador puede
conectarse al servidor temporal, `?mob02=1` permitirá observar la misma
secuencia sin depender de pulsaciones humanas temporizadas. Si el entorno no
expone el puerto temporal al navegador, se conserva la evidencia autoritativa y
se registra la limitación sin modificar física ni cámara.

## Alcance

- Ejecutar `npm run probe:rocketsim-expanded-mobility` con la build R9 y el
  perfil `arsenal-expanded-curved-practice`.
- Intentar una instancia local de servidor y abrir `?mob02=1` en el navegador
  integrado.
- No tocar `src/simulation.js`, el bridge, las constantes de vuelo ni la
  cámara.

## Criterios de aceptación

1. La sonda confirma backend RocketSim, perfil ampliado, cuatro fases iniciadas
   con apoyo de pared y cadencia de dos ticks por snapshot.
2. Se observan salto, dodge dirigido, air roll con consumo de boost y retorno a
   apoyo real, sin errores de runtime.
3. El intento de navegador queda clasificado como verificado o bloqueado por
   aislamiento, con evidencia explícita.

## Resultado

La ejecución del 13/10/2026 en el puerto 5330 pasó todos los criterios:
829 snapshots, 25 entradas reconocidas y cadencia media de `0,0166788 s`, con
deltas únicamente `0,01/0,02 s`. Se observaron curva, pared, salto desde
pared, dodge dirigido, air roll con `8,34` unidades de boost consumidas y
recuperación a suelo con cuatro ruedas. La captura es
`docs/reference-captures/rocketsim-expanded-mobility-mob-01.json`.

Se intentó abrir `http://127.0.0.1:5331/?mob02=1` mientras el servidor estaba
activo, pero el navegador integrado devolvió `ERR_CONNECTION_TIMED_OUT` porque
no alcanza los puertos de la sesión de terminal. Por tanto, la evidencia de
píxeles sigue **No verificada**; no se alteró física, cámara ni transporte para
forzarla.

## Decisión

MOB-01 queda aceptada para autoridad y transporte. La siguiente corrección
debe ser de observabilidad del navegador/servidor (o una instancia persistente
accesible), no un ajuste de fuerzas. Si una captura futura muestra un defecto
de cámara, se abrirá una historia aislada en `camera-follow.js`.
