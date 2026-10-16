# R6-02 — perfiles aéreos y comparación completa

Fecha: 12 de octubre de 2026  
Estado: **aceptada como evidencia de integración; no cambia aún la partida**.

## Alcance

R6-02 añadió al bridge los perfiles deterministas `air-void` y
`second-action-airborne`, capturó los quince escenarios del manifiesto de
movilidad y corrigió el manifiesto de free air roll. Este último cambio afecta
solo al capturador: el cliente ya compone `roll=steer` cuando se mantiene Shift;
la captura anterior enviaba `roll=0` y, por tanto, medía una entrada distinta a
la del juego.

No se modificaron `src/simulation.js`, `server.mjs` ni los controles del
navegador.

## Resultado reproducible

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r5-z7/rocketsim_bridge.exe)
npm run capture:rocketsim-curves
```

La captura de 15 trazas, cada una de 144 pasos a 120 Hz, quedó en
`docs/reference-captures/rocketsim-bridge-r6-02-all.json` con SHA-256
`261012f20888fc43411b82dc5a19d85146c9d5c2fd0d7f7da1cfe319b4ad634d`. Una
segunda ejecución produjo el mismo hash.

Los perfiles aéreos nunca tocaron suelo. Pitch, yaw y roll aislados generaron
respectivamente picos de `3,7391`, `2,7324` y `5,5` rad/s. Free air roll y el
roll directo produjeron la misma secuencia de estado (SHA-256
`da9f02a73e862624f8f1304b91f8cf38f07c9f8f5fdefa3d09a308f73f12c085`), lo que
demuestra que Shift anula yaw y conserva el eje de roll compuesto.

Frente a las capturas R3 del mismo simulador, las acciones se activan en los
ticks previstos: 1 para primer/doble salto y 12 para dodges. La diferencia
máxima de actitud es inferior a `0,07°`; las direcciones de dodge coinciden.

## Comparación que decide el siguiente paso

La captura actual de Arsenal está en
`docs/reference-captures/arsenal-r6-02-current.json`. Al compararla con la
captura nativa:

| Maniobra | Diferencia máxima de actitud |
| --- | ---: |
| Ejes aéreos aislados | 1,20° |
| Pitch en aire | 1,25° |
| Yaw en aire | 0,31° |
| Roll en aire | 0,43° |
| Dodge desde aire | 1,12° o menos |
| Primer salto desde suelo | 29,10° |
| Dodge frontal desde suelo | 24,63° |
| Dodge lateral desde suelo | 41,11° |
| Dodge diagonal desde suelo | 32,46° |

Los flancos y direcciones de acción son iguales. Desde aproximadamente el tick
36 del dodge, RocketSim desarrolla el acoplamiento de tasas propio de su cuerpo
rígido y su contacto; el solver JavaScript conserva una rotación de dodge más
simple. Al terminar las 144 muestras, RocketSim ya ha resuelto apoyo en casos
que Arsenal todavía muestra con una actitud o un vuelo diferente.

Por tanto, retocar los torques aéreos propios sería una regresión probable y
no una solución causal. La siguiente historia es R7-01: un modo de práctica
seleccionable que ejecute RocketSim en el navegador con cliente y red actuales.

## Validación

- `npm test`: **101 pasadas, 0 fallos**.
- La comprobación fue de protocolos, compilación, capturas y comparaciones
  deterministas. No se afirma aquí una prueba visual en navegador.
