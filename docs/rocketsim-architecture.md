# Arquitectura actual de Combat Cars y RocketSim

## WASM/P2P canónico y referencia local congelada

```text
cliente Three.js local ── Node ── RocketSim nativo R20
cliente Pages ── WebRTC P2P ── host ── RocketSim WASM R20
                         ▲
                         └── Worker: únicamente señalización
```

RocketSim es la autoridad de movimiento a tick fijo. El cliente presenta sus
snapshots y envía inputs; no inventa poses, daño, score, boost ni respawns.
Las reglas de combate, pickups y ronda se mantienen en la capa de host y deben
conservar la semántica de `src/rocketsim-combat.js`.

Pages + Worker + WebRTC + RocketSim WASM es la ruta canónica de producto de
Combat Cars. La migración está aceptada para el desarrollo y el despliegue
online. La ruta Three.js + Node + RocketSim nativo queda congelada como
referencia histórica de comportamiento y diagnóstico; una diferencia local no
autoriza por sí sola a alterar el contrato WASM.

La ruta local no se elimina todavía. Primero hay que inventariar sus imports,
fixtures, herramientas y pruebas, y verificar que ninguno sea necesario para
validar WASM/P2P. El orden seguro es archivar o excluir de builds, conservar
una copia recuperable y sólo después retirar código que ya no tenga
consumidores.

## Bridge local

El bridge nativo se usa para comparar trazas y regresiones locales. Se compila
en `.rocketsim-bridge-build-r20/` y no se publica en Pages. El antiguo R9 y las
builds portables anteriores ya no forman parte del proyecto.

## Contratos que no se deben romper

- ticks consecutivos y conversión de ejes y-up;
- roster e IDs de vehículo, hasta seis plazas reservadas;
- flags de salto, dodge, air-roll, derrape, boost y contacto de superficie;
- lifecycle de ronda, proyectiles, daño, eliminación y respawn;
- separación entre simulación, WebRTC, renderer, cámara y audio.

Una modificación de física exige una comparación nativo/WASM con la misma cinta
de inputs y una prueba focal. Una modificación de red exige prueba de lobby,
host/invitado y cleanup. La presencia de archivos antiguos no es evidencia de
paridad.
