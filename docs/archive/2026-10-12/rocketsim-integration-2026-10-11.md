# FIS-18 — Integración de comportamiento inspirado en RocketSim

Actualizado: 11 de octubre de 2026.

## Decisión

Car Soccer declara en su interfaz que su física está adaptada de RocketSim.
RocketSim es una biblioteca pública de simulación de Rocket League; su propio
README describe la simulación como cercana pero no perfectamente idéntica y
advierte que los pequeños errores se acumulan. Por eso la usamos como contrato
de comportamiento y fuente de hipótesis verificables, no como una promesa de
equivalencia automática.

Fuentes revisadas:

- [README de RocketSim](https://github.com/ZealanL/RocketSim): simulación
  autónoma, paso de arena a 120 Hz y límites conocidos de fidelidad.
- [Car.cpp](https://raw.githubusercontent.com/ZealanL/RocketSim/main/src/Sim/Car/Car.cpp):
  orden de actualización, salto, control aéreo, flip y doble salto.
- [RLConst.h](https://raw.githubusercontent.com/ZealanL/RocketSim/main/src/RLConst.h):
  ventanas, límites, curvas de dirección y valores de referencia.
- [CarConfig.h](https://raw.githubusercontent.com/ZealanL/RocketSim/main/src/Sim/Car/CarConfig/CarConfig.h):
  umbral de dodge por configuración del coche.
- [Licencia MIT](https://github.com/ZealanL/RocketSim/blob/main/LICENSE).

## Qué se cambió

### Segundo salto dirigido

- El umbral agregado del dodge pasa a `0.5`, igual que la configuración pública
  de Octane en RocketSim. Un input analógico pequeño conserva el doble salto
  vertical.
- El dodge aplica un único impulso horizontal en el plano de la arena. Se
  proyectan los ejes delantero y lateral sobre XZ antes de sumar la velocidad;
  el cabeceo del coche no convierte el dodge en un empuje vertical artificial.
- La magnitud parte de una escala propia equivalente a `500/2300` de la
  referencia y conserva el escalado de velocidad para los impulsos laterales y
  hacia atrás. No se han copiado binarios, WebAssembly ni código de terceros.

### Rotación y cancelación

- El dodge frontal usa cabeceo y el lateral usa alabeo. La guiñada no se
  introduce como un tercer eje del flip.
- La ventana angular pasa a `0.65 s`; tras ella queda un bloqueo de cabeceo de
  `0.3 s`. Durante el flip, una entrada opuesta de cabeceo cancela ese par,
  pero mantiene el impulso lineal ya aplicado.
- La velocidad vertical solo recibe la amortiguación temporal del tramo
  `0.15–0.21 s`; el sistema no añade aceleración lineal durante todo el flip.

### Estado publicado

Los snapshots incluyen `dodgePitchLockRemaining`, además de la dirección y el
tiempo restante del dodge. Esto permite diferenciar en una captura un flip en
curso de la recuperación breve posterior.

## Evidencia reproducible

```powershell
cd "C:\Users\Pedro José\Documents\Codex\2026-10-09\files-pasted-by-the-user-help\outputs\CarSoccerArsenal"
npm test
node tools/mobility-curves.mjs > current-curves.json
```

Resultado de esta iteración: **94 pruebas pasan, 0 fallan**. Las pruebas nuevas
comprueban que:

- el dodge no añade un segundo flujo de aceleración lineal;
- la dirección permanece comprometida;
- el input lateral no cancela un flip de cabeceo;
- el impulso inicial no depende de la componente vertical de la actitud;
- el flip termina antes de que comience el control aéreo normal.
- la aceleración de nitro conserva la relación suelo/aire pública, el pulso
  mínimo no se corta al soltar y el combustible no se rellena en reposo.
- el salto mantiene un pulso mínimo de `0,025 s`, sostiene fuerza como máximo
  `0,2 s` y abre la ventana de segundo salto solo después de ese tramo.

La batería ampliada suma la regresión de dirección por velocidad: la geometría
de la rueda delantera interpola los puntos públicos de
`STEER_ANGLE_FROM_SPEED` de RocketSim después de convertir la velocidad de
referencia a las 56 unidades/s de Arsenal. La envolvente registra un radio de
`5,925` unidades a 12 unidades/s y `37,813` a 42 unidades/s; el giro se abre
con la velocidad en lugar de conservar un ángulo fijo.

La envolvente actualizada tras separar el nitro registra `1,608 s` hasta la
banda supersónica con el perfil de calibración. La cifra anterior de `1,533 s`
ya no describe el solver: la aceleración terrestre ahora es menor que la aérea
en la proporción pública.

La tracción terrestre sigue dos curvas públicas adicionales: el factor de par
de motor cae de `1` a `0,1` entre 0 y 1400 uu/s y a cero en 1410 uu/s; la curva
de dirección con powerslide interpola `0,39235` a 0 uu/s y `0,12610` a 2500
uu/s. El valor de Shift sube a razón de `5/s` y cae a `2/s`, como en el
contrato público. El solver conserva una compensación de guiñada limitada para
su modelo de ruedas reducido, pero ya no cambia de curva de forma instantánea.

### Nitro suelo/aire y pulso mínimo

- El nitro autoritativo separa la aceleración sobre ruedas (`22,488 Arsenal/s²`)
  de la aceleración en vuelo (`24 Arsenal/s²`). La razón conserva el contrato
  público `2975:3175` de RocketSim después de escalar la referencia a la
  velocidad máxima de Arsenal.
- El estado `boosting` deja de ser un reflejo directo del último paquete de
  entrada. Al comenzar un pulso se conserva durante `0,1 s`, aunque el jugador
  suelte el botón en el mismo instante; después se detiene y no rellena
  combustible de forma pasiva. El fuel sigue drenando solo mientras el pulso
  está activo.
- El empuje continúa usando el eje delantero del quaternion, incluidos los tres
  componentes sobre rampas. El límite de velocidad se mantiene después de
  aplicar gravedad y empuje.

## Prueba práctica de Car Soccer

La pestaña tardó en pasar de “Warming up visual effects” a una partida
interactiva. Tras esperar, se habilitó el overlay de estado y se ejecutaron
reinicio, aceleración, salto, doble salto neutro y segundo salto con W. La
referencia mostró una escena estable a más de 200 FPS; el doble salto con W
dejó una actitud de flip comprometida, mientras que el doble salto neutro
conservó una pose mucho más nivelada. Las capturas fueron cualitativas: la
página no expone una traza numérica de su simulación al DOM.

## Lo que sigue abierto

Esta integración mejora el contrato del dodge y la dirección terrestre, pero no
convierte Three.js en Bullet ni permite afirmar que el tacto ya sea idéntico.
El control aéreo continuo ya usa torque local, amortiguación y un límite angular;
la curva de dirección terrestre también está integrada. El siguiente bloque es
validar visualmente la respuesta tras reiniciar el servidor. FIS-19 ya alinea el
pulso mínimo y la apertura de la ventana del segundo salto; queda comparar en
pantalla toque corto, salto mantenido, doble salto y dodge con el mando estándar.
Después se calibrarán suspensión, fricción y contactos de pared con trazas
comparables.

## Ghidra

El inventario exhaustivo de Ghidra excedió el límite práctico de una llamada de
sesión; no es un fallo del ejecutable ni de la instalación. La solución prevista
es ejecutarlo una vez en modo headless, guardar el proyecto analizado y exportar
solo un catálogo paginado de funciones, strings y referencias. Para la física,
la evidencia pública de RocketSim y la observación de Car Soccer son ahora más
accionables que una lista global de miles de símbolos sin contexto.
