# FIS-14B — Máquina de estados de salto

Fecha: 10 de octubre de 2026  
Estado: implementada y validada de forma determinista.

## Alcance realizado

- Se añadió `jumpState` al coche y al snapshot autoritativo: `grounded`,
  `first-jump`, `double-jump`, `dodge`, `airborne` y `wall-jump`.
- Solo el primer salto usa `jumpHold`; un doble salto vertical ya no puede
  reactivar elevación mantenida.
- Un dodge captura una dirección normalizada en el marco local del chasis.
  La entrada enviada después no puede cambiar esa dirección durante la ventana
  comprometida.
- Al aterrizar, el colector final de contactos cierra la acción, restaura los
  dos saltos y publica `grounded`.

## Incidencia resuelta

Un dodge diagonal podía tocar el suelo primero con la carrocería. El aterrizaje
nivelaba la orientación pero conservaba la altura de la raíz de ruedas de la
postura inclinada, por lo que el coche quedaba sin apoyo al siguiente paso. El
aterrizaje ahora asienta la raíz en el plano y vuelve a derivar el apoyo desde
el colector común. La regresión cubre el dodge hasta `grounded`.

## Evidencia

- `npm test`: 56 pruebas correctas, incluida la secuencia completa de acciones
  y la repetibilidad con pasos de entrada agrupados.
- `npm run probe`: publica `jumpActions`, con la dirección diagonal capturada,
  la expiración a `airborne`, el aterrizaje y el doble salto vertical.

## Siguiente entrega

FIS-14C medirá cada eje aéreo y el nitro sobre esta máquina de estados, antes
de tocar cámara, arena de desguace, combate o bots.
