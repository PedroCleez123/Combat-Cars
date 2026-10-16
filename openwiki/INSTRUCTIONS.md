# Instrucciones de OpenWiki — Car Soccer: Arsenal

Genera la wiki en español y documenta únicamente la implementación actual y
las decisiones activas. La fuente de verdad es el código y las pruebas; después
vienen el roadmap BMad y la documentación activa de `docs/`. La wiki es un
índice navegable, no una autoridad alternativa.

## Límites

- No edites código, pruebas, `AGENTS.md`, `PROTOCOL.md` ni el roadmap.
- No leas ni describas `docs/archive/`, `_bmad-output/archive/`,
  `docs/reference-captures/`, dependencias, logs o builds nativos.
- No copies código, datos, constantes, assets ni mallas propietarias de Rocket
  League o Car Soccer. Describe solo la implementación original y la evidencia
  conductual documentada.
- No inventes validaciones. Distingue aceptado, fallido y no verificado.

## Taxonomía

Prefiere páginas conceptuales y de flujo, con enlaces entre ellas:

- `architecture/`: ciclo servidor-cliente y límites de autoridad.
- `simulation/`: RocketSim bridge, poses, contactos, saltos y movilidad aérea.
- `arena/`: geometría física y presentación Three.js.
- `combat/`: cohetes, daño, respawn y puntuación.
- `network/`: WebSocket, snapshots, ACK, liveness y sesiones LAN.
- `client/`: render, cámara, controles y HUD.
- `operations/`: arranque R19, diagnóstico y compatibilidad web/LAN.
- `testing/`: pruebas y sondas reproducibles.

Mantén la primera generación compacta: crea como máximo ocho páginas de
contenido además de `quickstart.md`, fusionando temas estrechamente ligados.
Prioriza arquitectura, simulación, operaciones y pruebas; deja detalles
secundarios para una actualización posterior. Cada página debe ser breve,
centrada en decisiones verificables y enlazar a la fuente de verdad.

Incluye `/openwiki/quickstart.md` como punto de entrada y enlaza el roadmap
vigente y las páginas relacionadas. El bridge R19 es el ejecutable activo del
arranque de combate; R13 solo es evidencia histórica de compatibilidad.

## Proveedor

La ruta recomendada es el servidor MCP de OpenWiki en modo `--host codex`.
Codex actúa como host de investigación y redacción por página; OpenWiki
conserva la cola, los Claims, los índices y el estado reanudable. No se debe
generar la wiki completa mediante una sola petición a un modelo local.

La ruta local Qwen/llama.cpp y el lanzador con API se conservan solo como
contingencia histórica. Para actualizar la wiki se usa el MCP por páginas,
respetando la cola reanudable y los Claims de OpenWiki.
