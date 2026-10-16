# Servidor local y navegador integrado

## Causa del `ERR_CONNECTION_TIMED_OUT`

El servidor iniciado mediante `functions.exec` puede ejecutarse dentro de un
sandbox de Codex. Ese sandbox tiene su propia red y su propio espacio de
procesos. El navegador integrado de Codex pertenece al escritorio del usuario
y no puede resolver el `localhost` del sandbox. Por eso pueden ocurrir estas
dos cosas a la vez: la terminal anuncia el servidor y el navegador devuelve
`ERR_CONNECTION_TIMED_OUT`.

No es un fallo de Three.js, RocketSim ni del WebSocket. Es una frontera de red
entre dos entornos. Un puerto también puede aparecer ocupado en un entorno y
libre en el otro, así que no hay que matar procesos a ciegas.

## Solución operativa

Para una comprobación web real, iniciar el servidor desde el PowerShell del
ordenador del usuario, no desde un comando sandbox de Codex. Ejecutar en la
raíz del proyecto:

```powershell
cd "C:\Users\Pedro José\Documents\Codex\2026-10-09\files-pasted-by-the-user-help\outputs\CarSoccerArsenal"
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe)
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "combat"
$env:ROCKETSIM_ARENA = "combat-alpha"
$env:PORT = "5298"
npm start
```

Para no reiniciar manualmente en cada cambio de servidor, sustituir el último
comando por `npm run start:watch`. `node --watch` reinicia el proceso cuando
cambia `server.mjs` o un módulo importado. Los cambios de `src/client.js` son
estáticos: basta Ctrl+F5; no hay que cerrar el servidor.

Mantener esa ventana abierta. En otra ventana del mismo equipo comprobar:

```powershell
Invoke-WebRequest http://127.0.0.1:5298/ -UseBasicParsing | Select-Object StatusCode
Get-NetTCPConnection -LocalPort 5298 -State Listen
```

El primer comando debe devolver `200`; el segundo debe mostrar `node.exe`.
Después abrir `http://127.0.0.1:5298/?arena=combat-alpha` en el navegador
integrado y usar Ctrl+F5 para descargar el cliente actualizado.

## Comprobación de WebSocket

Una página HTML puede cargar aunque el WebSocket no esté operativo. La señal
correcta es que el HUD cambie a `COMBATE ROCKETSIM · COMBAT-ALPHA`, aparezca
`TÚ · EQUIPO AZUL/ROJO`, aumente `RED ACK` y cambie `VELOCIDAD` al mantener W.
El encabezado también muestra la etiqueta del ejecutable, por ejemplo `R19`.
Si se ve `R13`, la página está conectada a la física antigua aunque el techo
translúcido se vea actualizado.

En `combat-alpha`, el cliente muestra además `R19 NECESARIO PARA TECHO` cuando
recibe una revisión conocida inferior. Es una advertencia de diagnóstico: no
altera el coche ni intenta inventar una colisión en Three.js.

El propietario es el primer navegador que completa `hello`. Solo ese peer puede
reiniciar o configurar la ronda; los demás pueden conducir y disparar. Si el
propietario se reconecta dentro de cuatro segundos conserva la plaza y el
control. El origen del mismo `Host` HTTP se acepta por defecto para permitir
abrir la URL mediante una IP LAN; `LAN_ALLOWED_ORIGINS` sigue disponible como
allowlist explícita cuando se necesite restringirla.
Si se ve la página por defecto sin HUD autoritativo, hay que revisar el
proceso del servidor y no la física.

## Límites y prevención

- Codex puede editar archivos, ejecutar pruebas y compilar el bridge cuando el
  permiso está disponible.
- Computer Use puede observar el navegador, pero no debe automatizar
  PowerShell o Command Prompt mediante la interfaz gráfica.
- La instancia sandbox no se convierte en el proceso del host mediante una
  variable de entorno ni mediante otra URL.
- Usar un puerto nuevo si el anterior está ocupado y no iniciar dos `npm start`
  sobre el mismo puerto.
- La comprobación fiable del proceso se hace en el PowerShell principal del
  usuario; el sandbox puede no ver sus listeners.
- No marcar una prueba visual como pasada si el HUD no refleja el snapshot
  autoritativo.

## Qué requiere reinicio

| Cambio | Acción en la instancia del usuario |
| --- | --- |
| `src/client.js`, CSS o HTML | Ctrl+F5 |
| `server.mjs` o módulos Node | `npm run start:watch` lo reinicia |
| bridge C++ o `ROCKETSIM_BRIDGE_EXE` | detener y volver a iniciar el proceso |
| `ROCKETSIM_MODE`, `ROCKETSIM_ARENA`, `PORT` | detener y volver a iniciar el proceso |

## Timeout del bridge durante un reinicio

El bridge nativo responde por JSONL. En Windows, el primer tick después de un
reinicio de `node --watch` puede superar 100 ms aunque el proceso siga sano.
El valor de desarrollo es ahora 250 ms y se puede ajustar sin editar código:

```powershell
$env:ROCKETSIM_REQUEST_TIMEOUT_MS = "500"
npm run start:watch
```

El timeout no convierte un bridge bloqueado en válido: al agotarse, el servidor
detiene la simulación y muestra el error. Si aparece de forma repetida incluso
con 500 ms, detener la instancia anterior, comprobar que el ejecutable existe
y arrancar una sola instancia; no se deben matar procesos a ciegas mientras el
watcher aún está cerrando el sidecar.

Las pruebas automáticas de Codex pueden ejecutar otra instancia en un puerto
aislado sin tocar la instancia persistente del usuario.

## Verificación de la envoltura LAN

Para probar el WebSocket del servidor RocketSim que ya está escuchando en el
puerto 5300, usar la sonda versionada; evita comandos `node -e` con comillas
anidadas, que PowerShell puede descomponer antes de pasarlos a Node:

```powershell
npm run probe:lan-websocket
```

La sonda devuelve `status: "ok"` y el `welcome` si el handshake funciona;
`timeout`, `connection-error` o `server-error` indican que el navegador no es
la causa primaria. Se puede elegir otro puerto sin editar el comando:

```powershell
$env:LAN_PROBE_PORT = "5300"
npm run probe:lan-websocket
```

Para diagnosticar una conexión visual, iniciar el servidor con
`$env:DEBUG_LAN = "1"` antes de `node server.mjs`. El servidor imprimirá cada
upgrade, rechazo de origen, rechazo de protocolo y `welcome`. El cliente muestra
en el HUD los errores de módulo y WebSocket en lugar de dejar el texto inicial
de conexión; no copiar JavaScript de una línea a PowerShell para estas pruebas.

ONLINE-01 tiene una sonda de reconexión independiente que usa el backend
JavaScript y el puerto 5345. No toca el juego RocketSim que esté abierto en
5300. Para validar el transporte en el host, ejecutar en otro PowerShell:

```powershell
cd "C:\Users\Pedro José\Documents\Codex\2026-10-09\files-pasted-by-the-user-help\outputs\CarSoccerArsenal"
npm run probe:lan-session
```

Debe informar tres aserciones verdaderas: rechazo antes de `hello`, recuperación
dentro de la ventana de cuatro segundos y retirada después de la ventana. El
sandbox de Codex no puede abrir esa conexión loopback hacia el servidor hijo;
por eso esa sonda se valida en el PowerShell anfitrión, mientras que la suite
pura sigue ejecutándose dentro del sandbox.

## Diagnóstico de versión servida — 14/10/2026

La sesión visible de `http://localhost:5300/?arena=combat-alpha&mobair01=1`
conectó, mostró snapshots y ACK vivos, pero tras recarga normal y recarga sin
caché no mostró la línea `MOB-AIR` ni produjo logs de esa campaña. El código
actual sí contiene esa línea y sus pruebas pasan 143/143. La evidencia separa
el bridge (funcionando) de la entrega del cliente: esa instancia está sirviendo
una versión anterior de `src/client.js` o el navegador conserva una ejecución
anterior. Para cerrar MOB-AIR-01 hay que reiniciar el proceso del host desde la
raíz actual y volver a abrir la URL; no modificar controles ni el solver para
compensar un cliente desactualizado.

## Lanzador persistente recomendado

`tools/start-rocketsim-combat-watch.ps1` valida R19 y fija bridge, arena,
modo combate, puerto 5300 y timeout 500 ms. Ejecutarlo una vez por sesión y
dejarlo abierto. El watcher aplica los cambios de servidor automáticamente;
Ctrl+F5 aplica los cambios de cliente. Solo se relanza si el bridge informa un
cierre del runtime o se cambian variables/ejecutable.

## Bridge y visual no son la misma capa

`src/client.js` puede dibujar una curva nueva al recargar la página aunque el
proceso Node conserve un bridge anterior. Esa situación explica una curva que
se ve pero no tiene colisión: la presentación se ha actualizado, pero R13 no
contiene aún el cuarto de cilindro pared→techo de R19. El lanzador recomendado
evita ese desfase. Tras cambiar de R13 a R19 hay que cerrar el proceso Node y
ejecutar una vez `npm run start:watch:combat`; Ctrl+F5 por sí solo no reinicia
el ejecutable nativo.

## Corrección de reinicios concurrentes — 14/10/2026

El arnés MOB-AIR enviaba `restart` en cada frame mientras esperaba el
snapshot de respawn. Varias solicitudes concurrentes podían cerrar el bridge y
dejar `RocketSim practice is closed`. Ahora `restart` se envía una sola vez por
campaña; la prueba espera el serial de respawn antes de enviar salto. La misma
guarda se aplica a MOB-02. Regresión: **146/146**.

## Recuperación automática y campañas por piloto — 14/10/2026

El servidor ya no deja el runtime en estado terminal ante el primer timeout
transitorio del bridge. Intenta reconstruir la sesión RocketSim hasta tres
veces y publica el reinicio recuperado; solo pide reiniciar PowerShell si los
tres intentos fallan. También puede reiniciar aunque una reconstrucción de
roster haya dejado el bridge temporalmente separado.

Las campañas mobair01 esperan ahora a recibir el coche asociado al welcome de
esa pestaña. No usan state.cars[0] como sustituto, porque en una sesión
combat-alpha con varias pestañas ese coche puede pertenecer a otro piloto. Para
comparar front, side y diagonal, usa una sola pestaña o reinicia la ronda
después de cada variante; un HUD restart-unconfirmed significa que no hubo
evidencia autoritativa suficiente y no debe interpretarse como fallo físico.

## Sonda nativa desde Codex — 14/10/2026

La sonda probe:rocketsim-expanded-mobility puede arrancar su servidor hijo,
pero la conexión WebSocket desde el sandbox devuelve un error de acceso al
loopback. Esto confirma la misma separación de red ya documentada entre
sandbox y PowerShell del usuario. El smoke directo del bridge R13 sí responde;
la sonda WebSocket debe ejecutarse en el PowerShell anfitrión si se necesita
evidencia de integración.

## Snapshot congelado durante una campaña — 14/10/2026

El HUD MOB-AIR usa ahora state.time como identificador de snapshot. Una pestaña
que deja de recibir estados ya no progresa por tiempo de render; conserva la
entrada vigente y marca snapshot-stalled. Esto separa un bloqueo del host o del
WebSocket de un fallo de salto. Las sondas WebSocket lanzadas desde el sandbox
siguen bloqueadas por el loopback; ejecutarlas en el PowerShell anfitrión.

## Ventana de escritorio y ejecutable de Windows

El proyecto incluye una envoltura Electron que conserva el mismo servidor,
bridge RocketSim y WebSocket autoritativos. No crea una segunda implementación:
arranca `server.mjs` con R19, espera HTTP 200 y abre una ventana propia sin
barra de direcciones ni integración Node en el cliente. Al cerrar esa ventana,
la aplicación pide al servidor que apague el bridge de forma ordenada. El
endpoint de cierre solo existe en esa ejecución y exige un token aleatorio
privado del proceso de escritorio.

Antes de usarla, cierra cualquier servidor manual que esté usando 5300 con
Ctrl+C. Durante desarrollo se abre con:

```powershell
npm install
npm run desktop
```

Para generar un único `.exe` portable de Windows x64:

```powershell
npm run package:windows
```

El resultado se genera en `dist\`. La aplicación empaquetada usa el bridge
R19 como recurso de la aplicación; no requiere que PowerShell tenga variables
de entorno preparadas. Si 5300 ya está ocupado, se detiene y muestra un error
en vez de conectarse por accidente a una sesión distinta.

El portable NSIS no se debe modificar después con 7-Zip ni reemplazando a mano
su `app.asar`: el ejecutable lleva una comprobación de integridad. Si cambia el
contenido, hay que volver a generar el portable completo con
`npm run package:windows`.

### Dependencias de módulos del cliente

Three.js 0.180 carga `three.core.js` desde `three.module.js`. Ambos archivos
figuran explícitamente en la frontera estática del servidor; de otro modo la
ventana de escritorio puede mostrar que no pudo cargar `src/client.js` aunque
ese archivo exista dentro del paquete. La regresión HTTP recorre los imports
directos de `client.js` y de Three.js para impedir que una dependencia de
navegador vuelva a quedar fuera de la allowlist o del paquete.
