# FIS-10 · Coberturas con volumen vertical

**Resultado observable:** una cobertura bloquea el lateral de un coche que la
alcanza bajo su altura, sostiene un coche que cae sobre su techo y no corrige a
un coche cuyo volumen completo la supera en vuelo.

## Implementado

- El chasis obtiene límites verticales a partir de la orientación quaternion,
  longitud, anchura, altura y desplazamiento del cuerpo visible.
- La colisión de coberturas distingue cruce descendente por el techo, impacto
  lateral y paso por arriba.
- El techo de una cobertura entra como superficie autoritativa plana, por lo
  que restablece saltos y expone `surfaceType: "cover"` en el snapshot.
- Los golpes entre coches también comprueban el solape de sus volúmenes
  verticales antes de resolver el contacto horizontal.

## Criterios de aceptación

- Un coche que cae sobre un contenedor queda apoyado cerca de su altura y el
  snapshot declara `surfaceType: "cover"`.
- Un coche que atraviesa horizontalmente el contenedor con su chasis por encima
  no pierde velocidad por una corrección lateral.
- Los impactos bajos y los cohetes contra cobertura conservan su cobertura de
  regresión previa.

## Siguiente trabajo

Medir la respuesta angular de embestidas y explosiones usando estos volúmenes
antes de cambiar el daño o añadir nuevas armas.
