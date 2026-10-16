# Hoja de ruta vigente — Car Soccer: Arsenal

**Fecha:** 16 de octubre de 2026
**Estado:** activa; `BASELINE-01` queda aceptada con la etiqueta Git
`baseline-2026-10-17`; `COMBAT-PLAY-01` está aceptada en pruebas 1v1 y 6v6,
`BRIDGE-01` está aceptada para arranque normal y `LIVENESS-01` tiene la
implementación y las pruebas unitarias aceptadas. `ARENA-CEILING-01` tiene la
geometría nativa y visual implementada y la sonda R19 aceptada; falta verla
en un host web que use esa build. `HITBOX-01` tiene
implementada la alineación visual, pero requiere una observación invertida
aislada para cerrarse. `LAN-HARDEN-01` se implementó como unidad operativa
previa y está aceptada en pruebas unitarias; queda verificarla en el host.
No se cambian constantes de física hasta disponer de una traza reproducible.

## Ruta operativa revisada — 16/10/2026

Esta sección supersede el orden narrativo de las notas históricas inferiores;
esas notas se conservan como registro de decisiones y evidencias anteriores.

### Decisiones de producto y arquitectura

1. Mantener Three.js + Node + RocketSim; no migrar de motor ni reescribir la
   simulación durante este ciclo.
2. Mantener la autoridad partida: RocketSim posee movimiento y contactos; Node
   posee red, combate y ciclo de vida; el cliente solo envía intención y
   presenta snapshots.
3. Priorizar seguridad operativa y reproducibilidad antes de añadir mecánicas:
   una historia pequeña, una evidencia observable y una clasificación explícita
   de aceptado, fallido, aplazado o no verificado.
4. No crear dependencias nuevas ni retocar constantes de física por sensación
   aislada. Toda discrepancia necesita una traza o prueba reproducible.

### Prioridades ejecutables

| Prioridad | Historia | Resultado y criterio de salida |
| --- | --- | --- |
| P0 | `LAN-HARDEN-01` | Allowlist HTTP de assets públicos, traversal e internals en 404; suite verde. Implementada y aceptada en unitarias; falta prueba viva en host. |
| P0 | `BASELINE-01` | **Aceptada 17/10/2026.** Baseline Git etiquetado y hashes de bridge registrados en `docs/provenance-baseline-2026-10-17.json`; no modifica gameplay. |
| P1 | `COMBAT-BOUNDS-01` | Unificar límites de cohete, arena nativa y malla; ningún cohete desaparece dentro del volumen jugable; prueba de regresión de combate. |
| P1 | `LAN-HARDEN-02` | Propietario de sesión para `restart/configure`, timeout de hello, backpressure y origen LAN por host; implementada en código, con `tools/lan-session-probe.mjs` preparada y falta prueba LAN en host. |
| P1 | `HITBOX-01` | Cerrar observación invertida aislada con R19; no cambiar física sin captura. |
| P1 | `ARENA-CEILING-01` | Observar la geometría R19 en host web y cerrar el desfase host/bridge. |
| P1 | `MOB-AIR-02` → `MOB-AIR-03` | Aislar side/diagonal y comparar curvas web/nativas; solo después abordar cámara. |
| P2 | `LIVENESS-01-INTEGRATION` y online | Verificar watchdog en host y, con seis coches estables, abordar UX de combate, matchmaking y despliegue. |

### Puerta de decisión inmediata

La implementación actual es `LAN-HARDEN-02`, continuación operativa de
`COMBAT-BOUNDS-01`; no toca física ni protocolo de combate. La auditoría
reprodujo que `stepRocketSimCombat` elimina un
cohete en x=61,5 aunque el arena expandida usa media anchura 72. El arreglo
debe compartir un manifiesto de arena, no aumentar un límite aislado.

### Riesgos que se mantienen deliberadamente fuera de este ciclo

- predicción cliente, interpolación más sofisticada o migración de motor;
- cuentas, matchmaking, TLS/WSS y despliegue público;
- refactor masivo de `simulation.js`/`client.js` sin una historia de comportamiento;
- retocar fuerzas o cámara sin una captura reproducible.

## Objetivo del producto

Juego web PvP de coches voladores con cohetes, daño, respawn y puntuación. La
referencia de tacto es Rocket League/RocketSim en salto, segundo salto, dodge,
vuelo, air roll, pared y aterrizaje. El juego conserva su propia arena y reglas
de combate. Three.js presenta; Node y RocketSim autoritativo simulan.

## Decisiones que no cambian

1. **Motor:** Three.js + Node siguen siendo suficientes para el prototipo web.
   No se migra a Unity, Unreal o Godot en esta fase.
2. **Autoridad:** RocketSim posee pose, velocidad, orientación, suspensión,
   contactos, saltos y colisiones de vehículos. Node posee red, cohetes, daño,
   cooldown, puntuación y respawn. El cliente no corrige la física.
3. **Método:** una discrepancia necesita traza reproducible, captura de
   navegador o prueba de integración. No se retocan fuerzas, torque o cámara
   por una sensación aislada.
4. **Entorno:** el servidor persistente lo inicia el usuario en PowerShell; el
   sandbox de Codex sirve para código y pruebas aisladas. Son espacios de red
   distintos.
5. **Alcance:** bots, matchmaking, cuentas, TLS/WSS y despliegue público quedan
   después de una sesión LAN estable de seis coches.

## Estado comprobado

| Área | Estado | Evidencia / límite |
| --- | --- | --- |
| Movimiento RocketSim | Aceptado en bridge R13 | 120 Hz nativos, seis coches, curvas/paredes/arena propia. La equivalencia perceptiva con Rocket League sigue siendo una hipótesis de calibración, no una copia de código. |
| Arena pared→techo | Bridge R19 aceptado; web pendiente | `probe:rocketsim-cornered-arena` recorre 720 ticks con apoyo continuo, radio 8, 32 segmentos y variación máxima de normal ~3,12°. La malla Three.js comparte dimensiones; el host 5300 sigue usando R13. |
| Combate | Aceptado en `combat-alpha` | Cohetes, oclusión estática, daño, respawn, puntuación hasta 15. |
| Presentación | Aceptada en host 5300 | Balizas, corredor, bloque/rampa, HUD y ACK visibles. |
| Sesión LAN | Implementada | `hello` versionado, sesión efímera, reconexión de 4 s, heartbeat, límites. La sonda de reconexión debe ejecutarse en el PowerShell host. |
| Bridge al reiniciar | Aceptado para arranque normal | El host del usuario funciona con R13 y timeout configurable de 500 ms. Un fallo transitorio del sidecar se recupera; un reinicio persistente adicional queda como regresión opcional, no como bloqueante. |
| Liveness del cliente | Implementación aceptada; integración pendiente | Watchdog de 8 s basado solo en snapshots autoritativos, con una reconexión idempotente. Falta observarlo en una sesión limpia sin interferir con la partida actual. |

## Orden de trabajo

## Revisión de prioridades de arena, chasis y presentación — 14/10/2026

Las peticiones de arena, coche e interfaz se ordenan por el riesgo que tienen
sobre el tacto y la autoridad:

| Prioridad | Historia | Decisión | Criterio de salida |
| --- | --- | --- | --- |
| P0 | `HITBOX-01` | Alinear el modelo provisional con el pivote nativo; queda una observación invertida aislada. | La transformación está cubierta por pruebas; cerrar solo cuando una maniobra boca abajo confirme la ausencia de penetración visual. |
| P1 | `ARENA-CEILING-01` | Implementada en bridge R19 y Three.js como geometría original compartida: curva inferior y superior, techo central y parches de esquina. | **Bridge aceptado** por la sonda determinista; queda una observación visual con un host que arranque R19. |
| P2 | `ARENA-VIS-01` | Ampliar y aclarar la arena después de que la geometría física esté cerrada. | Contraste, techo, perímetro y esquinas legibles sin modificar colisiones. |
| P3 | `CAR-VIS-01` | Convertir una imagen proporcionada por el usuario en un modelo Three.js mediante `img2threejs`, aislado como piel visual. | El modelo cabe dentro del contrato de volumen renderizado y no cambia RocketSim ni la hitbox. |
| P4 | `HUD-UX-01` | Reducir densidad visual y mejorar jerarquía de HUD/controles. | El estado esencial sigue legible sin tapar conducción, cámara o depuración. |

`HITBOX-01` adelanta temporalmente la observación aérea P0 porque una
penetración observable de chasis rompe una invariante de contacto. La campaña
`MOB-AIR-02-OBS-ISOLATED` se retoma inmediatamente después, sin mezclar sus
resultados con esta corrección de contacto.

### HITBOX-01 — contrato de contacto y volumen visible

**Implementación realizada; observación pendiente.** La autoridad de colisión sigue siendo RocketSim. Primero
se registra una caída/dodge que produzca contacto de carrocería con la parte
inferior del coche hacia arriba y se compara con el límite del modelo Three.js.
Si el contacto nativo es correcto, se corrige solo el envolvente visual; si la
traza nativa muestra penetración, se abre una corrección de bridge con prueba
adversarial. No se sustituye el colisionador nativo por una hitbox del cliente.

### ARENA-CEILING-01 — curva pared-techo y techo visible

**Estado: bridge aceptado; web pendiente.** Aunque la observación aislada de
`HITBOX-01` siga siendo una puerta de prioridad, la implementación de esta
geometría ya está disponible para validación. La transición usa una geometría
original y compartida: paneles de pared finitos, cuartos de cilindro para
suelo→pared y pared→techo, techo central y parches esféricos/verticales en las
esquinas. El perfil `arsenal-expanded-cornered-practice` se verifica con R19:
720 ticks, cuatro coches, apoyo continuo, `minNormalY=-1` y salto máximo de
normal de 3,124 grados. La malla Three.js usa el mismo radio 8, altura 30,
anchura 144, profundidad 108 y 32 segmentos. No se interpolan colisiones solo
en cliente. La representación de paredes, curvas y techo ya se observó en 5300
con transparencia y retícula; esa observación no prueba una colisión nativa.
La aceptación de contacto requiere arrancar una sesión web apuntando a
`rocketsim_bridge-r19.exe`. El lanzador persistente fija R19 y evita que la
malla nueva se sirva contra la física R13.

### P0 — MOB-AIR-02-OBS-ISOLATED: observación aislada de vuelo

**Siguiente unidad mínima.** Ejecutar una sola sesión autoritativa con un piloto
humano y completar front, side y diagonal. Front ya tiene evidencia aceptada;
side y diagonal siguen sin veredicto por interferencia de roster y estados
congelados en sesiones anteriores. La historia solo observa y registra: no
retoca solver, cámara ni adaptador.

Criterios de aceptación: ACK monotónico, estado autoritativo vivo, seriales de
primer salto/segundo salto/dodge presentes en cada variante, recuperación
observable y cero errores de consola/runtime. Si el roster no queda aislado o el
estado se congela, el resultado es **no verificado**, nunca una aceptación.

### P1 — LIVENESS-01-INTEGRATION: confirmar watchdog en host

La implementación y sus cuatro pruebas unitarias están aceptadas. Se verifica
en una sesión limpia que un corte de snapshots dispara como máximo una
reconexión y que un heartbeat por sí solo no oculta un servidor detenido. No
bloquea la física ni requiere reiniciar la partida actual.

### P2 — MOB-AIR-03: comparar trazas antes de calibrar

Cuando P0 esté verde, comparar las curvas de front/side/diagonal con la captura
nativa R13 y el contrato de acciones. Solo una discrepancia reproducible abre una
historia de calibración aislada: eje/adaptador, impulso, rotación o cámara. No se
ajustan varias familias de constantes a la vez.

### P3 — CAMERA-AIR-WALL-01: legibilidad de cámara

Solo si P2 demuestra que la pose es correcta y la cámara sigue siendo brusca,
modificar `camera-follow.js` de forma aislada. La cámara no puede reorientar el
coche ni autoenderezarlo al aterrizar.

### P4 — ARENA-VIS-01: arena grande y legible

Después de cerrar las trazas aéreas: ampliar y aclarar el entorno, conservar las
transiciones suelo-pared y prolongar el redondeo por toda la altura de las
esquinas. Todo cambio visual mantiene las dimensiones físicas y no añade mallas
de colisión sin contrato.

### P5 — COMBAT-UX-REGRESSION

Mantener la regresión 1v1/6v6 aceptada y pulir únicamente lectura de cohetes,
daño, respawn y marcador si una prueba muestra un defecto. No añadir mecánicas ni
bots nuevos durante la calibración aérea.

### P6 — ONLINE-02: despliegue público

TLS/WSS, salas reales, autenticación, observabilidad y carga quedan después de
una sesión LAN estable y de la movilidad aérea cerrada.

## Protocolo de ejecución

Cada unidad debe tener una ficha BMad, Base/Post/Delta, archivos propietarios,
fuera de alcance, criterio de aceptación y relevo. Ejecutar pruebas posteriores
a la última edición. Declarar el estado como `aceptada`, `fallida`, `revertida`,
`aplazada` o `no verificada`; no confundir una prueba no ejecutada con éxito.

### Estado 14/10/2026 — MOB-AIR-01

La implementación y prueba nativa están cerradas; la aceptación visual sigue
pendiente. El guion espera estados RocketSim y cuenta `dodge` como segundo salto
dirigido. No tocar constantes hasta observar una ejecución web con `MOB-AIR` y
los indicadores J/2/D activos.

## Actualización de estabilidad — 14/10/2026

La prueba visual frontal de MOB-AIR-02 queda observada en localhost:5300 con
J/2/D confirmados. El servidor recupera automáticamente hasta tres veces ante
un timeout transitorio del bridge y el cliente espera su coche local tras
welcome antes de pedir restart. La variante side ejecutada junto a otra
pestaña terminó en restart-unconfirmed; queda no verificada por interferencia
de roster, no por un defecto físico. La siguiente ejecución debe usar una sola
pestaña por variante y cerrar MOB-AIR-02 antes de abrir COMBAT-PLAY-01.

## Cierre de iteración MOB-AIR-02 — 14/10/2026

El contrato puro de las variantes front/side/diagonal y la protección contra
roster cruzado quedan implementados. Front se observó con J/2/D; diagonal se
detuvo correctamente al congelarse el ACK y no se acepta; side permanece no
verificada. La campaña ya no puede producir un falso positivo con snapshots
congelados. npm test pasa 149/149. COMBAT-PLAY-01 sigue siendo la siguiente
historia, pero sus sondas WebSocket deben ejecutarse desde el PowerShell del
usuario por la frontera de loopback del sandbox.

## Actualización posterior — 14 de octubre de 2026

La corrección de roster quedó aceptada con `npm test` **150/150**, smoke R13
verde y recarga visual de `localhost:5300` sin errores de consola. La prueba
MOB-AIR en una sola pestaña recorrió `settle`, `first-jump`, `release`,
`directed-second-jump`, `air-control` y `recover`, pero el servidor publicó
`2/6 pilotos` y el ACK no avanzó. Sus seriales J/2/D no se consideran evidencia
porque la sesión compartida conservó otro piloto. El siguiente intento debe
usar un proceso host limpio y una única sesión WebSocket; no se cambian las
constantes aéreas por esta observación.

La siguiente unidad sigue siendo MOB-AIR-01/MOB-AIR-02 visual: confirmar los
seriales con `1/6 pilotos` y ACK creciente. Después se puede cerrar la puerta y
pasar a COMBAT-PLAY-01.

## Reintento tras reinicio del host — 14 de octubre de 2026

Con el proceso `start:watch` reiniciado desde PowerShell, la campaña frontal
volvió a recorrer todas las fases sin errores de consola y el ACK avanzó de
`650` a `1265` con latencia de `5 ms`. El HUD continúa mostrando `2/6 pilotos`
y los seriales J/2/D siguen vacíos, así que la observación todavía no puede
aceptar la movilidad aérea. La evidencia apunta a una segunda sesión activa o
reconectada fuera de la pestaña visible. La próxima prueba debe aislar también
las sesiones del navegador; no se cambia el solver RocketSim.

## Validación nativa posterior — 14 de octubre de 2026

Sin depender del WebSocket del navegador, R13 pasó `probe:rocketsim-free-air-roll`
con 48 muestras y hashes idénticos para air roll libre y roll direccional
(`a98efd755bc87ff0be0e5a7f955b97721b8a555e7be9c4c6e9ce21843e3636d0`). La
captura `capture:rocketsim-curves` completó los 15 escenarios de suelo, salto,
doble salto, dodges y control aéreo con hash
`be8b802134bc8e5786cad577f86fd810ace78eb3199837dc5dc7223fe6663a73`. No se
modifican constantes: la integración WebSocket es la única evidencia pendiente.

## Aislamiento de campaña MOB-AIR — 14 de octubre de 2026

La campaña opt-in ahora exige `settings.humans === 1` antes de enviar
`restart` o inputs de vuelo. Si otro piloto entra durante la campaña, termina
con `R session-not-isolated` y no altera la sesión compartida. La prueba
`MOB-AIR-01 waits for one pilot...` cubre la espera y la prueba de entrada
mid-campaign cubre la cancelación segura. `npm test` pasa **153/153**.

La instancia del host con `2/6 pilotos` mostró `MOB-AIR awaiting-solo-player`
tras recarga; esto confirma que el guard funciona. La observación física sigue
pendiente hasta aislar la segunda sesión.

## Cobertura nativa COMBAT-PLAY-01 — 14 de octubre de 2026

La verificación aislada de R13 confirma el bloque de combate antes de la
prueba WebSocket: `probe:rocketsim-combat-state` pasó ready de dos coches,
desactivación, respawn nativo y tick posterior; `probe:rocketsim-combat-alpha-geometry`
conservó el SHA `da62d6431aebbb53e63ebb7145c30c5336b1c0f6ee9e58608b1eb629a33fb8a1`
y confirmó seis spawns, bloque/rampa y dos impactos estáticos; el raycast
estático independiente también pasó. No se modifican reglas ni física.

La campaña WebSocket de dos/seis pilotos queda como la siguiente comprobación
host-only. No se ejecuta desde el sandbox porque no comparte loopback con el
PowerShell del usuario.

## Revalidación local de la suite — 14 de octubre de 2026

Tras la corrección de roster y los guards de campaña, `npm test` vuelve a
pasar **153/153** y `git diff --check` no encuentra errores de formato. Esto
valida los contratos de simulación, bridge, combate, cámara y reproductores
MOB/VIS; no sustituye las dos sondas WebSocket host-only pendientes.

## Resultado de sondas WebSocket — 14 de octubre de 2026

La sonda `probe:rocketsim-combat-six` terminó aceptada con `combat-alpha`:
los seis pilotos se movieron, las seis aristas de disparo fueron reconocidas,
se observó la desconexión con reconstrucción de roster y no hubo errores.

La primera ejecución de `probe:rocketsim-combat-websocket` terminó fallida en
`primer impacto` porque se configuró por error `combat-alpha`. Ese perfil
separa los dos primeros spawns en esquinas diagonales y no garantiza una línea
de fuego directa. R8-02 usa `combat-lineup`, que coloca ambos coches frente a
frente; no se modifica el solver ni se clasifica como defecto de combate.

La sonda R8-02 ahora rechaza explícitamente cualquier perfil que no sea
`combat-lineup` antes de crear el servidor. Así una configuración accidental
produce un diagnóstico inmediato en lugar de un timeout de impacto ambiguo.
La suite posterior sigue en **153/153**.

## Cierre WebSocket de COMBAT-PLAY-01 — 14 de octubre de 2026

La ejecución host de R8-02 con `combat-lineup` queda **aceptada**. El informe
`docs/reference-captures/rocketsim-combat-websocket-r8-02.json` confirma los
dos pilotos y sus poses nativas, ACK hasta la secuencia 6, dos aristas de
disparo aceptadas, rechazo del disparo en cooldown, daño 65, eliminación,
desactivación nativa a `h=-218,35`, respawn con salud 100 y cadencia de
snapshots `0,01/0,02 s`, sin errores. Junto al informe 6v6 en `combat-alpha`,
COMBAT-PLAY-01 queda aceptada para la capa autoritativa WebSocket.

La comprobación restante antes de abrir MOB-AIR-01 es BRIDGE-01: confirmar un
reinicio persistente de `start:watch` en el PowerShell anfitrión. No se cambian
fuerzas, torque ni reglas a raíz de estas pruebas.

## Observación tras reinicio del host — 14 de octubre de 2026

Tras reiniciar `start:watch` con R13 y recargar la pestaña persistente,
`localhost:5300` responde sin errores de consola y publica ACK creciente, pero
el roster continúa en `2/6 pilotos`. La guarda MOB-AIR permanece en
`awaiting-solo-player` y no envía acciones. La puerta visual sigue
**no verificada**: la evidencia indica una segunda sesión WebSocket activa
fuera de la pestaña observada, no un defecto del solver.

La ejecución frontal posterior se aisló finalmente en `1/6 pilotos` y terminó
`MOB-AIR done · front · J sí · 2 sí · D sí · R wheel-support`, con ACK creciente
y latencia observada de 4 ms. La variante `side` quedó **no verificada**:
después de cambiar la URL el snapshot se congeló en ACK 2441 y la campaña
terminó `actions-missing`. La guarda impide convertir esa ejecución en una
afirmación sobre el dodge lateral.

## LIVENESS-01 — stream autoritativo detenido — 14 de octubre de 2026

La observación lateral reprodujo un socket abierto con ACK congelado, por lo
que se añadió `src/lan-client-liveness.js`. El cliente mide exclusivamente
frames `state`: si no recibe uno durante 8 s, cierra el WebSocket y usa la
reconexión existente. Los heartbeats no refrescan ese reloj, ya que solo
prueban transporte y no autoridad de simulación. Las conexiones antiguas ya no
pueden limpiar timers ni reiniciar la cámara de una conexión más reciente.

`tests/lan-client-liveness.test.mjs` cubre vencimiento, idempotencia, reset y
valores inválidos; `npm test` pasa **157/157**. La observación integrada queda
**no verificada**: el host que sirvió el cliente no volvió a publicar estados
durante la ventana de prueba, así que no se declara que el watchdog recupere
un bridge detenido. No cambia física ni protocolo de estado.

La comprobación posterior en la URL normal tampoco reconoció una pulsación de
avance: el HUD conservó ACK 2643, velocidad 0 y actitud inicial. Esto confirma
que el bloqueo actual es la publicación host de snapshots, no la campaña
MOB-AIR ni el adaptador de entrada. La siguiente evidencia necesaria es el
stderr del proceso `start:watch` durante ese estado.

## Confirmación posterior del host — 14 de octubre de 2026

El usuario confirmó que la partida vuelve a funcionar con normalidad después
del reinicio. La pestaña integrada volvió a ver `2/6 pilotos`, lo que indica
que la otra plaza pertenece a una sesión de juego activa del usuario. No se
ejecuta MOB-AIR lateral mientras esa partida está en curso: la campaña exige
un único piloto y reinicia la ronda. BRIDGE-01 queda aceptada para el arranque
normal; LIVENESS-01 conserva la comprobación integrada de un stream detenido
como pendiente, sin bloquear el juego normal.
