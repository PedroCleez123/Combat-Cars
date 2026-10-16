# FIS-12B — Suspensión y transición de apoyo

Estado: completada  
Fecha: 10 de octubre de 2026

## Resultado

CALIBRACIÓN LIMPIA añade cuatro apoyos de rueda al chasis orientado. Cada uno
calcula su punto de anclaje desde el quaternion, busca el plano de arena más
cercano que mira hacia el eje local arriba, y publica recorrido, compresión,
velocidad normal y fuerza de muelle-amortiguador. La fuerza se aplica en el
punto de apoyo; su brazo de palanca aporta corrección de pitch y roll.

El solver de carrocería de FIS-12A sigue siendo el límite duro contra suelo,
paredes y techo. Las ruedas no activan conducción por pared ni techo. Un coche
queda `grounded` solo cuando dos ruedas de suelo tienen compresión significativa
y no se alejan del plano, o cuando existe contacto directo de la carrocería.

`cars[].contacts` combina los planos de carrocería con los planos sostenidos
por ruedas, incluyendo `wheelCount`. `cars[].wheels` permite inspeccionar cada
apoyo sin inferirlo de la altura del coche.

## Corrección encontrada durante la integración

El primer corte trataba cualquier rueda dentro de su recorrido máximo como
apoyo. Una caída podía detenerse con el muelle totalmente extendido: recuperaba
los saltos y quedaba suspendida antes de cargar la rueda. La condición de apoyo
ahora exige compresión significativa; el amortiguador conserva su reacción
durante la aproximación sin cambiar el estado de juego.

## Comprobación

`npm test`: 52 pruebas pasan. Las pruebas añadidas cubren:

- caída plana y amortiguación estable con cuatro ruedas cargadas;
- aterrizajes con cabeceo y alabeo, sin atravesar el suelo;
- reposición de los dos saltos después de aterrizar;
- contacto simultáneo de suelo y pared en una esquina.

`npm run probe` añade `suspension`: caída, aterrizajes inclinados, recuperación
de saltos y esquina suelo-pared. La salida es determinista para la misma semilla
y secuencia de entrada.

## Siguiente historia

FIS-13A sustituirá el control directo de velocidad y yaw de CALIBRACIÓN LIMPIA
por fuerzas de motor, freno, agarre lateral y dirección en las ruedas. Se
mantendrán los apoyos y el límite de carrocería de esta historia.
