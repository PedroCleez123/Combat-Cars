# FIS-13B — Powerslide

Estado: completada  
Fecha: 10 de octubre de 2026

## Resultado

En CALIBRACIÓN LIMPIA, Shift modifica el mismo modelo de rueda de FIS-13A. Las
ruedas traseras pierden más agarre lateral que las delanteras, las delanteras
usan mayor ángulo de dirección y un par de freno de mano limitado acelera el
giro. La simulación integra fuerza, velocidad lateral, tasa de yaw y orientación
sin asignar esos valores directamente.

Al soltar Shift, la velocidad lateral permanece en el primer paso. El agarre
normal y la amortiguación de yaw recuperan la trayectoria de forma gradual.

## Comprobación

`npm test`: 55 pruebas pasan. La prueba de FIS-13B compara una curva normal
con powerslide, exige mayor giro y deslizamiento, verifica que liberar Shift no
borra el impulso en un paso y comprueba la recuperación de tracción y la
repetibilidad con pasos agrupados.

`npm run probe` registra tras 0,5 s de deriva: 1,636 rad de yaw, 2,182 rad/s
de tasa y −14,338 u/s de deslizamiento lateral. Tras 1 s de recuperación, el
deslizamiento es 0 u/s en la traza de referencia.

## Siguiente historia

FIS-14B reunirá salto, doble salto y dodge en una máquina de estados temporal
que parte de los apoyos de rueda de CALIBRACIÓN LIMPIA.
