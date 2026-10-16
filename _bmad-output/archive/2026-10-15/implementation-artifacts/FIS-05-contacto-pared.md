# FIS-05 · Contacto de pared jugable

**Resultado observable:** un coche en el aire que entra en una pared mientras
acelera conserva el movimiento tangencial, elimina solo la componente hacia la
pared, orienta el chasis con la normal, permite conducir por la pared y expone
`wallRide`, la normal y el quaternion en el snapshot.

## Implementado

- Ventana renovable de `0.18 s` mientras el coche permanece junto al borde y
  conduce sobre la superficie.
- Gravedad reducida durante esa ventana para producir deslizamiento vertical
  controlado.
- WASD acelera y gira en el plano tangente de la pared.
- El cliente interpola el quaternion autoritativo para mostrar la orientación
  correcta.
- El rebote anterior se mantiene para impactos sin intención de conducir hacia
  la pared.
- `wallRide` se incluye en el snapshot autoritativo y se limpia al reaparecer.

## Criterios comprobados

- El contacto normal elimina la velocidad hacia la pared y vuelve a colocar el
  chasis según la cara que apoya.
- El techo del coche queda hacia el campo y las ruedas hacia la pared.
- La velocidad paralela y la caída vertical permanecen continuas.
- La conducción refresca el contacto más allá de la ventana inicial.
- Saltar desde la pared empuja hacia dentro y consume un salto restante.
- El rebote simple y el techo conservan su comportamiento anterior.
- `npm test` pasa con 29 pruebas.

## Pendiente de esta historia

Extender colisiones a hitboxes de chasis 3D antes de ajustar esquinas y
transferencias entre pared, suelo y techo.
