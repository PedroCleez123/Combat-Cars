# QA online actual

Esta lista valida la ruta publicada que el usuario juega hoy; no evalúa la
arquitectura hosted descartada.

## Una pestaña

1. Abrir `https://combat-cars.pages.dev` en un navegador de escritorio.
2. Confirmar que aparece el coche en el lobby offline y que se puede conducir.
3. Abrir **Menú** y comprobar audio, reasignación y controles de sala.
4. Crear una sala, copiar la clave corta y confirmar que el menú no cubre la
   arena ni el marcador.

## Dos navegadores

1. Abrir la URL en dos navegadores o perfiles distintos.
2. En el host crear sala y enviar la clave; en el invitado pegarla y pulsar
   **Unirse**.
3. Confirmar que ambos reciben `Partida activa`, avanzan ticks y pueden mover
   el coche, usar nitro, saltar, hacer dodge, fijar objetivo y disparar.
4. Mantener la partida varios minutos y verificar que una baja, respawn y
   salida del invitado no dejan la pestaña host en negro.

## Redes y navegadores

Repetir el flujo con una segunda red física y con Chromium, Firefox y Opera.
Registrar navegador, NAT/firewall, tiempo hasta conexión, errores de consola,
ticks inicial/final y si la sesión se mantiene. No confundir un bloqueo de NAT
con una mala configuración del online: Pages + Worker + WebRTC es la ruta
desplegada.

## Gates automatizados

```powershell
node --test tests/p2p-causal-beta-public-smoke.test.mjs
P2P_CAUSAL_BETA_ENDURANCE_MS=15000 npm run smoke:p2p-causal-beta:public-electron
npm run build:pages-beta
npm run verify:pages-beta
```

El smoke de una sola ejecución valida lobby, HUD, canvas, conexión y ticks de
host/invitado. La visibilidad de un rival requiere dos navegadores y es una
comprobación humana, no una aserción DOM del HUD compacto.
