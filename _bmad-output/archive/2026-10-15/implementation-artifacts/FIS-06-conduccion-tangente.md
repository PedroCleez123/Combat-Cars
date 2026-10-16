# FIS-06 · Conducción sobre el plano de contacto

**Resultado observable:** la velocidad de un coche apoyado se expresa en los
dos ejes tangentes a la superficie. En una rampa, acelerar conserva una
componente vertical de subida y el aterrizaje elimina solo la velocidad normal.

## Implementado

- Proyección del avance y del desplazamiento lateral sobre la normal de suelo.
- Reconstrucción de `vx`, `vh` y `vz` desde la velocidad tangencial.
- Aterrizajes que eliminan el impacto normal sin borrar la velocidad paralela.
- Continuidad de soporte usando las cinco muestras de la huella del chasis.
- Salida de rampa: cuando ninguna muestra sostiene el coche, conserva el
  lanzamiento tangencial y pasa a gravedad aérea.

## Criterios comprobados

- La conducción plana conserva los controles existentes.
- Un coche en rampa mantiene velocidad tangencial con componente de subida.
- El contacto de la huella trasera evita una caída prematura.
- Tras abandonar toda la rampa, el coche entra en vuelo y acaba cayendo.
- `npm test` pasa con 30 pruebas.

## Siguiente trabajo

Medir aceleración, agarre lateral, giro y derrape en suelo plano con trazas
deterministas antes de ajustar constantes. Después se podrá pasar a torque
aéreo y amortiguación angular.
