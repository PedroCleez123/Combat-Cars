# Capturas deterministas

Estos JSON son entradas o salidas por defecto de las sondas de movilidad,
contacto, arena y RocketSim. Se conservan porque los comandos de `package.json`
los leen, comparan o regeneran. No son hojas de ruta ni evidencia de producto
publicada.

Si una sonda deja de existir, se eliminarán conjuntamente su script, su test y
su captura. Los logs temporales y capturas de smoke pertenecen a `artifacts/`
y no se guardan aquí.
