# M1-01 — respuesta de guiñada en suelo

Fecha: 11 de octubre de 2026  
Estado: **rechazado; línea base restaurada**

## Observación

El guion `ground-control` usa 48 ticks de aceleración, 24 de giro con agarre,
24 de powerslide y 48 de liberación, todo a 120 Hz. La comparación contra la
captura de RocketSim R1 arrojó:

| Señal | RocketSim R1 | Arsenal R0 | Lectura |
| --- | ---: | ---: | --- |
| Pico de guiñada | 2,8891 rad/s | 2,0716 rad/s | Arsenal gira un 28,3 % menos en el guion común. |
| RMS de forma de velocidad | — | 0,0546 | Cerca de la puerta inicial del 5 %, sin cambiar motor. |
| RMS de forma de guiñada | — | 0,1005 | Hay margen concreto para calibrar dirección. |

El valor observado de Arsenal está por debajo de `wheelYawRate` y del límite
de powerslide, por lo que subir ese límite no resolvería la causa. La hipótesis
es que la conversión de par de rueda a velocidad de guiñada es insuficiente.

## Cambio único

`TUNING.wheelYawResponse` pasa de `0,62` a `0,86`. No cambian la curva de
dirección, fuerzas longitudinales, agarre lateral, límites de guiñada ni el
modelo aéreo.

## Criterios de aceptación

1. `npm test` termina sin fallos.
2. `npm run probe:envelope` conserva las comprobaciones de conducción y
   powerslide.
3. `ground-control` conserva 144 muestras a 120 Hz.
4. El pico de guiñada de Arsenal queda entre 2,744 y 3,033 rad/s, una banda de
   ±5 % respecto a 2,8891.
5. El RMS de forma de velocidad no supera 0,060 y el de guiñada no supera
   0,100 frente a `rocketsim-r1-c2baacb8.json`.

## Resultado

La variante produjo 144 muestras y mantuvo las regresiones de unidad y la
envolvente, pero no superó la comparación de referencia:

| Señal | Arsenal R0 | M1-01 | Criterio | Resultado |
| --- | ---: | ---: | ---: | --- |
| Pico de guiñada | 2,0716 | 2,2500 rad/s | 2,744–3,033 | No alcanza. |
| RMS de forma de velocidad | 0,0546 | 0,0691 | ≤ 0,0600 | Empeora. |
| RMS de forma de guiñada | 0,1005 | 0,0992 | ≤ 0,1000 | Mejora insuficiente. |

Se restauró `wheelYawResponse` a `0,62`. La observación muestra que el giro y
la pérdida de velocidad están acoplados en el solver de rueda: no procede
seguir elevando una respuesta global.

## M1-02 — segmentación del guion

Antes de cambiar agarre, reparto de fuerza o par de guiñada, el comparador
publicará métricas independientes para `accelerate`, `grip-turn`,
`powerslide-turn` y `release`. La hipótesis siguiente se elegirá después de
ver dónde aparece el desfase y solo modificará ese submodelo. M2 y M3
permanecen fuera de alcance.

### Resultado M1-02

La captura `arsenal-m1-02-phase-baseline.json` separa la causa:

| Fase | RMS de velocidad | RMS de guiñada | Conclusión |
| --- | ---: | ---: | --- |
| `accelerate` | 0,0054 | 0 | Motor no es la causa. |
| `grip-turn` | 0,0127 | 0,0380 | El giro con agarre ya sigue la forma de referencia. |
| `powerslide-turn` | 0,1142 | 0,1620 | Déficit localizado. |
| `release` | 0,0409 | 0,0839 | La liberación hereda el desvío del powerslide. |

## M1-03 — compensación de par en powerslide

**Hipótesis.** El compensador de guiñada propio para un solver de rueda
compacto es demasiado bajo durante la rampa de handbrake. A diferencia de
`wheelYawResponse`, `driftYawTorque` solo se aplica multiplicado por
`handbrake` y no modifica el giro con agarre.

**Cambio único probado.** `driftYawTorque` pasó temporalmente de `7,4` a `20`.

**Criterios de aceptación.** La captura conserva 144 ticks; la fase
`grip-turn` conserva su RMS de velocidad no mayor que `0,015`; la fase
`powerslide-turn` alcanza un pico de guiñada entre `2,72` y `3,02 rad/s`,
reduce su RMS de guiñada a `≤ 0,120` y no aumenta su RMS de velocidad sobre
`0,115`. Todas las pruebas y la envolvente deben pasar. Un incumplimiento
restaura el valor de `7,4`.

### Resultado M1-03

La variante pasó las pruebas y la envolvente, pero no la puerta de curva:

| Señal en `powerslide-turn` | M1-02 | M1-03 | Criterio | Resultado |
| --- | ---: | ---: | ---: | --- |
| Pico de guiñada | 2,0716 | 2,7139 rad/s | 2,72–3,02 | Apenas por debajo. |
| RMS de guiñada | 0,1620 | 0,1392 | ≤ 0,1200 | Mejora parcial, no suficiente. |
| RMS de velocidad | 0,1142 | 0,0805 | ≤ 0,1150 | Mejora. |

Se restauró `driftYawTorque` a `7,4`. La referencia ya llega al inicio de
`powerslide-turn` con `2,3636 rad/s`, mientras Arsenal llega con `1,3901`;
subir solo el par de handbrake corrige tarde y mantiene demasiado giro durante
la liberación. Antes de abrir otra constante se revisará la geometría e inercia
efectivas del chasis y sus ruedas frente al perfil de referencia.

## M1-04 — posición longitudinal del eje delantero

**Evidencia.** Con la longitud visible de Arsenal (`3,55`) como escala de los
`120,507 UU` del Octane público de RocketSim, el eje delantero equivalente es
`x=1,510` y el trasero `x=-0,995`. Arsenal usaba `+1,02` y `-1,05`: un
wheelbase de `2,07` frente a `2,504` normalizado. El solver usa esas posiciones
tanto para la velocidad local como para `yawTorque`, por lo que compensar con
fuerzas una palanca incorrecta oculta la causa.

**Cambio único.** El eje delantero pasa de `+1,02` a `+1,51` en
`WHEEL_LAYOUT`. La posición renderizada de sus ruedas cambia al mismo valor;
el eje trasero, track, collider, suspensión, grip y torque no cambian.

**Criterios de aceptación.** Todas las pruebas y la envolvente pasan; la
captura mantiene 144 ticks; el desfase absoluto de pico de guiñada de
`grip-turn` mejora respecto a la base (`|2,3636 − 1,3901|`); el RMS de
velocidad de esa fase no supera `0,025`; y el RMS de velocidad de
`powerslide-turn` no supera `0,115`. Si falla, se restaura `+1,02` antes de
abrir una hipótesis de inercia o ancho.

### Resultado M1-04

La hipótesis se **rechazó y revirtió**. Adelantar solo el eje delantero a
`+1,51` completó las maniobras, pero hizo que la envolvente cerrara los radios
de agarre de `5,913/18,927/37,811` a `4,578/9,827/14,754` en las tres bandas.
El giro de 90° con agarre cayó a `0,442 s` y retuvo solo `79,8 %` de la
velocidad de entrada. Tres pruebas de conducción fallaron (91 pasan, 3 fallan)
porque ya no se conservaban el giro gradual ni la diferencia de slip esperada.

El eje delantero y la malla volvieron a `+1,02`. El perfil Octane público sigue
siendo evidencia de que las proporciones difieren, pero cambiarlo aisladamente
mezcla wheelbase, masa virtual, track y collider. La siguiente historia no
usará una corrección de palanca aislada: definirá un perfil completo con sus
propias pruebas de colisión, suspensión y render antes de adoptarlo.
