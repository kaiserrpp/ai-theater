# Prototipo nativo de AI-Theatre desde Windows

El prototipo conserva la aplicación web publicada, los guiones y materiales compartidos, los ajustes, el algoritmo de Inteligente y los informes. Una app Expo pequeña abre esa misma interfaz y conecta la captura y la voz con las API nativas de iPhone/Android. La web habitual sigue usando sus motores y protecciones actuales.

El reconocedor instalado puede cancelar su captura propia al aceptar una réplica. La app espera la confirmación nativa real antes de reproducir voz o abrir otra entrada; no se traslada esa cancelación al reconocedor de Safari. Las pausas conservan las palabras. Una finalización o un silencio del servicio no decide por sí solo el avance: se siguen aplicando `lineMatching.ts` y sus umbrales existentes.

## Estado y límites de esta entrega

- **2026.11.233, tolerancia contextual compartida:** acepta «hey honey» cuando toca «Ey, Sonny» y «sore»/«so so» cuando toca «Sure». La forma doble se comprueba antes de compactar repeticiones: un solo «so» no vale. No se aplican a otras réplicas, nombres ni negaciones; se conservan el texto reconocido original y los umbrales/plazos existentes, Inteligente y pausas. Es una actualización web que usa la **APK 232 existente**, sin otro instalador ni compilación/coste adicional. Los cuatro informes físicos de web 232 suman 30/30 avances automáticos en Safari/iPhone (USNAVI, español) y 9/12 en Lenovo/APK 232 (BENNY). Los tres manuales son esas confusiones; al reproducir sus 42 transcripciones con el ajuste, 39→42 permiten avanzar. Esto verifica los datos guardados, sin prometer precisión futura ni calidad inglesa del iPhone. Pasaron 363 pruebas, lint, TypeScript y exportación web; recorrido con puente Android/iPhone, voz/ASR/captura simulados, dos escenas, pausa de 14 s e informes interceptados.
- **2026.11.232, mejora de inglés para los prototipos Android/iPhone:** el guion decide el idioma principal de la réplica y aporta nombres/vocabulario breves al reconocedor del sistema. Really/Sure/Ey-Sonny usan inglés, las frases españolas conservan español y las mixtas se identifican aparte. Se mantienen Inteligente, sus umbrales, las pausas y el cierre real de la captura antes de responder. Requiere actualizar el instalador; la web 232 sigue siendo compatible con APK anteriores, que conservan su recorrido previo.
- Android prepara una consulta de modelos en segundo plano al abrir la app, sin consulta/descarga ni decodificador adicional entre réplicas. En Android 14+ se solicita cambio es/en sólo cuando constan ambos modelos instalados; si falta inglés local, la réplica inglesa puede usar el servicio del sistema sin forzar ese modelo. Apple usa el idioma principal y `contextualStrings`; la API SFSpeechRecognizer integrada no ofrece aquí cambio bilingüe simultáneo. Los informes distinguen configuración solicitada y detección recibida, sin fingir que solicitar bilingüe demuestra que el servicio lo aplicó. No se ha contratado una API de pago ni solicitado descargar modelos.
- Verificación 232: **361 pruebas**, lint, TypeScript, exportación web; navegador sobre local y producción con puente/controlador/runtime actuales en Android e iPhone, inglés/mixto/español, pausa de 14 s, fondo, dos escenas, comando final e informes con POST fallido/reintento interceptados. La recuperación de idioma conserva palabras, espera el cierre real y respeta una pausa intencional. Captura, voz y ASR simulados: falta medir la mejora real de inglés en Lenovo. La [validación iOS 232](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre/builds/c3cb15df-2a7a-4a62-a0c6-49569b695e98) terminó correctamente para **simulador**, sin instalación física en iPhone. La [compilación Android 232](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre/builds/030afda6-1fcc-4c34-b2a7-70b9710ca7a6) también terminó correctamente. Archivo EAS inspeccionado: 14 archivos previstos; sus valores/módulos nativos ejecutados y tipos coinciden con la fuente publicada. La corrección posterior de palabras ambiguas sólo se ejecuta en la web y se comprobó que ese selector no está incluido en el bundle nativo del APK. Expo Free final: Android 4/15, iOS 3/15, sin complementos y coste estimado 0.
- **[Descargar APK 2026.11.232](https://expo.dev/artifacts/eas/pV6CuVTdt-KhoV_Dts6LIZj1mU9Dx_YfmrEnN1Hcry8.apk)**. Elegir **Actualizar** conservando datos; al abrir, comprobar la cabecera superior «Prototipo Android · 2026.11.232». El APK real responde HTTP 200 y pesa 84.759.298 bytes; SHA256 `1930dfc61dd9ba87c8ad58c8cf6d4a7ebdac30692032ccacd613a5f562e1f715`. Se inspeccionaron manifiesto (versión 232/código 5), paquete y certificado v2: iguales a los de la 231 salvo versión/código. El bundle contiene la versión nueva, capacidad de contexto, opciones de idioma y metadatos. Copia local: `C:/Users/ruben/Downloads/AI-Theatre-2026.11.232.apk`. [Web 232 publicada](https://ai-theater.vercel.app/?share=d92b33981047); la mejora nativa requiere este instalador.
- Preparados el código de iPhone/Android, el puente con el ensayo existente y el perfil de compilación interna. Proyecto vinculado: [@kaiserpps-team/ai-theatre](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre), identificador público `7f254bd3-5532-490c-8114-a149d7c28132`.
- El instalador y la rapidez/calidad física requieren una compilación firmada y una prueba en los teléfonos. Una exportación JavaScript o un ensayo con eventos simulados no demuestra funcionamiento físico.
- El usuario tiene un iPhone 15 Pro Max, cuenta Expo y una tablet Lenovo **TB370FU con Android 15**, identificada en los informes físicos. No dispone de membresía Apple Developer.
- El reconocimiento utiliza las API del sistema, sin claves de servicios de transcripción de pago. Puede requerir conexión según el servicio, el idioma y los modelos disponibles; esta entrega no promete uso totalmente sin conexión.
- Vosk/Whisper/Comparativa continúan disponibles en la web y en la interfaz reutilizada; su funcionamiento en cada WebView instalada necesita validación independiente. La primera prueba debe seleccionar «Apple · iPhone · reconocimiento nativo» o «Android · reconocimiento nativo».

## Calibración en la tablet Lenovo · 14/11/2026

**Actualización del 15/11, informes de 01:45–02:04 Madrid:** siete sesiones reales identifican APK 231, web 231 y reconocimiento nativo en Lenovo TB370FU/Android 15; el usuario confirma buena velocidad. Tres USNAVI: 45/45 avances automáticos; cuatro BENNY: 12 automáticos y 12 manuales en 24 réplicas. Esto confirma el uso físico del prototipo en ensayo, sin equivaler a transcripción literal perfecta. En las 36 mediciones de USNAVI, cierre de captura medio 111 ms (82–128) y aceptación→evento de voz 387 ms (202–549), sin medir latencia acústica completa. La revisión identifica que todas las réplicas inglesas/mixtas siguen marcadas `es-ES`; se reproduce esa elección en el selector actual. «Ey, sonny» queda vacío 4/4 y «Tengo noticias. My English…» requiere avance manual 4/4; «Really?» y «Sure» avanzan 2/4 cada una, con «reality»/«Sur», no con una transcripción limpia. La prioridad propuesta es idioma por réplica y vocabulario del guion; el [cambio bilingüe de Android](https://developer.android.com/reference/android/speech/RecognizerIntent#EXTRA_ENABLE_LANGUAGE_SWITCH) exige soporte del servicio y modelos descargados. No se ha implementado ni prometido todavía esa mejora ni generado otra APK por esta revisión; se conservan Inteligente, pausas y el motor que el usuario encuentra rápido.

**Diagnóstico recibido a las 20:12 (Madrid):** la tablet es TB370FU con Android 15. Aunque el usuario indica haber instalado la 231, la sesión que envió el informe `intelligent-mwgs8f6d-fbd2b1f0e866` ejecutaba **web 231 dentro de APK 225**, también identificada así en el user agent. Ambos intentos de captura web (processed/unprocessed, 42/22 ms) fallaron con `NotReadableError: Could not start audio source`; no se llegó a usar `native_peak`. Ese informe no valida ni refuta el medidor de la APK 231. El enlace de descarga 231 se ha vuelto a comprobar; hay que actualizar en la propia tablet y distinguir la cabecera nativa «Prototipo Android · 2026.11.231» del número de versión de la web. No repetir las comprobaciones de permisos, Cámara o Bluetooth ni producir otro instalador sin datos de un fallo del nuevo medidor.

La **2026.11.231** añade un medidor nativo Android con `expo-audio ~1.1.1` del SDK 54. En **Inteligente → Android · reconocimiento nativo**, la APK 231/código 4 mide ruido y voz usando MediaRecorder, sin abrir la captura de la WebView. La medición es de **pico dBFS**, no RMS: ambas tomas usan la misma escala, y esos valores no se entregan como RMS a Whisper. Cambiar entre escalas exige sólo la calibración correspondiente; mantiene el altavoz y sus confirmaciones. iPhone, modo de avance por silencio y motores locales siguen por su recorrido anterior. No se cambian el ASR del ensayo, Inteligente, las pausas ni sus umbrales.

Un mismo controlador separa la medición, el reconocimiento y TTS: espera el cierre real y retira callbacks viejos; cancela al navegar o pasar a segundo plano. Cada medición tiene un máximo nativo de 30 s como protección y elimina su archivo de caché al cerrar/cancelar; el puente transmite sólo niveles y los informes no reciben audio ni la ruta del archivo. La web anterior y la APK 228 siguen siendo compatibles, pero **para usar el medidor nativo hay que actualizar el instalador**.

Verificación de código: 350 pruebas, lint, TypeScript, exportación web y ensayo con puente/controlador actuales, grabador/ASR/TTS simulados, reintento tras fallo nativo, diagnóstico fallido/reintento, dos escenas, pausa de 14 s e informes. Ese recorrido también pasó sobre producción, interceptando los envíos. Archivo EAS: doce archivos previstos, sin datos privados. La [compilación Android 231](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre/builds/a2bfa75d-1370-441a-9e9f-a03175f547ac) terminó correctamente, enviada con 2/15 compilaciones Android de Expo Free usadas y sin cargos.

[Descargar APK 2026.11.231](https://expo.dev/artifacts/eas/vCBjePKu_yJtfvJETLfocNVhUH5ICZcuQfyR-UOzuFM.apk). El archivo real responde HTTP 200, pesa 84.754.786 bytes y su SHA256 es `e218311917db471e233a6b1cbc3c73a3318c40598a417fc7430f9e341381e351`. Se inspeccionaron el manifiesto (versión 231, código 4, ambos permisos de audio) y el certificado v2: mismo paquete y certificado que 225/228, apto para elegir **Actualizar** conservando datos. Copia local: `C:/Users/ruben/Downloads/AI-Theatre-2026.11.231.apk`. La web 231 está publicada en [producción](https://ai-theater.vercel.app/?share=d92b33981047).

Se instaló realmente sobre 228 en BlueStacks, sin ADB ni nuevos permisos de privacidad, conservando BENNY/una escena. Se observaron las versiones nativa y web 231. El medidor nativo abrió y pasó la medición de ruido, superando el bloqueo anterior; después la comprobación de voz terminó por señal insuficiente, con nivel 0 %. No se validó una calibración sin voz. La reproducción de un WAV por Windows no permitió confirmar el recorrido acústico al micrófono del emulador. **No está confirmada una calibración completa ni el funcionamiento físico de Lenovo o del ASR.** Esto no permite declarar resuelto el incidente de la tablet. No hace falta Apple Developer ni contratar un servicio para esta APK Android.

La comprobación de la web 230/APK 228 en BlueStacks también quedó detenida al 98 % midiendo ruido, incluso tras detener y reabrir únicamente AI-Theatre. El proceso quedó detenido al acabar para liberar la captura. No se borraron datos, se cambió privacidad ni se reabrió ADB. Esta comprobación no valida Lenovo y no se declara resuelto el incidente físico del usuario.

La **web 2026.11.230** detiene la captura propia antes de esperar el cierre del procesador Web Audio. La comprobación con la APK 228 real en BlueStacks abrió el micro y mostró señal (~1 %), pero quedó detenida midiendo ruido al 99 % antes del pitido. Ese emulador no acredita el comportamiento de Lenovo; se corrige el orden de recursos que podía esperar el cierre con la captura aún abierta, y una regresión exige el track terminado antes de iniciar ese cierre. Se conservan Inteligente, pausas, ASR y la recuperación Android de la 229. Pasaron 336 pruebas, lint, TypeScript y exportación web. Es una actualización web para la APK 228 existente.

El usuario informó después de que **la APK 228 sigue mostrando el mismo aviso**. La falta del permiso era un defecto confirmado del instalador anterior, pero no basta para resolver esta tablet. No repetir la comprobación del permiso ni Cámara, ya hechas; el usuario ha rechazado más tandas de pruebas manuales. No se ha contratado Apple Developer ni es necesario para Android.

La **web 2026.11.229**, compatible con APK 228, intenta una sola apertura Android sin filtros si falla la captura procesada. Si funciona, usa el mismo perfil para ruido y voz; no cambia reconocimiento, Inteligente, umbrales ni pausas. No aplica a permisos denegados ni Safari/iPhone y respeta la cancelación. Si sigue fallando, «Ver detalle técnico» muestra el error y ambas versiones; «Enviar diagnóstico» funciona antes de cualquier escena, sin audio ni puntuaciones ficticias. El servidor limita y normaliza sus campos como parte del informe existente. Pasaron 335 pruebas, lint, TypeScript y exportación web; navegador con reintento automático, captura/voz simuladas, errores y envío fallido/reintento. El resultado físico de Lenovo continúa sin validar.

La **APK 2026.11.228**, código de compilación **3**, añade `android.permission.MODIFY_AUDIO_SETTINGS`. Su ausencia se comprobó en el manifiesto binario de la APK 225 descargada; el [código de Chromium](https://chromium.googlesource.com/chromium/src/media/+/master/base/android/java/src/org/chromium/media/AudioManagerAndroid.java) requiere ese permiso junto con `RECORD_AUDIO` al seleccionar la entrada de audio. Es un permiso normal declarado en el instalador, no otra opción que el usuario deba activar en Ajustes.

El usuario confirmó que la APK con web 227 falla **antes del pitido** con «No se ha podido utilizar el micrófono…» y que **su voz sí se oye en un vídeo grabado con Cámara**. El fallo está en el arranque de captura de AI-Theatre; la falta del permiso es un defecto confirmado del instalador y una explicación compatible, sin acreditar todavía su corrección física en Lenovo. No se cambia la captura, el reconocimiento, la voz, Inteligente ni las pausas. La verificación de configuración exige ambos permisos y el archivo EAS inspeccionado conserva sólo los once archivos previstos. Pasaron 329 pruebas, lint, TypeScript y exportación web.

Esta corrección **requiere actualizar la APK**, conservando el mismo identificador de aplicación. No basta recargar la web. La [compilación Android 2026.11.228](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre/builds/b6dd3ad9-495e-4e4b-9307-537433770260) terminó correctamente; [descargar la APK 228](https://expo.dev/artifacts/eas/iDcLt0L7J0boGuqt5Rle-5UjRtU0MYx2J4fB1EkOL2k.apk). Expo Free tenía 1/15 compilaciones Android usadas antes de este envío, sin sobrecostes ni complementos contratados. No se ha solicitado una compilación iOS.

Se descargó el APK real (HTTP 200, 82.338.130 bytes; SHA256 `b3988413ae35c790c01b3a222b23ba61d4e9e122dc80a649a13257776970fa0f`) y se inspeccionaron su manifiesto binario y su certificado v2: versión 228/código 3, ambos permisos de audio, mismo paquete y certificado que la 225. El único permiso añadido es `MODIFY_AUDIO_SETTINGS`; se puede elegir **Actualizar**, sin desinstalar la anterior. Copia local: `C:/Users/ruben/Downloads/AI-Theatre-2026.11.228.apk`. Los once archivos nativos enviados a Expo coinciden con la fuente publicada. La web y el bundle 228 también están verificados en producción. `expo doctor` señaló siete actualizaciones de parche disponibles para SDK 54; la compilación continuó y terminó sin cambiar esas dependencias. **Pendiente:** instalar en Lenovo, comprobar el encabezado nativo «Prototipo Android · 2026.11.228» y repetir la calibración; esto todavía no confirma el micrófono físico ni el reconocimiento.

La web **2026.11.227** conserva el error real al abrir la captura de calibración. Un permiso bloqueado muestra la ruta de la aplicación instalada (**Configuración/Ajustes → Aplicaciones → AI-Theatre → Permisos → Micrófono**) o la de Chrome (**⋮ → Configuración → Configuración de sitios → Micrófono**, además del permiso Android para Chrome). Una entrada ocupada/no disponible o un procesador de audio que no se activa tienen mensajes distintos. Si falla el arranque se libera el micro adquirido; un cierre o rechazo tardío de un intento anterior no borra una captura nueva.

El cambio de mensajes de la **227** es compatible con la APK **2026.11.225**: basta cerrar y abrir AI-Theatre para cargar esos mensajes, sin reinstalar ni borrar datos. No cambia el reconocimiento seleccionado, Inteligente, los umbrales ni las pausas. El altavoz ya confirmado se conserva al reintentar la calibración. Esto no añade al instalador antiguo el permiso que corrige la APK 228.

Pasaron 329 pruebas, lint, TypeScript y exportación web. En navegador se comprobaron errores de permiso y entrada inyectados, las rutas distintas de APK/Chrome y el reintento de calibración sin repetir altavoz; también dos escenas, «adelante» final, pausa de 14 s, fondo e informes parciales mediante el puente real con captura/voz simuladas. **La calibración del micrófono físico de la tablet sigue pendiente de confirmación del usuario**; la captura de Ajustes de AI-Theatre enviada por el usuario muestra Micrófono en «Con permiso», sin permisos denegados. Por tanto, el permiso Android de la APK ya está concedido: no repetir la concesión de ese permiso como diagnóstico.

## Verificación del prototipo y de BlueStacks · 13–14/11/2026

La web **2026.11.226** mejora el fallo de la prueba de voz de Android y es compatible con la APK **2026.11.225** existente; no se ha generado otro instalador para este cambio. Conserva el error del servicio y, tras fallar una voz seleccionada, permite al sistema elegir su voz española en el único reintento. No cambia las reglas de Inteligente ni sus pausas.

La prueba observada del usuario se realizó en **BlueStacks Desktop / Android 16 Alpha**, no en un teléfono: «Entrada de voz: Ninguno», búsqueda de apps de voz sin resultados y Google Play sin sesión. Para probar APIs de voz del sistema en un emulador hacen falta los servicios correspondientes instalados/configurados dentro de él. Google Play requiere el inicio de sesión personal del usuario. La voz de salida y el reconocimiento de entrada son servicios distintos; instalar uno no demuestra que el otro esté disponible. Esta observación no valida el rendimiento físico de Android.

Después de que el usuario iniciara sesión, se instaló [Speech Recognition & Synthesis de Google LLC](https://play.google.com/store/apps/details?id=com.google.android.tts) dentro de BlueStacks. La prueba de AI-Theatre aún registró `speech-start-timeout`. Al configurar **Ajustes → Idiomas → Salida de conversión de texto a voz → Motor preferido → Reconocimiento y síntesis de voz de Google**, Android mostró un aviso para habilitar el motor, que el usuario confirmó haber aceptado el **14/11**.

Se verificó que Google figura como motor preferido y se reinició el proceso de AI-Theatre mediante **Información de la app → Forzar detención**, conservando sus preferencias. La nueva prueba real de la APK 225/web 226 terminó y mostró **«Sí, la oigo. Continuar»**, conservando BENNY y una escena. El usuario confirmó después que **tanto la muestra TTS de los ajustes de Android como la frase de la app seguían en silencio**: el evento de finalización no prueba audibilidad física y no se pulsó la confirmación.

Se comprobó el volumen multimedia de Android al 100 %, el volumen lateral de BlueStacks al máximo y el mezclador de Windows en Realtek al 73 %, sin silenciar. Se fijó la salida de altavoces de BlueStacks en **Altavoces (Realtek(R) Audio)**, sustituyendo «Normal», se guardó el ajuste y se repitió la frase de la app. **El usuario confirmó que seguía sin oírse.** No se ha validado con ello el reconocimiento del emulador; «Entrada de voz» aún mostraba «Ninguno».

Para aislar el fallo se reprodujo **Aud Benny · Con voz** dentro de la APK. El usuario confirmó que **Windows y esa música de BlueStacks sí se oyen**. El paquete de voz español (España) de Google está descargado (aprox. 9,5 MB); se eligió **Voz I**, pero el usuario confirmó que su muestra tampoco se oía. Se reiniciaron los procesos de Google TTS y AI-Theatre mediante Forzar detención y se repitió la frase inicial: volvió a confirmar silencio. Esto acota el fallo a la salida sintetizada en este emulador, sin determinar aún su causa interna ni el comportamiento de un teléfono real. La música quedó pausada y no se confirmó el altavoz.

El usuario autorizó **instalar y probar RHVoice** el 14/11. Se instaló desde la [ficha oficial de Google Play](https://play.google.com/store/apps/details?id=com.github.olga_yakovleva.rhvoice.android), desarrollador RHVoice.com (3,4 MB); rechazó sus notificaciones y aceptó habilitarlo como motor. Se descargó sólo **SLT 4.1.2.1026**, una voz inglesa gratuita. El usuario oyó su muestra dentro de RHVoice, pero tanto la frase inicial de AI-Theatre como la prueba TTS del sistema con inglés (Estados Unidos) siguieron en silencio. Carlos (España) requiere suscripción y Mateo (Ecuador) limita la gratuidad a ciertos usos de accesibilidad; se descartaron sin descargarlos ni realizar compras. RHVoice continúa instalado como prueba, con SLT, pero se ha restaurado Google/español.

**Diagnóstico del silencio:** tras activar el usuario temporalmente ADB (`127.0.0.1:6610`), `dumpsys audio` mostró `AudioHardening background playback muted` para ambos motores y `CONTROL_AUDIO: foreground`; las pistas entregaban muestras, pero figuraban con ganancia `-inf`. El usuario pidió expresamente ejecutar la corrección propuesta para Google TTS:

```powershell
& "C:\Program Files\BlueStacks_polar\HD-Adb.exe" -s 127.0.0.1:6610 shell cmd appops set com.google.android.tts CONTROL_AUDIO allow
```

Se verificó `CONTROL_AUDIO: allow` y se restauró Google con español de España (`tts_default_synth=com.google.android.tts`, locale `es_ES`), conservando la entrada inglesa de RHVoice en la preferencia de idiomas. **El usuario confirmó que la voz española de los ajustes de Android ya se oye.** Después se reinició AI-Theatre y se repitió la frase inicial: terminó sin nuevos bloqueos y el usuario confirmó **«Sí, ahora la app se oye»**. Esto valida físicamente la recuperación de esa prueba de altavoz en BlueStacks, sin atribuirla a instalar RHVoice. No se ha pulsado «Sí, la oigo. Continuar» ni probado el micrófono. El usuario apagó ADB y guardó; se verificó su interruptor apagado y se desconectó el cliente local, con la lista de dispositivos ADB vacía. Se cerraron los ajustes y se dejó AI-Theatre lista para continuar. No hace falta activar ADB para ensayar. Para revertir el permiso a su estado anterior se sustituye `allow` por `foreground`. Es una corrección local del emulador: no se ha desactivado la protección general ni cambiado reconocimiento, Inteligente, pausas o la APK. No extrapolar esta excepción a teléfonos físicos sin diagnóstico.

- Soporte web **2026.11.225** publicado y verificado en [producción](https://ai-theater.vercel.app/?share=d92b33981047). Pasaron 317 pruebas, lint, TypeScript y exportación web.
- [Compilación iOS 2026.11.225 para simulador](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre/builds/d4d09fe3-cd15-4432-b676-33da36c1ba84) terminada correctamente en Expo desde Windows. Esta compilación no sirve para instalar en el iPhone físico.
- [Compilación de la APK Android 2026.11.225](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre/builds/100df53c-65a0-46c8-8cd0-5140621691f0): esta página muestra el estado y ofrece el instalador cuando finaliza.
- La prueba de navegador sobre producción usa el puente/controlador reales con captura y voz simuladas: dos escenas, espera de «adelante» final, pausa de 14 s, fondo/reanudación, informes parciales y reintento tras un error. La comparativa web se verificó con Vosk/Whisper reales y voz/nativo simulados. No son pruebas físicas de los teléfonos.
- Al recargar la WebView, los identificadores de captura y voz cambian por documento. Se comprobó que los eventos tardíos de la pantalla anterior no terminan la escucha ni la voz nuevas.

## Qué hace falta y qué se paga

| Concepto | Para esta prueba |
| --- | --- |
| Windows, Node y cuenta Expo | Se usa el ordenador actual. No hace falta comprar un Mac. |
| Compilación en Expo Free | 0 USD dentro de la cuota vigente: 15 compilaciones Android y 15 iOS, con cola de prioridad baja. Comprobar la cuota disponible en la cuenta. |
| Instalación en tu iPhone desde Windows | Membresía Apple Developer: 99 USD/año, o el precio local que indique Apple. También hay que registrar el iPhone para la distribución interna. |
| Instalación en Android | APK de distribución interna: Google Play no es necesario. Hace falta un teléfono Android para validar el audio real. |
| Publicación futura en Google Play | Cuenta de desarrollador: 25 USD de registro, pago único; no es necesaria para esta prueba. |
| Transcripción | No se contrata una API facturada por minutos ni se usan créditos de un proveedor de transcripción. Los costes del alojamiento web existente siguen siendo independientes. |

Precios comprobados el 13/11/2026 en [Expo](https://expo.dev/pricing), [Apple](https://developer.apple.com/help/account/membership/program-enrollment/) y [Google Play](https://support.google.com/googleplay/android-developer/answer/6112435). No se activa un plan de pago de Expo ni se compra una membresía mediante estos scripts. Si se agota la cuota gratuita, revisar el coste antes de lanzar otra compilación.

## Preparación desde PowerShell

En `C:\DEV\AI\TeatroIA`:

```powershell
npm run prototype:check
npm run prototype:login
npm run prototype:account
npm run prototype:link
```

`login` pide las credenciales en tu propia terminal; no hay que compartir contraseñas ni códigos en el chat. `link` vincula o crea el proyecto bajo tu cuenta Expo y añade el identificador público del proyecto a `app.json`. No modificarlo por un identificador inventado.

La sesión y la vinculación de este ordenador ya están hechas. No crear otra app con `create-expo-app` ni sustituir este repositorio por una plantilla. Si PowerShell está en otra carpeta, los comandos también se pueden ejecutar con `npm --prefix "C:\DEV\AI\TeatroIA" run prototype:check` (cambiando sólo el nombre del comando).

`npm run prototype:info` comprueba el proyecto y `npm run prototype:usage` muestra el plan y la cuota. El 13/11 se verificó que esta cuenta utiliza Free, sin extras contratados. La cuota cuenta compilaciones, no minutos de ensayo.

Para generar una APK de prueba:

```powershell
npm run prototype:android
```

La cuenta Expo debe tener cuota de compilación disponible. El comando entrega una URL de instalación al terminar; no publica en Google Play. No depende de mantener el PC encendido durante el ensayo.

Para el iPhone, después de activar Apple Developer:

```powershell
npm run prototype:devices
npm run prototype:ios
```

El registro genera un enlace que debes abrir en tu iPhone. Sigue los pasos de instalación del perfil y habilita Modo de desarrollador cuando lo requiera el instalador. La firma y el registro necesitan tu cuenta Apple; no basta con abrir la URL web o usar Expo Go. No se necesita App Store ni TestFlight para la prueba interna.

`npm run prototype:ios-validation` compila exclusivamente para el simulador de iOS en la nube. Permite detectar errores de compilación desde Windows sin membresía Apple, pero su archivo no se puede instalar en el iPhone. No usarlo como sustituto de `prototype:ios` para una prueba física.

## Verificación física

1. Abrir la app instalada. Conceder los permisos nativos y, cuando la web lo solicite, el acceso al micro. En iPhone, mantener Silencio desactivado como en los ensayos anteriores.
2. Abrir la obra y elegir tus personajes/escenas. En «Micrófono y voz», comprobar que el motor es el nativo del teléfono.
3. Hacer la preparación habitual. El anuncio de cada escena sigue esperando a «adelante» o al botón.
4. Decir una réplica en dos partes con una pausa larga. Comprobar que las palabras insuficientes se conservan sin avanzar, también al pausar/reanudar y volver de otra app.
5. Ensayar las mismas réplicas españolas/inglesas de los informes anteriores y enviar el informe parcial. Se guarda `runtime: native_ios/native_android`, la versión instalada y `responseTiming.origin: native_bridge` para separar esta prueba de Safari/Chrome. Los tiempos de eventos no prueban latencia acústica.

## Archivos y almacenamiento

`.easignore` usa una lista permitida: sólo incluye la app nativa, su código, configuración y dos iconos. Excluye `.env*`, el servidor, PDF, imágenes temporales y notas locales. Las credenciales de firma se gestionan en Expo; no se añaden a Git. El chequeo local comprueba estas exclusiones.

La app abre la URL configurada en `app.json → extra.nativePrototype.webUrl`; los datos siguen el entorno de esa URL. El perfil de compilación `preview` no copia ni mezcla los almacenes `production/preview/development` de Vercel. El prototipo está configurado para la misma obra de producción que utiliza el usuario. Las preferencias de Safari/Chrome y la app instalada tienen almacenes locales separados; los materiales compartidos proceden del mismo servidor.
