# R1/R2 — Oráculo aislado de RocketSim

Estado: **completado el 11 de octubre de 2026**.

## Propósito

Generar estados de referencia reproducibles para calibrar la simulación propia.
La herramienta vive en tools/rocketsim-oracle; RocketSim no se incorpora al
bundle del navegador ni al servidor de producción.

## Límites de la prueba

- Usa GameMode::THE_VOID e InitFromMem({}, true).
- Crea un plano Bullet sintético solo para validar las ruedas en suelo.
- Aparta la pelota de la prueba.
- No ejecuta Rocket League, no carga sus binarios y no usa sus mallas de
  colisión ni el dumper de arenas.

El JSON conserva el esquema de muestras de Arsenal donde es posible y mapea el
eje vertical z de RocketSim a y. Las unidades se mantienen originales; el
comparador normaliza las formas antes de atribuir una diferencia.

## Compilación reproducible en Windows

Se necesita un clon oficial de RocketSim fuera de este proyecto, CMake, Ninja
y MSVC. El comando usa el entorno de desarrollador de Visual Studio:

cmd /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 && cmake -S tools\rocketsim-oracle -B .oracle-build -G Ninja -DROCKETSIM_SOURCE="C:\ruta\a\RocketSim" && cmake --build .oracle-build --target rocketsim_trace'

Después se ejecuta .oracle-build\rocketsim_trace.exe y se redirige la salida a
docs/reference-captures/rocketsim-r1.json.

La fuente de referencia se fija por commit y licencia antes de tratar la salida
como evidencia. RocketSim está bajo MIT; si se distribuyera una copia de sus
fuentes o binarios habría que conservar además sus avisos y los de Bullet.

En este equipo, la carpeta de trabajo aislada usa el commit
`c2baacb8f4b441dd8505e63c2aeb5a1679b60b02` del repositorio oficial. Los datos
de procedencia están en
`docs/reference-captures/rocketsim-r1-c2baacb8.metadata.json`; el clon y su
build permanecen fuera del proyecto de juego.

Cuando `cmd.exe` reciba una ruta con `José`, puede interpretar incorrectamente
la codificación de la ruta. Para esta compilación se usaron unidades temporales
`subst` con rutas ASCII, que se eliminan al terminar. Es una solución del
entorno de compilación, no una dependencia del juego ni un requisito para la
traza ya guardada.

## Criterio R1

La puerta se abre cuando el ejecutable emite 144 muestras a 120 Hz para
groundControl, firstJump y dodgeDiagonalRoll, y la muestra de suelo confirma
contacto estable de ruedas. Hasta entonces la salida es una prueba de
viabilidad, no una equivalencia de movimiento.

## Resultado R1

La ejecución produjo 144 muestras a 120 Hz para las tres maniobras. En la
captura `firstJump` el flanco de salto aparece en el primer tick; en
`dodgeDiagonalRoll`, el de dodge aparece en el tick 12 y la dirección
comprometida es `(0,447214, 0,894427)`. El suelo mantuvo contacto de ruedas
durante `groundControl`.

Una segunda ejecución produjo el mismo SHA-256 que la primera:
`8D9CCD7908351578EB77A534E1CF622902351D1EDC0DB61B0854281CE327A9C9`.
La R1 queda aprobada como oráculo numérico de desarrollo para arena limpia.
R2 amplió el mismo ejecutable a `airAxes`, `airPitch`, `airYaw` y `airRoll`,
publicó velocidad angular en ejes locales y orientación ya convertida a los
ejes y-up de Arsenal. La captura está en
`docs/reference-captures/rocketsim-r2-air-controls-c2baacb8.json`; el signo de
pitch se corrigió antes de comparar porque Bullet y el controlador de Arsenal
usan convenciones opuestas para morro abajo. La herramienta no se considera
código de producción ni demuestra identidad con Rocket League: sirve para
calibrar comportamiento observable en una arena limpia.

## R3 — segundo salto y dodge aéreo

R3 añadió cuatro escenarios a altura segura para evitar que el suelo sintético
contaminara el flip: `airDoubleJump`, `airDodgeForward`, `airDodgeSide` y
`airDodgeDiagonalRoll`. La captura está en
`docs/reference-captures/rocketsim-r3-jumps-dodges-c2baacb8.json` y conserva
144 muestras por escenario a 120 Hz.

La lectura del código público de RocketSim confirmó el orden relevante: el
flip aplica `FLIP_TORQUE_Y = 224` en pitch o `FLIP_TORQUE_X = 260` en roll,
integra la actitud y limita después el vector angular a `5,5 rad/s`. Arsenal
reproduce ese orden con un integrador de torque propio; no enlaza el código de
RocketSim ni lo incluye en el bundle. Esto conserva el pequeño sobreimpulso de
orientación que se pierde si se fija directamente una tasa de `5,5`.

## R4 — contactos y aterrizajes

R4 añade un plano Bullet sintético y seis trazas de 300 frames que replican
M4-01: caída plana, caída con pitch, caída con roll, dodge frontal, lateral y
diagonal con roll. Los campos nuevos son `bodyContact`, `wheelSupport`,
`loadedWheelCount`, `normalSpeed`, `tangentSpeed`, orientación por vectores,
las cuatro ruedas y, solo en el oráculo de desarrollo, longitud, compresión
normalizada y fuerza de suspensión leídas de `btVehicleRL`. La captura está en
`docs/reference-captures/rocketsim-r4-contact-transitions-c2baacb8.json` y su
procedencia en el archivo `.metadata.json` homónimo.

El comparador `npm run compare:contacts` alinea los frames de apoyo,
asentamiento, ángulos y tendencia tangencial con la captura de Arsenal. R4 no
expone compresión de suspensión en `CarState`; el harness conserva esos campos
internos solo para una métrica relativa de transición. `worldContact` solo aparece
cuando Bullet registra una colisión del chasis; por eso el contacto de ruedas
es la señal común principal. Las alturas iniciales se expresan en unidades
internas de RocketSim y no se convierten en constantes de producción.

`npm run normalize:contacts` calcula además el tiempo de caída adimensional y
la carga media de rueda relativa a su apoyo asentado. El informe se guarda en
`docs/reference-captures/arsenal-r4-contact-normalized.json`; sus picos R4 son
mayores que los de Arsenal en las tres caídas puras, pero esa señal solo abre
una hipótesis M4-03, no una equivalencia ni una constante copiable.

La primera compilación reutilizó una build antigua y falló con `C1902` por un
PDB de otra versión de MSVC. Se aisló `rocketsim-r4-z7-2` y se configuró `/Z7`
para incrustar la información de depuración; la captura final se generó sin
ejecutar Rocket League ni leer sus assets. Las diferencias de escala quedan
registradas en `docs/reference-captures/arsenal-r4-contact-comparison.json` y
no abren todavía una corrección M4-03.

