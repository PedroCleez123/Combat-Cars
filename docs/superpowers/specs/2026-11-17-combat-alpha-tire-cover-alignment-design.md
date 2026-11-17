# Barricadas de neumáticos compactas — diseño

## Intención

Las dos barricadas de neumáticos deben leerse como bloques industriales densos
que ofrecen cobertura real. La silueta que ve el jugador debe coincidir con la
caja estática que usa RocketSim para coches y cohetes: `8 × 8 × 4,8` UU.

## Decisión aprobada

Se conserva una **única caja sólida** por barricada. No habrá colisiones por
neumático ni cambios de protocolo, snapshots, posiciones, spawns o corredores.
La presentación construirá una pila compacta de `4 × 4 × 8` neumáticos,
derivada de las dimensiones del descriptor autoritativo. La altura autoritativa
se actualiza en lockstep en el mapa, el wrapper WASM y el bridge nativo.

Cada neumático será visualmente más grueso; los centros y el radio exterior se
calcularán para que la unión de la pila ocupe el volumen horizontal completo y
la altura exacta del proxy. El bloque seguirá siendo deliberadamente sólido:
los pequeños huecos visuales no son agujeros de jugabilidad.

## Alternativas consideradas

1. **Pila compacta dentro del proxy existente — elegida.** Corrige la
   discrepancia sin riesgo de física, autoridad o rendimiento de red.
2. Aumentar el proxy nativo/WASM junto a la malla. Añadiría riesgo de balance,
   raycast y navegación sin ser necesario para el resultado visual pedido.
3. Un collider por neumático. Costaría más, sería menos estable y no se desea.

## Límites y aceptación

- Reutilizar `worn-tires-rubber.webp`; no se requieren texturas nuevas.
- Las rutas local y P2P deben seguir llamando al mismo constructor compartido.
- Mantener tres batches de cobertura, cero luces dinámicas y un máximo
  aproximado de 52.000 triángulos para las instancias de neumático.
- La pila debe tener 256 instancias totales (128 por barricada), estar contenida
  en cada AABB autoritativo y tocar sus seis caras dentro de una tolerancia
  numérica pequeña; los anillos deben ser tangentes, sin solaparse.
- Las pruebas validarán el contrato geométrico y la conservación del descriptor
  `8 × 8 × 4,8`; la comprobación humana validará densidad visual, contacto y
  sobrevuelo local/P2P.
