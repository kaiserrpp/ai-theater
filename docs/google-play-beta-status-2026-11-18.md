# Estado de la beta Google Play · 18/11/2026

El envío de la beta cerrada está confirmado en Play Console: **14 cambios en «Cambios en revisión»**. Las comprobaciones rápidas ya terminaron y Google indica «Tus cambios están en proceso de revisión». La versión **2026.11.247 / código 8** aparece como **«En revisión»** en Alpha. Aún no está aprobada ni distribuida. Este estado actualiza la preparación anterior de [la beta](google-play-beta.md).

## Firma importada

El titular autorizó expresamente la custodia cifrada en Google Play App Signing de la clave Android existente de Expo. Se exportó con PEPK y la clave pública de cifrado descargada desde Play Console; sólo se subió el ZIP cifrado. La clave privada y sus contraseñas permanecen fuera de Git.

Play Console confirma como **certificado de firma de aplicación** SHA256 `e5c359f20fb940672a2e0eb076491a0eebc8456ad2bf07d2d46e6dc5636ccebb`, idéntico al de la APK 232. Sustituye a la clave generada inicialmente por Google. No hay instalaciones desde Play.

Google rechazó reutilizar el código 7 y señaló que el AAB anterior se había subido antes de elegir la clave. Se retiró de la versión, conservándose en la biblioteca, y se preparó el código 8.

## Candidata 2026.11.247 / código 8

- Fuente `29d553f3ffc42640fda80e23c3a92c5790f567f4`, publicada en `main`. Sólo cambia la numeración y las novedades de distribución; conserva el funcionamiento y la configuración Android de 246.
- EAS `5d4e23fa-100d-4f0a-adb8-5965cd92a5f7`, **FINISHED**. [AAB de Expo](https://expo.dev/artifacts/eas/kXoqnDsmxAxo6cmKImDDQSkBqC2eNzxXbxpsgMRU9Pk.aab): **57.832.114 bytes**, SHA256 `713e1c1990a0b471d83c1869af80501a2c19e3b2c5f8f7954b96be7461f0229e`.
- Archivo EAS inspeccionado: 16 archivos nativos previstos, sin secretos, materiales, servidor ni PDF. Expo Free comprobado antes y después de compilar: Android 7/15, iOS 3/15, sin complementos y coste estimado cero.
- Bundletool válido, CRC ZIP correcto, paquete `com.kaiserrpp.aitheatre.prototype`, versión 247/código 8 y SDK objetivo 36. Las 42 bibliotecas de 64 bits mantienen segmentos LOAD alineados al menos a 16 KB; configuración `PAGE_ALIGNMENT_16K`.
- Manifiesto real sin los seis permisos bloqueados ni los servicios heredados de expo-audio. Conserva Internet, estado de red, micrófono, modificación de audio, vibración y receptor interno. Firma JAR válida y certificado anterior confirmado.
- Play ha procesado el AAB 247 y se ha enviado en el canal cerrado Alpha, con nombre y novedades guardados. La validación final de la versión no muestra errores; conserva una advertencia de archivo de desofuscación R8/ProGuard no adjunto. Los símbolos de depuración nativos sí están adjuntos.
- Copia en Downloads/AI-Theatre-GooglePlay-beta. No se ha generado otra APK. No equivale a instalación ni ensayo acústico físico.

## Web y verificaciones

425 pruebas, lint, TypeScript y exportación web correctos; también `prototype:check`. Web **247 publicada y verificada** en [producción](https://ai-theater.vercel.app), bundle `AppEntry-dabede86bf3524cf42fcce5a6ee3feee.js`, con versión 247 en el contenido y en el módulo de Comparativa.

La política pública coincide byte a byte con `public/privacidad.html`, SHA256 `fec585e49be1a642489c1d6a8d24b1db5675c19cb39b1370b9bb5803233788cf`. El almacenamiento de producción sigue `readOnly: true` y `feedbackWritable: false`: las lecturas y ensayos continúan, las escrituras compartidas están protegidas y los informes nuevos quedan pendientes localmente. No se ha activado Supabase en esta entrega.

## Declaraciones y envío

El titular confirma participantes adultos y autorización para distribuir los materiales a esos participantes. Salud está guardada sin funciones de salud. Audiencia objetivo guardada únicamente para **18 años o más**. IARC completado y guardado tras la aceptación expresa de sus términos por el titular; reconoce contenido remoto, lenguaje y referencias a sustancias en el catálogo. La gestión del catálogo corresponde al editor/administrador: no hay publicación libre, chat ni intercambio entre alumnos. Clasificación calculada para Europa: PEGI 3; no cambia la audiencia objetivo adulta.

Seguridad de los datos está completa, importada mediante el CSV oficial y **guardada definitivamente** después de completar la audiencia. Declara fotos/vídeos, voz/música/otros audios, archivos/documentos, interacciones, otro contenido generado por el usuario y diagnósticos. No declara identificadores de dispositivo por el mero ID de sesión: la definición de Google excluye identificadores de evento que no permitan vincular un dispositivo, navegador o app concretos. El almacenamiento exclusivamente local se distingue de la recogida fuera del dispositivo. No se promete tratamiento efímero de todos los servicios de voz. La declaración adicional de ID de publicidad está guardada como **No**: no hay SDK de anuncios ni permiso AD_ID en el AAB real.

Las tres autorizaciones pendientes fueron contestadas expresamente por el titular:

1. Las tres capturas preparadas de la interfaz web se han subido con su autorización para omitir el contraste previo con Android instalado. Play las ha aceptado. No acreditan capturas nativas ni ensayo acústico. Ficha española completa y guardada como «Lista para enviar a revisión», con textos, icono y gráfico. Los dos gráficos originales se han declarado como creados/editados con ayuda de IA; las tres capturas reales de la interfaz no se han etiquetado como imágenes generadas.
2. La contraseña de gestión existente se ha validado en el servidor de producción y se ha facilitado **sólo en el formulario privado de acceso para revisores de Play**, con instrucciones en inglés y sin nombre de usuario ficticio. Se informa del mantenimiento global de las escrituras y de los informes locales pendientes. Está desactivada la opción adicional de pruebas con credenciales en dispositivos de Google y partners de confianza. No guardar ni mostrar la contraseña en Git, documentos o capturas.
3. Los [Términos de Uso de IARC](https://web.iarcservices.com/terms) se han aceptado dentro del flujo autorizado. No volver a pedir estos consentimientos para terminar este envío.

Play añadió un aviso de disponibilidad por `android.hardware.screen.portrait`. Se mantuvo este requisito de la candidata y se usó «Continuar de todos modos», priorizando esta beta para dispositivos compatibles. Algunos teléfonos/tablets/ordenadores/XR sin esa función no podrán instalarla; no prometer disponibilidad universal. No se ha generado otro AAB para cambiar la orientación.

Se han enviado los 14 cambios exclusivamente de la **prueba cerrada Alpha**, con España y la lista de testers previamente autorizada. La publicación gestionada está desactivada: Google publicará los cambios cuando los apruebe. Las comprobaciones rápidas terminaron sin otro bloqueo y la versión muestra «En revisión», con base instalada del 0 %. La consola avisa de que la revisión suele completarse en 7 días, pero puede llevar más tiempo. Evidencia local ignorada: `.expo/play-beta/play-beta247-in-review.png`. Esperar y comprobar el estado disponible y el enlace real de participación antes de afirmar que la beta está distribuida. No activar producción pública ni repetir verificaciones de cuenta.
