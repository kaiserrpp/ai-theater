# Beta Android en Google Play

Preparación iniciada el 17 de noviembre de 2026 por petición expresa del usuario. No confundir un AAB compilado con una beta ya distribuida por Google Play. La cuenta, el alta de la app, la revisión y el enlace de participación deben verificarse en Play Console.

## Cuenta y contacto

El registro oficial se abrió en Chrome en `https://play.google.com/console/signup`. Google solicitó activar la verificación en dos pasos; el usuario indicó que ya la activó. El pago único de 25 USD, las credenciales, los documentos y la verificación de identidad se completan directamente por el titular en Google. No guardar esos datos en el repositorio ni pedir contraseñas por el chat.

El usuario propuso `ai-theatre.rpp@gmail.com` como correo público, pero todavía no ha confirmado su creación. No usarlo como contacto operativo ni afirmar que está disponible hasta comprobarlo con él. El correo de contacto puede ser distinto de la cuenta propietaria de Play Console. La política ofrece mientras tanto el canal existente del proyecto, sin publicar el correo personal observado en Chrome.

Una cuenta personal corresponde a un proyecto del propio titular; una cuenta de organización requiere los datos reales de la entidad. El titular elige y verifica su tipo de cuenta. Las cuentas personales nuevas necesitan al menos 12 participantes inscritos continuamente durante 14 días en **pruebas cerradas**, antes de solicitar acceso a producción; una prueba interna no satisface ese requisito. El plazo empieza con las inscripciones de Google Play, no con la creación de esta documentación ni con las APK anteriores.

## Compilación y firma

- Perfil `beta` de `eas.json`: distribución `store`, AAB, entorno `production`, recurso `medium`; no modifica el perfil `prototype` de APK ni compila iOS.
- Comando: `npm run prototype:check`, revisar `npm run prototype:usage`, y después `npm run beta:android`. Conservar Expo Free, sin complementos ni cargos. La consulta inicial mostró 4/15 compilaciones Android y 3/15 iOS utilizadas, coste estimado cero.
- Identificador Android conservado: `com.kaiserrpp.aitheatre.prototype`. La palabra prototype en el identificador interno no impide el nombre público AI-Theatre; cambiar el identificador crearía otra instalación y otro almacenamiento.
- Versión candidata `2026.11.245`, código Android `6`. El instalador anterior es 232/código 5. El AAB es para Play Console y no se instala pulsándolo como una APK.
- Usar la clave Android que ya gestiona Expo. Al dar de alta **Play App Signing**, revisar cómo importar esa misma clave de firma si se quiere actualizar las APK instaladas sin desinstalar ni perder sus datos. Si Google genera una clave nueva, conservar el mismo package por sí solo no garantiza una actualización compatible. No exportar claves privadas a Git ni crear cuentas de servicio para la primera subida manual.
- Inspeccionar el AAB terminado: paquete, versión/código, SDK objetivo, permisos, certificado y bibliotecas de 64 bits/alineación de 16 KB. Los mínimos vigentes se contrastan en las fuentes oficiales; no basta con que la compilación haya terminado. La aceptación definitiva la valida Google Play.
- `.easignore` mantiene fuera servidor, secretos, PDFs, canciones y herramientas temporales. Inspeccionar el archivo real que se manda a Expo. El contenido de la app se carga desde la web de producción, con el mismo puente de voz nativo existente.

## Ficha preparada

Textos en `distribution/google-play/es-ES/`: título, descripción breve/completa y novedades del código 6. La política pública se sirve en `https://ai-theater.vercel.app/privacidad.html`, accesible desde el menú web y desde la cabecera nativa, incluso antes de pedir micrófono. La explicación inicial nativa menciona el tratamiento del servicio de voz y los informes automáticos.

Antes de enviar a revisión, confirmar el correo público operativo, la titularidad y los derechos sobre los materiales distribuidos. Preparar/revisar icono 512×512, gráfico 1024×500 y al menos dos capturas de la app real. Las capturas de navegador o con hardware simulado sirven para QA y preparación; no acreditan un recorrido acústico de la versión instalada. No utilizar el vídeo privado original ni mensajes de WhatsApp como material promocional.

La ficha no ofrece compras, suscripciones ni anuncios. Confirmar audiencia/edades y completar la clasificación IARC según el contenido realmente accesible; no inventar respuestas. La beta cerrada controla la descarga en Play, pero no añade autenticación a los enlaces existentes de materiales. No anunciar esos enlaces como privados.

## Revisión de Seguridad de los datos

Esta tabla es un inventario de código para completar el formulario, **no una declaración enviada o validada por Google**. Revisar las definiciones vigentes de recogida, cesión y proveedor de servicios antes de responder.

| Función | Tratamiento observado | Revisar en Play Console |
| --- | --- | --- |
| Voz nativa/navegador | El proveedor del teléfono puede reconocer audio en sus servidores; el código no persiste el audio ASR. Vosk/Whisper seleccionados ejecutan modelos locales descargados. | Audio de voz, tratamiento efímero y proveedores reales; no declarar que todo el audio es siempre local. |
| Informes automáticos y parciales | Texto esperado/reconocido, personajes/obra/escena, puntuaciones, actividad/tiempos/errores, user agent, versiones e ID de sesión. Cola local duradera; envío si `feedbackWritable` y no `readOnly`. Sin archivos de voz. | Contenido generado por el usuario, actividad, diagnóstico/rendimiento y posibles identificadores; finalidad de funcionamiento y mejora. |
| Materiales compartidos | PDFs, texto, imágenes o audios que se suben expresamente. Lecturas por enlaces compartidos. | Archivos/documentos, fotos/audio según funciones accesibles; acceso del administrador y del grupo. |
| Análisis PDF opcional | El documento se envía a Gemini si se solicita esa función y está configurada. | Documentos y proveedor de análisis; no describirlo como procesamiento exclusivamente local. |
| Preferencias y calentamiento | Ajustes, rangos, progreso y actividad aproximada guardados localmente. | Distinguir almacenamiento local de información transmitida. |
| Alojamiento/modelos | Vercel, Blob, Supabase cuando esté habilitado, servidores de modelos y servicios de voz pueden recibir datos de conexión. | Prácticas de cada proveedor/SDK y transporte; no prometer que no existe recogida alguna. |

No se solicitan contactos, ubicación ni identificadores publicitarios en el código de esta entrega. La app no crea cuentas propias de alumnos; la cuenta de Google Play del tester no es una cuenta creada dentro de AI-Theatre. La retirada de datos enviados se solicita al responsable; borrar/desinstalar sólo elimina las copias locales según el sistema. La política describe que no hay un borrado automático por plazo y que algunos informes históricos de Blob tienen URL pública. No afirmar que esos informes ya se han migrado a almacenamiento privado.

## Alta de la beta cuando la cuenta esté lista

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
