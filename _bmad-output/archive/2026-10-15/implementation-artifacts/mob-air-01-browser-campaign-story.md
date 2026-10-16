# MOB-AIR-01 — campaña reproducible de movilidad aérea

**Estado:** implementada; observación en navegador pendiente · 14 de octubre de 2026

## Resultado

La aplicación dispone de una campaña opt-in (`?mobair01=1`) que recorre una
secuencia autoritativa: apoyo en suelo, primer salto, liberación de la tecla,
segundo salto con `throttle=1` y `steer=1`, control aéreo con air roll y boost,
y recuperación. El reproductor solo genera entradas normales; RocketSim sigue
siendo dueño de pose, saltos, dodge, velocidad, orientación y contactos.

## Problema y alcance

La sensación del segundo salto dirigido no debe inferirse de una pulsación
manual de duración incierta. Esta historia crea una observación repetible para
separar un fallo de input/transporte de un defecto del solver. No calibra
constantes, no corrige la cámara y no añade una física alternativa.

## Archivos

- `src/mob-air-01-browser-playback.js`: máquina de estados e informe.
- `src/client.js`: activación opt-in, envío de restart/inputs y log del informe.
- `tests/mob-air-01-browser-playback.test.mjs`: contrato puro de la campaña.
- `package.json`: inclusión en `npm test`.

## Aceptación

- La suite local mantiene todos los contratos existentes y cubre primer salto,
  liberación, segundo salto dirigido, air roll/boost y reporte de recuperación.
- En un navegador conectado a RocketSim, la consola debe mostrar las fases
  `settle`, `first-jump`, `release`, `directed-second-jump`, `air-control` y
  `done`; el informe debe registrar `firstJumpObserved`,
  `directedSecondJumpObserved` y `dodgeObserved` a partir de `actionSerials`.
  El HUD muestra el mismo estado bajo `MOB-AIR` para que la comprobación no
  dependa de estimar tiempos de pulsación ni de abrir herramientas del navegador.
- Si una fase no aparece o un serial no aumenta, se abre una única historia de
  adaptador/protocolo o de calibración nativa según la evidencia. No se cambia
  el solver por una captura incompleta.

## Evidencia

- `npm test`: **143 pasadas, 0 fallos**.
- `node --check src/client.js` y `node --check src/mob-air-01-browser-playback.js`:
  correctos.
- La observación web queda **no verificada** hasta que la instancia RocketSim
  del PowerShell del usuario esté accesible al navegador integrado.

## Uso

Abrir `http://127.0.0.1:<puerto>/?mobair01=1`, hacer Ctrl+F5 y revisar la
consola. El HUD sigue mostrando el estado autoritativo; la campaña se detiene
al aterrizar con apoyo de ruedas o tras el límite de recuperación y registra
`no-wheel-support` sin autoenderezar el coche.

## Siguiente unidad

Ejecutar la campaña en el host persistente. Solo si la evidencia reproduce un
problema, abrir una corrección aislada de input, solver o cámara.

## Diagnóstico de cliente servido — MOB-AIR-01

La URL `localhost:5300/?arena=combat-alpha&mobair01=1` mantuvo HUD y ACK, pero
no cargó el marcador `MOB-AIR` tras una recarga sin caché. La instancia de
servidor/cliente del host no está sirviendo el `src/client.js` actual, aunque
el workspace sí lo contiene. Este caso es distinto de un fallo de RocketSim:
reiniciar `npm run start:watch` desde la raíz actual antes de reintentar. La
campaña y sus pruebas permanecen implementadas; la observación sigue no
verificada.

## Revisión de la campaña — 14/10/2026

Se corrigió el avance temporal de la campaña para esperar `firstJumpObserved`
y el segundo salto dirigido para aceptar tanto `doubleJump` como `dodge`. La
prueba nativa R13 confirma ambos eventos (ticks 6 y 36). La regresión completa
es **144/144**. La observación visual queda pendiente porque la instancia del
host terminó en `RocketSim practice is closed` durante el reinicio del watcher;
reiniciar una única vez con el bridge R13 y `ROCKETSIM_REQUEST_TIMEOUT_MS=500`
antes de reabrir `?mobair01=1`.

## MOB-AIR-02 — variantes de dodge

La campaña `?mobair01=1` acepta `&dodge=front`, `&dodge=side` o
`&dodge=diagonal`. El HUD muestra la variante y el informe conserva los
seriales autoritativos. La cobertura pura de las tres opciones está incluida en
la regresión; la comparación visual de cada variante queda para la siguiente
sesión de observación.

## MOB-AIR-02 — guardas de transporte

Se detectó y corrigió una carrera del reproductor: el reinicio se repetía en
cada frame, especialmente al comparar variantes en varias pestañas. Cada
campaña ahora envía un único `restart`, espera el serial de respawn y solo
entonces inicia la secuencia. Esto evita cierres del sidecar durante pruebas
visuales. `npm test` pasa **146/146**.

## Observación con roster compartido — 14/10/2026

La variante front se reprodujo en localhost:5300 y mostró MOB-AIR done · front
· J sí · 2 sí · D sí, con HUD, ACK y recuperación a suelo. Al abrir una segunda
pestaña para side, la sesión compartida reconstruyó el roster antes de confirmar
el respawn de ese piloto; el HUD mostró restart-unconfirmed y no se cuenta como
evidencia de side. El cliente se corrigió para no actuar sobre coches de otra
pestaña. La comparación de las tres direcciones queda pendiente de una
ejecución aislada por piloto.

El HUD MOB-AIR muestra ahora también R restart-unconfirmed o el resultado de
recuperación (wheel-support/no-wheel-support), para distinguir una campaña sin
respawn confirmado de un defecto de salto.

## Guard de snapshots congelados — 14/10/2026

La campaña ahora recibe el tiempo autoritativo del snapshot. Si el servidor deja
de publicar estados, mantiene la entrada de la fase actual y termina con
R snapshot-stalled tras el límite, sin inventar saltos, dodge ni recuperación.
La variante diagonal observada con ACK congelado quedó en first-jump y no se
acepta como resultado físico. Regresión posterior: 149/149.

## Guard de evidencia MOB-AIR — 14/10/2026

La campaña ya no etiqueta como `wheel-support` una ejecución que aterriza sin
haber observado los seriales de primer salto, segundo salto/dodge y dodge.
Ahora publica `R actions-missing`; esto separa una sesión WebSocket incompleta
de una recuperación física válida y evita usarla para calibrar el solver.

## Guard de sesión compartida — 14 de octubre de 2026

La campaña opt-in se pausa cuando `settings.humans` no es exactamente uno y
cancela sus inputs si un segundo piloto aparece durante la ejecución. El
resultado `session-not-isolated` es diagnóstico de la campaña, no un estado de
la partida. Esta protección evita usar un roster compartido para calibrar
saltos o dodge.
