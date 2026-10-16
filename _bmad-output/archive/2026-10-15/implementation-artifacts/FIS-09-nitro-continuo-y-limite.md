# FIS-09 · Nitro continuo y límite total

**Resultado observable:** activar nitro aplica la misma aceleración en el eje
del morro sobre suelo, rampa y aire. Tras cada subpaso, la norma de velocidad
del coche no supera el máximo configurado.

## Implementado

- `TUNING.boostAcceleration` sustituye los valores separados de suelo y aire;
  la fuerza no cambia al perder o recuperar apoyo.
- El límite de velocidad se calcula después de gravedad y antes de integrar la
  posición. Antes podía superarse mínimamente al final de un subpaso aéreo.
- El impulso conserva las tres componentes del eje local, por lo que en una
  rampa sigue su tangente y con el morro elevado genera ascenso.

## Criterios comprobados

- Un subpaso de nitro desde reposo añade la misma velocidad frontal en suelo y
  en aire con la misma orientación.
- Sesenta subpasos de nitro en vuelo, empezando cerca del máximo, no superan
  la velocidad total de `56`.
- Las pruebas previas de rampa, ascenso con nitro y banda supersónica siguen
  cubriendo sus comportamientos asociados.

## Siguiente trabajo

Medir en una sesión de práctica la ganancia de velocidad, el consumo y la
recuperación tras soltar nitro antes de modificar valores de balance.
