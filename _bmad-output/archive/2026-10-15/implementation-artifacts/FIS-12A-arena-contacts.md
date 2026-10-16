# FIS-12A — Contacto común de arena limpia

Estado: completada  
Fecha: 10 de octubre de 2026

## Resultado

CALIBRACIÓN LIMPIA resuelve el volumen de carrocería orientado por quaternion
contra los seis planos de la arena: suelo, cuatro paredes y techo. La
resolución corrige penetración y elimina solo la velocidad que entra en el
plano; conserva la componente tangencial. Con la misma secuencia, la
simulación produce el mismo snapshot a pasos de 120 Hz y con intervalos de
entrada agrupados.

Los contactos se publican en `cars[].contacts` con `kind`, normal hacia el
interior, punto mundial de contacto, `wheelCount`, `normalVelocity` y
`separation`. En esta historia `wheelCount` es cero: los apoyos de rueda
pertenecen a FIS-12B.

## Límites de alcance

- Solo el perfil CALIBRACIÓN LIMPIA usa el nuevo solver de seis planos.
- El perfil DESGUACE conserva sus límites y wall ride heredados como
  regresión hasta que esos sistemas se migren en historias posteriores.
- Contactar con paredes o techo no habilita todavía conducción por esas
  superficies.
- No se cambiaron motor, dirección, salto, dodge, nitro ni cámara.

## Comprobación

`npm test`: 48 pruebas pasan. La cobertura FIS-12A verifica reposo durante 10
segundos, impactos oblicuos en las cuatro paredes, contacto de techo, soporte
con quaternion rotado y repetibilidad de pasos agrupados. `npm run probe`
registra también la normal, punto, velocidad normal y separación de estos
contactos.

## Siguiente historia

FIS-12B añadirá cuatro apoyos de rueda con recorrido, compresión y amortiguación,
usando este solver como límite del chasis.
