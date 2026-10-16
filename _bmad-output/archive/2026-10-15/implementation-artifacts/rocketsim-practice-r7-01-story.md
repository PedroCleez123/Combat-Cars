# R7-01 — Práctica RocketSim seleccionable

## Historia

Como piloto de Car Soccer: Arsenal, quiero una sesión local de práctica de un
coche que use RocketSim para poder evaluar en el navegador el salto, segundo
salto, dodge y vuelo que las trazas ya han validado, sin cambiar todavía el
modo de combate ni el solver JavaScript predeterminado.

## Evidencia que abre la historia

R6-02 reprodujo las 15 trazas de RocketSim a 120 Hz. Frente a esa referencia,
el solver propio conserva los ejes aéreos aislados a 1,3 grados o menos, pero
se separa hasta 29,1 grados en el primer salto y hasta 41,1 grados en el dodge
lateral que parte del suelo. Los eventos y la dirección comprometida sí
coinciden. La diferencia aparece después del primer contacto/impulso y no se
puede eliminar ajustando una constante de torque sin arriesgar los ejes aéreos
que ya están dentro de la puerta.

## Ficha de cambio

- **Problema observable:** el navegador sigue ejecutando el modelo propio en
  las maniobras donde su seguimiento de la referencia diverge más.
- **Hipótesis causal:** la transición apoyo -> salto -> segundo salto depende
  del cuerpo rígido y las suspensiones nativas, no de una sola curva de control
  que pueda trasladarse al solver JavaScript.
- **Alcance:** un `RocketSimPracticeMatch` de un piloto, un nuevo perfil limpio
  del sidecar y la selección explícita `MOVEMENT_BACKEND=rocketsim` al arrancar
  el servidor. Mantiene el contrato WebSocket de snapshots.
- **Fuera de alcance:** combate, cohetes, bots, varios coches, pads, colisión
  contra recursos del desguace, predicción cliente y sustituir el backend
  JavaScript por defecto.

## Cambio de invariante

La integración añade un backend autoritativo asíncrono solo cuando el proceso
se inicia con `MOVEMENT_BACKEND=rocketsim`. Node conserva autoridad sobre
WebSocket, identidad del piloto, secuencia de inputs y publicación de
snapshots. La física de movimiento se delega en un proceso persistente a 120
Hz; cada snapshot de 60 Hz consume dos pasos nativos. No se mezclan ambos
solvers sobre el mismo coche ni se cambia el protocolo que ve el cliente.

## Criterios de aceptación

1. Sin variables de entorno, `npm start` conserva `ArenaMatch` y la partida
   JavaScript existente.
2. Con `MOVEMENT_BACKEND=rocketsim` y un ejecutable válido, el servidor inicia
   una práctica de un piloto, sin bots, combate, pads, cohetes ni configuración
   de equipos.
3. El perfil nativo `arsenal-practice` tiene suelo, paredes y techo en la misma
   proporción que la arena limpia visible. La conversión a la escena usa una
   escala uniforme documentada y resta la altura de reposo del coche.
4. Cada entrada aceptada por el servidor llega al sidecar sin reinterpretar los
   ejes; cada publicación de 60 Hz solicita dos pasos consecutivos de 120 Hz.
5. El snapshot resultante conserva los campos que consume el cliente: pose,
   quaternion, velocidad, ejes angulares, estado y seriales de acción, salto,
   dodge y boost. Reiniciar reinicializa el lado nativo de forma serializada.
6. Fallar al iniciar, responder tarde o cerrar el sidecar no deja una promesa
   pendiente ni convierte automáticamente una partida RocketSim en JavaScript.
   El operador debe reiniciar explícitamente con el backend que prefiera.
7. Las pruebas unitarias cubren la transformación, acciones y política de
   pasos con un puente falso. `npm test` permanece verde. La build nativa y el
   smoke del nuevo modo se ejecutan cuando el ejecutable está disponible.

## Comprobaciones

| Criterio | Base | Post esperado |
| --- | --- | --- |
| Regresión existente | `npm test`: 105/105 tras R7-01 | Verde, sin fallos nuevos |
| Contrato de práctica | No existe | Pruebas de sesión con puente falso |
| Puente nativo | R6-02 reproduce 15 trazas | Compila con `arsenal-practice` |
| Cadencia | Capturas nativas 120 Hz | Dos ticks nativos por snapshot de 60 Hz |
| Navegador | No aplicable al backend aislado | Servidor opt-in y carga real si está disponible |

## Resultado

**Aceptada el 12 de octubre de 2026.** `RocketSimPracticeMatch` quedó
integrado como backend opt-in de un piloto. El puente nativo compila y el
perfil `arsenal-practice` publica suelo, cuatro paredes y techo con la escala
documentada. La suite completa queda en **105 pass, 0 fail**; las cuatro
pruebas específicas cubren conversión, dos ticks por snapshot, seriales de
acción y reinicio.

La prueba del servidor real cargó la aplicación en navegador con `PRÁCTICA
ROCKETSIM`, un solo piloto, estado `grounded`, dos saltos y ACK de entrada.
La sonda R7-02 mantuvo dos ticks nativos por snapshot: media publicada
`16,67 ms` frente a `16,67 ms` esperados, con ACK 18/18 y seriales observados
para salto, doble salto y dodge dirigido. No se declara todavía equivalencia
visual de maniobras; la revisión de cámara y tacto queda en R7-03.

## Rollback

Eliminar `MOVEMENT_BACKEND=rocketsim` devuelve al backend JavaScript sin
migración de datos. El modo RocketSim no escribe estados persistentes ni altera
las constantes de `src/simulation.js`.
