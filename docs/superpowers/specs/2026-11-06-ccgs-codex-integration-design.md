# Integración de Claude Code Game Studios en Codex

## Intención

Usar las ideas útiles de Claude Code Game Studios (CCGS) para hacer más claro y
proporcional el flujo de desarrollo de Combat Cars, sin introducir un segundo
framework ni desplazar BMad, OpenWiki, EGM o la skill global de videojuegos.

## Alcance

- Añadir una skill local de Codex que traduzca los conceptos de CCGS al flujo
  existente.
- Mapear rigor, roles y gates a las skills y artefactos que ya existen.
- Mantener el foco del producto en WASM online y el hito PR3.
- Registrar procedencia, licencia y límites de la adaptación.

Queda fuera copiar el árbol `.claude/`, los hooks de Claude Code, sus comandos
slash, sus 49 agentes o sus plantillas completas. No se cambian física,
hitboxes, protocolo de red ni código jugable.

## Alternativas consideradas

1. **Vendorizar CCGS entero.** Aporta muchos materiales, pero no se activan
   directamente en Codex y duplican el proceso existente.
2. **Portar todos sus agentes y skills.** Daría una superficie grande y difícil
   de mantener, con mayor consumo de contexto y riesgo de reglas contradictorias.
3. **Adaptador selectivo para Codex (elegida).** Conserva solo las decisiones
   que mejoran el enrutamiento: profundidad proporcional, ownership estrecho,
   gates de evidencia y cierre documental cuando hay decisiones duraderas.

## Diseño elegido

`.agents/skills/ccgs-codex-bridge` será una skill opcional y de baja carga. No
reemplaza `desarrollo-videojuegos-ia`: cuando se active, remite a esa skill y a
los artefactos canónicos del proyecto. Sus roles son rutas hacia skills locales
existentes, no nuevos agentes permanentes.

La adaptación mantiene tres niveles:

- `minimal`: cambio local y comprobación inmediata.
- `standard`: historia acotada, comprobación del subsistema y evidencia si
  cambia el comportamiento visible.
- `full`: contratos de red/autoridad/WASM, arquitectura, migraciones o cambios
  que requieren BMad/OpenWiki y revisión independiente.

## Criterios de aceptación

- Codex puede descubrir y validar la nueva skill por su `SKILL.md`.
- La skill no exige leer o ejecutar CCGS para cada tarea.
- El mapeo no duplica el protocolo de `AGENTS.md` ni reabre la física aceptada.
- La documentación indica que la fuente original es MIT y está diseñada para
  Claude Code, no para Codex.
- La integración deja claro cuándo no usarla.

## Verificación

Se valida el frontmatter con el comprobador oficial de skills de Codex y se
revisan referencias, rutas y estado del repositorio. No se ejecuta `npm test`
porque no se modifica código del juego.
