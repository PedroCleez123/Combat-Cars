# Hoja de ruta activa — movilidad RocketSim a juego LAN

Actualizada: 13 de octubre de 2026  
Estado: **canónica para ordenar el trabajo a partir de ARENA-04 y VIS-02**.

## Objetivo

Entregar un juego web de combate 3v3 con coches ágiles, cohetes, daño y
respawns. La prioridad que desbloquea el resto es que el salto, doble salto,
dodge, vuelo, nitro, pared y aterrizaje se sientan coherentes y predecibles con
la referencia de RocketSim. El juego sigue teniendo identidad propia: arena y
combate de Arsenal, sin recursos ni código de Rocket League o Car Soccer.

## Estado confirmado

| Área | Hecho aceptado | Límite actual |
| --- | --- | --- |
| Física | El bridge R9 ejecuta RocketSim a 120 Hz con entradas y snapshots autoritativos y multicar. | El modo de usuario sigue siendo una práctica limpia opt-in; todavía no está cerrado como sesión LAN 3v3. |
| Acciones aéreas | Contratos de salto, segundo salto, dodge, air roll y boost tienen trazas y pruebas; MOB-01 ya conecta curva, pared y acciones por WebSocket en dos ejecuciones. | Falta validar la misma maniobra en navegador y cámara; no se cambian constantes por esta evidencia. |
| Arena | `arsenal-expanded-cornered-practice` es el perfil RocketSim predeterminado y conserva 144×108×30, cuatro transiciones suelo-pared y esquinas redondeadas hasta el techo con evidencia determinista. | Las transiciones pared-techo no forman parte del contrato físico; `arsenal-practice` queda como control explícito. |
| Presentación | VIS-02 añadió referencias espaciales; VIS-03 observó dos pestañas RocketSim sin errores y la sonda autoritativa publicó un cohete en vuelo. | Falta una captura de píxeles del cohete en navegador, limitada por el entorno de pruebas; no bloquea el siguiente ajuste visual. |
| Combate | R8-02 comprobó cohetes, daño, eliminación y respawn alrededor de poses RocketSim. | Debe validarse con seis coches, entradas simultáneas y una arena apta para todo el campo. |
| Red | WebSocket, ACK y snapshots sirven localhost/LAN. | No hay salas, identidad, TLS público, reconexión ni límites para Internet. |

`npm test` tiene como línea base **131/131**. Las capturas y hashes son
evidencia de comportamiento, no una afirmación de equivalencia total con otro
juego.

## Decisiones vigentes

1. **Se mantiene Three.js + Node.** El navegador renderiza y el servidor sigue
   siendo autoritativo. No se migra a Unity, Unreal o Godot durante este hito.
2. **RocketSim es la ruta de fidelidad de movimiento.** El sidecar nativo se
   usa solo en el servidor y conserva el solver JavaScript como fallback de
   desarrollo hasta aprobar cada puerta de integración.
3. **Una discrepancia debe ser reproducible antes de tocar física.** No se
   reajustan impulso, torque, suspensión, cámara o límites por sensación
   aislada. Cada corrección se abre por una única causa: acción, contacto,
   presentación o transporte.
4. **La arena limpia es el banco de pruebas.** Obstáculos, rampas, bots y
   decoración no vuelven a las pruebas de movimiento hasta que las transiciones
   básicas estén cerradas.
5. **El multijugador público queda aplazado.** Primero se prueba una partida
   LAN completa y estable; después se diseña salas, seguridad y despliegue.

## Orden de ejecución

### P0 — Consolidación de fuentes

**Estado: hecho con esta hoja.** Este archivo decide el orden. El tracker
registra evidencia; `rocketsim-migration-roadmap.md` conserva la arquitectura
del bridge; los planes de movilidad anteriores son contexto histórico.

**Regla:** no se crea una historia nueva sin enlazarla aquí, su ficha BMad y el
tracker. Si dos documentos proponen órdenes diferentes, prevalece este.

### P1 — MOB-01: campaña reproducible de movilidad ampliada

**Por qué va primero:** hoy hay pruebas de piezas aisladas y de cada pared, pero
no una misma campaña que conecte curva, pared, despegue, acción aérea y retorno
al suelo con la arena que se pretende jugar.

**Historia mínima:** parametrizar los runners WebSocket ya existentes y añadir
solo la captura que falte para `arsenal-expanded-curved-practice`. Ejecutará
cuatro escenarios autoritativos:

1. suelo → curva → pared con boost;
2. apoyo de pared → salto → dodge dirigido;
3. air roll y boost tras abandonar la pared;
4. retorno a suelo y recuperación de dos saltos.

**Criterios de aceptación:** el solver mantiene 120 Hz y los snapshots llegan
a 60 Hz; por ello se comparan eventos y rangos con tolerancia de un snapshot,
no hashes de red bit a bit. Cada fase captura secuencia/ACK, tiempo
autoritativo, superficie, ruedas, pose, velocidad, velocidad angular, boost y
seriales. Cada acción aparece una vez; no hay pérdida de apoyo no explicada en
la curva; la vuelta a suelo recupera control solo al recibir apoyo real. Las
repeticiones conservan las mismas clases de eventos y rangos. `npm test` sigue
verde y no se requiere mantener teclas humanas en el canvas.

**Decisión al cerrar:**

- campaña verde → no se cambian constantes; se pasa a P2;
- fallo de apoyo o penetración → se abre una corrección de contacto nativo;
- evento/entrada incorrectos → se corrige el adaptador/protocolo;
- física verde y cámara molesta → se abre una historia de presentación, nunca
  una corrección de física.

### P2 — MOB-02: cámara y presentación de la misma maniobra

**Dependencia:** P1 aceptada. No ajusta la cámara hasta tener una maniobra
estable que permita distinguirla de la física.

**Historia mínima:** reproducir las fases de P1 contra una instancia aislada y
capturar HUD, cámara y consola para suelo, pared, air roll, dodge y aterrizaje.
La automatización usa `?mob02=1` y el módulo puro
`src/mob02-browser-playback.js`, que inyecta entradas a través del contrato
normal del juego y no depende de mantener teclas con un foco frágil del canvas.

**Criterios de aceptación:** horizonte estable durante air roll; objetivo y
posición de cámara continuos al entrar/salir de pared; no clipa fuera del techo
ni oculta el coche; el HUD y la pose autoritativa concuerdan. Una captura de
navegador valida presentación; las trazas validan física.

**Decisión al cerrar:** un problema exclusivo de cámara abre una corrección en
`camera-follow.js`. Si la cámara es legible pero el movimiento parece extraño,
se remite al escenario exacto de P1, sin mezclar ambos subsistemas.

**Estado:** aceptada el 13/10/2026. El reproductor y sus cuatro pruebas se
ejecutaron contra la práctica RocketSim ampliada en navegador mediante
`?mob02=1`: completó sus fases, conservó HUD/ACK y no produjo errores de
consola. La observación confirmó horizonte estable durante air roll y ausencia
de clipping visible en esa campaña. La captura de presentación no sustituye las
trazas físicas de P1.

### P3 — MOB-03: puerta de combate de dos pilotos

**Dependencias:** P1 y P2 aceptadas.

**Historia mínima:** conectar dos clientes reales contra una arena limpia y
recorrer movimiento, choque, cohete, cooldown, daño, eliminación y respawn.
Node aplica únicamente reglas de combate; nunca escribe una pose que pertenece
al solver nativo.

**Criterios de aceptación:** cada acción y daño se atribuyen al ID correcto;
la colisión no duplica eventos; la pose nativa continúa tras impacto, muerte y
respawn; no se pierden ACK ni se producen errores de cliente. Un defecto se
clasifica como entrada/ejes, snapshot, cámara, geometría o solver antes de
abrir una corrección.

**Decisión al cerrar:** una campaña verde habilita la escala a seis plazas. Si
el movimiento está correcto y solo falla una regla de combate, se corrige
`rocketsim-combat` sin tocar el bridge de movimiento.

**Estado:** aceptada el 13/10/2026. `npm run probe:rocketsim-two-pilot` cubre
dos pilotos reales, ACK e inputs independientes en la arena ampliada, y separa
la comprobación de contacto/combate en `combat-lineup`. La captura es
`docs/reference-captures/rocketsim-two-pilot-mob-03.json`; todas las aserciones
pasaron sin errores. El contacto queda documentado como evidencia del perfil
limpio de alineación, no como contrato de la geometría ampliada.

### P4 — R9-01: seis coches en LAN limpia

**Dependencias:** P3 aceptada.

**Historia mínima:** una sonda WebSocket conecta seis pilotos al bridge R9,
mezcla entradas independientes, altas y bajas, y verifica roster, equipos,
IDs, ACK, snapshots y limpieza de procesos.

**Criterios de aceptación:** seis IDs estables; cada input afecta solo a su
coche; no aparece coche fantasma ni colisión duplicada; el servidor mantiene
la cadencia acordada; una desconexión recompone el roster sin romper la
autoridad; `npm test` y los probes del bridge siguen verdes.

**Decisión al cerrar:** si la carga y coherencia son correctas, RocketSim pasa
a ser un backend LAN soportado para combate de desarrollo. Si falla, se corrige
el bridge/roster antes de añadir bots, armas o decoración.

**Estado:** aceptada el 13/10/2026. `npm run probe:rocketsim-six-pilot` conectó
seis pilotos WebSocket a `arsenal-expanded-curved-practice`, comprobó IDs
únicos, equipos azul/rojo alternos, ACK y dirección por ID, poses finitas,
movimiento de los seis y cadencia `0,01/0,02 s`. Al salir el sexto, el bridge
reconstruyó cinco coches y una entrada posterior siguió recibiendo ACK. La
captura es `docs/reference-captures/rocketsim-six-pilot-lan-r9-01.json`; no
hubo errores de runtime. `npm test` terminó en **125/125**.

### P5 — GAME-01: sesión de combate RocketSim configurable

**Dependencia:** R9-01 aceptada.

**Historia mínima:** exponer de forma explícita una sesión LAN de combate
RocketSim con capacidad humana configurable, cohetes, daño, respawn y
puntuación ya existentes. La configuración conserva la misma autoridad que
R8-02 y no introduce predicción del cliente. Los bots quedan fuera hasta que
exista un controlador de entrada nativo comprobable.

**Criterios de aceptación:** una sesión LAN humana de una a seis plazas se
configura desde el navegador; el límite nunca expulsa a un piloto conectado;
daño, cooldown, eliminación, respawn y resultado conservan las poses nativas;
reiniciar no deja sidecars huérfanos. Los bots no se anuncian como disponibles.

**Decisión al cerrar:** se habilita esta ruta como modo de juego de desarrollo.
El backend JavaScript se conserva como fallback hasta una prueba de regresión
de combate y movilidad equivalente.

**Estado:** aceptada el 13/10/2026 para sesiones humanas. El match RocketSim
acepta capacidad `1…6`, publicada en `settings.vehicleLimit`, sin reiniciar el
bridge ni alterar el roster activo. Rechaza bots, números inválidos y reducir
la capacidad por debajo de los pilotos presentes. El panel identifica la
sesión RocketSim, desactiva entorno/bots y muestra el marcador en combate. La
campaña `npm run probe:rocketsim-combat-session` verificó capacidad 3, tres
pilotos, cuarta plaza rechazada, ACK y movimiento posterior, con cadencia
`0,01/0,02 s`. Captura:
`docs/reference-captures/rocketsim-configurable-combat-game-01.json`.
`npm test`: **127/127**.

### P6 — ARENA-02 y presentación de la partida

**Dependencia:** GAME-01 aceptada.

**Historia mínima:** cerrar primero las esquinas y, si la campaña demuestra que
es necesario, las transiciones pared-techo en la colisión nativa y Three.js.
Después diseñar una arena original completa con iluminación, referencias
espaciales, spawns y zonas de combate. Obstáculos y rampas regresan uno por uno,
cada uno con colisión nativa, visual y prueba de interacción de coche/cohete.

**Criterios de aceptación:** el mapa es legible a velocidad, conserva los
límites físicos y no perjudica las maniobras de P1. No se introducen modelos o
texturas externos sin una historia de activos y procedencia.

**Estado:** las esquinas suelo-pared quedan aceptadas y son el perfil
predeterminado de RocketSim
`arsenal-expanded-cornered-practice`. La malla nativa y la visual comparten un
parche esférico de radio 8 con 32×16 segmentos; los paneles de pared son finitos
para no solaparlo. `npm run probe:rocketsim-cornered-arena` registra cuatro
recorridos deterministas a 120 Hz, sin hueco antes de pared ni normales
invertidas, con salto consecutivo máximo de **4,474°**. La captura está en
`docs/reference-captures/rocketsim-cornered-practice-arena-02.json`. La
reproducción de navegador de la esquina también queda aceptada; el perfil se
promovió como predeterminado en ARENA-03.

La observación web queda aceptada: la instancia persistente en `5284` cargó el
perfil y mostró `ESQUINAS CURVAS`; `?mob02=1` recorrió
`drive → settle → jump → aerial → recover → done` sin errores de consola.
La campaña registra explícitamente `no-wheel-support` si el coche queda sobre
la carrocería, porque RocketSim no auto-endereza vehículos. La regresión pura
de cámara cubre suelo → esquina → pared y la línea base queda en **130/130**.
Además, `npm run probe:rocketsim-cornered-camera` reproduce 180 muestras de
RocketSim a 60 Hz, recorre ground/wall/air y mantiene un cambio máximo de
0,0467 rad/frame dentro del límite de cámara.

### P7 — VIS-02: presentación de la arena limpia

**Dependencia:** ARENA-04 aceptada y perfil cornered promovido.

La siguiente unidad visual debe trabajar solo con la arena limpia ya validada:
mejorar iluminación, contraste, referencias espaciales y lectura a velocidad
sin cambiar geometría nativa, física, armas, obstáculos ni activos externos.
La historia se abrirá con una ficha BMad propia y una captura de navegador
antes/después; cualquier cambio de cámara seguirá separado de la simulación.

**Estado:** aceptada el 13/10/2026. VIS-02 añade referencias espaciales
originales no físicas: línea central, anillo, bandas de orientación y guías
verticales sobre las cuatro esquinas. La comprobación de navegador no registró
errores ni advertencias; `npm test` conserva **130/130**. La siguiente unidad
de presentación debe medir contraste de coche, cohete y marcador en una
partida de varios pilotos antes de introducir decoración o geometría nueva.

### P8 — Online público

**Dependencia:** GAME-01 y una prueba LAN repetible con seis coches.

Aplicar la ruta ya descrita en `web-online-compatibility.md`: TLS/WSS, salas,
identidad, límites de frame, allowlist de origen, rate limiting, heartbeat,
reconexión y observabilidad. Es un proyecto de servidor separado; no se mezcla
con un ajuste de vehículo.

## ONLINE-01 — guardas LAN implementadas (14/10/2026)

La envoltura local de sesión está implementada: `hello` requiere versión 1,
`roomId` y `sessionId`; una desconexión conserva la plaza cuatro segundos y
una reconexión válida recupera el mismo ID; el cliente envía heartbeat; el
parser limita frames a 8192 bytes y exige máscara; el origen local se permite
por defecto y `LAN_ALLOWED_ORIGINS` admite una lista exacta. El servidor limita
inputs a 180 por segundo por sesión. La validación pura y visual del cliente
está hecha; falta una ejecución del probe de reconexión en el host, ya que el
sandbox no puede abrir sockets loopback hacia sus propios procesos. Esto no
habilita Internet: TLS, autenticación, salas múltiples, observabilidad y
despliegue siguen fuera.

## Protocolo de decisión por historia

Antes de modificar código, cada historia añade una ficha BMad con: problema
observable, hipótesis única, archivos afectados, criterios, línea base y fuera
de alcance. Al cerrar registra Base/Post/Delta en el tracker:

| Resultado | Acción |
| --- | --- |
| Prueba y observación coinciden | Aceptar y abrir la dependencia siguiente. |
| Falla una prueba existente | Revertir o corregir el delta; no avanzar. |
| La traza es verde y el problema es visual | Trabajar solo cámara/presentación. |
| La traza no identifica causa | Instrumentar, no ajustar constantes. |
| Un requisito necesita Internet, cuentas o despliegue | Aplazar a P7 con preflight de seguridad y coste. |

## MOB-01 — campaña ampliada de movilidad (13/10/2026)

**Estado:** aceptada para la autoridad RocketSim; observación visual pendiente
por aislamiento del navegador integrado. `npm run probe:rocketsim-expanded-mobility`
repitió cuatro fases en `arsenal-expanded-curved-practice`: curva y pared con
apoyo, salto desde pared, dodge dirigido, air roll con boost y recuperación a
suelo. La ejecución tuvo 829 snapshots, 25 ACK y cadencia media `0,0166788 s`
con deltas `0,01/0,02 s`; no hubo aserciones fallidas. La captura queda en
`docs/reference-captures/rocketsim-expanded-mobility-mob-01.json` y el contrato
en `_bmad-output/implementation-artifacts/mob-01-browser-reproduction.md`.

La tentativa de `?mob02=1` contra un servidor temporal en `5331` expiró con
`ERR_CONNECTION_TIMED_OUT`; la instancia del navegador no puede alcanzar ese
puerto de la sesión de terminal. No se cambian constantes ni cámara por esta
limitación. La próxima unidad es una reproducción visual en una instancia
persistente accesible; después se vuelve a la puerta de combate, no se añade
decoración ni bots.

## Plan de ruta vigente — 13/10/2026

El plan operativo de la siguiente fase está en
[`_bmad-output/implementation-artifacts/roadmap-next-phase-2026-10-13.md`](../_bmad-output/implementation-artifacts/roadmap-next-phase-2026-10-13.md).
Ese artefacto prevalece sobre todas las secciones históricas anteriores. Tras cerrar MOB-01V, GAME-02, VIS-05 y ARENA-05, la siguiente unidad es **COMBAT-GEO-01**: consulta nativa de geometría estática para cohetes. No se abre una rampa ni se retocan constantes de movilidad antes de esa puerta. Se conserva el historial para trazabilidad.

## Registro histórico de unidades anteriores

**VIS-03** ha observado la lectura multijugador de coches, equipos, marcador y
HUD en dos pestañas sin errores; `probe:rocketsim-projectile-visibility` también
confirmó un cohete vivo en un snapshot autoritativo. La captura de píxeles queda
pendiente por el aislamiento del navegador integrado y no bloquea el producto:
**VIS-04** ya elevó la iluminación ambiental, solar y de equipos en la práctica
limpia sin afectar al desguace ni a la simulación. La unidad ya fue cerrada como MOB-01V; esta descripción se conserva como registro histórico.

## GAME-02 — campaña LAN de combate RocketSim (13/10/2026)

**Estado:** aceptada para la integración autoritativa; la observación de
navegador sigue siendo dependencia separada de MOB-01V. La nueva sonda
`npm run probe:rocketsim-combat-six` conectó seis pilotos humanos a
`arsenal-expanded-curved-practice` en combate: IDs únicos, equipos alternos,
poses nativas finitas, movimiento independiente, ACK, seis flancos de disparo,
hasta seis cohetes vivos, cadencia `0,01/0,02 s` y cero errores. Al desconectar
un sexto piloto, el bridge reconstruyó cinco coches y una entrada posterior
del piloto restante recibió ACK. La evidencia queda en
`docs/reference-captures/rocketsim-combat-six-pilot-game-02.json`.

La sonda 1v1 `npm run probe:rocketsim-combat-websocket` se repitió para cubrir
la parte que seis spawns no fuerzan de modo determinista: cooldown, impactos,
eliminación, desactivación física y respawn. Ambas campañas y `npm test`
terminaron verdes, con **131/131** pruebas. No se modificó el solver, la
cámara, la arena ni el protocolo.

La próxima unidad ejecutable sigue siendo **MOB-01V**, para cerrar una
observación persistente en navegador. Si esa infraestructura permanece
aislada, GAME-03 solo se abre por un defecto reproducible de las trazas
existentes; no por falta de captura de píxeles.

## MOB-01V — intento de observación persistente (13/10/2026)

**Estado: no verificada por infraestructura de automatización.** Una práctica
RocketSim persistente alcanzó el estado de escucha en `0.0.0.0:5336`, con la
build R9 y el perfil cornered. El navegador integrado falló al inicializarse
antes de abrir la pestaña, por lo que no existe captura ni error atribuible al
cliente o al servidor. El proceso temporal se cerró. La ficha es
`_bmad-output/implementation-artifacts/mob-01v-persistent-browser-observation.md`.

El siguiente trabajo no cambia: reintentar MOB-01V cuando el navegador esté
operativo. GAME-02 ya dejó la integración LAN autoritativa cubierta; GAME-03
solo se abre si aparece una discrepancia reproducible.

## MOB-01V — observación visual cerrada (13/10/2026)

**Estado: aceptada.** Tras reiniciar Codex, la instancia persistente RocketSim
en `http://127.0.0.1:5336/?mob02=1` cargó en el navegador integrado. La arena
mostró `ESQUINAS CURVAS · SUELO · PAREDES · TECHO`, el coche quedó visible en
la transición curva y el HUD publicó estado grounded, 2/2 saltos, actitud,
giro y ACK de red sin errores. La pestaña quedó abierta como reproducción
manual. El bloqueo anterior pertenecía a la automatización de Codex y no al
juego. MOB-01V queda cerrada; la siguiente unidad vuelve a ser GAME-03 solo
si aparece un defecto reproducible, y después ARENA-05/VIS-05.

## VIS-05 — lectura de arena para combate (13/10/2026)

**Estado: aceptada.** La arena
limpia añade dos lavados de extremo de baja opacidad y una guía perimetral para
leer dirección y escala durante el combate. Son geometría de presentación sin
colisión, estado, cámara, protocolo ni cambios de solver. `node --check` y
`npm test` pasan con **131/131**. La instancia RocketSim mantenida por el
usuario en `localhost:5189` confirmó los acentos, coche, HUD y ACK en navegador
sin error. La siguiente unidad es ARENA-05: un único recurso físico aislado,
con su colisión nativa, visual compartido y una prueba propia.

## ARENA-05 — bloque físico aislado (13/10/2026)

**Estado: aceptada en contrato nativo y regresión.** El perfil opt-in
`arsenal-expanded-block-practice` conserva la arena cornered y añade un único
`btBoxShape` estático de 14 × 4 × 18 unidades en `(0, 2, 0)`. Three.js usa las
mismas dimensiones y centro; no cambia solver, cámara, red ni la arena cornered
predeterminada. `npm run probe:rocketsim-block-arena` pasó dos ejecuciones
deterministas: contacto frontal en tick 155 con normal `(-1, 0, 0)`, `maxX=-8,506`,
paso lateral hasta `maxX=71,768` y ticks consecutivos. La evidencia está en
`docs/reference-captures/rocketsim-block-practice-arena-05.json`.

La build R9 no pudo sobrescribirse porque la instancia del usuario la mantenía
abierta; el código se compiló y se enlazó en la copia aislada
`.rocketsim-bridge-build-r9/rocketsim_bridge-r10.exe`. `node --check` y
`npm test` pasan con **132/132**. Falta únicamente la comprobación visual del
perfil opt-in cuando el usuario reinicie su servidor con la build R10; no se
declara todavía una mejora de jugabilidad por este bloque.

## ARENA-05V — observación de navegador (13/10/2026)

**Estado: aceptada como observación visual.** El usuario arrancó la copia R10 en
`http://localhost:5190/` y comprobó el perfil
`arsenal-expanded-block-practice`. Esta evidencia cierra la comprobación visual
pendiente de ARENA-05: el bloque no queda sólo validado en Bullet y en la sonda,
sino que también es visible en la práctica web. No se infiere de ello ningún
cambio de movilidad, cámara o reglas de combate.

## Plan vigente post ARENA-05

La fuente canónica pasó a
[`roadmap-next-phase-2026-10-13.md`](../_bmad-output/implementation-artifacts/roadmap-next-phase-2026-10-13.md).
El siguiente trabajo es **COMBAT-GEO-01**, una consulta nativa de geometría
estática para cohetes. `src/rocketsim-combat.js` sólo comprueba coches y límites,
por lo que una rampa, cobertura o composición de combate previa permitiría
cohetes atravesando recursos. COMBAT-GEO-01 debe resolver ese contrato antes de
ARENA-06; no se retocan las constantes de movimiento.


## COMBAT-GEO-01 cerrada — 13 de octubre de 2026

La consulta nativa de geometría estática queda aceptada. El bridge R11 declara
`features.staticRaycast`, recibe segmentos en coordenadas públicas RocketSim
y-up, convierte internamente a Bullet y excluye coches dinámicos. Para evitar
el aviso y la ruta lenta del broadphase en rayos largos, divide cada segmento
en celdas menores antes de conservar el primer impacto global. La sonda
`npm run probe:rocketsim-static-raycast` repitió dos veces el resultado:
segmento frontal con fracción `0,420139`, punto `x=-287,5`, normal `x=-1`, y
segmento lateral sin impacto. Captura:
`docs/reference-captures/rocketsim-static-raycast-combat-geo-01.json`.

La regresión JavaScript queda en **133/133** y
`npm run probe:rocketsim-block-arena` conserva su SHA de ARENA-05 con R11.
El enlace CMake del nombre original sigue bloqueado por la instancia existente;
R11 se enlazó como copia independiente después de compilar `main.cpp` con
`VsDevCmd.bat`. No se modificó el solver, la cámara, la red WebSocket ni el
daño. Siguiente unidad: COMBAT-GEO-02, integrar esta consulta en la trayectoria
de cohetes sin duplicar autoridad.

## COMBAT-GEO-02 cerrada — 13 de octubre de 2026

La trayectoria de cohete ya consulta el mundo estático nativo antes de resolver
el impacto en Node. En cada subpaso de 120 Hz se convierte el tramo Arsenal a
coordenadas RocketSim y-up, se consulta `raycast` y se compara la fracción con
la primera intersección de vehículo. Un recurso estático anterior consume el
cohete sin dañar; un vehículo anterior conserva el daño, cooldown, eliminación
y respawn existentes. El bridge sin `features.staticRaycast` se rechaza al
iniciar combate.

Evidencia: `npm test` **135/135**; el smoke WebSocket R8-02 con R11 verificó dos
impactos, cooldown, eliminación, desactivación y respawn; GAME-02 de seis
pilotos verificó seis disparos, movimiento, roster tras desconexión y cero
errores. No se modificaron constantes de vuelo, cámara ni render. Siguiente
unidad: ARENA-06, una sola rampa aislada con geometría nativa y visual alineadas.

## ARENA-06 aceptada — 13 de octubre de 2026

El perfil opt-in `arsenal-expanded-ramp-practice` añade una única rampa propia
de 20 × 18 × 4,5 unidades Arsenal. RocketSim usa una malla triangular Bullet
cacheada; Three.js comparte los seis vértices y dimensiones. La sonda
`npm run probe:rocketsim-ramp-arena`, ejecutada dos veces con R12, observó
aproximación, apoyo inclinado, elevación, salida aérea, aterrizaje y bypass
lateral. La captura queda en
`docs/reference-captures/rocketsim-ramp-practice-arena-06.json` y su SHA es
`5bbbbbcc90fcba1f3fe43de8f8941c9851c87b0232934de5febe6d58bd4e165d`.

`npm run probe:rocketsim-ramp-combat` confirma que un cohete rojo se
intercepta con `COHETE INTERCEPTADO` y ambos coches conservan 100 PV. La
captura es `docs/reference-captures/rocketsim-ramp-combat-occlusion-arena-06.json`.
La regresión del bloque y del raycast estático mantiene sus SHA. No se tocaron
vuelo, salto, dodge, cámara, daño ni perfiles anteriores. La observación visual
en navegador queda pendiente de una instancia accesible.

Siguiente unidad: ARENA-07, composición `combat-alpha` con los recursos ya
validados; no añadir más geometría dentro de esta historia.

## ARENA-07 — aceptada en autoridad; visual pendiente — 14 de octubre de 2026

La implementación fuente de `combat-alpha` compone el bloque, rampa, corredor y
seis spawns sobre la arena nativa existente, manteniendo RocketSim como
autoridad y Node como dueño del combate. La geometría, las regresiones nativas
y la campaña LAN pasan; `npm test` queda en **137/137**. ARENA-07 queda
aceptada para autoridad nativa y LAN. La observación web queda separada porque
el navegador integrado no pudo acceder al servidor local.

### Cierre de validación — 14 de octubre de 2026

R13 compiló correctamente. La geometría, las regresiones nativas y la campaña
LAN de seis pilotos pasan; `npm test` queda en **137/137**. Capturas:
`rocketsim-combat-alpha-geometry-arena-07.json` y
`rocketsim-combat-six-pilot-arena-07.json`. ARENA-07 queda aceptada para
autoridad nativa y LAN. La observación web posterior confirmó R13, HUD,
`COMBAT-ALPHA`, ACK y conducción; VIS-06 está implementada y pendiente sólo de
la captura visual posterior al cambio de balizas y guías.

## VIS-06 — lectura de `combat-alpha` — 14 de octubre de 2026

Se corrigió la semántica visual de equipos para que azul quede en X negativo y
rojo en X positivo, igual que los spawns autoritativos. Se añadieron contorno
del bloque, seis balizas, límites del corredor central y anillo de centro. No
cambiaron RocketSim, Node, la cámara, física, combate ni las dimensiones. La
validación estática pasa con `node --check src/client.js` y **137/137** pruebas.

El navegador integrado no pudo observar esta revisión concreta porque, tras la
recarga, no recibió el snapshot de la instancia externa y rechazó una instancia
R13 aislada con `ERR_CONNECTION_TIMED_OUT`. La siguiente acción es una recarga
fuerte de la instancia local del usuario y observación de los recursos antes
de aceptar VIS-06 y abrir GAME-04.

## VIS-06 y GAME-04 aceptadas — 14 de octubre de 2026

La instancia persistente del host en `localhost:5300` permitió cerrar ambas
puertas visuales. VIS-06 confirmó guías de corredor, balizas, contorno y
lectura lateral de equipos sin modificar la geometría nativa. GAME-04 añade un
objetivo autoritativo de 15, espera hasta reunir dos pilotos, cierre de ronda,
vencedor y reinicio con R. Dos pestañas locales confirmaron la transición
`1/6 · ESPERANDO RIVAL` a `2/6 PILOTOS` y la reconstrucción del sidecar.
`npm test` pasa **139/139**.

ONLINE-01 ya está implementada como envoltura LAN local. Falta ejecutar su
sonda de reconexión desde el PowerShell anfitrión; no se despliega WSS ni se
crean cuentas. La siguiente historia de producto se decidirá después de esa
puerta, priorizando una discrepancia jugable reproducible sobre nuevas
mecánicas o decoración.
