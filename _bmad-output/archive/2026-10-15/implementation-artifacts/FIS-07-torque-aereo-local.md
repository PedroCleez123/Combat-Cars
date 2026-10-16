# FIS-07 · Torque aéreo local

**Resultado observable:** en vuelo, W/S, A/D y air roll impulsan tasas de
rotación independientes en ejes locales del chasis; al liberar una entrada su
tasa vuelve gradualmente a cero sin alterar las demás.

## Implementado

- Objetivos, torque y amortiguación por separado para cabeceo, guiñada y
  alabeo.
- Límites explícitos de velocidad angular en cada eje.
- La guiñada se reduce durante air roll, manteniendo el control direccional.
- `angularVelocity` se expone en el snapshot autoritativo para medir el
  comportamiento en juego.
- El nitro aplica sus tres componentes sobre el eje delantero del chasis,
  incluidos los tramos en rampa.

## Criterios comprobados

- La orientación se mantiene normalizada con entradas combinadas.
- Las tasas permanecen acotadas y se reducen al soltar los controles.
- El resultado es idéntico con subpasos agrupados a 30 Hz y entradas a 120 Hz.
- Dodge, salto, conducción, rampas y combate conservan las pruebas existentes.
- `npm test` pasa con 33 pruebas.

## Siguiente trabajo

Evaluar la ventana del dodge y el control durante su animación física antes de
ajustar más constantes de vuelo. El siguiente cambio debe añadir trazas de
impulso, duración y cancelación de dodge para comparar maniobras concretas.
