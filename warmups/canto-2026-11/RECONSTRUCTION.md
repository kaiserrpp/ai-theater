# Reconstrucción del calentamiento

Referencia local: `WhatsApp Video 2026-11-15 at 22.30.09.mp4`, 680,47 s.
SHA256: `92e314e9ef1b3666d4f00ff2ca909b9b4e7328c095d5494dbc026d9cbef3f563`.
El vídeo original y las transcripciones auxiliares permanecen locales. No se publica la voz original.

El usuario ha valorado favorablemente el piloto M y confirma «brr» como vibración de labios y la secuencia «mi, me, ma, me, ma, e, i, o, u». Las palabras de Whisper Small/Medium se contrastan entre sí y con los ataques/alturas del audio; contienen alucinaciones durante el canto que se han descartado (por ejemplo, supuestas despedidas y subtítulos).

| Orden | Referencia | Reconstrucción | Contraste musical representativo |
| --- | --- | --- | --- |
| 1 | 0:00–1:13,62 | Brr, cinco notas mayores y regreso | 0:06–0:08 y 0:10–0:12; raíz inicial estimada Do♯3 |
| 2 | 1:13,62–2:17,50 | M, cinco notas mayores y regreso; piloto conservado | 1:18–1:20; Re3, Mi3, Fa♯3, Sol3, La3 y regreso |
| 3 | 2:17,50–3:49,62 | Na, tres notas mayores y regreso | 2:22,71–2:24,21 y 2:25,89–2:27,48; Re–Mi–Fa♯–Mi–Re |
| 4 | 3:49,62–5:14,16 | Wa, salto de quinta y regreso | 4:01,48–4:03,65; Re–La–Re; desplazamiento por semitonos visible en 4:04–4:13 |
| 5 | 5:14,16–6:39,08 | Wa, cinco notas descendentes | 5:39,42–5:40,36; Si♭–La♭–Sol–Fa–Mi♭; siguiente tono en 5:42–5:43 |
| 6 | 6:39,08–8:32,32 | Wa, arpegio mayor 1–3–5–3–1 | 6:45,93–6:47,77; Mi–Sol♯–Si–Sol♯–Mi; siguiente Fa mayor en 6:50–6:52 |
| 7 | 8:32,32–10:19,30 | Secuencia confirmada mi/me/ma/me/ma/e/i/o/u; ascenso, reiteración arriba y descenso | 8:46,51–8:50,59; Mi–Fa♯–Sol♯–La–Si, reiteraciones y regreso. El reparto de sílabas y el número de ataques superiores son estimados |
| 8 | 10:19,30–11:20,47 | Wa y cambio aproximado a hueh/ueh; arpegio descendente 5–3–1 | 10:30,63–10:32,21: Mi–Do♯–La; 10:34,94–10:36,47: Fa–Re–Si♭. Cambio de sonido en 10:50–11:01 |

Las octavas son especialmente ambiguas por el refuerzo de armónicos y la superposición de voz/piano. Las raíces anteriores son referencias de la reconstrucción, no un diagnóstico de tesitura ni una partitura confirmada. `source.json` contiene los patrones, duraciones, repeticiones y progresiones normalizados que se renderizan. No se afirma una copia exacta de cada acorde, repetición o pausa del original. Las dudas permanecen visibles en cada ejercicio.

Los tempos se regularizan a 124, 122, 160, 114, 124, 114, 120 y 114 negras/min respectivamente. El tercer ejercicio utiliza negras para cada nota; por ello su cifra no es directamente comparable con los ejercicios de corcheas. Cada patrón tiene una entrada y un cierre explícitos. Las progresiones por semitonos son reconstrucciones regulares y sus extremos/repeticiones no deben confundirse con una transcripción musical confirmada. Los consejos con referencia se reproducen entre patrones completos, sin tapar las notas que canta el usuario. Si el rango omite el paso original, el consejo se conserva junto al siguiente paso disponible.

La sesión completa conserva este orden y se detiene después de cada ejercicio, salvo el último. El descanso no tiene temporizador: sólo un comando completo «siguiente»/«adelante» o el botón inicia el próximo. El micrófono se abre durante el descanso y se espera su cierre real antes del siguiente audio. No se escucha mientras suenan las explicaciones o el piano. El reconocimiento usa el adaptador existente del dispositivo; Safari reciente puede reutilizar Vosk local gratuito. El botón permite continuar si la escucha no está disponible.

Los ajustes personales se mantienen con las mismas claves e identificador del piloto M. Cada ejercicio aplica su propia nota inicial y patrón y limita los recorridos completos al rango elegido. No se cambia la tonalidad de la mezcla del vídeo. Los MP3 se preparan una vez con `scripts/prepare-warmup.py`, Piper español y las muestras de piano acreditadas en el catálogo; no hay llamadas de IA o generación musical al reproducir.

## Guía y preparación automática (web 2026.11.237)

Las locuciones e indicaciones se dirigen al alumno en primera/segunda persona. Las confirmaciones de la conversación y la atribución a la profesora no forman parte de la explicación hablada. Las referencias, la partitura estimada y las dudas permanecen accesibles en «Referencias y detalles musicales». Se han regenerado las ocho explicaciones y ocho consejos, reutilizando los 336 archivos de piano idénticos mediante `--reuse-piano-catalog`.

En Canciones, «Calentar antes de cantar» está activado inicialmente y se puede desactivar. Al iniciar una canción, un grupo, cambiar de canción o reanudar, se prepara el calentamiento si no hay actividad previa o han transcurrido **más de** dos horas. La actividad se obtiene de la reproducción real del audio y del calentamiento completo, sin comprobar ni grabar si el alumno está cantando. El tiempo se actualiza durante la reproducción y al pausar; el calentamiento incompleto y el desbloqueo silencioso del reproductor no cuentan como actividad de canto. El historial y esta preferencia utilizan la clave independiente `@teatro_ia_vocal_practice_v1`, en este dispositivo y para todas sus obras; no se comparten entre alumnos ni se presentan como sincronizados entre dispositivos.

La canción solicitada queda pendiente durante el calentamiento. Al completarlo, o al pulsar «Ir directamente a cantar», se continúa con la misma canción, cola, modo de repetición, velocidad y posición de reanudación. El micrófono se cierra antes de devolver el audio y se reutiliza el mismo elemento multimedia desbloqueado con el toque inicial. Las solicitudes antiguas se cancelan al cambiar de obra, salir o sustituir la selección. El ensayo de escenas y sus reglas no se han modificado.

## Descanso hablado y continuidad (web 2026.11.238)

El campo opcional `rest` es una indicación nueva de la guía virtual para la app, sin atribuirla al vídeo ni inventar una marca de referencia. Se prepara una vez y se reutiliza después de cada ejercicio que tenga otro a continuación. Invita a descansar y beber agua si se desea. Sólo al terminar esa locución se abre la escucha de «siguiente»/«adelante». No hay avance por tiempo o silencio.

Las alturas, duraciones musicales, entradas, cierres, progresiones y rango se conservan. El piano preparado prolonga cada nota hasta el siguiente ataque, con colas solapadas y rampas de ataque/cierre suaves. La salida MP3 se escribe en un archivo seekable para incluir los datos de retardo/relleno del codificador; `pcmFrames`/`pcmSampleRate` permiten comprobar su decodificación sin recortar por estimación.

Antes de reproducir un ejercicio, se cargan sus grabaciones y se decodifica el piano con un contexto sin salida. Cada secuencia de piano entre explicaciones/consejos se ensambla en un WAV local de la misma duración y con todos sus frames, con bordes suavizados 4 ms. Así no se cambia de archivo ni se realiza una descarga entre sus tonalidades. Se mantienen la melodía y los saltos propios de los arpegios; la mejora trata las uniones y la articulación. El reproductor HTML existente sigue gestionando pausa, reanudación y búsqueda. Se reutiliza la preparación para repetir esa selección y se liberan los objetos temporales al sustituirla o salir. No hay síntesis musical ni IA durante la reproducción. Los fragmentos antiguos o incompatibles se pueden reproducir por el camino MP3 bufferizado.
