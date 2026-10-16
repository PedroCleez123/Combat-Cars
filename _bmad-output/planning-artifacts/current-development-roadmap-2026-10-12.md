# Decisión de planificación — ruta posterior a ARENA-01 y VIS-01

**Decisión:** la siguiente historia es `MOB-01`, una campaña reproducible de
movilidad sobre `arsenal-expanded-curved-practice`. No se retocan constantes de
vuelo, salto, dodge, cámara o suspensión antes de que esa campaña atribuya un
defecto.

## Razón

RocketSim ya aporta el solver de vehículo del bridge R9 y la arena ampliada
tiene validación de transición por lado. Aún falta una evidencia unificada de
la secuencia que el jugador percibe: curva, pared, salto, dodge, air roll,
boost y regreso a suelo. Ajustar cualquiera de esas capas ahora ocultaría la
causa y repetiría las iteraciones especulativas anteriores.

## Dependencias y orden

1. MOB-01 — campaña reproducible de movilidad ampliada.
2. MOB-02 — presentación de la misma maniobra en navegador.
3. MOB-03 — combate con dos pilotos sobre poses nativas.
4. R9-01 — seis pilotos LAN, autoridad y roster.
5. GAME-01 — sesión de combate RocketSim configurable.
6. ARENA-02 — esquinas, techo y arena final por historias separadas.
7. Online público — servicio independiente después de la LAN.

La hoja completa, criterios de aceptación y gates están en
`_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md`.

