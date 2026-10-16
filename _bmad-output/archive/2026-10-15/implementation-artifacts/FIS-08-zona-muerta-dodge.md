# FIS-08 · Zona muerta del dodge

**Resultado observable:** el segundo salto con una entrada direccional analógica
inferior a `0.20` conserva el doble salto vertical. Con una magnitud igual o
superior, inicia un dodge aéreo dirigido y normalizado.

## Implementado

- `TUNING.dodgeDeadzone` centraliza el umbral en `0.20`.
- La detección usa la magnitud conjunta de acelerador y giro, no cada eje por
  separado; las diagonales se siguen normalizando antes de aplicar el impulso.
- El doble salto vertical no crea tiempo de dodge ni impulso comprometido.

## Criterios comprobados

- Una entrada de acelerador `0.19` durante el segundo salto añade elevación y
  deja `dodgeTime` en cero.
- Una entrada de acelerador `0.20` consume el segundo salto e inicia
  `dodgeTime`.
- La prueba es determinista y aísla el vehículo de bots y contactos ajenos.

## Siguiente trabajo

Medir en juego la duración, orientación y control permitido durante el dodge
antes de ajustar su impulso o sus tasas de rotación.
