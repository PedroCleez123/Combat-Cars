# Plan de recuperación y comparación de curvas de movilidad

Actualizado: 11 de octubre de 2026  
Historia BMad asociada: `FIS-17-reference-curve-recovery`

## Objetivo

Obtener una especificación medible del tacto de movilidad y usarla para
calibrar **CarSoccer: Arsenal** por grupos aislados. La especificación debe
responder cuánto tarda una acción, qué estado cambia, qué velocidad o tasa
angular produce y cuándo termina la ventana. No se busca copiar la
implementación de Rocket League ni de Car Soccer.

## Decisión de arquitectura

La primera fuente comparable es nuestra propia simulación, ejecutada con un
guion de entradas fijo y subpasos autoritativos de 120 Hz. La herramienta
`node tools/mobility-curves.mjs` publica un documento JSON con; `npm run
probe:curves` es su atajo de proyecto:

- salto inicial sostenido y su liberación;
- conducción en suelo: aceleración, giro con agarre y powerslide;
- segundo salto vertical;
- dodge frontal, lateral y diagonal con alabeo direccional;
- combinación aérea de cabeceo, guiñada y alabeo;
- free air roll separado de la guiñada;
- pose, velocidad lineal, velocidad angular, quaternion, estado de salto,
  ventana restante, dirección comprometida y seriales de acción.

Cada muestra se toma después de un subpaso. Los flancos de `jump` están
descritos en el propio guion; no dependen de pulsaciones humanas ni de la
cadencia de un navegador.

R0 añadió un manifiesto inicial de ocho escenarios al mismo JSON bajo
`scenarioManifest`. Cada entrada declara su identificador estable, clave de
traza, condición inicial y fases de entrada expresadas en frames. Se puede
inspeccionar sin generar una captura completa con:

```powershell
npm run probe:curve-manifest
```

## Flujo de trabajo

### RCE-0 — registro de evidencia

Se conservan las fuentes y sus límites en:

- `_bmad-output/planning-artifacts/rl-reference-mobility.md`;
- `_bmad-output/planning-artifacts/car-soccer-rea-static-findings.md`;
- `docs/reference-translation-ledger.md`;
- `docs/car-soccer-rea-physics-contract.md`.

REA volvió a identificar el ejecutable de Rocket League sin ejecutarlo:

`C:\Program Files (x86)\Steam\steamapps\common\rocketleague\Binaries\Win64\RocketLeague.exe`

SHA-256: `bfeba09f0e82db0b3a972fedbfbb5a3b96ac88813fd184bce8a9efe2f541b7bc`.
REA confirma que Ghidra `12.1.4` está instalado y disponible en Windows; la
sesión se dejó cerrada después de la consulta.
El inventario exhaustivo de Ghidra no terminó dentro del límite de la sesión;
no se trata como evidencia de constantes ni de curvas.

### RCE-1 — línea base reproducible (implementado)

`src/mobility-curve-probes.js` define el contrato de traza y
`tools/mobility-curves.mjs` lo expone. La prueba
`tests/mobility-curves.test.mjs` exige:

1. mismo JSON con la misma semilla y el mismo guion;
2. 120 Hz en todas las trazas;
3. 144 muestras (1,2 s) por escenario;
4. seriales distintos para salto, doble salto y dodge;
5. dirección diagonal normalizada a `(0,447, 0,894)`;
6. fases de entrada de aire y free air roll visibles en cada muestra.

Comandos:

```powershell
node tools/mobility-curves.mjs > current-curves.json
npm test
```

Para conservar la captura completa en el proyecto:

```powershell
npm run capture:curves -- docs/reference-captures/arsenal-current.json
```

El archivo generado es una línea base fechada por el registro de cambios; no
se usa como objetivo de diseño y debe sustituirse cuando cambie la física.

Cuando exista una captura adaptada, `npm run compare:curves -- referencia.json
candidato.json dodge-diagonal-roll` remuestrea ambas señales a tiempo
normalizado y devuelve el error RMS de forma para altura, velocidad y tasas
angulares. También conserva los picos en las unidades originales y compara la
dirección del dodge por separado; no convierte esos picos en una afirmación de
equivalencia entre motores.

### RCE-2 — captura de referencia (implementada con R1)

Una captura externa solo entra si se puede obtener de forma autorizada y
repetible. Debe convertirse al mismo esquema, sin incluir código, binarios,
WebAssembly, texturas ni constantes de la referencia:

```json
{
  "schemaVersion": 1,
  "source": "reference-name",
  "build": "identifier-or-date",
  "fixedStepHz": 120,
  "traces": {
    "dodge-forward": {
      "samples": [
        {"frame": 1, "time": 0.0083, "input": {}, "state": {}}
      ]
    }
  }
}
```

La captura debe incluir el guion exacto, la convención de ejes, el origen de
la medida y sus unidades. Si solo hay vídeo o inspección estática, se marca
como evidencia cualitativa y no alimenta un ajuste numérico.

R1 cumple esta puerta con `rocketsim-r1-c2baacb8.json`: una ejecución aislada
de RocketSim a 120 Hz, con `THE_VOID` y un único plano Bullet sintético. Su
procedencia, commit y licencia se conservan en el manifiesto de esa captura y
el ejecutable se compila fuera del bundle de Arsenal. Dos ejecuciones dieron el
mismo SHA-256. La comparación inicial señala la guiñada de suelo como primera
hipótesis, descrita en `m1-ground-yaw-calibration.md`.

### RCE-3 — firma normalizada

Las unidades y escalas pueden ser distintas. La comparación futura usará
firmas adimensionales: tiempo normalizado de activación y liberación,
dirección de cada componente, velocidad normalizada respecto a su máximo,
tiempo hasta el pico, retención tras soltar y cambio de orientación. La
posición absoluta y los valores de mundo no se comparan sin una relación de
escala documentada.

### RCE-4 — ajuste controlado

Solo se modifica un grupo por iteración:

1. `dodgeLiftImpulse`/`dodgeInitialImpulse` para separación y recorrido;
2. tasas y amortiguación de pitch, yaw o roll para la respuesta angular;
3. una fuerza de nitro para el ascenso alineado con el morro;
4. contactos o suspensión únicamente si la firma de aterrizaje lo exige.

Cada candidato conserva la traza anterior, ejecuta `npm test`, repite
`npm run probe:curves` y se anota en `docs/physics-mobility-tracker.md`.
No se mezclan cámara, red, obstáculos y física en una misma iteración.

## Criterio de salida

RCE-1 está completo: ya existe una línea base determinista y una regresión
automática. RCE-2, RCE-3 y el ajuste de tacto quedan abiertos hasta disponer de
una captura de referencia comparable. Por eso esta entrega no afirma todavía
que la movilidad sea igual a Rocket League o Car Soccer; sí deja preparado el
camino para decidirlo con medidas en lugar de impresiones.

## Captura de referencia del 11 de octubre de 2026

La página `https://car-soccer.com/` llegó al estado de carga “Warming up visual
effects” y no entró en una sesión jugable durante la ventana de observación.
El inventario de recursos sí mostró una separación explícita de recursos de
colisión del estadio (`arena/collision/mesh_0.cmf` … `mesh_15.cmf`) y sonidos
distintos para `jump`, `double-jump` y `dodge`. Es evidencia estática de
separación de acciones y geometría de colisión, no una medición de sus curvas.

La captura comparable de Arsenal quedó guardada en
`docs/reference-captures/arsenal-2026-10-11.json`. Se generó con
`npm run capture:curves`; al compararla consigo misma, el comparador devuelve
144 muestras por lado, activación en el frame 12 y error RMS de forma cero.

