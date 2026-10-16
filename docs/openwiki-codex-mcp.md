# OpenWiki coordinado por Codex

## Decisión

OpenWiki no debe generar la wiki completa mediante una única petición a Qwen.
Ese flujo superó 40000 tokens antes de poder empezar. La integración activa es
el servidor MCP `openwiki` en modo `--host codex`: OpenWiki conserva la cola,
los índices, la procedencia y el estado reanudable; Codex investiga el código,
redacta una página asignada y la entrega mediante `openwiki_submit_page`.

Así el contexto se reparte por página y Codex puede revisar la limpieza de
documentos con el contexto de cada tarea, sin reutilizar la sesión interna de
Codex como una API ni consumir el servidor local de Qwen.

## Configuración

- Configuración global: `C:\Users\Pedro José\.codex\config.toml`.
- Configuración del proyecto: `.codex/config.toml`.
- Comando MCP: `node ...\\openwiki\\dist\\cli\\cli.js mcp --host codex`.
- Skill: `.agents/skills/openwiki/SKILL.md`.

La configuración global se añadió para que el MCP esté disponible aunque Codex
se abra desde otra carpeta. El proyecto sigue conservando su configuración
local como respaldo.

## Protocolo de uso

1. Reinicia Codex para que cargue el nuevo servidor MCP.
2. Abre el proyecto `CarSoccerArsenal` como carpeta de trabajo.
3. Pide: `Usa $openwiki para continuar la ejecución activa y actualizar la wiki
   por páginas. No ejecutes un init monolítico ni edites código.`
4. Codex debe llamar a `openwiki_begin`, planificar páginas compactas,
   procesar `openwiki_next_page`, enviar cada página con
   `openwiki_submit_page` y terminar con `openwiki_finish`.
5. Para ordenar documentos, la limpieza se hace después de consultar la wiki y
   verificar cada referencia contra el repositorio; los archivos se archivan,
   nunca se borran sin evidencia.

## Límites

- No se deben editar manualmente `openwiki/.run.json`, claims, índices ni
  sidecars gestionados.
- Qwen local queda disponible para resúmenes independientes, pero no es
  necesario para el ciclo MCP de OpenWiki.
- El MCP no reutiliza la autenticación de la aplicación Codex como API; Codex
  actúa como host de las herramientas y OpenWiki como gestor de estado.
