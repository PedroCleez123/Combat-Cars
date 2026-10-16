# FIS-08 · Fase y cancelación del dodge

**Resultado observable:** un dodge dirigido conserva impulso y rotación local
durante su ventana aunque el jugador suelte los controles. En un dodge frontal
o trasero, la entrada de aceleración opuesta cancela el cabeceo sin cancelar el
impulso.

## Implementado

- La dirección normalizada elegida al segundo salto se guarda por separado de
  la velocidad lineal.
- Durante `dodgeTime`, la fase asigna tasas locales de cabeceo, guiñada y
  alabeo; las tasas normales de vuelo no la sustituyen cada subpaso.
- La cancelación mide la entrada opuesta a la componente frontal elegida y
  atenúa sólo la tasa de cabeceo del dodge.
- El snapshot autoritativo expone `dodgeRemaining` y `dodgeCancelling`; el HUD
  los muestra para que una sesión de práctica pueda medir la maniobra.

## Criterios de aceptación

- Al soltar los controles, la orientación cambia durante la ventana activa.
- La entrada opuesta reduce la rotación frontal sin eliminar el impulso
  comprometido.
- La orientación final coincide con entradas equivalentes entregadas a 120 Hz
  y a 30 Hz, gracias a los subpasos de 120 Hz.

## Límite de referencia

La búsqueda de símbolos de dodge en la base estática del ejecutable de
referencia no terminó dentro del límite de consulta. Esta entrega aplica la
relación ya registrada entre ventana temporal, dirección local normalizada e
impulso comprometido; los valores siguen siendo propios y deberán calibrarse
en práctica.
