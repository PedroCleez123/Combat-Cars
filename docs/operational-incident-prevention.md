# Incidencias operativas y prevención

Este registro separa problemas de herramientas, host y empaquetado de defectos
del juego. Una incidencia no es evidencia de un cambio de física. Cada entrada
anota la señal observada, la causa confirmada o el límite conocido y la acción
que previene su repetición.

## Principios no negociables

- RocketSim es autoridad de pose, contacto y orientación. El cliente presenta
  snapshots y las campañas de observación solo emiten la entrada documentada.
- Un coche invertido no se endereza automáticamente. HITBOX-01 suelta los
  controles tras el contacto; la recuperación es una acción del jugador.
- Un HUD o una página cargada no prueban por sí solos WebSocket, bridge o
  colisión. La prueba debe coincidir con el límite que se quiere aceptar.
- No se modifica un portable NSIS con 7-Zip ni se reemplaza su `app.asar` a
  mano. Se recompila el portable completo y se valida el archivo final.

## Host, PowerShell y navegador

### Comillas de `node -e` en PowerShell

**Señal:** un diagnóstico WebSocket pegado como `node --input-type=module -e
'...'` pierde sus comillas y Node muestra un `SyntaxError` antes de conectar.

**Prevención:** no distribuir diagnósticos JavaScript de una sola línea para
PowerShell. Usar las sondas versionadas, por ejemplo `npm run
probe:lan-websocket`, que contienen el código y sus comillas dentro del
repositorio. Para cambiar el puerto, usar `LAN_PROBE_PORT` según
`local-server-browser-bridge.md`.

### Puerto ocupado y sesión equivocada

**Señal:** un servidor anuncia el arranque, pero el navegador sigue conectado a
una instancia anterior o el lanzador informa que 5300 está ocupado.

**Prevención:** detener explícitamente la instancia anterior con Ctrl+C antes
de cambiar modo, bridge o puerto. Verificar el listener con
`Get-NetTCPConnection -LocalPort <puerto> -State Listen`; no matar procesos a
ciegas. El portable aborta si 5300 está ocupado para no conectarse por error a
otra sesión.

### Sandbox de Codex frente al loopback del host

**Señal:** una prueba dentro del sandbox anuncia un servidor mientras el
navegador del escritorio devuelve timeout, o una sonda WebSocket no alcanza el
proceso hijo aunque el servidor local del usuario funciona.

**Causa conocida:** sandbox y escritorio tienen redes y espacios de procesos
distintos.

**Prevención:** iniciar la comprobación web desde el PowerShell del usuario.
Ejecutar las sondas de integración LAN en ese mismo host; reservar el sandbox
para pruebas puras, análisis y bridge directo. No interpretar esa frontera como
un defecto de Three.js, WebSocket o RocketSim.

### Automatización visual no disponible

**Señal:** la herramienta de navegador no puede inicializar su kernel o no
puede escribir sus assets.

**Prevención:** registrar la limitación como **no verificado visualmente** y no
declarar que una escena se vio. Mantener una URL y un criterio manual
reproducible, como `?hitbox01=1`, y aceptar solo la evidencia que sí se pudo
ejecutar (prueba, sonda o captura nativa).

## Cliente y bridge

### Página cargada pero "Conectando al servidor de arena"

**Señal:** los assets HTTP responden, pero el HUD no recibe `welcome` ni
snapshots.

**Prevención:** separar los límites: comprobar HTTP, ejecutar
`npm run probe:lan-websocket` en el host y, si es necesario, arrancar con
`DEBUG_LAN=1`. No cambiar la física para corregir un fallo de transporte.

### R13 visual con R19 físico, o al revés

**Señal:** el cliente muestra la geometría reciente pero no colisiona como
espera la arena R19.

**Prevención:** cambiar de bridge requiere detener y reiniciar el proceso Node;
una recarga del navegador no reemplaza el ejecutable nativo. Usar el lanzador
`npm run start:watch:combat`, que fija R19, y confirmar la etiqueta `R19` del
HUD antes de aceptar una observación.

### Contacto de carrocería no equivale a `grounded`

**Señal:** un coche invertido publica contacto contra el suelo pero permanece
`grounded: false`, porque sus ruedas no tienen apoyo.

**Prevención:** HITBOX-01 evalúa contacto de carrocería con normal de suelo y
`wheelCount=0`; no usa `grounded` como sustituto. La sonda R19 debe conservar
la orientación y diferenciar ambos casos.

## Empaquetado Windows

### Assets directos omitidos del servidor estático

**Señal:** la ventana Electron carga el HTML pero informa que no puede cargar
`/src/client.js` o un módulo transitivo de Three.js.

**Prevención:** todo import directo del cliente debe figurar en la allowlist de
`src/http-static-boundary.js`. La prueba de frontera HTTP recorre esas
dependencias, y `verify:desktop-package` inspecciona `app.asar`, incluido
`three.core.js`.

### Integridad NSIS inválida

**Señal:** Windows abre el portable y muestra `NSIS Error: Installer integrity
check has failed`.

**Causa conocida:** modificar el portable, su archivo asar o sus recursos tras
construirlo invalida su contenedor.

**Prevención:** reconstruir con `npm run package:windows`; después ejecutar
`npm run verify:desktop-package`. La validación inspecciona `app.asar`, calcula
SHA-256 y ejecuta `7za t`. Nunca reparar un `.exe` portable editándolo.

### Salida parcial o bloqueada de electron-builder

**Señal:** `EBUSY` al sobrescribir `dist\\win-unpacked`, un `app.asar` ausente o
un `.nsis.7z` de 0 bytes después de una ejecución interrumpida.

**Prevención:** tratar la salida como incompleta y no usar ni registrar su
hash. Cerrar la ejecución que conserva el bloqueo, usar una carpeta de salida
nueva si Windows no libera la anterior y mantener el proceso de empaquetado
vivo hasta que termine. Validar el portable y el `app.asar` de la **misma**
salida con `DESKTOP_PACKAGE` y `DESKTOP_ASAR`; solo después se puede copiar el
portable validado a `dist`.

### Procedencia desactualizada

**Señal:** el código, `package.json` o el portable cambian y
`npm run verify:provenance` ya no coincide.

**Prevención:** actualizar `docs/provenance-baseline-2026-10-17.json` solo
después de una construcción completa validada. No sustituir hashes con valores
de artefactos parciales.

## Documentación y cuotas

### Actualización de OpenWiki interrumpida

**Señal:** OpenWiki mantiene un `runId` activo, pero la cuota del proveedor
detiene una página antes de `openwiki_finish`.

**Prevención:** no editar manualmente `openwiki/.run.json`, claims, índices ni
sidecars. Reanudar exactamente con `openwiki_begin` y el mismo repositorio;
procesar las páginas pendientes y llamar a `openwiki_finish` solo cuando la
cola informe que está completa. Mientras tanto, no declarar la wiki actualizada
por completo.

### Aprobación de una acción local rechazada por cuota

**Señal:** la revisión automática no llega a evaluar una orden que pide
permisos adicionales porque el servicio informa un límite de uso.

**Prevención:** no intentar rodear la revisión. Conservar el estado y la
evidencia, continuar con cambios locales no privilegiados y reintentar solo
cuando el permiso pueda evaluarse. Si bloquea un paso material, comunicarlo de
forma explícita.

### Runtime global de npm incompleto

**Señal:** un comando `npm run ...` que funcionaba en la misma sesión puede
fallar antes de ejecutar el script con `Cannot find module 'which'` dentro de
la instalación global de npm.

**Prevención:** clasificarlo como fallo del runtime de Node/npm, no del script
del proyecto. Ejecutar primero el archivo versionado de forma directa con
`node tools/<script>.mjs` para aislar la comprobación; reparar o reinstalar la
distribución de Node/npm antes de volver a basar una aceptación en `npm`.

### Archivo de referencia bloqueado durante Git

**Señal:** `git diff --stat` o una lectura de diagnóstico informa acceso
denegado para una captura histórica en `docs/reference-captures/`.

**Prevención:** no modificar, borrar ni regenerar la captura bloqueada. Cerrar
el visor o proceso que la mantiene abierta y repetir solo la inspección; si no
es necesaria para el hito, trabajar con los paths modificados conocidos y no
tratar el bloqueo como un cambio de código.

## Checklist antes de aceptar un hito

1. Confirmar qué subsistema posee la autoridad.
2. Ejecutar la prueba o sonda más cercana al comportamiento cambiado.
3. Clasificar la evidencia como aceptada, fallida o no verificada; no mezclar
   un fallo de herramientas con un fallo de juego.
4. Para builds Windows, validar portable y asar de la misma salida antes de
   actualizar procedencia o distribuir el `.exe`.
5. Para la wiki, cerrar el ciclo por páginas con `openwiki_finish` y dejar el
   estado reanudable si la cuota lo impide.
