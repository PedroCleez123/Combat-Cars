# Contrato de ejecución y red

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

## Transporte online

Pages sirve el cliente WASM. El Worker de señalización y su Durable Object
administran el registro temporal de salas, reservas y tickets de reconexión; no
ejecutan el juego ni guardan el estado físico. WebRTC conecta a los navegadores
directamente para el tráfico de lobby y partida. El Worker mantiene las salas
multiusuario durante siete días. STUN ayuda a descubrir candidatos de
conexión; la ruta actual no incluye TURN, así que la conectividad en todas las
redes, NAT y firewalls sigue pendiente de validación.

## Sala personal y partida

Al iniciar, cada navegador crea o restaura una sala personal con una clave
corta. La clave pública se almacena separada del secreto de propietario,
guardado en el almacenamiento local del navegador. Las salas personales abren
en fase `room-open`, con hasta seis plazas y sin modo elegido. Todos los
participantes están presentes en la arena y pueden moverse con nitro infinito;
en esta fase no hay daño, cohetes, eliminaciones ni puntuación.

El host configura uno de estos modos antes de iniciar: 1v1 (2 pilotos), 2v2
(4), 3v3 (6) o FFA (2–6). En modos por equipos se exige equilibrio. Los nombres
son obligatorios. El canal de lobby comunica movimiento, presencia y equipos
antes de comenzar; el host decide la transición a `playing`. La ronda dura 300
segundos. El modo y el roster quedan fijados al iniciar.

Las salas persisten hasta su vencimiento en el Worker; la clave no es
permanente para siempre. Si el host se marcha, el Worker promueve a un invitado
conectado y conserva la identidad de sala; la ronda no continúa bajo la nueva
autoridad, se reconstruye una sala de espera. El antiguo propietario debe
recuperar una sala personal propia al volver. Un invitado puede salir de una
sala ajena y regresar a su sala personal.

## Ruta local

`server.mjs` y RocketSim nativo son la ruta local de referencia. El servidor
recibe entradas, ejecuta la simulación autoritativa y devuelve snapshots; el
cliente nunca asigna por sí mismo daño, score, boost, respawn o poses.

## Autoridad y canales

No hay servidor de partida dedicado: el host ejecuta RocketSim WASM y es la
única autoridad de la simulación. El protocolo de lobby está separado del
protocolo de combate, pero reutiliza la conexión WebRTC establecida para la
sala. Los mensajes de lobby llevan controles, presencia, modo, fase y equipos;
los canales de partida intercambian entradas y snapshots validados.

## Estado y autoridad

Los snapshots de partida autoritativos incluyen identidad de jugador, transformaciones,
velocidades, contactos de arena, salto/dodge, boost, vida, proyectiles,
eventos, score y estado de ronda. El renderer no modifica esos valores.
Los mensajes de entrada contienen solo controles y acciones permitidas del
piloto; los identificadores de sala, peer y plaza se validan en señalización y
no son autoridad física. El reinicio de ronda no forma parte de los controles
online.

## Comprobación y límites conocidos

La ruta P2P está funcional y la CI valida `npm test`, `build:pages-beta`,
`verify:pages-beta` y una reconstrucción WASM limpia. Esto no certifica todos
los NAT/firewalls ni la experiencia manual de todos los modos y navegadores.
La evidencia pendiente se mantiene en
[`_bmad-output/current-roadmap.md`](_bmad-output/current-roadmap.md) y en las
listas de QA correspondientes.

## Referencia local

Para comparar comportamiento, cámara, audio, vehículo y combate se usan los
módulos de `src/` indicados en el README. Las pruebas WASM y P2P se encuentran
en `tests/` y `tools/wasm-spike/`. El bridge nativo de desarrollo, cuando haga
falta, se compila en `.rocketsim-bridge-build-r20/`; no se usa el antiguo R9.
