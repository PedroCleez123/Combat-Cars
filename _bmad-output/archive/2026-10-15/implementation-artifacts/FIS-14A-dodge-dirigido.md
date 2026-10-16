# FIS-14A · Dodge dirigido sin elevación artificial

## Resultado observable

En una actitud nivelada, un dodge lateral no añade una velocidad vertical de
salto. Conserva la velocidad vertical existente y recibe únicamente gravedad;
el doble salto sin dirección continúa aplicando elevación explícita.

## Cambio

- Se eliminó el mínimo vertical mundial que elevaba todo dodge a una velocidad
  de `10`, incluso uno lateral.
- El impulso inicial y el seguimiento del dodge conservan su componente Y solo
  si la dirección local del chasis realmente la posee.
- El mantenimiento del primer salto exige que el botón siga mantenido desde
  aquella primera pulsación. Soltar y volver a pulsar ya no reactiva la ventana
  restante durante un segundo salto o dodge.

## Evidencia

`npm run probe` mide ahora, en los ocho dodges nivelados, un cambio vertical
inicial entre `-0,149` y `-0,133 u/s`; antes era `+4,133 u/s` en todos. La
pequeña diferencia entre direcciones procede de la actitud que empieza a
rotar durante el mismo subpaso.

## Comprobación

- La prueba de dodge lateral verifica que el cambio vertical es solo el paso
  de gravedad.
- Otra prueba verifica que una segunda pulsación no revive el mantenimiento
  del primer salto.
- `npm test`: 43 pruebas correctas.

## Alcance pendiente

La magnitud y curva temporal definitiva del dodge todavía requieren
calibración en el chasis/contacto futuro. Esta entrega elimina un acoplamiento
incorrecto sin afirmar equivalencia completa con la referencia.
