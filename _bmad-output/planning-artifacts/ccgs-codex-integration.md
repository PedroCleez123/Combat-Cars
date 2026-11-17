# Decisión de integración — CCGS en Codex

**Fecha:** 2026-11-06  
**Estado:** aceptada e integrada de forma selectiva  
**Alcance:** tooling/documentación; no cambia la jugabilidad

## Decisión

Usar CCGS como referencia de proceso mediante
`.agents/skills/ccgs-codex-bridge`. El adaptador conserva sus ideas de rigor
proporcional, ownership, gates de evidencia y observación visual, y las enruta
a la skill global de videojuegos, BMad, EGM y OpenWiki existentes.

## Razón

La fuente original está hecha para Claude Code y sus `.claude/`, comandos slash
y hooks no son portables sin conversión. Importarla completa duplicaría reglas,
consumiría contexto y no aportaría al hito PR3 del online WASM.

## Límites

No se importan 49 agentes, 74 skills, hooks Bash, plantillas completas ni
especialistas de otros motores. La física, hitboxes, autoridad RocketSim WASM y
el protocolo online quedan sin cambios.

## Gate de mantenimiento

Si el adaptador empieza a repetir reglas de `AGENTS.md` o de
`desarrollo-videojuegos-ia`, se simplifica o se elimina. Las decisiones de
arquitectura y estado duradero siguen documentándose en BMad/OpenWiki, no en un
árbol paralelo de CCGS.

La copia externa de referencia se conserva en
`C:\Users\Pedro José\Documents\Codex\external\claude-code-game-studios`; no se
considera una dependencia del juego ni se carga automáticamente en Codex.

La skill global `desarrollo-videojuegos-ia` incorpora ahora el flujo general de
selección de skills y la traducción de rigor CCGS; el adaptador local conserva
únicamente el contexto específico de Combat Cars.

También incorpora, de forma opcional, una segunda opinión de solo lectura y una
auditoría doble para cambios de alto riesgo, inspiradas respectivamente en
Advisor y Thermos. No se ejecutan para tareas sencillas ni introducen Cursor
Cloud, Bun o claves externas.
