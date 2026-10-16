# Comparación de movilidad con Car Soccer

Actualizado: 10 de octubre de 2026. Este informe sirve para separar lo que
está observado de lo que aún necesita calibración con juego real.

## Alcance y evidencia

REA inspeccionó estáticamente los artefactos JavaScript públicos descargados de
`car-soccer.com`. El bundle principal usado para esta comparación mide
1.967.853 bytes y tiene SHA-256
`AC4B84C691CC6C90E2B4EC321D4B6EE502AFAAAD8B15EA26417D00790F1DD7E7`.
La página se quedó en su estado de carga en este entorno, por lo que no se
presenta una comparación visual o de tacto obtenida jugando contra el sitio.
Los hallazgos proceden del contrato de entrada, snapshots y estados que el
cliente expone alrededor del núcleo WebAssembly; no se copiaron código,
constantes, WebAssembly, modelos ni sonidos.

La evidencia REA relacionada con el inventario del navegador es
`ev_88416289c1c106f044a0f2740afd0b17959acd0b84b108cae9a75ab9075e1b95` y
`ev_514fffe5f6f1b10dca3cbaf7402893edd0a50e0e03ecf109a9152242301edb26`.
La extracción estática del cliente queda enlazada desde
[car-soccer-rea-integration.md](../../car-soccer-rea-integration.md).

## Comparación de contratos

| Área | Car Soccer observado | Car Soccer: Arsenal antes de este cambio | Decisión |
| --- | --- | --- | --- |
| Frecuencia | Física a 120 Hz y presentación separada | Simulación autoritativa propia a 120 Hz | Mantener la arquitectura actual. |
| Entrada aérea | El puente expone acelerador, dirección, pitch, yaw, roll, salto, nitro y derrape como ejes separados | Pitch, yaw y roll ya existen, pero el dodge solo leía throttle y steer | El dodge debe usar el mismo plano local que los ejes aéreos. |
| Free air roll | Mientras se mantiene, la dirección pasa a roll y la guiñada queda suprimida | Ya corregido en FIS-14E | Mantener y cubrir con regresión. |
| Dodge dirigido | La relación observable compone `forward = -pitch` y el lado con `yaw + roll`; el vector se normaliza | Solo se componían throttle y steer, de modo que roll direccional no podía cambiar el lado del dodge | Implementado en esta entrega con nuestra convención de signos. |
| Doble salto | El cliente distingue salto, dodge y doble salto por seriales y estados | Ya hay seriales y estados propios, pero el impulso exacto de la referencia está dentro de WebAssembly | No copiar el impulso; medir y calibrar nuestra respuesta. |
| Apoyo | El snapshot publica ruedas, normal de suelo y banderas de apoyo/flip | CAL-01 publica contactos y ruedas; aún conserva una recuperación de actitud provisional | Próxima historia: retirar el auto-enderezado y dejar que contacto y suspensión gobiernen la transición. |
| Presentación | Pose quaternion y estados discretos separados | Buffer quaternion y seriales propios ya implementados | Mantener FIS-15A/B. |

## Cambio implementado

En `src/simulation.js`, el segundo salto dirigido calcula ahora:

```text
dodgeYaw = airRoll ? 0 : steer
dodgeSideInput = dodgeYaw + roll
direction = normalize(throttle, dodgeSideInput)
```

La fórmula es una adaptación de comportamiento, no una copia de la
implementación de Car Soccer. Con ella, un roll direccional modifica la
dirección lateral del dodge; al mantener free air roll, el stick no se cuenta
dos veces como guiñada y roll.

La regresión nueva está en
`tests/simulation.test.mjs`: comprueba yaw solo, yaw más roll y free air roll.

## Validación reproducible

- `npm test`: **87 pasan, 0 fallos**.
- `npm run probe`: completado; la traza a 120 Hz conserva la cadencia y el
  dodge diagonal sigue aterrizando con dos saltos.
- `npm run probe:envelope`: completado; giro, powerslide, salto, dodge y los
  tres ejes aéreos permanecen dentro de su envolvente registrada.
- `npm run calibrate:network`: completado fuera del sandbox; las ocho
  maniobras CAL-03 pasaron por WebSocket con ACK, pitch, yaw, roll, doble
  salto, dodge con roll, nitro y aterrizaje comprobados. La dirección
  comprometida del dodge de mando fue `(forward=0,45, side=0,89)`.
- `vgamepad`: con el bus instalado, el script elevado
  `vgamepad-live-test.py` produjo `VIRTUAL_PAD_READY`, 20 flancos de botón A y
  `VIRTUAL_PAD_RELEASED`. Esto confirma la creación y actualización del mando
  virtual. La instancia Edge aislada no llegó a abrir su endpoint CDP, por lo
  que todavía no se afirma que el navegador integrado haya consumido ese
  dispositivo físico.

## Huecos que siguen explicando la diferencia de tacto

1. El bundle de referencia no revela las curvas internas del WebAssembly:
   velocidad angular durante el flip, frenado del dodge, impulso exacto del
   doble salto y respuesta de suspensión siguen siendo incógnitas.
2. Nuestro aterrizaje reduce pitch y roll de forma explícita. Hay que medir
   cuánto debe conservarse de la actitud antes de escoger una transición. Ya se
   eliminó el aplanado instantáneo, pero la corrección posterior confirmó que
   tampoco debemos usar un objetivo de plano: Rocket League conserva la actitud
   que trae el coche y la respuesta debe venir de contacto y suspensión.
3. La comparación visual no está cerrada porque el sitio de referencia no
   llegó a entrar en la arena en esta sesión.

## Medición propia posterior

La sonda FIS-14I/FIS-14J ejecuta un dodge con yaw y alabeo direccional para
aislar la transición de aterrizaje. La dirección comprometida es
`(forward=0,447, side=0,894)`; tras añadir la separación única del dodge, el
primer apoyo llega a `1,258 s`, conserva roll `-0,010` rad, `20,110 u/s` de
velocidad horizontal y `25,470 u` de recorrido, con cuatro ruedas cargadas.
Esta cifra es una línea base de nuestra implementación, no una afirmación de
coincidencia con Car Soccer.

## FIS-14K — entrada durante el segundo salto

La regla implementada sigue el contrato observable de ejes: el flanco del
segundo salto lee W/S como delantero y A/D como guiñada, suma el alabeo
direccional cuando corresponde y normaliza la dirección. La free air roll no
cuenta dos veces el stick: lo convierte en `roll` antes de llegar a la
simulación. El impulso y la rotación quedan comprometidos en ese instante; la
entrada posterior solo puede cancelar la rotación opuesta y no reorienta la
velocidad.

La evidencia estática de Car Soccer deja la curva interna dentro de
WebAssembly. Por tanto, esta entrega verifica relaciones y estados, no afirma
que el tiempo o la fuerza sean idénticos a la referencia.

## Siguiente ruta

1. Ejecutar el guion de CALIBRACIÓN LIMPIA con la cámara visible y registrar por separado: doble
   salto vertical, dodge forward, dodge lateral, dodge con roll y aterrizaje
   inclinado. La traza de suspensión actual registra pitch `-0,068` y roll
   `-0,112` rad en el primer apoyo, antes de estabilizarse.
2. Ajustar un único grupo de constantes por sesión, con una métrica previa y
   posterior; no modificar simultáneamente impulso, tasas y amortiguación.
3. Repetir la misma traza con mando estándar cuando el navegador exponga el
   dispositivo; conservar la prueba por adaptador/WebSocket como regresión de
   red aunque el navegador no lo muestre.
4. Solo después reintegrar arena con obstáculos y combate. La física de la
   arena limpia sigue siendo la puerta de salida.

