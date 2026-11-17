# Matriz de enrutamiento de skills

Esta matriz complementa `AGENTS.md` y el roadmap. Decide una ruta principal por
tarea; las técnicas de ingeniería se añaden solo cuando reducen una
incertidumbre concreta.

## Orden de decisión

1. Leer `_bmad-output/current-roadmap.md`, `AGENTS.md` y el artefacto activo.
2. Clasificar el riesgo: rápido, normal o riguroso.
3. Elegir una skill de dominio principal.
4. Añadir como máximo una técnica transversal principal: TDD, diagnóstico o
   revisión.
5. Validar el subsistema afectado y registrar la evidencia.

## Rutas

| Situación | Skill principal | Técnica transversal | Evidencia mínima |
| --- | --- | --- | --- |
| Texto, documentación, configuración local | `desarrollo-videojuegos-ia` | Ninguna o revisión textual | Diff y comprobación local |
| Mecánica, input, cámara, colisión o game feel | `threejs-gameplay-systems` | TDD si existe un contrato determinista | Prueba o sonda del sistema |
| HUD, menú, layout o accesibilidad | `threejs-game-ui-designer` | Revisión visual | Estados y viewport afectados |
| Canvas, renderer, assets, audio o FPS | `threejs-debug-profiler` | Diagnóstico reproducible | Reproducción y métrica antes/después |
| Bug o regresión de comportamiento | Skill del subsistema | Diagnóstico reproducible | Caso que falla, causa aislada y regresión |
| Worker, WebRTC, snapshots, autoridad o WASM | `car-soccer-development-protocol` + skill de dominio | TDD de seams públicos y revisión independiente si el riesgo lo justifica | Contrato, prueba adversarial, rollback y recorrido |
| Cambio que cruza varias capas | `ccgs-codex-bridge` | Revisión de arquitectura, como máximo dos revisores | Ownership, criterios y diff integrado |
| Build, publicación o QA externo | `threejs-qa-release` | Verificación final | Build/preview, smoke y riesgos |
| Planificación de producto o historias | BMad/GDS, solo con `_bmad/` instalado | Modelado de dominio si hay términos ambiguos | Artefacto canónico actualizado |

## Técnicas incorporadas de Matt Pocock

- **TDD:** acordar el seam público antes de crear una prueba; avanzar en ciclos
  verticales red/verde; no probar detalles internos.
- **Diagnóstico:** reproducir, aislar la causa y después editar; no parchear
  hipótesis competidoras sin evidencia.
- **Modelado de dominio:** mantener separados host/autoridad, transporte,
  snapshots, presentación y renderer; actualizar el glosario o el artefacto
  canónico solo cuando un término o frontera cambie.
- **Revisión:** comprobar intención, diseño, regresiones y mantenibilidad una
  sola vez con la profundidad proporcional al riesgo.

## Reglas contra duplicación

- No cargar simultáneamente `implement`, `to-spec`, `to-tickets`, BMad Build y
  otro orquestador equivalente.
- No instalar dos `code-review` automáticos para la misma tarea.
- No fusionar las skills de gameplay, UI, depuración, rendimiento y QA en una
  skill gigante.
- Si falta `_bmad/`, no ejecutar sus resolvers: continuar con esta matriz, el
  roadmap y el protocolo del proyecto.

## Ejemplo para PR3

Ruta: `car-soccer-development-protocol` + skill de red/WASM pertinente.

1. Diagnóstico reproducible de la pérdida de transporte durante `playing`.
2. Definición de seams: ticket, `participantId`, secuencia y snapshot.
3. TDD de reconexión válida, ticket antiguo, duplicado y callback atrasado.
4. Implementación acotada y revisión independiente si cambia autoridad.
5. Prueba focal y recorrido de dos navegadores.
