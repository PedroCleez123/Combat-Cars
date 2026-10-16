# FIS-02 · Apoyo de terreno por chasis

**Resultado observable:** las rampas sostienen el chasis por sus esquinas,
incluido al entrar y al salir de ellas; el coche comienza a caer solo cuando
ninguno de sus puntos de apoyo queda sobre la rampa.

## Tareas

1. Obtener las cuatro esquinas de la huella orientada y el centro.
2. Elegir la superficie de mayor altura para el contacto de terreno.
3. Usar esa superficie antes y después de integrar el movimiento.
4. Añadir pruebas de entrada parcial y salida por la parte elevada.

## Criterios de aceptación

- Un morro que entra en una rampa eleva el chasis sin esperar al centro.
- La parte trasera mantiene apoyo al salir del extremo alto de una rampa.
- Cuando las cinco muestras quedan fuera, la gravedad recupera el control.
- `npm test` pasa sin modificar el protocolo ni añadir dependencias.
