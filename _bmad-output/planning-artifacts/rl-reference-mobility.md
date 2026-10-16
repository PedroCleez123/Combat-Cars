# Registro de referencia de movilidad

## Evidencia del artefacto

La consulta estática de REA abrió el ejecutable local sin ejecutarlo:

- Ruta: `C:\Program Files (x86)\Steam\steamapps\common\rocketleague\Binaries\Win64\RocketLeague.exe`
- Formato: PE x86-64
- SHA-256 observado: `bfeba09f0e82db0b3a972fedbfbb5a3b96ac88813fd184bce8a9efe2f541b7bc`

El hash identifica la versión analizada. No se usan sus archivos ni sus
constantes como dependencias del proyecto.

## Reglas que sí guían la implementación

El registro de ingeniería inversa y las comprobaciones de control disponibles
se convierten en relaciones observables, no en una copia de implementación:

1. La simulación debe ser fija y reproducible; este proyecto usa subpasos de
   120 Hz y el servidor conserva la autoridad.
2. La orientación del coche se trata en ejes locales: cabeceo, guiñada,
   alabeo, impulso del morro y dodge deben componer sobre la actitud actual.
3. Suelo, rampa y pared necesitan un marco de contacto común con normal y
   tangente. Un rebote contra una pared no debe borrar la velocidad paralela.
4. Un contacto de pared mantenido es distinto de un impacto: requiere una
   ventana de adherencia, caída controlada y una señal de estado para probarlo.
5. Salto, doble salto y dodge son ventanas temporales distintas; los impulsos
   dirigidos se normalizan para que una diagonal no gane velocidad gratis.

## Límites de inferencia

El registro estático no prueba por sí solo valores de diseño, respuesta de
red, animaciones ni todos los casos de colisión. Cada relación se valida en
la simulación propia con pruebas deterministas y playtest; no se afirma que
la movilidad sea idéntica hasta completar esas mediciones.
