# Car Soccer Arsenal

## Contexto del proyecto

- Juego web multijugador de escritorio con Three.js y un servidor Node autoritativo.
- No introducir Unity, Godot, Unreal, MCP de motores ni dependencias nuevas sin una necesidad aprobada.
- Consulta `README.md` para controles y alcance, y `PROTOCOL.md` antes de cambiar mensajes de red o autoridad del servidor.

## Hito activo

Estabilizar la física y los hitboxes del vehículo. Cada cambio debe mejorar una mecánica jugable o su validación; aplaza pulido visual, activos externos y nuevas mecánicas hasta cerrar este hito.

## Forma de trabajar

1. Trabaja solo en la siguiente historia o tarea concreta del hito activo.
2. Antes de editar, define un resultado observable y criterios de aceptación breves.
3. Mantén la simulación autoritativa en el servidor: el cliente envía entradas y renderiza estados.
4. Al terminar, ejecuta `npm test`. Para cambios de jugabilidad, usa también `npm start` y comprueba el comportamiento en el navegador cuando sea posible.
5. Considera la tarea terminada solo con los criterios cumplidos y evidencia de la comprobación. Registra ideas fuera de alcance como trabajo aplazado, sin implementarlas.

## Documentación de trabajo

- Los artefactos de BMad van en `_bmad-output/`.
- Mantén este archivo corto. Carga documentación adicional solo cuando sea necesaria para la tarea.

## Herramientas opcionales instaladas

- **img2threejs:** disponible en `.agents/skills/img2threejs`. Úsala solo para una historia concreta de props o modelos visuales a partir de imágenes; no define hitboxes ni desplaza el hito de física.
- **OpenWiki:** integración MCP de Codex en `.agents/skills/openwiki` y `.codex/config.toml`. Se consulta bajo demanda y se actualiza solo por páginas mediante su ciclo MCP; no la inicialices ni la actualices por rutina.
- Son recomendaciones: comprueba que aportan valor antes de activarlas y registra su evidencia. **DeepSeek Harness** está aislado en `.tools/deepseek-harness` y se lanza solo de forma experimental con `.\tools\dsh.cmd web`; no forma parte del flujo Codex ni recibe acceso por defecto.

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
