# PR3a P2P Playing Reconnection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un invitado retome su coche durante `playing` mientras el host RocketSim WASM sigue vivo, sin crear autoridad ni vehículos nuevos.

**Architecture:** El Worker conserva la plaza mediante el ticket existente; el host conserva la simulación y reemplaza únicamente el DataChannel del slot. La nueva frontera de transporte neutraliza el comando anterior y reinicia la secuencia de ese slot. Si cae el host, se mantiene el regreso seguro al lobby, no una migración ficticia de simulación.

**Tech Stack:** JavaScript ESM, RocketSim WASM, WebRTC DataChannel, Cloudflare Durable Object de señalización, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-08-p2p-playing-reconnection-design.md`

## Global Constraints

- Mantener Pages + Worker de señalización + WebRTC P2P; no añadir servidor de juego, TURN, cuentas o dependencias.
- RocketSim WASM del host sigue siendo la única autoridad de física y combate.
- No cambiar hitboxes, score, equipos ni contratos de snapshot por una reconexión.
- Host perdido durante `playing` vuelve a sala segura; no promete continuar la ronda.
- Toda recuperación usa el ticket de participante y los límites existentes del Worker.

## Review Focus

- Canal antiguo que entrega un frame después del reemplazo: debe quedar fuera de la nueva frontera.
- Invitado que reinicia su contador a `1`: debe aceptarse una vez, tras reset del slot.
- Reintentos, `peer-left` y `closed` repetidos: deben producir un único reemplazo de sesión.
- Host vivo con un invitado ausente: debe seguir avanzando con comando neutral, no crear coche ni detener el reloj.
- Host realmente perdido: debe mantener la promoción/lobby seguro ya existente.

---

### Task 1: Reset autoritativo de una plaza de combate

**Files:**
- Modify: `tools/wasm-spike/p2p-wasm-multiplayer-host.mjs`
- Modify: `tools/wasm-spike/p2p-wasm-multiplayer-channel.mjs`
- Modify: `tests/p2p-wasm-multiplayer-host.test.mjs`
- Modify: `tests/p2p-wasm-multiplayer-channel.test.mjs`

- [x] Añadir una prueba que rechace una secuencia repetida antes del reset y acepte la secuencia `1` después, conservando roster/score/coche.
- [x] Añadir una prueba que compruebe que el reset sustituye el comando almacenado por neutral y no añade un piloto.
- [x] Implementar el reset por `playerId` en el host y el adaptador por `slot` en el canal.
- [x] Ejecutar las dos suites focales.

### Task 2: Sustitución de DataChannel de invitado durante `playing`

**Files:**
- Modify: `src/p2p-multiplayer-entry.js`
- Modify: `tests/p2p-multiplayer-desktop-controls.test.mjs`
- Modify/Create: prueba focal de ciclo de vida de canal si el contrato no queda cubierto por las existentes.

- [x] Añadir primero un contrato estático/determinista que exija neutralización y reemplazo de slot en fase `playing`, sin retorno inmediato a práctica.
- [x] Extraer un manejador idempotente de baja de invitado en combate: neutraliza, marca recuperación y pide una sesión WebRTC nueva para ese slot.
- [x] Al abrir el canal de reemplazo, reiniciar la frontera de secuencia y limpiar sólo la marca del slot recuperado.
- [x] Confirmar que la baja del host no entra por este flujo.
- [x] Ejecutar las pruebas de entrada/lifecycle afectadas.

### Task 3: Reingreso del invitado durante `playing`

**Files:**
- Modify: `src/p2p-multiplayer-entry.js`
- Modify: `tests/p2p-guest-connection-recovery.test.mjs`
- Modify: `tests/p2p-room-lobby.test.mjs` si cubre el flujo de entrada real.

- [x] Escribir una prueba de que la recuperación admite credenciales de fase `playing`, preserva roster/fase y no abre un segundo flujo de lobby.
- [x] Extender el retry para canjear el mismo ticket también durante `playing`.
- [x] Reabrir sólo el transporte, recrear el canal piloto y aceptar snapshots existentes; mantener la espera de promoción para host perdido.
- [x] Ejecutar recuperación, señalización, lobby y canal.

### Task 4: Evidencia, documentación y guardas de regresión

**Files:**
- Modify: `_bmad-output/current-roadmap.md`
- Modify: `docs/superpowers/specs/2026-11-08-p2p-playing-reconnection-design.md`
- Modify: `docs/superpowers/plans/2026-11-08-p2p-playing-reconnection.md`
- Modify only if required: `package.json`

- [x] Actualizar el estado PR3a y registrar qué sigue siendo imposible sin servidor.
- [x] Ejecutar suite focal, `npm test`, `npm run build:pages-beta` y `npm run verify:pages-beta`.
- [x] Registrar conteos reales, skips y pruebas manuales pendientes; no publicar sin solicitud explícita.
