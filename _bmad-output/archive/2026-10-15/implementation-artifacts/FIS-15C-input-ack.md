# FIS-15C — Instrumentación de confirmación de entrada

Fecha: 10 de octubre de 2026  
Estado: instrumentación completada; conciliación diferida

## Objetivo

Medir el tiempo entre una entrada del cliente y el snapshot en que el servidor
confirma haberla aplicado. La medida permite distinguir un problema de red de
un defecto de física o de presentación.

## Diseño

El cliente etiqueta cada entrada a 60 Hz con una secuencia creciente. El
servidor conserva la última secuencia válida que aplicó para cada conexión y
la devuelve con cada estado. El cliente mantiene una ventana acotada de
marcas temporales y mide el retorno cuando llega el ACK correspondiente.

CALIBRACIÓN LIMPIA muestra el ACK y el tiempo resultante. Incluye la entrega de
red, el procesamiento y la espera hasta el tick de snapshot, por lo que no se
etiqueta como ping.

## Límites

- No hay predicción local.
- No hay reproducción ni conciliación de la simulación.
- No se modifica TUNING, fuerzas, ventanas, contactos ni autoridad del
  servidor.
- La conciliación se evaluará solo después de una prueba LAN que demuestre
  demora perceptible.

## Validación

- tests/input-ack.test.mjs cubre secuencia creciente, ACK repetido, cálculo de
  retorno y límite de memoria.
- npm test: 65 pruebas pasan, 0 fallos.
- npm run probe: airManeuver.cadenceMatches sigue siendo verdadero.
