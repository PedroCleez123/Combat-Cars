# Ruta de física y experiencia

## Objetivo

Conseguir una movilidad de coche volador ágil y legible para un shooter PvP,
inspirada en las relaciones de control observables de Rocket League sin copiar
su código ni depender de sus archivos.

## Diagnóstico

La simulación ya tiene pasos fijos a 120 Hz, orientación por quaternion y
autoridad de servidor. Todavía mezcla una posición horizontal con una altura
independiente, usa contactos principalmente 2D y aplica el movimiento aéreo
con tasas Euler. Esa mezcla permite un prototipo jugable, pero impide que una
misma regla explique suelo, rampas, paredes, techo, aterrizaje y dodge.

## Secuencia de decisiones

1. **Marco de contacto (FIS-04):** cada coche expone estado de apoyo y normal
   de superficie; saltos e impulsos futuros podrán usar el mismo marco.
2. **Contacto jugable (FIS-05):** resolver pared/techo como superficies con
   tangente, normal y orientación del chasis; separar wall ride de simple
   rebote. La entrega actual alinea la orientación del coche hacia dentro de
   la arena, conserva y acelera velocidad tangencial, mantiene contacto mientras
   el jugador conduce, permite saltar de vuelta al campo y replica el quaternion
   desde el servidor. Conducción por el techo y hitboxes 3D detalladas quedan
   fuera de esta primera entrega.
3. **Conducción (FIS-06):** medir aceleración, agarre lateral, giro y derrape
   con escenarios aislados y mantener la autoridad del servidor. La base ya
   proyecta la velocidad sobre la tangente de suelo y rampas, conserva la
   componente de subida y libera el coche al aire cuando toda la huella deja
   el soporte.
4. **Vuelo (FIS-07):** pasar a torque local y amortiguación angular; comprobar
   signos de W/S, yaw y air roll con trazas de orientación. La implementación
   actual usa objetivos de velocidad angular por eje, límites explícitos y
   amortiguación al soltar controles, con igualdad comprobada entre cadencias
   de paquetes distintas.
5. **Salto y dodge (FIS-08):** separar doble salto vertical de dodge dirigido,
   con impulso normalizado y ventana temporal reproducible. La primera entrega
   fija una zona muerta direccional: por debajo de `0.20` el segundo salto no
   consume un dodge; desde el umbral se inicia el impulso direccional. La
   segunda entrega hace que la ventana posea también la rotación local, permite
   cancelar el cabeceo de un flip frontal con entrada opuesta y replica su
   tiempo restante para medirlo en juego.
6. **Boost (FIS-09):** empuje en el eje delantero del chasis, transición
   continua entre suelo y aire y límites de velocidad medidos. La primera
   entrega usa una sola aceleración local y limita la velocidad total después
   de gravedad, de modo que el final de cada subpaso respeta el máximo.
7. **Combate (FIS-10):** extender la huella a hitbox 3D, impacto angular,
   explosión y ram sin cambiar la autoridad de daño. La primera entrega da a
   la carrocería un volumen vertical frente a coberturas: lateral bajo, techo
   transitable y paso libre por arriba. La segunda usa el brazo local entre
   centro y contacto: una embestida lateral desvía el morro en suelo, una
   centrada no crea giro, y una explosión oblicua da una rotación local limitada
   en vuelo. El snapshot conserva un serial y magnitud del impacto.
8. **Integración (FIS-11):** interpolación visual, playtest guiado, balance y
   rendimiento después de cerrar el comportamiento físico.

## Criterios globales

- Cada historia tiene una prueba determinista y una señal observable en el
  snapshot.
- No se ajustan constantes para ocultar un fallo de contacto o de marco.
- El cliente nunca decide posición, daño, boost ni respawn.
- No se incorporan nuevos motores ni dependencias durante este hito.

## Fuera de alcance inmediato

Arte final, bots avanzados, matchmaking, audio, narrativa y pulido de UI.
