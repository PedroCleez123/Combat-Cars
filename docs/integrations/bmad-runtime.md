# Runtime de BMad y GDS

## Estado de esta copia

El proyecto conserva skills locales `bmad-*` y `gds-*` en `.agents/skills`, pero
no tiene el runtime compartido `_bmad/`. Varias de esas skills llaman a
`resolve_config.py`, `resolve_customization.py` o `render_skill.py`; por tanto,
no deben invocarse como si estuvieran instaladas. El flujo normal de Codex usa
el roadmap y `car-soccer-development-protocol` sin ejecutar esos scripts.

## Decisión

No se ha creado un `_bmad/` parcial ni se han copiado resolvers de una versión
distinta. Un runtime incompleto podría aceptar una configuración equivocada y
producir artefactos que parezcan válidos. BMad/GDS quedan opt-in y fallan de
forma explícita hasta completar una instalación oficial de una sola versión.

## Instalación oficial cuando haya red

La documentación oficial distingue dos líneas:

- **BMad estable v6.12:** `npx bmad-method install` con Node.js 20.12+, Python
  3.10+ y `uv`.
- **BMad v7:** skills en preview; se instalan con `npx skills add
  bmad-code-org/BMAD-METHOD --skill '*'` y después se ejecuta `bmad setup`.

No se deben mezclar las dos líneas ni reinstalar encima de las skills locales sin
revisar el diff. La copia actual usa convenciones de v6/GDS, así que la ruta
estable es la opción conservadora. Tras instalar, comprobar `bmad status` y
confirmar que existen `_bmad/scripts/` y la configuración del módulo GDS antes
de activar una skill BMad/GDS.

Referencias: [instalación oficial de BMad](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/docs/start/install-bmad.md) y
[referencia de módulos y configuración](https://docs.bmad-method.org/reference/module-files/).
