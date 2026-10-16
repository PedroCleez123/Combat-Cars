# FIS-14D — Instrumentación de calibración aérea

## Objetivo

Convertir la calibración de vuelo y nitro en una secuencia reproducible antes
de alterar valores de sensación. La referencia externa solo aporta las
relaciones: ejes locales, paso fijo, ventanas de acción y nitro alineado al
morro. Los valores de Car Soccer: Arsenal son propios.

## Cambios

- `src/mobility-probes.js` incorpora `airManeuver`, una traza de siete fases:
  picado, inversión, yaw/roll derecho, yaw/roll izquierdo, liberación,
  reorientación ascendente y nitro.
- Cada muestra conserva tiempo, dirección del morro, componente vertical del
  vector arriba, tasas angulares y velocidad lineal.
- La misma maniobra se entrega como 120 Hz y como paquetes legales de 50 ms;
  ambas trazas deben ser idénticas.
- La sonda inicia a 22 u para que sus 1,5 s de vuelo no se conviertan en una
  prueba accidental de suelo o techo.
- El canvas recibe foco por teclado y el HUD de calibración muestra estado de
  salto, actitud y tasas, para que el guion manual tenga observabilidad.

## Validación

- `npm test`: 58 pruebas pasan, incluida la traza aérea y su igualdad de
  cadencia.
- `npm run probe`: `airManeuver.cadenceMatches` es `true`; la fase `noseUp`
  alcanza `forward.y = 0,865` y la fase de nitro `forward.y = 0,985`.
- Prueba visual automatizada en una instancia aislada: CALIBRACIÓN LIMPIA,
  coche y HUD cargan; clic derecho registra `first-jump` y `SALTOS 1/2`.
  La automatización no pudo mantener una tecla aérea durante todo el intervalo
  de captura, así que la evaluación de tacto queda para el teclado físico.

## Incidencia corregida

La primera comparación agrupada entregaba una fase completa de hasta 0,3 s en
una única llamada. `ArenaMatch.tick` limita deliberadamente cada paquete a
0,05 s, por lo que se simulaba menos tiempo y aparecía una divergencia falsa.
La sonda ahora divide las fases en paquetes de seis subpasos (50 ms). Cualquier
prueba de cadencia futura debe respetar el límite de entrada antes de comparar
resultados.

## Siguiente acción

Ejecutar `docs/archive/2026-10-14/fis-14c-playtest.md`, anotar una desviación concreta y ajustar
un solo grupo de valores. No se incorporan rampas, combate ni bots en esta
fase.

