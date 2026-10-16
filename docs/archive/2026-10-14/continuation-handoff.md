# Relevo de continuidad — 14 de octubre de 2026

> **Lectura obligatoria antes de continuar:** este archivo conserva el historial
> de decisiones, pero el orden canónico está en
> [`../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md`](../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md).
> Combate 1v1/6v6 y arranque normal del bridge R13 están aceptados. La siguiente
> unidad es `MOB-AIR-02-OBS-ISOLATED`: una sesión autoritativa de un piloto para
> cerrar side y diagonal sin tocar constantes. `LIVENESS-01` ya tiene código y
> pruebas unitarias; falta una observación de integración limpia. Las secciones
> antiguas de este relevo no reabren historias cerradas.

## Resumen canónico — 14 de octubre de 2026

- **Aceptado:** `COMBAT-PLAY-01` 1v1 y 6v6, bridge R13 en arranque normal,
  watchdog `LIVENESS-01` en pruebas unitarias (`npm test` 157/157).
- **Pendiente:** `MOB-AIR-02-OBS-ISOLATED` (front aceptado; side y diagonal no
  verificadas por interferencia de roster/falta de estado vivo).
- **Regla de decisión:** no calibrar física, cámara ni adaptador sin una traza
  reproducible y una historia aislada.
- **Siguiente después de P0:** comparar trazas nativas y web (`MOB-AIR-03`),
  luego corregir cámara si la pose es correcta, y dejar la mejora visual de la
  arena para después.

## Estado actual resumido (13 de octubre de 2026)

- Línea base vigente: `npm test` pasa **131/131**.
- Bridge: R9 está compilado; ARENA-01 aporta la práctica limpia ampliada con
  cuatro transiciones suelo-pared propias y captura nativa determinista.
- Presentación: VIS-01 aclaró la práctica y la carga visual no registró errores
  de consola; no sustituye una maniobra reproducible.
- ARENA-03: el perfil cornered es ahora el predeterminado del lanzador
  RocketSim; `ROCKETSIM_ARENA=arsenal-practice` conserva el control plano.
- ARENA-04: las cuatro esquinas mantienen el mismo redondeo desde el suelo
  hasta el techo en la malla nativa y Three.js. La sonda registra apoyo en la
  esquina vertical hasta `h=23,98`, sin huecos.
- VIS-02: marcas planas de suelo y guías verticales no físicas mejoran la
  orientación en práctica; navegador sin errores y `npm test` 130/130.
- VIS-03: dos pestañas de combate RocketSim confirmaron `2/6`, equipos y coches
  azul/rojo, marcador y ACK sin errores de consola. `VIS-03.1` añadió una
  timeline opt-in y la sonda publicó un cohete con pose/velocidad finitas. La
  captura de píxeles sigue pendiente por alcance del navegador integrado, pero
  no bloquea VIS-04, limitado a iluminación y contraste de la arena limpia.
- VIS-04: la práctica limpia aplica más hemisferio, sol, lavados de equipo y
  exposición sin cambiar mallas ni gameplay; el desguace preserva su perfil.
  `npm test` pasa 131/131.
- MOB-01: la sonda alcanza curva, pared, dodge, air roll y boost con ACK y
  cadencia correctos. La ejecución vigente tiene 829 snapshots y 25 ACK; la
  captura visual de navegador sigue pendiente por aislamiento del entorno.
- Plan vigente (histórico, sustituido el 13/10/2026): MOB-01V → GAME-02 → GAME-03 → ARENA-05/VIS-05 → ONLINE-01. El plan actual es COMBAT-GEO-01 → COMBAT-GEO-02 → ARENA-06 → ARENA-07 → VIS-06/GAME-04 → ONLINE-01. El plan detallado está en
  `_bmad-output/implementation-artifacts/roadmap-next-phase-2026-10-13.md`.

## Estado seguro\n\nEl hito activo es **COMBAT-GEO-01**: consulta nativa de geometría estática para que los cohetes respeten los mismos recursos físicos que detienen a los coches. La arena cornered y ARENA-05 permanecen como regresiones aceptadas. La simulación JavaScript de
producción es propia, autoritativa y ejecuta subpasos de 120 Hz. La práctica
opt-in puede ejecutar el solver de RocketSim desde el sidecar nativo compilado
a partir del commit público fijado. Las referencias de Rocket League y Car
Soccer sólo informan relaciones de control; no se incorpora código propietario
de Rocket League, WebAssembly ni recursos de sus juegos.

## Entrega vigente

- FIS-12A/B y FIS-13A/B: chasis orientado, contactos, suspensión, motor,
  freno, neumáticos y powerslide en la arena limpia.
- FIS-14B/C/E: saltos, doble salto, dodge, nitro, orientación quaternion y
  semántica diferenciada de free air roll y roll direccional.
- FIS-15A/B/C: interpolación de snapshots, eventos discretos y medición de ACK
  de entrada; no existe predicción o conciliación local.
- CAL-03 automatizada: ocho maniobras de mando pasan por adaptador, WebSocket y
  servidor con duración y ACK verificables. El adaptador conserva el mapa de
  mando solicitado (A, RB, LB, X/B y RT/LT analógicos).
- La comparación estática con Car Soccer está en
  `docs/archive/2026-10-12/car-soccer-comparison-2026-10-10.md`; el dodge dirigido ya compone
  guiñada y alabeo en su eje lateral.
- La corrección de referencia del 11 de octubre invalida FIS-14H como objetivo:
  Rocket League no aplica un auto-enderezado al tocar el suelo. M4-03 retiró la
  retención y la aproximación explícita de pitch/roll de la rama de calibración;
  el apoyo responde mediante el impulso del contacto y la suspensión.
- FIS-14I instrumenta el dodge diagonal con yaw y roll. Su línea base previa a
  FIS-14J era `(forward=0,447, side=0,894)`, primer apoyo a `0,625 s`, roll
  `-0,139` rad y dos ruedas cargadas. `grounded` y los dos saltos solo se
  recuperan después de ese apoyo real.
- FIS-19 corrige el tiempo del primer salto según el contrato público:
  pulso mínimo de `0,025 s`, fuerza sostenida hasta `0,2 s` y ventana de
  segundo salto de `1,25 s` después de ese tramo. El dodge mantiene dirección,
  impulso horizontal, giro y follow-through sin elevación vertical inventada.
  CAL-04 registra `+6,968 u/s` de doble salto y `−0,133 u/s` para dodge
  frontal/lateral en el primer subpaso.
- FIS-14K comprueba el borde de activación con W/S, A/D y air roll
  direccional: la dirección se normaliza, se transforma con la base local del
  chasis y queda comprometida durante el follow-through. La entrada posterior
  no retargetea la velocidad; la opuesta solo cancela la rotación. La búsqueda
  global de símbolos Dodge en Ghidra no terminó dentro del límite de análisis,
  así que no se usó como evidencia adicional.
- FIS-16A separa la cámara de la actitud completa del coche: el horizonte usa
  `up` mundial, el rumbo horizontal tiene una tasa máxima de `7,5 rad/s` y el
  foco vertical solo recibe un sesgo limitado de pitch. Air roll ya no debe
  girar la cámara ni desplazar el foco lateralmente; respawn y reconexión
  reinician el rumbo de seguimiento.
- M4-01/M4-03 ya están aceptadas como instrumentación y corrección de contactos
  y aterrizajes. Las seis condiciones se registran a 120 Hz en
  `docs/reference-captures/arsenal-m4-01-contact-transitions.json`; el JSON
  separa contacto de carrocería, apoyo de dos ruedas y estado jugable, y los
  finales coinciden con paquetes agrupados de hasta 50 ms. M4-03 aplica el
  momento del impulso normal en el brazo de contacto, conserva la actitud y
  usa `0,01` de compresión mínima para dos ruedas de apoyo.
- M4-02 ya generó la referencia R4 en
  `docs/reference-captures/rocketsim-r4-contact-transitions-c2baacb8.json` y
  `npm run compare:contacts` deja el informe
  `docs/reference-captures/arsenal-r4-contact-comparison.json`. RocketSim
  confirma el orden de apoyo y asentamiento; `CarState` no expone compresión,
  pero el harness conserva longitud y fuerza internas para la comparación
  relativa. Las unidades siguen siendo distintas y todavía no se abrió una
  corrección física.
- M4-02b deja una puerta de escala reproducible en
  `docs/reference-captures/arsenal-r4-contact-normalized.json`, generada con
  `npm run normalize:contacts`. Las caídas se expresan por tiempo de caída
  libre y la carga de rueda se expresa relativa a su apoyo asentado; los
  dodges quedan fuera de la razón de caída libre. Sigue pendiente atribuir la
  diferencia de forma no se usa para copiar fuerzas; M4-04 queda pendiente para
  paredes, esquinas y techo.

## Punto de control RCE-1

`npm run probe:curves` deja una traza versionada de siete escenarios, todos a
120 Hz y con 144 muestras. Incluye los flancos de salto y la dirección local
del dodge, de modo que las futuras capturas autorizadas se puedan alinear sin
cronometraje manual. La historia FIS-17 y el flujo RCE-0 a RCE-4 están en
`docs/archive/2026-10-12/reference-curve-recovery-plan.md`.

`npm run compare:curves -- referencia.json candidato.json dodge-diagonal-roll`
remuestrea las señales a tiempo normalizado y separa el error de forma de los
picos en unidades originales.

La captura propia completa del 11 de octubre está en
`docs/reference-captures/arsenal-2026-10-11.json`. Car Soccer no pasó de su
pantalla “Warming up visual effects” en la observación; solo se registraron
recursos estáticos de mallas de colisión y sonidos de acciones separadas.

El inventario completo de Rocket League por Ghidra no terminó dentro del límite
de esta sesión. El ejecutable no se ejecuta y no se extraen constantes. Car
Soccer sigue aportando solo relaciones de control y presentación observadas
estáticamente; sus curvas numéricas continúan pendientes de una captura
comparable.

## Punto de control CAL-04

`npm run probe:envelope` mide, en la misma simulación de juego, conducción,
salto, dodge y respuesta aérea.

FIS-14F.1 detectó que soltar pitch, yaw o roll dejaba al coche rotando durante
0,900–1,175 s. Se ajustó únicamente la amortiguación de liberación:

| Eje | Hasta neutro ahora |
| --- | ---: |
| Pitch | 0,450 s |
| Yaw | 0,442 s |
| Roll | 0,500 s |

Las tasas activas, salto, dodge, nitro y contactos no cambiaron. La maniobra a
120 Hz conserva `cadenceMatches = true`.

FIS-13C midió una curva de powerslide de 90°. La distribución de agarre de
neumáticos elegida conserva 73,4% de la velocidad de entrada, con radio 6,114
y recuperación de tracción en 0,450 s. La variante anterior conservaba 63,1%.
Se mantuvieron ángulo de rueda, motor y par de powerslide.

Los detalles, variantes y criterios están en
[archive/2026-10-12/cal-04-mobility-envelope.md](archive/2026-10-12/cal-04-mobility-envelope.md).

## Validación más reciente

- `npm test`: 98 pruebas pasan, 0 fallos, incluidas las relaciones FIS-14J/K,
  la activación tardía dentro de la ventana y M4-01.
- `npm run probe`: la traza de aire a 120 Hz conserva la misma cadencia.
- `npm run probe:envelope`: giro, liberación, inversión, salto, dodge,
  conducción y recuperación completan sus mediciones. La curva de dirección
  abre el radio de 5,913 unidades a 12 unidades/s a 37,811 a 42; el nuevo
  handbrake progresivo registra 0→1 en 0,2 s y salida a 2/s. El nitro
  suelo/aire registra `1,608 s` hasta la banda supersónica y conserva un pulso
  mínimo de `0,1 s` al soltar. El salto conserva un pulso mínimo de `0,025 s`
  y abre su ventana de segundo salto al finalizar la fuerza sostenida.
- `npm run calibrate:network`: CAL-03 pasó las ocho maniobras por WebSocket,
  con ACK de entrada, pitch, yaw, roll, doble salto, dodge con roll, nitro y
  aterrizaje comprobados; también publicó `lastLanding`.
- FIS-16A es código de cliente servido estáticamente: la pestaña 5189 se
  recargó y lo cargó sin reiniciar el proceso Node. Las modificaciones futuras
  de `server.mjs` o de la física autoritativa sí requieren reiniciar el proceso;
  el intento automatizado anterior fue rechazado por la revisión de aprobación
  automática del entorno por límite de uso y no se forzó el cierre del proceso.

## Mando virtual

## R6-02 cerrado; siguiente historia R7-01

R6-02 completó la comparación de quince curvas RocketSim, incluidas las que
parten del aire. La captura nativa repetible es
`docs/reference-captures/rocketsim-bridge-r6-02-all.json` (SHA-256
`261012f20888fc43411b82dc5a19d85146c9d5c2fd0d7f7da1cfe319b4ad634d`) y la
línea base propia queda en `docs/reference-captures/arsenal-r6-02-current.json`.
El error propio es bajo en los ejes de vuelo aislados pero grande en primer
salto y dodge desde suelo; los flancos y la dirección de acción sí coinciden.

No se deben ajustar ahora las constantes aéreas de `src/simulation.js`. La
siguiente unidad es R7-01: `RocketSimPracticeMatch`, una sesión de un piloto
iniciada solo con `MOVEMENT_BACKEND=rocketsim`, usando seis planos limpios y
manteniendo JavaScript como default. La ficha completa está en
`_bmad-output/implementation-artifacts/rocketsim-practice-r7-01-story.md`.

R7-01 quedó aceptada el 12 de octubre de 2026. El puente nativo compila, el
perfil `arsenal-practice` mantiene una arena limpia de seis planos y la suite
completa pasa 105/105. El servidor real cargó el HUD de práctica y mantuvo dos
ticks nativos por snapshot de 60 Hz; la mediana fue `0,877 ms`, p95 `1,343 ms`
y máximo `4,046 ms`. El backend JavaScript no cambió y el cierre del sidecar no
deja fallback implícito.

La siguiente historia es R7-02: validar en navegador salto, doble salto, dodge
y vuelo con una secuencia automatizada, capturando pose, actitud, velocidad,
seriales y cadencia antes de decidir si RocketSim puede entrar en la partida.

R7-02 ya está medida con la sonda
`tools/rocketsim-practice-probe.mjs`: 94 snapshots, ACK 18/18, media de
`16,67 ms` por snapshot y seriales observados para salto, doble salto y dodge.
La evidencia está en
`docs/reference-captures/rocketsim-practice-r7-02.json`. Falta R7-03, la
comprobación visual de cámara, aterrizaje y tacto; no se debe conectar todavía
RocketSim al combate ni ajustar constantes del solver JavaScript.

El puente también expone `worldContact.normal` para que la práctica distinga
suelo, pared y techo en contactos de carrocería. No se afirma todavía que una
pared sea apoyo jugable: la normal individual de cada rueda no forma parte del
contrato nativo actual y R7-03 debe cerrar esa validación visual.

La sonda de contactos de R7-03 ya deja una evidencia más acotada en
`docs/reference-captures/rocketsim-practice-contacts-r7-03.json`: el tick 220
colisiona con una pared nativa y el 221 conserva el contacto mientras cambia
el apoyo de ruedas. Es una prueba del solver y del transporte de la normal,
no una prueba de la transición curva de Soccar. RocketSim no trae en el clon
las mallas binarias necesarias para `Arena::Create(GameMode::SOCCAR)`;
`InitFromMem({ }, true)` solo inicializa el solver sin esa geometría. La
práctica actual, por tanto, usa seis planos sintéticos de Arsenal y debe
mantenerse separada del combate hasta resolver esa fuente de mallas o aceptar
una arena propia explícitamente.

R7-04 ya está aceptada como arena propia de entrenamiento. El perfil nativo
`arsenal-curved-practice` crea una transición suelo-pared mediante un cuarto de
cilindro extruido, conserva pared, techo y límites limpios, y reutiliza el mesh
durante nuevas inicializaciones del bridge. La captura
`docs/reference-captures/rocketsim-curved-practice-r7-04.json` repite el SHA
`7da59d6caacd75a3ab9e24d302c203913f1d342fad3d1a51f822791ed6c0757d`; el apoyo
inclinado aparece en el tick 215, el pronunciado en el 229, no hay huecos de
contacto y la variación normal máxima es `5,625°`. Esto valida continuidad de
una geometría original, no la arena Soccar ni una equivalencia con Rocket
League. R7-05 debe llevar el perfil a la práctica del navegador y medir cámara
y controles antes de ampliar el bridge a varios coches.

R7-05a también está aceptada: `ROCKETSIM_ARENA` selecciona la arena plana o la
curva propia, el snapshot publica `settings.practiceArena` y Three.js dibuja
la misma transición. El servidor real devolvió HTTP 200 y WebSocket con un
coche `grounded`, ACK y `practiceArena=arsenal-curved-practice`; la consola del
cliente no mostró errores. R7-05b cerró el recorrido y la presentación de la
curva: la sonda observa apoyo inclinado, pronunciado y pared con cuatro ruedas
y sin huecos; su evidencia está en
`docs/reference-captures/rocketsim-practice-curved-r7-05b.json`. Una subida
visual detectó cámara por encima del techo; se corrigió sin tocar física: en
prácticas limpias la posición queda en `2,8…21,2` y el foco en `0,8…22,2`.
La repetición mostró el coche visible en la pared curva, sin errores de consola,
y `npm test` pasa 108/108. R7-05c queda aceptada como medición automatizada:
`npm run probe:rocketsim-wall-actions` empieza cada fase en apoyo real de pared
y cubre salto, segundo salto/dodge, air roll, nitro y recuperación a apoyo. La
captura es `docs/reference-captures/rocketsim-wall-actions-r7-05c.json`; la
sonda observó `21` entradas reconocidas, dos ticks nativos por snapshot y
cuatro fases con apoyo inicial. No se modificaron fuerzas ni la autoridad de
producción. La comparación de tacto con Rocket League continúa siendo visual y
subjetiva; R8-01 puede empezar con multivehículo nativo aislado.

R8-01a y R8-01b están aceptadas: el sidecar admite 1–6 coches, conserva IDs,
equipos e inputs independientes y rechaza listas duplicadas, fuera de rango o
distintas de la configuración. `npm run probe:rocketsim-multicar` verificó dos
coches durante 180 ticks, recuperó correctamente tras un init inválido y guardó
`docs/reference-captures/rocketsim-multicar-r8-01.json`. La práctica web asigna
plazas por WebSocket y reconstruye el roster nativo al cambiar altas o bajas,
sin añadir vehículos vacíos que afecten a colisiones. No se ha tocado combate,
bots, daño ni el backend JavaScript de producción. Un smoke del servidor con dos
WebSockets reales verificó bienvenidas azul/rojo, `humans=2`, snapshot conjunto
y posiciones con throttle opuesto. El siguiente bloque es R8-02: integrar las
reglas de combate alrededor de la pose nativa sin crear doble autoridad. Ya se
separó la capa determinista en `src/rocketsim-combat.js` y tiene disparo,
cooldown, daño y respawn cubiertos por pruebas. El bridge incluye el contrato
de respawn y la build R9 ya está compilada en `.rocketsim-bridge-build-r9/`;
la sonda `npm run probe:rocketsim-combat-state` verifica desactivación,
respawn y continuidad del tick.

El smoke WebSocket y el ciclo completo ya están aceptados:
`npm run probe:rocketsim-combat-websocket` conecta dos clientes contra la
build R9, confirma equipos, snapshots nativos, ACK, cadencia, cooldown, dos
impactos, eliminación, desactivación y respawn. La captura queda en
`docs/reference-captures/rocketsim-combat-websocket-r8-02.json`. El siguiente
bloque es la prueba de integración jugable y visual; no se debe tocar la
física nativa para cubrir esa puerta.

ARENA-01 también está aceptada como perfil opt-in:
`arsenal-expanded-curved-practice` alinea una arena propia `144×108×30` con
cuatro transiciones suelo-pared de radio `8` en RocketSim y Three.js. La sonda
de cuatro coches es determinista y mantiene cero huecos; los perfiles R7 no
cambian. Para probarla: `$env:ROCKETSIM_ARENA='arsenal-expanded-curved-practice'; npm run start:rocketsim`.
La caché BVH del bridge distingue toda la geometría, incluido el recorte de
esquinas, y reinicia sus cuatro referencias al cambiar de perfil; tras
recompilar R9, la sonda R7 conserva su SHA y ARENA-01 repite el suyo en dos
ejecuciones.
La siguiente comprobación de experiencia es visual: conducción por aire/pared
en navegador con entradas reproducibles; no se deben ajustar constantes de
vuelo por esta historia.

VIS-01 queda implementada como un perfil visual puro: las tres prácticas
limpias usan fondo, niebla y superficies más claras y diferenciadas, mientras
`scrapyard` conserva su apariencia. `npm test` pasa 121/121. La selección está
aislada en `src/arena-visual-profile.js`; la comprobación de contraste en
navegador sigue pendiente por falta de automatización visual en esta ejecución.

UX-01a suaviza la cámara en aire y pared sin alterar la física: heading máximo
de `2,8` y `2,35 rad/s` respectivamente, más filtros de foco y posición de
menor respuesta. `tests/camera-follow.test.mjs` cubre el contrato de
continuidad y `npm test` queda en 119 pasadas. La compilación CMake/MSVC ya se
recuperó para R8-02; antes de ARENA-01 no se debe dibujar una arena grande con
cuatro curvas si su geometría física nativa sigue teniendo una sola curva.

## Organización documental

La entrada única de documentación es `docs/README.md`. El inventario completo
está en `docs/document-inventory-2026-10-12.md`. La limpieza del 12 de octubre
archivó de forma reversible 17 informes y planes cerrados en
`docs/archive/2026-10-12/`; se actualizaron los enlaces desde documentos
activos. No se movieron capturas JSON ni documentos que describen el estado
actual. Para restaurar algo, consulta primero `docs/archive/README.md` y
actualiza el inventario.

`C:\Users\Pedro José\Desktop\SK\vgamepad-main` fue revisado. Se instaló el
ViGEmBus oficial 1.22.0 y el dispositivo `Nefarius Virtual Gamepad Emulation
Bus` aparece iniciado. Con Python elevado, `vgamepad-live-test.py` produjo
`VIRTUAL_PAD_READY`, 20 pulsaciones de A y `VIRTUAL_PAD_RELEASED`. La instancia
Edge aislada no abrió su endpoint CDP, por lo que la evidencia confirma el
adaptador físico virtual, pero no una lectura completa desde
`navigator.getGamepads()` en el navegador del juego.

## Integración RocketSim R5

R5 añadió un sidecar C++ aislado en `tools/rocketsim-bridge` y el contrato Node
en `src/rocketsim-protocol.js` y `src/rocketsim-backend.js`. La build usa el
commit `c2baacb8f4b441dd8505e63c2aeb5a1679b60b02`, arena de seis planos
sintéticos y un coche. `npm test` pasa 98/98. El smoke test se ejecuta con
`ROCKETSIM_BRIDGE_EXE=.../rocketsim_bridge.exe npm run probe:rocketsim-bridge` y
produjo dos veces el hash `e9e6aec1ff93aab4e4156381854f2d7c9ea21f3249c07c323608edf2e95f30e1`.

El backend de producción no se ha cambiado. R6 debe comparar las trazas R0–R4,
incluidos segundo salto, dodge y aterrizajes, antes de conectar combate o bots.

## R6-01 — trazas nativas desde suelo

R6-01 queda aceptada como infraestructura de medición, sin conectar RocketSim
a `server.mjs`. El bridge ahora rechaza configuración/ticks inválidos, convierte
los planos a unidades Bullet, normaliza los ejes locales y traduce free air
roll sin guiñada simultánea. La captura
`docs/reference-captures/rocketsim-bridge-r6-01-ground.json` reproduce seis
escenarios de 144 ticks y repite el SHA
`0f545e59138085ec09d3a58671e1d45b1a29b887c19eb5a809864d11daf4a4e6`.

Contra R3, primer salto y doble salto activan en `1`/`12`; los tres dodges en
`12`, con dirección idéntica y diferencia máxima de actitud inferior a `0,07°`.
La evidencia detallada está en `docs/archive/2026-10-12/rocketsim-bridge-r6-01.md`. `npm test`
queda en **100 pasadas, 0 fallos**.

## Siguiente bloque: R6, comparación de movimiento

M4-03 ya se aceptó con una hipótesis única: transmitir el impulso normal por
el brazo de contacto y conservar la actitud durante el apoyo. La regresión
completa pasa 95/95 y las seis trazas de contacto terminan con apoyo y dos
saltos recuperados. El siguiente bloque debe medir pared oblicua, esquina
suelo-pared y techo con la misma regla: corregir penetración y velocidad normal,
conservar la tangente y no introducir auto-enderezado. La validación visual y
el tacto humano siguen después de cerrar esa puerta.

La instancia aislada `http://localhost:5199/` se arrancó con la fuente actual y
la pestaña cargó la escena de **CALIBRACIÓN DE MOVILIDAD** con `SALTOS 2/2`,
estado `grounded` y el panel FIS-14D.1. Esta comprobación confirma servicio y
HUD; todavía no sustituye una valoración subjetiva de las maniobras con mando.

## Archivos clave

| Archivo | Uso |
| --- | --- |
| `src/simulation.js` | Física, contactos y `TUNING`. |
| `src/mobility-probes.js` | Trazas deterministas CAL-02 y CAL-04. |
| `src/contact-transition-probes.js` | Trazas M4-01 de contacto, apoyo y aterrizaje. |
| `tools/contact-transition-probes.mjs` | Genera la captura M4-01 versionada. |
| `tools/compare-contact-transitions.mjs` | Compara M4-01 con la referencia R4. |
| `tools/normalize-contact-transitions.mjs` | Normaliza caída libre y carga relativa de rueda para la puerta M4-03. |
| `tools/mobility-envelope.mjs` | Comando de la envolvente cinemática. |
| `tests/mobility-envelope.test.mjs` | Regresión de la envolvente. |
| `docs/archive/2026-10-12/cal-04-mobility-envelope.md` | Métricas y decisiones de ajuste. |
| `docs/physics-mobility-tracker.md` | Historial e incidencias. |
| `docs/mobility-rebuild-plan.md` | Fases y puertas de salida. |
| `docs/car-soccer-rea-physics-contract.md` | Contrato de controles derivado estáticamente. |

## MOB-02 cerrada — 13 de octubre de 2026

MOB-02 queda aceptada. El cliente dispone de `?mob02=1`, una reproducción de
entrada basada en snapshots autoritativos que completó curva/pared, salto,
tramo aéreo y recuperación en una instancia RocketSim ampliada. Hubo HUD,
actitud/ACK y capturas de navegador, sin errores de consola. La cámara conservó
el horizonte durante el air roll. Se corrigió solo la etiqueta del HUD para
identificar las transiciones curvas. La regresión completa da **125/125**.

El siguiente trabajo es P3/MOB-03: dos pilotos, movimiento y combate sobre
poses RocketSim. Mantener el alcance: primero automatizar la campaña WebSocket
y observación de cliente; no ampliar el mapa ni ajustar física hasta clasificar
un defecto reproducible.

## MOB-03 cerrada — 13 de octubre de 2026

La campaña WebSocket de dos pilotos queda aceptada. La captura
`docs/reference-captures/rocketsim-two-pilot-mob-03.json` cubre movimiento
independiente sobre la arena ampliada y, por separado, contacto nativo y
combate alineado con cohetes, cooldown, eliminación, desactivación y respawn.
Todas las aserciones pasaron y no quedaron errores de runtime. La siguiente
unidad es P4/R9-01: seis coches en LAN limpia, con altas/bajas y entradas
independientes. No abrir aún bots, obstáculos ni despliegue online.

## R9-01 cerrada — 13 de octubre de 2026

La campaña LAN de seis pilotos queda aceptada. El runner
`npm run probe:rocketsim-six-pilot` creó la captura
`docs/reference-captures/rocketsim-six-pilot-lan-r9-01.json`: seis IDs únicos,
equipos alternos, ACK e inputs por ID, poses finitas, movimiento independiente
y cadencia `0,01/0,02 s`, sin errores. Tras cerrar el sexto socket, el roster
nativo se reconstruyó a cinco coches sin reintroducir su ID y una entrada de un
piloto restante volvió a confirmarse. La regresión completa es **125/125**.

La siguiente unidad es P5/GAME-01: sesión RocketSim de combate configurable.
Debe conservar autoridad de servidor y reutilizar las reglas de combate ya
probadas; no abrir todavía bots, decoración, matchmaking ni online público.

## GAME-01 cerrada — 13 de octubre de 2026

La sesión LAN de combate RocketSim para pilotos humanos queda aceptada. El
cliente puede solicitar capacidad de `1…6`; el servidor la valida y publica sin
aceptar coches, bots ni poses del cliente. La evidencia
`docs/reference-captures/rocketsim-configurable-combat-game-01.json` cubre
capacidad 3, tres pilotos, rechazo de una cuarta plaza, rechazo de reducción
activa, ACK y movimiento con cadencia nativa. El panel y HUD identifican
combate RocketSim, y la regresión completa es **127/127**.

El siguiente bloque es la reproducción de navegador de ARENA-02. La física
nativa de las esquinas ya está aceptada; no ampliar arte, obstáculos ni bots
antes de observar cámara/HUD con el perfil nuevo.

## ARENA-02 — evidencia nativa cerrada (13 de octubre de 2026)

`arsenal-expanded-cornered-practice` añade cuatro parches esféricos propios de
radio 8 y paneles de pared finitos para no solaparlos. La sonda
`npm run probe:rocketsim-cornered-arena` generó
`docs/reference-captures/rocketsim-cornered-practice-arena-02.json`: cuatro
coches, 180 ticks a 120 Hz, apoyo hasta pared sin hueco previo, sin normales
invertidas y cambio consecutivo máximo de 4,474°. El perfil anterior permanece
sin cambios como control.

La sonda adicional `npm run probe:rocketsim-cornered-camera` reprodujo 180
muestras de pose nativa a 60 Hz y recorrió los modos ground, wall y air. El
cambio máximo de rumbo fue 0,0467 rad/frame y la posición/foco respetaron los
límites de la arena ampliada.

La comprobación visual con `?mob02=1` queda aceptada en la instancia persistente
de `5284`: cargó el perfil, mostró `ESQUINAS CURVAS` y recorrió las seis fases
de la campaña sin errores de consola. La recuperación terminó como
`no-wheel-support`, resultado legítimo cuando el coche queda apoyado sobre la
carrocería; no se añade auto-enderezado.

## Actualización vigente — VIS-03

ARENA-02/03/04, VIS-02, VIS-03.1 y VIS-04 están aceptadas en sus contratos.
VIS-03 comprobó dos pestañas de
combate RocketSim en `5292`: HUD, equipos y colores de coche legibles y
consolas limpias. VIS-03.1 confirmó por WebSocket un cohete vivo en
`docs/reference-captures/rocketsim-projectile-visibility-vis03.json`. La
captura de píxeles queda pendiente sólo por el aislamiento del navegador. La
reproducción autoritativa de MOB-01 se repitió el 13/10/2026 con 829 snapshots,
25 ACK, curva, pared, salto, dodge, air roll/boost y recuperación a suelo; la
captura está en `docs/reference-captures/rocketsim-expanded-mobility-mob-01.json`.
El navegador integrado no alcanzó el servidor temporal de `5331` y devolvió
timeout, así que la captura de píxeles queda pendiente sin tocar el solver.
La siguiente unidad es conseguir una instancia persistente accesible para esa
observación; después se abre la puerta de combate correspondiente.

## Decisión de continuidad — 13 de octubre de 2026

No se implementa todavía. Cuando se autorice trabajo, se empieza por MOB-01V
en una instancia persistente accesible desde el navegador. Si esa observación
revela un defecto, se abre una corrección única de cámara, transporte,
geometría o solver. GAME-02 ya queda aceptada para la autoridad LAN: la nueva
sonda `npm run probe:rocketsim-combat-six` conectó seis pilotos, confirmó
movimiento, ACK, seis disparos, cohetes vivos y reconstrucción a cinco coches
tras una desconexión; la sonda 1v1 conservó daño, cooldown, eliminación y
respawn. La captura está en
`docs/reference-captures/rocketsim-combat-six-pilot-game-02.json` y la ficha
en `_bmad-output/implementation-artifacts/game-02-rocketsim-combat-lan-story.md`.
No se añaden bots, obstáculos ni online público antes de observar la sesión en
navegador o de abrir una corrección por un defecto reproducible.

## MOB-01V — bloqueo actual

Se inició una instancia persistente válida de RocketSim en 5336, pero el
navegador integrado falló al inicializarse antes de abrir la URL. El servidor
no era la causa: había un listener activo y fue cerrado tras la prueba. La
observación visual queda **No verificada** y se reintenta cuando el navegador
vuelva a estar disponible. No ajustar física ni cámara para compensar este
bloqueo. Los detalles están en
`_bmad-output/implementation-artifacts/mob-01v-persistent-browser-observation.md`.

Se reiniciaron las sesiones de automatización y ambas volvieron a fallar antes
de enumerar ventanas o pestañas. Es un fallo externo al repositorio; no crear
directorios ni modificar recursos internos de Codex como supuesto arreglo.

## MOB-01V cerrada — 13 de octubre de 2026

Codex se reinició y el navegador integrado volvió a estar operativo. La
instancia persistente RocketSim R9 en `http://127.0.0.1:5336/?mob02=1` cargó y
quedó abierta. La observación visual confirmó la arena con esquinas curvas,
suelo, paredes y techo; coche visible en transición; HUD con `grounded`, 2/2
saltos, actitud, giro y ACK de red; sin error de carga. El fallo anterior era
de la automatización de Codex. MOB-01V queda aceptada y no justifica cambios de
solver o cámara. La siguiente unidad es GAME-03 sólo ante un defecto
reproducible; después ARENA-05/VIS-05.

## VIS-05 — lectura de arena para combate (13 de octubre de 2026)

Se añadieron lavados de equipo de baja opacidad en los extremos y una guía
perimetral al perfil de práctica limpia. No se modificaron solver, contactos,
cámara, red, combate ni materiales del desguace. `node --check src/client.js`
y `npm test` terminaron verdes (**131/131**). La instancia RocketSim mantenida
por el usuario en `localhost:5189` confirmó visualmente arena, coche, HUD y ACK
sin error. La siguiente unidad es abrir el primer recurso de ARENA-05 de forma
aislada, con colisión nativa, visual compartido y una prueba específica.

## ARENA-05 cerrada en contrato — 13 de octubre de 2026

Se añadió el perfil opt-in `arsenal-expanded-block-practice`. Conserva
`arsenal-expanded-cornered-practice` y agrega un único bloque nativo de
14 × 4 × 18 en el centro; el cliente dibuja el mismo centro y dimensiones.
La sonda `npm run probe:rocketsim-block-arena` es determinista y confirmó
contacto frontal, bloqueo sin penetración, bypass lateral y ticks consecutivos.
La captura es `docs/reference-captures/rocketsim-block-practice-arena-05.json`.
La regresión completa queda en **132/132**.

Para probarlo visualmente sin detener el servidor actual, usar la copia enlazada
`.rocketsim-bridge-build-r9/rocketsim_bridge-r10.exe`:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\rocketsim_bridge-r10.exe)
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "practice"
$env:ROCKETSIM_ARENA = "arsenal-expanded-block-practice"
$env:PORT = "5190"
npm start
```

La instancia existente en `5189` no se interrumpió. Si se observa el perfil R10
en el navegador, sólo hay que confirmar que aparece el bloque y que el HUD
indica `BLOQUE DE PRUEBA`; esta comprobación no autoriza todavía cambios de
solver ni de cámara.

## Plan vigente post ARENA-05 — 13 de octubre de 2026

El usuario cerró su instancia R9 de `5189` y verificó visualmente ARENA-05 en la
copia R10 de `5190`. ARENA-05 queda aceptada como recurso único nativo + visual.

**Siguiente unidad exacta:**
`_bmad-output/implementation-artifacts/combat-geo-01-native-static-raycasts.md`.
El objetivo es añadir una consulta de segmento de cohete contra el mundo
estático de RocketSim. Es necesaria porque `src/rocketsim-combat.js` sólo
comprueba coches y límites; sin esa puerta los futuros recursos serían
atravesables por cohetes. No introducir rampa, composición de mapa, assets ni
ajustes de movilidad antes de cerrar COMBAT-GEO-01.

El plan completo está en
`_bmad-output/implementation-artifacts/roadmap-next-phase-2026-10-13.md`.
La siguiente compilación debe crear una nueva copia del bridge si el ejecutable
actual está en uso; cargar `VsDevCmd.bat` antes de CMake/link para que MSVC vea
las cabeceras del SDK.


## Relevo posterior a COMBAT-GEO-01 — 13/10/2026

La historia está aceptada. Archivos clave: `tools/rocketsim-bridge/main.cpp`
(consulta Bullet estática y conversión RocketSim y-up),
`src/rocketsim-protocol.js`/`src/rocketsim-backend.js` (contrato Node),
`tools/rocketsim-bridge/probe-static-raycast.mjs` y la captura
`docs/reference-captures/rocketsim-static-raycast-combat-geo-01.json`.
La build independiente es
`.rocketsim-bridge-build-r9/rocketsim_bridge-r11.exe`; no reemplaza ni detiene
la build que pueda estar sirviendo el usuario.

Comprobaciones: `npm test` 133/133; sonda estática determinista en dos
ejecuciones; sonda ARENA-05 sin regresión. No se hizo navegador porque no hay
cambio visual ni de movilidad. Siguiente unidad mínima: COMBAT-GEO-02,
consultar `raycast` al avanzar cada cohete y hacer que el primer impacto
estático compita con el vehículo dentro de la autoridad Node, con una prueba
de oclusión y sin modificar constantes de vuelo.

## Relevo posterior a COMBAT-GEO-02 — 13/10/2026

La oclusión nativa de cohetes está aceptada. `RocketSimPracticeMatch` exige la
capacidad declarada por el bridge, convierte cada tramo a RocketSim y-up,
consulta el primer impacto estático y lo entrega a `stepRocketSimCombat`; Node
sigue siendo dueño de daño, cooldown, score y respawn. Archivos principales:
`src/rocketsim-practice-match.js`, `src/rocketsim-combat.js` y sus pruebas.

Comprobaciones: `npm test` 135/135; smoke R8-02 con R11 verde; GAME-02 seis
pilotos con roster y desconexión verde. No se hizo navegador porque la historia
solo afecta combate autoritativo y no presentación. Siguiente unidad: ARENA-06,
rampa aislada de recurso nativo + visual; mantener fuera bots, decoración y
ajustes del solver aéreo.

## Relevo posterior a ARENA-06 — 13/10/2026

ARENA-06 queda aceptada. El perfil `arsenal-expanded-ramp-practice` comparte
una malla Bullet triangular y una visual Three.js de 20 × 18 × 4,5 unidades.
R12 es `.rocketsim-bridge-build-r9/rocketsim_bridge-r12.exe`. Las sondas
`npm run probe:rocketsim-ramp-arena` y `npm run probe:rocketsim-ramp-combat`
son deterministas y cubren recorrido, aterrizaje, bypass y oclusión de cohete.
`npm test` pasa 136/136. No se hizo navegador en esta ejecución; la siguiente
historia es ARENA-07 para componer los recursos validados en `combat-alpha`.

## Relevo ARENA-07 — 14/10/2026

La composición `combat-alpha` quedó aceptada para autoridad nativa y LAN:
parte de la arena cornered, sitúa el bloque en Arsenal `(0, -20)`, la rampa en
`(0, +20)` y reserva el corredor central. Configura seis spawns alternos en
`x=±48`, `z=-30/0/+30`, incluidos los yaw de aparición y respawn. El bridge,
Node y Three.js comparten este perfil; la campaña LAN y la sonda de geometría
están listas bajo `probe:rocketsim-combat-alpha-*`.

La regresión JavaScript está verde en **137/137** y R13 ya fue compilada por el
usuario. La presentación web queda pendiente por el aislamiento del navegador
integrado. El procedimiento reproducible está en
`_bmad-output/implementation-artifacts/arena-07-combat-alpha-story.md`.

## Resultado ARENA-07 — 14/10/2026

R13 compiló correctamente. La geometría determinista (`da62d643...`) confirmó
bloque, rampa, corredor central y seis spawns; las regresiones de raycast,
bloque, rampa y oclusión permanecen verdes. La campaña de seis pilotos pasó
todos sus checks y escribió
`docs/reference-captures/rocketsim-combat-six-pilot-arena-07.json`. La suite
final es **137/137**.

Se intentó abrir `http://localhost:5298/?arena=combat-alpha` con el servidor
R13 activo; el navegador integrado devolvió `ERR_CONNECTION_TIMED_OUT`. No se
declara verificación visual. La siguiente unidad es la observación web o, si
el navegador continúa aislado, VIS-06 con esa limitación explícita.

## Relevo VIS-06 — 14/10/2026

VIS-06 corrige un error de lectura: los lavados de equipo señalaban Z, pero
`combat-alpha` spawnea azul en X negativo y rojo en X positivo. Ahora los
lavados se alinean con esos lados y hay contorno del bloque, balizas de seis
spawns, guías del corredor central y anillo de centro. Solo cambia
`src/client.js`; `node --check` y `npm test` pasan con **137/137**.

La comprobación visual final está pendiente por aislamiento irregular del
navegador integrado. Para cerrarla en la instancia que ya inició el usuario,
usar Ctrl+F5 en `http://localhost:5298/?arena=combat-alpha` y confirmar que
las balizas azul/roja aparecen en los laterales, las líneas delimitan el
corredor y bloque/rampa siguen visibles. No abrir GAME-04 hasta registrarlo.

## Diagnóstico de entorno del navegador — 14/10/2026

El timeout quedó explicado: los servidores iniciados por `functions.exec` viven
en un sandbox con red y procesos separados del navegador integrado del
escritorio. El servidor puede anunciar `localhost:5300` y, aun así, el
navegador no puede conectarse. La solución es iniciar `npm start` en el
PowerShell principal del usuario, mantenerlo abierto y abrir
`127.0.0.1:<puerto>` en el navegador. El procedimiento, las comprobaciones
HTTP/WebSocket y la prevención están en
`docs/local-server-browser-bridge.md`.

## Cierre VIS-06 / GAME-04 — 14/10/2026

La instancia persistente `localhost:5300` cerró VIS-06: renderizó arena,
guías, balizas, bloque/rampa, coche, HUD y ACK; W actualizó velocidad. GAME-04
añade objetivo autoritativo 15, `roundState`, ganador y congelación de combate
al cerrar, con R para reiniciar. Dos pestañas locales probaron espera de un
piloto y activación/reconstrucción al entrar el segundo. `npm test` queda en
**139/139**. La siguiente unidad es ONLINE-01, limitada a guardas de sesión
LAN; no despliegue público, cuentas, bots ni cambios de física.

## ONLINE-01 implementada; cierre pendiente — 14/10/2026

ONLINE-01 añade el contrato LAN versionado en `src/lan-session-protocol.js` y
lo aplica en `server.mjs`. El navegador guarda un `sessionId` efímero en
`sessionStorage`, envía `hello` con versión/sala y heartbeat, y una reconexión
durante cuatro segundos recupera el mismo ID y plaza. El parser WebSocket
rechaza frames sin máscara o mayores de 8192 bytes; el servidor limita entradas
a 180 por segundo y permite localhost/127.0.0.1 o una allowlist explícita de
`LAN_ALLOWED_ORIGINS`. Las sondas existentes usan el saludo nuevo; la suite
añade pruebas puras del contrato. La suite completa pasa; el cliente actualizado
carga y mantiene ACK contra `localhost:5300`. No se abrió TLS, cuentas,
matchmaking ni Internet pública. La prueba de reconexión contra el servidor
queda pendiente: el sandbox no permite que el probe hijo abra su socket loopback.

## Incidencia de bridge — 14/10/2026

Durante un reinicio de `node --watch`, el host informó `RocketSim bridge request
timed out after 100ms` en el primer tick. El bridge sí imprimió
`backend=rocketsim`, por lo que no era una ruta de ejecutable inválida. Se
elevó el timeout de desarrollo a 250 ms, se añadió `ROCKETSIM_REQUEST_TIMEOUT_MS`
y el error conserva stderr del sidecar. El smoke R13 y la regresión completa
**139/139** pasan. La recuperación operativa está documentada en
[`bridge-timeout-recovery.md`](bridge-timeout-recovery.md); el usuario debe
reiniciar la instancia que ya quedó en `runtime stopped` para cargar este
cambio.

## Siguiente ejecución — MOB-AIR-01 (14/10/2026)

La nueva campaña de navegador está en
`_bmad-output/implementation-artifacts/mob-air-01-browser-campaign-story.md`.
Con el servidor RocketSim del host activo, abrir
`http://127.0.0.1:5298/?arena=combat-alpha&mobair01=1` y hacer Ctrl+F5. La
consola debe mostrar `settle`, `first-jump`, `release`,
`directed-second-jump`, `air-control` y `done`, y el informe debe indicar los
seriales `firstJumpObserved`, `directedSecondJumpObserved` y `dodgeObserved`.
La suite local posterior a la edición es **143/143**. Si la URL no conecta,
la prueba queda no verificada por la frontera sandbox/PowerShell descrita en
`docs/local-server-browser-bridge.md`; no se debe cambiar el solver por ese
fallo de entorno.

## Incidencia de observación MOB-AIR-01

La pestaña persistente de `localhost:5300` cargó la sesión RocketSim y mostró
HUD autoritativo antes de la campaña. Al recargar para descargar el cliente
MOB-AIR-01, Computer Use informó que el navegador no estaba disponible. No es
un error HTTP, WebSocket ni del bridge y no autoriza cambios al solver. El
reintento correcto es recuperar la automatización y recargar la misma URL;
el HUD debe enseñar `MOB-AIR` y los tres indicadores J/2/D.

## Cliente servido desactualizado — 14/10/2026

La navegación a `localhost:5300/?arena=combat-alpha&mobair01=1` confirmó HUD,
ACK y servidor vivos, pero no el marcador `MOB-AIR` del cliente actual ni sus
logs, incluso tras recarga sin caché. Se clasifica como entrega local de una
versión previa. Antes de aceptar MOB-AIR-01 hay que reiniciar el host desde la
raíz del workspace; no tocar física, cámara ni bridge por esta evidencia.

## Evidencia nativa MOB-AIR-01 — 14/10/2026

La prueba directa del ejecutable R13 con dos coches y 180 ticks confirmó la
secuencia sin navegador: `first-jump` aparece en el tick 6 y el `dodge` dirigido
con `throttle=1, steer=1, jump=true, roll=1` aparece en el tick 36. La campaña
web usa ahora esa misma condición autoritativa. `npm test` pasa **144/144**.

## Incidencia resuelta — reinicios concurrentes

El cierre observado al cambiar de variante no era una nueva incompatibilidad
del localhost: MOB-AIR enviaba `restart` por frame. La guarda one-shot está
aplicada a MOB-AIR y MOB-02; la campaña espera `actionSerials.respawn`. Suite
posterior: **146/146**. El lanzador persistente evita además volver a copiar
variables de entorno.

## Estado posterior a la recuperación — 14/10/2026

La suite integrada posterior a la corrección queda en 148/148. Se añadió una
prueba de reinicio cuando el bridge ya está separado y una prueba que impide que
MOB-AIR actúe sobre un coche remoto durante una reconstrucción de roster. La
sesión persistente localhost:5300 sigue viva con ACK y
MOB-AIR done · front · J sí · 2 sí · D sí. Side/diagonal no se aceptan aún:
deben ejecutarse en una sola pestaña por variante para aislar el serial de
respawn.

## Estado de iteración MOB-AIR-02 — 14/10/2026

Se añadió el identificador state.time al reproductor aéreo y el resultado
snapshot-stalled. El navegador persistente mostró diagonal en first-jump con
ACK inmóvil, por lo que la prueba quedó no verificada en vez de aceptar un
resultado inventado. La suite es 149/149 y el smoke R13 permanece verde.

## Corrección de estabilidad de roster — 14/10/2026

La incidencia `tick must advance by one with the configured car IDs` no era
una diferencia de física: se producía al salir el último piloto después de que
el bridge hubiese quedado configurado con un ID distinto de `1`. El tick vacío
usa `[1]`, por lo que ahora `removeHuman` reconstruye de forma explícita el
bridge al roster inerte `[1]` incluso con cero humanos. La prueba de regresión
cubre las transiciones `[1,2] → [2] → [1]`, incluida la reanudación desde el
tick nativo `1`. La siguiente acción es revalidar la suite y el smoke R13; la
observación web de MOB-AIR permanece separada de esta corrección de transporte.

### Validación en host

Tras la edición, la instancia persistente `http://localhost:5300` se recargó
con `?arena=combat-alpha&mobair01=1`. El servidor reinició la ronda, publicó
ACK, mantuvo el coche en estado `grounded` y no emitió errores ni avisos de
consola durante la campaña. La ejecución acabó con `R wheel-support` sin
seriales J/2/D, por lo que solamente acepta la estabilidad del runtime; no es
evidencia de fidelidad del segundo salto ni autoriza ajustar el solver aéreo.

## Observación MOB-AIR posterior a la corrección — 14/10/2026

En `localhost:5300/?arena=combat-alpha&mobair01=1&dodge=front`, la campaña
recorrió todas sus fases y dejó la consola sin errores. El HUD mostraba `2/6
PILOTOS` y el ACK quedó congelado; por ello J/2/D permanecen sin confirmar. Es
una sesión compartida o stale, no una prueba válida del solver. Para cerrar
MOB-AIR se necesita un proceso host limpio, una sola sesión y `1/6 pilotos` con
ACK creciente. No modificar física, cámara ni control aéreo con esta evidencia.

## Reintento MOB-AIR tras reinicio — 14/10/2026

El host reiniciado publicó ACK creciente y latencia estable (`5 ms`), y la
campaña frontal recorrió `settle`, `first-jump`, `release`,
`directed-second-jump`, `air-control` y `recover` sin errores. Persistió
`2/6 pilotos` y el informe terminó sin J/2/D. Se clasifica como integración de
sesión aún no verificada: la física nativa R13 sí tiene evidencia separada.
Antes de ajustar movilidad hay que eliminar la segunda sesión del host o usar
una sala/proceso limpio y obtener `1/6 pilotos` con seriales observados.

## Evidencia nativa R13 — 14/10/2026

El bridge R13 pasó air roll libre contra roll direccional equivalente en 48
muestras con hashes idénticos. La captura de curvas nativas completó 15
escenarios, incluidos doble salto, dodge frontal/lateral/diagonal y control
Aéreo. Esta evidencia no sustituye la observación WebSocket; confirma que no
hay motivo para retocar el solver mientras el navegador conserve `2/6 pilotos`.

## Guard de evidencia MOB-AIR — 14/10/2026

La campaña ya no etiqueta como `wheel-support` una ejecución que aterriza sin
haber observado los seriales de primer salto, segundo salto/dodge y dodge.
Ahora publica `R actions-missing`; esto separa una sesión WebSocket incompleta
de una recuperación física válida y evita usarla para calibrar el solver.

## Guard de sesión compartida MOB-AIR — 14/10/2026

MOB-AIR ya no inicia ni mantiene inputs cuando la autoridad publica más de un
piloto. En ese caso el HUD muestra `awaiting-solo-player`; si el segundo piloto
entra después del arranque, la campaña termina como `R session-not-isolated`.
La regresión completa queda en **153/153**. En la instancia `localhost:5300`
la guarda se observó activa con `2/6 pilotos`, sin errores de consola y sin
reiniciar la ronda. Esto resuelve la contaminación de la prueba, pero no
sustituye la futura observación con `1/6` y seriales J/2/D.

## Preparación COMBAT-PLAY-01 — 14/10/2026

R13 pasó las sondas nativas de estado de combate, geometría `combat-alpha` y
raycast estático. La evidencia cubre seis spawns, bloque, rampa, oclusión,
desactivación, respawn y tick posterior. La campaña WebSocket 1v1/6v6 sigue
siendo host-only y no se debe inferir desde el sandbox. MOB-AIR continúa
bloqueada hasta lograr un roster aislado `1/6` con seriales J/2/D.

## Revalidación de relevo — 14/10/2026

La suite local posterior a esta iteración pasa **153/153** y `git diff --check`
queda limpio. El siguiente paso operativo no es cambiar física: ejecutar desde
PowerShell las sondas `probe:rocketsim-combat-websocket` y
`probe:rocketsim-combat-six` con el bridge R13. Sus servidores de prueba usan
puertos propios y no requieren cerrar la instancia interactiva de `5300`.

## Resultado de las sondas WebSocket — 14/10/2026

`probe:rocketsim-combat-six` queda **aceptada** en `combat-alpha`: los seis
pilotos tienen ACK, movimiento y disparo, y la desconexión reconstruye el
roster sin errores. La sonda 1v1 queda **fallida por configuración** en su
primera ejecución: recibió `combat-alpha`, cuyos dos primeros spawns están en
esquinas diagonales, y agotó el tiempo esperando el impacto directo. R8-02
debe ejecutarse con `combat-lineup`; esto no aporta evidencia contra el bridge
ni contra la física.

R8-02 incorpora una precondición de perfil: solo acepta `combat-lineup`, que
es el único spawn diseñado para el impacto frontal determinista. La protección
se verificó con `node --check` y una ejecución intencionalmente inválida; la
suite posterior continúa en **153/153**. Repetir la sonda 1v1 desde el host es
la siguiente unidad mínima.

## Cierre de COMBAT-PLAY-01 — 14/10/2026

La repetición host de R8-02 en `combat-lineup` terminó **aceptada**. Su captura
JSON confirma ACK hasta 6, dos disparos válidos, cooldown rechazado, daño,
eliminación, caída nativa, respawn, cadencia `0,01/0,02 s` y cero errores. La
sonda 6v6 ya estaba aceptada en `combat-alpha`; por tanto, la capa autoritativa
de combate 1v1/6v6 queda cerrada.

Siguiente puerta: BRIDGE-01. Hay que observar un reinicio persistente de
`start:watch` en el PowerShell anfitrión. Hasta esa confirmación MOB-AIR-01
visual permanece aplazada y no se retoca el solver aéreo.

## Observación del host tras reinicio — 14/10/2026

La pestaña de `localhost:5300` volvió a conectar después del reinicio del
PowerShell y no muestra errores, pero la autoridad sigue anunciando `2/6
pilotos`. MOB-AIR queda correctamente en `awaiting-solo-player`, sin enviar
inputs ni reiniciar la ronda. Hay que cerrar la otra sesión WebSocket del host
o iniciar una instancia limpia con una sola pestaña antes de aceptar J/2/D;
esta observación no justifica tocar la física.

La campaña frontal se reintentó cuando el roster quedó en `1/6` y fue
**aceptada**: `MOB-AIR done · front · J sí · 2 sí · D sí · R wheel-support`,
ACK creciente y sin errores de consola. La variante `side` se abrió después,
pero su snapshot quedó congelado en ACK 2441 y acabó `actions-missing`; se
clasifica **no verificada** y debe repetirse con una conexión que avance antes
de comparar el dodge.

## LIVENESS-01 — 14/10/2026

Se corrigió el hueco de cliente que permitía mostrar eternamente el último
snapshot cuando un WebSocket seguía abierto pero el servidor dejaba de publicar
`state`. `lan-client-liveness` vence a los 8 s sin estado autoritativo y cierra
la conexión para activar el flujo de reconexión ya existente; los heartbeats
no cuentan como estado. También se aíslan los listeners/timers de conexiones
viejas. Pruebas puras de la regla y suite completa: **157/157**.

La prueba real de la variante side se hizo contra un host que dejó ACK 616
congelado; por ello la recuperación integrada está **no verificada**, y side
continúa sin evidencia de física. Tras reiniciar el host, abrir una sola
pestaña con `?arena=combat-alpha&mobair01=1&dodge=side`, esperar la campaña y
aceptarla solo si el ACK avanza y aparecen J/2/D.

En la URL normal, una pulsación de avance tampoco actualizó ACK 2643 ni la
velocidad. El problema activo queda delimitado al proceso host que dejó de
publicar snapshots; no es una diferencia de controles o de RocketSim que se
pueda calibrar desde el navegador. Para diagnosticarlo hace falta registrar
las últimas líneas de `start:watch` cuando ocurra.

## Confirmación del host normal — 14/10/2026

El usuario verificó que la partida funciona normalmente tras el reinicio. La
pestaña integrada detecta `2/6 pilotos`, coherente con una segunda sesión de
juego activa; por respeto a esa partida no se lanzan campañas MOB-AIR que
reinician la ronda. BRIDGE-01 queda aceptada para arranque normal. La prueba
integrada de LIVENESS-01 y MOB-AIR lateral seguirá pendiente hasta disponer de
un roster aislado de un piloto.
