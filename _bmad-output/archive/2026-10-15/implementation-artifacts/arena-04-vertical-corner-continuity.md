# ARENA-04 — Continuidad vertical de las esquinas

**Estado:** aceptada el 13 de octubre de 2026.

## Problema observable

Las esquinas de `arsenal-expanded-cornered-practice` redondean suelo-pared con
un parche esférico de radio 8, pero por encima de esa altura la pared vuelve a
un vértice de 90 grados. El contraste rompe la lectura visual y la continuidad
de contacto cuando el coche asciende por una esquina.

## Hipótesis y alcance

La misma esquina debe continuar como un cuarto de cilindro vertical desde la
altura del radio hasta el techo. La malla nativa y la visual usarán el mismo centro,
radio y parametrización. Los paneles planos se recortan a un radio de cada
esquina para no solaparse. Solo cambia el perfil cornered; los perfiles
anteriores permanecen como controles.

## Criterios de aceptación

1. El perfil cornered contiene una superficie vertical curva en las cuatro
   esquinas, conectada con el parche esférico y con el panel vertical.
2. No hay solape de panel plano en el tramo curvo.
3. La sonda nativa mantiene apoyo y normales finitas; la geometría se repite
   determinísticamente.
4. La visual Three.js usa la misma parametrización y no cambia la cámara ni la
   física del vehículo.
5. `npm test` permanece verde y el bridge recompilado arranca.

## Resultado

El bridge R9 se recompiló y la sonda registra cuatro apoyos en la banda
vertical de esquina por encima de `h=8`, con altura máxima observada `23,98`,
sin huecos y con salto máximo de normal `3,031°`. La repetición fue
determinista con SHA `7896d2b8058bbbd520fea47b692c645c81435ce7d92d0964508b85e5f8efb539`.
La instancia web en `5284` cargó el perfil cornered, mostró el HUD esperado y
la consola no registró errores.

## Fuera de alcance

No se cambian radio, constantes de movimiento, techo, pared-techo, obstáculos,
combate, bots ni perfiles históricos.
