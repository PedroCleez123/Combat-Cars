## Plan operativo vigente — 14 de octubre de 2026

El orden canónico de desarrollo y sus puertas de calidad se mantienen en
[`../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md`](../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md).
La historia activa es
[`MOB-AIR-02-OBS-ISOLATED`](../_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md):
front está aceptada; side y diagonal requieren una observación limpia con un
solo piloto. `COMBAT-PLAY-01` 1v1/6v6 y el arranque normal del bridge R13 están
aceptados. `LIVENESS-01` tiene implementación y pruebas unitarias aceptadas,
pero aún requiere una observación de integración que no interfiera con una
partida en curso.

No se ajustan física, controles ni cámara hasta que una traza aislada muestre
una discrepancia reproducible. `mobility-fidelity-roadmap.md` conserva los
criterios y decisiones previas, pero no decide la siguiente historia.
R0 fijó el manifiesto común de ocho maniobras y R1 aprobó una traza externa
determinista de RocketSim en una arena sintética, sin ejecutar Rocket League ni
usar assets de su arena. M1-01 rechazó una respuesta global de guiñada porque
empeoró la conservación de velocidad; la línea base quedó restaurada. La
siguiente historia M1-02 separó giro con agarre y powerslide. M1-03 mejoró el
powerslide de forma parcial, pero se restauró al no alcanzar la puerta de
guiñada. M1-04 probó el brazo longitudinal del eje delantero y se revirtió al
romper radios y retención de conducción. La siguiente historia definirá un
perfil de vehículo consistente antes de adoptar cambios geométricos. El
resultado y las cifras están en
[archive/2026-10-12/m1-ground-yaw-calibration.md](archive/2026-10-12/m1-ground-yaw-calibration.md).

Por prioridad explícita de jugabilidad, la conducción de suelo queda congelada
en su línea base. M2-01 ya separó pitch, yaw y roll y añadió error angular de
orientación. M2-02 probó y descartó una retención común al soltar: degradó la
comprobación de nitro con el morro arriba por momento residual. La historia
M2 quedó completada mediante calibración independiente: pitch (`12,46` de par,
`2,8` de damping), yaw (`9,11`, `1,9`) y roll (`38,35`, `4,8`). Las trazas
aisladas y combinadas quedan en `docs/reference-captures/arsenal-m2-05-roll.json`;
M3 ya quedó cerrada para salto y dodge. La captura convierte la
velocidad angular mundial de Bullet a ejes locales antes de cualquier ajuste;
comparar componentes mundiales durante una rotación habría
dado una medida falsa.

M4-01, M4-02, M4-02b y la corrección M4-03 ya están cerrados y definidos en
[`archive/2026-10-12/m4-contact-landing-plan.md`](archive/2026-10-12/m4-contact-landing-plan.md): la transición propia
y la referencia R4 de suelo sintético tienen capturas deterministas comparadas
M4-03 retiró el auto-enderezado provisional y dejó que contacto y suspensión
gobiernen la actitud durante el apoyo. Las cifras antiguas de FIS-14H/I quedan
como historial y no se usan como objetivo después de la calibración M3. Ese
orden pertenece al plan histórico; la siguiente historia vigente es MOB-01,
la campaña reproducible sobre la arena RocketSim ampliada.

### M2 — resultado reproducible (11 de octubre de 2026)

- Captura de referencia: `docs/reference-captures/rocketsim-r2-air-controls-c2baacb8.json`.
- Captura final de Arsenal: `docs/reference-captures/arsenal-m2-05-roll.json`.
- Pitch aislado: forma `0,0066`, orientación media `0,61°`, máxima `1,53°`.
- Yaw aislado: forma `0,0020`, orientación media `0,13°`, máxima `0,31°`.
- Roll aislado: forma `0,0003`, orientación media `0,27°`, máxima `0,43°`.
- Maniobra combinada: formas pitch/yaw/roll `0,0066` / `0,0020` / `0,0010`,
  orientación media máxima `0,72°`, máxima `1,20°`.
- Validación: `npm test` → **94 pass, 0 fail**; `npm run probe:envelope` completa
  las bandas de suelo, acciones y los tres ejes de aire.

La primera hipótesis de liberación común (`0,33`) se revirtió porque mezclaba
retenciones distintas y hacía fallar la comprobación de nitro con el morro
arriba. La medición de orientación también normaliza los vectores derivados de
quaternions serializados para no confundir redondeo con física.
# Registro de física y movilidad

Actualizado: 11 de octubre de 2026.

## Objetivo del hito

Construir una experiencia de coche ágil y aéreo comparable en respuesta y
legibilidad a las referencias de Rocket League y Car Soccer, con una
implementación original en JavaScript y simulación autoritativa en el servidor.
La comparación se basa en comportamiento observable: no se incorporan código,
binarios, WebAssembly, mallas ni constantes de los juegos analizados.

## Evidencia disponible

| Fuente | Qué aporta | Límite |
| --- | --- | --- |
| 2026-10-10 | CAL-03: traza de mando, red y simulación | `npm run calibrate:network` pasó ocho maniobras con 90–415 ms por fase y ACK del servidor antes de cada medida. Verificó pitch, yaw, rolls, free air roll, doble salto, dodge con roll, nitro y recuperación de saltos sin tocar la partida del puerto 5189. Informe: docs/automated-cal-03-last-run.json. |
| Ejecutable local de Rocket League, revisado estáticamente con REA | Paso fijo, ejes locales del coche, ventanas distintas para salto, doble salto y dodge, y contactos por superficie | Un análisis estático no revela por sí solo parámetros de diseño ni la sensación final. |
| Recursos públicos de Car Soccer, revisados estáticamente con REA | Cliente Three.js, presentación interpolada, estado de posición, orientación, velocidad lineal/angular, apoyo y boost a 120 Hz | El núcleo de física está compilado a WebAssembly; no existe una implementación JavaScript que se pueda reutilizar de forma segura. |
| Simulación propia | 120 Hz, servidor autoritativo, orientación quaternion y pruebas deterministas | La arquitectura todavía mezcla modelos incompatibles de suelo, aire y paredes. |

Los detalles y hashes de los análisis están en
`_bmad-output/planning-artifacts/rl-reference-mobility.md` y
`_bmad-output/planning-artifacts/car-soccer-rea-static-findings.md`.

## Diagnóstico actual

- CAL-01 aplica motor, freno, reversa y agarre lateral en las ruedas cargadas.
  El giro parte del ángulo de las ruedas delanteras y del par que generan;
  DESGUACE conserva por ahora su controlador directo como rama de regresión.
- CAL-01 resuelve el volumen del chasis orientado contra los seis planos y
  cuatro apoyos de rueda con recorrido, muelle y amortiguación. Dos apoyos de
  suelo con compresión significativa devuelven el estado de apoyo y los dos
  saltos. La conducción por pared no está implementada; el perfil de desguace
  conserva su rama heredada.
- El vuelo usa orientación quaternion y tasas angulares locales. FIS-14C
  integra los tres ejes en una sola rotación de espacio local, evitando que la
  composición de pitch, yaw y roll dependa de un orden fijo de ejes. M4-03
  conserva esa actitud al tocar el suelo y deja que el impulso de contacto y
  los muelles cambien las tasas de forma física.
- FIS-14B publica una máquina temporal de salto. El primer salto es el único
  que recibe elevación mantenida; el doble salto vertical y el dodge son
  acciones distintas. El dodge captura su eje local al pulsar y no cambia si
  la entrada posterior cambia. La implementación vigente conserva el dodge como
  impulso horizontal y no añade una elevación vertical inventada; FIS-19 alinea
  el pulso y el momento de apertura de la ventana del segundo salto.
- FIS-14K verifica el borde de activación con W/S, A/D y air roll direccional:
  el servidor normaliza la pareja delantero/lateral, la aplica sobre la base
  del quaternion actual y congela la dirección durante el follow-through. Una
  entrada opuesta puede cancelar el giro, pero no retargetea la velocidad ya
  aplicada.
- La cámara seguía el `yaw` horizontal de la simulación y no el vector
  delantero del quaternion. Eso puede falsear la percepción de giro, vuelo y
  air roll; CAL-01 lo corrige.
- Rampas, coberturas, pads, vehículos rivales y cohetes introducen contactos
  ajenos al ensayo de movilidad.

## Plan de ruta vigente

La secuencia, decisiones de arquitectura, criterios de aceptación, riesgos y
siguiente historia están en [current-development-roadmap.md](current-development-roadmap.md).
FIS-12A completó el contacto común para suelo, cuatro paredes y techo dentro de
CAL-01. FIS-12B añadió suspensión y transición de apoyo. FIS-13A añadió motor,
freno, reversa, agarre lateral y dirección aplicados por rueda. FIS-13B añadió
powerslide, FIS-14B completó la máquina temporal de salto, doble salto y
dodge, y FIS-14C dejó el vuelo y nitro en una base vectorial determinista.
FIS-14D añadió la traza de calibración y el HUD. FIS-14E corrigió el contrato de free air roll: Shift transforma A/D en alabeo y Ctrl/Espacio conservan la guiñada. CAL-03 automatizada añade el contrato de mando Rocket League, entrada por WebSocket y evidencia temporal. CAL-04 mide la envolvente cinemática a 120 Hz; FIS-14F.1 redujo la inercia de liberación de los ejes aéreos sin alterar sus tasas activas, impulsos ni contactos. FIS-13C usó la misma envolvente para conservar más velocidad en powerslide sin perder radio ni recuperación. FIS-14G compone el dodge con guiñada y roll y lo comprueba por red. FIS-14J dejó documentado el perfil dirigido y FIS-19 lo corrigió para conservar el plano horizontal público, añadir el pulso mínimo de salto y abrir la ventana en el momento correcto. FIS-14K añade regresiones del flanco de activación y confirma que la dirección queda comprometida. M3 queda aceptado contra R3; M4-01/M4-02/M4-02b fijaron la captura propia, la referencia R4 y la carga relativa de rueda, y M4-03 ya retiró el auto-enderezado y transmitió el momento de contacto. El siguiente paso es M4-04 antes de la validación visual.

No se añadirá geometría de juego, IA o combate hasta que CAL-02 y FIS-12 a
FIS-14 tengan resultados medibles.

## Incidencias y prevención

| Incidencia | Causa o estado | Solución aplicada / prevención |
| --- | --- | --- |
| CAL-03 podía atribuir un doble salto previo al dodge de la maniobra siguiente | El cliente de la traza vaciaba las muestras y comprobaba solamente `grounded` y dos saltos tras enviar `restart`; un snapshot anterior ya cumplía esa condición. | `tools/calibration-network-trace.mjs` espera los seriales de acción a cero del coche reconstruido y vuelve a vaciar las muestras antes de enviar el siguiente input. La calibración WebSocket volvió a pasar con `noDoubleJumpSeen=true` para el dodge diagonal. |
| La primera ejecución de FIS-13D no arrancó | La expresión `Object.fromEntries(...map(...))` de la matriz de bandas tenía un corchete de cierre adicional. No llegó a cargar el servidor ni alteró la simulación. | Corregir la expresión, volver a ejecutar `npm test` y `npm run probe:envelope` antes de aceptar la matriz. La regresión queda cubierta por `tests/mobility-envelope.test.mjs`. |
| `EADDRINUSE` al iniciar en el puerto 5189 | Ya había un proceso Node escuchando en ese puerto. La consulta posterior no siempre lo mostró porque el proceso podía haber terminado entre ambas órdenes. | Usar el servidor ya activo o identificar el proceso que escucha antes de reiniciar. Para una instancia adicional: `$env:PORT=5198; npm start`. |
| El puerto 5198 figuraba ocupado, pero `localhost` agotaba el tiempo de espera | Un proceso `node` iniciado dentro del sandbox permaneció escuchando sin atender la red del escritorio. | Confirmar la respuesta con `Invoke-WebRequest -TimeoutSec 5 http://127.0.0.1:5198/`. Si no devuelve `200`, identificar el PID con `netstat -ano | Select-String ':5198'`, detener únicamente ese proceso y arrancar de nuevo el servidor fuera del sandbox. |
| Las pruebas pasaban pero el juego no se sentía correcto | Las pruebas cubrían invariantes locales, no trayectorias y respuesta percibida. | Añadir probes de comportamiento y exigir sesión de prueba antes de afirmar similitud con una referencia. |
| La escena visual y el límite físico no coincidían exactamente | El desguace dibujaba marcas y muros decorativos distintos a los límites autoritativos. | CAL-01 dibuja las mismas dimensiones que `ARENA`; las pruebas de movilidad se hacen allí. |
| Cámara desligada de la actitud aérea | La cámara calculaba su delante con `yaw` plano, ignorando cabeceo y alabeo. | CAL-01 usa el quaternion renderizado del coche. Mantener una prueba visual de air roll al cambiar cámara o interpolación. |
| La automatización del navegador no pudo abrir `localhost` | La política del navegador integrado bloqueó la acción sobre la pestaña local. No es un fallo del juego. | Comprobar disponibilidad por HTTP y dejar la validación visual manual como pendiente. No eludir la política con otros mecanismos. |
| La automatización pudo pulsar el salto, pero no mantener foco de teclado sobre el canvas | El adaptador de navegador devuelve el foco al área web después del clic, por lo que no puede sostener W/S/Ctrl/Espacio para un playtest. El juego sí recibió y mostró la acción de salto. | Usar una instancia aislada para comprobar carga y HUD, y ejecutar el guion de vuelo con teclado físico. El HUD de CAL-01 ahora publica estado, actitud y tasas para anotar el resultado manual. |
| Escribir una nota de calibración podía conducir el coche o reiniciar la ronda | El capturador global de teclas también recibía eventos procedentes de un textarea, selector o botón del nuevo panel. | Ignorar controles de juego cuando el foco está en un elemento de formulario y limpiar las entradas retenidas al enfocarlo. La reasignación de teclas conserva prioridad propia. |
| Un informe de calibración podía cerrarse sin maniobra | Dos snapshots estacionarios bastaban para marcar un paso como correcto y producir una decisión sin evidencia de vuelo. | Exigir al menos dos snapshots y evidencia de aire, actitud y giro; los pasos de nitro y aterrizaje exigen además sus transiciones. `Sin evidencia` sigue disponible, pero también requiere dos snapshots. |
| El informe podía perderse si fallaba el portapapeles | El fallback eliminaba el textarea temporal antes de que el piloto pudiera copiarlo manualmente. | Mantener el informe visible dentro de la tarjeta y seleccionarlo si falla la copia automática. |
| Un ACK ausente se agregaba como 0 ms | Convertir `null` a número introducía una lectura de red falsa en el rango de la sesión. | Ignorar ACK no finitos; registrar solo muestras de retorno realmente observadas. |
| Comprobación FIS-12A comparó altura con igualdad exacta y falló por `4.3e-17` | Redondeo de operaciones con quaternion produce ruido de punto flotante aunque el coche esté en reposo. | Validar posición física con tolerancia pequeña (`1e-8`), reservando igualdad exacta para valores discretos. |
| Una rueda casi extendida marcó el coche como `grounded` | El alcance máximo detectaba proximidad, pero el muelle no tenía compresión ni fuerza estática. Eso devolvía controles y saltos antes de un aterrizaje real. | Exigir dos ruedas de suelo con una compresión mínima (`0,01`) para el estado de apoyo. El amortiguador sigue actuando durante la aproximación, sin convertir el contacto de carrocería en apoyo jugable. |
| La combinación de pitch, yaw y roll dependía del orden de tres quaterniones | Encadenar tres deltas por eje hace que una maniobra combinada tenga un sesgo matemático aunque las tasas sean las mismas. | Integrar una única velocidad angular local con eje normalizado y ángulo igual a su magnitud por paso. Mantener pruebas de ejes aislados, combinación y cadencia agrupada. |
| El snapshot perdió el suelo cuando solo las ruedas sostenían el chasis | La caja de carrocería puede seguir separada del plano mientras la suspensión ya está cargada. | Fusionar el plano de rueda cargado en `cars[].contacts`, con `wheelCount`, y publicar el detalle por rueda en `cars[].wheels`. |
| Fixture de contacto rotado apuntó el quaternion al lado contrario | El signo de la rotación alrededor de Z invierte la dirección del eje local arriba. | Comprobar los ejes locales transformados al crear escenarios 3D y verificar la normal de contacto esperada. |
| Un dodge diagonal que tocaba suelo con carrocería inclinada podía quedar flotando | El contacto de la carrocería eliminaba la velocidad normal, pero no transmitía el momento del impacto al chasis; la raíz de las ruedas podía perder el apoyo en el siguiente paso. | M4-03 aplica el impulso normal en el brazo de contacto, conserva pitch/roll y deja que suspensión y dos ruedas cargadas restituyan el control. La sonda cubre el dodge diagonal completo hasta `grounded`, con ambos saltos repuestos. |
| Controles antiguos guardados en el navegador | `localStorage` puede conservar asignaciones anteriores. | Usar **Restaurar predeterminados** en el panel. Documentar cambios de acciones y migrar claves si se renombran. |
| Copiar una referencia externa sería frágil y no corresponde al proyecto | Car Soccer concentra física en WebAssembly; Rocket League es un ejecutable de terceros. | Usar solo relaciones observables y evidencia propia. Mantener la implementación y las pruebas originales. |
| La traza aérea agrupada divergía de la de 120 Hz | La sonda entregaba fases de hasta 0,3 s en una única llamada, aunque `ArenaMatch.tick` limita intencionadamente cada paquete a 50 ms. Se simulaba menos tiempo, no una física distinta. | Dividir la entrada agrupada en paquetes de 50 ms antes de compararla. Las pruebas futuras de cadencia deben respetar ese límite. |
| Dos suavizados de cliente acumulaban retraso visual | La malla seguía de forma exponencial el último snapshot y la cámara seguía otra malla ya retrasada. Bajo entrega de red estable esto se siente como falta de respuesta aunque la simulación sea correcta. | Interpolar primero en tiempo entre snapshots y aplicar la pose resultante directamente al chasis. Mantener la cámara suavizada solo sobre ese mismo chasis. |
| Un paquete tardío podía mezclar una vida anterior con un respawn | Una interpolación ciega entre muestras produce una trayectoria visual falsa a través de la arena. | Reiniciar el buffer ante respawn, teletransporte, cambio de arena, salto temporal o reloj no creciente. Nunca extrapolar tras una conexión detenida. |
| Recuperar fuentes opcional de REA no estaba configurado | La integración Wakaru de REA no tiene un ejecutable configurado en esta instalación. | Conservar los hallazgos del análisis estático, suficiente para arquitectura. No instalar ni usar herramientas adicionales salvo que se necesite una investigación futura independiente. |
| Primera prueba de `vgamepad` sin bus operativo | El proyecto local cargaba la librería Python, pero ViGEmBus respondía `VIGEM_ERROR_BUS_ACCESS_FAILED`; el instalador antiguo no dejó un dispositivo utilizable. | Se conservó la traza por adaptador, red y servidor como regresión independiente. Después se instaló el paquete oficial 1.22.0 y se repitió la prueba con elevación; el estado final está en la incidencia siguiente. |
| Un efecto discreto puede repetirse al recibir el mismo snapshot | La pose se procesa cada fotograma y los snapshots pueden repetirse o interpolarse. Deducir un salto desde la pose activa el efecto más de una vez. | Publicar seriales monotónicos propios para cada transición y consumir únicamente aumentos. Mantener el estado físico separado del efecto visual. |
| No había una medida de demora entre la entrada y el estado confirmado | El cliente enviaba controles a 60 Hz, pero el HUD no podía separar una percepción de latencia de un problema de física. | Etiquetar cada entrada, confirmar la última aplicada en cada snapshot y mostrar el tiempo de retorno en CALIBRACIÓN LIMPIA. No activar predicción ni conciliación sin una observación LAN. |

| El dodge no incorporaba el alabeo direccional | La rama de segundo salto normalizaba únicamente `throttle` y `steer`; X/B o Ctrl/Espacio podían girar el coche, pero no cambiar la dirección lateral del dodge. | Adaptar el contrato observable de Car Soccer: `dodgeSideInput = yaw + roll`, suprimiendo `yaw` cuando está activo free air roll. La nueva regresión cubre yaw solo, yaw + roll y free air roll. |
| `vgamepad` devolvía `VIGEM_ERROR_BUS_ACCESS_FAILED` | El bus no estaba operativo para el proceso Python sin elevación. El instalador antiguo del repositorio de pruebas no dejó un dispositivo utilizable. | Instalar el paquete oficial firmado ViGEmBus 1.22.0. El dispositivo `Nefarius Virtual Gamepad Emulation Bus` aparece iniciado y la secuencia elevada de `vgamepad` crea, actualiza y libera el mando. Mantener el requisito de proceso elevado para esta prueba y no confundirla con una prueba completa de `navigator.getGamepads()`. |
| La primera build de R4 falló con `C1902` | El build antiguo conservaba un PDB generado por otra versión de MSVC; el compilador no podía abrir el administrador de base de datos. | Aislar `rocketsim-r4-z7-2` y configurar `/Z7` para incrustar símbolos. La build Release terminó y la captura R4 se generó; el workaround queda fuera del proyecto de producción. |
| Una nueva traza CAL-03 en un puerto alternativo terminó sin informe | El runner aislado no devolvió salida diagnóstica al lanzar su servidor temporal; no se puede distinguir un fallo del adaptador de un límite del entorno. | No usar esa ejecución como evidencia. La regresión aceptada de esta iteración es `npm test` + `npm run probe:envelope`; repetir CAL-03 desde una PowerShell del usuario en un puerto libre cuando se necesite evidencia de WebSocket. |
| El aterrizaje aplanaba pitch y roll en un solo subpaso | La rama de apoyo multiplicaba la actitud por 0,22 y la tasa por 0,18 antes de devolver controles a las ruedas. La medición registraba −0,285 rad de pitch y −0,223 rad de roll antes del contacto, pero cero inmediatamente después. | M4-03 retiró la retención, la reducción de tasa y la aproximación a 4 rad/s. El contacto normal transmite ahora su momento y la suspensión produce la respuesta; no hay objetivo de orientación al aterrizar. |
| Un contacto de carrocería podía recuperar el estado de juego antes de cargar la suspensión | La primera pasada de CAL-01 consideraba suficiente el contacto del chasis y la rama final solo comprobaba una rueda. Un frame intermedio podía publicar `grounded` y dos saltos sin apoyo real. | FIS-14I/M4-03 deriva `grounded` exclusivamente de al menos dos ruedas de suelo con compresión mínima (`0,01`). El aterrizaje conserva una observación pendiente hasta que el colector final la acepta; la sonda separa cuerpo, dos ruedas y control recuperado. |
| Air roll hacía girar el horizonte de la cámara | `moveCamera` usaba el quaternion y el vector `up` completos del coche para la posición y el foco. Un alabeo válido de la física se convertía en un cambio visual lateral o en un horizonte inclinado. | FIS-16A separa presentación y actitud: rumbo horizontal amortiguado, `up` mundial, foco vertical limitado por pitch, protección cuando el morro queda casi vertical y reinicio en respawn/conexión. La política queda en `src/camera-follow.js` y tiene cuatro regresiones deterministas. |
| Un segundo salto dirigido era un empujón plano | La rama de dodge solo sumaba su eje local. Con el coche nivelado, un dodge lateral no tiene componente vertical propia. | FIS-19 conserva ese contrato público: el dodge solo aplica el impulso horizontal comprometido y la amortiguación vertical breve; el segundo salto vertical es la acción que aporta elevación. |

## Comparación con Car Soccer — 10 de octubre de 2026

La comparación está documentada en
[archive/2026-10-12/car-soccer-comparison-2026-10-10.md](archive/2026-10-12/car-soccer-comparison-2026-10-10.md).
La conclusión operativa es concreta: el cliente de referencia separa pitch,
yaw y roll y compone el dodge en ese plano; nuestro dodge ya incorpora esa
relación. La página de referencia no llegó a ser jugable en el entorno, por lo
que quedan pendientes la calibración de tacto y la comparación visual.

La verificación de esa sesión fue de **94 pruebas, 0 fallos**, además de `npm run probe`,
`npm run probe:envelope` y `npm run calibrate:network`. FIS-14J mide
`+6,968 u/s` de doble salto vertical frente a `−0,133` y `−0,133 u/s` de
dodge frontal y lateral a nivel (la diferencia negativa es la gravedad del
subpaso). La traza CAL-03 pasó
ocho maniobras y registró el doble salto vertical y el dodge con roll; el
script de mando virtual dejó 20 pulsaciones A automatizadas y liberó el
dispositivo correctamente. La pestaña local cargó FIS-16A, registró air roll
con `R 116°` y no mostró errores de consola; queda pendiente la valoración
subjetiva de la cámara con una escena de juego menos cubierta por el panel de
calibración.

## RCE-1 — línea base de curvas — 11 de octubre de 2026

Se añadió `npm run probe:curves` como primera entrega de FIS-17; para guardar
JSON sin la cabecera de npm se usa `node tools/mobility-curves.mjs`. Reproduce
salto, doble salto, dodge frontal/lateral/diagonal, ejes aéreos y free air roll
con una semilla fija. Cada escenario produce 144 muestras a 120 Hz con entrada,
pose, velocidades, quaternion, estado, dirección comprometida y seriales. La
regresión de `tests/mobility-curves.test.mjs` comprueba que las trazas son
idénticas entre ejecuciones y que la diagonal queda normalizada a
`(0,447, 0,894)`.

La herramienta permite comparar curvas cuando exista una captura autorizada,
pero no inventa datos de Rocket League o Car Soccer. El plan, el esquema de
captura y los límites de REA están en
[`docs/archive/2026-10-12/reference-curve-recovery-plan.md`](archive/2026-10-12/reference-curve-recovery-plan.md).

La captura completa de Arsenal está en
`docs/reference-captures/arsenal-2026-10-11.json`. La sesión de Car Soccer del
11 de octubre se quedó en “Warming up visual effects”; sus recursos visibles
separan mallas de colisión y sonidos de salto, doble salto y dodge, pero no
permiten medir una curva jugable. No se ajustó `TUNING` con esa evidencia.

## Criterios de aceptación de movilidad

Cada cambio de física debe demostrar, como mínimo:

- Misma traza de entrada y semilla: mismo resultado a 120 Hz.
- Ninguna geometría secundaria participa en CAL-01.
- La cámara mantiene la dirección del morro durante pitch y air roll.
- Los contactos conservan la velocidad tangencial y solo corrigen penetración o
  velocidad normal cuando corresponde.
- Los valores de ajuste se cambian para alcanzar una métrica registrada, no
  para ocultar un defecto de contacto.

## M3 — resultado de segundo salto y dodge (11 de octubre de 2026)

M3 queda aceptado contra la referencia limpia R3. La captura propia es
`docs/reference-captures/arsenal-m3-air-action-dodge-calibrated.json`; la
referencia es `docs/reference-captures/rocketsim-r3-jumps-dodges-c2baacb8.json`.
Las cuatro acciones activan en el tick 12: doble salto neutro, dodge frontal,
lateral y diagonal con air roll. El error de orientación medio/máximo es
`0°/0°`, `0,19°/1,11°`, `0,002°/0,079°` y `0,08°/0,44°`, respectivamente.

La corrección clave fue sustituir una tasa fija de flip por torque acumulado
(`224` pitch, `260` roll por segundo), integrar la orientación y aplicar luego
el límite angular vectorial de `5,5 rad/s`. Así se reproduce la pose sin
inventar elevación ni perder la cancelación. La comparación normaliza solo la
forma; los picos de velocidad conservan las unidades distintas de cada motor.

La primera versión de esta historia fijaba la tasa en `5,5`: las tasas parecían
iguales, pero el dodge frontal acumulaba hasta `64°` de error de orientación.
La versión por torque redujo ese máximo a `1,11°`. La primera ejecución también
dejó un nombre de constante obsoleto y produjo `NaN`; el test completo lo
detectó inmediatamente y se eliminó la asignación residual antes de aceptar.

Validación final: `npm test` → **94 pass, 0 fail**. Próxima historia: M4,
contactos y aterrizajes, sin cambiar el contrato M2/M3.

## M4-01/M4-03 — transición de contacto y aterrizaje (11 de octubre de 2026)

M4-01 queda aceptada como instrumentación y M4-03 como corrección física
aislada. `src/contact-transition-probes.js` registra a 120 Hz pose, velocidad,
contacto de carrocería, las cuatro ruedas, compresión, velocidad normal y
velocidad tangencial. La captura reproducible es
`docs/reference-captures/arsenal-m4-01-contact-transitions.json` y se genera
con `npm run probe:contacts`.

Las seis condiciones terminan con apoyo, `grounded=true`, `jumps=2` y
separación mínima de suelo `0`. Caídas plana/pitch/roll cargan apoyo en
`119/130/109`; dodge frontal/lateral/diagonal en `182/135/178`. El contacto
de carrocería siempre precede o coincide con el apoyo de dos ruedas. Los
dodges conservan velocidad tangencial (`13,293`, `12,7444` y `13,4597 u/s`)
y los finales de paquetes agrupados de hasta 50 ms coinciden con los pasos
fijos.

La primera aserción del nuevo test comparaba un resumen compacto con el
snapshot agrupado completo; se corrigió aislando `compactFinal` y se volvió a
ejecutar la regresión. Resultado final: `npm test` → **95 pass, 0 fail**.
M4-04 queda como historia histórica aplazada; no se reabrirán las constantes de
vuelo, salto, dodge o cámara salvo que MOB-01 atribuya un defecto al contacto.

## M4-02 — referencia R4 de suelo sintético (11 de octubre de 2026)

El oráculo aislado de RocketSim ahora publica `contactTraces` para las mismas
seis condiciones de M4-01. La captura es
`docs/reference-captures/rocketsim-r4-contact-transitions-c2baacb8.json`, su
metadata fija el commit MIT `c2baacb8`, y
`npm run compare:contacts` genera
`docs/reference-captures/arsenal-r4-contact-comparison.json`.

R4 conserva apoyo de ruedas y asentamiento en todas las maniobras. El orden de
los eventos es comparable, pero los frames no se pueden convertir todavía en
una corrección: RocketSim usa unidades internas diferentes, la altura inicial
de caída se fijó en `30 UU` para evitar contacto prematuro y `CarState` no
publica compresión de muelle. Además, el contacto de carrocería solo aparece
cuando Bullet notifica una colisión del chasis. La comparación mantiene estas
limitaciones explícitas y no abre M4-03 ni modifica `TUNING`.

Resumen de apoyo/estado `Arsenal / RocketSim`: caída plana `120 / 29`, pitch
`109 / 22`, roll `110 / 26`, dodge frontal `45 / 144`, lateral `47 / 122` y
diagonal `43 / 135`. Los frames son evidencia de forma y orden, no objetivos
absolutos mientras no exista una escala de suspensión común.

## M4-02b — normalización de caída libre (11 de octubre de 2026)

La herramienta `tools/normalize-contact-transitions.mjs`, ejecutada con
`npm run normalize:contacts`, genera
`docs/reference-captures/arsenal-r4-contact-normalized.json`. Estima la
gravedad desde la velocidad vertical previa al contacto, calcula la altura
libre respecto al reposo y divide el tiempo hasta apoyo por
`sqrt(2 * altura / gravedad)`. En las tres caídas puras las razones
Arsenal/R4 son `0,9874/0,7964`, `0,9588/0,6042` y `0,9676/0,7141`.

La lectura es una puerta de medición, no una constante objetivo. El harness R4
conserva longitud y fuerza de `btVehicleRL` fuera de `CarState`, y publica la
carga media normalizada por su apoyo asentado; en flat/pitch/roll sus picos son
`3,0764`, `2,0455` y `2,605`, frente a `1`, `1,0313` y `1` de Arsenal. Los
dodges se marcan como no aplicables a la caída libre. La diferencia restante
es una hipótesis de forma, no una fuerza común: M4-03 corrigió únicamente el
momento de contacto y el umbral de apoyo, sin copiar esas fuerzas.

## Línea base CAL-02

Se ejecuta con `npm run probe`. Estos números son una fotografía de la
implementación actual, no objetivos de diseño:

| Prueba | Resultado actual | Lectura |
| --- | ---: | --- |
| Conducción: distancia en 2 s | 47,817 u; 26,767 u/s al primer segundo y 35,163 u/s al segundo | Línea base del motor y neumáticos de CAL-01; no es todavía una curva objetivo de tacto. |
| Conducción: frenado a marcha atrás | 0,600 s | Dato de partida para la futura curva de freno y reversa. |
| Salto sostenido | ápice 6,037 u; 1,583 s | Punto de comparación después de integrar la suspensión; el aterrizaje se mide por apoyo autoritativo, no por igualdad exacta de altura. |
| Aire tras 0,45 s con tres ejes | delante Y = -0,786 | La actitud ya responde localmente, pero todavía necesita calibración jugable. |
| Nitro aéreo en 1 s | 28,503 u/s; recurso sin consumo | Confirma el perfil de práctica continuo. |
| Segundo salto dirigido | doble salto `+6,968 u/s`; dodge frontal/lateral `−0,133 u/s` en el primer subpaso | El dodge dirigido conserva el plano horizontal público y no recibe elevación propia. Falta confirmar el tacto con el servidor reiniciado y una cámara visible. |
| Giro por ruedas | primer paso 0,002 rad; tras 1 s 1,511 rad y 14,853 u laterales | El giro emerge del deslizamiento de los neumáticos y del par del chasis; es una línea base para el powerslide. |
| Powerslide | 1,636 rad de yaw y −14,338 u/s lateral tras 0,5 s; 0 u/s lateral tras recuperar 1 s | Shift libera el eje trasero, aumenta dirección y aplica un par limitado; liberar Shift no borra el impulso en un paso. |
| Acciones de salto | `first-jump` → `dodge` → `airborne` → `grounded`; doble salto vertical sin elevación mantenida | La dirección diagonal capturada es ±0,707 por eje local; el estado y las ventanas quedan visibles en el snapshot. |
| Ejes de aire y nitro | W: delante Y = −0,603; S: +0,603; D: delante Z = +0,527; air roll derecho: arriba Z = +0,740 tras 0,3 s | Los sentidos se comprueban de forma aislada. Tras inclinar el morro, 0,2 s de nitro aporta +0,853 u/s vertical mirando arriba y −7,253 u/s mirando abajo. Son línea base, no objetivos finales de tacto. |
| Maniobra aérea de calibración | 1,5 s; `cadenceMatches = true`; antes de nitro `forward.y = 0,865` y después `0,985` | La inversión, la combinación, la liberación y el nitro ya tienen una línea base reproducible. El siguiente ajuste depende del tacto manual, no de copiar constantes externas. |
| CAL-03 automatizada | Ocho maniobras por adaptador y WebSocket; intervalos medidos de 90–415 ms; todos los ACK confirmados | RT/LT conservan valores analógicos, A salta, RB aplica nitro, LB convierte el stick en free roll, X/B dan roll direccional, A sin dirección hace doble salto y A + stick + B hace un dodge diagonal con dirección normalizada. El detalle queda en `docs/automated-cal-03-last-run.json`. |

El smoke de R5 se ejecuta dos veces fuera de `npm test` y debe producir el
mismo resultado para la misma build y secuencia de entrada.

## Historial

### R7-01 — práctica RocketSim opt-in (12 de octubre de 2026)

**Aceptada.** `RocketSimPracticeMatch` conecta un piloto al perfil nativo
`arsenal-practice` solo con `MOVEMENT_BACKEND=rocketsim`; JavaScript continúa
siendo el backend predeterminado y no hay fallback silencioso. El servidor
publica a 60 Hz consumiendo dos ticks nativos a 120 Hz, conserva el contrato de
snapshot y cierra el sidecar con timeout y limpieza explícitos.

- `npm test`: **105 pass, 0 fail**.
- Captura real: 180 snapshots, dos ticks por snapshot, mediana `0,877 ms`,
  p95 `1,343 ms`, máximo `4,046 ms`.
- Navegador: HUD `PRÁCTICA ROCKETSIM`, un piloto, dos saltos y ACK de entrada.
- Límite: todavía no se declara equivalencia visual de salto, doble salto o
  dodge; R7-02 debe medir esas maniobras con una secuencia reproducible.

### R7-02 — sonda autoritativa de vuelo (12 de octubre de 2026)

**Medida; revisión visual pendiente.** `npm run probe:rocketsim-practice`
arranca el servidor opt-in, ejecuta cuatro fases aisladas y escribe
[`rocketsim-practice-r7-02.json`](reference-captures/rocketsim-practice-r7-02.json).
La última ejecución obtuvo 94 snapshots, ACK 18/18 y cadencia media `0,01667 s` frente
a `2/120 = 0,01667 s`. Los seriales de salto, doble salto y dodge dirigido
aparecen en los estados autoritativos; la fase de vuelo publica pitch/roll
angular sin mezclar el solver JavaScript.

El contrato nativo ahora publica `worldContact.normal` para contactos de
carrocería y la práctica clasifica suelo, pared y techo sin inventar una
corrección de actitud. `wheelCount` sigue siendo la señal de apoyo de ruedas;
R7-03 debe validar visualmente la transición antes de usarla en combate.

La carga real en `http://localhost:5206/` mostró el HUD `PRÁCTICA ROCKETSIM`,
`SALTOS 2/2`, estado `grounded`, ACK activo y el evento de entrada del piloto.
La inspección de maniobras fue solo DOM/estado; no se presenta como captura
visual completa.

La sonda no sustituye la inspección visual de cámara, aterrizaje y tacto. Esa
puerta queda para R7-03; hasta cerrarla RocketSim sigue limitado a práctica.

### R7-03 — contacto nativo de pared y límite de geometría (12 de octubre de 2026)

**Aceptada como contacto plano.** `npm run probe:rocketsim-contacts` conserva seis checkpoints
y el primer contacto de pared en
[`rocketsim-practice-contacts-r7-03.json`](reference-captures/rocketsim-practice-contacts-r7-03.json).
El tick 220 publica `worldContact.normal=(-1,0,0)` y cuatro ruedas apoyadas;
el tick 221 mantiene el contacto nativo y muestra la respuesta después del
impacto con dos ruedas. El dato procede del sidecar RocketSim/Bullet y no de un
rebote añadido en JavaScript.

Esto valida la colisión contra un plano, no la curva de una arena Soccar. El
bridge se inicializa con `InitFromMem({ }, true)`: el código público de
`Arena::Create(GameMode::SOCCAR)` exige las mallas binarias de colisión y el
repositorio no las trae incorporadas. La migración exacta del solver de coche
ya está hecha en el modo `MOVEMENT_BACKEND=rocketsim`; la geometría de pared
curvada sigue siendo una dependencia separada y no se debe simular como si
estuviera resuelta. R7-04 la cubre con una geometría propia de entrenamiento.

### R7-04 — arena original con transición curva (12 de octubre de 2026)

**Aceptada.** El perfil nativo `arsenal-curved-practice` incorpora un cuarto de
cilindro propio entre suelo y pared, una pared vertical de continuación, techo y
límites laterales. El mesh es propiedad del proceso del bridge y se reutiliza en
reinicializaciones para evitar acumulación de geometría.

La captura [`rocketsim-curved-practice-r7-04.json`](reference-captures/rocketsim-curved-practice-r7-04.json)
se repite con SHA
`7da59d6caacd75a3ab9e24d302c203913f1d342fad3d1a51f822791ed6c0757d`.
El apoyo inclinado comienza en el tick 215, el apoyo pronunciado en el 229,
hay `0` huecos antes de la pared y la variación normal máxima entre muestras es
`5,625°` (`68` muestras, límite `8°`). `wheelContact.normal` viene del apoyo
de ruedas nativo; `worldContact.normal` se conserva para contactos de carrocería.
La captura valida continuidad de una arena propia y no pretende reproducir la
malla ni las constantes de geometría de Rocket League.

La siguiente puerta es R7-05: conectar este perfil a una práctica de navegador,
medir la cámara y validar salto, doble salto, dodge, air roll, boost y
aterrizaje. RocketSim sigue siendo opt-in y el combate continúa en JavaScript.

### R7-05a — perfil curvo en la práctica web (12 de octubre de 2026)

**Aceptada como integración de perfil.** `ROCKETSIM_ARENA` permite seleccionar
`arsenal-practice` o `arsenal-curved-practice` sin cambiar la autoridad ni el
protocolo de inputs. El snapshot conserva `settings.arena=calibration` y añade
`settings.practiceArena`; Three.js dibuja la misma transición de radio 256 UU
normalizada a 56/2300 y sin obstáculos.

La suite subió a **107 pruebas, 0 fallos**. `node --check src/client.js` y
`node --check server.mjs` pasan. En el servidor real de `http://localhost:5211/`
se verificó HTTP 200, handshake WebSocket, un coche autoritativo, estado
`grounded`, `practiceArena=arsenal-curved-practice` y ACK; el cliente mostró el
encabezado de transición curva y la consola no registró errores.

La captura visual inicial no encuadraba toda la curva, pero la corrección de
R7-05b aisló la práctica del panel de calibración y limitó la cámara bajo el
techo durante el recorrido. R7-05b se documenta por separado con evidencia de
sonda y navegador; esta integración no afirma por sí sola equivalencia de tacto.

### R7-05b — transición curva y cámara de práctica (12 de octubre de 2026)

**Aceptada para recorrido y presentación.** La nueva sonda
`npm run probe:rocketsim-curved-practice` usa el servidor y WebSocket reales:
con una única entrada sostenida de avance y nitro observa apoyo inclinado a
`1,87 s`, pronunciado a `1,95 s` y pared a `2,00 s`; conserva cuatro ruedas y
cero huecos antes de pared. ACK, perfil curvo, piloto único y cadencia de dos
ticks por snapshot pasaron. La evidencia queda en
[`rocketsim-practice-curved-r7-05b.json`](reference-captures/rocketsim-practice-curved-r7-05b.json).

La inspección real de navegador mostró el coche sobre la pared curva con HUD de
nitro nativo y sin el panel de calibración heredado. Se detectó que la cámara
podía salir por encima del techo al seguir un coche vertical; la corrección de
presentación limita posición a `y=2,8…21,2` y foco a `y=0,8…22,2` solo en las
prácticas limpias. La prueba de cámara y las **108 pruebas** completas pasan;
la consola no mostró errores. No se ha ajustado la física.

### R7-05c — acciones desde pared curva (12 de octubre de 2026)

**Aceptada como medición automatizada.** `npm run probe:rocketsim-wall-actions`
reinicia cuatro fases en el servidor WebSocket real y, en cada una, llega a
`wallRide=true`, `surfaceType=wall` y cuatro ruedas en contacto antes de enviar
la acción. El salto activó el contador autoritativo y abandonó el apoyo; el
segundo salto con `throttle=1, steer=1` activó `dodge`; air roll produjo
velocidad angular y el nitro consumió `8,89` unidades; una fase separada
recuperó apoyo de techo después del salto. La captura está en
[`rocketsim-wall-actions-r7-05c.json`](reference-captures/rocketsim-wall-actions-r7-05c.json).

La sonda observó cadencia media `0,01666 s` (dos ticks nativos por snapshot),
`21` entradas reconocidas y cuatro pilotos aislados por reinicio. No cambió
constantes de fuerzas, reglas del solver ni el backend JavaScript. Esta puerta
mide causalidad y continuidad del contrato nativo; no afirma equivalencia
subjetiva exacta con Rocket League.

### R8-01 — plazas nativas de la práctica (12 de octubre de 2026)

**Aceptada como infraestructura nativa.** El sidecar admite `1…6` coches con
IDs únicos, equipo azul/rojo e input aislado por ID. `npm run
probe:rocketsim-multicar` recorrió 180 ticks con dos coches y obtuvo avance
longitudinal positivo para el ID `1` y negativo para el ID `2`; ambos estados
permanecieron distintos. También envió JSONL directamente al ejecutable para
comprobar rechazo de init y tick con IDs duplicados, seguido de una recuperación
correcta a init válido. La evidencia es
[`rocketsim-multicar-r8-01.json`](reference-captures/rocketsim-multicar-r8-01.json).

La práctica del navegador ya gestiona hasta seis pilotos. El primer piloto
reutiliza el slot de arranque; las altas y bajas posteriores reconstruyen de
forma atómica el roster nativo con IDs y equipos deterministas, limpian los
estados anteriores y emiten un serial de respawn para quienes permanecen. Así
no quedan vehículos marcadores que alteren las colisiones físicas. La prueba
de dos pilotos conserva inputs opuestos y estados por ID; combate y bots
nativos siguen fuera de este hito.

### UX-01a — amortiguación de cámara en aire y pared (12 de octubre de 2026)

La cámara mantiene horizonte mundial y ahora adapta su respuesta al contexto:
en aire reduce el giro horizontal a `2,8 rad/s` y en pared a `2,35 rad/s`,
frente a `6 rad/s` en suelo. También reduce el seguimiento de posición y foco
en esos dos modos. La modificación no toca orientación, fuerzas ni snapshots
del coche. Las pruebas cubren air roll, flips verticales, transición a aire y
pared, límite de techo y reinicio de cámara; la validación visual sigue
pendiente en navegador.

### R8-02a — reglas de combate separadas (12 de octubre de 2026)

`src/rocketsim-combat.js` procesa disparo por flanco, cooldown, proyectiles,
daño, puntuación y temporizadores de respawn a partir de la pose nativa. El
input `fire` no se envía al solver físico. El bridge tiene comandos explícitos
`combat-state` y `respawn`; estos aceptan solo un ID y un estado autorizado, no
una pose, velocidad ni giro calculados por JavaScript. La capa está integrada
en `RocketSimPracticeMatch` bajo `ROCKETSIM_MODE=combat` y cubierta por la
regresión.

### R8-02b — bridge nativo de combate compilado (12 de octubre de 2026)

Se compiló una build aislada inicial en `.rocketsim-bridge-build-r8/` con CMake 4.4.4,
MSVC 19.51 y el commit fijado de RocketSim. La sonda
`npm run probe:rocketsim-combat-state` verifica dos coches, desactivación nativa
fuera de la arena (`y=-10000`), respawn en el spawn nativo y continuidad del
tick. La captura reproducible es
`docs/reference-captures/rocketsim-combat-bridge-r8-02.json`. El lanzador
La build R9 añade el perfil nativo interno `combat-lineup` y es la que
`npm run start:rocketsim` usa por defecto. La build R5 queda como referencia
histórica. Esto autoriza probar el modo combate navegable, pero no declara
todavía equivalencia visual.

### R8-02c — smoke WebSocket de combate (12 de octubre de 2026)

La sonda `npm run probe:rocketsim-combat-websocket` levanta el servidor con
`ROCKETSIM_MODE=combat`, conecta dos clientes reales y comprueba bienvenidas
azul/roja, roster de dos coches, poses y orientaciones finitas procedentes de
RocketSim, ACK de inputs, cadencia de dos ticks nativos por snapshot y un solo
evento de disparo durante un intento repetido dentro del cooldown. La captura
es `docs/reference-captures/rocketsim-combat-websocket-r8-02.json`; se ejecutó
con la build R8 y pasó todas las aserciones sin errores de runtime. El impacto
entre dos coches y el ciclo completo eliminación→respawn siguen pendientes.

La misma puerta corrigió dos límites de autoridad: el servidor rechaza inputs
sin secuencia segura o repetidos, y la práctica rechaza frames nativos con IDs
duplicados aunque el sidecar real ya los valide. Un coche con salud cero tampoco
puede generar un cohete en el tick exacto de restauración del respawn.

### ARENA-01 — arena limpia ampliada con cuatro transiciones curvas (12 de octubre de 2026)

Se añadió el perfil opt-in `arsenal-expanded-curved-practice` sin cambiar la
arena práctica existente. RocketSim y Three.js usan `144×108×30` unidades
Arsenal, escala `56/2300`, radio de fillet `8` y 32 segmentos. Las cuatro
curvas se recortan un radio antes de las esquinas para evitar solapes y dejan
pared-techo y esquinas fuera del contrato.

`npm run probe:rocketsim-expanded-arena` ejecutó cuatro coches, uno por lado:
todos alcanzaron apoyo inclinado y pronunciado, sin huecos, con salto máximo
de normal `4,220°`. Dos ejecuciones fueron idénticas, SHA
`4b548e8e02c7d9c40b99e53364fe1676ea7511739f66db74b072ede923f028dd`. La
regresión R7-04 conserva su SHA histórica `7da59d6…0757d`; `npm test` pasa
119/119. La validación visual del HUD RocketSim está hecha; la maniobra completa
con entrada temporizada del lienzo sigue no verificada.

### R8-02d — impacto y respawn reales por WebSocket (12 de octubre de 2026)

La misma sonda se ejecutó con la build R9 y el perfil interno
`combat-lineup`, que alinea únicamente spawns nativos. Dos disparos válidos
del coche rojo alcanzaron al azul; una pulsación intermedia dentro del cooldown
no cambió sus `35` puntos de blindaje. El segundo impacto produjo salud `0`,
una muerte, temporizador de respawn, posición inactiva `h=-218,35` y, tras el
temporizador, salud `100`, spawn físico y serial de respawn `2`. La captura
versionada conserva todos los valores. No se escribió ninguna pose desde Node.

| Fecha | Entrega | Estado |
| --- | --- | --- |
| 2026-10-12 | R6-02: perfiles aéreos nativos, 15 trazas a 120 Hz y comparación completa | Aceptada como evidencia. RocketSim reproduce sus trazas y free air roll; Arsenal ya es cercano en ejes aéreos, pero diverge de 24,6° a 41,1° en acciones que parten de suelo. Se abre R7-01 para una práctica RocketSim opt-in, sin tocar el solver JS ni el modo de combate. |
| 2026-10-12 | R6-02 preflight: manifiesto de free air roll | Corregido en la medición. El navegador ya compone Shift+A/D a `roll=±1`, pero la secuencia canónica enviaba `airRoll=true` con `roll=0` y no medía ninguna rotación. El manifiesto se alinea con el contrato de vehículo; no cambia la simulación de producción. |
| 2026-10-12 | R6-01: trazas RocketSim desde suelo | Aceptado como medición. El sidecar valida schema/tick, convierte las posiciones de plano a Bullet, separa los ejes angulares y traduce correctamente free air roll. Seis trazas de 144 ticks repiten el SHA `0f545e…a4e6`; salto y dodges coinciden con R3 en el tick de activación y tienen menos de `0,07°` de diferencia máxima de actitud. `npm test` pasa 100/100; producción sigue en JS. |
| 2026-10-12 | R5: puente RocketSim aislado | Aceptado. Sidecar C++/Bullet a 120 Hz, protocolo JSONL y frontera y-up; `npm test` 98/98 y smoke `init/tick/shutdown` ejecutado. Backend JS sigue por defecto. |
| --- | --- | --- |
| 2026-10-11 | M4-03: aterrizaje sin auto-enderezado | Aceptado. El impulso normal de un contacto de carrocería se aplica en su brazo de contacto; pitch/roll y sus tasas se conservan al apoyar, y la suspensión decide cuándo vuelven control y saltos. El umbral de apoyo jugable queda en `0,01` de compresión para dos ruedas. `npm test` pasa 95/95 y `probe:contacts` termina las seis maniobras sin penetración. |
| 2026-10-11 | M4-02: referencia R4 de suelo sintético | Hecho como oráculo y comparación. RocketSim publica las seis transiciones a 120 Hz y `compare:contacts` conserva diferencias de apoyo, asentamiento, ángulo y velocidad con sus límites de escala y suspensión. No se abrió M4-03 ni se modificó la física. |
| 2026-10-11 | M4-02b: puerta de normalización de contactos | Hecho como medición. `normalize:contacts` calcula gravedad, altura libre, razón de caída y carga relativa de rueda para las tres maniobras sin impulsos; los dodges quedan explícitamente fuera de la caída libre. No se modificó `TUNING`; falta escoger una hipótesis única para abrir M4-03. |
| 2026-10-11 | M4-03 candidato de umbral de apoyo (histórico) | Rechazado como ajuste aislado. Bajar `WHEEL_GROUND_COMPRESSION` de `0,10` a `0,025` hizo que pitch/roll publicaran `grounded` antes que el resumen de dos ruedas cargadas. La decisión aceptada de M4-03 usa `0,01` junto con la corrección de momento de contacto y actualiza la sonda al mismo contrato. |
| 2026-10-11 | M4-01: transición de contacto y aterrizaje | Hecho como instrumentación. Seis escenarios a 120 Hz, contacto de carrocería separado del apoyo de dos ruedas, captura `arsenal-m4-01-contact-transitions.json` y consistencia con paquetes agrupados de hasta 50 ms. **95 pruebas pasan, 0 fallan**; no se modificó la física. M4-02 queda desbloqueada. |
| 2026-10-11 | FIS-19: salto y ventana del segundo salto alineados con el contrato público | Hecho en simulación. El salto escala el impulso inmediato y la fuerza sostenida, garantiza el pulso mínimo de 0,025 s y abre la ventana de 1,25 s al terminar el tramo sostenido. La regresión autoritativa termina con 94 pruebas, 0 fallos; queda validar el tacto visual con el servidor reiniciado. |
| 2026-10-11 | FIS-18: tracción, powerslide y nitro basados en curvas públicas de RocketSim | Hecho en simulación. Dirección normal, factor de par de motor, ángulo extendido de powerslide y rampa de Shift se interpolan por velocidad/tiempo. El nitro separa suelo y aire, conserva un pulso mínimo de 0,1 s y no rellena fuel en reposo. La regresión autoritativa terminó con 93 pruebas, 0 fallos. |
| 2026-10-11 | FIS-17 / RCE-1: trazas deterministas de curvas | Hecho. `npm run probe:curves` registra siete escenarios a 120 Hz, `compare:curves` calcula diferencias de forma a tiempo normalizado y la regresión confirma 93 pruebas totales, 0 fallos; RCE-2 queda pendiente de una captura externa comparable. REA revalidó el hash de Rocket League sin ejecutar el binario; el inventario exhaustivo de Ghidra se mantiene fuera del ajuste por límite de tiempo. |
| 2026-10-11 | FIS-14K: input de movimiento en el segundo salto | Hecho en simulación. W/S, A/D, diagonales y air roll direccional se capturan en el flanco, se normalizan y se aplican sobre la base local del chasis; la entrada posterior no retargetea el impulso y la opuesta solo cancela el giro. 88 pruebas pasan; la búsqueda global de símbolos Dodge en Ghidra quedó sin resultado por tiempo de análisis y no se usó como evidencia. |
| 2026-10-10 | FIS-14J: perfil de segundo salto dirigido (histórico) | Diagnóstico conservado para explicar la corrección posterior. FIS-19 retiró la elevación artificial del dodge y mantuvo solo el impulso horizontal público; las regresiones actuales cubren la ventana y el pulso mínimo. |
| 2026-10-10 | FIS-16A: cámara estable durante air roll y flips | Hecho en presentación. La cámara ya no usa el `up` ni el roll del coche para el horizonte; conserva rumbo horizontal cerca de la vertical, limita el giro a `7,5 rad/s`, reinicia el seguimiento en respawn/conexión y separa posición y foco. 86 pruebas pasan; la prueba visual de air roll cargó sin errores de consola. |
| 2026-10-10 | FIS-14I: apoyo de ruedas tras dodge diagonal | Instrumentado. La sonda registra dirección `(0,447, 0,894)`, primer apoyo a `0,625 s`, roll `-0,139` rad, velocidad horizontal `20,561 u/s`, recorrido `12,593 u` y dos ruedas cargadas. También impide que un contacto de carrocería devuelva saltos o `grounded`; 82 pruebas pasan. |
| 2026-10-10 | FIS-14H: recuperación progresiva de aterrizaje | Cerrado como decisión provisional y retirado como objetivo. Rocket League no auto-endereza el chasis al aterrizar; la retención, reducción de tasa y aproximación a 4 rad/s quedan marcadas para eliminarse. La próxima historia conservará actitud y tasa y medirá la respuesta de contacto/suspensión. |
| 2026-10-10 | FIS-14G: contrato de dodge con alabeo y doble salto en red | Hecho. El dodge combina guiñada y roll, publica su dirección comprometida y CAL-03 cubre doble salto vertical y dodge diagonal con ocho fases. 82 pruebas pasan; `npm run calibrate:network` termina con `passed = true`. |
| 2026-10-10 | FIS-13D: matriz de conducción a tres velocidades | Instrumentada. La envolvente cubre agarre, powerslide y nitro a 12, 28 y 42 u/s. El radio se abre con velocidad y el powerslide permanece más cerrado en cada banda; no hubo ajuste de física sin un defecto aislado. 81 pruebas pasan. |
| 2026-10-10 | FIS-13C: conservación de impulso en powerslide | Hecho. La medida de un giro de 90° mostró 63,1% de velocidad conservada. Ajustar solamente agarre lateral de derrape llegó a 73,4%, radio 6,114 u, giro en 0,400 s y recuperación en 0,450 s. 81 pruebas pasan. |
| 2026-10-10 | FIS-14F.1: envolvente de movilidad y frenado angular | Hecho. `npm run probe:envelope` mide conducción, salto, dodge y ejes de aire. Reducir solamente la amortiguación de liberación bajó el tiempo a neutro de 0,900–1,175 s a 0,442–0,500 s, sin modificar los cuartos de giro. 81 pruebas pasan y `airManeuver.cadenceMatches` sigue siendo verdadero. |
| 2026-10-10 | CAL-03 automatizada y soporte de mando Rocket League | Hecho. El cliente acepta mando estándar con RT/LT analógicos, A, RB, LB, X/B y D-pad arriba; teclado y ratón siguen disponibles. La traza de WebSocket pasó seis maniobras con ACK. 80 pruebas pasan; `airManeuver.cadenceMatches` sigue siendo verdadero. |
| 2026-10-10 | FIS-14E: semántica de free air roll | Hecho. Shift convierte A/D en alabeo y libera guiñada; Ctrl/Espacio conservan guiñada y alabeo direccional simultáneos. 76 pruebas pasan y `airManeuver.cadenceMatches` sigue siendo verdadero. |
| 2026-10-10 | FIS-14D.2: historial y comparación de calibraciones | Hecho sin cambio de física. El navegador conserva seis sesiones completas como máximo y compara las dos últimas; solo un candidato idéntico repetido abre una corrección de un grupo. 71 pruebas pasan; `airManeuver.cadenceMatches` sigue siendo verdadero. |
| 2026-10-10 | FIS-14D.1: sesión guiada de calibración aérea | Hecho sin cambio de física. Seis maniobras registran actitud, giro, velocidad, altura, saltos y ACK de snapshots autoritativos; el informe fuerza un único grupo candidato o deriva cámara, red y contactos a su subsistema. 68 pruebas pasan; `airManeuver.cadenceMatches` sigue siendo verdadero. |
| 2026-10-10 | REA de Car Soccer y FIS-15A: interpolación de snapshots | Hecho. La inspección estática confirmó un patrón de presentación separado de la física compilada; el proyecto adopta de forma original buffer temporal, slerp quaternion y corte de discontinuidades. 62 pruebas pasan; la sonda aérea mantiene la cadencia. Informe: docs/car-soccer-rea-integration.md. |
| 2026-10-10 | FIS-15B: seriales de acciones discretas | Hecho. Salto, doble salto, dodge y respawn publican seriales monotónicos y el cliente genera un único pulso al observar un incremento. La pulsación mantenida no duplica una acción; 62 pruebas pasan. |
| 2026-10-10 | FIS-15C: instrumentación de ACK de entrada | Hecho sin conciliación. La entrada lleva secuencia, el servidor confirma la última aplicada y CALIBRACIÓN LIMPIA muestra el retorno hasta el snapshot. 65 pruebas pasan; la memoria de muestras queda acotada. |
| 2026-10-10 | FIS-01 a FIS-10B: huella, rampas, paredes, aire, dodge, nitro y combate | Conservado como base y como conjunto de regresión; no representa aún el objetivo de sensación. |
| 2026-10-10 | CAL-01: arena limpia, perfil de práctica y cámara orientada al chasis | Hecho. La comprobación visual automatizada queda bloqueada por la política del navegador integrado; el servidor respondió HTTP 200. |
| 2026-10-10 | CAL-02: probes deterministas de conducción, salto, aire, nitro y ocho dodges | Hecho. Línea base registrada; siguiente defecto priorizado: dodge dirigido. |
| 2026-10-10 | FIS-14A: desacoplar dodge dirigido y mantenimiento del primer salto | Hecho. Un dodge lateral ya no crea un lanzamiento vertical; 43 pruebas pasan. |
| 2026-10-10 | Plan de reconstrucción de movilidad | Hecho. FIS-12A quedó definida como siguiente historia; no se modificó física durante la planificación. |
| 2026-10-10 | FIS-12A: contactos de chasis para los seis planos de CAL-01 | Hecho. Reposo 10 s, cuatro paredes, techo, caja orientada y pasos agrupados verificados; 48 pruebas pasan. `npm run probe` registra las nuevas trazas. |
| 2026-10-10 | FIS-12B: cuatro apoyos de rueda, muelle, amortiguación y snapshot de suspensión | Hecho. Caída, aterrizajes con pitch y roll, reposición de saltos y esquina suelo-pared verificadas; 52 pruebas pasan. `npm run probe` publica la sección `suspension`. |
| 2026-10-10 | FIS-13A: motor, freno, reversa, agarre y dirección por rueda en CAL-01 | Hecho. Aceleración gradual, frenada, reversa, giro, reducción lateral y repetibilidad por pasos agrupados verificadas; 54 pruebas pasan. |
| 2026-10-10 | FIS-13B: powerslide por distribución de agarre y par de freno de mano | Hecho. Deriva, conservación de impulso tras liberar Shift, recuperación de agarre y repetibilidad verificadas; 55 pruebas pasan. |
| 2026-10-10 | FIS-14B: estados temporales de salto, doble salto y dodge | Hecho. Dirección de dodge capturada, expiración de ventana, aterrizaje diagonal y doble salto sin mantenimiento verificados; 56 pruebas pasan. |
| 2026-10-10 | FIS-14C: integración vectorial local de aire y medición de ejes | Hecho para simulación determinista. La composición aérea ya no depende del orden de ejes; W/S, A/D, air roll y nitro inclinado fueron comprobados; 57 pruebas pasan. La calibración de tacto queda en FIS-14D. |
| 2026-10-10 | FIS-14D: traza de vuelo, paquetes de red y HUD de calibración | Instrumentación hecha. La maniobra de 1,5 s cubre inversión de pitch, yaw/roll combinado, liberación, reorientación y nitro; 58 pruebas pasan y `airManeuver.cadenceMatches` es verdadero. La carga visual, el HUD y el primer salto se comprobaron en navegador. El tacto con teclado físico debe decidir el primer ajuste de constantes. |





## FIS-18 — contrato de dodge, aire y dirección alineado con RocketSim (11/10/2026)

Car Soccer terminó de cargar en una pestaña interactiva después de esperar a que terminara “Warming up visual effects”. La prueba manual reprodujo salto, doble salto neutro y segundo salto con W. La diferencia observable relevante es que el segundo salto dirigido compromete el flip, mientras el neutro conserva una pose más nivelada.

La revisión del código público de RocketSim confirmó que el flip usa un impulso lineal inicial en el plano de la arena, un par angular temporal, cancelación de pitch, amortiguación vertical corta y bloqueo de pitch posterior. Se trasladó ese contrato a la implementación propia en `src/simulation.js`:

- umbral agregado de dodge `0.5`;
- impulso horizontal único con escalado de velocidad lateral/trasero;
- `0.65 s` de torque de flip y `0.3 s` de bloqueo de pitch;
- pitch para flips frontales, roll para laterales y ninguna guiñada inventada;
- sin aceleración lineal continua ni elevación vertical añadida por el dodge.

La dirección terrestre usa ahora la curva pública de ángulo por velocidad de
RocketSim, interpolada en `steeringAngleFromSpeed()` y aplicada al solver de
ruedas. En la envolvente CAL-04 el radio medido pasa de `5,925` a 12 unidades/s
a `37,813` a 42 unidades/s; la prueba directa comprueba los puntos publicados y
la regresión física comprueba que el arco se abre a alta velocidad.

La evidencia y los límites están en [`archive/2026-10-12/rocketsim-integration-2026-10-11.md`](archive/2026-10-12/rocketsim-integration-2026-10-11.md). La prueba determinista queda en **93 pass, 0 fail**. No se afirma equivalencia total: suspensión, fricción y contactos todavía usan una implementación JavaScript propia y requieren validación visual comparable.

La misma entrega incorpora el factor público de par de motor y la curva de
ángulo extendido de powerslide. El estado `powerslide` se publica de `0` a `1`
para que una captura autoritativa pueda comprobar la subida y la caída gradual
de Shift. CAL-04 conserva la repetibilidad: agarre `1,017 s`, radio `17,933`;
powerslide `0,442 s`, radio `7,322`, recuperación `0,492 s`.

## VIS-01 — legibilidad de la práctica limpia (12/10/2026)

Implementado sin tocar la simulación: `src/arena-visual-profile.js` selecciona
un tema más claro para `calibration`, `rocketsim-curved-practice` y
`rocketsim-expanded-curved-practice`, con fondo y niebla más visibles, colores
separados para suelo, paredes, techo y curvas, y una rejilla de mayor contraste.
En los perfiles curvos, la pared visual empieza encima del radio de la
quarter-pipe para evitar superposición con la superficie de transición.
El modo `scrapyard` conserva su tema anterior. La prueba pura de selección está
en `tests/arena-visual-profile.test.mjs`; `npm test` pasa `121/121`. La práctica
ampliada arrancó en `http://localhost:5222/`, mostró HUD y cuatro curvas con la
paleta nueva, y la consola no registró errores. La maniobra aérea con entrada
temporizada aún requiere una prueba reproducible separada.

## MOB-01 — campaña ampliada de curva, pared y acciones aéreas (13/10/2026)

Se añadió `tools/rocketsim-expanded-mobility-probe.mjs` y el comando
`npm run probe:rocketsim-expanded-mobility`. La captura
`docs/reference-captures/rocketsim-expanded-mobility-mob-01.json` confirma
RocketSim autoritativo, el perfil `arsenal-expanded-curved-practice`, ACK hasta
21, cadencia de snapshots de `0,01/0,02 s`, curva y pared observadas en las
cuatro fases, y evidencia de salto, dodge, air roll y consumo de boost.

**Estado: aceptada como evidencia.** La primera ejecución dio un falso negativo
porque mantenía nitro hasta pedir el salto. La sonda ahora confirma el ACK de
liberación, espera apoyo estable por debajo de `48 u/s` y ejecuta entonces la
acción. Dos ejecuciones observaron las mismas clases y rangos: curva, pared,
salto que abandona apoyo, dodge dirigido, air roll, consumo de boost y retorno
al suelo. No se tocaron constantes, cámara ni protocolo. Este registro abre
MOB-02 para validar la representación visual de esta misma maniobra; su cierre
aceptado se documenta a continuación.

## MOB-02 — reproducción reproducible para validar cámara (13/10/2026)

Se implementó el módulo puro `src/mob02-browser-playback.js` y su regresión
`tests/mob02-browser-playback.test.mjs`. El modo opt-in `?mob02=1` usa el
contrato de entrada normal del navegador y solicita un único `restart`; después
avanza según snapshots autoritativos por las fases drive→settle→jump→aerial→
recover. No escribe poses, no toca el bridge y no cambia la física.

La prueba aislada pasa 4/4. La carga visual inicial y un salto real ya se
comprobaron en `127.0.0.1:5260` sin errores de consola; queda ejecutar la
maniobra completa con el parámetro para decidir si MOB-02 se acepta o abre una
corrección aislada de cámara.

## MOB-02 — validación de presentación cerrada (13/10/2026)

**Aceptada.** `?mob02=1` completó en navegador la secuencia
`drive→settle→jump→aerial→recover→done` con la práctica RocketSim ampliada. La
consola quedó sin errores; el HUD confirmó estado aéreo, salto consumido y ACK.
La cámara mantuvo horizonte mundial durante la captura aérea y el coche siguió
visible. La etiqueta de la práctica ampliada ya informa de las transiciones
curvas. No se modificó física ni protocolo. `npm test`: **125/125**.

Siguiente unidad: MOB-03, integración jugable de combate de dos pilotos sobre
poses RocketSim.

## MOB-03 — campaña WebSocket de dos pilotos (13/10/2026)

**Estado: aceptada.** `npm run probe:rocketsim-two-pilot` generó
`docs/reference-captures/rocketsim-two-pilot-mob-03.json` y cerró sus dos
servidores temporales. En `arsenal-expanded-curved-practice`, dos pilotos
conservaron IDs/equipos, ACK independientes, poses nativas finitas,
desplazamiento separado y cadencia `0,01/0,02 s`, sin errores.

La fase `combat-lineup` observó contacto nativo con separación mínima `9,44`
frente a `14,6` iniciales, reinicio nativo, dos disparos aceptados, cooldown,
eliminación, desactivación `h=-218,35` y respawn. El contacto queda acotado al
perfil limpio de alineación; no se declara todavía equivalencia de geometría con
la arena ampliada. No se tocó el solver, el bridge ni el protocolo.

## R9-01 — campaña LAN de seis pilotos (13/10/2026)

**Estado: aceptada.** `npm run probe:rocketsim-six-pilot` conectó seis clientes
reales al perfil `arsenal-expanded-curved-practice`. Conservó IDs únicos,
equipos alternos azul/rojo, ACK por cliente, `steer` publicado en el coche del
mismo ID, poses finitas y desplazamientos de `15,26–19,04` unidades. Los
snapshots siguieron en `0,01/0,02 s`, sin errores de runtime. Al cerrar el
sexto socket, el match reconstruyó el bridge con cinco coches, eliminó el ID
salido y aceptó una entrada nueva. La evidencia queda en
`docs/reference-captures/rocketsim-six-pilot-lan-r9-01.json`; `npm test`:
**125/125**.

Esta campaña no valida todavía bots, combate a seis, reconexión ni juego
público. La siguiente unidad autorizada es GAME-01, la sesión de combate
RocketSim configurable.

## GAME-01 — sesión LAN de combate configurable (13/10/2026)

**Estado: aceptada para pilotos humanos.** El backend RocketSim ya no publica
una capacidad fija de seis: acepta capacidad autoritativa `1…6` sin sustituir
el bridge ni alterar coches activos. Rechaza bots, valores inválidos y reducir
el límite por debajo de los pilotos conectados. La prueba cubre además una
ráfaga de altas en el adaptador, pero las campañas reales siguen esperando el
snapshot de roster tras cada alta; admitir ráfagas durante una reconstrucción
nativa es robustez de transporte pendiente.

`npm run probe:rocketsim-combat-session` generó
`docs/reference-captures/rocketsim-configurable-combat-game-01.json`: configuró
capacidad 3, formó equipos azul/rojo/azul, rechazó una cuarta plaza, conservó
el límite tras un intento de reducción inválido y confirmó ACK, movimiento y
cadencia `0,01/0,02 s`. El panel web muestra sesión RocketSim, bloquea bots y
entorno, permite modificar capacidad y el HUD de combate muestra marcador y
objetivo. `npm test`: **127/127**.

Los bots RocketSim quedan aplazados: requerirían controlar entradas nativas y
no se simulan con las poses JavaScript. La siguiente unidad es P6/ARENA-02,
empezando por esquinas curvadas propias en las cuatro transiciones suelo-pared.

## ARENA-02 — esquinas de suelo a pared (13/10/2026)

**Estado: aceptada en física nativa.** El perfil aislado
`arsenal-expanded-cornered-practice` conserva la arena anterior como control y
añade cuatro parches esféricos propios, más paneles verticales finitos para
evitar la colisión solapada de planos infinitos. La primera sonda detectó un
salto de normal de 45° y llevó a esa corrección de geometría. La sonda final
`npm run probe:rocketsim-cornered-arena` repitió cuatro recorridos a 120 Hz:
133 ticks apoyados por coche, entrada inclinada, pared alcanzada, ningún hueco
previo, ninguna normal invertida y salto máximo de 4,474°. Captura:
`docs/reference-captures/rocketsim-cornered-practice-arena-02.json`.

La reproducción en navegador de cámara/HUD en una esquina queda aceptada en
la misma campaña; ARENA-03 promueve ahora el perfil sin ajustar la física del
vehículo.

**Presentación aceptada posteriormente:** la instancia persistente en `5284`
cargó `?mob02=1`, mostró `PRÁCTICA ROCKETSIM · ESQUINAS CURVAS`, confirmó ACK y
recorrió `drive → settle → jump → aerial → recover → done` sin errores de
consola. `recover` termina con `no-wheel-support` cuando el coche queda sobre
la carrocería; el playback lo registra con un límite de 2 s y no modifica la
física ni endereza el coche automáticamente.

## ARENA-03 — perfil cornered predeterminado (13/10/2026)

**Estado: aceptada.** La arena con esquinas curvas ya tenía las puertas nativa
y de navegador cerradas, pero el arranque sin variable seguía usando el perfil
plano. `server.mjs`, `tools/start-rocketsim-practice.mjs` y
`RocketSimPracticeMatch` ahora comparten `ROCKETSIM_DEFAULT_ARENA` y arrancan
con `arsenal-expanded-cornered-practice`. `ROCKETSIM_ARENA=arsenal-practice`
conserva el control plano para regresiones. No se cambió física, protocolo,
geometría ni cámara. La línea base y la regresión posterior son **130/130**.

La siguiente unidad es **VIS-02**: mejorar iluminación, contraste y referencias
espaciales de la arena limpia sin reintroducir obstáculos ni tocar el solver.

## ARENA-04 — continuidad vertical de las esquinas (13/10/2026)

**Estado: aceptada.** El perfil cornered añadía el redondeo suelo-pared solo
h=8; por encima, los paneles dejaban un contraste cuadrado en las esquinas. Se
añadieron cuatro cuartos de cilindro verticales del mismo radio `8` hasta el
techo en RocketSim y Three.js, y se recortaron los paneles para no solaparlos.
La sonda `npm run probe:rocketsim-cornered-arena` observa en los cuatro coches
apoyo de esquina vertical por encima de `h=8` (primera muestra `h=8,812`),
altura máxima `23,98`, cero huecos y salto máximo de normal `3,031°`; su SHA
determinista es `7896d2b8058bbbd520fea47b692c645c81435ce7d92d0964508b85e5f8efb539`.
`npm test` pasa **130/130**. El servidor recompilado se comprobó en el navegador
en `5284` sin errores de consola. No se tocaron constantes de movimiento,
cámara ni perfiles históricos.

## VIS-03.1 — captura autoritativa de cohete (13/10/2026)

**Estado: aceptada para estado de render; píxeles pendientes de entorno.** La timeline
opt-in `?vis03=1` espera dos pilotos y emite un único flanco de fuego para el
piloto rojo. `npm run probe:rocketsim-projectile-visibility` pasó todos sus
criterios: el perfil `combat-lineup` publicó un cohete rojo con pose y
velocidad finitas, ACK correcto, distancia `3,8775` desde el tirador y cero
errores. La evidencia queda en
`docs/reference-captures/rocketsim-projectile-visibility-vis03.json`.

El navegador integrado no pudo alcanzar el servidor temporal ligado a esta
sesión; una instancia externa necesaria para una captura de píxeles fue
rechazada por la revisión automática del entorno. La comprobación visual queda
**No verificada** y no se cambió el combate para compensarlo.

Esta limitación no bloquea la siguiente unidad de presentación: el cohete usa
el mismo estado que ya consume `updateRockets()` y su pose fue publicada en una
sesión real de dos pilotos. VIS-04 sólo podrá ajustar iluminación y contraste
de la arena limpia; la validación visual final del proyectil se repetirá cuando
el navegador pueda alcanzar un servidor externo.

## VIS-04 — iluminación de la práctica limpia (13/10/2026)

**Estado: aceptada por contrato y regresión.** `CLEAN_PRACTICE_PROFILE` controla
ahora luz de hemisferio, sol, lavados de equipo y exposición, y `client.js`
aplica esos valores a las luces ya existentes al cambiar de mundo. La práctica
sube a `2,55/4,1/38/1,2`; `SCRAPYARD_PROFILE` conserva
`2,1/3,45/28/1,1`. No se añadieron mallas, colisiones, física, cámara o red.
`node --check` y `npm test` terminaron en **131/131**. La comprobación de
píxeles queda pendiente por el mismo aislamiento del navegador integrado.

## VIS-03 — observación multijugador de presentación (13/10/2026)

**Estado: parcialmente aceptada; cohete pendiente.** Una instancia temporal de
combate RocketSim en el puerto `5292` conectó dos pestañas al perfil
`arsenal-expanded-cornered-practice`. Ambas mostraron `2/6 PILOTOS`, equipos
azul/rojo, marcador, ACK y estados de red legibles; los colores de coche fueron
distinguibles y las dos consolas quedaron sin errores ni advertencias. La
captura automatizada del disparo no dejó un cohete visible de forma inequívoca,
por lo que no se cierra todavía la lectura de proyectiles. No se modificaron
física, red, cámara ni geometría. La ficha queda en
`_bmad-output/implementation-artifacts/vis-03-multiplayer-presentation-observation.md`.

## MOB-01 — campaña ampliada repetida (13/10/2026)

**Estado: aceptada para autoridad; navegador pendiente por aislamiento.** La
sonda `npm run probe:rocketsim-expanded-mobility` ejecutada en el puerto 5330
con la build R9 y `arsenal-expanded-curved-practice` pasó todos los criterios:
829 snapshots, 25 ACK, deltas `0,01/0,02 s`, curva y pared con apoyo real,
salto desde pared, dodge dirigido, air roll con boost y recuperación a suelo.
La captura queda en
`docs/reference-captures/rocketsim-expanded-mobility-mob-01.json`.

La repetición de `?mob02=1` contra un servidor temporal en 5331 no fue
alcanzable desde el navegador integrado (`ERR_CONNECTION_TIMED_OUT`). Se
conserva el fallo como limitación de observabilidad, no como defecto de
física; no se tocaron constantes, cámara ni protocolo. La ficha BMad está en
`_bmad-output/implementation-artifacts/mob-01-browser-reproduction.md`.

## GAME-02 — combate LAN de seis pilotos (13/10/2026)

**Estado: aceptada para transporte y autoridad; navegador pendiente en
MOB-01V.** `npm run probe:rocketsim-combat-six` conectó seis pilotos humanos a
`arsenal-expanded-curved-practice` en modo combate. Publicó IDs únicos,
equipos alternos, poses nativas finitas, movimiento independiente, ACK por
piloto, seis flancos de disparo y hasta seis cohetes vivos, con cadencia
`0,01/0,02 s` y cero errores. Al desconectar el sexto piloto, el roster nativo
se reconstruyó a cinco coches y una entrada posterior siguió recibiendo ACK.
La captura está en
`docs/reference-captures/rocketsim-combat-six-pilot-game-02.json`.

La puerta 1v1 `npm run probe:rocketsim-combat-websocket` se repitió para
cooldown, impactos, eliminación, desactivación nativa y respawn. `npm test`
cerró en **131/131**. No cambiaron solver, arena, cámara, protocolo ni reglas
de combate. La lectura visual multijugador requiere una instancia accesible al
navegador y sigue fuera de esta aceptación.

## MOB-01V — instancia persistente (13/10/2026)

**Estado: no verificada.** La práctica RocketSim arrancada fuera de la sonda
abrió el puerto 5336; el navegador integrado falló antes de abrir una pestaña
por su propia inicialización local. Se cerró el proceso y no quedó listener.
No hubo navegación ni evidencia de HUD, cámara o consola, por lo que la
incidencia se atribuye a infraestructura de automatización y no a la física.
Ficha: `_bmad-output/implementation-artifacts/mob-01v-persistent-browser-observation.md`.
Tras reiniciar las sesiones de automatización, su operación mínima de inventario
falló antes de devolver una ventana o pestaña. El diagnóstico se mantiene:
ningún cambio de juego, bridge o localhost puede reparar esa fase externa.

## MOB-01V — observación visual cerrada (13/10/2026)

**Estado: aceptada.** Con Codex reiniciado, `http://127.0.0.1:5336/?mob02=1`
cargó en el navegador integrado con RocketSim R9. Se observó la arena de
esquinas curvas, el coche en transición pared-techo y un HUD vivo con estado
`grounded`, `SALTOS 2/2`, actitud, giro y ACK de red. No apareció error de carga.
La pestaña se dejó abierta para reproducción manual. El incidente anterior
queda documentado como fallo temporal de automatización, no de física, bridge o
servidor.

## VIS-05 — lectura de arena para combate (13/10/2026)

**Estado: aceptada.** El perfil limpio
recibe lavados de equipo sutiles en los dos extremos y una guía perimetral de
suelo. La geometría no participa en colisiones ni en el protocolo. La sintaxis
de `client.js` y la regresión completa pasan **131/131**. La instancia
RocketSim en `localhost:5189` confirmó en navegador arena, coche, HUD y ACK
sin errores tras el cambio.

## ARENA-05 — bloque físico aislado (13/10/2026)

**Aceptada en física nativa y contrato de integración.**
`arsenal-expanded-block-practice` mantiene la arena cornered como control y añade
un solo `btBoxShape` estático de 14 × 4 × 18 unidades, centrado en `(0, 2, 0)`.
Three.js replica exactamente esa geometría sólo al seleccionar el perfil.
`npm run probe:rocketsim-block-arena` ejecutó dos campañas iguales y observó
contacto frontal (tick 155, normal `x=-1`), ningún cruce del bloque, paso libre
por el lateral y ticks consecutivos; la captura queda en
`docs/reference-captures/rocketsim-block-practice-arena-05.json`.

La compilación inicial falló por cabeceras de Visual Studio ausentes en el
entorno de PowerShell; al cargar `VsDevCmd.bat`, `main.cpp` compiló. El enlace
de R9 estaba bloqueado por el proceso del usuario, así que se enlazó la copia
`rocketsim_bridge-r10.exe` sin detenerlo. Regresión: `node --check` y
`npm test` **132/132**. La observación visual queda pendiente de reiniciar el
servidor con R10; no se han tocado las constantes de movilidad.

## ARENA-05V — observación web y decisión siguiente (13/10/2026)

**Aceptada visualmente por el usuario.** La instancia R10 en `localhost:5190`
mostró el bloque de ARENA-05. La aceptación une la geometría nativa, la visual y
la sonda, sin abrir una corrección de vuelo ni de cámara.

**Decisión:** la siguiente historia es COMBAT-GEO-01. Antes de ampliar el mapa,
el combate debe consultar las formas estáticas de RocketSim: ahora los cohetes
de `src/rocketsim-combat.js` sólo resuelven víctima o límites de arena. El plan
y criterios están en
`_bmad-output/implementation-artifacts/combat-geo-01-native-static-raycasts.md`.

## COMBAT-GEO-01 — consulta estática nativa (13/10/2026)

**Estado: aceptada.** R11 expone `staticRaycast` en el `ready` del bridge y
responde segmentos públicos RocketSim y-up con impactos estáticos finitos,
normales convertidas y fracción global. La sonda frontal/lateral es determinista
en dos ejecuciones (`a11588fe9e2632afb145a0c6733ab8fc927297922e6096989958a5b0045c19e3`);
la sonda de bloque sigue pasando sin cambiar su SHA. La implementación divide
los rayos largos en celdas para no producir el diagnóstico de `btRSBroadphase`
en stdout, que rompería JSONL. El backend Node ya normaliza la respuesta, pero
la regla de cohete todavía no consulta esta capacidad: eso queda en COMBAT-GEO-02.

## COMBAT-GEO-02 — oclusión de cohetes (13/10/2026)

**Estado: aceptada.** Cada tramo de cohete se consulta contra la geometría
estática nativa y se ordena frente a la primera intersección de vehículo. La
regresión quedó en 135/135. El smoke R8-02 y la campaña GAME-02 de seis pilotos
pasaron con R11, sin cambiar movimiento, cámara ni la autoridad Node para daño.

## ARENA-06 — rampa aislada (13/10/2026)

**Estado: aceptada.** `arsenal-expanded-ramp-practice` comparte una rampa
propia de 20 × 18 × 4,5 unidades Arsenal entre la malla Bullet de RocketSim y
la visual Three.js. R12 observó apoyo inclinado, subida, salida aérea,
aterrizaje y bypass lateral en dos ejecuciones deterministas. La prueba de
combate interceptó el cohete y conservó 100 PV en ambos coches. No se tocaron
constantes de vuelo, salto, dodge ni cámara. El detalle está en la ficha BMad
`_bmad-output/implementation-artifacts/arena-06-isolated-ramp-story.md`.

## MOB-AIR-01 — campaña aérea reproducible (14/10/2026)

**Estado: implementada; no verificada en navegador.** Se añadió
`?mobair01=1`, una máquina de estados del cliente que separa primer salto,
liberación, segundo salto dirigido con W+D, control aéreo con air roll/boost y
recuperación. El informe se basa en `actionSerials` y snapshots de RocketSim;
no duplica ni corrige la física. `npm test` pasa **143/143** y ambos archivos
JavaScript pasan `node --check`. Falta ejecutar la campaña contra la instancia
persistente del usuario; una anomalía deberá clasificarse como adaptador,
transporte, solver o cámara antes de modificar constantes.

## Actualización MOB-AIR-01 — 14/10/2026

La campaña se ajustó para esperar la confirmación autoritativa del primer salto
y mantener la entrada hasta que RocketSim salga del suelo. El informe considera
`doubleJump` o `dodge` como segundo salto dirigido, que es la semántica esperada
cuando se mantiene WASD. La prueba directa contra R13 reprodujo primer salto y
dodge (`tick 1` y `tick 36`). La regresión del proyecto queda en **144/144**.
La sesión visual de `5300` mostró el cliente actualizado, pero después el
runtime respondió `RocketSim practice is closed` durante otro reinicio del
watcher; la aceptación visual sigue pendiente de un arranque limpio.

## Actualización operativa — 14/10/2026

MOB-AIR frontal queda observado en navegador; las variantes laterales y
diagonales requieren una pestaña aislada para no mezclar seriales de respawn
entre pilotos.
