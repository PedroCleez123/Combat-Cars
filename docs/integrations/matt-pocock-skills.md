# Revisión de `mattpocock/skills`

## Corrección de alcance

Este repositorio es [mattpocock/skills](https://github.com/mattpocock/skills),
no `obra/superpowers`. Son skills pequeñas y componibles para ingeniería:
`tdd`, `code-review`, `diagnosing-bugs`, `codebase-design`,
`domain-modeling`, `grill-with-docs`, `to-spec`, `to-tickets` e
`implement`, además de routers y utilidades de configuración.

## Qué aporta a Combat Cars

- **TDD:** fija el seam público antes de escribir pruebas y conduce ciclos
  red/verde verticales. Es una buena regla para contratos de P2P, Worker y
  presentación.
- **Diagnosing bugs:** obliga a reproducir y aislar un fallo antes de editar;
  encaja con las regresiones de navegador y red.
- **Codebase design/domain modeling:** ayudan a mantener límites entre host
  autoritativo, transporte, estado de presentación y renderer.
- **Code review:** aporta una revisión independiente de especificación, diseño
  y robustez; es útil como segunda opinión cuando no se está ejecutando el flujo
  BMad/GDS completo.

## Solapamientos y decisión

No conviene instalar todo ni fusionarlo en una skill gigante. Ya tenemos un
enrutador (`desarrollo-videojuegos-ia`), un adaptador del proyecto y skills
especializadas de gameplay, UI, depuración, rendimiento y QA. BMad/GDS cubre el
flujo de planificación y entrega cuando `_bmad/` está disponible.

La solución es una **composición por capas**:

1. El enrutador decide el nivel de rigor y la skill principal.
2. El adaptador de Combat Cars aporta roadmap, autoridad y límites.
3. Una sola skill de dominio ejecuta la tarea.
4. TDD, diagnóstico o revisión se aplican como técnicas puntuales, no como
   otro proceso obligatorio.

Por eso no se copian `ask-matt`, `implement`, `to-spec` ni `to-tickets` ahora:
duplicarían el enrutado y el ciclo BMad. Tampoco se mezclan dos `code-review`
automáticos. Si más adelante se instala el plugin oficial para Codex, debe
seleccionarse un conjunto explícito y desactivar los duplicados por nombre o
invocación.

## Mejoras adoptadas

La precedencia queda escrita en `AGENTS.md`: el roadmap es la fuente de la
prioridad, el adaptador no inventa un hito, y BMad/GDS solo se activa con su
runtime. Las ideas de TDD, seams, reproducción, modelado de dominio y revisión
proporcional ya están incorporadas en el adaptador y en la matriz de
enrutamiento.

## Decisión sobre instalación externa

No se instala ahora el plugin completo de `mattpocock/skills`. El proyecto ya
tiene enrutamiento, skills de dominio y skills BMad/GDS locales; añadir el
plugin completo duplicaría `code-review`, planificación y ejecución. La opción
adoptada es conservar las técnicas localmente y reevaluar una instalación
selectiva después del piloto de PR3. Si se instala más adelante, se elegirá un
solo método de instalación y se desactivarán los duplicados por nombre o
invocación.
