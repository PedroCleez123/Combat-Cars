# MOB-AIR-02-OBS-ISOLATED — Observación aislada del vuelo

**Fecha de planificación:** 14 de octubre de 2026
**Estado:** preparada; no iniciada en esta iteración
**Prioridad:** P0
**Propietario:** agente coordinador
**Dependencias:** `MOB-AIR-01`, host RocketSim R13 operativo

## Objetivo

Obtener una traza reproducible de la movilidad aérea del jugador en una sesión
con un único piloto autoritativo. La historia separa la observación de cualquier
calibración: no modifica el solver, las constantes, la cámara ni el adaptador de
controles.

## Alcance

Ejecutar la campaña `?mobair01=1` en tres variantes independientes:

1. segundo salto/dodge frontal;
2. segundo salto/dodge lateral;
3. segundo salto/dodge diagonal, con air roll mantenido cuando corresponda.

Cada variante debe comenzar con un roster de un solo piloto y terminar antes de
abrir la siguiente. El estado autoritativo debe permanecer vivo durante toda la
maniobra.

## Criterios de aceptación

- El piloto local es el único participante de la sesión y conserva el mismo id.
- Los ACK de entrada son monotónicos y los snapshots autoritativos avanzan.
- La campaña registra seriales de primer salto, segundo salto y dodge (`J/2/D`)
  en cada variante.
- Se observa la recuperación posterior de la maniobra y la cámara sigue siendo
  legible.
- No aparecen errores de consola, runtime ni timeout del bridge.
- La evidencia se guarda en `docs/reference-captures/` y se enlaza desde el
  tracker y el relevo.

## Resultado permitido

- **Aceptada:** las tres variantes cumplen todos los criterios.
- **No verificada:** roster compartido, snapshots congelados, campaña incompleta
  o evidencia insuficiente. No se infiere un defecto físico.
- **Fallida:** hay un error reproducible con sesión aislada y evidencia completa;
  se abre una sola historia de corrección acotada.

## Fuera de alcance

- Cambiar fuerzas, torque, límites de velocidad o ventanas de salto.
- Cambiar el comportamiento de aterrizaje o autoenderezar el coche.
- Ajustar `camera-follow.js` antes de comparar la pose con la referencia.
- Añadir armas, bots, matchmaking o geometría nueva.

## Evidencia previa

- Front: observada y aceptada en el host 5300 con `J/2/D`.
- Side/diagonal: no verificadas; intentos previos estuvieron afectados por
  roster compartido o estado congelado.
- Suite actual: `npm test` 157/157 después de la implementación de liveness.

## Siguiente decisión

Con P0 aceptada, ejecutar `MOB-AIR-03` para comparar curvas web y nativas R13.
Solo una discrepancia reproducible abrirá una calibración específica de eje,
impulso, rotación o cámara.
