# Integración de Claude Code Game Studios en Combat Cars

## Estado

**Integrado de forma selectiva para Codex.** No se ha copiado el framework
completo al repositorio del juego.

La adaptación vive en
`.agents/skills/ccgs-codex-bridge/` y traduce sus ideas de rigor, ownership,
roles y evidencia a las skills de Codex, BMad, OpenWiki y EGM que ya usamos.
La matriz general de selección de skills y la correspondencia entre niveles de
rigor ahora están en la skill global
`desarrollo-videojuegos-ia`; este adaptador solo aporta el perfil del proyecto.
La misma skill incluye ahora dos gates opcionales inspirados en Advisor y
Thermos: una segunda opinión de solo lectura y una auditoría doble para cambios
de alto riesgo. No se ejecutan para tareas pequeñas.

## Motivo de la decisión

CCGS está construido alrededor de Claude Code, `.claude/`, comandos slash y
hooks propios. Copiarlo entero no lo convertiría automáticamente en un sistema
Codex y duplicaría el protocolo del proyecto. La integración pequeña evita
conflictos, reduce contexto y conserva el foco en el online WASM.

## Uso

Activa `ccgs-codex-bridge` solo cuando la tarea sea transversal o requiera una
decisión de proceso. Para una corrección pequeña usa directamente
`desarrollo-videojuegos-ia`. La skill elige `minimal`, `standard` o `full`,
remite cada responsabilidad a la herramienta existente y exige documentación
canónica solo cuando la decisión deba sobrevivir a la sesión.

## Instalación de referencia

La fuente oficial es el repositorio MIT:
<https://github.com/donchitos/claude-code-game-studios>.
Se ha descargado una copia de referencia fuera del proyecto en
`C:\Users\Pedro José\Documents\Codex\external\claude-code-game-studios`.
El archivo descargado se conserva como `ccgs-main.zip`, con SHA-256
`C18CD83AC1CA678E857FA19E65DAA3383E7F39EADFED364A2AA2CD93EAB119E7`.

No se añade como dependencia de npm ni como motor y Codex no ejecuta su árbol
`.claude/`. El adaptador local es la instalación funcional para Codex; la copia
externa sirve para consultar cambios y procedencia. Si se consulta una versión
nueva de CCGS, actualiza primero `references/ccgs-mapping.md` y revisa sus
cambios antes de modificar el adaptador.

## No cubierto

No se portan los hooks de Claude, el árbol de 49 agentes, las plantillas
completas ni los especialistas de Unity/Godot/Unreal. No cambia la autoridad
RocketSim WASM, el contrato PR3 ni la aceptación vigente de física e hitboxes.
