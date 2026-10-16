# Hoja de traducción de referencias de movilidad

## Propósito y límite

Car Soccer: Arsenal es una implementación original. Este documento convierte
evidencia de las referencias en requisitos comprobables del proyecto; no
transfiere código, datos, constantes, binarios, WebAssembly, modelos ni
recursos de Rocket League ni de Car Soccer. La similitud buscada es de control
percibido y de arquitectura de movimiento, y solo puede afirmarse después de
pruebas repetidas con el mismo guion de entrada.

Las fuentes estáticas originales están en
`_bmad-output/planning-artifacts/rl-reference-mobility.md` y
`_bmad-output/planning-artifacts/car-soccer-rea-static-findings.md`.

## Qué se puede aprovechar

| Evidencia observada | Traducción original en este juego | Cómo se verifica | Estado |
| --- | --- | --- | --- |
| Simulación con paso fijo de 120 Hz | `PHYSICS_STEP` y subpasos autoritativos en `ArenaMatch` | Misma semilla e input agrupado producen la misma traza | Implementado |
| Coche definido por posición, orientación, velocidad lineal y angular | Quaternion y tasas locales publicadas en el snapshot | `airAxes`, `airManeuver` y las pruebas de cadencia | Implementado |
| Giro aéreo aplicado en ejes propios del vehículo | Un vector de velocidad angular local se integra en una sola rotación | Ejes aislados, combinación, inversión y amortiguación | Implementado |
| Salto, doble salto y dodge son ventanas temporales distintas | Estados `first-jump`, `double-jump`, `dodge` y `airborne` | Secuencias de salto, dirección capturada y aterrizaje | Implementado |
| El dodge se compromete en el marco local al accionarlo | Impulso diagonal normalizado que conserva la dirección capturada | Ocho dodges y cambio posterior de entrada | Implementado |
| El nitro es fuerza continua alineada con el morro | Aceleración según el vector delantero del quaternion | Ascenso con morro elevado y descenso con morro bajo | Implementado |
| Contacto distingue corrección normal y movimiento tangencial | Caja orientada, cuatro ruedas con suspensión y seis planos de CAL-01 | Suelo, pared, techo, esquinas y transición de apoyo | Implementado |
| El cliente presenta estado autoritativo con interpolación temporal | Buffer de snapshots con posición lineal y slerp quaternion; cámara y coche leen la misma pose de presentación | Pruebas de continuidad, respawn, teletransporte, reloj de presentación y conexión detenida | Implementado: FIS-15A |
| Acciones discretas publican seriales de evento | Seriales propios de salto, doble salto, dodge y respawn; el cliente consume cada aumento una vez | Transición de acción, pulsación mantenida y respawn quedan cubiertos por pruebas | Implementado: FIS-15B |
| Entradas de red conservan secuencia reciente | Cliente etiqueta entradas; servidor confirma la última aplicada; la conciliación sigue diferida | Pruebas de secuencia, ACK único, memoria acotada y medición en CALIBRACIÓN LIMPIA | Instrumentación: FIS-15C |

## Qué no se puede trasladar

- El análisis estático de Rocket League confirma relaciones de alto nivel, pero
  no aporta parámetros de diseño fiables ni la curva exacta de respuesta.
- El núcleo físico de Car Soccer se entrega como WebAssembly. Su JavaScript
  público expone estado y presentación, no una fuente reutilizable de física.
- Una lectura de un ejecutable o de WebAssembly no sustituye un guion de prueba
  físico. Las constantes se ajustarán desde nuestras trazas y sesiones, nunca
  copiándolas de un tercero.

## Flujo de decisión

1. Ejecutar `npm run probe` para fijar la traza determinista actual.
2. Ejecutar la ficha
   `_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md`
   en **CALIBRACIÓN LIMPIA**.
3. Registrar un defecto concreto: pitch, yaw/roll, amortiguación, nitro,
   cámara o contacto. No combinar categorías.
4. Cambiar un solo grupo de constantes o una sola regla física.
5. Ejecutar `npm test`, `npm run probe` y el mismo guion visual. Añadir el
   resultado y cualquier regresión al tracker.
6. FIS-15A/B y la instrumentación FIS-15C quedan aisladas y verificadas.
   Solo si la medición LAN y el tacto aéreo justifican conciliación local se
   ampliará FIS-15C; después se reactivarán rampas, obstáculos, combate y bots.

## Instrumentación activa

`airManeuver` reproduce, a 120 Hz, esta secuencia: picado, inversión de
pitch, yaw y roll a la derecha, inversión a la izquierda, liberación,
reorientación hacia arriba y nitro. También compara la misma entrada recibida
en paquetes de 50 ms. La traza actual permanece en vuelo durante 1,5 s y
termina con el morro elevado (`forward.y = 0,985`); el nitro aumenta la
velocidad vertical de `-22,400` a `-21,717` u/s durante el tramo observado.
Es una línea base mecánica, no una afirmación de equivalencia con la referencia.

## Extracción ampliada de Car Soccer

La inspección estática ampliada del 10 de octubre confirmó una arquitectura
cliente de snapshots con pose, velocidades, flags de apoyo y eventos
serializados. La física está encapsulada en WebAssembly y no se incorpora a
este proyecto. El informe completo está en
[car-soccer-rea-integration.md](car-soccer-rea-integration.md).

## Próxima decisión técnica

La medición y los ejes ya son estables. Antes de modificar la sensación, hace
falta una sesión manual del guion de vuelo para escoger un único grupo de
ajuste. Las tres decisiones que pueden tomarse con esa evidencia son:

- Si invertir pitch requiere demasiado tiempo, ajustar solo aceleración y
  límite de pitch.
- Si yaw y air roll se sienten demasiado lentos o nerviosos, ajustar solo sus
  aceleraciones, límites y amortiguación.
- Si el ascenso con nitro no permite recuperar altura como se espera, ajustar
  solo la fuerza de nitro, manteniendo su alineación local.

## Actualización FIS-14E — semántica de controles

La referencia separa free air roll y roll direccional. El proyecto implementa
la misma relación de control de forma original: Shift transforma A/D en roll y
libera la guiñada; Ctrl/Espacio conservan la guiñada y aportan roll
independiente. La prueba `tests/control-mapping.test.mjs` cubre el mapeo y la
prueba de simulación cubre las dos respuestas angulares. No se adoptaron
constantes, código ni recursos de la referencia.

## FIS-18 — referencia pública RocketSim

Car Soccer muestra en su interfaz que su física está adaptada de RocketSim. La revisión de `Car.cpp` y `RLConst.h` se incorporó como requisitos de comportamiento: impulso inicial horizontal, ventana angular de flip, cancelación de pitch, amortiguación vertical y bloqueo posterior. Se escribió una traducción JavaScript original; no se copiaron fuentes, WebAssembly, binarios ni recursos. La atribución y la licencia MIT están en `NOTICE.md` y el detalle de la iteración en `docs/archive/2026-10-12/rocketsim-integration-2026-10-11.md`.
