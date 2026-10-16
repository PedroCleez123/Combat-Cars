# R7-04 — Arena original con transición curva

**Estado:** accepted

## Historia

Como piloto de la práctica RocketSim, quiero que el suelo se convierta en la
pared mediante una curva propia para que el coche pueda conservar una
trayectoria legible al subir, sin fingir que hemos incorporado las mallas de
Soccar.

## Alcance

- Añadir un perfil nativo `arsenal-curved-practice` al sidecar C++.
- Construir una malla estática propia de cuarto de cilindro extruida a lo largo
  del campo, con suelo, paredes laterales y techo limpios.
- Mantener `arsenal-practice` y sus seis planos sin cambios.
- Añadir una sonda determinista de 120 Hz con checkpoints de transición.
- Documentar la escala, los límites y la diferencia respecto a Soccar.

## Criterios de aceptación

1. El bridge acepta el perfil nuevo solo con schema 1, 120 Hz y un coche.
2. La build nativa arranca sin archivos de malla externos y publica estados
   finitos con `worldContact.normal`.
3. Una secuencia reproducible de aceleración llega a la zona curva y conserva
   contacto/superficie durante la transición; la traza se repite con el mismo
   hash/resumen.
4. `arsenal-practice`, `air-void`, `second-action-airborne`, la sonda R7-02 y
   `npm test` no regresan.
5. La documentación no afirma que la curva sea la geometría interna de
   Rocket League; es una aproximación original para validar la sensación.

## Fuera de alcance

Multi-coche, combate, bots, respawn, cámara nueva, conexión online y cualquier
archivo extraído de Rocket League.

## Comprobaciones

- `npm run probe:rocketsim-curved-arena`.
- `npm run probe:rocketsim-practice`.
- `npm test`.
- Carga HTTP del servidor RocketSim; la maniobra visual completa queda como
  observación separada y no se inventa si el navegador no la permite.

## Evidencia de aceptación (12 de octubre de 2026)

- Build nativa `rocketsim_bridge.exe` recompilada con el mesh de curva
  propiedad del proceso y reutilizable entre inicializaciones.
- `npm run probe:rocketsim-curved-arena`: SHA
  `7da59d6caacd75a3ab9e24d302c203913f1d342fad3d1a51f822791ed6c0757d`, apoyo
  inclinado en tick 215, apoyo pronunciado en tick 229, cero huecos antes de
  la pared, 68 muestras de transición y variación normal máxima `5,625°`.
- `npm run probe:rocketsim-practice` y `npm run probe:rocketsim-contacts` pasan
  con el mismo ejecutable.
- `npm test`: 105 pruebas pasan, 0 fallan.
- No se afirma equivalencia con la arena Soccar; el perfil es una geometría
  original para abrir R7-05.
