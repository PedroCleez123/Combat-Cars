# Plan de salas persistentes y reconexión

> Estado: PR1/PR1b, PR2, PR2b y PR2i implementados en el contrato multiusuario
> v2. La clave personal se crea/restaura al entrar, la sala personal es también
> la práctica física sin PvP y el host configura la ronda solo cuando decide
> iniciarla. Este documento conserva el diseño y el historial de la línea PR3;
> no declara la prioridad actual. La fuente de prioridad es
> `_bmad-output/current-roadmap.md`.
> Combat Cars tiene como producto principal la ruta online WASM; la ruta local
> nativa solo sirve como referencia y diagnóstico. Fecha del documento:
> 05/11/2026.

> **Lectura histórica:** este archivo conserva la propuesta y el historial de
> PR0–PR3. Los apartados “Cambios necesarios” y “Hitos” describen el diseño
> original, no una lista de trabajo vigente. Para el comportamiento actual usa
> [`../PROTOCOL.md`](../PROTOCOL.md), la implementación en `src/` y sus pruebas;
> para prioridades usa [`../_bmad-output/current-roadmap.md`](../_bmad-output/current-roadmap.md).

## Resumen y viabilidad

La propuesta es viable si se separan tres conceptos que hoy comparten ciclo de
vida:

- **Sala**: un rendezvous persistente, identificado por una clave corta estable
  y propiedad del host.
- **Conexión**: un WebSocket/WebRTC temporal con credenciales efímeras; puede
  cerrarse y abrirse de nuevo sin crear otra sala.
- **Partida**: una ronda concreta, con modo, roster, equipos, `matchId` y
  autoridad RocketSim WASM en el proceso del host.

La clave de sala no debe convertirse en una identidad global del jugador ni en
un secreto. El navegador del host puede conservar un identificador de sala y un
credencial de propietario opaca; los invitados necesitan un ticket de
reconexión separado para recuperar su plaza. Sin cuenta de usuario, esa
recuperación solo puede prometerse para el mismo perfil/origen del navegador o
para quien conserve el ticket. Borrar el almacenamiento local debe mostrar una
opción explícita de recuperar, regenerar o cerrar la sala.

El Worker/Durable Object puede conservar el registro y limpiar conexiones
muertas, pero no puede reanudar la física de una partida si se cierra o pierde
el proceso del host: la simulación actual es P2P y la autoridad vive en el host.
Por tanto, la primera entrega debe prometer **reconexión a la misma sala** y
**reconexión a una ronda mientras el host siga vivo**, no migración ni
reanudación transparente de una simulación cuyo host desapareció.

## Modelo de estados objetivo

```text
room-open ──host configura──> team-selection ──host inicia──> starting ──> playing
    │                              │                            │
    └─ host offline ───────────────┴───────────────> host-offline
```

- `room-open`: la sala personal existe aunque todavía no haya modo seleccionado.
  El host y los invitados se ven en la misma arena física RocketSim, con nitro
  infinito y sin PvP; los invitados reciben un estado explícito, nunca un
  “Buscando sala...” infinito.
- `team-selection`: el host ha fijado un modo provisional. Puede cambiarlo
  repetidamente hasta iniciar; los jugadores pueden elegir, cambiar o quitar su
  equipo y los snapshots conservan sus plazas estables.
- `starting`: solo el host puede avanzar. Se congela la configuración y se
  asigna un `matchId` nuevo.
- `playing`: la ronda usa el snapshot autoritativo existente. Una desconexión
  conserva la plaza durante una gracia acotada y luego la libera según la regla
  del modo.
- `host-offline`: la sala y su clave siguen existiendo, pero no se promete una
  partida viva. La UI permite reintentar o salir y explica que hay que esperar
  al host.

El contrato v2 conserva compatibilidad de lectura con el antiguo `phase:
"lobby"`, pero las salas nuevas publican explícitamente `room-open` y
`team-selection`. En `room-open` se permite `mode: null` únicamente con las
seis plazas reservadas; el flujo personal conserva esas seis plazas también
después de configurar el modo. `/v2/rooms/configure` es la transición
autenticada del propietario que fija la preparación de ronda antes de crear o
reconstruir el lobby WASM. `starting` y `playing` siguen siendo fases de la
ronda, no estados de descubrimiento de la sala.

## Cambios necesarios por capa

### Worker y Durable Object

1. Añadir un registro de sala persistente separado de la reserva de slots. La
   creación/restauración debe ser idempotente para el propietario y devolver la
   misma clave; no debe depender de `SIGNAL_ROOM_TTL_MS` corto.
2. Mantener el código público y los secretos separados. El código debe seguir
   siendo de alta entropía, normalizable (Crockford, espacios/guiones tolerados)
   y no reutilizable por otra sala activa.
3. Emitir credenciales de conexión efímeras y tickets de reconexión opacos
   ligados a `roomId`, `participantId`, `slot` y una caducidad. Nunca devolver
   `hostSecret` ni un secreto de plaza dentro de la clave pública.
4. Hacer que cerrar un socket elimine la ocupación de conexión, pero no el
   registro de la sala ni la identidad de plaza durante la gracia configurada.
   El host que vuelve a conectar debe poder recuperar su rol sin crear otra
   sala.
5. Exponer estados concretos (`host-offline`, `room-full`, `expired`,
   `mode-locked`, `reconnecting`) y aplicar límites de tasa, de conexiones y de
   intentos por ticket. Definir una retención finita (por ejemplo, días desde
   la última presencia) y una acción explícita **Regenerar/cerrar sala**.
6. Versionar el contrato con una ruta paralela (por ejemplo `/v3/rooms`) o una
   clase Durable Object nueva. Las salas v2 deben seguir drenándose sin que el
   significado de su TTL cambie durante la migración.

### Cliente y experiencia

1. Crear/restaurar automáticamente la sala personal al entrar en el juego,
   mostrando su clave desde el primer momento y persistiendo solo el
   identificador y el credencial protegido por el origen. Si falla el Worker,
   continuar en práctica offline y mostrar un error recuperable.
2. Mostrar la clave estable, estado del host, roster, copia y reintento. El
   invitado debe ver “Host sin conexión” o “Reconectando”, nunca únicamente
   “Buscando sala...”.
3. Eliminar el paso **Crear sala** del flujo normal: la clave ya existe. El
   formulario solo permite unirse a la sala de otro host; al hacerlo, la sala
   personal queda suspendida, no destruida.
4. Hacer que el host cambie modo tantas veces como quiera antes de iniciar y
   abrir la elección de equipo. Cada jugador puede alternar Azul/Rojo/sin
   equipo hasta el inicio. **Empezar partida** es la única transición a
   `starting` y debe explicar qué falta (roster, equipos, conexión).
5. Mantener el canvas físico y los controles del lobby ya validados. Al salir
   de una sala o partida ajena, restaurar automáticamente la sala personal con
   la misma clave, sin recargar.

### Host WASM y protocolo de partida

1. Introducir `roomId`, `participantId`, `connectionId` y `matchId` como campos
   distintos; no usar el `slot` como identidad permanente.
2. Rehidratar el roster y las preferencias de equipo al reconectar, pero
   descartar cualquier comando enviado durante la ausencia. En `playing`, la
   gracia debe pausar o neutralizar el coche de forma autoritativa y tener una
   política documentada para liberar la plaza.
3. Mantener RocketSim WASM como única autoridad de física, kills, score,
   respawn y límites. La capa de persistencia solo coordina presencia y
   credenciales.
4. Si el host reinicia su proceso, restaurar la sala y sus preferencias, no
   fingir que se ha restaurado el estado físico. Por defecto se vuelve a
   `room-open`/`team-selection` y se exige iniciar una ronda nueva.

## Hitos, objetivos y tareas

### PR0 — Contrato y decisiones (sin cambios de runtime)

**Objetivo:** cerrar semántica antes de tocar Worker o WebRTC.

- Decidir retención de sala, duración de la gracia de reconexión y qué ocurre
  con una plaza de `playing` que no vuelve.
- Decidir si se soporta solo el mismo navegador/ticket o también cuenta/migración
  entre dispositivos.
- Publicar el esquema de estados, errores y versión de protocolo.
- Añadir fixtures de room/connection/participant/match y una matriz de
  compatibilidad v2↔v3.

**Gate:** revisión de producto y protocolo aprobada; ningún texto de UI promete
reanudación de física después de perder el host.

### PR1 — Registro persistente y reconexión de señalización

**Objetivo:** que una clave existente vuelva a resolver la misma sala aunque se
cierren jugadores o sockets.

- Implementar registro idempotente de propietario y renovación de presencia.
- Separar reservas efímeras, slots persistentes y tickets de reconexión.
- Limpiar sockets/reservas obsoletos y hacer reintentos con backoff.
- Mantener `/v2` sin cambios y probar la nueva versión en paralelo.

**Gate:** host crea, recarga y restaura el mismo código; dos invitados salen y
vuelven a entrar; una sala llena se libera correctamente; un host offline se
identifica con estado concreto.

### PR2 — Flujo de sala y configuración de modo ✅

**Objetivo:** que la sala exista antes del modo y que el host controle el inicio.

- Añadir las fases `room-open`, `team-selection`, `starting` y `playing` al
  contrato v2 con lectura tolerante de salas antiguas.
- Crear la sala con `POST /v2/rooms` sin modo; reservar las cinco plazas de
  invitado para que abandonar y reentrar no cambie la clave ni el slot.
- Fijar el modo mediante `POST /v2/rooms/configure`, autenticado con el secreto
  del propietario. El flujo personal conserva seis plazas persistentes; los
  contratos heredados con menor capacidad siguen validando reservas/tickets.
- Instanciar el lobby WASM y habilitar equipos solo tras la configuración;
  `Empezar partida` queda como única transición a `starting`/`playing`.
- Sustituir “Buscando sala...” por estados visibles de sala abierta,
  selección, host desconectado y partida.

**Gate:** entrar por clave persistente no arranca una partida; solo el host
puede fijar modo y comenzar; todos reciben la misma fase y `matchId`. ✅ Cubierto
por los contratos Worker/DO, cliente y canal de lobby; falta únicamente la
prueba humana contra el despliegue externo.

### PR2b — Sala personal automática y lobby físico compartido ✅

**Objetivo:** que la clave esté disponible al entrar y que la espera sea una
**sala jugable**, no un menú separado.

- Crear o restaurar el registro personal en el arranque, con seis plazas
  persistentes y una clave visible/copiable.
- Instanciar RocketSim `combat: false` tanto en la sala sin modo como durante la
  selección; el impacto, los límites y el nitro infinito siguen siendo física
  continua, nunca una baja ni un respawn de combate.
- Permitir que el host reconfigure modo varias veces mientras la fase sea de
  espera, conservando hashes, tickets y slots; los equipos se reasignan de
  forma segura y luego cada jugador puede alternarlos libremente.
- Tras unirse a otra sala, conservar la sala personal en almacenamiento local y
  ofrecer **Volver a mi sala personal** desde el menú o el lobby.
- Hacer que un deep-link de invitación reciba primero su propia clave personal,
  para que todas las entradas tengan el mismo contrato.

**Gate:** al abrir la página aparece una clave personal y un coche conducible;
dos navegadores pueden coincidir en esa arena sin PvP, cambiar modo/equipos y
comenzar una ronda; salir devuelve al propietario a su propia clave.

### PR3 — Reasignación segura y reconexión de ronda

**Objetivo:** tolerar cortes breves sin duplicar coches, puntos ni autoridad.

- Implementar gracia y reanudación por `participantId`/ticket, no por código
  público ni por primer slot libre.
- Invalidar comandos y tickets antiguos, deduplicar `matchId`/secuencia y
  conservar score/teams solo en snapshots del host.
- Especificar qué ve un jugador desconectado y cuándo una plaza vuelve a estar
  disponible.

**Gate:** reconexión durante lobby y `playing` conserva una sola identidad;
ningún invitado puede ocupar la plaza del host ni inyectar un snapshot.

### PR4 — Migración, observabilidad y publicación

**Objetivo:** desplegar sin romper salas v2 ni ocultar errores.

- Telemetría de `roomId` hash, versión, fase, razón de cierre y latencia de
  reintento; nunca registrar secretos.
- Pruebas de Worker/DO, integración P2P, dos redes y navegadores Chromium/no
  Chromium; añadir el caso “misma clave tras salir y volver”.
- Documentar rollback: desactivar v3, dejar expirar tickets y preservar v2.
- Actualizar el checklist de QA externo y ejecutar build/verify Pages.

**Gate:** cero estados de búsqueda infinita, errores concretos y regresión 1v1
actual intacta; la publicación se marca como no verificada hasta la prueba
humana en red externa.

## Matriz mínima de pruebas

- Unitarias: idempotencia del owner, entropía/normalización de código, caducidad
  y revocación de tickets, limpieza de slots, límites de tasa, fases y permisos
  de host.
- Worker/DO: host offline/online, rejoin tras cierre de WebSocket, dos intentos
  simultáneos por el mismo slot, sala llena, regeneración y retención.
- P2P: host recarga con invitados esperando, invitado abandona y vuelve,
  reconexión durante `team-selection` y `playing`, y no duplicación de `carId`.
- Simulación: snapshots monótonos, `matchId` nuevo por ronda, score y respawn
  intactos, y ninguna recuperación de física ejecutada por el Worker.
- UX: texto de estado accionable, copiar/pegar la clave, teclado, lector de
  pantalla y salida a práctica sin recargar.

## Riesgos y decisiones abiertas

- **Persistencia infinita:** no se recomienda; retención finita y cierre
  explícito reducen abuso y datos huérfanos.
- **Clave como identidad personal:** no es segura ni recuperable entre equipos;
  la clave identifica la sala y los tickets identifican participantes.
- **Host perdido durante la partida:** requiere migrar la autoridad a un
  servidor/simulador dedicado, fuera de este hito. Sin ello, se inicia una ronda
  nueva al volver el host.
- **Cambio de modo con jugadores conectados:** se permite durante toda la
  espera. Cada cambio reconstruye el lobby WASM y conserva slots; si el modo
  elegido no admite iniciar con el roster actual, el botón lo explica y no
  arranca una ronda inválida.
- **Sala sin host conectado:** los invitados pueden conservar presencia, pero no
  deben intentar WebRTC indefinidamente; se usa backoff y estado visible.
- **Almacenamiento local borrado:** el host debe poder regenerar una sala nueva
  y advertir que la anterior no se recuperará sin su credencial.

## Relación con la implementación actual

La ruta vigente crea `room-open` con seis plazas y conserva las credenciales
persistentes; el cliente crea/restaura esa sala automáticamente, muestra la
clave y construye el lobby RocketSim sin combate desde el primer estado. La
configuración posterior puede cambiar de modo varias veces antes de
`starting`; el registro DO conserva las cinco huellas de invitado aunque el
modo seleccionado tenga una capacidad de partida menor. La sala personal queda
guardada mientras el navegador entra en otra sala y se restaura al salir.

La corrección de colisiones de lobby ya cerrada permanece independiente: la
persistencia solo debe conservar sus garantías de autoridad física y no reabrir
el ciclo nativo de demolición/respawn.

## Estado de implementación — PR1/PR1b/PR2/PR2b (03/11/2026)

El primer corte ejecutable conserva `/v1` sin cambios y endurece la ruta
multiusuario `/v2`:

- `ArsenalMultiSignalRoom` conserva la sala durante siete días (retención
  finita), mientras que los sockets, reservas y secuencias siguen siendo
  efímeros. El cambio no amplía el TTL del contrato 1v1.
- El navegador guarda, por origen, el registro del propietario
  (`roomCode`, `roomId`, `hostSecret`, modo, capacidad y caducidad). Al entrar,
  la sala se crea/restaura automáticamente y la misma clave se muestra sin
  pulsar **Crear sala**. Los registros caducados o malformados se eliminan sin
  bloquear la práctica local.
- Una desconexión del host conserva la sala y elige como autoridad al invitado
  con menor `joinOrder`; el Durable Object rota el hash de su antigua plaza,
  incrementa `hostEpoch` y conserva el mismo `roomId`/clave. La ronda RocketSim
  no se reanuda: el sucesor reconstruye un lobby nuevo y exige iniciar una
  partida nueva.
- Las señales de migración limpian la secuencia de autoridad, rechazan épocas
  antiguas y no envían `leave` durante una reconexión. El canal de lobby
  conserva los primeros `hello` que llegan mientras se reconstruye el host.

Validación anterior de PR1: **29 pruebas Worker/señalización/almacenamiento, 0
fallos**. PR2 añade contratos de sala abierta, configuración autenticada y
compatibilidad del canal; la suite focal Worker/DO queda en **20/20**, el
`pretest` ejecuta **148/148** y `npm test` termina con **534 pasadas, 9
omitidas y 0 fallos**. `npm run build:pages-beta` reconstruye **90 archivos**.
La prueba humana en dos navegadores/redes y la publicación del Worker/Pages
siguen siendo pasos externos.

### PR1b completado — rejoin explícito de participante

1. El cliente persistente solicita `persistent: true` y recibe un
   `participantId` más un `reconnectToken` separados del código público.
2. El Durable Object conserva el ticket hasheado, `joinOrder` y la plaza
   reservada; un rejoin válido recupera exactamente esa plaza y uno incorrecto
   se rechaza.
3. La gracia de presencia es de diez minutos (limitada por la caducidad de la
   sala); al reconectar se activa de nuevo el lease. Las uniones v2 antiguas
   mantienen su respuesta de siete campos.
4. Los slots de señalización se derivan de `p2p-guest-N`, nunca del índice
   compacto del roster nativo, por lo que la salida del primer invitado no
   desplaza el destino de los mensajes.

Los slots de señalización se derivan del identificador estable
`p2p-guest-N`, no del índice compacto que RocketSim pueda asignar a su roster
nativo después de una salida. Esto evita que una reentrada o una promoción
envíe comandos a otro jugador.

### Entrega PR2 — sala abierta antes del modo ✅

Crear la sala en `room-open` sin modo inicial; solo el host fija modo/capacidad,
después se habilita `team-selection` y **Empezar partida** congela la
configuración y pasa a `starting`/`playing`. La ruta pública conserva la clave,
los tickets y los slots estables al abandonar/reentrar; si el host se marcha,
el primer jugador conserva la misma sala y se convierte en host, volviendo a un
lobby seguro en vez de fingir que la física continúa. El siguiente hito es PR3:
reconexión de ronda durante `playing` con una política explícita de gracia,
deduplicación y liberación de plazas. La validación manual con dos
navegadores/redes y el despliegue real siguen pendientes.

### PR2b completado — sala personal desde el arranque

- `p2p-multiplayer-entry.js` arranca la práctica y, en paralelo, obtiene una
  sala personal persistente. La UI muestra la clave en el lobby desde el primer
  estado; el botón **Crear sala** deja de formar parte del recorrido normal.
- `room-open` ya no es un estado sin coches: host y guests comparten una arena
  RocketSim no combatiente, con nitro infinito, contención física y sin
  scoreboard/kills/respawn. La misma ruta se conserva durante `team-selection`.
- El host puede aplicar `1v1`, `2v2`, `3v3` o `ffa` repetidamente antes de
  iniciar. Los cinco hashes de invitado no se truncan y el cliente reconstruye
  la autoridad del lobby manteniendo `roomId`, slots y secuencia; cada jugador
  puede alternar su equipo o dejarlo sin equipo.
- Unirse por clave o invitación suspende la sala personal sin borrar su secreto.
  **Volver a mi sala personal** la reabre con la misma clave al abandonar la
  sala compartida o la partida. Las invitaciones profundas siguen este mismo
  orden y no saltan la creación de la identidad personal.

Evidencia PR2b: focal de Worker/DO, cliente, lobby y Pages **64/64**; incluye
reconfiguración repetida conservando cinco plazas, retorno a sala personal,
arranque automático y ausencia de `Crear sala` en la UI. La suite completa,
`build:pages-beta`, `verify:pages-beta` y la prueba humana en dos navegadores
externos siguen siendo los gates de publicación.

### PR2c — negociación WebRTC tolerante a Firefox

- La ruta multiusuario conserva el mismo Worker de señalización y el mismo
  contrato de autoridad P2P, pero ofrece tres servidores STUN públicos y sin
  credenciales para aumentar las posibilidades de descubrir una pareja ICE en
  redes distintas.
- El invitado ya no se marca como **Host sin conexión** a los cinco segundos:
  la negociación dispone de una gracia de 30 segundos, superior al timeout
  WebRTC de 20 segundos, y solo después muestra un mensaje de reintento con
  instrucciones de compatibilidad WebRTC.
- La sala, sus tickets y la simulación local no cambian de autoridad por este
  estado visual; si la pareja ICE no se puede establecer, el jugador puede
  volver a pulsar **Unirse** sin perder su sala personal.

Evidencia PR2c: pruebas focales de señalización/WebRTC **53/53**, `npm test`
completo **534 pasadas, 9 omitidas y 0 fallos**, y `build:pages-beta` /
`verify:pages-beta` correctos con **90 archivos**. Pages se publicó tras esta
evidencia. La unión en Chromium contra el Worker público sí fue observada;
Firefox y dos redes físicas siguen siendo el gate manual externo.

### PR2d — recuperación robusta del invitado y migración de host

- Un cierre/error transitorio de WebRTC ya no expulsa automáticamente al
  jugador a la práctica local mientras permanece en una fase de espera. La
  conexión conserva `roomCode`, `participantId` y `reconnectToken`, libera los
  transportes parciales sin enviar `leave` y vuelve a solicitar la misma plaza.
- La recuperación es acotada y observable: hasta tres reintentos con retardos
  de 500 ms, 1,5 s y 3 s. Cuando se pierde el canal del host, el cliente espera
  1,5 s una señal de promoción antes de reintentar; así no compite con la
  elección determinista del nuevo host. Los callbacks de conexiones antiguas
  quedan invalidados mediante un `guestConnectionEpoch`.
- Si el invitado es elegido nuevo host, se conserva la misma clave y se guarda
  la sala compartida como su sala personal. El estado pasa a `role: host`, se
  libera `guestSlot` y la UI oculta **Volver a mi sala personal**; al terminar
  la ronda no se pide volver a una sala que ya es propia.
- El error final no borra la sala ni el ticket: se muestra una acción explícita
  para volver a pulsar **Unirse**. Esto separa un fallo recuperable de una salida
  voluntaria y evita dejar el navegador atrapado en «Buscando sala…».

Evidencia PR2d: `p2p-guest-connection-recovery.test.mjs` y los contratos de
controles/migración verifican los reintentos acotados, la ventana de promoción,
la invalidación de callbacks y la persistencia del nuevo host. `npm test` pasa
**535 pruebas**, omite 9 y no falla ninguna; `build:pages-beta` y
`verify:pages-beta` generan/verifican **91 archivos**, incluido el módulo de
recuperación. Firefox y dos redes físicas continúan siendo validación manual
externa.

### PR2e — vuelta a `room-open` y nuevas uniones tras promoción

- La promoción restablece autoritativamente el registro del Durable Object a
  `mode: null`, `maxPlayers: 6` y fase `room-open`. El nuevo host conserva la
  clave, pero no hereda el modo ni los equipos de la partida que desapareció
  con la autoridad física anterior.
- El cliente reconstruye todos los jugadores supervivientes con `team: null`,
  oculta el selector de modo/equipos mientras la sala está abierta y muestra
  **Sin modo seleccionado**. El selector no se borra en cada snapshot, por lo
  que el host puede elegir un modo y confirmarlo de forma estable.
- El host promovido crea también sesiones WebRTC para plazas que lleguen
  después de la migración (`peer-ready` dinámico). Así una nueva unión por la
  misma clave no queda atrapada en «Reconectando con el host…».

Evidencia PR2e: contratos Worker/cliente/estrella WebRTC **63/63**; suite
completa **535 pasadas, 9 omitidas y 0 fallos**; Pages verificado con **91
archivos**. En recorrido Playwright contra producción, después de cerrar el
host y recargar el sucesor, un navegador nuevo se unió con la misma clave y
quedó en `Sala abierta`, `2/6 pilotos`, sin modo/equipos y sin errores de
consola. Firefox y dos redes físicas siguen pendientes.

### PR2f — compatibilidad visual cuando Firefox no ofrece WebGL2 (retirada)

Esta entrega histórica introdujo un Canvas 2D top-down para mantener el flujo
jugable cuando WebGL2 no estaba disponible. Se retiró el 15/11/2026 porque
Combat Cars es un juego 3D y esa representación no cumple el producto. La ruta
actual exige Three.js/WebGL2; si no puede crear el contexto, muestra el aviso
de error de renderizado 3D y no cambia de tecnología ni de cámara.

### PR2g — reingreso persistente idempotente y bloqueo de uniones duplicadas (04/11/2026)

- Se reprodujo contra el Worker público que una segunda petición con el mismo
  `participantId` y `reconnectToken`, realizada durante la ventana de reserva
  WebRTC de 45 segundos, devolvía `409` como si la sala estuviera llena. Esto
  hacía que un fallo transitorio de ICE dejara al jugador sin poder recuperar
  su plaza hasta que expirase la reserva.
- `redeemGuest()` ahora trata esa reserva como idempotente cuando pertenece al
  mismo participante: renueva su ticket y conserva el mismo slot. Una reserva
  activa de otro participante, un socket ya conectado o un ticket inválido
  siguen rechazándose, por lo que no se abren plazas duplicadas ni se permite
  suplantar una identidad.
- La acción pública **Unirse** tiene además una guarda de operación en vuelo y
  detecta una conexión/reconexión ya activa para la misma clave. Los clics
  repetidos ya no abren varios transportes ni compiten por la misma reserva;
  tras agotarse la recuperación acotada, el usuario puede pulsar **Unirse** de
  nuevo de forma explícita.

Evidencia PR2g: suite focal de Worker, tickets, lobby, recuperación y controles
**76/76**; queda pendiente volver a desplegar Worker/Pages y repetir el rejoin
idempotente contra el endpoint público.

## Auditoría y roadmap PR2i — rotación de la sala personal del host saliente

### Diagnóstico verificado (04/11/2026)

La migración de autoridad del Worker/Durable Object ya tiene el comportamiento
correcto para los jugadores que permanecen: al cerrarse el socket del host,
`disconnect()` elige al invitado más antiguo, rota el hash de su plaza,
actualiza `host_hash` y envía `host-promoted`; el navegador promovido conserva la
misma clave pública, resetea la ronda a `room-open` y guarda esa sala como su
nueva sala personal.

El fallo está en el navegador del antiguo host:

1. `openHostRoom()` conecta el cliente de señalización, pero no suscribe
   listeners propios a sus eventos `error`/`closed`. Los listeners que existen
   dentro de la estrella WebRTC solo describen bajas de invitados, por lo que
   una pérdida del socket del propietario deja el contexto local con
   `role: "host"` y la interfaz antigua.
2. `returnToOfflinePractice()` limpia el runtime y arranca la práctica, pero no
   arranca de nuevo `bootstrapPersonalRoom()`. Además, mientras
   `roomContext.role === "host"`, `bootstrapPersonalRoom()` retorna
   inmediatamente.
3. El almacenamiento local conserva la credencial de propietario de la sala
   compartida. Cuando el antiguo host intenta restaurarla, el Worker responde
   `403`: la clave ya pertenece al sucesor. La UI queda entonces esperando una
   nueva clave que nunca se solicita.
4. `beforeunload` cierra transportes de forma intencionada. Ese cierre no debe
   crear una sala durante la navegación; la recuperación automática solo es
   válida cuando la página sigue viva y recibe una pérdida terminal del
   transporte.

Conclusión: el contrato de promoción está correcto; falta una transición local
`host compartido perdido → práctica offline → nueva sala personal`. No se
requiere un endpoint nuevo ni cambiar la clave del sucesor.

### Invariantes de diseño

- La clave pública de la sala compartida queda en manos del sucesor elegido por
  el Worker. El antiguo host no intenta reclamarla ni modifica su estado.
- La credencial de propietario almacenada se considera válida solo mientras el
  navegador conserva una conexión host activa o hasta que una restauración
  autenticada tenga éxito. Tras una pérdida terminal del socket host se elimina
  antes de solicitar la nueva sala.
- La recuperación automática se ejecuta como máximo una vez por pérdida
  (`hostPersonalRecoveryInProgress`) aunque lleguen `error` y `closed` juntos.
  Un cierre voluntario de la pestaña (`pageUnloading`) no inicia fetch ni crea
  otra sala.
- La nueva sala se crea con el flujo normal `POST /v2/rooms`, se persiste su
  `hostSecret` y se abre en `room-open` con seis plazas, nitro infinito y sin
  PvP. El usuario vuelve a ver una clave distinta y puede compartirla.
- Un reload normal mientras el navegador sigue siendo dueño conserva la clave
  anterior; solo la pérdida de autoridad confirmada provoca rotación.

### Hitos y tareas pendientes

#### PR2i.1 — detección de pérdida del propietario (P0)

- Suscribir `openHostRoom()` a `activeClient.on("error")` y
  `activeClient.on("closed")`, capturando la identidad exacta del cliente para
  ignorar callbacks de sockets sustituidos.
- Añadir una marca de navegación (`pageUnloading`) y una guarda de recuperación
  para diferenciar cierre de pestaña, salida voluntaria y pérdida real.
- Tratar `expired`/`host-left` como terminales; no convertir una baja normal de
  un invitado en una rotación del host.

#### PR2i.2 — rotación automática de identidad personal (P0)

- Invalidar `P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY` de la sala que dejó de ser
  propia.
- Ejecutar el teardown existente de forma idempotente y regresar a la práctica
  offline sin recargar la página.
- Encadenar `bootstrapPersonalRoom()` después del teardown para crear la nueva
  sala, guardar su credencial y abrir el lobby personal. No llamar a
  `hostRoom()` con el registro antiguo.

#### PR2i.3 — UX y estados recuperables (P1)

- Mostrar una única secuencia breve: `Sala anterior cerrada` → `Creando tu nueva
  sala personal` → clave disponible. Nunca dejar `Buscando sala…` ni pedir una
  acción manual de “crear” para recuperar el lobby inicial.
- Mantener el coche controlable durante la transición offline; ocultar el panel
  compartido y volver a mostrar solo la nueva clave cuando el Worker responda.
- Si la creación nueva falla, conservar la práctica offline y mostrar el botón
  existente **Reintentar mi sala personal**, sin reusar la credencial invalidada.

#### PR2i.4 — pruebas y publicación (P0)

- Regresión de cliente: callbacks `error`+`closed` duplicados crean una sola
  sala; el callback de un cliente antiguo no afecta al nuevo; `beforeunload` no
  hace bootstrap.
- Integración de almacenamiento: credencial vieja se elimina, credencial nueva
  se guarda y un reload posterior restaura solo la nueva clave.
- Recorrido manual de dos navegadores: Firefox host con 1–5 invitados, cierre
  del host, sucesor conserva la clave, antiguo host vuelve a su lobby personal
  con otra clave y un tercer navegador puede unirse a ambas claves según
  corresponda.
- Ejecutar pruebas focales, `npm run build:pages-beta`,
  `npm run verify:pages-beta`, desplegar Worker/Pages y repetir la sonda HTTPS.

### Criterio de cierre

PR2i no se considerará completado hasta que el antiguo host no quede nunca con
la clave migrada ni en un estado de espera infinito: tras una pérdida de su
socket, debe aparecer automáticamente una sala personal nueva y persistente,
mientras el sucesor sigue usando sin interrupción la clave de la sala original.

### PR2i — implementación local terminada (04/11/2026)

- `P2PMultiSignalingClient.resetRoom()` y `configureRoom()` clasifican ahora el
  `403` del Worker como `error.code === "room-not-owner"`; `410` se clasifica
  como `"room-expired"`. Los fallos de red conservan su semántica genérica,
  por lo que no se regeneran claves ante una pérdida pasajera de conectividad.
- Al cargar el navegador con una credencial de host persistida, `hostRoom()`
  intenta primero restaurar exactamente esa sala. Solo si el Worker confirma
  `room-not-owner` (otro jugador fue promovido) o `room-expired`, elimina el
  secreto local obsoleto y ejecuta el mismo `createFreshPersonalRoom()` que se
  usa en una primera visita. La nueva clave queda persistida y abre en
  `room-open` con seis plazas.
- Mientras la página permanece abierta, los listeners `error` y `closed` del
  cliente host regresan una vez a práctica offline y lanzan ese bootstrap. La
  guarda por identidad de cliente y `hostPersonalRecoveryInProgress` absorbe
  el par habitual `error`+`closed` y callbacks de un socket anterior.
  `beforeunload` marca el cierre real de pestaña para que no se cree ninguna
  sala durante la navegación; al volver a abrirla, la restauración autenticada
  determina si debe conservar o rotar su clave.
- Cobertura añadida: distinción `403` propietario obsoleto frente a fallo
  temporal, guardas de duplicados/cierre de página, creación de sala nueva tras
  invalidar solo la credencial vieja y empaquetado Pages con el flujo actual.

Evidencia PR2i: pruebas focales **33/33**, suite completa **535 pasadas, 9
omitidas y 0 fallos**, `build:pages-beta` y `verify:pages-beta` correctos con
**92 archivos**. Validación humana posterior confirmada en Firefox: tras la
promoción, el host anterior ya recibe de nuevo su lobby personal y una clave
persistente distinta, mientras la clave original sigue perteneciendo al
sucesor. PR2i queda cerrado. Las pruebas futuras de regresión deben repetir
este recorrido junto con salas de 1–6 jugadores.
