# FIS-04 · Marco de contacto de superficie

**Resultado observable:** el servidor identifica si el chasis está apoyado y
qué normal tiene el suelo o la rampa bajo su huella.

## Tareas

1. Propagar la normal de la muestra de terreno elegida por las cinco muestras
   del chasis.
2. Mantener `grounded` y la normal en el estado interno y el snapshot.
3. Aplicar la normal al impulso del primer salto; en terreno plano el
   comportamiento permanece idéntico.
4. Añadir pruebas de rampa y de determinismo del nuevo estado.

## Criterios de aceptación

- La superficie plana informa normal `(0, 1, 0)`.
- La rampa informa una normal inclinada coherente con su pendiente.
- El salto en plano conserva sus resultados anteriores.
- `npm test` pasa sin cambios de protocolo ni dependencias.
