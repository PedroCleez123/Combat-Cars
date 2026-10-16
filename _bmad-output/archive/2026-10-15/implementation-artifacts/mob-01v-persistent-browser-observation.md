# MOB-01V — Observación persistente de movilidad en navegador

Estado: **Aceptada visualmente** · 13 de octubre de 2026

## Problema observable

MOB-01 confirmó por WebSocket una maniobra completa de pared, salto, dodge,
vuelo y aterrizaje, pero el navegador integrado no podía alcanzar servidores
temporales de la sesión. Faltaba separar ese bloqueo de un posible defecto del
servidor o de RocketSim.

## Hipótesis

Una instancia persistente fuera del proceso de la sonda permitiría abrir
`?mob02=1` y observar HUD, cámara, pose y consola. Si el servidor escucha y el
navegador falla antes de navegar, el bloqueo pertenece a la infraestructura de
automatización, no a la partida.

## Alcance

- Arrancar de forma temporal una práctica RocketSim persistente en el puerto
  5336 con la build R9 y la arena de esquinas curvas.
- Abrir `http://127.0.0.1:5336/?mob02=1` en el navegador integrado.
- No modificar juego, bridge, física, cámara ni protocolo.

## Resultado

La instancia sí abrió un listener en `0.0.0.0:5336` (PID 34924). Antes de que
existiera una pestaña, la automatización del navegador integrado falló al
inicializar sus recursos locales; no llegó a cargar la URL ni a consumir el
servidor. Se cerró el proceso temporal y se comprobó que no quedó listener en
el puerto.

Por tanto, MOB-01V sigue **No verificada** visualmente. La evidencia
autoritativa MOB-01 sigue vigente y esta incidencia no es una razón para
retocar física o cámara. Se reintentará cuando el navegador integrado vuelva a
estar operativo o mediante una instancia de navegador que pueda acceder al
localhost del proceso persistente.

## Diagnóstico de recuperación

Se reiniciaron los dos kernels de automatización disponibles y se intentó de
nuevo su operación mínima de inventario. Ambos fallaron antes de exponer una
ventana o pestaña, al inicializar sus recursos locales. Esa secuencia descarta
un puerto bloqueado, una URL errónea y el servidor RocketSim como causas de la
observación pendiente. No se crea ni modifica una ruta del sistema de Codex:
su procedencia y contenido no pertenecen al repositorio del juego.

## Reintento satisfactorio — 13 de octubre de 2026

Tras reiniciar Codex se arrancó una instancia persistente con la build R9 en
`http://127.0.0.1:5336/?mob02=1`. El navegador integrado cargó la página y la
pestaña se dejó abierta para el usuario. La comprobación visual mostró:

- título `Car Soccer: Arsenal` y arena `PRÁCTICA ROCKETSIM · ESQUINAS CURVAS · SUELO · PAREDES · TECHO`;
- HUD con `ESTADO grounded`, `SALTOS 2/2`, integridad y nitro, actitud y giro;
- `RED ACK` activo (450 en la captura, latencia 5 ms), sin pantalla de error;
- coche visible junto a la transición curva pared-techo.

Esta evidencia confirma que el bloqueo anterior era de la automatización tras el
reinicio y no del servidor, del bridge ni del navegador de juego. La campaña
autoritativa MOB-01 y la observación visual MOB-01V quedan cerradas. La captura
visual no se exporta como archivo porque la API de navegador la mostró
directamente; la pestaña persistente es el artefacto reproducible.

## Nota operativa del entorno — 13 de octubre de 2026

Los procesos arrancados de forma desacoplada desde la sesión de herramientas
pueden ser limpiados al terminar esa sesión, y los procesos iniciados en una
terminal aislada no siempre son visibles desde el navegador integrado. Para
una sesión de juego estable, el usuario debe arrancar `npm start` en su propia
PowerShell y mantenerla abierta; después se abre la URL que indique ese
proceso, por ejemplo `http://localhost:5189/?mob02=1`. Esto es una limitación
del entorno de ejecución y no del servidor del juego.
