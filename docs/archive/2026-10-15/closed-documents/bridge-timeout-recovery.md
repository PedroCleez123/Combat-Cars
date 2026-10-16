# Recuperación de timeout del bridge RocketSim

## Síntoma

Durante un reinicio de `node --watch` puede aparecer:

```text
RocketSim bridge request timed out after 100ms
```

El mensaje `backend=rocketsim` demuestra que el ejecutable sí llegó a
arrancar; el fallo suele afectar al primer tick mientras Windows termina de
cerrar la instancia anterior o agenda el nuevo proceso.

## Corrección aplicada

`RocketSimBridge` usa ahora 250 ms como timeout de desarrollo y permite
configurarlo con `ROCKETSIM_REQUEST_TIMEOUT_MS`. El error incluye los últimos
400 caracteres de stderr del sidecar para distinguir bloqueo real de latencia
transitoria. El smoke test del bridge R13 y `npm test` siguen verdes.

## Procedimiento del usuario

Si el runtime ya se detuvo, hay que reiniciar la instancia una sola vez:

```powershell
$env:ROCKETSIM_REQUEST_TIMEOUT_MS = "500"
npm run start:watch
```

No se deben iniciar dos servidores en el mismo puerto. Si vuelve a fallar con
500 ms, detener la instancia anterior con `Ctrl+C`, comprobar que
`ROCKETSIM_BRIDGE_EXE` apunta a `rocketsim_bridge-r13.exe` y arrancar de nuevo.
Un timeout repetido con un bridge recién arrancado requiere revisar el stderr
del ejecutable; no se corrige cambiando constantes de física.

## Incidencia de roster vacío (14 de octubre de 2026)

El mensaje `tick must advance by one with the configured car IDs` puede aparecer
al cerrarse el último navegador de una sesión cuyo último coche nativo no era
el ID `1`. Hasta ese momento el bridge conservaba, por ejemplo, `[2]`, mientras
que el tick sin jugadores enviaba el slot inerte canónico `[1]`. RocketSim lo
rechazó para proteger su contrato de simulación.

La transición ahora reconstruye siempre el roster al desconectarse el último
piloto y vuelve a configurar `[1]` antes del siguiente tick. La prueba
`RocketSim rebuilds the idle slot after the final native pilot disconnects`
cubre `1,2 → 2 → 1` y verifica que el contador del nuevo bridge comienza en
el tick `1`. Si el watcher imprimió el error anterior, su recuperación ya
reinició la ronda; tras guardar esta versión, el watcher aplicará el arreglo
automáticamente.

La validación posterior se hizo en la instancia persistente de `localhost:5300`:
la recarga reconstruyó la ronda, volvió a publicar ACK y no dejó mensajes de
error o advertencia en la consola del navegador.
