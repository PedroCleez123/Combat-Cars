# M2-01 — calibración de vuelo por ejes

Fecha: 11 de octubre de 2026  
Estado: **completado; los tres ejes de vuelo están calibrados contra R2**

## Objetivo

La conducción terrestre queda congelada en su línea base. Esta historia mide
la experiencia que el usuario considera prioritaria: el coche debe responder a
pitch, yaw y roll sin volverse impredecible, y al soltar un eje debe frenar de
forma legible.

## Medición

El manifiesto de movilidad añade `air-pitch`, `air-yaw` y `air-roll`, cada uno
con 36 ticks de entrada positiva, 36 neutros, 36 negativos y 36 neutros. Se
ejecutan a 120 Hz sin suelo ni paredes para separar el control de actitud de
los contactos. `air-axes` conserva además la maniobra combinada.

La captura externa R2 usa RocketSim oficial en el commit fijado de R1, con el
coche a altura segura en `THE_VOID`. La captura convierte la velocidad angular
mundial de Bullet a ejes locales y añade error angular de los vectores delante
y arriba. No se comparan componentes mundiales cuando el coche ya ha girado.

## Puerta de entrada

Antes de tocar constantes se exige:

1. Las tres trazas aisladas tienen el mismo flanco de entrada y 144 muestras.
2. La tasa activa y la liberación conservan el signo de cada control.
3. El error angular medio de la maniobra combinada baja de la línea base
   registrada, sin crear picos de más de 15° por tick.
4. La misma entrada agrupada en paquetes de 50 ms mantiene la traza.

La primera corrección solo podrá cambiar un eje (`airPitchTorque` y su damping,
`airYawTorque` y su damping, o `airRollTorque` y su damping). Nitro, dodge,
saltos y cámara quedan fuera hasta cerrar estos tres ejes.

## M2-02 — retención común al soltar (descartada)

La comparación aislada de M2-01 mostró que la tasa activa de Arsenal es del
mismo orden, pero el freno al soltar era demasiado alto: en 0,3 s conservaba
aproximadamente `2–4 %` de la tasa inicial, frente a `23–56 %` en la referencia.
Se probó `TUNING.airReleaseDampingScale = 0,33`, aplicado a pitch, yaw y roll
solo cuando el eje deja de estar pulsado. La premisa resultó incorrecta: la
referencia conserva cantidades distintas por eje y una escala común dejó
demasiado momento residual tras la maniobra combinada. Durante la fase de
nitro, la velocidad vertical empeoró en lugar de mejorar porque la actitud
seguía cambiando; la regresión autoritativa que exige que el nitro con nariz
arriba aumente esa velocidad falló. Se revirtió el cambio.

La siguiente historia ajustará **un único eje** con su par y damping de
liberación, conservará la comprobación de nitro en una actitud conocida y
comparará tanto tasa local como orientación. No se aceptará un ajuste solo por
parecerse en una componente: debe pasar la regresión completa, 144 muestras y
la envolvente.

## M2-03 — pitch de vuelo (aceptada)

La traza R2 corregida a la convención local de Arsenal registra para pitch
`3,739 rad/s` tras 36 ticks de entrada y `1,561 rad/s` después de 36 ticks
neutros. El candidato cambia solo `airPitchTorque` a `12,46` y
`airPitchDamping` a `2,8`; yaw, roll, dodge, nitro y suelo conservan sus
constantes. La regresión completa y la envolvente pasan con 94 pruebas. La
comparación de las 144 muestras queda en error de forma `0,0066`, orientación
media `0,61°` y máxima `1,53°`; se conserva el cambio.

## M2-04 — yaw de vuelo (aceptada)

La traza aislada registra `2,732 rad/s` tras 36 ticks de entrada y `1,530`
después de 36 ticks neutros. El candidato cambia solo `airYawTorque` a `9,11`
y `airYawDamping` a `1,9`; pitch ya aceptado, roll, dodge, nitro y suelo no
cambian. La puerta es la regresión completa, la envolvente y las 144 muestras
de yaw, incluyendo orientación alrededor del eje vertical. La regresión
completa y la envolvente pasan con 94 pruebas. La comparación aislada queda en
error de forma `0,0020`, orientación media `0,13°` y máxima `0,31°`; se
conserva el cambio.

## M2-05 — roll de vuelo (aceptada)

Roll aún alcanzaba el límite de `5,5 rad/s` casi de inmediato y al soltar se
detenía antes de tiempo. La referencia progresa de `0,320` a `3,095` y
`4,993 rad/s` en los ticks 1, 12 y 24, llega al límite más tarde y conserva
`3,372 rad/s` doce ticks después de soltar. El candidato cambia solo
`airRollTorque` a `38,35` y `airRollDamping` a `4,8`, manteniendo el límite
vectorial común de `5,5 rad/s`. La puerta es la regresión completa, la
envolvente, 144 muestras y la maniobra combinada. El resultado pasa 94 pruebas
y la envolvente. Roll aislado queda en `0,0003` de error de forma y `0,27°`
de orientación media (`0,43°` máxima). Con los tres ejes, `air-axes` queda en
`0,0066` / `0,0020` / `0,0010` para pitch/yaw/roll y en `0,72°` de orientación
media (`1,20°` máxima). Se conservan los cambios.

## Incidencia de medición corregida

El comparador calculaba vectores a partir de quaternions que las capturas
serializan con cuatro decimales. No los normalizaba antes del producto escalar,
por lo que una comparación de una captura consigo misma podía informar cerca
de un grado de diferencia. `rotateQuaternion()` normaliza el vector resultante;
la prueba de identidad volvió a ser exacta. Es una corrección de la medición,
no de la física.

## Continuación

El bloque M3 de saltos y dodge se cerró en el informe separado
[`m3-air-actions-calibration.md`](m3-air-actions-calibration.md). Los tres
ejes aprobados aquí se mantienen como contrato de regresión: el dodge solo
añade el torque de flip durante su ventana comprometida y no sustituye el
control aéreo normal después de expirar.
