# Hoja de ruta de migración física a RocketSim

Actualizado: 12 de octubre de 2026  
Estado: **R8-01, R8-02, ARENA-01 y VIS-01 tienen evidencia aceptada.** Este
documento conserva la arquitectura y límites de la integración. El orden de
trabajo vigente está en [current-development-roadmap.md](current-development-roadmap.md):
la siguiente historia es MOB-01, sin ajuste especulativo de física.

## Objetivo

Conseguir una movilidad aérea, un segundo salto, un dodge y unos aterrizajes
con una respuesta cercana a Rocket League, conservando el juego de combate,
la red y el cliente Three.js de Car Soccer: Arsenal.

RocketSim se usará como simulador nativo de movimiento. No se copiarán código,
binarios, WebAssembly ni recursos de Rocket League. La integración se hará por
un adaptador versionado y reversible.

## Decisión arquitectónica

```text
cliente Three.js
      │ inputs / snapshots
      ▼
Node ArenaMatch (red, combate, bots, respawn, puntuación)
      │ MovementBackend
      ├── js       → solver actual, fallback
      └── rocketsim → proceso nativo persistente, solo movimiento
```

El proceso nativo ejecutará RocketSim a 120 Hz. Node seguirá publicando estados
por WebSocket a 60 Hz. En R5 solo habrá un coche y una arena limpia de seis
planos sintéticos; no se conectan todavía cohetes ni bots.

### Qué está migrado y qué no

| Parte | Estado actual | Motivo |
| --- | --- | --- |
| Solver del coche, ruedas, suspensión, salto, doble salto, dodge y vuelo | **Migrado en la práctica** | El bridge se compila desde el commit público fijado de RocketSim y ejecuta `Arena::Step`/`Car` nativos a 120 Hz. |
| Transporte al navegador | **Adaptado** | Node traduce coordenadas z-up a y-up y publica snapshots; Three.js no ejecuta C++ ni Bullet. |
| Paredes y techo de `arsenal-practice` | **Sintéticos** | Son seis planos para aislar el movimiento; sirven para medir contactos, no para reproducir una arena Soccar curva. |
| Mallas de colisión de Soccar | **No disponibles en el clon** | RocketSim las carga desde archivos externos; `InitFromMem({}, true)` no las incluye. |
| Combate 3v3, bots, rockets, daño y puntuación | **Sigue en el backend JavaScript** | R7 mantiene la integración opt-in de un solo coche para no mezclar una migración no validada con el modo de juego. |

Por eso sí podemos usar el código exacto del simulador donde ya está conectado,
pero no basta con copiar una clase: el navegador necesita un adaptador, la
arena necesita sus datos de colisión y el juego necesita mapear seis coches y
sus sistemas de combate. La siguiente migración segura debe ampliar el bridge
por capas, conservando una prueba nativa reproducible en cada paso.

## Fases y puertas

### R5 — Puente aislado y contrato

**Estado: aceptada.** El puente compiló con MSVC/CMake/Ninja y el smoke test
ejecutó `init`, 120 ticks con salto y `shutdown`. La suite Node quedó en 98/98.

- Ejecutable C++ persistente basado en el commit fijado de RocketSim.
- Protocolo JSONL de `init`, `tick` y `shutdown`.
- Conversión explícita de ejes RocketSim (z-up) a Arsenal (y-up).
- Estado normalizado: posición, velocidad, orientación, velocidad angular,
  apoyo de ruedas, salto, doble salto y dodge.
- El ejecutable debe poder arrancar sin assets de Rocket League.

**Puerta:** un mismo guion produce la misma traza dos veces y el cliente Node
puede iniciar, avanzar y cerrar el proceso sin dejarlo huérfano.

La comparación de hash y la prueba de seis planos siguen siendo la entrada de
R6; la ejecución aislada no autoriza aún cambiar el backend de producción.
El smoke de R5 produjo el hash `e9e6aec1ff93aab4e4156381854f2d7c9ea21f3249c07c323608edf2e95f30e1`
en dos ejecuciones consecutivas.

### R6 — Comparación de movimiento

#### R6-01 — Trazas de suelo fiables

**Estado: aceptada el 12 de octubre de 2026.** Esta historia no conecta RocketSim a la partida. Primero
repara dos defectos de frontera encontrados en la revisión de R5: las
posiciones de pared y techo se deben convertir de Unreal Units a Bullet, y el
free air roll debe anular yaw mientras conserva el `roll` que ya compone el
adaptador de entradas. También hace estricto el contrato de 120 Hz para que un
tick perdido, una configuración distinta o un estado no finito no se convierta
en una curva aparentemente válida.

Su salida es un capturador reproducible para los seis escenarios del manifiesto
actual que parten de suelo (`ground-control`, primer salto, doble salto y los
tres dodges). Cada traza debe tener 144 muestras consecutivas en el mismo JSON
que consume `compareCurveTraces`. Los casos que parten ya en el aire quedan
deliberadamente fuera de R6-01: necesitan un perfil nativo de estado inicial
sin contacto incidental y se abrirán como R6-02.

**Criterios de aceptación:**

1. El sidecar acepta exclusivamente esquema 1, 120 Hz, arena limpia y un coche
   con id 1; los ticks deben ser consecutivos.
2. La conversión publica vectores lineales, orientación y velocidad angular
   coherentes en y-up; las tasas locales usan los ejes `pitch/yaw/roll`.
3. Shift + dirección conserva el valor `roll` ya compuesto y publica `yaw=0`.
4. Dos capturas del mismo manifiesto producen el mismo resumen, se pueden
   pasar sin transformación manual al comparador, y no contienen valores no
   finitos.
5. `npm test` sigue en verde. La simulación y el servidor de producción no se
   modifican.

La evidencia y los hashes reproducibles están en
[`archive/2026-10-12/rocketsim-bridge-r6-01.md`](archive/2026-10-12/rocketsim-bridge-r6-01.md). La regresión quedó en
**100/100** y el capturador produjo seis trazas de 144 muestras compatibles con
el comparador existente.

#### R6-02 — Estados iniciales aéreos y comparativa

**Estado: aceptada el 12 de octubre de 2026.** El bridge genera los perfiles
`air-void` y `second-action-airborne`, captura los quince escenarios a 120 Hz
y repite el SHA-256
`261012f20888fc43411b82dc5a19d85146c9d5c2fd0d7f7da1cfe319b4ad634d`.
Free air roll coincide bit a bit con roll directo una vez compuesto el input
del vehículo. La evidencia completa está en
[`archive/2026-10-12/rocketsim-bridge-r6-02.md`](archive/2026-10-12/rocketsim-bridge-r6-02.md).

La comparación con el solver propio confirma el foco de la siguiente fase:
aire aislado dentro de 1,3° y dodges iniciados en aire dentro de 1,2°, pero
primer salto y dodges que parten de suelo entre 24,6° y 41,1°. No se ajustarán
los torques aéreos con esa evidencia; R7-01 lleva RocketSim a una práctica
opt-in de un coche.

- Añadir perfiles nativos explícitos para aire y segundo salto preparado.
- Capturar ejes aéreos, free air roll y dodges desde aire.
- Comparar eventos dentro de un tick de 120 Hz.

- Alimentar al puente con las maniobras R0/R1/R2/R3/R4 existentes.
- Comparar eventos dentro de un tick de 120 Hz.
- Error inicial objetivo: 5 % en trayectorias cortas, 5° en actitud y 10 % en
  conservación de velocidad.
- Añadir pared, esquina y techo antes de declarar equivalencia de contactos.

**Puerta:** RocketSim mejora de forma repetible el aire y los aterrizajes sin
superar un tick de latencia ni romper el contrato de entradas. Esta medición
quedó satisfecha como comparación aislada; la latencia del servidor real se
abre en R7-01.

### R7 — Backend con fallback

#### R7-01 — práctica RocketSim de un coche

**Estado: aceptada el 12 de octubre de 2026.** El servidor conserva JavaScript
por defecto y permite seleccionar `MOVEMENT_BACKEND=rocketsim` para una
práctica limpia de un piloto. `RocketSimPracticeMatch` mantiene autoridad
WebSocket en Node, consume exactamente dos ticks nativos por snapshot de 60 Hz
y rechaza fallback silencioso. La build nativa y el smoke real pasaron; la
suite queda en 105/105 y la carga navegable fue verificada con HUD y ACK.

La latencia observada del sidecar fue mediana `0,877 ms`, p95 `1,343 ms` y
máximo `4,046 ms` por snapshot. La validación visual de saltos, doble salto y
dodge queda explícitamente abierta en R7-02.

- Exponer `MOVEMENT_BACKEND=js|rocketsim` en el servidor.
- Mantener JavaScript como valor predeterminado y no hacer fallback silencioso
  durante una sesión RocketSim.
- Conectar solo una práctica limpia de un coche, sin bots, combate, pads ni
  recursos del desguace.
- Aplicar una conversión de presentación uniforme y probar dos pasos nativos
  por snapshot de 60 Hz.
- Versionar los errores y el cierre del proceso nativo.

R7-02 decidirá, con una prueba visual y medidas de cadencia, si el modo de
práctica puede convertirse en la base de la integración de contactos de
partida. No se abre R8 hasta entonces.

#### R7-02 — sonda autoritativa de salto y vuelo

**Estado: medida el 12 de octubre de 2026; revisión visual pendiente.** La
sonda `npm run probe:rocketsim-practice` arrancó el servidor real con un piloto
y guardó 94 snapshots en
[`rocketsim-practice-r7-02.json`](reference-captures/rocketsim-practice-r7-02.json).
Los ACK fueron 18/18; la cadencia media fue `16,67 ms` frente a `16,67 ms`
esperados, con deltas redondeados de `10–20 ms`. Se observaron los seriales de
primer salto, doble salto y dodge dirigido, además de velocidad angular en la
fase de vuelo.

Esto demuestra el contrato autoritativo y la cadencia del modo de práctica,
pero no declara todavía que la cámara o el tacto visual sean equivalentes a
Rocket League. R7-03 será una comprobación visual guiada y una comparación de
aterrizaje antes de conectar este backend a combate.

#### R7-03 — contacto nativo de pared y límite de la arena (12 de octubre de 2026)

**Estado: aceptada como contacto plano; integración de combate aplazada.** La sonda
`npm run probe:rocketsim-contacts` ejecuta 360 ticks del mismo bridge nativo y
guarda [`rocketsim-practice-contacts-r7-03.json`](reference-captures/rocketsim-practice-contacts-r7-03.json).
El primer contacto de carrocería aparece en el tick 220 con normal `(-1, 0, 0)`;
un tick después siguen publicados el contacto nativo y la respuesta de
velocidad, mientras el apoyo pasa de cuatro a dos ruedas. Esto prueba que el
sidecar y el contrato `worldContact.normal` transportan una colisión real de
Bullet/RocketSim sin que JavaScript invente el rebote.

La limitación es material: `arsenal-practice` construye seis planos sintéticos.
El repositorio de RocketSim contiene el código que carga la arena Soccar, pero
`InitFromMem({ }, true)` no incluye las mallas de colisión; `Arena::Create(SOCCAR)`
falla si no se suministran esos archivos. Por eso todavía no podemos afirmar
que la transición suelo-pared curva de Rocket League esté migrada. El siguiente
paso debe aportar una fuente autorizada de mallas compatibles o mantener esta
práctica como validación de movimiento en una arena propia; no se ajustarán
constantes para ocultar la ausencia de geometría.

#### R7-04 — arena original con transición curva (12 de octubre de 2026)

**Estado: aceptada el 12 de octubre de 2026.** El sidecar añade el perfil
`arsenal-curved-practice` con una malla propia de cuarto de cilindro, extruida
entre los límites laterales y continuada con pared y techo planos. La malla se
construye una vez por proceso y se reutiliza si el bridge recibe otro `init`,
evitando acumular meshes al reiniciar una arena.

La sonda `npm run probe:rocketsim-curved-arena` repitió la traza a 120 Hz con
el SHA `7da59d6caacd75a3ab9e24d302c203913f1d342fad3d1a51f822791ed6c0757d`.
El coche entra en apoyo inclinado en el tick 215, alcanza apoyo pronunciado en
el 229 y no registra huecos de contacto antes de la pared. La normal de rueda
se publica desde RocketSim y el mayor salto angular entre muestras fue
`5,625°`, con un límite de `8°`; se registraron 68 muestras de transición y
ocho checkpoints finitos. La orientación se conserva como quaternion en la
captura.

Esta puerta valida continuidad de una geometría de entrenamiento propia, no la
malla interna de Rocket League ni una equivalencia de su arena Soccar. El
perfil aún no se selecciona desde la práctica navegable: R7-05 lo conectará a
la sesión de navegador y medirá cámara y controles antes de abrir R8.

### R8 — Juego completo

- Adaptar hitboxes y coordenadas a cohetes, daño, respawn y bots.
- Integrar pads, equipos y puntuación después de validar el movimiento aislado.
- Comparar carga y latencia con seis coches.

### R9 — Arena propia

- Sustituir los seis planos por colisiones de la arena limpia del juego.
- Reintroducir rampas y coberturas solo después de cerrar paredes, esquinas y
  techo.

## Plan operativo actualizado — 12 de octubre de 2026

La migración se ejecuta en estas puertas, en este orden. Cada puerta conserva
la anterior como regresión y no cambia `npm start` hasta que exista evidencia
del siguiente contrato.

1. **R7-04 · arena original curva:** **aceptada**. El sidecar tiene una
   transición propia suelo-pared, techo y límites limpios. La sonda observa
   continuidad de posición, orientación, contacto y apoyo a 120 Hz. No se usan
   mallas de Rocket League ni se declara equivalencia exacta de geometría.
2. **R7-05 · práctica jugable:** **R7-05a/b/c aceptadas como práctica y medición**. El servidor acepta el
   perfil curvo y el cliente selecciona su geometría visual mediante
   `settings.practiceArena`; HTTP, WebSocket, ACK y consola se verificaron.
   La sonda recorre apoyo inclinado, pronunciado y pared; la cámara queda bajo
   el techo de la práctica y el coche sigue visible. **R7-05c** ejecuta salto,
   segundo salto/dodge, air roll, nitro y recuperación desde apoyo de pared con
   una sonda WebSocket automatizada. La evidencia automatizada y el juicio
   visual siguen separados; R8-01 comienza ahora con la práctica de un coche
   como regresión.
3. **R8-01 · movimiento nativo multivehículo:** **R8-01a y R8-01b aceptadas.**
   El sidecar acepta 1–6 coches, IDs estables, equipos e inputs por ID; dos
   coches se comprobaron durante 180 ticks y las listas inválidas se rechazan
   en el ejecutable. La práctica WebSocket asigna plazas, conserva el equipo y
   el input por piloto y reconstruye el roster nativo al cambiar altas o bajas,
   sin dejar coches marcadores que alteren las colisiones. La regresión de un
   coche permanece activa.
4. **R8-02 · combate autoritativo:** aceptado como transporte y ciclo de
   combate. RocketSim será el único dueño
   de pose, velocidad, rotación y colisiones de vehículos; Node conservará
   rockets, daño, puntuación y reglas mediante comandos versionados de respawn.
   La capa determinista de reglas ya está separada en
   `src/rocketsim-combat.js`, con disparo por flanco, cooldown, daño y
   temporizador de respawn. La build R8 compilada en
   `.rocketsim-bridge-build-r9/` implementa `respawn` y `combat-state`; la
   sonda `npm run probe:rocketsim-combat-state` cubre desactivación, respawn y
   continuidad del tick. La sonda `npm run probe:rocketsim-combat-websocket`
   conecta dos clientes, valida equipos, ACK, cadencia y cooldown, y guarda
   `docs/reference-captures/rocketsim-combat-websocket-r8-02.json`. El perfil
   de sonda nativo `combat-lineup` midió dos impactos, cooldown, eliminación,
   desactivación y respawn con dos pilotos. No se mutarán velocidades nativas
   desde JavaScript.
5. **R9 · servicio web:** medir seis coches en LAN y preparar sesiones,
   TLS/WSS, autenticación y límites antes de exponer Internet. Es una fase
   posterior y no añade campos de sala al protocolo actual.

## Próximas mejoras de experiencia

Estas tareas siguen a R8-02 y se mantienen separadas para poder atribuir cada
mejora a una causa concreta:

- **UX-01 · cámara aérea y de pared:** capturar la transición aire→pared,
  conducción por pared, salida y aterrizaje; limitar aceleración de posición,
  foco y rumbo sin ocultar la actitud del coche. **UX-01a hecha:** la cámara
  tiene una respuesta más lenta en aire y pared, con pruebas deterministas;
  falta comprobación visual de las maniobras. No se tocará la física.
- **ARENA-01 · arena limpia ampliada:** definir una única escala y una malla
  compartida para las cuatro transiciones suelo-pared curvas. La geometría
  nativa, la visual de Three.js, los límites de cámara y los spawns deben usar
  los mismos parámetros. Las esquinas y las transiciones techo-pared quedan
  fuera hasta decidirlas expresamente. **Aceptada como perfil opt-in**:
  `arsenal-expanded-curved-practice` usa `144×108×30`, radio `8` y 32
  segmentos en cuatro quarter-pipes propios. No cambia `arsenal-practice` ni
  `arsenal-curved-practice`; la sonda de cuatro coches produjo el SHA
  `4b548e8e02c7d9c40b99e53364fe1676ea7511739f66db74b072ede923f028dd`.
- **VIS-01 · legibilidad visual:** **implementada en configuración**. Las
  prácticas limpias usan fondo, niebla, materiales y rejilla más claros, con
  colores separados para suelo, paredes, techo y curvas; el desguace conserva
  su tema. La carga visual en navegador de la práctica ampliada quedó verificada
  sin errores de consola; falta una prueba reproducible con coche y proyectil
  recorriendo suelo, pared y techo.

**Criterio de no avance:** una puerta se aplaza si introduce doble autoridad,
latencia superior a un tick nativo, pérdida de determinismo o una regresión de
la suite de 121 pruebas. El fallback JavaScript sigue siendo explícito por
sesión hasta cerrar R8-02.

## Criterios de parada

Se revierte a JavaScript si el puente introduce más de un tick de latencia,
divergencias de coordenadas no atribuibles, doble colisión, pérdida de
determinismo o una regresión en las 119 pruebas actuales. RocketSim no se
convertirá en backend predeterminado sin una comparación medible y una prueba
visual posterior.

## Evidencia y procedencia

- RocketSim permanece fuera del bundle del juego y se fija por commit.
- La licencia MIT y los avisos de Bullet deben conservarse si se distribuye el
  binario.
- Las trazas R1–R4 y el solver actual siguen siendo la línea base.
- La build de BMad no pudo resolver su intérprete `uv` en este entorno por un
  error de permisos de caché; se mantuvo la configuración personalizada y se
  aplicó manualmente el flujo de arquitectura e historia.
