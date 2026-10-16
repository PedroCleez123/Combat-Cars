# Hoja de ruta de fidelidad de movilidad

Actualizado: 11 de octubre de 2026  
Estado: **referencia histórica de criterios de fidelidad**. La hoja que ordena
la ejecución futura es [current-development-roadmap.md](current-development-roadmap.md).
Este documento conserva las decisiones e histórico de `mobility-rebuild-plan.md`,
FIS-18 y FIS-19.

## Objetivo verificable

Conseguir que conducir, derrapar, saltar, hacer dodge, volar, aterrizar y usar
nitro respondan como el coche de Rocket League y la referencia jugable Car
Soccer, manteniendo un juego propio de combate de coches.

Parecido se evaluará en dos niveles:

1. **Comportamiento medible:** mismas transiciones de acción, curvas y
   trayectorias cercanas bajo una entrada idéntica a 120 Hz.
2. **Tacto jugable:** la cámara, la respuesta visual y la latencia percibida no
   contradicen el estado físico que ya superó la comparación determinista.

No se declarará equivalencia exacta sin una traza de referencia reproducible.
La meta inmediata es minimizar una diferencia cuantificada, escenario por
escenario, en vez de retocar constantes por sensación aislada.

## Hechos y decisiones que delimitan el trabajo

| Hecho | Decisión |
| --- | --- |
| Three.js presenta el juego y Node mantiene la simulación autoritativa a 120 Hz. | Se mantienen ambos. Cambiar de motor no resuelve por sí mismo las curvas de vehículo ni los contactos. |
| La implementación ya tiene chasis quaternion, suspensión, arena limpia, inputs de mando y teclado, trazas, cámara estabilizada, FIS-18 y FIS-19. | Consolidar estas piezas con pruebas de referencia antes de ampliar combate, bots, rampas u obstáculos. |
| RocketSim publica constantes, vehículo, suspensión, saltos, dodge y control aéreo bajo licencia MIT. Su propio proyecto indica que es cercano, no una réplica perfecta. | Usarlo primero como **oráculo externo de trazas**, con versión fijada y atribución. No se copian sus fuentes ni sus assets a la simulación JavaScript. |
| Car Soccer declara adaptar su física de RocketSim. La observación web muestra controles y resultado perceptible, pero no expone una traza física estable. | Usarlo como referencia de controles, cámara y observación visual. Las tolerancias numéricas saldrán de RocketSim o de contratos públicos. |
| El binario de Rocket League se analiza estáticamente con REA. | No se ejecuta, no se extraen recursos del juego y no se bloquea el trabajo esperando un inventario global de Ghidra. |

Fuentes de comportamiento: [RocketSim](https://github.com/ZealanL/RocketSim),
[constantes públicas](https://raw.githubusercontent.com/ZealanL/RocketSim/main/src/RLConst.h)
y [licencia MIT](https://github.com/ZealanL/RocketSim/blob/main/LICENSE).
El README de RocketSim especifica que la biblioteca se construye por separado y
que una arena completa necesita assets de colisión externos. Por ello la primera
evaluación se limita a un entorno limpio y no usa assets de Rocket League.

## Arquitectura objetivo

La misma entrada de prueba alimenta dos destinos aislados:

1. Simulación JavaScript autoritativa de Arsenal a 120 Hz.
2. RocketSim usado solo en desarrollo para emitir una traza de referencia.

Ambas producen JSON normalizado. El comparador de curvas detecta una diferencia,
la atribuye a una hipótesis única y abre la siguiente modificación. La
simulación de producción permanece en JavaScript mientras el oráculo responde a
las preguntas de calibración.

Una integración nativa de RocketSim en el servidor será una decisión posterior,
reversible y basada en evidencia. No es el siguiente cambio.

## Medida común y contrato de trazas

Cada referencia y cada candidato usarán:

- Arena limpia: suelo, cuatro paredes y techo; sin bots, armas, rampas ni
  pads.
- Coche de configuración fija y posición inicial publicada.
- Paso fijo de 1/120 s con semántica de input por flanco y valor retenido.
- Unidades normalizadas: posición y velocidad divididas por la velocidad máxima
  de cada referencia; orientación como quaternion y error angular en grados;
  tiempo en segundos.
- JSON versionado con escenario, semilla, coche, muestras de estado, eventos de
  acción y resumen de picos.

La comparación debe publicar, por escenario:

| Magnitud | Criterio inicial de salida |
| --- | --- |
| Eventos de salto, ventana de segundo salto, dodge, nitro y aterrizaje | Igual semántica y momento dentro de un tick de 120 Hz. |
| Velocidad, recorrido y radio en intervalos cortos | Error relativo de hasta 5 % en la ventana de comparación. |
| Actitud durante control aéreo y dodge | Error angular de hasta 5° durante la ventana corta. |
| Conservación de velocidad, deriva y recuperación | Misma tendencia y error relativo de hasta 10 %; reducir el margen después de fijar el oráculo. |
| Repetibilidad | Misma entrada, misma traza; sin depender del tamaño de paquetes de red. |

Estos umbrales son una puerta inicial de ingeniería. Se estrecharán cuando
exista una traza de RocketSim generada con una configuración verificable.

## Secuencia de trabajo

### R0 — Congelar la línea base y el contrato de medición

**Estado:** completado el 11 de octubre de 2026. Existen `probe:curves`,
`probe:envelope`, `capture:curves` y `compare:curves`; el manifiesto v1 fija
ocho maniobras iniciales de 144 ticks; M2 añadió tres trazas aisladas de pitch,
yaw y roll. La captura `arsenal-r0-2026-10-11.json` se
compara consigo misma sin diferencia.

**Trabajo**

1. Crear un manifiesto de ocho maniobras canónicas y fijar posición, orientación
   e inputs.
2. Registrar la línea base actual sin cambiar TUNING.
3. Añadir a cada captura versión de simulación, fecha, semilla y configuración
   de mando o teclado.
4. Mantener una prueba de flancos de botón y otra de paquetes WebSocket para
   sustituir pulsaciones humanas temporizadas.

**Salida:** una captura de Arsenal que se compara consigo misma con diferencia
cero y un informe que identifica el campo de cada métrica.

### R1 — Viabilidad de RocketSim como oráculo

**Estado:** completado el 11 de octubre de 2026.

**Trabajo**

1. Fijar un commit de RocketSim y guardar URL, licencia y hash en un manifiesto
   externo.
2. Construir en una carpeta de herramientas aislada, nunca dentro del bundle
   del navegador.
3. Hacer un ejecutable mínimo que reciba el guion de R0 y emita JSON de estado.
   El alcance es coche, entradas y entorno limpio.
4. Verificar que el experimento no requiere ejecutar Rocket League, extraer
   archivos ni incluir una malla de arena del juego.
5. Conectar solo los JSON al comparador existente.

**Salida:** una traza de un segundo de conducción, un salto sostenido y un
dodge diagonal repetible; o un informe técnico que pruebe que la biblioteca
necesita assets no aptos para este proyecto.

**Puerta R1**

- Si la traza se obtiene sin assets externos, RocketSim se convierte en el
  oráculo numérico de los siguientes hitos.
- Si no se obtiene bajo estas condiciones, se conserva la traducción original
  de contratos públicos, se versionan sus constantes y se usan las trazas
  internas. No se emplearán dumpers ni assets de Rocket League.

### M1 — Conducción, freno y powerslide

**Dependencia:** R0; R1 si el oráculo está disponible.

Preguntas de la historia:

- ¿La aceleración, frenada y reversa siguen la curva de referencia?
- ¿El radio de giro cambia correctamente con la velocidad?
- ¿El powerslide aumenta el giro y el deslizamiento sin teletransportar la
  orientación?
- ¿Al soltar Shift se conserva impulso y se recupera agarre de forma
  progresiva?

**Escenarios:** acelerar hasta tres bandas de velocidad, frenar, reversa,
cuartos de giro con y sin powerslide, e inversión rápida.

**Salida:** cada escenario cumple la tabla de tolerancias. Cada iteración cambia
un único grupo: motor y freno, ángulo de dirección, agarre o rampa de
handbrake.

### M2 — Aire, nitro y control de actitud

**Dependencia:** M1 estable.

**Estado:** completado el 11 de octubre de 2026. Las trazas aisladas de pitch,
yaw y roll, junto con `air-axes`, cumplen la puerta de orientación y la
regresión de 94 pruebas. Nitro se conserva como contrato separado para M3.

- Comparar pitch, yaw, roll, free air roll, inversión y liberación por ejes
  locales.
- Comparar fuerza de nitro en suelo y aire, consumo, pulso mínimo, velocidad
  máxima y trayectoria al orientar el morro.
- Mantener el límite angular y la amortiguación como propiedades medibles.

**Salida:** las maniobras de cuarto de vuelta, liberación, boost recto y boost
con nariz inclinada cumplen las tolerancias; cámara y orientación renderizada
siguen el mismo quaternion sin saltos.

### M3 — Salto, segundo salto, dodge y cancelación

**Dependencia:** M2 estable. FIS-19 es la línea inicial de este bloque.

**Estado:** completado el 11 de octubre de 2026. La captura R3 limpia y la
simulación propia coinciden en los flancos de acción, el segundo salto, la
dirección comprometida y la orientación de los tres dodges medidos. El detalle
numérico y las limitaciones están en
[`archive/2026-10-12/m3-air-actions-calibration.md`](archive/2026-10-12/m3-air-actions-calibration.md).

- Verificar impulso inicial, tramo sostenido, pulso mínimo de 25 ms, máximo de
  200 ms y apertura de ventana de 1,25 s.
- Comparar segundo salto vertical frente a dodge frontal, lateral y diagonal.
- Medir dirección comprometida, impulso horizontal, torque temporal,
  amortiguación vertical, cancelación y bloqueo posterior.
- Probar el dodge con WASD, free air roll y mando mediante el adaptador de
  entradas autoritativas.

**Salida:** eventos y dirección comprometida coinciden en el tick previsto; la
trayectoria del dodge no recibe una elevación inventada y el coche sigue siendo
corregible como en la referencia.

### M4 — Contactos, colisiones y aterrizajes

**Dependencia:** M3 estable.

**Estado:** M4-01, M4-02, M4-02b y M4-03 completadas el 11 de octubre de 2026.
El alcance, la secuencia de medición, las puertas y los límites de la
referencia externa están en [`archive/2026-10-12/m4-contact-landing-plan.md`](archive/2026-10-12/m4-contact-landing-plan.md).
Las capturas propias y R4 fijan seis transiciones a 120 Hz. M4-03 retiró el
auto-enderezado de aterrizaje y aplica el momento normal en el brazo de
contacto; el umbral jugable exige dos ruedas con `0,01` de compresión.

- Medir caída plana, aterrizaje inclinado, aterrizaje tras dodge, pared,
  esquina y techo.
- Separar contacto de carrocería de apoyo de rueda jugable.
- Ajustar suspensión, fricción y restitución sin cambiar acciones aéreas,
  únicamente si una traza abre una brecha atribuible al contacto.

**Decisión al cerrar M4:** evaluar si el modelo JavaScript alcanza las
tolerancias. Solo si el oráculo muestra una divergencia persistente causada por
el solver de colisiones se abrirá una historia para usar RocketSim como backend
nativo autoritativo. Esa historia incluirá build para Windows, comunicación
local, coste de despliegue, sincronización de snapshots, atribución MIT y una
reversión segura a la simulación actual.

### M5 — Presentación, cámara y red

**Dependencia:** M4 estable.

- Validar que la cámara amortigua presentación sin modificar estado físico.
- Medir interpolación, ACK de inputs y comportamiento con agrupación de
  paquetes.
- Implementar predicción o conciliación solo si una medición revela que la red
  altera el tacto de controles ya validados.

**Salida:** una maniobra física equivalente produce la misma lectura de HUD y
una cámara legible en local y LAN.

### M6 — Prueba de experiencia y retorno a juego completo

**Dependencia:** M5 estable.

1. Ejecutar las maniobras automatizadas de R0 por teclado y por mando lógico.
2. Grabar capturas de la arena limpia con la cámara de juego.
3. Hacer tres sesiones humanas cortas con el mismo guion y registrar respuesta,
   legibilidad de cámara, dirección del dodge y recuperación de aterrizaje.
4. Corregir una hipótesis por iteración, con traza antes y después.

Tras aprobar este bloque, el siguiente hito recupera 3v3, bots, cohetes, daño,
respawns, pads y después la geometría de desguace. Esos sistemas no participarán
en las pruebas base de movilidad.

## Registro por historia

Cada historia debe anotar en docs/physics-mobility-tracker.md:

1. Hipótesis concreta y grupo de constantes o solver afectado.
2. Escenario de referencia y captura base.
3. Código y archivos modificados.
4. Resultado de pruebas deterministas y comparación de trazas.
5. Resultado visual, si aplica.
6. Decisión siguiente: aceptar, revertir o abrir otra hipótesis.

Una historia no mezcla motor, aire, salto y cámara. Un fallo de infraestructura
se documenta como incidente y no se usa como evidencia física.

## Orden inmediato

1. Ejecutar M4-04: medir pared oblicua, esquina suelo-pared y techo con la
   misma separación de contacto, velocidad normal y apoyo de ruedas.
2. Mantener M3, M4-01 y el aterrizaje M4-03 congelados; no reabrir las
   constantes de aire, salto o cámara por una diferencia de pared.
3. Continuar por M5 después de cerrar M4-04; ahí se validarán cámara,
   interpolación y tacto visual con el servidor disponible.

Este orden ataca la causa actual: la simulación tiene piezas funcionales, pero
todavía no una referencia numérica completa que convierta la sensación buscada
en decisiones de calibración demostrables.

