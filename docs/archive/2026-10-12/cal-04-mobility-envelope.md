# CAL-04 — Envolvente cinemática de movilidad

Actualizado: 11 de octubre de 2026.

La línea base de salto se actualizó con FIS-19. Los valores históricos de
FIS-14J que describían una elevación dirigida quedan sustituidos: el dodge
vigente no añade impulso vertical propio.

## Propósito

CAL-04 mide la respuesta del coche completo en **CALIBRACIÓN LIMPIA**, sin
obstáculos, bots ni combate. No reproduce ni importa valores de Rocket League
o Car Soccer. Convierte una cualidad de manejo en datos propios para decidir un
solo ajuste cada vez.

Ejecutar:

```powershell
npm run probe:envelope
```

La sonda usa la simulación autoritativa a 120 Hz y mide:

- Tiempo hasta velocidad supersónica con aceleración y nitro.
- Cuarto de giro con agarre y con powerslide.
- Altura y tiempo de salto, compromiso y alcance inicial del dodge.
- Tiempo de cuarto de giro, frenado al soltar e inversión por pitch, yaw y
  roll en el aire.

## Hallazgo y corrección FIS-14F.1

La línea base previa ya completaba un cuarto de giro aéreo en 0,417–0,542 s,
pero tardaba 0,900–1,175 s en frenar a cero después de soltar el control. La
inercia de liberación era mucho mayor que la respuesta activa y dificultaba
encadenar correcciones.

Se ajustó **solamente** la amortiguación al soltar un eje:

| Eje | Antes de liberar | Antes: hasta neutro | Ahora: hasta neutro | Giro de 90° conservado |
| --- | ---: | ---: | ---: | ---: |
| Pitch | 5,4 rad/s | 0,900 s | 0,450 s | 0,483 s |
| Yaw | 4,4 rad/s | 0,967 s | 0,442 s | 0,542 s |
| Roll | 7,2 rad/s | 1,175 s | 0,500 s | 0,417 s |

El cambio está en `TUNING` dentro de `src/simulation.js`. Mantiene la misma
velocidad máxima, aceleración angular bajo pulsación, salto, dodge, nitro y
contactos. Esto hace el coche más corregible en el aire; no declara por sí solo
igualdad de tacto con una referencia.

## Línea base actual

| Familia | Medida |
| --- | ---: |
| Nitro hasta supersónico | 1,500 s |
| Giro de 90° con agarre | 1,042 s |
| Giro de 90° con powerslide | 0,400 s |
| Ápice de salto sostenido | 6,037 u |
| Tiempo de salto sostenido | 1,583 s |
| Avance de dodge frontal a 0,175 s | 3,229 u |
| Segundo salto vertical / dodge frontal / lateral | `+6,968 / −0,133 / −0,133 u/s` inicial; solo el doble salto aporta impulso vertical |
| Invertir pitch, yaw, roll hasta cruzar neutro | 0,300 / 0,300 / 0,308 s |

## FIS-19 — Temporización del primer salto y segundo salto

La comparación y la revisión de RocketSim confirman que un dodge lateral
nivelado solo pierde gravedad, porque su dirección local no tiene componente
vertical. El solver conserva su vector local, follow-through y giro sin añadir
una separación vertical inventada. El primer salto garantiza `0,025 s` de pulso
y abre la ventana de segundo salto después de `0,2 s` como máximo.

CAL-04 publica ahora tres perfiles en `actions.secondJump`. Los dos dodges
deben conservar elevación positiva y similar entre direcciones niveladas, y
mantenerse por debajo del doble salto. La prueba de simulación también avanza
un subpaso adicional tras el lateral para confirmar que ya no se suma otra
elevación. Esta relación es una calibración propia; las referencias solo
justifican que los estados, ventana y dirección sean acciones separadas.

## Corrección FIS-13C — conservación en powerslide

Una curva con agarre de 90° conservaba el 90,0% de la velocidad de entrada. El
powerslide inicial alcanzaba el giro en 0,492 s y radio 7,110 u, pero sólo
conservaba el 63,1%. Se compararon dos cambios aislados de agarre lateral de
derrape, manteniendo iguales ángulo de rueda, aceleración, par de freno de mano
y amortiguación de yaw:

| Agarre delantero / trasero | Tiempo de 90° | Radio | Velocidad conservada | Recuperación |
| --- | ---: | ---: | ---: | ---: |
| 0,62 / 0,20 — anterior | 0,492 s | 7,110 u | 63,1% | 0,450 s |
| 0,48 / 0,16 — primera variante | 0,458 s | 6,734 u | 66,4% | 0,450 s |
| 0,32 / 0,10 — seleccionada | 0,400 s | 6,114 u | 73,4% | 0,450 s |

La variante seleccionada conserva más impulso, cierra el arco y vuelve a
tracción en el mismo intervalo. Es un ajuste propio de la distribución de
agarre; no representa ni copia una curva de neumático de las referencias.

## FIS-13D — Matriz de tres velocidades

La inspección estática de referencias confirma que los controles de conducción
son ejes separados, pero no extrae una curva de dirección o neumático que se
pueda trasladar. Por eso la matriz fija primero la respuesta propia, sin
introducir una corrección ciega:

| Entrada | Banda baja: radio | Banda media: radio | Banda alta: radio |
| --- | ---: | ---: | ---: |
| Agarre | 5,408 u | 19,154 u | 37,121 u |
| Powerslide | 3,535 u | 8,404 u | 13,916 u |
| Agarre + nitro | 7,881 u | 29,712 u | 59,342 u |
| Powerslide + nitro | 4,328 u | 9,624 u | 15,314 u |

Cada trayectoria completó 45°. El giro con agarre se abre con velocidad y el
powerslide sigue siendo la alternativa de radio cerrado. Con nitro la velocidad
aumenta durante la curva, de modo que el radio se abre sin un cambio de control.
La matriz no señala una regresión aislada: evita confundir esta relación de
velocidad con un fallo de dirección. El siguiente ajuste de conducción necesita
un defecto observable a una banda concreta, no un objetivo copiado de terceros.

## Validación

- `npm test`: 81 pruebas pasan.
- `npm run probe`: la maniobra aérea mantiene `cadenceMatches = true`.
- `npm run probe:envelope`: todas las maniobras completan giro, frenado,
  inversión, salto, dodge y conducción.

## Siguiente decisión

La siguiente historia comparará trayectorias completas de conducción a baja,
media y alta velocidad, con y sin nitro. Debe comprobar radio, velocidad de
salida y transición al soltar dirección, antes de modificar motor, freno,
ángulo de rueda o dirección. No volver a variar los ejes aéreos sin un defecto
visible y repetible.
