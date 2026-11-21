# Reconocimiento del iPhone instalado · 22/11/2026

## Evidencia

Lectura autenticada y sin modificaciones de los últimos informes de producción. Siete ensayos identifican `runtime: native_ios`, web/instalador **2026.11.251**, con 80 entradas: 66 avances automáticos, 12 avances manuales y dos reintentos. Son transcripciones y eventos del servicio, sin audio guardado. Un comienzo ausente no permite saber si se omitió al hablar o al transcribir.

Se reproduce un bloqueo entre el cálculo de coincidencia y el avance: varias frases cumplen `fluent_final`, `short_flexible` o `replica_closure`, pero su hipótesis sigue siendo provisional y su final difiere de las cinco palabras literales del guion. El modo continuo del SDK iOS puede conservar resultados provisionales hasta detener la escucha. Esperar ese cierre antes de aceptar crea una espera circular.

También hay dos copias completas de «No, pero» al final de una hipótesis contaminada con la réplica anterior. La recuperación existente estaba limitada a resultados finales. Otra réplica larga omite el preámbulo independiente «No, pero espera.»; contar ese «No» como negación de la oración siguiente penaliza su propio «no te encontraba».

## Corrección web 2026.11.253

- Sólo en el iPhone instalado, una coincidencia flexible ya aceptada puede usar el resultado provisional cuando conserva las dos últimas palabras de contenido, en orden y al final, al menos 80 % del final de cinco palabras, cobertura/orden de 60 % y precisión de 75 %. Rechaza una discrepancia de negación y un cierre que aparece antes en el guion. Conserva la breve estabilización de 120 ms; no usa un silencio para avanzar.
- Sólo en ese recorrido, dos copias consecutivas exactas de la réplica completa al final de una hipótesis provisional pueden recuperar el último intento. No se selecciona un sufijo arbitrario, no se admite una sola copia ni una negación contradictoria en el prefijo.
- El catálogo de equivalencias admite omitir «No, pero espera.» únicamente como oración independiente inicial de una réplica cuyo resto contiene al menos ocho palabras de contenido y cuya transcripción empieza por las dos primeras palabras de contenido de ese resto. Conserva las negaciones del resto; el «No» del preámbulo no puede ocultar una negación perdida en la oración. No elimina «No pero, espera» ni «espera a…» en una oración. Este caso usa las mismas reglas de coincidencia para todos los motores.
- «Repetir réplica» queda disponible cuando el avance está realmente bloqueado, aunque el cálculo de puntuación ya devuelva una razón de aceptación. El informe mantiene el texto crudo y, si se recupera una repetición, el intento evaluado por separado.

No cambia el umbral general de 86 %, el modo continuo de las réplicas, la captura, los motores, sus idiomas/contexto, las pausas, los comandos corregidos en 252 ni el cierre real antes de TTS. No modifica guiones, materiales o almacenamiento. El IPA sigue siendo **251/build 6** y Android conserva su código 8.

## Verificación

Las regresiones fallaban antes del cambio. La reproducción de los mismos 80 textos provisionales pasa de 66 a 73 aceptaciones, con siete intervenciones recuperadas y ningún avance anterior perdido. Es un resultado sobre textos guardados, no una tasa acústica medida ni la garantía de que los siete casos se pronunciaron literalmente.

452 pruebas, lint, TypeScript y exportación web correctos. El ensayo aislado en iPhone 13, ancho de 320 px y Android usa puente/controlador reales con captura, ASR y TTS simulados. Comprueba las coincidencias flexibles, repeticiones, texto crudo del informe, negaciones y finales incompletos, comandos «ensayo»/«adelante», pausa de 14 s, resultado tardío al salir y cero solapamientos/desbordamientos. APIs interceptadas en memoria, sin escribir informes en producción. Comprobar la publicación y el bundle de producción antes de anunciar la entrega.

Permanecen casos sin suficientes palabras o con diferencias importantes —por ejemplo, «Sonny» sin «Ey» y «Pero espera» sin «No»— que no se fuerzan a válidos. La prueba física de la versión nueva corresponde al teléfono del usuario; no se ha contratado ni añadido un servicio de transcripción.

## Referencias primarias

- [SDK expo-speech-recognition: resultados finales y modo continuo en iOS](https://github.com/jamsch/expo-speech-recognition/blob/main/README.md).
- [Apple: vocabulario contextual breve](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/contextualstrings). El contexto no sustituye una transcripción ni garantiza su precisión.
