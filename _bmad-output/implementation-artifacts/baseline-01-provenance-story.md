# BASELINE-01 — baseline Git y procedencia local

**Fecha:** 17 de octubre de 2026  
**Estado:** aceptada

## Resultado del hito

El proyecto tiene ahora una primera referencia Git (`baseline-2026-10-17`) y
un manifiesto de procedencia que identifica el runtime, el bridge R19 activo,
el bridge R13 heredado y el portable de Windows generado en esta iteración.

## Problema observable

La copia recibida no tenía ningún commit Git: todos los archivos aparecían como
no versionados y no había forma de distinguir una modificación de código de un
cambio de bridge o de un artefacto empaquetado.

## Decisión y límites

- El baseline versiona código, pruebas, documentación, capturas y OpenWiki.
- `node_modules/`, builds nativas, `dist/`, `work/`, configuraciones personales
  y workflows archivados de OpenWiki quedan fuera del commit.
- No se cambia la simulación, la red ni las constantes de física.
- La procedencia de un bridge se comprueba por tamaño y SHA-256; no se incluye
  el binario nativo en Git.

## Evidencia

- `npm test`: 173/173.
- `npm run verify:provenance`: R19, R13 y portable 0.1.1 verificados.
- `git diff --cached --check`: solo informa espacios finales ya presentes en
  documentos archivados; los archivos nuevos de esta historia no introducen
  avisos.
- Etiqueta Git: `baseline-2026-10-17`.

## Relevo

La siguiente unidad no debe retocar física: completar las pruebas vivas de
`LAN-HARDEN-02` desde el PowerShell anfitrión y, después, observar `HITBOX-01`
invertida. Si el baseline cambia, actualiza el manifiesto y crea una nueva
etiqueta en vez de reescribir esta referencia.
