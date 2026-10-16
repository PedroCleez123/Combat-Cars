# MOB-01 — Campaña reproducible de movilidad RocketSim ampliada

**Estado:** aceptada como campaña de evidencia; no se ha editado código de juego.

## Problema observable

Las pruebas actuales validan el bridge, las cuatro transiciones y acciones
individuales, pero no publican una secuencia única de suelo → curva → pared →
salto/dodge → air roll/boost → aterrizaje para la arena que se pretende jugar.
La sensación de rareza no puede atribuirse todavía a física, entrada, cámara o
red.

## Hipótesis y alcance

La evidencia autoritativa de RocketSim permitirá separar esas causas antes de
ajustar valores. Se reutilizarán los runners WebSocket y de pared existentes,
parametrizados para `arsenal-expanded-curved-practice`; se añadirá únicamente
la instrumentación que falte.

Archivos candidatos: `tools/rocketsim-practice-probe.mjs`,
`tools/rocketsim-wall-actions-probe.mjs`, una sonda/captura nueva bajo
`tools/`, `package.json`, `docs/reference-captures/`, el tracker y este artefacto.

La sonda nueva es `tools/rocketsim-expanded-mobility-probe.mjs` y se ejecuta
con `npm run probe:rocketsim-expanded-mobility`. La captura parcial queda en
`docs/reference-captures/rocketsim-expanded-mobility-mob-01.json`.

Fuera de alcance: `src/simulation.js`, constantes de vuelo o salto, cámara,
combate, bots, obstáculos, protocolo público, dependencias y cambio de motor.

## Criterios de aceptación

1. El bridge mantiene 120 Hz y el servidor publica snapshots a 60 Hz.
2. Se capturan suelo→curva→pared con boost, salto desde pared, segundo salto
   dirigido/dodge, air roll + boost, salida y aterrizaje.
3. Cada entrada tiene secuencia/ACK; cada transición discreta aparece una vez;
   se registran superficie, ruedas, pose, velocidad, angular, boost y seriales.
4. Dos ejecuciones conservan las mismas clases de eventos y rangos dentro de
   una tolerancia de un snapshot de red; no se exige igualdad bit a bit de la
   cadencia WebSocket.
5. `npm test` y las sondas nativas previas siguen verdes; cualquier fallo se
   clasifica antes de proponer una corrección.

## Decisión posterior

- apoyo/penetración: abrir corrección de contacto nativo;
- input/serial/ACK: corregir adaptador o protocolo;
- trayectoria correcta y cámara errática: abrir MOB-02;
- campaña verde: congelar constantes y avanzar a MOB-02.

## Resultado de la campaña (13/10/2026)

La conexión WebSocket real confirmó `backend=rocketsim`,
`profileIsExpanded=true`, una sola plaza, ACK hasta la secuencia `21`,
cadencia `0,01/0,02 s` con media `0,01666 s`, y observó curva y pared en las
cuatro fases. También confirmó el salto dirigido, dodge, air roll y consumo de
boost en la fase de dodge/air roll.

La primera ejecución produjo un falso negativo porque la sonda mantenía nitro
al llegar al apoyo y pedía el salto a velocidad supersónica. Se corrigió solo la
secuencia de prueba: se confirma ACK de liberación, se espera apoyo estable por
debajo de `48 u/s` y entonces se ejecuta el salto. Dos ejecuciones posteriores
conservaron las mismas clases de eventos y rangos: curva y pared observadas,
salto que abandona apoyo, dodge dirigido, air roll con velocidad angular,
consumo de boost y recuperación al suelo. No se modificaron física, cámara ni
protocolo público.
