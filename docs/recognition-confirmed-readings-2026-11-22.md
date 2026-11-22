# Lecturas confirmadas por el actor · 22/11/2026

El usuario confirma que todos sus avances manuales corresponden a réplicas suficientemente buenas. Se toman como ejemplos positivos de reconocimiento, sin interpretar una palabra ausente en el texto como un error al actuar. Los informes guardan transcripciones y eventos, sin audio.

## Evidencia y cambio 2026.11.258

Lectura administrativa de los 25 informes más recientes de producción: 252 entradas de hoy y ayer. Los diez informes de hoy proceden del iPhone instalado, web 255 e instalador 251; contienen 106 entradas. Hay 26 avances manuales: once conservan un final reconocible, catorce no tienen texto y uno conserva únicamente el comienzo de una réplica larga. Los clics repetidos de ese último ensayo son eventos del informe, no catorce réplicas distintas.

Se añaden 31 formas confirmadas para catorce réplicas concretas: nombres y sonidos ingleses, español mezclado con inglés, «nuevas palabras»/«palabras nuevas», la indicación de la sombra, «cristales rotos» y respuestas cortas como «Pero espera». Algunos «no» son preámbulos conversacionales ausentes en estas hipótesis confirmadas; esa diferencia se admite exclusivamente para el par completo confirmado.

Cada equivalencia exige coincidencia de la **réplica completa del guion y de la transcripción completa normalizada**. No se añade un alias global de «sane», «sour», «sin» o «espera», ni una referencia corta que pueda coincidir por similitud con futuros textos. Una negación añadida, una continuación o un final incompleto no seleccionan la equivalencia. Las variaciones de puntuación, acentos, mayúsculas y repeticiones de palabras consecutivas usan la normalización existente.

El texto original del servicio se conserva en `heardText`. El informe distingue la referencia elegida mediante los campos ya existentes. No se modifican los informes guardados, el guion, el umbral general de 86 %, el motor, idioma/contexto, captura, pausas, comandos, cierre antes de TTS ni almacenamiento. Las equivalencias sirven también en la Comparativa y en los demás motores. No requiere generar otro instalador.

## Resultado sobre textos guardados

La reproducción con las reglas anteriores y nuevas usa en ambos casos la política provisional del iPhone y la recuperación de intentos existente, para no atribuir a esta entrega correcciones de 253:

| Textos | Entradas | Antes | Después | Avances manuales recuperados |
| --- | ---: | ---: | ---: | ---: |
| Hoy, iPhone instalado | 106 | 79 | 90 | 11 |
| Ayer, iPhone instalado | 110 | 99 | 109 | 10 |
| Ayer, navegador | 36 | 15 | 28 | 13 |
| Total reciente | 252 | 193 | 227 | 34 |

No se pierde ninguna aceptación anterior en estos informes ni al ampliar la reproducción al archivo local de 118 informes históricos y comparaciones. El archivo incluye muestras de Comparativa; no equivale a 118 ensayos físicos nuevos. Estas cifras miden decisiones sobre textos guardados, no precisión acústica ni el momento exacto en que apareció cada hipótesis durante el ensayo.

Los registros vacíos y el texto detenido en «me rompieron» siguen precisando intervención si vuelven a suceder. También se conservan manuales señales demasiado genéricas como «y», «ni», «mhm» o el inglés cortado en «mac». Esto no cuestiona la lectura del usuario: el texto disponible no permite distinguirla de una captura incompleta o de ruido sin adelantar el turno durante una pausa.

## Verificación

Pruebas de regresión de los ejemplos confirmados, límites por réplica completa, negaciones añadidas, texto adicional, últimas palabras ausentes, silencio, ruido y comandos. Se actualizan dos expectativas anteriores que consideraban incorrectos «Sonny» y «Pero espera», ahora confirmados expresamente por el actor. 465 pruebas, lint, TypeScript y exportación web correctos. QA aislado con puente/controlador reales y ASR/TTS/captura simulados en iPhone 13, ancho de 320 px y Android: cuatro nuevas equivalencias, rechazo de finales incompletos y continuaciones, comandos «ensayo»/«adelante», pausa de 14 segundos, resultado tardío al salir, texto crudo conservado en el informe y cero solapamientos/desbordamientos. Las APIs se interceptan en memoria; no se escriben informes de prueba en producción. Verificar el despliegue y el bundle real antes de anunciar publicación. La simulación del servicio ASR/TTS no acredita acústica de un teléfono físico.
