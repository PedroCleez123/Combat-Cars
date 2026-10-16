# Archivo documental

Este directorio está reservado para material que ya no es una fuente activa.
Archivar significa mover de forma reversible, actualizar los enlaces que aún
necesitan el contexto histórico y dejar constancia en
`docs/document-inventory.md`; no se borra historia del proyecto.

## Reglas

1. Comprobar referencias con `rg` antes de mover cualquier archivo.
2. No archivar capturas de `docs/reference-captures/` mientras las usen pruebas,
   el tracker, el relevo o una historia BMad.
3. No archivar los documentos de fuente activa enumerados en el inventario.
4. Actualizar todos los enlaces relativos en la misma operación y ejecutar la
   comprobación de enlaces.
5. Si la condición de obsolescencia no es inequívoca, conservar el archivo y
   registrarlo como retenido.

## Estado de esta revisión

El 12 de octubre de 2026 se archivaron 17 informes y planes cerrados en
`archive/2026-10-12/`. El 14 de octubre se trasladaron a
`archive/2026-10-14/` las hojas de ruta sustituidas y las versiones largas del
tracker y del relevo. Sus referencias desde fuentes activas fueron redirigidas
a esta carpeta. Las capturas JSON y los documentos que describen el estado
actual permanecen fuera del archivo. La operación es reversible y queda
registrada en `docs/document-inventory.md`.
