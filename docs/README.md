# Documentación vigente — Combat Cars

Esta carpeta contiene solo referencias que todavía sirven para desarrollar o
validar la versión actual.

## Estado de las versiones

La versión WASM/P2P de Combat Cars es la migración aceptada y la única ruta de
producto que se mantiene y se despliega (`Pages → Worker de señalización →
WebRTC P2P → RocketSim WASM en el host`). La antigua versión local Three.js se
conserva congelada como referencia de auditoría, regresión y diagnóstico; no se
usa para publicar ni se desarrolla en paralelo.

La retirada requiere primero un inventario de imports, fixtures, herramientas y
pruebas. Hasta cerrar ese inventario, los archivos locales no deben borrarse:
se archivarán o se excluirán de la build antes de eliminarse de forma
definitiva.

- [`../README.md`](../README.md): arranque, controles y arquitectura del producto Combat Cars.
- [`../PROTOCOL.md`](../PROTOCOL.md): prioridad WASM online, referencia local y autoridad Pages + Worker + WebRTC.
- [`wasm-migration-01-full-game.md`](wasm-migration-01-full-game.md): estado y
  próximos gates de la migración del cliente local al host WASM.
- [`rocketsim-architecture.md`](rocketsim-architecture.md): límites de la
  integración RocketSim y separación entre simulación y presentación.
- [`external-online-qa-checklist.md`](external-online-qa-checklist.md): pruebas
  manuales de dos navegadores y redes externas antes de ampliar el roster.
- [`persistent-room-lifecycle-plan.md`](persistent-room-lifecycle-plan.md):
  contrato y diseño histórico de la sala personal persistente, lobby físico sin
  PvP, reconexión, fases, seguridad, hitos y gates de publicación. No sustituye
  al roadmap canónico.
- [`../AGENTS.md`](../AGENTS.md): invariantes y reglas de trabajo; la prioridad
  se consulta siempre en el roadmap vigente.
- [`integrations/ccgs-codex.md`](integrations/ccgs-codex.md): integración
  selectiva de Claude Code Game Studios como adaptador de proceso para Codex.
- [`integrations/matt-pocock-skills.md`](integrations/matt-pocock-skills.md):
  análisis del repositorio, solapamientos y decisiones de composición para las
  skills actuales.
- [`integrations/skills-routing-matrix.md`](integrations/skills-routing-matrix.md):
  selección de una skill principal, técnicas transversales y comprobaciones por
  tipo de tarea.
- [`integrations/bmad-runtime.md`](integrations/bmad-runtime.md): estado del
  runtime BMad/GDS y ruta oficial de instalación cuando vuelva la conectividad.
- [`reference-captures/`](reference-captures/): evidencias deterministas que
  alimentan las pruebas; no son documentación narrativa.

La fuente de código prevalece sobre cualquier captura o nota. Las salidas de
build, smoke, logs, exports de investigación y documentos de iteraciones
anteriores se eliminan o regeneran; no se usan como configuración de runtime.
El plan de trabajo canónico está en
[`../_bmad-output/current-roadmap.md`](../_bmad-output/current-roadmap.md).
