# Plan de reconstrucción de movilidad

Actualizado: 11 de octubre de 2026. Estado: **histórico de la reconstrucción
JavaScript**; la planificación actual vive en
[`current-development-roadmap.md`](current-development-roadmap.md). M3 está aceptada contra la traza
R3 de RocketSim; M4-01, M4-02, M4-02b y M4-03 ya fijan la línea base propia,
la referencia de suelo sintético, la normalización temporal y el aterrizaje
gobernado por contacto. FIS-16A sigue pendiente de validación visual. La
siguiente historia es M4-04: paredes, esquinas y techo con la misma regla de
contacto, sin modificar las constantes aéreas, de salto ni de cámara. El plan concreto está en
[`archive/2026-10-12/m4-contact-landing-plan.md`](archive/2026-10-12/m4-contact-landing-plan.md).

## Decisión

La siguiente iteración no ajustará la lista actual de constantes de forma
aislada. Se reconstruirá la locomoción sobre un chasis único con posición,
velocidad, orientación quaternion, velocidad angular local y contactos de
superficie. El objetivo es una respuesta ágil y legible del mismo tipo que
Rocket League y Car Soccer: conducción con inercia y derrape controlable,
vuelo por ejes locales, nitro desde el morro, saltos temporizados y dodges
direccionales.

La implementación será original y permanecerá en JavaScript/Three.js con
servidor Node autoritativo y pasos fijos de 120 Hz. La evidencia disponible
de REA define relaciones de control y arquitectura; no proporciona valores de
diseño completos. La equivalencia se evaluará mediante escenarios repetibles y
pruebas de juego, sin afirmar coincidencia exacta antes de medirla.

## Diagnóstico que guía el orden

| Área | Estado actual | Decisión |
| --- | --- | --- |
| Estado del coche | La posición y velocidad se almacenan como `x/z/h` y `vx/vz/vh`, mientras que la orientación ya es quaternion. | Mantener esos campos temporalmente en el protocolo y reunirlos en operaciones vectoriales del chasis durante la migración. |
| Conducción | CAL-01 aplica motor, freno, reversa, agarre lateral, dirección y powerslide en los apoyos de rueda. DESGUACE aún conserva el control heredado. | Medir radios, transición de derrape y recuperación antes de migrar la conducción de DESGUACE. |
| Superficies | CAL-01 comparte el contacto del chasis con los seis planos y cuatro apoyos de rueda con muelle y amortiguador; rampas y DESGUACE conservan su resolución heredada. | Aplicar en FIS-13A las fuerzas de motor, freno y neumático en esos apoyos y migrar después el resto de superficies sin perder la regresión de CAL-01. |
| Aire | El quaternion y las tasas locales se integran como una única velocidad angular en el marco del coche. | Calibrar sensación, límites y amortiguación en una sesión visual sin mezclar cámara ni combate. |
| Salto y dodge | CAL-01 usa estados temporales explícitos para el primer salto, doble salto, dodge, aire y salto desde pared. | Conservar las ventanas y la dirección capturada mientras se calibra el control aéreo y el nitro. |
| Cámara y red | La cámara ya sigue el quaternion, pero se apoya en la malla interpolada; entrada y estado no tienen confirmación ni conciliación. | Ajustar presentación después de estabilizar la física local para no confundir latencia visual con respuesta física. |

## Arquitectura de llegada

Cada paso de 120 Hz seguirá este orden:

1. Leer la entrada retenida y detectar transiciones de pulsación.
2. Construir los ejes locales `forward`, `right` y `up` desde el quaternion.
3. Recoger contactos de las cuatro ruedas y de la carrocería contra suelo,
   paredes y techo de la arena limpia.
4. Aplicar fuerzas de motor, freno, neumáticos, gravedad, nitro, salto y
   dodge; aplicar torques de conducción y control aéreo en ejes locales.
5. Integrar velocidad lineal, velocidad angular, posición y orientación.
6. Resolver penetración y eliminar solamente la velocidad normal entrante.
7. Publicar el snapshot con contacto, velocidad y orientación para render y
   trazas.

El contacto contendrá `normal`, `point`, `kind`, `wheelCount` y velocidad
normal. El estado `grounded` se derivará de esos contactos; no de `h` por sí
solo. Las rampas y coberturas volverán cuando el mismo colector sea estable
contra los seis planos de CAL-01.

## Fases y puertas de salida

### FIS-12A — Chasis y contactos de arena limpia

**Estado: completada.** CAL-01 resuelve el volumen orientado del chasis contra
suelo, cuatro paredes y techo en un colector común. El solver corrige
penetración, elimina solo la componente de velocidad que entra en el plano y
conserva la tangente. Cada contacto autoritativo incluye normal, punto, tipo,
`wheelCount` y velocidad normal. FIS-12B incorpora el recuento de ruedas
cargadas. Los otros perfiles conservan temporalmente su resolución heredada.

**Alcance:** introducir soporte de carrocería orientada por quaternion y
contactos comunes de suelo, cuatro paredes y techo. Mantener la arena de
calibración como único entorno de trabajo.

**Resultado observable:** el coche descansa sin vibración, conserva la
velocidad paralela al tocar una pared y reporta el mismo formato de contacto
en suelo, pared y techo. No habrá todavía conducción por pared o techo.

**Comprobaciones:** reposo de 10 s, impacto oblicuo contra las cuatro paredes,
contacto de techo, y repetición idéntica a 120 Hz y con entrada agrupada.

Las comprobaciones están en `tests/simulation.test.mjs`; `npm run probe`
registra los contactos de suelo, cuatro paredes y techo además de las trazas de
movilidad existentes.

### FIS-12B — Suspensión y transición entre superficies

**Estado: completada.** CAL-01 tiene cuatro apoyos de rueda con recorrido,
compresión y amortiguación. Cada apoyo entrega fuerza normal y par de pitch o
roll al chasis. El contacto del chasis sigue siendo el límite duro contra los
seis planos.

Una rueda casi extendida puede amortiguar una caída, pero no devuelve controles
de suelo ni saltos: se exigen dos muelles de suelo con compresión significativa.
El snapshot publica cada rueda y añade el contacto de su plano cuando sostiene
el coche aunque la carrocería aún no lo toque.

**Resultado verificado:** caída plana amortiguada, aterrizajes con cabeceo y
alabeo sin atravesar el suelo, reposición de los dos saltos y esquina de suelo
y pared sin cruzar el límite. Las paredes usan el mismo marco de contacto; no
se habilita conducción sobre ellas.

### FIS-13A — Motor, freno y neumáticos

**Estado: completada.** CAL-01 aplica fuerza longitudinal de motor, freno o
reversa en las cuatro ruedas cargadas. Las ruedas delanteras giran y miden el
deslizamiento respecto de su propio eje; el agarre lateral y el brazo de
palanca producen el giro del chasis.

**Resultado verificado:** acelerar no fija una velocidad objetivo en un paso;
la frenada pasa por velocidad cero antes de reversa. El giro comienza con un
momento pequeño y la trayectoria cambia de forma continua; el agarre reduce la
velocidad lateral sin eliminarla en un paso. Se conserva la repetibilidad con
pasos agrupados.

**Medición inicial:** 26,767 u/s al segundo, 35,163 u/s a los dos segundos,
0,600 s hasta reversa. Con entrada de giro sostenida durante un segundo, la
traza alcanza 1,511 rad de yaw y 14,853 u de desplazamiento lateral. Son línea
base de este modelo, no una equivalencia declarada con ninguna referencia.

### FIS-13B — Powerslide

**Estado: completada.** Shift mantiene el modelo de fuerza de ruedas: libera
más el eje trasero que el delantero, abre el ángulo de dirección y añade un
par de freno de mano limitado. No asigna yaw, orientación ni velocidad lateral
de forma directa.

**Resultado verificado:** Shift inicia una deriva con más giro y deslizamiento
lateral que una curva con agarre. Al liberarlo, la inercia persiste el primer
paso y el agarre recupera el control de forma gradual; la tasa de yaw se
amortigua. La traza es idéntica con pasos agrupados.

**Medición inicial:** después de 0,5 s de deriva la línea base registra 1,636
rad de yaw, 2,182 rad/s de tasa y −14,338 u/s de deslizamiento lateral. Tras
1 s con Shift liberado, el deslizamiento vuelve a cero.

### FIS-13C — Conservación de impulso en powerslide

**Estado: completada.** CAL-04 mide ahora un cuarto de giro completo con
agarre y con powerslide: tiempo, radio efectivo, velocidad de entrada y salida,
deslizamiento lateral y recuperación. La deriva previa conservaba 63,1% de su
velocidad de entrada tras 90°. Se compararon dos variantes aisladas de agarre
de derrape, sin variar dirección, motor ni torque de freno de mano.

**Resultado verificado:** la distribución seleccionada de agarre delantero y
trasero conserva 73,4%, completa el giro en 0,400 s, dibuja radio 6,114 u y
recupera tracción en 0,450 s. El giro con agarre conserva 90,0%, tarda 1,042 s
y dibuja radio 16,682 u, por lo que siguen siendo maniobras distinguibles. La
traza, variantes y límite están en
[archive/2026-10-12/cal-04-mobility-envelope.md](archive/2026-10-12/cal-04-mobility-envelope.md).

**Siguiente tarea:** medir la misma familia de trayectorias a velocidades baja,
media y alta antes de modificar motor, freno, ángulo de rueda o dirección.

### FIS-14B — Salto, doble salto y dodge

**Estado: completada.** La acción publica estados `grounded`, `first-jump`,
`double-jump`, `dodge`, `airborne` y `wall-jump`. El primer salto es el único
que puede recibir elevación por mantenimiento. El segundo salto vertical no
recibe ese mantenimiento y un dodge captura sus dos componentes locales al
pulsar.

Un dodge completo que alcanza el suelo con la carrocería inclinada ya no queda
flotando después de nivelarse: el aterrizaje asienta las ruedas en el plano y
el colector final devuelve la acción a `grounded` con ambos saltos.

**Resultado verificado:** las ventanas y transiciones se publican en el
snapshot; las diagonales conservan magnitud normalizada, la dirección de dodge
no cambia con la entrada posterior y la cancelación conserva el impulso. Las
trazas cubren salto sostenido, doble salto, ocho dodges, dirección capturada y
aterrizaje.

### FIS-14C — Aire y nitro

**Estado: completada para la simulación determinista.** Las tres tasas locales
se integran como un vector angular único en el quaternion. De esta forma una
combinación de pitch, yaw y roll no depende de un orden arbitrario de tres
rotaciones. Se mantienen aceleración, límite y amortiguación explícitos por
eje. El nitro sigue siendo una fuerza continua a lo largo del morro.

**Resultado verificado:** W baja el morro, S lo eleva, A/D giran en aire y
Ctrl/Espacio producen air roll en el eje previsto. El nitro permite dirigir el
ascenso al inclinar el morro. Las tasas quedan limitadas y decrecen al soltar
el control; la actitud y las trazas conservan la repetibilidad a 120 Hz.

**Límite:** falta el playtest de tacto para decidir valores. Las relaciones de
ejes están comprobadas, pero no se declara todavía equivalencia de respuesta
con Rocket League o Car Soccer.

### FIS-14D — Calibración visual de aire y nitro

**Estado: FIS-14D.1 instrumentada; calibración táctil pendiente.**
`airManeuver` registra una maniobra con inversión, combinación de ejes,
liberación, reorientación y nitro. También demuestra que la misma entrada a
120 Hz y en paquetes legales de 50 ms produce la misma traza. El HUD de
calibración muestra estado, actitud y tasas para acompañar el guion de
[fis-14c-playtest.md](fis-14c-playtest.md).

FIS-14D.1 incorpora una sesión guiada dentro de CALIBRACIÓN LIMPIA. Sus seis
pasos registran snapshots autoritativos: actitud inicial y final, picos por
eje, velocidad, altura, estado, saltos y ACK. Al cerrar cada paso el piloto
elige una observación y puede copiar un informe. La regla de decisión propone
un solo grupo candidato o bloquea el ajuste si los defectos pertenecen a
cámara, red o contactos. No modifica `TUNING`. FIS-14D.2 conserva hasta seis
sesiones completas en almacenamiento local y compara las dos últimas: solo una
coincidencia del mismo candidato permite abrir una historia de ajuste.

La siguiente sesión ejecutará ese guion en CALIBRACIÓN LIMPIA y registrará
sensación, respuesta, velocidad angular y trayectoria. Ajustará como máximo un
grupo de constantes por iteración: pitch, yaw/roll, amortiguación o nitro.

**Puerta de salida:** una sesión repetida no muestra inversión de controles,
giros erráticos al combinar ejes ni discrepancia entre la cámara y el morro.
Cada ajuste se acompaña de `npm run probe`, `npm test` y de un resultado
anotado en el registro de física.

### FIS-14E — Semántica de free air roll

**Estado: completada.** La inspección estática de Car Soccer mostró que Shift
es un modificador de free air roll: mientras se mantiene, A/D dejan de producir
guiñada y pasan al eje de alabeo. Ctrl/Espacio son alabeo direccional
independiente y conservan la guiñada de A/D. El cliente compone esas entradas
en `src/control-mapping.js`; la simulación usa `airRoll` solo para el
modificador y `roll` para el eje final. Las dos rutas están cubiertas por
pruebas y la traza de 120 Hz mantiene su cadencia.

**Puerta de salida:** free roll sin guiñada creciente, alabeo direccional con
guiñada simultánea y suma de ejes limitada. La calibración de tasas sigue
siendo una actividad manual separada.

### FIS-14F.1 — Frenado angular aéreo

**Estado: completada.** CAL-04 incorporó una envolvente cinemática
determinista para medir giro, liberación e inversión de los tres ejes. La
lectura inicial mostró que soltar un eje retenía su giro 0,900–1,175 s, pese a
que el cuarto de vuelta activo requería 0,417–0,542 s. Se ajustó únicamente la
amortiguación de liberación de pitch, yaw y roll.

**Resultado verificado:** los cuartos de giro se conservan en 0,483 s, 0,542 s
y 0,417 s; las liberaciones alcanzan neutro en 0,450 s, 0,442 s y 0,500 s.
La inversión conserva 0,300–0,308 s. Las pruebas y la maniobra de 120 Hz no
regresan. El informe reproducible está en
[archive/2026-10-12/cal-04-mobility-envelope.md](archive/2026-10-12/cal-04-mobility-envelope.md).

**Siguiente tarea:** comparar las trazas autoritativas de conducción con una
captura visual de Car Soccer después de reiniciar el servidor. Las curvas
públicas de dirección, par de motor y handbrake ya están integradas; queda
calibrar solo un grupo por iteración si la comparación revela un defecto.

### FIS-14G — Contrato autoritativo de doble salto y dodge con alabeo

**Estado: completada.** La comparación estática con Car Soccer mostró que el
cliente conserva pitch, yaw y roll como ejes separados y que el dodge se
construye en ese plano local. El segundo salto de nuestra simulación ahora usa
`dodgeSideInput = yaw + roll`; con free air roll la guiñada se suprime para no
contarla dos veces. La dirección sigue normalizada y queda comprometida al
pulsar.

El snapshot publica `dodgeDirection` como observación autoritativa para que las
trazas puedan demostrar qué dirección aceptó el servidor. `npm run
calibrate:network` añade dos maniobras: doble salto vertical sin dodge y dodge
diagonal con RT, stick derecho, A y B.

**Resultado verificado:** la traza WebSocket confirma el doble salto con
`doubleJumpSerial = 1`, sin `dodgeSerial`, y dirección `(forward=0,45,
side=0,89)` para el dodge con roll. La magnitud es 1,00 dentro de redondeo; las
8 maniobras de CAL-03 terminan con ACK y `passed = true`.

**Límite:** esta relación no revela ni copia las curvas internas del WebAssembly
de Car Soccer. Falta comparar el tacto visual del aterrizaje y el impulso
exacto con una sesión jugable.

### FIS-14H — Contacto de aterrizaje sin auto-enderezado

**Estado: implementada y aceptada el 11 de octubre de 2026.** La traza de
suspensión mostró que el contacto llegaba con pitch `-0,285` rad o roll
`-0,223` rad. La retención del 65%, la reducción del 50% de la velocidad
angular y la aproximación al plano a 4 rad/s eran una decisión provisional de
Arsenal, no un comportamiento de Rocket League. M4-03 conserva actitud y tasa
al primer apoyo y deja que el impulso de contacto y la suspensión produzcan la
respuesta.

La sonda publica el primer frame de apoyo, el ángulo que queda en ese instante
y la observación previa al contacto. Las cifras históricas de `-0,068` y
`-0,112` rad ya no son un criterio de fidelidad; se conservarán solo para
comparar la regresión antes y después de retirar el auto-enderezado.

### FIS-14I — Aterrizaje tras dodge diagonal

**Estado: aceptada con M4-03; la línea base anterior a M3 queda como historial.** La sonda ahora ejecuta un
dodge con throttle, yaw y alabeo direccional simultáneos y registra la dirección
comprometida, el primer apoyo de ruedas, la velocidad tangencial, el recorrido y
la actitud. La captura vigente conserva `(forward=0,447, side=0,894)`, obtiene
apoyo a `1,308 s` con roll `-0,424` rad, velocidad horizontal `11,661 u/s`,
recorrido `15,609 u` y dos ruedas cargadas. Termina con `grounded=true`,
`jumps=2`, pitch `0,011` y roll `-0,010`; la pose se estabiliza por suspensión,
no por una orden de ponerse recto.

La misma corrección separa contacto de carrocería y apoyo jugable: el chasis
puede resolver una penetración antes de que el muelle cargue, pero no recupera
controles, saltos ni `lastLanding` hasta que hay al menos dos ruedas de suelo.
Esto evita que un frame intermedio parezca aterrizado mientras el coche sigue
flotando.

**Puerta de salida:** repetir la traza con cámara visible y mando estándar,
comparar el rebote percibido y la conservación de velocidad, y solo entonces
decidir si se modifica la tasa de recuperación. No se tocarán impulso, tasas de
aire ni contactos en la misma iteración.

### FIS-14J — Perfil del segundo salto dirigido

**Estado: histórico, corregido por FIS-19.** El diagnóstico aisló una diferencia entre
las dos acciones: el doble salto sin dirección recibía elevación explícita,
pero un dodge nivelado solo recibía gravedad y su impulso horizontal. Esto
dejaba los flips laterales y diagonales demasiado planos y reducía el tiempo de
corrección aérea.

El dodge mantiene su dirección local normalizada, rotación comprometida,
ventana y follow-through, pero no recibe una elevación vertical adicional. La
componente vertical solo sigue la velocidad existente y la amortiguación breve
del contrato público. FIS-19 además garantiza el pulso mínimo del primer salto
(`0,025 s`) y abre la ventana de `1,25 s` después del tramo sostenido de `0,2 s`.

**Resultado verificado:** CAL-04 mide `+6,968 u/s` para doble salto vertical y
`−0,133 u/s` para dodge frontal y lateral en el primer subpaso; el valor
negativo es la gravedad, no una fuerza dirigida. El siguiente subpaso del dodge
solo conserva las fuerzas comprometidas.
Las regresiones conservan dirección, umbral, cancelación y cadencia. El detalle
de evidencia y la pauta visual están en
[archive/2026-10-12/second-jump-rebuild-plan.md](archive/2026-10-12/second-jump-rebuild-plan.md).

La misma traza diagonal con yaw y roll aterriza ahora a `1,258 s`, con cuatro
ruedas cargadas, roll `-0,010 rad`, velocidad horizontal `20,110 u/s` y
recorrido `25,470 u`. Es una fotografía de FIS-19, no una puerta de aceptación
actual: M4-01 volverá a medirla después de la calibración de torque M3.

**Puerta de salida:** tras reiniciar el servidor, observar salto + flip frontal,
lateral, diagonal, backflip y acción tardía en CALIBRACIÓN LIMPIA. Registrar
altura percibida, tiempo de control y primer apoyo; cambiar como máximo el
grupo de perfil de dodge si se repite un defecto.

### FIS-14K — captura del movimiento en el segundo salto

**Estado: implementada en simulación.** La pulsación del segundo salto captura
la pareja `delantero/lateral` formada por W/S, A/D y air roll direccional. La
pareja se normaliza, se transforma con la base local del chasis y queda
comprometida durante el follow-through. Una entrada opuesta puede frenar la
rotación del dodge; una entrada posterior perpendicular no cambia el vector de
velocidad ya aplicado.

La prueba `the second-jump edge captures W/S and air-roll direction in the
current chassis basis` cubre avance, reversa, guiñada, alabeo direccional,
diagonal normalizada y chasis inclinado. La referencia no aporta la curva
interna del impulso: esta historia implementa el contrato observable sin
inventar una segunda dirección ni copiar constantes externas.

### FIS-16A — Cámara estable en vuelo

**Estado: implementada, pendiente de verificación visual.** La cámara ya no
construye su posición y foco a partir del `up` completo del chasis. El vehículo
conserva pitch, yaw y roll completos, mientras la vista usa un rumbo horizontal
amortiguado, mantiene el horizonte con `up=(0,1,0)` y limita el sesgo vertical
del foco al pitch. Cuando el morro queda casi vertical se conserva el último
rumbo válido y el cambio posterior se limita a `7,5 rad/s`.

La política es numérica y está aislada en `src/camera-follow.js`; cuatro pruebas
comprueban que air roll no mueve el foco lateralmente, que un flip no produce
un giro de 180° en un frame y que el pitch no introduce roll visual. La malla
del coche sigue mostrando la actitud autoritativa completa.

**Puerta de salida:** reiniciar el cliente y observar air roll libre, roll
direccional, backflip y aterrizaje en CALIBRACIÓN LIMPIA. Si queda un defecto,
ajustar solo `headingRate`, `chasePositionSmoothing` o `focusSmoothing`; no
modificar física aérea ni contactos en la misma iteración.

### FIS-15A — Presentación por snapshots

**Estado: completada.** El cliente guarda un buffer de snapshots
autoritativos y presenta una actualización de red por detrás usando posición
lineal y slerp quaternion. La malla no recibe un segundo suavizado: sigue la
pose de presentación directamente. Ante respawn, teletransporte, reinicio,
cambio de arena, reloj no creciente o hueco temporal grande, se corta la
mezcla y se muestra la muestra nueva.

**Resultado verificado:** cuatro pruebas cubren continuidad, arco corto de
quaternion, discontinuidades, avance entre paquetes y detención sin
extrapolación. La simulación, sus 120 Hz y las trazas de movilidad permanecen
sin cambios.

**Límite:** falta sesión visual con teclado físico para valorar la cámara y
el tacto bajo movimiento real.

### FIS-15B — Eventos discretos

**Estado: completada.** El snapshot publica seriales monotónicos separados
para salto, doble salto, dodge y respawn. El cliente compara cada muestra con
la última consumida y lanza un pulso visual solo cuando aumenta un serial.
Las muestras repetidas no reproducen la acción.

**Resultado verificado:** las pruebas cubren primer salto, pulsación
mantenida, dodge, doble salto y respawn. El cambio no altera los impulsos,
ventanas, contactos ni la cadencia de la simulación.

### FIS-15C — Confirmación de entrada LAN

**Estado: instrumentación completada; conciliación diferida.** El cliente
etiqueta cada entrada enviada, el servidor confirma la última secuencia que
aplicó y CALIBRACIÓN LIMPIA muestra el tiempo hasta recibir ese snapshot.
La medida incluye red, cola y tick del servidor; no es una estimación de
ping puro.

La conciliación local limitada al coche propio se añadirá únicamente si una
prueba LAN muestra demora perceptible y si la traza confirma que puede
reproducirse sin ocultar un defecto de física.

**Comprobaciones siguientes:** vídeo de vuelo y aterrizaje, reconexión LAN y
comparación de ACK y respuesta en una y dos pestañas.

### FIS-16 — Reintegración gradual

**Orden:** rampas, coberturas, pads, choque entre coches, cohetes y bots.

Cada elemento se habilita tras pasar las trazas de CAL-02 y sus pruebas propias
de contacto. La arena de calibración continúa disponible como perfil de
regresión.

## Contrato de medición

`npm run probe` crecerá con estas secuencias, siempre con semilla y entrada
fijas:

1. Aceleración, frenado y reversa recta.
2. Radio de giro sin derrape a velocidad baja, media y alta.
3. Derrape y recuperación de tracción.
4. Salto corto, salto sostenido y aterrizaje.
5. Doble salto, ocho dodges y cancelación frontal.
6. Pitch, yaw, roll y combinación de tres ejes en aire.
7. Nitro horizontal y ascenso con morro inclinado.
8. Reposo, pared, techo, esquina y transición suelo-pared.
9. Cámara durante vuelo, giro y aterrizaje.

Las primeras ejecuciones de cada fase establecen una línea base. Los objetivos
numéricos se fijarán después de contrastar sesiones controladas de referencia
con el mismo guion de entrada; hasta entonces, una prueba registra trayectoria
sin convertir un valor provisional en una promesa de diseño.

## Riesgos y medidas preventivas

| Riesgo | Prevención |
| --- | --- |
| Ajustar una constante oculta un fallo de contacto | Cada entrega añade una traza y un criterio observable antes de modificar valores. |
| Cambiar física y cámara a la vez confunde el diagnóstico | FIS-15 queda después de las fases de chasis y control. |
| Una transición de pulsación se interpreta como control mantenido | Las entradas guardarán bordes de pulsación y la máquina de estados poseerá cada ventana temporal. |
| Un dodge inclinado aterriza con el chasis antes que con los neumáticos | M4-03 transmite el impulso normal por el brazo del contacto, conserva la actitud y deriva `grounded` solo con dos ruedas cargadas (`0,01` de compresión). La prueba de dodge diagonal llega a `grounded` con dos saltos. |
| Una solución de pared rompe el suelo | El colector de contactos y las pruebas de los seis planos comparten datos y resolución normal/tangente. |
| Las pruebas de legado bloquean la mejora | Se mantienen como regresión de desguace y se añaden pruebas equivalentes de CAL-01 antes de migrar cada subsistema. |
| Una sensación subjetiva no deja evidencia | Cada sesión de prueba se acompaña de la traza, versión y lista de maniobras ejecutadas. |

## Siguiente acción desbloqueada

**M4-04 — contactos de pared, esquina y techo.**

M4-03 ya está cerrada: `npm test` pasa 95/95 y las capturas M4-01 terminan las
seis maniobras con apoyo y sin penetración. La siguiente implementación debe
medir las superficies restantes, conservar velocidad tangencial y no introducir
auto-enderezado. El plan y sus criterios están en
[archive/2026-10-12/m4-contact-landing-plan.md](archive/2026-10-12/m4-contact-landing-plan.md).
La validación visual de doble salto vertical, flip frontal, lateral,
diagonal, backflip y acción tardía. Registrar altura y velocidad vertical al
activar, tiempo de control, ángulo al primer apoyo, velocidad tangencial y
tiempo hasta actitud estable. No modificar impulso, tasas aéreas, cámara y
suspensión a la vez; la primera corrección debe elegir solamente el perfil del
segundo salto o una transición de aterrizaje ya medida.

### Actualización CAL-03 automatizada

`npm run calibrate:network` ejecuta ahora ocho fases con el contrato de mando
estándar y duraciones exactas, a través del mismo WebSocket y servidor
autoritativo que usa el cliente. La ejecución del 10 de octubre pasó todas las
aserciones y guardó `docs/automated-cal-03-last-run.json`. Incluye doble salto
vertical y dodge diagonal con roll, y elimina la necesidad de que el piloto
mantenga pulsaciones de 0,3–0,5 s para validar ese contrato. No sustituye la
observación visual de cámara o respuesta subjetiva.



