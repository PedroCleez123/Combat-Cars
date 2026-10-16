# Guion de playtest FIS-14D — Aire y nitro

Fecha: 10 de octubre de 2026.  
Build: servidor local `npm start`, perfil **CALIBRACIÓN LIMPIA**, un piloto y
cero bots.

## Propósito

Decidir ajustes de tacto a partir de una observación repetible. Esta sesión no
debe añadir combate, rampas, bots ni nuevos activos. Registra primero lo que se
percibe y después una sola causa candidata.

## Preparación

1. Abre el juego y selecciona **CALIBRACIÓN LIMPIA**, capacidad de pilotos 1 y
   bots 0; reinicia la ronda para aplicar la configuración.
2. Asegura que los controles predeterminados están restaurados si procedes de
   una build anterior.
3. Ejecuta `npm run probe` antes y después de cualquier ajuste. Conserva el
   bloque `airAxes` junto a la fecha del resultado.
4. En este perfil, el HUD muestra `ESTADO`, `ACTITUD` y `GIRO` autoritativos.
   Úsalos para identificar el eje que realmente cambió; no los compares como
   valores objetivo de Rocket League.
5. La tarjeta **FIS-14D.1 · CALIBRACIÓN** aparece abajo a la derecha. Pulsa
   **Iniciar sesión**, ejecuta un paso, anota una observación y pulsa
   **Registrar y seguir**. Al final, **Copiar informe** deja una evidencia
   lista para incorporar al registro. La tarjeta no altera la física.
6. Completa una segunda sesión con el mismo guion. **Comparar 2 sesiones**
   muestra la conclusión de ambas pasadas y deja copiarla. Borra el historial
   local desde la misma tarjeta si quieres comenzar una línea base nueva.

## Secuencia de seis maniobras

| Paso | Entrada | Observación esperada | Señal de defecto |
| --- | --- | --- | --- |
| 1 | Salto, W durante 0,3–0,5 s | El morro baja de forma continua. | El coche sube el morro, gira sobre mundo o responde tarde. |
| 2 | Salto, S durante 0,3–0,5 s y nitro | El morro sube; el nitro aporta ascenso. | El nitro sigue plano o W/S parece invertido. |
| 3 | Salto, D durante 0,3–0,5 s | La nariz gira hacia la derecha sin roll no solicitado. | Signo invertido, deriva lateral repentina o giro a saltos. |
| 4 | Salto, Ctrl y después Espacio | Cada control produce air roll en sentidos contrarios alrededor del morro. | Ambos botones giran igual, cambian yaw principal o no se ven en cámara. |
| 5 | Salto, W+D+Shift y soltar | La combinación es continua; al soltar, las tasas se atenúan sin detenerse en un fotograma. | Tirón, cambio de eje o persistencia excesiva. |
| 6 | Salto, S, nitro, soltar y aterrizar | Asciende según el morro y aterriza estable con dos saltos. | Flotación, atraviesa el suelo, cámara contraria al morro o no recupera saltos. |

## Registro mínimo por iteración

- Build y hora local.
- Paso del guion, entrada usada y duración aproximada.
- Resultado: correcto, lento, rápido, invertido, inestable o discrepancia de
  cámara.
- Un solo grupo a modificar: `airPitch*`, `airYaw*/airRoll*`, amortiguación o
  `boostGroundAcceleration`/`boostAirAcceleration`.
- Resultado de `npm test` y bloque `airAxes` después del cambio.

## Regla de decisión

No se ajustan dos grupos de constantes en la misma iteración. Si la sensación
es ambigua, repetir los seis pasos antes de cambiar código. Si hay un defecto
de contacto, salto o cámara, volver al hito dueño de ese subsistema en lugar de
ocultarlo con valores de vuelo.
