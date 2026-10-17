# Lotes de pruebas in-game

Las pruebas que requieren una partida real, una ventana de navegador o una
observación humana consumen más tiempo y pueden alterar una sesión compartida.
Por ello no se ejecutan automáticamente tras cada mejora pequeña.

## Política de prioridad

| Prioridad | Cuándo se ejecuta | Ejemplos |
| --- | --- | --- |
| P0 inmediata | Hay evidencia de que el jugador no puede controlar el coche, conectar o mantener un estado autoritativo válido; también si una modificación rompe una garantía de juego ya aceptada. | Controles normales bloqueados, WebSocket caído, snapshots corruptos. |
| P1 lote siguiente | La comprobación aporta evidencia de presentación, movilidad, cámara o interacción, pero no hay regresión crítica demostrada. | HITBOX visual, techo/esquinas R19, dodge lateral/diagonal. |
| P2 lote controlado | La prueba provoca deliberadamente una interrupción, requiere un servidor desechable o no bloquea la siguiente decisión. | Cortar snapshots para el watchdog. |

Una sospecha, un cambio documental o una mejora que ya está cubierta por pruebas
unitarias no ascienden por sí solos a P0. Las pruebas automáticas se siguen
ejecutando después de cambiar código; esta política solo agrupa las observaciones
in-game que exigen un entorno real.

## PLAYTEST-BATCH-01

El primer lote web R19 reúne, en este orden, el gate de control normal, la
observación de HITBOX-01, la transición visual suelo-pared-techo y las variantes
MOB-AIR lateral y diagonal. Cada campaña que exige un piloto debe terminar y
cerrarse antes de abrir la siguiente: agrupar la sesión no significa mezclar
sus rosters ni sus evidencias.

Generar las URLs y el checklist con:

```powershell
npm run plan:playtest-batch
```

El comando no abre navegadores, no conecta al WebSocket y no cambia la partida.
`--json` permite conservar el plan como artefacto de una sesión manual. Los
puertos se pueden ajustar mediante `--combat-port`, `--practice-port` o las
variables `PLAYTEST_BATCH_COMBAT_PORT` y `PLAYTEST_BATCH_PRACTICE_PORT`.

El sublote de liveness se ejecuta al final en un proceso desechable. Nunca se
detiene 5298 o 5300 mientras una partida normal esté en uso.

## Registro de resultados

Para cada ítem, guardar solo la evidencia mínima: URL/perfil/bridge, resultado
del HUD o captura y clasificación `aceptada`, `fallida` o `no verificada`. Una
sesión compartida, un ACK detenido o un navegador integrado sin teclado no
demuestran un defecto de física: se anotan como `no verificada` con su causa.
