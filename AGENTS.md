# Combat Cars

## Contexto del proyecto

- Juego web multijugador con Three.js, RocketSim WASM y WebRTC P2P.
- **Combat Cars** es el nombre visible y la versión online WASM/P2P es la única ruta prioritaria, mantenida y desplegable. La ruta local Three.js + RocketSim nativo quedó congelada como referencia de comportamiento, diagnóstico y regresión; el slug técnico heredado `car-soccer-arsenal` se conserva donde cambiarlo rompería compatibilidad.
- No eliminar la ruta local hasta inventariar sus consumidores, fixtures, herramientas y pruebas; primero debe archivarse o excluirse de builds y conservarse una copia recuperable.
- No introducir Unity, Godot, Unreal, MCP de motores ni dependencias nuevas sin una necesidad aprobada.
- Consulta `README.md` para controles y alcance, y `PROTOCOL.md` antes de cambiar mensajes de red o autoridad del servidor.

## Fuente de prioridad

La prioridad funcional se determina únicamente en
`_bmad-output/current-roadmap.md` y en el artefacto o historia que ese roadmap
señale. Este archivo fija invariantes y límites del proyecto; no sustituye al
roadmap.

## Precedencia de skills

- `desarrollo-videojuegos-ia` es el enrutador general; las skills de gameplay,
  UI, depuración, rendimiento y QA aportan especialización, no otro protocolo.
- `car-soccer-development-protocol` solo adapta esas reglas a Combat Cars y no
  fija prioridades propias.
- BMad/GDS se usan solo cuando el runtime `_bmad/` está instalado y la tarea
  pide ese flujo; si falta, sigue el roadmap y las reglas de este archivo sin
  ejecutar resolvers o renderizadores inexistentes.
- CCGS y OpenWiki son adaptadores opcionales y just-in-time; no se cargan como
  un segundo protocolo al inicio de cada tarea.

## Forma de trabajar

1. Trabaja solo en la siguiente historia o tarea concreta que indique el roadmap.
2. Antes de editar, define un resultado observable y criterios de aceptación breves.
3. Mantén la simulación autoritativa en el servidor: el cliente envía entradas y renderiza estados.
4. Elige la comprobación según el riesgo: para documentación, texto, estilos o cambios locales usa la comprobación más cercana; para una función o UI acotada ejecuta las pruebas del subsistema y la navegación afectada cuando proceda; para física, controles, hitboxes, autoridad, red, bridge, arquitectura, cambios amplios o release usa pruebas dirigidas y añade `npm test` cuando haya contratos compartidos, riesgo de regresión transversal o una instrucción explícita. Usa `npm run play` y el navegador solo cuando el comportamiento jugable o visual esté afectado y el entorno esté disponible. No ejecutes la suite completa ni arranques el servidor por rutina.
5. Considera la tarea terminada solo con los criterios cumplidos y evidencia de la comprobación. Registra ideas fuera de alcance como trabajo aplazado, sin implementarlas.

## Documentación de trabajo

- Los artefactos de BMad van en `_bmad-output/`.
- Mantén este archivo corto. Carga documentación adicional solo cuando sea necesaria para la tarea.

## Herramientas opcionales instaladas

- **img2threejs:** disponible en `.agents/skills/img2threejs`. Úsala solo para una historia concreta de props o modelos visuales a partir de imágenes; no define hitboxes ni desplaza el hito de física.
- **OpenWiki:** integración MCP de Codex en `.agents/skills/openwiki` y `.codex/config.toml`. Se consulta bajo demanda y se actualiza solo por páginas mediante su ciclo MCP; no la inicialices ni la actualices por rutina. En cambios amplios, consulta fuentes del proyecto y el roadmap; usa OpenWiki cuando una incertidumbre arquitectónica lo justifique. BMad solo se usa si existe el runtime `_bmad/` y el flujo lo requiere.
- Son recomendaciones para cambios aislados: comprueba que aportan valor antes de activarlas y registra su evidencia. **DeepSeek Harness** está aislado en `.tools/deepseek-harness` y se lanza solo de forma experimental con `.\tools\dsh.cmd web`; no forma parte del flujo Codex ni recibe acceso por defecto.
- **CCGS:** el adaptador opcional `.agents/skills/ccgs-codex-bridge` traduce patrones de Claude Code Game Studios sin importar su framework completo. Úsalo solo para tareas transversales; no añade otro protocolo ni reabre la física/hitboxes aceptadas. Su decisión y límites están en `docs/integrations/ccgs-codex.md`.

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Do not enumerate, preload, or search wikis at task start. Use retrieval when the user asks for it, when unfamiliar architecture or dependency behavior materially affects the task, or when source inspection leaves an important uncertainty. Stop once the question is grounded.
- When those conditions apply and OpenWiki retrieval tools are available, use `openwiki_search` for just-in-time context and `openwiki_read` for the relevant complete sections. If search returns `workspace_required`, ask which listed workspace to use and retry with its ID.
- Use `openwiki_list_workspaces` or `openwiki_list_wikis` when workspace membership itself needs to be discovered.
- If the retrieval tools are unavailable, read `openwiki/quickstart.md` and follow its links to the relevant pages.
- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
