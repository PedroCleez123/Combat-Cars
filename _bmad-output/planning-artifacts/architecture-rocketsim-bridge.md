# Arquitectura: puente RocketSim para movilidad

Estado: R5/R6 aceptadas para medición; R7-01 aprobada solo como práctica
seleccionable, no como backend predeterminado.

## Contexto

El servidor Node mantiene la autoridad y el cliente Three.js solo presenta
snapshots. El solver JavaScript tiene 95 regresiones verdes, pero RocketSim
ofrece una simulación nativa con suspensión, Bullet y control aéreo integrados.

## Decisión

Usar un proceso C++ persistente como sidecar de desarrollo. Node lo controla
mediante JSON delimitado por líneas. El proceso mantiene una arena RocketSim y
devuelve estados de movimiento; Node conserva combate, red y reglas.

## Contrato R5

- `init`: versión, frecuencia fija, arena y coches.
- `tick`: número de tick e inputs retenidos por coche.
- `state`: número de tick y estados normalizados por coche.
- `shutdown`: cierre explícito y respuesta `stopped`.

El contrato usa y-up en la frontera de Node. La conversión desde RocketSim se
realiza dentro del puente y queda cubierta por una prueba de protocolo.

## Riesgos controlados

- El sidecar puede fallar: Node conserva el backend JS.
- RocketSim considera apoyo con tres ruedas: R6 debe comparar contactos antes de
  mapear `grounded` a la política de dos ruedas de Arsenal.
- Las paredes de R5 son planos sintéticos; las mallas propias quedan fuera.
- El binario y Bullet no se añaden a `node_modules` ni al bundle web.

## Criterio de aceptación

El puente arranca, responde a `init`, procesa 120 ticks de input neutro y
termina limpiamente. Dos ejecuciones del mismo guion producen el mismo resumen
de estado. Un cliente Node puede controlar el ciclo de vida sin bloquear el
servidor.

## Addendum R7-01 — práctica navegable

La evidencia R6-02 cambia la prioridad de integración: los ejes aéreos del
modelo propio ya son próximos a RocketSim, pero los saltos y dodges que parten
de apoyo divergen después de la transición física. R7-01 no mezcla dos
solvers. Añade una sesión autoritativa de un solo piloto que usa RocketSim para
movimiento cuando el operador opta por `MOVEMENT_BACKEND=rocketsim`.

El proceso sigue a 120 Hz; Node publica a 60 Hz y alimenta exactamente dos
ticks consecutivos para cada publicación habitual. `ArenaMatch` conserva el
valor predeterminado. El cliente recibe el mismo esquema de snapshot; la nueva
sesión adapta solo las unidades de posición/velocidad y genera los seriales de
acción a partir de los flancos que informa RocketSim.

Para que la arena física y la visible coincidan, el nuevo perfil nativo
`arsenal-practice` configura los seis planos con las proporciones de la arena
limpia. En la frontera de presentación se aplica una escala uniforme de 0,03 y
se resta la altura nativa de reposo. No hay mapas del desguace, bots, cohetes,
daño ni pads en esta historia.

El sidecar se inicia antes de abrir el puerto y se cierra de forma explícita.
Un error, cierre o timeout se expone como fallo del modo RocketSim: no hay
fallback silencioso durante una sesión, pues cambiar de solver alteraría la
autoridad física observada por el piloto.
