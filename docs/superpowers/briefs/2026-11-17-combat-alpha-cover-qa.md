# COV-04 — QA de coberturas industriales

Fecha: 2026-11-17  
Estado: pendiente de evidencia manual; sin publicación.

> **Instantánea histórica:** los conteos de pruebas, el tamaño del paquete Pages
> y las observaciones automáticas de este brief describen el checkout revisado
> el 17/11/2026. No representan el estado actual del árbol. Para evidencia
> vigente, consulta `_bmad-output/current-roadmap.md` y los resultados de CI;
> las fechas de archivos por sí solas no determinan la frescura del WASM.

## Estado de ejecución

El fixture de choque del lobby usa una pose diagnóstica dentro del corredor
central libre de coberturas; no cambia el spawn público ni la física de
producción. La auditoría más reciente confirma que el WASM incluido ya cubre la
altura de 4,8 y que `build:pages-beta`/`verify:pages-beta` pasan. Esta revisión
no ha repetido esos comandos.

La validación focal es verde: 74 pruebas COV/ART/P2P, 4 contratos de arena
nativa y 7/7 pruebas de lifecycle WASM (un único skip explícito por no tener
`ROCKETSIM_BRIDGE_EXE`). La suite completa queda en 589 pass, 7 skips, 0
fallos; el post-test de raycast WASM pasa 3/3.

## Alcance

Validar los seis proxies autoritativos de COV y sus compañeros visuales:

- cuatro contenedores en `x=±45`, `z=±58`;
- dos barricadas bajas de neumáticos en `(-68,-30)` y `(68,30)`;
- nitro regenerable: no debe haber pickups;
- RocketSim WASM conserva toda autoridad de contacto, cohetes y resultado.

No cambia física, red, snapshots ni el estado del lobby.

## Evidencia automática registrada

- COV/ART/P2P/boundary focal: 74 pruebas correctas; contratos nativos: 4/4.
- Lifecycle WASM: 7 pass y 1 skip explícito por bridge nativo ausente.
- Suite completa: 589 pass, 7 skips, 0 fallos; post-test WASM: 3/3 (según la
  auditoría más reciente; no repetidos en esta revisión).
- Paquete Pages local: `npm run build:pages-beta` y
  `npm run verify:pages-beta`, ambos correctos con 101 archivos.
- El paquete incluye el material, el descriptor visual y
  `worn-tires-rubber.webp`.

## Ejecución manual local

Desde la raíz del repositorio:

```powershell
npm run play:wasm
```

Cuando el launcher confirme `http://localhost:5300`, abrir esa URL y esperar
a que termine la carga inicial. Para la ruta de producción empaquetada:

```powershell
npm run build:pages-beta
npx http-server dist-pages-beta -p 5302 -c-1
```

Abrir `http://localhost:5302/` en dos perfiles o navegadores distintos.

## Matriz de aceptación

| Caso | Resultado esperado | Estado |
|---|---|---|
| Spawn y carriles | Ningún coche nace dentro de una cobertura; carril central y exteriores quedan transitables | Pendiente |
| Contenedor | Bloquea coche y cohete a media altura; el cohete informa interceptación sin daño ni punto | Pendiente |
| Neumáticos | Bloquean un tiro bajo y contacto terrestre; se pueden sobrevolar | Pendiente |
| Tiro alto/bypass | No se bloquea artificialmente; conserva su resultado normal | Pendiente |
| Borde/curva/rampa | Tras rebotar cerca de una cobertura no hay teletransporte, escape ni atrapamiento | Pendiente |
| Lobby compartido | No hay PvP, muerte ni respawn por choque; las seis coberturas son visibles | Pendiente |
| P2P dos navegadores | Host e invitado ven la misma distribución, equipo/coche y cohetes | Pendiente |
| Rendimiento | Tras calentamiento, FPS/frame time no empeoran más de 10% frente a la baseline alta ART-05; draw calls añadidas ≤6, triángulos añadidos ≤6.000, sin luces dinámicas nuevas | Pendiente |

## Registro de resultados

Al registrar una ejecución, anotar navegador, URL, perfil de calidad, número de
jugadores, FPS/tiempo de frame/draw calls/triángulos/texturas/programas y
cualquier diferencia visual o de colisión. No cerrar COV-04 ni publicar Pages
con una captura de un solo navegador.
