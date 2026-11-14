# Prototipo nativo de AI-Theatre desde Windows

El prototipo conserva la aplicación web publicada, los guiones y materiales compartidos, los ajustes, el algoritmo de Inteligente y los informes. Una app Expo pequeña abre esa misma interfaz y conecta la captura y la voz con las API nativas de iPhone/Android. La web habitual sigue usando sus motores y protecciones actuales.

El reconocedor instalado puede cancelar su captura propia al aceptar una réplica. La app espera la confirmación nativa real antes de reproducir voz o abrir otra entrada; no se traslada esa cancelación al reconocedor de Safari. Las pausas conservan las palabras. Una finalización o un silencio del servicio no decide por sí solo el avance: se siguen aplicando `lineMatching.ts` y sus umbrales existentes.

## Estado y límites de esta entrega

- Preparados el código de iPhone/Android, el puente con el ensayo existente y el perfil de compilación interna. Proyecto vinculado: [@kaiserpps-team/ai-theatre](https://expo.dev/accounts/kaiserpps-team/projects/ai-theatre), identificador público `7f254bd3-5532-490c-8114-a149d7c28132`.
- El instalador y la rapidez/calidad física requieren una compilación firmada y una prueba en los teléfonos. Una exportación JavaScript o un ensayo con eventos simulados no demuestra funcionamiento físico.
- El usuario tiene un iPhone 15 Pro Max y cuenta Expo. Aún no dispone de membresía Apple Developer ni de un Android para probar el micrófono real.
- El reconocimiento utiliza las API del sistema, sin claves de servicios de transcripción de pago. Puede requerir conexión según el servicio, el idioma y los modelos disponibles; esta entrega no promete uso totalmente sin conexión.
- Vosk/Whisper/Comparativa continúan disponibles en la web y en la interfaz reutilizada; su funcionamiento en cada WebView instalada necesita validación independiente. La primera prueba debe seleccionar «Apple · iPhone · reconocimiento nativo» o «Android · reconocimiento nativo».

## Verificación del 13/11/2026

La web **2026.11.226** mejora el fallo de la prueba de voz de Android y es compatible con la APK **2026.11.225** existente; no se ha generado otro instalador para este cambio. Conserva el error del servicio y, tras fallar una voz seleccionada, permite al sistema elegir su voz española en el único reintento. No cambia las reglas de Inteligente ni sus pausas.

La prueba observada del usuario se realizó en **BlueStacks Desktop / Android 16 Alpha**, no en un teléfono: «Entrada de voz: Ninguno», búsqueda de apps de voz sin resultados y Google Play sin sesión. Para probar APIs de voz del sistema en un emulador hacen falta los servicios correspondientes instalados/configurados dentro de él. Google Play requiere el inicio de sesión personal del usuario. La voz de salida y el reconocimiento de entrada son servicios distintos; instalar uno no demuestra que el otro esté disponible. Esta observación no valida el rendimiento físico de Android.

Después de que el usuario iniciara sesión, se instaló [Speech Recognition & Synthesis de Google LLC](https://play.google.com/store/apps/details?id=com.google.android.tts) dentro de BlueStacks. La prueba de AI-Theatre aún registró `speech-start-timeout`. Al configurar **Ajustes → Idiomas → Salida de conversión de texto a voz → Motor preferido → Reconocimiento y síntesis de voz de Google**, Android mostró un aviso para habilitar el motor, que el usuario confirmó haber aceptado el **14/11**.

Se verificó que Google figura como motor preferido y se reinició el proceso de AI-Theatre mediante **Información de la app → Forzar detención**, conservando sus preferencias. La nueva prueba real de la APK 225/web 226 terminó y mostró **«Sí, la oigo. Continuar»**, conservando BENNY y una escena. El usuario confirmó después que **tanto la muestra TTS de los ajustes de Android como la frase de la app seguían en silencio**: el evento de finalización no prueba audibilidad física y no se pulsó la confirmación.

Se comprobó el volumen multimedia de Android al 100 %, el volumen lateral de BlueStacks al máximo y el mezclador de Windows en Realtek al 73 %, sin silenciar. Se fijó la salida de altavoces de BlueStacks en **Altavoces (Realtek(R) Audio)**, sustituyendo «Normal», se guardó el ajuste y se repitió la frase de la app. La recuperación del sonido tras este cambio sigue pendiente de confirmación del usuario. No se ha validado con ello el reconocimiento del emulador; «Entrada de voz» aún mostraba «Ninguno».

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
