# R6-02 — Perfiles aéreos y comparación de controles

## Historia

Como desarrollador de Car Soccer: Arsenal, quiero iniciar RocketSim en estados
aéreos deterministas para medir pitch, yaw, roll, free air roll y el segundo
salto sin que el suelo contamine la maniobra.

## Hipótesis

Las trazas R2/R3 existentes ya usaron un vacío sintético a gran altura y un
estado que ha terminado el primer salto. El sidecar debe reproducir esas dos
condiciones exactamente, manteniendo el contrato de entradas posterior al
adaptador de teclado/mando.

## Alcance

- Dos perfiles internos del sidecar: `air-void` y `second-action-airborne`.
- Capturador de los 15 escenarios del manifiesto actual a 120 Hz.
- Corrección del manifiesto de free air roll para reflejar el input de vehículo
  que produce el cliente (`roll=steer` mientras el modificador está activo).
- Comparación con R3 y registro de la evidencia.

## Criterios de aceptación

1. Los dos perfiles no generan contacto con suelo durante 144 ticks.
2. Las 15 trazas tienen 144 muestras válidas y se repiten exactamente.
3. Los ejes aislados producen una señal distinta de cero solo en el eje que
   corresponde, salvo acoplamiento físico publicado por RocketSim.
4. Las acciones aéreas de R3 activan en el mismo tick y la comparación de
   orientación queda dentro de la puerta inicial de 5°.
5. `npm test` sigue verde y no se modifica el backend de producción.

## Fuera de alcance

Contactos de paredes/esquinas/techo, integración con Node autoritativo,
combate, bots, malla de arena y ajustes de `TUNING`.
