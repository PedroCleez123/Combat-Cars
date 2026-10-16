# M3 — segundo salto y dodge aéreo

Fecha: 11 de octubre de 2026  
Estado: **aceptado contra la traza R3 de RocketSim**

## Objetivo

Hacer que el segundo salto con y sin dirección tenga una lectura consistente:
el salto neutro conserva el impulso vertical, mientras W/S, A/D y air roll
comprometen un dodge horizontal con una rotación corta y corregible. La
referencia numérica es RocketSim en una arena limpia y alta; Car Soccer sigue
siendo la referencia visual de cámara y sensación.

## Cambios implementados

- `src/mobility-curve-probes.js` añade prácticas aéreas a 20 unidades de altura
  para aislar el segundo salto y tres direcciones de dodge del suelo.
- `src/simulation.js` conserva el umbral agregado `0,5`, el pulso vertical
  mínimo `5,65`, el amortiguamiento vertical durante el flip y la dirección
  comprometida capturada en el flanco de salto.
- El dodge ya no fija una velocidad angular constante. Aplica un integrador de
  torque propio con `224` en pitch y `260` en roll por segundo, integra primero
  y limita después el vector a `5,5 rad/s`, como el orden observable de
  RocketSim. La guiñada inicial se conserva y solo se reduce si el límite
  vectorial lo exige.
- `tests/simulation.test.mjs` documenta el contrato de signos: un dodge hacia
  delante tiene pitch local positivo y puede conservar una pequeña guiñada de
  borde, en vez de exigir una igualdad artificial a cero.

## Evidencia reproducible

Referencias y candidato:

- `docs/reference-captures/rocketsim-r3-jumps-dodges-c2baacb8.json`
- `docs/reference-captures/arsenal-m3-air-action-dodge-calibrated.json`

Las dos capturas tienen 144 muestras a 120 Hz y activan la acción en el tick
12. La comparación se ejecutó con `compareCurveTraces`:

| Escenario | Forma vertical | Forma pitch/roll | Error angular medio / máximo |
| --- | ---: | ---: | ---: |
| Segundo salto neutro | altura `0,0086`; velocidad vertical `0,0042` | — | `0° / 0°` |
| Dodge frontal | velocidad `0,0117`; vertical `0,0481` | pitch `0,0051` | `0,19° / 1,11°` |
| Dodge lateral | velocidad `0,0117`; vertical `0,0481` | roll `0,0003` | `0,002° / 0,079°` |
| Dodge diagonal + roll | velocidad `0,0117`; vertical `0,0481` | pitch `0,0051`; roll `0,0003` | `0,08° / 0,44°` |

La diferencia de picos absolutos de altura y velocidad entre JSON no es un
fallo: RocketSim conserva sus unidades públicas y Arsenal sus unidades de
partida; `shapeRms` compara la forma normalizada. La puerta de orientación es
5 grados y todos los escenarios quedan por debajo.

## Incidencias y prevención

1. **El suelo contaminaba el primer R3.** Un flip largo chocaba con el plano
   sintético y mezclaba contacto con rotación. Se creó una condición inicial
   aérea a altura segura y se mantuvo el escenario de suelo fuera de esta
   comparación.
2. **Fijar `5,5 rad/s` parecía correcto en las tasas, pero no en la pose.**
   RocketSim integra el torque antes de aplicar el límite de velocidad angular.
   El integrador por torque reproduce el sobreimpulso de orientación sin
   publicar una velocidad fuera del límite.
3. **El comparador podía medir una orientación falsa.** Los quaternions
   serializados se normalizan antes de convertirlos a vectores delante/arriba.
4. **No se reintroducen constantes ni código del juego comercial.** Solo se
   utiliza la relación observable y los valores públicos de RocketSim, que se
   ejecuta como herramienta aislada bajo MIT.

## Validación

`npm test` termina con **94 pass, 0 fail**. La prueba de curvas permanece
determinista y cubre 15 escenarios. El siguiente bloque es M4: contactos,
aterrizajes y recuperación de actitud usando esta captura como contrato.
