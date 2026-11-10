# Memoria e instrucciones del proyecto

## Entregar siempre publicado

Instrucción expresa del usuario, 10 de noviembre de 2026: **publicar la versión siempre que hagamos cambios en la aplicación**. El usuario prueba la app publicada y no puede publicar por su cuenta cuando está ensayando.

- Esta instrucción autoriza las publicaciones posteriores de los cambios solicitados. No volver a pedir confirmación para publicar, salvo que el usuario indique expresamente que ese cambio debe quedarse sin publicar.
- Completar el trabajo con incremento de versión, verificaciones, commit, push y publicación en producción. No finalizar una tarea dejando el cambio solo en local.
- Esperar a que termine el despliegue y comprobar que la URL de producción sirve la versión nueva. Un push o un despliegue pendiente no cuentan como publicación terminada.
- En la respuesta final indicar la versión publicada y el enlace de producción. Si hay un bloqueo real, explicarlo claramente; no afirmar que está publicado sin verificarlo.

## Publicación y verificación

- Repositorio: `https://github.com/kaiserrpp/ai-theater.git`. La rama de producción es `main`; el proyecto de Vercel es `ai-theater`.
- Conservar la separación de almacenamiento `production`, `preview` y `development`.
- Incrementar la versión de `package.json` y `app.json` con el formato existente y mantener sincronizada la versión raíz de `package-lock.json`.
- Antes de publicar ejecutar `npm test`, `npm run lint`, `npx tsc --noEmit` y `npx expo export --platform web`.
- Añadir a Git solo los archivos que pertenecen al cambio. El script antiguo `deploy.bat` usa `git add .`; no ejecutarlo sin corregir esa selección.
- No publicar `.env*`, `pdf/`, `codex-handoff.md`, `future-improvements.md`, `prompt-retomar-ai-theatre.md`, `stack-tecnico.md`, `src/apply_patch_test.txt`, `src/screens/HomeScreen.next.tsx`, `src/screens/HomeScreen.refresh.tsx` ni imágenes temporales sin usar.

## Ensayo

- Los cambios de escena deben anunciar por voz el título y esperar a «adelante» o al botón «Siguiente escena»; nunca avanzar solo por tiempo, silencio o fin de un audio.
- El usuario ensaya en iPhone con Safari. La calibración debe activar el audio desde el toque inicial y distinguir los fallos de voz, pitido y micrófono. Las pruebas automatizadas no sustituyen la comprobación en un iPhone real.
- El 10 de noviembre de 2026 el usuario indicó que, tras actualizar a iOS 27.2, se oye la música pero no la voz ni el pitido, sin mensaje de error. La causa no está confirmada. `/prueba-audio.html` permite probar voz, pitido y entrada del micro por separado y copiar un informe. Los eventos de reproducción del navegador no prueban que el usuario haya oído sonido; conservar su confirmación independiente.
