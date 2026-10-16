# M4 — contactos y aterrizajes

Fecha: 11 de octubre de 2026  
Estado: **M4-01, M4-02, M4-02b y M4-03 aceptados; M4-04 pendiente**

> **Corrección de referencia (11 de octubre de 2026):** Rocket League no
> endereza el chasis mediante una regla especial al tocar el suelo. La
> retención y la aproximación explícita de pitch/roll que todavía existen en
> `src/simulation.js` eran una decisión provisional de Arsenal, no un objetivo
> de fidelidad. M4-03 las retiró en una historia aislada; el aterrizaje conserva
> la orientación y la velocidad angular hasta que los contactos de ruedas y la
> suspensión produzcan una respuesta física observable.

## Decisión

La hoja de ruta vigente sigue siendo adecuada. M2 y M3 ya fijan el control en
aire y el segundo salto contra trazas de RocketSim; el siguiente riesgo para
la sensación de vuelo es la transición entre ese estado aéreo y el apoyo de
ruedas. M4 trabajará solo esa transición en `CALIBRACIÓN LIMPIA`.

No se modificarán en M4 el impulso del salto, el torque del dodge, los ejes
aéreos, el nitro, la cámara, las rampas, los bots ni el combate. La captura
M3 es una regresión obligatoria: un cambio de contacto no puede alterar la
trayectoria de un dodge mientras siga en el aire.

## Diagnóstico actual

La simulación ya resuelve un chasis quaternion contra los seis planos y
mantiene cuatro muelles de rueda. El orden actual tiene tres momentos que
deben medirse como fases distintas:

1. El chasis puede tocar el plano y eliminar penetración.
2. Las ruedas pueden empezar a comprimirse.
3. Dos ruedas con carga significativa devuelven `grounded`, los dos saltos y
   el control terrestre.

Ese contrato evita devolver saltos al primer contacto de carrocería. Falta una
traza que publique de forma continua las tres fases para un aterrizaje real
después de un dodge. Las métricas antiguas de FIS-14H/I son evidencia de que
el flujo existe, pero no sirven como objetivo: son anteriores a la curva M3
aceptada y deben sustituirse por una línea base nueva.

## Alcance y orden

### M4-01 — captura de transición propia, sin ajuste físico

**Estado: aceptado el 11 de octubre de 2026.** La instrumentación está en
`src/contact-transition-probes.js`, el ejecutor reproducible en
`tools/contact-transition-probes.mjs` y la regresión en
`tests/simulation.test.mjs`. `npm run probe:contacts` genera
`docs/reference-captures/arsenal-m4-01-contact-transitions.json`.

**Objetivo observable:** producir un JSON determinista a 120 Hz para caída
plana, caída con pitch, caída con roll, dodge frontal, lateral y diagonal.
Cada frame registrará pose, velocidades local y lineal, contacto de chasis,
cada rueda, compresión, velocidad normal, primer contacto de carrocería,
primer apoyo de dos ruedas, restitución de saltos y asentamiento final.

**Criterios de aceptación:**

- Misma captura con pasos de 120 Hz y paquetes agrupados de hasta 50 ms.
- Ningún salto ni control terrestre antes de dos ruedas cargadas.
- Ninguna penetración de chasis por debajo de la tolerancia existente.
- El quaternion y la velocidad tangencial permanecen continuos durante el
  primer contacto; la traza hace visible cualquier corrección.
- Las comparaciones M2/M3 existentes y las 95 pruebas siguen pasando.

**Decisión de M4-01:** esta historia solo reveló qué fase divergía. No cambió
`TUNING` ni el solver; la corrección posterior quedó aislada en M4-03.

**Resultado observado (captura previa a M4-03):** las seis maniobras producen
300 muestras cada una a 120 Hz y terminan con cuatro ruedas cargadas,
`grounded=true` y `jumps=2`.
El contacto de carrocería precede al apoyo de dos ruedas en todos los casos,
sin separación de suelo negativa. La captura publica además un resumen final
para repetirla con paquetes agrupados de hasta 50 ms; esos finales coinciden
con la ejecución de un paquete por paso fijo. La línea base queda así:

| Escenario | Primer contacto | Primer apoyo | Separación | Velocidad tangencial máxima después del contacto |
| --- | ---: | ---: | ---: | ---: |
| caída plana | frame 119 | frame 120 | 0 | 0 u/s |
| caída con pitch | frame 108 | frame 109 | 0 | 0 u/s |
| caída con roll | frame 109 | frame 110 | 0 | 0 u/s |
| dodge frontal | frame 32 | frame 45 | 0 | 12,14 u/s |
| dodge lateral | frame 45 | frame 47 | 0 | 12,08 u/s |
| dodge diagonal + roll | frame 38 | frame 43 | 0 | 12,1195 u/s |

La prueba de instrumentación termina con **95 pass, 0 fail**. En la primera ejecución la
aserción comparaba el resumen compacto con el snapshot agrupado completo; se
separó el formateo `compactFinal` para comparar exactamente el mismo contrato.
No se cambiaron constantes de física, el solver ni la captura M3.

### M4-02 — referencia R4 de suelo con RocketSim

**Estado: referencia generada y comparada el 11 de octubre de 2026.** El
oráculo emite `contactTraces` en
`docs/reference-captures/rocketsim-r4-contact-transitions-c2baacb8.json` y la
comparación reproducible queda en
`docs/reference-captures/arsenal-r4-contact-comparison.json`. La captura se
construye con el commit `c2baacb8` de RocketSim en una build aislada Release
con `/Z7`; el ejecutable no entra en el proyecto.

**Objetivo observable:** extender el oráculo aislado con un plano Bullet propio
y una condición inicial alta, sin arena ni assets externos. Emitirá las mismas
familias de caída y dodge hasta que el coche alcance suelo estable.

**Métricas comparables:** tick de contacto, tick de apoyo, actitud antes y
después, velocidad normal, velocidad tangencial y tiempo hasta asentarse. Las
posiciones y velocidades se normalizarán por la escala de cada motor; los
ángulos, las tasas locales y el tiempo se compararán directamente.

**Límite:** R4 valida suelo y suspensión. No sirve para declarar fidelidad de
paredes, esquinas ni techo, porque esos contactos no forman parte del plano
sintético. No se usarán binarios, assets ni datos extraídos de Rocket League.

**Resultado de la medición previa a M4-03:** RocketSim conserva el orden de apoyo de ruedas y asentamiento en
las seis maniobras. `CarState` no ofrece compresión de muelle y solo publica
contacto de carrocería cuando Bullet informa una colisión del chasis; el
harness aislado conserva además longitud y fuerza de `btVehicleRL` únicamente
para medir la transición. El informe no proporciona fuerzas copiables: las
unidades siguen siendo distintas y las alturas iniciales no son equivalentes.
Los finales se usan como evidencia de forma y orden, no como valores que
copiar.

| Escenario | Arsenal apoyo/grounded | RocketSim apoyo/grounded | RocketSim asentado |
| --- | ---: | ---: | ---: |
| caída plana | 120 / 120 | 29 / 30 | 81 |
| caída con pitch | 109 / 109 | 22 / 38 | 85 |
| caída con roll | 110 / 110 | 26 / 34 | 103 |
| dodge frontal | 45 / 45 | 144 / 149 | 249 |
| dodge lateral | 47 / 47 | 122 / 133 | 286 |
| dodge diagonal + roll | 43 / 43 | 135 / 135 | 197 |

La comparación completa conserva las diferencias de ángulo de apoyo y de
velocidad tangencial junto con sus limitaciones. M4-03 corrigió únicamente el
momento de contacto observable en Arsenal, sin copiar fuerzas de RocketSim.

### M4-02b — puerta de normalización (medición, sin cambio físico)

**Estado: completada el 11 de octubre de 2026.**
`npm run normalize:contacts` genera
`docs/reference-captures/arsenal-r4-contact-normalized.json`. El informe
estima la gravedad y la altura libre de cada caída, y expresa el tiempo hasta
apoyo como una razón adimensional respecto a la caída libre. Para flat/pitch/roll
las razones propias son `0,9874`, `0,9588` y `0,9676`; R4 produce `0,7964`,
`0,6042` y `0,7141`. La carga media de rueda también se normaliza por su
valor asentado: en flat/pitch/roll el pico R4 es `3,0764`, `2,0455` y `2,605`
frente a `1`, `1,0313` y `1` de Arsenal. Esto separa una diferencia de escala
de una respuesta de suspensión; la carga relativa es una señal de forma, no
una fuerza común ni una constante que copiar.
Las maniobras de dodge quedan marcadas como no aplicables a la normalización
de caída libre. La puerta de corrección sigue cerrada y no se tocaron
constantes.

### M4-03 — aterrizaje gobernado por contacto y suspensión

Se escoge exactamente uno de estos grupos según la diferencia medida:

| Brecha | Único grupo que puede cambiar |
| --- | --- |
| Contacto de carrocería y apoyo de ruedas aparecen en orden incorrecto | colector y transición de soporte |
| La caída o rebote vertical no sigue la forma de R4 | rigidez, amortiguación o resolución normal |
| La pose cambia de forma discontinua al apoyar | corrección de contacto, suspensión o impulso normal; no se añadirá auto-enderezado |
| La velocidad paralela desaparece o aumenta sin fuerza de rueda | resolución de velocidad tangencial |

Cada candidato debe repetir todas las trazas M4-01, la comparación R4 y las
regresiones M2/M3. Si no mejora la métrica objetivo sin degradar otra, se
revierte y se registra el resultado.

**Estado: aceptado el 11 de octubre de 2026.** La hipótesis aislada fue que el
contacto de carrocería estaba anulando el momento de impacto sin transmitirlo
al chasis. La corrección aplica el impulso normal en el brazo de contacto y
deja que las tasas locales de pitch/roll y los cuatro muelles produzcan la
respuesta. No se fija `pitch`, `roll` ni sus tasas a cero al aterrizar y no se
añade una regla de auto-enderezado.

También se redujo el umbral interno de compresión que devuelve apoyo jugable a
`0,01` unidades: una pareja de neumáticos puede sostener el coche mientras la
suspensión termina de cargarse. La sonda usa el mismo umbral; el cuerpo sigue
siendo el primer contacto o coincide con el apoyo, y nunca devuelve saltos con
menos de dos ruedas cargadas.

La regresión completa queda en **95 pass, 0 fail**. La captura nueva de
`npm run probe:contacts` conserva separación mínima `0`; los escenarios
terminan `grounded=true` y `jumps=2`. Los apoyos finales son cuatro ruedas en
caídas plana/pitch/roll y dodge frontal, y dos ruedas en los dodges lateral y
diagonal, donde se conserva parte de la actitud en vez de aplanarla.

### M4-04 — paredes, esquinas y techo

Una vez cerrado el suelo, se medirán por separado pared oblicua, esquina
suelo-pared, techo y el desprendimiento posterior. La puerta aquí es
invariantes físicas: sin penetración, corrección solo de la velocidad normal,
contactos coherentes y repetibilidad. No se retoca conducción por pared ni
cámara dentro de esta historia.

## Puerta de salida M4

M4 se considerará cerrada cuando:

1. La referencia R4 y la traza de Arsenal expliquen con precisión el contacto
   de suelo y la recuperación de ruedas.
2. Cada escenario respete la semántica de apoyo antes de devolver los saltos.
3. La orientación y la velocidad angular durante el aterrizaje no reciban un
   objetivo artificial de plano; cualquier cambio deberá proceder del contacto,
   la suspensión o una entrada del jugador, sin un salto visual entre frames.
4. La velocidad tangencial siga la tendencia de la referencia; cualquier
   frenada adicional estará atribuida a neumáticos cargados, no a un clamp.
5. `npm test`, la envolvente y las comparaciones M2/M3 pasen sin cambios en
   sus resultados aceptados.

Después de M4, M5 comprobará presentación, cámara e interpolación usando una
física ya congelada. La prueba jugable humana se realizará entonces como
validación de tacto, no como sustituto de estas medidas.

## Riesgos y prevención

| Riesgo | Prevención |
| --- | --- |
| El suelo de RocketSim altera un dodge antes de medirlo | El tramo de M3 permanece en altura segura; R4 empieza a medir solo desde su condición de descenso declarada. |
| Una diferencia de unidades parece una diferencia de dinámica | Comparar formas, ticks, ángulos y tasas locales; publicar picos absolutos como contexto. |
| Ajustar suspensión cambia el segundo salto | Mantener la captura M3 como regresión y no mezclar grupos de constantes. |
| Un contacto de carrocería da controles antes de tiempo | Conservar la regla de dos ruedas cargadas y registrar ambos eventos por separado. |
| La cámara parece un fallo de física | Aplazarla a M5 y usar la orientación autoritativa de la traza como evidencia. |

## Próxima acción

M4-03 queda cerrada con la escala temporal de caída y la carga relativa de
rueda registradas. La siguiente historia es M4-04: medir pared oblicua,
esquina suelo-pared y techo con la misma regla de contacto, sin tocar las
constantes aéreas, de salto, cámara o combate.
