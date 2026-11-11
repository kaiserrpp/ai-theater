# AI-Theatre

## Canciones de audición

En **Canciones → Audiciones**, **+ Subir canción de audición** abre directamente la carga. Si no hay acceso de administración recordado, solicita la clave existente. También está disponible en **⋯ → Materiales y gestión → Subir canción de audición**.

1. Elige un número musical o escribe el nombre de uno nuevo. Se puede crear sin vincularlo al guion, aunque la obra ya tenga texto.
2. Pon nombre al fragmento y selecciona los personajes que cantan. Puedes añadir personajes que aún no estén en el guion.
3. Elige los archivos ya recortados de **Con voz** y/o **Karaoke**. Admite audios y vídeos; de los vídeos se extrae el sonido al guardar. Puedes guardar primero los datos o una sola versión y completarlos después. La letra del fragmento es opcional.
4. Pulsa **Guardar audición** en la barra inferior, que permanece visible mientras revisas el formulario. La subida muestra el progreso y conserva los archivos ya guardados si falla una versión; se puede reintentar desde el mismo formulario.

Cada tarjeta representa un fragmento y ofrece sus versiones Con voz y Karaoke. Un número admite varios fragmentos con personajes, audios y letras independientes. El reproductor conserva repetición, velocidad, posición y letra; la pestaña **Obra** mantiene los audios completos. **Mis personajes** filtra los fragmentos y recuerda la selección por obra en el dispositivo.

En iPhone, usa **Explorar** para audios guardados en Archivos y **Fototeca** para vídeos. El formulario indica que un vídeo está pendiente de extraer y muestra por separado la subida y la extracción. Si falla la conversión se puede reintentar sin subir otra vez el vídeo durante esa edición; si falla el registro posterior, conserva el MP3 ya extraído. Un vídeo sin pista de sonido muestra un error específico y conserva los materiales anteriores. La app no controla la preparación que hace Fotos antes de entregar el archivo; si se queda esperando, se puede guardar el vídeo en Archivos y elegirlo desde Explorar.

La carga muestra un foco animado en la zona de acciones: azul durante la subida, ámbar al extraer el sonido y verde al guardar. El círculo se llena y aumenta de intensidad con el porcentaje real de subida. La conversión y el guardado indican actividad sin inventar un porcentaje. También se usa en la gestión de audios de la obra y respeta la preferencia de movimiento reducido del dispositivo.

**Reproducir grupo** ofrece acciones explícitas para **Todas**, **Vocal guide** y **Karaoke**, tanto en Obra como en Audiciones. En Audiciones se respetan los personajes y la búsqueda seleccionados. Los grupos avanzan por todos sus audios y vuelven al principio por defecto. Tocar una canción concreta escucha solo esa canción; anterior y siguiente permiten moverse por su grupo sin activar el avance automático. **Repetir cola** puede desactivarse para terminar el grupo al llegar al final; **Repetir canción** mantiene solo el audio actual en bucle y puede desactivarse para escucharlo una vez. Pausar y reanudar conserva la posición y la cola, que también continúa desde el minirreproductor de Inicio. Ambos reproductores tienen anterior y siguiente y reutilizan el mismo elemento de audio entre canciones.

La velocidad para practicar va de **0,70× a 1×**, en pasos de **0,05** y conservando el tono. El deslizador permite ajustar un rap y el botón **1×** recupera la velocidad normal. El ajuste permanece al cambiar de canción, usar anterior/siguiente, pausar o reanudar.

Con gestión activa, el lápiz de cada fragmento permite cambiar personajes, letra, número o archivos y eliminar el fragmento. Los cambios y audios usan una revisión para rechazar ediciones antiguas. Se conservan la canción completa y los demás fragmentos. Los números que aún tengan fragmentos asociados no se pueden eliminar hasta mover o quitar esos fragmentos.

El manifiesto compartido pasa a versión 6 con una colección `musicalAuditions`; las obras antiguas reciben una colección vacía. Republicar desde un cliente anterior conserva los fragmentos y los números a los que pertenecen. La carga usa la infraestructura de audio existente y requiere acceso de gestión; la escucha sigue siendo pública para quien abra la obra.

## Acceso de administración

Al introducir correctamente la clave puedes dejar activado **Recordar acceso en este dispositivo**. La app recuperará la autorización al abrirse de nuevo durante 90 días, también para canciones, audiciones y gestión de obras. Si lo desactivas se crea una sesión de navegador limitada a ocho horas. No hay cuentas de usuario ni se guarda la contraseña en almacenamiento local: el servidor entrega una cookie firmada, `HttpOnly`, `Secure` en producción y `SameSite=Strict`, vinculada al dominio y al entorno. El servidor verifica cada operación de gestión; los permisos nunca dependen de una bandera del navegador.

**Cerrar sesión de administrador** elimina la autorización guardada de ese navegador. Cambiar la clave de gestión invalida las autorizaciones anteriores. Cada dispositivo o navegador requiere su primera validación. La biometría no es necesaria para este modo de acceso recordado.

## Inicio y ensayo

En **⋯ → Fondo y apariencia** puedes elegir una imagen JPG, PNG o WebP para la obra abierta, cambiarla o restaurar su fondo original. Desde la **2026.11.210**, la imagen y su paleta se guardan con la obra compartida y están disponibles para todos sus dispositivos. Ver el fondo es público; cambiarlo o restaurarlo requiere el acceso de administración, que también se puede activar desde este panel. Al abrir la obra, volver a la app y cada 30 segundos mientras está visible se recupera su apariencia compartida. Cambiar de obra recupera su propio fondo.

La imagen que ya estaba guardada en un dispositivo se comparte automáticamente al abrir esa obra con acceso de administración, si todavía no tiene un fondo compartido configurado. Una retirada o cambio posterior tiene prioridad sobre las copias locales antiguas. Las obras locales conservan su apariencia en el dispositivo y la migran al publicarlas. Los errores conservan el fondo anterior y permiten reintentar. Republicar el guion conserva el fondo del grupo, incluso desde un cliente anterior.

La app obtiene los tonos de menús, tarjetas, textos y botones de la imagen y mantiene el contraste incluso en zonas muy claras u oscuras. En web se admiten originales de hasta 20 MB y se reducen antes de subirlos; la imagen preparada puede ocupar hasta 3 MB. En la app nativa se admiten archivos de hasta 3 MB para compartir. Las imágenes se guardan en Vercel Blob dentro del entorno y la obra correspondientes; el manifiesto conserva su URL, los colores y la revisión. Las actualizaciones comprueban su revisión y recuperan el fondo actual cuando otro dispositivo lo ha cambiado.

La última obra abierta correctamente se recuerda como predeterminada en este dispositivo. Al volver a entrar se recupera automáticamente, junto con sus personajes y ajustes guardados. Puedes elegir otra en **⋯ → Cambiar obra**. Un enlace compartido abre la obra de ese enlace y pasa a ser la nueva predeterminada si se carga correctamente. Si la obra no se puede abrir, el selector sigue disponible para reintentar o cambiarla.

**Inicio** da acceso a **Ensayar escenas**, **Escuchar y practicar** y al último ensayo pendiente. La navegación inferior mantiene **Inicio / Ensayar / Canciones**. En Ensayar puedes alternar **Audiciones / Obra**, elegir tus personajes y practicar tus escenas o todas.

La cabecera muestra siempre la versión cargada junto a **AI · THEATRE** en Inicio, Ensayar y Canciones, incluso mientras se carga una obra. Se toma de la misma versión del paquete que usa cada publicación. También sigue disponible en **⋯ → Más opciones**.

Las operaciones de importación, edición, publicación y cambio de obra están en **⋯ → Materiales y gestión** y **⋯ → Cambiar obra**. Escuchar y ensayar no requieren acceso de gestión. La biblioteca musical separa los audios con voz y karaoke, con reproducción, búsqueda de posición, repetición, velocidad y letra cuando está disponible; al cambiar de pestaña conserva un minirreproductor.

El modo inteligente es la opción inicial en navegadores con reconocimiento. Una elección expresa de manual o silencio se conserva. **⋯ → Micrófono y voz**, también accesible desde el botón del micro durante el ensayo, permite cambiarlo. Las pruebas se completan una sola vez mientras la app está abierta: primero se comprueba el altavoz y después, en los modos con micrófono, se miden el ruido de fondo y la voz; en manual se confirma únicamente el altavoz. Los ensayos siguientes reutilizan las comprobaciones y la calibración, también al cambiar de obra o audición. Se conservan exclusivamente en memoria: cerrar o recargar la app inicia una nueva sesión. **Micrófono y voz → Repetir pruebas** permite volver a realizarlas expresamente, sin perder la posición del ensayo.

La transcripción se muestra por defecto. **Mostrar transcripción** recuerda una desactivación expresa en este dispositivo; ocultarla no detiene la escucha ni la comprobación de palabras. Los detalles de coincidencia e informes quedan dentro de las opciones del micro. El ensayo ofrece controles inferiores de anterior, pausa/reanudar y siguiente.

Desde la **2026.11.208**, en modo Inteligente, la flecha inferior **Siguiente línea** también registra la réplica del actor en el informe como avance manual, igual que el botón de los detalles. Guarda el texto esperado, lo transcrito y la coincidencia, incluso si no se ha reconocido ninguna palabra. Saltar una réplica de otro personaje o usar el modo Manual no añade resultados al informe del reconocimiento.

Desde la **2026.11.209**, la comparación admite las confusiones fonéticas en inglés observadas en los informes: **Really → riley/willy**, **Sure → sur**, las transcripciones de **My English is getting much better** y las de **Puerto Rican English**. Estas correcciones solo se aplican al comparar con la frase inglesa correspondiente del guion; conservan la transcripción original en el informe. No cambian los umbrales ni el motor de reconocimiento. Las frases vacías, las confusiones demasiado alejadas y los fragmentos insuficientes siguen sin aceptarse.

Al llegar a un cambio de escena, la app anuncia **Siguiente escena: [título]** y deja el título visible hasta que digas **adelante** o pulses **Siguiente escena**. Terminar el anuncio, guardar silencio o finalizar una canción no inicia la escena. La orden se escucha después del anuncio en los modos con micrófono y reconocimiento disponible; en manual se usa el botón.

Al empezar se reproduce la prueba de voz con el micrófono cerrado, sin activar a la vez el reproductor de canciones. Tras confirmar **Sí, la oigo. Continuar**, **Calibrar micrófono** activa un reproductor de pitido independiente, mide el ruido de fondo y libera por completo la captura. Las instrucciones y el pitido suenan con el micro cerrado; después se abre una captura nueva para escuchar la frase. Se esperan hasta diez segundos a que el usuario empiece a hablar y solo entonces se mide su voz, en lugar de evaluar los primeros 2,2 segundos desde el pitido. Esto se aplica también a las audiciones sin canciones. Los fallos de reproducción se muestran y permiten reintentar.

Si hay sonido en las canciones pero fallan la voz o el pitido, abre `/prueba-audio.html` en Safari con el ensayo pausado. Ofrece pruebas independientes de voz, pitido y nivel del micrófono, además de un pitido generado como comparación. Cada salida permite indicar si realmente se ha oído: los eventos del navegador no demuestran que el altavoz haya sonado. La captura se detiene tras diez segundos, al cambiar de prueba o al ocultar la página. El informe incluye los resultados y la versión de iOS que se introduzca manualmente; no se envía ni guarda una grabación.

## Audiciones de escenas

Cada obra compartida puede contener mini-guiones de audición independientes del guion completo.

1. Abre una obra en **⋯ → Cambiar obra**. Para crearla sin guion usa **Crear o importar una obra**; el guion completo es opcional.
2. Entra en **⋯ → Materiales y gestión → Mini-guiones de audición** y activa **Administrar materiales** con la clave existente.
3. Pulsa **Importar mini-guion PDF**.
4. Revisa el título, los personajes, el orden, las réplicas y las acotaciones. Puedes corregir un personaje en todo el mini-guion, añadir réplicas o escribir una escena a mano.
5. Guarda. Para practicar vuelve a Inicio y entra en **Ensayar → Audiciones**, elige el mini-guion y tus personajes. **Mis escenas** y **Todas** conservan el progreso por separado.

Durante la revisión, **Guardar mini-guion** y **Cancelar revisión** permanecen en una barra inferior fuera del contenido que se desplaza. Los errores y la confirmación de descarte también aparecen en esa barra. El texto completo de un mini-guion guardado se abre únicamente al pulsar **Ver texto del mini-guion**.

En el primer avance inteligente, después de calibrar, **Comprobar escucha** inicia el reconocimiento. El medidor de calibración libera su captura antes de abrir ese servicio. La app pide decir **prueba de micro** y muestra las palabras recibidas: abrir la captura o confirmar que se oye el altavoz no basta para dar por comprobada la transcripción. No se reproduce una prueba de voz sobre el reconocedor abierto. Los siguientes ensayos reutilizan las comprobaciones de la sesión y vuelven a abrir la escucha sin repetir la calibración.

Desde la **2026.11.206**, el modo Inteligente de iOS 27 usa reconocimiento local para los guiones del actor mayoritariamente en español. La primera preparación descarga unos **40 MB**, con un máximo de dos minutos; el modelo se conserva cargado entre turnos y su biblioteca almacena los archivos en el navegador. El audio de este reconocimiento se procesa en el dispositivo. Se comparan las palabras con el guion mediante el algoritmo de coincidencia, con un umbral principal del **86 %** y sus reglas flexibles existentes. Desde la **2026.11.207** se elimina la condición adicional de la 206 que obligaba a decir juntas las dos últimas palabras. Se aceptan variaciones, omisiones y cambios en el final cuando tienen suficiente coincidencia. Una pausa o un resultado final del reconocedor no sustituyen esa evaluación; se acumulan las palabras anteriores sin intercalar **Te escucho** por cada pausa.

Al completar la réplica, la app desconecta su captura y detiene sus pistas directamente; solicita la voz sin esperar al cierre del servicio de reconocimiento de Safari, que ya no interviene en este recorrido. El modelo local permanece preparado para la siguiente escucha. No se mantiene el audio del actor entrando en el reconocedor durante la voz de la app. La prueba de navegador con el modelo real y una grabación en español ha comprobado el paso a la abuela y una pausa de dos segundos antes de «malo», sin usar `SpeechRecognition` nativo. Esta prueba no sustituye la comprobación de precisión, memoria y tiempos en un iPhone real. Los archivos del modelo y su licencia están en `public/asr/`.

Los guiones mayoritariamente en inglés y los otros dispositivos conservan el reconocimiento del navegador. En ese recorrido de Safari iOS 27 se usan escuchas de una sola frase y se espera a su fin natural de entrada antes de reproducir las réplicas. Se evita cortar cada frase con `abort()` o hablar mientras el reconocedor sigue aceptando entrada. Cuando se reanuda la misma réplica tras una pausa sin otra voz de la app entre medias, se oye **Te escucho** antes de abrir la siguiente escucha; las palabras anteriores de la réplica se conservan. Si Safari abre la captura pero no entrega palabras durante veinte segundos, aparece una acción de reintento. Los anuncios de escena, la nueva escucha y la salida conservan la espera al cierre completo del servicio, con un plazo máximo de doce segundos.

El panel de tu turno muestra si el micrófono está abierto. Los reinicios normales entre turnos se indican dentro de la misma réplica, sin mostrar fugazmente una petición de **Activar micrófono**. Esa acción se reserva para un error real. Los errores distinguen la autorización del micrófono de la disponibilidad del servicio y conservan el código y mensaje originales del navegador para diagnosticar el fallo.

Al bloquear la pantalla o cambiar de app, el ensayo suspende la escucha y el avance de las réplicas. Al volver a Safari recupera la escucha en la misma réplica y conserva las palabras recibidas, sin repetir las pruebas de audio. La interrupción por página oculta no se trata como una denegación de permisos. Se ignoran los eventos tardíos de la captura anterior y se descarta su referencia sin enviarle `abort()`; Safari ya interrumpe la captura al ocultar la página. Si había una pausa manual o una denegación real antes de salir, se respetan. La captura no continúa con Safari en segundo plano.

Una transcripción final con suficiente coincidencia avanza sin una espera adicional. Una coincidencia fuerte también puede aceptarse antes del resultado final, sin exigir un final literal. Para las coincidencias más débiles que dependen del cierre de frase, se conserva la comprobación del cierre completo y único antes de aceptar texto provisional; un cierre incompleto, repetido o con una negación diferente no usa ese atajo. El reconocimiento local y el nativo usan las mismas reglas de aceptación y los mismos umbrales. Se reduce a 60 ms la espera tras la voz de la app, manteniendo la espera expresa en los cambios de escena.

La comparación trata igual las grafías homófonas **porque / por qué / porqué**, sin rebajar el umbral de coincidencia. Al terminar naturalmente una escucha de iOS 27, sus últimas palabras se consolidan aunque el navegador las hubiera dejado como provisionales. Así se vuelve a evaluar la réplica antes del siguiente **Te escucho**: si está completa, avanza y cancela ese reinicio; si faltan palabras, conserva lo reconocido y reanuda la escucha.

La locución del siguiente personaje se prepara mientras termina la entrada y se solicita sin temporizador de arranque. En el recorrido que usa el servicio nativo puede comenzar al recibir **`audioend`**, que confirma que la captura ha terminado, sin añadir la espera al cierre completo del servicio. Si el navegador no emite antes esa señal, se conserva la alternativa de esperar a `end`. Un resultado final, `speechend`, texto provisional o silencio no prueban por sí solos que Safari haya soltado el micro: su [captura nativa](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechRecognitionCaptureSourceImpl.cpp) puede seguir viva y generar un error al silenciarse. No se fuerza su cierre para recortar esa espera. El recorrido local en español evita este servicio.

Cuando se usa el servicio nativo, no se descarta su referencia ni se abre el siguiente reconocimiento antes de su `end`. Si una réplica de la app es tan corta que acaba antes del servicio anterior, el siguiente turno del actor espera ese cierre para no invitarle a hablar sin escucha. Una voz ya reproducida durante ese tramo también cuenta como preparación de la próxima escucha: no se intercala otro **Te escucho**. Los finales normales y las limpiezas de una voz ya terminada no vuelven a cancelar el motor de voz; saltos, pausas, errores y colas pendientes sí conservan su cancelación. **Ver detalles de reconocimiento** muestra **Fin de entrada**, la señal que lo permitió y **Inicio de voz**. Son eventos del navegador; no prueban por sí solos la latencia acústica.

**Micrófono y voz → Al terminar de hablar** es un modo alternativo con detector de silencio de 650 ms, sin comparación de palabras. Libera la captura antes de cada locución y abre otra para el siguiente turno; una pista que Safari haya dejado silenciada no se reutiliza. No sustituye al modo Inteligente para ensayar con pausas: el usuario ha pedido expresamente conservar la comprobación del texto.

Si iOS devuelve `service-not-allowed` con `Speech recognition service permission check has failed`, la app muestra una guía específica: **Ajustes → Privacidad y seguridad → Reconocimiento de voz**, con la entrada del navegador que se debe activar (Safari con la brújula azul). **Ya lo he activado, comprobar** vuelve a solicitar el servicio sin cambiar la escena ni el personaje. El permiso inicial se pide mediante el inicio normal del reconocimiento; una denegación guardada requiere el cambio en Ajustes. La web no dispone de un enlace documentado y fiable a ese panel concreto, por lo que no utiliza esquemas privados de iOS. El código y mensaje técnicos quedan disponibles en **Ver detalle técnico**.

Quien abra el enlace de la obra puede leer y ensayar sus escenas sin clave. La creación, modificación, eliminación y publicación de materiales requieren acceso de administración. El servidor utiliza `SONG_ADMIN_PASSWORD` y `BLOB_READ_WRITE_TOKEN`; este último también protege la firma de las sesiones. Opcionalmente se puede definir `ADMIN_SESSION_SECRET` para usar un secreto de firma independiente. No hace falta configurar servicios nuevos.

Las elecciones y el progreso de cada mini-guion se recuerdan en el dispositivo. Si cambia el texto, el progreso se reinicia y se conservan los personajes elegidos que sigan participando. Las cuentas y la sincronización entre dispositivos quedan para otra fase.

La importación web/PWA usa el lector de PDF existente y requiere texto extraíble; no hace OCR. En plataformas nativas se reutiliza el analizador de Gemini existente. Los fragmentos musicales con voz y karaoke se gestionan desde Canciones → Audiciones.

El lector reconoce tanto `PERSONAJE: réplica` como nombres en mayúsculas en una línea propia, con la réplica debajo. También reconoce encabezados de escenas formados por listas de personajes y acotaciones junto al nombre, conservando la continuidad entre páginas.

Las obras antiguas se cargan sin migración manual. Republicar la obra conserva sus escenas de audición y los números musicales pendientes de vincular.

## Verificación

```sh
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform web
```

Las pruebas usan almacenamiento aislado en memoria y no escriben en Vercel Blob.

## Desarrollo con Expo

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
