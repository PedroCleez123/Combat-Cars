# Contrato de ejecución

## Prioridad de producto

El producto se llama **Combat Cars** y la migración a la versión web online con
RocketSim WASM en el host está aceptada. Esa ruta WASM/P2P es la única versión
prioritaria, mantenida y desplegable. La ruta local Three.js + Node + RocketSim
nativo es una referencia histórica congelada para comportamiento, diagnóstico
y regresión; no define el estado de publicación online. El slug técnico
heredado `car-soccer-arsenal` sólo se conserva donde sea necesario para
compatibilidad.

No se borra aún la ruta local. La retirada exige inventariar dependencias,
fixtures, herramientas y pruebas, archivarla o excluirla de las builds y
comprobar que la validación WASM/P2P ya no la consume.

## Ruta local

`server.mjs` y RocketSim nativo son la ruta local de referencia. El servidor
recibe entradas, ejecuta la simulación autoritativa y devuelve snapshots; el
cliente nunca asigna por sí mismo daño, score, boost, respawn o poses.

## Ruta online principal

Pages sirve el cliente estático. El Worker de señalización solo intercambia
ofertas, respuestas y candidatos ICE. Tras el handshake, WebRTC transporta las
entradas y snapshots entre navegadores; no hay servidor de partida dedicado.
El host ejecuta RocketSim WASM y es la única autoridad de la simulación.

La sesión privada usa una clave corta introducida desde el menú. El estado
offline/práctica no necesita sala y permanece jugable si no hay otro piloto.
La versión publicada está validada para 1v1; el protocolo reserva roster de
hasta seis jugadores para 2v2, 3v3 y FFA posteriores.

## Estado y autoridad

Los snapshots autoritativos incluyen identidad de jugador, transformaciones,
velocidades, contactos de arena, salto/dodge, boost, vida, proyectiles,
eventos, score y estado de ronda. El renderer no modifica esos valores.
Los mensajes de entrada contienen solo controles y acciones del piloto; los
identificadores de sala y peer se validan en la señalización y no son autoridad
física.

## Referencia local

Para comparar comportamiento, cámara, audio, vehículo y combate se usan los
módulos de `src/` indicados en el README. Las pruebas WASM y P2P se encuentran
en `tests/` y `tools/wasm-spike/`. El bridge nativo de desarrollo, cuando haga
falta, se compila en `.rocketsim-bridge-build-r20/`; no se usa el antiguo R9.
