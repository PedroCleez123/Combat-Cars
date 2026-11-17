# Bridge nativo RocketSim (desarrollo local)

El bridge nativo solo sirve para comparar la ruta local con RocketSim WASM. La
ruta pública no lo descarga ni lo ejecuta: usa el módulo WASM en el host P2P.

## Compilar y probar

Desde un entorno de Visual Studio con CMake/Ninja:

```powershell
cmake -S tools/rocketsim-bridge -B .rocketsim-bridge-build-r20 -G Ninja `
  -DROCKETSIM_SOURCE="C:/ruta/a/rocketsim-r1"
cmake --build .rocketsim-bridge-build-r20 --target rocketsim_bridge
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r20/rocketsim_bridge-r20.exe)
npm run probe:rocketsim-bridge
```

El protocolo JSONL acepta `init`, `tick` y `shutdown`, con hasta seis coches y
los perfiles de arena definidos por las sondas de `package.json`. El bridge no
es una autoridad alternativa para el online ni debe apuntarse a la antigua
carpeta R9.
