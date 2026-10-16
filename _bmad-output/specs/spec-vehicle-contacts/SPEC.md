# Especificación: contactos del vehículo

## Propósito

Reemplazar las colisiones horizontales basadas en un radio fijo por la
proyección del chasis. El alcance conserva la simulación autoritativa a 120 Hz
y no altera aún el modelo aéreo, los cohetes ni el aspecto visual.

## Estado de referencia

`src/simulation.js` usa una esfera horizontal de radio `1.7` para límites,
coberturas y choques entre coches. El render ya representa un chasis de
aproximadamente `3.55 × 1.84` unidades. Esa discrepancia permite contactos
incorrectos en un lateral, en un morro y al girar junto a una pared.

## Contrato FIS-01

- El chasis tendrá una huella orientada en el plano: semilargo `1.775` y
  semiancho `0.92`; el eje largo sigue el `yaw` del coche.
- Paredes, coberturas y otros chasis calcularán la separación y la corrección
  con esa huella orientada, usando el eje de mínima penetración.
- El contacto sigue limitado verticalmente por el modelo actual de altura.
  Pendientes, paredes escalables, techo, suspensión y orientación de impacto
  tridimensional son historias posteriores.
- La autoridad se mantiene en `ArenaMatch`; el cliente recibe instantáneas.

## Criterios de aceptación

1. Un coche girado 90° puede acercar su lateral a una pared más que su morro,
   sin que su chasis atraviese el límite.
2. Dos coches alineados por el eje largo se separan si sus huellas se solapan,
   incluso cuando la distancia entre centros supera el antiguo diámetro de
   `3.4` unidades.
3. Las colisiones de coberturas y el daño por embestida continúan cubiertos por
   las pruebas existentes.
4. Las pruebas son deterministas a través de los subpasos de 120 Hz.

## Comprobación reproducible

Ejecutar `npm test` desde la raíz. Las pruebas de pared girada y de dos chasis
deben pasar junto con la suite anterior.

## Trabajo aplazado

Contacto 3D con paredes/techo, suspensión y ruedas, impulso angular de los
choques, y calibración de conducción, salto, dodge, air roll y nitro.

## Contrato FIS-02

- El apoyo sobre terreno se calcula en el centro y las cuatro esquinas de la
  huella del chasis.
- La mayor altura de esas muestras es el suelo de apoyo mientras el modelo
  conserva su representación actual de altura y orientación.
- Al abandonar una rampa, el coche permanece apoyado mientras alguna esquina
  sigue sobre ella y cae cuando todas dejan de hacerlo.
- Esta historia no introduce suspensión, contacto de rueda individual, pared
  escalable ni techo.

## Contrato FIS-03

- Los límites laterales generan una normal de contacto explícita por paso y
  conservan la componente tangencial de la velocidad.
- El techo de la arena está a `24` unidades y devuelve al coche con la misma
  restitución amortiguada que una pared.
- El snapshot autoritativo expone `wallNormal` y `ceilingContact` para que el
  render y las pruebas puedan distinguir contacto de simple proximidad.
- El wall ride, la alineación de la carrocería con una pared y el contacto de
  techo como superficie jugable se reservan para una historia posterior.
