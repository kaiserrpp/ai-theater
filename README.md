# AI-Theatre

## Inicio y ensayo

**Inicio** da acceso a **Ensayar escenas**, **Escuchar y practicar** y al último ensayo pendiente. La navegación inferior mantiene **Inicio / Ensayar / Canciones**. En Ensayar puedes alternar **Audiciones / Obra**, elegir tus personajes y practicar tus escenas o todas.

Las operaciones de importación, edición, publicación y cambio de obra están en **⋯ → Materiales y gestión** y **⋯ → Cambiar obra**. Escuchar y ensayar no requieren acceso de gestión. La biblioteca musical separa los audios con voz y karaoke, con reproducción, búsqueda de posición, repetición, velocidad y letra cuando está disponible; al cambiar de pestaña conserva un minirreproductor.

El modo inteligente es la opción inicial en navegadores con reconocimiento. Una elección expresa de manual o silencio se conserva. **⋯ → Micrófono y voz**, también accesible desde el botón del micro durante el ensayo, permite cambiarlo. Antes de cada ensayo se comprueba el altavoz y, en los modos con micrófono, se miden el ruido de fondo y la voz. La preparación se repite siempre, sin restaurar una calibración guardada. En manual se confirma el altavoz y no se solicita el micrófono.

La transcripción se muestra por defecto. **Mostrar transcripción** recuerda una desactivación expresa en este dispositivo; ocultarla no detiene la escucha ni la comprobación de palabras. Los detalles de coincidencia e informes quedan dentro de las opciones del micro. El ensayo ofrece controles inferiores de anterior, pausa/reanudar y siguiente.

## Audiciones de escenas

Cada obra compartida puede contener mini-guiones de audición independientes del guion completo.

1. Abre una obra en **⋯ → Cambiar obra**. Para crearla sin guion usa **Crear o importar una obra**; el guion completo es opcional.
2. Entra en **⋯ → Materiales y gestión → Mini-guiones de audición** y activa **Administrar materiales** con la clave existente.
3. Pulsa **Importar mini-guion PDF**.
4. Revisa el título, los personajes, el orden, las réplicas y las acotaciones. Puedes corregir un personaje en todo el mini-guion, añadir réplicas o escribir una escena a mano.
5. Guarda. Para practicar vuelve a Inicio y entra en **Ensayar → Audiciones**, elige el mini-guion y tus personajes. **Mis escenas** y **Todas** conservan el progreso por separado.

Durante la revisión, **Guardar mini-guion** y **Cancelar revisión** permanecen en una barra inferior fuera del contenido que se desplaza. Los errores y la confirmación de descarte también aparecen en esa barra. El texto completo de un mini-guion guardado se abre únicamente al pulsar **Ver texto del mini-guion**.

En el avance inteligente, después de calibrar, **Comprobar escucha** inicia el reconocimiento directamente dentro del toque del usuario. El medidor de calibración libera su captura antes de abrir ese servicio. Todavía no se entra a la escena: se reproduce otra prueba de voz con el reconocimiento abierto y el usuario confirma **Sí, la oigo. Empezar ensayo**. Si falla el audio, la calibración o el reconocimiento, se conserva la escena y se puede reintentar; la app no salta automáticamente a un ensayo sin comprobar.

El panel de tu turno muestra si el micrófono está abierto y permite **Activar micrófono** con un toque, también cuando todavía no hay transcripción. Los errores distinguen la autorización del micrófono de la disponibilidad del servicio y conservan el código y mensaje originales del navegador para diagnosticar un fallo real. No se repiten solicitudes en bucle ni se da por hecho que el usuario debe cambiar sus ajustes.

Si iOS devuelve `service-not-allowed` con `Speech recognition service permission check has failed`, la app muestra una guía específica: **Ajustes → Privacidad y seguridad → Reconocimiento de voz**, con la entrada del navegador que se debe activar (Safari con la brújula azul). **Ya lo he activado, comprobar** vuelve a solicitar el servicio sin cambiar la escena ni el personaje. El permiso inicial se pide mediante el inicio normal del reconocimiento; una denegación guardada requiere el cambio en Ajustes. La web no dispone de un enlace documentado y fiable a ese panel concreto, por lo que no utiliza esquemas privados de iOS. El código y mensaje técnicos quedan disponibles en **Ver detalle técnico**.

Quien abra el enlace de la obra puede leer y ensayar sus escenas sin clave. La creación, modificación, eliminación y publicación de materiales requieren la clave de gestión. Esta se mantiene únicamente en memoria durante la sesión de la app. El servidor utiliza `SONG_ADMIN_PASSWORD` y `BLOB_READ_WRITE_TOKEN`, como el gestor de canciones.

Las elecciones y el progreso de cada mini-guion se recuerdan en el dispositivo. Si cambia el texto, el progreso se reinicia y se conservan los personajes elegidos que sigan participando. Las cuentas y la sincronización entre dispositivos quedan para otra fase.

La importación web/PWA usa el lector de PDF existente y requiere texto extraíble; no hace OCR. En plataformas nativas se reutiliza el analizador de Gemini existente. Las versiones con voz y karaoke de los fragmentos musicales pertenecen a la siguiente fase.

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
