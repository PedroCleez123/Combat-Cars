# ARENA-03 — Promover la arena cornered como predeterminada

**Estado:** aceptada el 13 de octubre de 2026.

## Problema observable

La arena `arsenal-expanded-cornered-practice` ya tenía evidencia nativa y web
aceptada, pero iniciar RocketSim sin `ROCKETSIM_ARENA` seguía seleccionando la
arena plana `arsenal-practice`. Eso hacía que el arranque habitual no probase
la geometría que acabábamos de validar.

## Hipótesis y alcance

El valor predeterminado del servidor, del lanzador de práctica y del match debe
ser el perfil cornered aceptado. Los perfiles anteriores siguen disponibles
cuando se seleccionan explícitamente, para conservar las regresiones y sondas.
Solo se cambia la selección inicial; no cambian física, geometría, protocolo,
escala, spawns ni cámara.

## Criterios de aceptación

1. `npm run start:rocketsim` selecciona
   `arsenal-expanded-cornered-practice` si no se define la variable.
2. `ROCKETSIM_ARENA=arsenal-practice` sigue seleccionando el control plano.
3. La clase `RocketSimPracticeMatch` usa el mismo valor cuando se instancia sin
   arena explícita.
4. La regresión completa sigue verde.

## Comprobación y resultado

- Base: `npm test` 130/130.
- Post: `npm test` mantiene 130/130.
- Inspección: server, lanzador y constructor usan
  `ROCKETSIM_DEFAULT_ARENA` o respetan la selección explícita.
- Estado: **Aceptada**. Se preserva el perfil plano como control reproducible.

## Fuera de alcance

No se modifican la malla, los parámetros del solver, la cámara, el combate,
los bots, las transiciones pared-techo ni la presentación visual. El siguiente
hito es VIS-02: iluminación y referencias espaciales de la arena limpia.
