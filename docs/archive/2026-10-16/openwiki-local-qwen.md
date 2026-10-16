# OpenWiki local con Qwen y llama.cpp

## Estado

OpenWiki puede usar el servidor OpenAI-compatible de llama.cpp sin consumir la
cuota de OpenAI. El modelo local se encuentra en
`C:\Users\Pedro José\Documents\Codex\local-ai\Qwen35-9B-Uncensored`.

El launcher habitual de chat mantiene 4096 tokens. Para OpenWiki se usa el
launcher dedicado `tools/start-qwen-openwiki.cmd`, con 40000 tokens y un único
slot para reducir el consumo de memoria KV. El GGUF declara un máximo nativo
de 262144 tokens. 40000 es una prueba deliberadamente amplia; puede superar
la memoria disponible de la RTX 5050 aunque el modelo admita ese contexto.

## Ejecución

1. Ejecuta `tools/start-qwen-openwiki.cmd` y deja abierta esa ventana. El
   `.cmd` delega en `start-qwen-openwiki.ps1` para resolver correctamente la
   ruta de Windows aunque el nombre de usuario contenga caracteres Unicode.
2. En otra PowerShell, desde la raíz del proyecto, ejecuta:

   ```powershell
   .\tools\start-openwiki-local-qwen.ps1 -Mode init
   ```

   Para una wiki ya creada, usa `-Mode update`.

El script descubre el identificador real en `/v1/models`, fuerza Chat
Completions, limita la concurrencia a una página y no hereda claves de OpenAI.

## Diagnóstico

- `No se puede contactar...`: el servidor Qwen no está iniciado o el puerto
  8080 está ocupado.
- Error de memoria CUDA: vuelve a ejecutar con
  `powershell -ExecutionPolicy Bypass -File .\tools\start-qwen-openwiki.ps1 -ContextSize 16384`;
  si todavía falla, reduce el alcance en `.openwikiignore` o trabaja por lotes.
- Truncamientos: reduce el alcance de OpenWiki mediante `.openwikiignore` o
  genera páginas por lotes; no aumentes la concurrencia.
- El modelo local es adecuado para documentación compacta y actualizaciones;
  las decisiones arquitectónicas críticas deben revisarse contra el código y
  las pruebas.
