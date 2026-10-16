# MOB-02 — Validación de cámara y presentación con maniobra RocketSim

**Estado:** en validación. Depende de MOB-01 aceptada.

## Ficha de cambio

**Problema observable:** la cámara puede resultar brusca o confusa al volar,
pasar por pared o recuperar contacto; una traza nativa no demuestra cómo se
presenta esa maniobra en el navegador.

**Hipótesis:** si el cliente recibe las poses autoritativas de la práctica
ampliada, conserva horizonte mundial y aplica los límites de cámara de práctica,
el problema se puede clasificar como presentación. Solo se ajustará
`camera-follow.js` o `client.js` si una captura reproducible muestra una
discontinuidad de cámara con trayectoria nativa continua.

**Alcance:** levantar `arsenal-expanded-curved-practice` con RocketSim, abrirla
en navegador, comprobar HUD, consola y continuidad visual durante una secuencia
de entrada reproducible. Una posible corrección queda limitada al subsistema de
cámara. No se cambia solver, bridge, física, red, combate ni arena.

**Comprobaciones:**

| Criterio | Base | Post esperado |
| --- | --- | --- |
| Autoridad | MOB-01: RocketSim, ACK y 120/60 Hz | La pestaña muestra práctica RocketSim ampliada. |
| Presentación | VIS-01: tema claro carga sin errores | Coche, curvas, HUD y cámara visibles. |
| Continuidad | Pruebas puras de `camera-follow` verdes | No hay salto de horizonte, clip o error de consola durante recorrido observable. |
| Regresión | `npm test` 121/121 | Se mantiene verde si se edita código. |

**Fuera de alcance:** comparación subjetiva total con Rocket League, cambios de
TUNING, suspensión, contacto, predicción, multijugador y decoración.

## Decisión de cierre

- La trayectoria nativa y la cámara son legibles: aceptar MOB-02 y abrir MOB-03.
- La trayectoria es continua y solo falla la cámara: abrir una corrección
  aislada en el seguimiento.
- No puede observarse la entrada por automatización: registrar la limitación y
  conservar MOB-02 como no verificada, sin tocar física.

## Reproducción opt-in

Para hacer reproducible la entrada se añadió `src/mob02-browser-playback.js`.
Se activa con `?mob02=1` y usa el mismo mensaje `input` del cliente: llega a la
pared con nitro, libera para estabilizar, pulsa el salto, ejecuta dodge/air roll
con nitro y espera el apoyo en suelo. El servidor sigue siendo autoritativo; el
reproductor no escribe poses ni altera la simulación.

`npm run test:mob02` cubre las fases, el pulso de salto, la entrada aérea y los
predicados de apoyo de pared. La suite completa incorpora este test. La
comprobación visual queda pendiente de ejecutar con
`http://127.0.0.1:<puerto>/?mob02=1` contra el servidor RocketSim ampliado.

## Cierre MOB-02 — validación visual reproducible (13/10/2026)

**Estado: aceptada.** Se añadió `src/mob02-browser-playback.js`, un
reproductor opt-in activado por `?mob02=1`. Solo genera el mismo mensaje de
entrada que usa el cliente normal; el servidor RocketSim sigue siendo la fuente
autoritativa de la pose, contactos y acciones.

Contra `arsenal-expanded-curved-practice`, la reproducción completó
`drive → settle → jump → aerial → recover → done`. El navegador confirmó el HUD
aéreo (`SALTOS 1/2`, `ESTADO airborne`), la actitud publicada y ACK, y no tuvo
errores de consola. La captura de la fase aérea conserva el horizonte mundial
mientras el coche rota; no apareció clip fuera del techo ni pérdida del coche.

También se corrigió la etiqueta de la práctica ampliada: el HUD ahora anuncia
`TRANSICIONES CURVAS`. No hubo cambios en el solver, bridge, protocolo ni
constantes de movimiento. `npm test` terminó con **125/125** pruebas verdes.

La siguiente historia queda en MOB-03: campaña de combate de dos pilotos sobre
poses RocketSim, clasificando cualquier defecto como entrada, snapshot, cámara,
geometría o reglas de combate antes de modificar física.
