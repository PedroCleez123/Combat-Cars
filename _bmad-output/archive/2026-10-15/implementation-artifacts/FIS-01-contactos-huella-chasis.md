# FIS-01 · Huella de contacto del chasis

**Resultado observable:** el punto de contacto horizontal depende de la
orientación y dimensiones visuales del coche, no de un radio circular fijo.

## Tareas

1. Definir la huella orientada del chasis en la simulación.
2. Aplicarla a límites de arena, coberturas y choques entre coches.
3. Añadir casos deterministas para pared girada y solape longitudinal.
4. Ejecutar la suite y comprobar una partida local en práctica sin bots.

## Criterios de aceptación

- AC-1 a AC-4 de `SPEC.md` se cumplen.
- No cambia el protocolo ni se añaden dependencias.
- `npm test` termina sin fallos.
