# FIS-03 · Contactos de límite de arena

**Resultado observable:** una pared o el techo corrigen la posición del
vehículo sin perder su velocidad tangencial y dejan una señal autoritativa de
contacto.

## Tareas

1. Añadir la altura máxima de la arena al contrato físico.
2. Registrar la normal de pared y el contacto con techo por subpaso.
3. Mantener la restitución amortiguada y la componente tangencial.
4. Exponer los contactos en el snapshot y cubrirlos con pruebas.

## Criterios de aceptación

- El coche nunca supera los límites laterales ni `h = 24`.
- Un choque con pared invierte solo la componente normal; la tangencial se
  conserva dentro de la atenuación aérea existente.
- El snapshot identifica contacto de pared y techo.
- `npm test` pasa sin cambios de protocolo de entrada ni dependencias.
