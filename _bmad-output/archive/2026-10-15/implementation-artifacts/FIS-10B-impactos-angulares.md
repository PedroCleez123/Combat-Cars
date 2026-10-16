# FIS-10B — impactos angulares

## Resultado observable

Una embestida descentrada cambia el rumbo del coche sobre el suelo; una
embestida centrada conserva el rumbo. Una explosión oblicua sobre un coche en
vuelo añade velocidad angular local limitada. El servidor expone el serial y
la magnitud del impacto en su snapshot.

## Implementación propia

`src/simulation.js` calcula el brazo entre el centro del chasis y el punto de
contacto en los ejes delantero, lateral y vertical locales. El producto
vectorial con el impulso determina torque de roll, yaw y pitch. El suelo deja
girar sólo el heading; en vuelo, las tasas se acumulan y limitan antes de que
la integración de actitud del propio servidor las consuma.

No se incorporó código ni datos de Car Soccer. El estudio REA sólo confirmó
que un estado físico completo separa ejes, velocidades, apoyo y eventos.

## Criterios y comprobación

- Ram descentrado: cambio de yaw y `impactSerial` autoritativo.
- Ram centrado: yaw inferior a `0.001` radianes.
- Explosión aérea oblicua: velocidad angular no nula y limitada a `8.5` por
  eje.
- `npm test`: 39 pruebas superadas.

## Siguiente historia

FIS-11 debe integrar un playtest guiado y decidir la geometría de colisión 3D
propia para las superficies de la arena antes de ajustar más constantes.
