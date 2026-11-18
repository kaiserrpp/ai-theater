# Beta Android en Google Play

Preparación iniciada el 17 de noviembre de 2026 por petición expresa del usuario. No confundir un AAB compilado con una beta ya distribuida por Google Play. La cuenta, el alta de la app, la revisión y el enlace de participación deben verificarse en Play Console.

**Actualización final del 18/11: beta 2026.11.247/código 8 enviada al canal cerrado Alpha y verificada «En revisión».** Clave anterior importada en Google Play App Signing, ficha y declaraciones terminadas, comprobaciones rápidas completadas y 14 cambios recibidos por Google. Los consentimientos pendientes de la preparación anterior ya están autorizados y aplicados. Aún falta la aprobación de Google y comprobar la disponibilidad real; no está distribuida todavía. Véase el [estado final y la verificación de 247](google-play-beta-status-2026-11-18.md), que prevalece sobre el relato histórico de preparación de esta página.

## Cuenta y contacto

El usuario creó una cuenta personal, activó dos pasos y completó las verificaciones en Google, incluida la del Android real y el teléfono. **El 18/11 se observó AI-Theatre creada en Play Console**, después de que el titular revisara y aceptara las tres declaraciones de alta. No volver a crear la cuenta ni pedir otro pago o las verificaciones ya terminadas. No guardar documentos, contraseñas ni datos de identidad en el repositorio.

La política de privacidad, la declaración sin anuncios, la categoría Educación y el contacto público están guardados. El canal cerrado Alpha tiene España y la lista AI Theatre con un participante inicial confirmado por el usuario; los correos de testers sólo se guardan en `.expo/play-beta/testers.txt` y en Play Console, nunca en Git. Ficha, acceso para revisión, declaraciones y firma están completos. La distribución y su enlace real siguen pendientes de la aprobación de Google.

El usuario ha confirmado **`kaiser.rpp.dev@gmail.com` como correo de contacto público**. La propuesta anterior `ai-theatre.rpp@gmail.com` se descarta: Gmail no admite guiones, y el usuario indicó que no pudo crear el nuevo correo. El correo de contacto puede ser distinto de la cuenta propietaria de Play Console. La política y el fichero `distribution/google-play/contact-email.txt` usan sólo el correo confirmado; no publicar el correo personal observado en Chrome.

Una cuenta personal corresponde a un proyecto del propio titular; una cuenta de organización requiere los datos reales de la entidad. El titular elige y verifica su tipo de cuenta. Las cuentas personales nuevas necesitan al menos 12 participantes inscritos continuamente durante 14 días en **pruebas cerradas**, antes de solicitar acceso a producción; una prueba interna no satisface ese requisito. El plazo empieza con las inscripciones de Google Play, no con la creación de esta documentación ni con las APK anteriores.

## Compilación y firma

- Perfil `beta` de `eas.json`: distribución `store`, AAB, entorno `production`, recurso `medium`; no modifica el perfil `prototype` de APK ni compila iOS.
- Comando: `npm run prototype:check`, revisar `npm run prototype:usage`, y después `npm run beta:android`. Conservar Expo Free, sin complementos ni cargos. La consulta inicial mostró 4/15 compilaciones Android y 3/15 iOS utilizadas, coste estimado cero.
- Identificador Android conservado: `com.kaiserrpp.aitheatre.prototype`. La palabra prototype en el identificador interno no impide el nombre público AI-Theatre; cambiar el identificador crearía otra instalación y otro almacenamiento.
- AAB enviado **`2026.11.247`, código Android `8`**, compilación `5d4e23fa-100d-4f0a-adb8-5965cd92a5f7`, fuente `29d553f`, terminada el 18/11. [Artefacto de Expo](https://expo.dev/artifacts/eas/kXoqnDsmxAxo6cmKImDDQSkBqC2eNzxXbxpsgMRU9Pk.aab): 57.832.114 bytes, SHA256 `713e1c1990a0b471d83c1869af80501a2c19e3b2c5f8f7954b96be7461f0229e`. Copia comprobada en Downloads/AI-Theatre-GooglePlay-beta. El instalador anterior sigue siendo 232/código 5; un AAB no se instala pulsándolo como una APK. El preliminar 245/código 6 no se debe subir a Play. El 246/código 7 se retiró de la versión tras importar la firma porque Play no permite reutilizar ese código.
- El manifiesto fusionado real del AAB 246 confirma la exclusión de superposición, almacenamiento general, permisos de servicios en primer plano y los dos servicios de fondo heredados de expo-audio 1.1. Conserva micrófono, modificación de audio, Internet, estado de red, vibración y el permiso interno del receptor dinámico. La captura de nivel usa caché privada sin servicio de fondo; ASR/TTS y sus consultas se conservan.
- La clave Android existente de Expo está importada en **Play App Signing** mediante copia cifrada PEPK, con autorización del titular. El certificado de firma de aplicación coincide con la APK anterior. No exportar claves privadas a Git ni crear cuentas de servicio para la primera subida manual.
- Bundletool valida el AAB real 247: paquete conservado, versión/código correctos, minSDK 24 y objetivo 36; las 42 bibliotecas de 64 bits tienen segmentos LOAD alineados al menos a 16 KB y BundleConfig usa PAGE_ALIGNMENT_16K. Firma JAR válida y certificado SHA256 `e5c359f20fb940672a2e0eb076491a0eebc8456ad2bf07d2d46e6dc5636ccebb`, idéntico a la APK anterior. Icono extraído y visto: diseño propio. Esto no acredita instalación, acústica ni aprobación de Google. Expo sigue Free: Android 7/15, iOS 3/15, sin complementos y coste estimado cero.
- `.easignore` mantiene fuera servidor, secretos, PDFs, canciones y herramientas temporales. Inspeccionar el archivo real que se manda a Expo. El contenido de la app se carga desde la web de producción, con el mismo puente de voz nativo existente.

## Ficha enviada

Textos en `distribution/google-play/es-ES/`: título, descripción breve/completa y novedades del código 8. La política pública se sirve en `https://ai-theater.vercel.app/privacidad.html`, accesible desde el menú web y desde la cabecera nativa, incluso antes de pedir micrófono. La explicación inicial nativa menciona el tratamiento del servicio de voz y los informes automáticos. Web **247 publicada y verificada**: bundle real, política idéntica byte a byte (SHA256 `fec585e49be1a642489c1d6a8d24b1db5675c19cb39b1370b9bb5803233788cf`), enlace/contacto correctos. El QA aislado previo de ordenador/Pixel 7 con canciones y ocho ejercicios no equivale a un ensayo acústico en Android físico.

El contacto, la titularidad y los derechos de distribución están confirmados por el titular. El icono anterior contiene una marca de agua visible: Android y la ficha usan el diseño vectorial original de `distribution/google-play/graphics/icon.svg`, rasterizado en `assets/images/ai-theatre-play.png` (512×512, RGBA). El gráfico de funciones original (1024×500) y su SVG están en `distribution/google-play/graphics/`. No se sustituyen fondos, materiales ni iconos web/iOS. Las tres capturas de la interfaz web real de `distribution/google-play/screenshots/web/` se han subido con autorización expresa del titular para omitir el contraste previo con Android instalado. No acreditan un recorrido acústico ni la captura de un teléfono físico. No utilizar el vídeo privado original ni mensajes de WhatsApp como material promocional.

La ficha no ofrece compras, suscripciones ni anuncios. Audiencia guardada para 18 años o más e IARC completado según el catálogo accesible, con aceptación expresa de los términos por el titular. La beta cerrada controla la descarga en Play, pero no añade autenticación a los enlaces existentes de materiales. No anunciar esos enlaces como privados.

## Revisión de Seguridad de los datos

Esta tabla conserva el inventario de código usado para completar el formulario. La declaración está guardada y enviada junto con la beta, pendiente de revisión de Google; el detalle final figura en el [estado de 247](google-play-beta-status-2026-11-18.md).

| Función | Tratamiento observado | Revisar en Play Console |
| --- | --- | --- |
| Voz nativa/navegador | El proveedor del teléfono puede reconocer audio en sus servidores; el código no persiste el audio ASR. Vosk/Whisper seleccionados ejecutan modelos locales descargados. | Audio de voz, tratamiento efímero y proveedores reales; no declarar que todo el audio es siempre local. |
| Informes automáticos y parciales | Texto esperado/reconocido, personajes/obra/escena, puntuaciones, actividad/tiempos/errores, user agent, versiones e ID de sesión. Cola local duradera; envío si `feedbackWritable` y no `readOnly`. Sin archivos de voz. | Contenido generado por el usuario, actividad, diagnóstico/rendimiento y posibles identificadores; finalidad de funcionamiento y mejora. |
| Materiales compartidos | PDFs, texto, imágenes o audios que se suben expresamente. Lecturas por enlaces compartidos. | Archivos/documentos, fotos/audio según funciones accesibles; acceso del administrador y del grupo. |
| Análisis PDF opcional | El documento se envía a Gemini si se solicita esa función y está configurada. | Documentos y proveedor de análisis; no describirlo como procesamiento exclusivamente local. |
| Preferencias y calentamiento | Ajustes, rangos, progreso y actividad aproximada guardados localmente. | Distinguir almacenamiento local de información transmitida. |
| Alojamiento/modelos | Vercel, Blob, Supabase cuando esté habilitado, servidores de modelos y servicios de voz pueden recibir datos de conexión. | Prácticas de cada proveedor/SDK y transporte; no prometer que no existe recogida alguna. |

No se solicitan contactos, ubicación ni identificadores publicitarios en el código de esta entrega. La app no crea cuentas propias de alumnos; la cuenta de Google Play del tester no es una cuenta creada dentro de AI-Theatre. La retirada de datos enviados se solicita al responsable; borrar/desinstalar sólo elimina las copias locales según el sistema. La política describe que no hay un borrado automático por plazo y que algunos informes históricos de Blob tienen URL pública. No afirmar que esos informes ya se han migrado a almacenamiento privado.

## Recorrido de alta y paso pendiente

Los pasos 1–5 están completados; el paso 6 espera la aprobación de Google. La publicación gestionada está desactivada para publicar automáticamente cuando se aprueben los cambios.

1. Crear AI-Theatre como aplicación gratuita, idioma español y completar las declaraciones reales del titular.
2. Subir el AAB validado y revisar Play App Signing antes de confirmar una clave nueva.
3. Completar ficha, contacto, política, acceso para revisión, audiencia/IARC, anuncios y Seguridad de los datos.
4. Crear un canal **cerrado**, por ejemplo «AI Theatre», y añadir sólo correos de Google de participantes que acepten probar. Mantener su lista fuera de Git, capturas y documentos públicos. Un grupo de WhatsApp no se convierte automáticamente en una lista de testers de Google.
5. Seleccionar países y enviar la beta a revisión. No activar producción pública. El perfil de envío `beta` queda en `alpha` y `draft` como preparación; no hay una subida automática configurada ni claves de Play guardadas.
6. Esperar el estado disponible de Google Play y verificar el enlace real de participación y la instalación. Sólo entonces compartir el enlace con el grupo, distinguiéndolo del enlace web y de las APK previas.

## Fuentes oficiales

- [Registro y cuota de Play Console](https://support.google.com/googleplay/android-developer/answer/6112435?hl=es).
- [Pruebas de cuentas personales nuevas](https://support.google.com/googleplay/android-developer/answer/14151465?hl=es).
- [Preparar una app para revisión](https://support.google.com/googleplay/android-developer/answer/9859455?hl=es).
- [Seguridad de los datos](https://support.google.com/googleplay/android-developer/answer/10787469?hl=es).
- [SDK objetivo de Google Play](https://developer.android.com/google/play/requirements/target-sdk).
- [Compatibilidad con páginas de 16 KB](https://developer.android.com/guide/practices/page-sizes).
- [Enviar un AAB con Expo](https://docs.expo.dev/submit/android/).
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=es).
