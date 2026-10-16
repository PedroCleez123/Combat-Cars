# Contrato de movimiento extraído estáticamente de Car Soccer

Actualizado: 10 de octubre de 2026. Esta nota registra el contrato de control
que se pudo observar con REA en el cliente público de Car Soccer y cómo se
traduce a una implementación original de Car Soccer: Arsenal.

## Alcance y evidencia

La inspección fue estática: el JavaScript y el WebAssembly de la referencia no
se ejecutaron ni se incorporaron al proyecto. El artefacto de investigación de
la aplicación principal es `main-DaNpiwbA.js`, SHA-256
`AC4B84C691CC6C90E2B4EC321D4B6EE502AFAAAD8B15EA26417D00790F1DD7E7`. La
evidencia REA de esta extracción está registrada como
`ev_9a1a414c316fa02118d2a7d31ff35a6cee1cca8903295ae5c5989b2af4d8d8b2`.
Los artefactos de referencia permanecen fuera de la carpeta del juego.

El núcleo físico de la referencia está encapsulado en WebAssembly. El bundle
expone una interfaz de estado, entradas y presentación, pero no una fuente
JavaScript reutilizable de los contactos ni de los valores de diseño.

## Contrato observado

| Área | Evidencia estática | Traducción propia |
| --- | --- | --- |
| Paso físico | Acumulador con pasos de `1000/120` s y como máximo 12 subpasos por actualización | `ArenaMatch` mantiene subpasos autoritativos de 120 Hz |
| Estado | Pose, velocidad lineal y angular, apoyo, impulso y seriales de acción por coche | Snapshot propio con quaternion, tasas locales, suspensión y seriales |
| Entrada | Ocho ejes/acciones: acelerador, dirección, cabeceo, guiñada, alabeo, salto, nitro y freno de mano | Contrato normalizado del servidor, con adaptación de teclado en `src/control-mapping.js` |
| Pitch | W/S alimentan el cabeceo en vuelo | W baja el morro y S lo eleva |
| Guiñada | A/D producen guiñada en vuelo cuando no se mantiene el modificador de free air roll | `airYawRate` sigue la dirección mientras `airRoll` es falso |
| Free air roll | Shift convierte A/D en alabeo y libera la guiñada | `airRoll: true` fija objetivo de guiñada en cero y suma la dirección al alabeo |
| Air roll direccional | Los botones dedicados de alabeo pueden coexistir con guiñada | `airRoll: false` y `roll` distinto de cero conservan ambos objetivos |
| Combinación | Free roll y roll direccional se componen y quedan limitados a un eje | La capa de mapeo suma y limita a `[-1, 1]` antes de enviar |

## Entrega FIS-14E

Antes de esta entrega nuestro cliente marcaba cualquier roll como `airRoll`.
Eso hacía que Ctrl/Espacio apagaran la guiñada y que Shift siguiera produciendo
guiñada residual. FIS-14E separa las dos rutas:

- `src/control-mapping.js` convierte acciones físicas en un contrato puro y comprobable.
- Shift solo activa `airRoll`; A/D pasan a `roll` mientras se mantiene.
- Ctrl/Espacio producen `roll` sin activar `airRoll`, por lo que A/D mantienen la guiñada.
- Si se combinan Shift y un botón direccional, los valores se suman y se limitan.
- La simulación conserva la integración angular quaternion y modifica solo los objetivos de guiñada/alabeo; no se cambiaron las constantes de tacto.

## Comprobación reproducible

La prueba `tests/control-mapping.test.mjs` cubre W/S, free air roll, roll
direccional y suma con saturación. La prueba de simulación `free air roll
suppresses yaw while directional roll preserves it` verifica que una entrada
aérea idéntica produce roll en ambos casos, pero solo la ruta direccional
desarrolla guiñada.

La sonda `npm run probe` conserva `airManeuver.cadenceMatches = true`. Su fase
`rightYawRoll` usa ahora la ruta direccional (`airRoll: false`) y registra
guiñada y alabeo simultáneos; la ruta Shift se mide de forma aislada en
`airAxes.rollRight`.

## Límites y siguiente medición

Este contrato demuestra relaciones de control, no equivalencia de constantes,
colisiones o sensación final. Aún falta que el piloto ejecute el guion de
CALIBRACIÓN LIMPIA con teclado físico y compare dos sesiones. Solo después de
repetir un defecto se debe tocar un grupo de `TUNING`.
