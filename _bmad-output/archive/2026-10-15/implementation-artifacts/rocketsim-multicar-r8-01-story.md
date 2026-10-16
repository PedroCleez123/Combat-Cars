# R8-01 — Práctica RocketSim multivehículo

**Estado:** aceptada R8-01a y R8-01b el 12 de octubre de 2026

## Historia

Como arquitecto del modo PvP, quiero que el bridge RocketSim simule y publique
varios coches con IDs estables e inputs independientes, para preparar la
migración de movimiento sin introducir todavía combate ni doble autoridad.

## Alcance

- Mantener `arsenal-practice` y `arsenal-curved-practice` como arenas propias.
- Aceptar de dos a seis coches en el bridge y conservar su orden/ID.
- Aplicar el input correspondiente por coche en cada tick nativo.
- Publicar un estado normalizado por coche y conservar la práctica de un coche
  como regresión.
- Mantener `RocketSimPracticeMatch` opt-in y sin rockets, daño, bots ni respawns
  de la partida de producción.

## Criterios de aceptación

1. Dos coches avanzan con inputs distintos y sus estados no se intercambian.
2. IDs duplicados, ausentes o fuera de rango se rechazan de forma determinista.
3. El bridge mantiene 120 Hz internos y el match conserva dos ticks por
   snapshot; el cierre libera todos los coches.
4. La práctica de un coche, las sondas R7 y `npm test` no regresan.
5. La documentación distingue movimiento nativo multivehículo de combate y
   deja R8-02 pendiente.

## Fuera de alcance

Combate, rockets, daño, bots, matchmaking, migración por defecto, mallas
Soccar, cambios de fuerzas y cualquier código o recurso propietario.

## Evidencia de R8-01a (12 de octubre de 2026)

El bridge C++ acepta de uno a seis coches con IDs `1…6`, equipo azul o rojo,
orden estable de publicación e inputs independientes por ID. Tanto `init` como
`tick` rechazan listas vacías, IDs duplicados, fuera de rango o distintas de la
configuración activa. La sonda `npm run probe:rocketsim-multicar` ejecuta 180
ticks para dos coches: el azul con avance y el rojo con reversa conservan sus
IDs y velocidades longitudinales opuestas. La misma sonda prueba por JSONL que
el ejecutable rechaza init y tick duplicados y después recupera un init válido.

R8-01b conecta las plazas WebSocket al roster nativo. La práctica conserva una
plaza inerte solo durante el arranque sin pilotos; el primer piloto reutiliza
esa plaza y cada alta o baja posterior reconstruye de forma atómica el bridge
con los coches activos. Así no quedan marcadores nativos que alteren las
colisiones. Cada piloto conserva ID, equipo e input independiente y el cambio
de roster reinicia el spawn con un serial de respawn explícito. R8-02 queda
como siguiente historia: integrar rockets, daño y respawn alrededor de esta
autoridad nativa, sin bots ni doble solver físico.

La regresión añade una prueba de dos pilotos con inputs opuestos. Además, un
smoke del servidor con dos WebSockets reales obtuvo bienvenidas azul/rojo,
`humans=2` y un snapshot con ambos coches; sus posiciones respondieron a
throttle opuesto. `npm test` queda en 110 pasadas, 0 fallos.
