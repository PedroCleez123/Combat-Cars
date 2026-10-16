# FIS-17 — Recuperación de curvas de movilidad

Estado: RCE-1 completado; RCE-2 pendiente de captura externa comparable  
Fecha: 11 de octubre de 2026  
Hito: movilidad en CALIBRACIÓN LIMPIA

## Historia

Como responsable de la física, necesito reproducir siempre el mismo guion de
entradas y conservar la pose y las transiciones a 120 Hz, para poder comparar
una curva observada con nuestra implementación y ajustar una sola familia de
parámetros cada vez.

## Criterios de aceptación

- Existe `npm run probe:curves`; `node tools/mobility-curves.mjs` devuelve el
  JSON limpio para guardarlo como captura.
- Las siete trazas usan la misma semilla, arena limpia y cadencia de 120 Hz.
- Cada traza conserva 1,2 s de muestras, entradas, estado, quaternion,
  velocidades y seriales de acción.
- El dodge diagonal registra una dirección normalizada y la diferencia entre
  doble salto y dodge queda observable por sus seriales.
- La prueba de regresión demuestra que dos ejecuciones son idénticas.
- Ningún archivo de referencia externa se ejecuta, enlaza o copia en el juego.

## Evidencia de implementación

- `src/mobility-curve-probes.js` — escenarios y esquema de muestras.
- `tools/mobility-curves.mjs` — salida reproducible.
- `tools/capture-mobility-curves.mjs` — guarda una captura JSON completa.
- `src/mobility-curve-comparison.js` y `tools/compare-mobility-curves.mjs` —
  comparación de forma a tiempo normalizado.
- `tests/mobility-curves.test.mjs` — 120 Hz, duración, seriales y diagonal.
- `docs/archive/2026-10-12/reference-curve-recovery-plan.md` — fases RCE-0 a RCE-4.

## Límites conocidos

REA confirmó la identidad estática del ejecutable local de Rocket League, pero
el inventario completo de procedimientos de Ghidra excede el límite de esta
sesión y el binario no se ejecuta. La inspección estática de Car Soccer sigue
mostrando su núcleo físico en WebAssembly. Ninguna de las dos fuentes aporta
una curva numérica comparable en esta historia.

La observación web del 11 de octubre dejó Car Soccer en “Warming up visual
effects”. Sus recursos públicos expusieron mallas de colisión y audio separado
para salto, doble salto y dodge, pero no una sesión controlable. La captura
propia completa se conserva en
`docs/reference-captures/arsenal-2026-10-11.json`.

## Verificación

- `node --test tests/mobility-curves.test.mjs`: 2 pruebas, 0 fallos.
- `npm test`: incluye esta regresión junto al conjunto existente.
- `npm run probe:curves`: genera las trazas con el esquema indicado.

## Siguiente historia

RCE-2 debe adaptar una captura autorizada de referencia al esquema y marcar su
autoridad, escala y limitaciones. Solo después se puede abrir una historia de
ajuste para una familia concreta de `TUNING`.

