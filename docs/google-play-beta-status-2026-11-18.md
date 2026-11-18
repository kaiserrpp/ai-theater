# Estado de la beta Google Play · 18/11/2026

La beta cerrada aún no está distribuida ni enviada a revisión. Este estado actualiza la preparación anterior de [la beta](google-play-beta.md).

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
- Play ha procesado el AAB 247 y está adjunto al borrador cerrado Alpha, con nombre y novedades guardados. La validación ya no muestra el error de firma; muestra dos bloqueos: terminar la configuración de la app y completar la ficha.
- Copia en Downloads/AI-Theatre-GooglePlay-beta. No se ha generado otra APK. No equivale a instalación ni ensayo acústico físico.

## Web y verificaciones

425 pruebas, lint, TypeScript y exportación web correctos; también `prototype:check`. Web **247 publicada y verificada** en [producción](https://ai-theater.vercel.app), bundle `AppEntry-dabede86bf3524cf42fcce5a6ee3feee.js`, con versión 247 en el contenido y en el módulo de Comparativa.

La política pública coincide byte a byte con `public/privacidad.html`, SHA256 `fec585e49be1a642489c1d6a8d24b1db5675c19cb39b1370b9bb5803233788cf`. El almacenamiento de producción sigue `readOnly: true` y `feedbackWritable: false`: las lecturas y ensayos continúan, las escrituras compartidas están protegidas y los informes nuevos quedan pendientes localmente. No se ha activado Supabase en esta entrega.

## Declaraciones y pendientes

El titular confirma participantes adultos y autorización para distribuir los materiales a esos participantes. Salud está guardada sin funciones de salud. La ficha española tiene textos, icono propio y gráfico guardados como borrador; faltan las capturas.

Seguridad de los datos está completa e importada mediante el CSV oficial, guardada **como borrador**. Declara fotos/vídeos, voz/música/otros audios, archivos/documentos, interacciones, otro contenido generado por el usuario y diagnósticos. No declara identificadores de dispositivo por el mero ID de sesión: la definición de Google excluye identificadores de evento que no permitan vincular un dispositivo, navegador o app concretos. El almacenamiento exclusivamente local se distingue de la recogida fuera del dispositivo. No se promete tratamiento efímero de todos los servicios de voz. Para finalizar esta sección, Play exige completar antes la audiencia objetivo.

Pendientes de respuesta del titular:

1. Autorizar las capturas preparadas de la interfaz web sin el contraste previo con Android instalado, o hacer ese contraste. No se han subido como si fueran capturas nativas.
2. Autorizar facilitar la contraseña administrativa existente exclusivamente en el formulario privado de acceso para revisores de Play. No se ha transmitido. La gestión administrativa está restringida y no se ha declarado acceso irrestricto a toda la app. Play bloquea audiencia objetivo hasta terminar ese formulario.
3. Aceptar los [Términos de Uso de IARC](https://web.iarcservices.com/terms) para continuar su cuestionario. Categoría y contacto público preparados; la casilla legal permanece sin marcar.

Después: finalizar audiencia 18+, clasificación IARC y Seguridad de los datos, completar ficha, validar y enviar exclusivamente la prueba cerrada a revisión. Esperar y comprobar el estado disponible y el enlace real de participación antes de afirmar que la beta está distribuida. Se mantienen España y la lista de testers previamente autorizada. No activar producción pública ni repetir verificaciones de cuenta.
