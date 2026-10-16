# FIS-19 — Contrato temporal del salto y segundo salto

Actualizado: 11 de octubre de 2026. Estado: plan aprobado para implementación.

## Evidencia y alcance

RocketSim expone una referencia pública que Car Soccer declara adaptar: impulso
inmediato de salto, fuerza sostenida de como máximo `0,2 s`, duración mínima de
`0,025 s`, y ventana de doble salto/dodge de `1,25 s` **después** de finalizar
ese salto sostenido. El dodge aplica su impulso en el plano horizontal; su
amortiguación vertical posterior no es una fuente de elevación.

Arsenal ya usa el mismo paso fijo de 120 Hz y conserva las ventanas de `0,2 s`
y `1,25 s`, pero inicia el contador de segundo salto al activar el primer salto
y no garantiza el pulso mínimo tras una pulsación muy corta. Esto reduce la
ventana efectiva y hace que una pulsación rápida dependa demasiado de la
cadencia del paquete.

Fuentes:

- [RLConst.h de RocketSim](https://raw.githubusercontent.com/ZealanL/RocketSim/main/src/RLConst.h):
  `JUMP_IMMEDIATE_FORCE`, `JUMP_ACCEL`, tiempos y límites públicos.
- [Car.cpp de RocketSim](https://raw.githubusercontent.com/ZealanL/RocketSim/main/src/Sim/Car/Car.cpp):
  orden de actualización del salto, doble salto y dodge.

## Decisiones

1. Mantener unidades propias de Arsenal y escalar las relaciones públicas con
   `56 / 2300`: impulso inmediato y doble salto ≈ `7,101`; fuerza sostenida ≈
   `35,507` unidades/s². No se copia código de RocketSim.
2. Modelar explícitamente el tiempo transcurrido del primer salto. La fuerza se
   aplica al menos `0,025 s`; si el botón sigue pulsado, continúa hasta `0,2 s`.
3. Abrir `secondJumpWindow` cuando la fuerza del primer salto termina por
   liberación o límite, nunca en el frame que empieza el salto.
4. Conservar el dodge como impulso horizontal comprometido, giro temporal y
   amortiguación vertical existente. No se reincorpora la elevación dirigida que
   contradice el comportamiento público.
5. Publicar el tiempo sostenido en el snapshot para distinguir un salto que aún
   recibe fuerza de una ventana real de segundo salto.

## Criterios de aceptación

- Una pulsación de un frame recibe al menos `0,025 s` de fuerza de salto.
- Soltar antes de `0,2 s` abre una ventana de segundo salto de `1,25 s` solo
  tras el pulso mínimo.
- Mantener el botón no abre esa ventana antes de agotar `0,2 s`.
- Un segundo salto/dodge dentro de la ventana conserva los seriales y la
  dirección comprometida existentes.
- `npm test` y `npm run probe:envelope` pasan sin cambiar contactos, cámara ni
  límites de velocidad.

## Validación visual posterior

Reiniciar el proceso autoritativo que sirve el puerto elegido, recargar la
pestaña local y comparar tres maniobras aisladas: toque corto de salto, salto
mantenido y salto + segundo salto direccional. La comparación con Car Soccer
será cualitativa mientras su página no exponga trazas de físicas al DOM.
