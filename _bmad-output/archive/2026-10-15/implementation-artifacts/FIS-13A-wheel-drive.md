# FIS-13A — Motor, freno y neumáticos por rueda

Estado: completada  
Fecha: 10 de octubre de 2026

## Resultado

CALIBRACIÓN LIMPIA deja de fijar directamente velocidad longitudinal, agarre
lateral y yaw. Cada rueda de suelo que soporta el coche aplica fuerza de motor,
freno, reversa o avance por inercia según su velocidad respecto de su propio
eje. Las dos ruedas delanteras usan ángulo de dirección; su deslizamiento
lateral genera fuerza y un par de yaw en el chasis.

La fuerza combinada se limita por la carga del muelle. El giro integra una tasa
angular acotada y amortiguada, por lo que una entrada de dirección inicia un
momento pequeño y cambia la trayectoria de forma progresiva. DESGUACE conserva
el controlador heredado hasta que rampas y coberturas usen el mismo modelo.

## Comprobación

`npm test`: 54 pruebas pasan. La cobertura FIS-13A verifica:

- aceleración desde reposo sin asignar la velocidad objetivo en un paso;
- frenada antes de reversa;
- giro gradual de las ruedas delanteras y cambio de trayectoria;
- reducción continua del deslizamiento lateral;
- mismo snapshot a pasos de 120 Hz y con intervalos de entrada agrupados.

`npm run probe` registra 26,767 u/s al segundo, 35,163 u/s a los dos segundos
y 0,600 s hasta reversa. El giro de referencia alcanza 1,511 rad y 14,853 u
laterales tras un segundo de dirección sostenida. Son medidas de la versión,
no una equivalencia declarada con una referencia externa.

## Siguiente historia

FIS-13B usará Shift para reducir y repartir agarre lateral, ampliar la
dirección útil y sostener una deriva que se pueda recuperar sin borrar el
momento angular.
