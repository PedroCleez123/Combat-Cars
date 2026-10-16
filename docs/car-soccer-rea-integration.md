# Extracción estática de Car Soccer y decisiones de integración

Actualizado: 10 de octubre de 2026. Alcance: arquitectura y presentación de
movimiento. Car Soccer: Arsenal conserva una simulación y recursos propios.

## Procedencia y límites

REA analizó de forma estática una copia local del cliente web que estaba ya
guardada como material de investigación. El análisis cubrió cuatro archivos
JavaScript, 2.680.765 bytes textuales y 433.017 nodos de sintaxis, sin ejecutar
su código. La huella del artefacto fue
6ea3d70e866bb5e5532e03ae3ce66145aa1fdeb3e5a29c1aae53bb068bd95294.
La evidencia REA conservada en esta sesión es
ev_c46c2e451f5d5498efc4f09c4064d978b090900d418d3c4601d9c8bd12f7559e,
con resumen ev_30df9c0673288a061e46f415d7fc82446be1ecf04a384938dc8208606ccbb7d1.

La herramienta opcional de recuperación de fuentes Wakaru no estaba
configurada en REA. No se instaló para esta tarea porque la evidencia estática
ya bastaba para separar contrato de red, presentación y núcleo físico.

El resultado permite observar interfaces, estados y secuencias de cliente. No
demuestra valores internos del motor físico ni autoriza trasladar código,
constantes, WebAssembly, mallas, sonidos o recursos de un tercero. Todo lo que
sigue son requisitos y código originales de este proyecto.

## Hallazgos útiles

| Observación estática | Valor para Car Soccer: Arsenal | Decisión |
| --- | --- | --- |
| El cliente mantiene un estado compacto por coche con pose, orientación, velocidad lineal y angular, apoyo, impulso y banderas de acción. | Separa la simulación de la presentación y permite diagnosticar cada capa. | Mantener el snapshot autoritativo actual; ampliar solo cuando una prueba necesite un dato. |
| Los controles se envían como acelerador, dirección, pitch, yaw, roll, salto, nitro y derrape. | Confirma que conducción y aire usan ejes explícitos distintos. | Ya aplicado: nuestras entradas y estados de aire permanecen independientes de las ruedas y del derrape. |
| El servidor calcula a 120 Hz y publica estados al cliente en una cadencia inferior. | La fluidez visual no debe depender de ejecutar la física al ritmo de la pantalla. | Ya aplicado: subpasos autoritativos a 120 Hz y snapshots propios a 60 Hz. |
| El cliente interpola posición y orientación quaternion entre muestras cercanas; usa interpolación esférica para la actitud. | Elimina tirones de la entrega de red sin introducir predicción física no verificable. | Implementar FIS-15A, terminada en esta entrega. |
| Los cambios de respawn o de estado discontinuo no se mezclan visualmente con el estado anterior. | Evita que un coche dibuje una trayectoria falsa a través de la arena. | FIS-15A corta la interpolación en respawn, teletransporte, cambio de arena, reloj no creciente o hueco temporal grande. |
| El cliente usa seriales de acción para disparar una vez efectos de salto, dodge, impacto y rebote. | Es una forma útil de separar simulación de efectos sin deducirlos de una pose interpolada. | Implementado como FIS-15B con seriales propios de salto, doble salto, dodge y respawn. |
| Las entradas recientes se etiquetan con secuencia y el servidor conserva un historial corto. | Puede reducir la sensación de retardo cuando haya jugadores LAN reales. | Dejar como FIS-15C; no añadir reconciliación hasta medir retardo perceptible. |
| La física principal se inicializa en WebAssembly con una malla de colisión de arena. | No es una fuente JavaScript de comportamiento reutilizable. | No trasladar el núcleo ni los valores. Mantener nuestro chasis, suspensión y seis planos de CAL-01. |

## Diseño aplicado: FIS-15A

El servidor continúa siendo la única autoridad. El cliente recibe snapshots,
los guarda en un buffer muy pequeño y muestra la pose correspondiente a un
instante una actualización de red por detrás del más reciente. Entre dos
paquetes, el reloj de presentación avanza y mezcla posición lineal y
orientación quaternion por el arco corto.

Cuando no llega un paquete, la presentación se detiene en la última pose
confirmada. No predice velocidad ni colisión. Cuando llega un respawn,
teletransporte, reinicio de partida o una muestra temporalmente incompatible,
el buffer se reinicia y muestra la nueva pose completa.

La malla del chasis toma esa pose interpolada de forma directa. Antes tenía
otro suavizado exponencial encima, que añadía una segunda demora y hacía que
coche y cámara persiguieran dos objetivos diferentes. La cámara conserva su
propio suavizado cinematográfico, pero calcula orientación y foco desde el
mismo chasis que ya se está dibujando.

Archivos de la entrega:

- src/snapshot-interpolation.js: buffer, corte de discontinuidades, mezcla de
  posición y slerp quaternion.
- src/client.js: muestras temporizadas por el reloj del navegador y aplica la
  pose ya interpolada.
- tests/snapshot-interpolation.test.mjs: continuidad, arco corto quaternion,
  respawn, teletransporte, avance temporal y conexión detenida.

## Diseño aplicado: FIS-15B

El snapshot propio publica cuatro seriales monotónicos: primer salto, doble
salto, dodge y respawn. Un serial no sustituye al estado físico; solo marca
que ocurrió una transición discreta. El cliente conserva el último valor de
cada coche y genera un pulso breve cuando uno aumenta. Una entrega repetida
de la misma muestra no reinicia el pulso.

Esta capa usa los seriales del proyecto, no el formato ni el código de Car
Soccer. La prueba de simulación comprueba que una pulsación mantenida no
emite una acción adicional y cubre las cuatro transiciones publicadas.

## Validación

Las pruebas automatizadas cubren 76 casos y pasaron sin fallos el 10 de octubre\nde 2026. Incluyen el contrato FIS-14E, interpolación, seriales de acción y regresiones de\nfísica. La sonda de movilidad mantiene su resultado de cadencia aérea:\nairManeuver.cadenceMatches es verdadero.

Esta validación demuestra las propiedades del buffer y que la física
determinista no cambió. La sensación final de cámara y respuesta aérea aún
requiere la ficha de observación aislada
`_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md`;
el antiguo guion manual está archivado en `docs/archive/2026-10-14/fis-14c-playtest.md`.

## Hoja de ruta después de FIS-15A

1. Ejecutar el guion de CALIBRACIÓN LIMPIA y registrar un único defecto de
   tacto de vuelo antes de ajustar TUNING.
2. Medir respuesta en LAN con una y dos pestañas usando el ACK de entrada
   mostrado en CALIBRACIÓN LIMPIA. Solo si la demora local resulta
   perceptible, ampliar FIS-15C con historial local mínimo y conciliación
   limitada al coche propio.
3. Reintegrar rampas, coberturas, combate y bots después de cerrar una
   calibración aérea y una sesión visual de presentación. Esos sistemas no
   deben ocultar errores de movilidad.

## Actualización FIS-14E — semántica de air roll

La extracción estática ampliada confirmó una distinción que faltaba en el
cliente: el modificador de free air roll convierte dirección en alabeo y
libera la guiñada; los botones de alabeo direccional siguen siendo un eje
independiente y pueden coexistir con guiñada. La relación y su evidencia están
descritas en [car-soccer-rea-physics-contract.md](car-soccer-rea-physics-contract.md).

FIS-14E la implementa de forma original en `src/control-mapping.js` y
`src/simulation.js`. No copia código, constantes ni WebAssembly. La prueba de
simulación comprueba ambos caminos y `npm run probe` mantiene la igualdad de
cadencia a 120 Hz.

