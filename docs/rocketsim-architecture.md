# Arquitectura actual de RocketSim

Este contrato sustituye a la antigua hoja de migración, archivada en
[`archive/2026-10-14/rocketsim-migration-roadmap.md`](archive/2026-10-14/rocketsim-migration-roadmap.md).

## Propiedad de cada capa

```text
cliente Three.js
      │ entradas / snapshots
      ▼
Node ArenaMatch (red, combate, respawn, puntuación)
      │ MovementBackend
      ├── js        → fallback y regresión
      └── rocketsim → proceso nativo R13, movimiento autoritativo
```

- RocketSim ejecuta el movimiento del coche a 120 Hz.
- Node traduce ejes, mantiene la sesión y publica snapshots a 60 Hz.
- El modo RocketSim de combate es opt-in y requiere el bridge nativo.
- Los cohetes, daño, cooldown, puntuación y respawn siguen fuera de RocketSim.
- La arena propia conserva recursos de colisión explícitos; no depende de
  archivos de Rocket League.

## Límites

El bridge no convierte automáticamente el juego en Rocket League completo: hay
que mantener el adaptador de red, el roster multijugador, las reglas de combate
y la geometría de la arena. La similitud se valida con trazas y pruebas, no por
la mera presencia del código nativo.

## Cambios permitidos

Una modificación de bridge debe conservar el protocolo JSONL, los ids de coche,
los ticks consecutivos, la conversión de ejes y las pruebas de 1v1/6v6. Una
modificación de física requiere una historia independiente y una captura antes
y después.
