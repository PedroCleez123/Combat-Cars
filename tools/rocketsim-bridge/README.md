# Bridge nativo RocketSim — R19 activa

Este ejecutable es un sidecar nativo de desarrollo. No forma parte del bundle
web. El servidor solo lo inicia cuando se selecciona explícitamente
`MOVEMENT_BACKEND=rocketsim`; el modo JavaScript no lo necesita.

## Compilación en Windows

Desde un entorno de desarrollador de Visual Studio:

```powershell
cmake -S tools/rocketsim-bridge -B .rocketsim-bridge-build -G Ninja `
  -DROCKETSIM_SOURCE="C:/ruta/a/rocketsim-r1"
cmake --build .rocketsim-bridge-build --target rocketsim_bridge
```

En esta instalación de Windows, ejecuta ambos comandos desde `x64 Native Tools
Command Prompt for VS`. Si MSVC devuelve `C1902` sobre el administrador PDB,
vuelve a configurar CMake y compila desde ese entorno: el bridge fuerza `/Z7`
para no depender del servidor PDB compartido.

El clon debe ser el commit registrado en
`docs/reference-captures/rocketsim-r1-c2baacb8.metadata.json`. Si el entorno no
tiene CMake/MSVC/Ninja, la prueba de protocolo JavaScript sigue siendo válida,
pero la compilación nativa queda **No verificada**.

Tras compilar, el smoke test reproducible se ejecuta así:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run probe:rocketsim-bridge
```

El resultado incluye cinco muestras del salto y un SHA-256 del resumen. Dos
ejecuciones con la misma build deben producir el mismo hash.

Para generar las trazas completas de los perfiles de suelo y aire:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run capture:rocketsim-curves
```

El capturador usa `clean-six-planes` para escenarios desde suelo, `air-void`
para controles aéreos aislados y `second-action-airborne` cuando el primer
salto ya terminó. Los dos últimos son entornos de medición sin colisión; no se
usan para la partida ni sustituyen las pruebas de paredes y aterrizaje.

Para comprobar el contacto nativo contra las paredes del perfil de práctica y
guardar la evidencia acotada de R7-03:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run probe:rocketsim-contacts
```

La captura registra el primer contacto de carrocería, el tick posterior y seis
checkpoints en
`docs/reference-captures/rocketsim-practice-contacts-r7-03.json`. Es una
prueba de Bullet/RocketSim contra los seis planos sintéticos; no contiene las
mallas de la arena Soccar.

Para validar la transición curva propia de R7-04:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run probe:rocketsim-curved-arena
```

La sonda usa el perfil `arsenal-curved-practice`, con un cuarto de cilindro
original de radio 256 UU, pared, techo y límites limpios. Guarda ocho
checkpoints, 68 muestras de transición y el SHA en
`docs/reference-captures/rocketsim-curved-practice-r7-04.json`. No utiliza ni
descarga la malla de Soccar y no es una afirmación de equivalencia geométrica.

Para validar la arena ampliada limpia de ARENA-01:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run probe:rocketsim-expanded-arena
```

La sonda usa `arsenal-expanded-curved-practice`: 144 × 108 × 30 unidades
Arsenal, cuatro transiciones propias de radio 8, 32 segmentos y cuatro coches
que recorren cada pared. Exige contacto continuo, una variación máxima de
normal de 8 grados y un SHA estable. No reutiliza mallas ni código propietario
de Rocket League o Soccar.

Para validar la arena ampliada con curvas en ambos extremos y esquinas completas
de ARENA-CEILING-01:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run probe:rocketsim-cornered-arena
```

R19 añade el cuarto de cilindro pared→techo, techo central visible y tres
familias de parches de esquina: inferior, vertical y superior. La sonda recorre
720 ticks a 120 Hz con cuatro coches, exige apoyo continuo desde el suelo hasta
la pared, observa la normal descendente en el techo y limita el salto entre
normales a 8 grados. La ejecución registrada produjo 3,124 grados como máximo y
el SHA `cee24afabe3640dcc2eaaaffe312a010d8568d244fe36980ae29c6549667e5f2`.
La build R19 es la ruta activa del host persistente del proyecto.

## Protocolo

El proceso lee y escribe JSON delimitado por líneas en stdin/stdout:

```json
{"type":"init","schemaVersion":1,"fixedStepHz":120,"arena":"clean-six-planes","cars":[{"id":1,"team":"blue"}]}
{"type":"tick","tick":1,"cars":[{"id":1,"input":{"throttle":0,"steer":0,"jump":false,"boost":false,"drift":false,"roll":0}}]}
{"type":"shutdown"}
```

La frontera publica coordenadas y-up. RocketSim conserva z-up internamente y
el puente realiza la conversión antes de emitir el estado. R8-01a acepta de uno
a seis coches con IDs enteros únicos `1…6`; cada coche de `tick` debe
corresponder exactamente a los IDs declarados en `init`. `team` es `blue` o
`red` al inicializar. Los estados se publican en el orden de configuración y
cada entrada se aplica únicamente al coche con su ID. Listas vacías, IDs
duplicados, fuera de rango o cambiantes se rechazan. La práctica web todavía
usa un solo piloto: la asignación dinámica de plazas nativas se realizará en
R8-01b.

Cada estado incluye `worldContact.hasContact` y su normal convertida a y-up
cuando existe un contacto de carrocería. El apoyo de ruedas se resume en
`wheelCount` y `wheelContact.normal` publica la normal agregada del apoyo de
ruedas cuando hay al menos una rueda cargada.

Los valores admitidos de `arena` para desarrollo son `clean-six-planes`,
`arsenal-practice`, `arsenal-curved-practice`,
`arsenal-expanded-curved-practice`, `arsenal-expanded-cornered-practice`,
`arsenal-expanded-block-practice`, `arsenal-expanded-ramp-practice`, `combat-alpha`, `air-void` y
`second-action-airborne`; el esquema, 120 Hz
y el coche id 1 son obligatorios. `arsenal-practice` usa los seis planos de la
arena limpia de Arsenal: x ±62, z ±46 y techo y = 24 después de aplicar la
escala `56/2300` y restar la altura nativa de reposo (17 UU). Los ticks deben
ser consecutivos. El perfil cornered añade parches esféricos en el suelo y
cuartos de cilindro verticales del mismo radio hasta el techo; los paneles de
pared son finitos para no solaparse con las esquinas.

`arsenal-expanded-block-practice` conserva la arena cornered y añade un único
bloque estático de 14 × 4 × 18 unidades en el centro. Es un perfil opt-in para
probar colisión nativa y representación visual compartida; no cambia el perfil
cornered predeterminado.

`arsenal-expanded-ramp-practice` conserva la arena cornered y añade una rampa
triangular estática de 20 × 18 × 4,5 unidades Arsenal, centrada en el mapa. La
misma geometría se dibuja en Three.js y su prueba de recorrido y oclusión está
en `npm run probe:rocketsim-ramp-arena` y `npm run probe:rocketsim-ramp-combat`.

`combat-alpha` compone la arena cornered con el bloque en `(0, -20)` y la
rampa en `(0, +20)` Arsenal, dejando libre el corredor central y seis spawns
alternos. La geometría y la campaña LAN se validan con
`npm run probe:rocketsim-combat-alpha-geometry` y
`npm run probe:rocketsim-combat-alpha-lan`.

Para arrancar la práctica navegable, tras compilar el bridge:

```powershell
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm start
```

La práctica admite un solo piloto y conserva el solver JavaScript como modo
predeterminado cuando `MOVEMENT_BACKEND` no está definido.

Para validar el contrato nativo multivehículo sin iniciar combate ni bots:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run probe:rocketsim-multicar
```

La sonda recorre 180 ticks con dos coches y verifica que el ejecutable rechaza
IDs duplicados antes y después de un init válido. Su captura queda en
`docs/reference-captures/rocketsim-multicar-r8-01.json`.

Para validar consultas de geometría estática del proyectil:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe)
npm run probe:rocketsim-static-raycast
```

El mensaje `raycast` usa coordenadas públicas RocketSim con y-up (las mismas
unidades que los estados del bridge). La sonda cruza el bloque de ARENA-05 y
repite un segmento lateral que debe quedar libre; el bridge convierte a Bullet,
filtra cuerpos dinámicos y divide internamente los segmentos largos para no
contaminar JSONL con el aviso del broadphase. La captura queda en
`docs/reference-captures/rocketsim-static-raycast-combat-geo-01.json`.
