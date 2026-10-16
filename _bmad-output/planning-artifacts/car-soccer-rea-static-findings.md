# Car Soccer — hallazgos estáticos con REA

Fecha: 10 de octubre de 2026.

## Alcance y evidencia

Se analizaron estáticamente los recursos JavaScript públicos que
`https://car-soccer.com/` entregó al navegador. REA reconstruyó 16 archivos
JavaScript sin ejecutar el juego ni iniciar una partida.

- Evidencia principal: `ev_89796aaab3a0bb216300f96b193218ca9b1e4273a07fa6d62b3c7d59b6e11fc4`.
- Grafo recuperado: 315 nodos y 621 relaciones; 16 JavaScript analizados y
  ninguna contradicción de integridad.
- La traza literal `dodge` no encontró una entidad de grafo. Eso no demuestra
  que la mecánica no exista: el núcleo está compilado y los nombres pueden no
  persistir en el enlace JavaScript. Evidencia:
  `ev_d40add1d95dadf0013708603aaaa041ee9b4fd897226a043421e4dd9f0b9a2fe`.

## Observaciones

1. El paquete principal es un cliente Vite y Three.js. Declara dos *workers*,
   uno dedicado a bots y otro auxiliar; esto no prueba cuándo se ejecutan.
2. La física no aparece como una implementación Three.js trasladable. El
   enlace JavaScript carga un módulo WebAssembly, inicializa colisiones desde
   un manifiesto de mallas de arena y expone funciones de física compiladas.
   Sus literales incluyen referencias a Bullet/PhysCoreX.
3. El estado de cada coche incluye posición, tres ejes del chasis, velocidad
   lineal y angular, boost, apoyo, normal de suelo, supersónico y seriales de
   salto, dodge, doble salto e impacto. El cliente interpola presentación
   entre pasos y el código usa una cadencia de 120 Hz.
4. El código enlaza captura y restauración de estado de red. El reparto exacto
   de autoridad no se afirma aquí: una inspección estática no observa el
   intercambio ni la ejecución de una partida.

## Decisiones para Arsenal

- No se copia ni incorpora código, WebAssembly, mallas ni recursos de Car
  Soccer. Su núcleo compilado no es una base segura ni mantenible para este
  proyecto JavaScript autoritativo.
- Se conservan las decisiones compatibles ya propias: pasos fijos de 120 Hz,
  ejes locales, velocidad angular en el snapshot y eventos con serial para
  separar simulación de presentación.
- FIS-10B adopta un modelo propio de brazo de palanca local para impactos. Es
  una mejora de combate comprobable, no una transcripción del núcleo externo.

## Límite conocido y siguiente trabajo

El análisis no recupera parámetros equivalentes de suspensión, neumáticos,
contacto de malla o dodge del WebAssembly. El siguiente hito debe validar el
modelo propio mediante escenarios reproducibles y, después, ampliar los
contactos 3D de arena con geometría creada para Arsenal.
