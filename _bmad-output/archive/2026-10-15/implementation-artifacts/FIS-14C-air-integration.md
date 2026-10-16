# FIS-14C — Integración aérea local y nitro

Fecha: 10 de octubre de 2026  
Estado: base determinista completada; calibración de tacto pendiente en FIS-14D.

## Cambio

`applyAirAttitude` ya no encadena tres rotaciones en un orden fijo. Convierte
las tasas de roll, yaw y pitch al vector angular local del chasis, normaliza su
eje y aplica un único delta quaternion por subpaso de 120 Hz. Los controles,
límites y amortiguaciones existentes se conservan.

Esto elimina el sesgo introducido por tratar una maniobra combinada como tres
rotaciones ordenadas, sin imponer una orientación ni una velocidad lineal.
El nitro conserva una única fuerza alineada con el vector delantero del
quaternion.

## Evidencia

- `npm test`: 57 pruebas correctas.
- `npm run probe`: `airAxes` confirma W abajo, S arriba, D a la derecha y air
  roll alrededor del morro. Tras 0,2 s de nitro, un morro inclinado arriba
  añade +0,853 u/s vertical frente a −7,253 u/s mirando abajo.
- La prueba de cadencia agrupada conserva la orientación y la prueba de ejes
  comprueba tanto los signos de control como el ascenso por nitro.

## Siguiente paso

Ejecutar `docs/archive/2026-10-14/fis-14c-playtest.md` en la build local. Sus observaciones
decidirán el primer ajuste de valores de FIS-14D; no se modificará una
constante solo por su nombre o por una comparación no medida.

