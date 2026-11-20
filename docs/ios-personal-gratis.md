# AI-Theatre en tu iPhone sin membresía de pago

Este proceso genera una app **Release para un iPhone real**, con la interfaz web publicada y el puente de voz nativo actual. El IPA se entrega **sin firmar**: AltStore Classic lo firma con tu cuenta Apple gratuita al instalarlo desde Windows. No publica en App Store ni TestFlight y no renueva la membresía antigua de trabajo.

## Primer instalador verificado · 20 de noviembre de 2026

- **[Descargar AI-Theatre 2026.11.251 para iPhone personal](https://github.com/kaiserrpp/ai-theater/releases/download/ios-personal-2026.11.251-2/AI-Theatre-2026.11.251-iPhone-personal-unsigned.ipa)**: 11.151.127 bytes, build 6, sin firmar.
- [Compilación terminada correctamente](https://github.com/kaiserrpp/ai-theater/actions/runs/44732274204), fuente `3869b736839de2db5cd870c17e408d3c9601fd00`, Xcode 16.4.
- SHA256 `68ac8a1dfa266479d55b953f3e64418135f499bc7d1f40502dad4c29abe8bf1f`.
- El IPA descargado se ha comprobado de nuevo en Windows: cuatro ejecutables ARM64/iPhoneOS, versión, permisos, bundle JS y hashes de los 16 archivos fuente correctos. No se ha instalado ni probado acústicamente en un iPhone físico.

En este ordenador están el IPA, la guía, AltServer y los instaladores oficiales de iTunes/iCloud en `Descargas\AI-Theatre-iPhone-personal`. La preparación ha descargado los instaladores; no los ha instalado ni ha introducido credenciales Apple. iTunes e iCloud tienen firma válida de Apple. El ZIP oficial de AltServer incluye un MSI y un `setup.exe` sin firma Authenticode; se conserva su origen y hash en `herramientas-origen-y-hashes.json`.

## Qué está comprobado y qué falta

El workflow verifica la plataforma iPhoneOS, los ejecutables ARM64, la versión, el identificador, las descripciones de micrófono/reconocimiento y el bundle JavaScript incluido. Rechaza binarios de simulador, perfiles de firma y archivos de credenciales. Esto no prueba la instalación ni el sonido o el reconocimiento en un teléfono físico.

La compilación anterior `ios-validation` es de simulador y **no se puede instalar en tu iPhone**. No se reutiliza como instalador.

## Compilar desde Windows

1. Abrir [iOS personal gratuito en GitHub Actions](https://github.com/kaiserrpp/ai-theater/actions/workflows/ios-personal.yml).
2. Pulsar **Run workflow**, seleccionar la rama publicada y esperar a que termine correctamente.
3. Abrir el enlace de la ejecución o la [lista de versiones personales](https://github.com/kaiserrpp/ai-theater/releases).
4. Descargar `AI-Theatre-VERSION-iPhone-personal-unsigned.ipa`, `build-info.json` y `SHA256SUMS.txt`.
5. Comprobar la suma en PowerShell:

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\ruta\AI-Theatre-VERSION-iPhone-personal-unsigned.ipa'
   ```

El hash debe coincidir con `SHA256SUMS.txt`. El JSON identifica la fuente exacta y los binarios inspeccionados. El IPA no instala nada por sí solo al abrirlo o descargarlo.

Para comprobar localmente la selección de archivos: `npm run ios:personal:check`. `npm run ios:personal:build` sólo compila en macOS y se detiene en Windows; no contrata Expo ni pide una cuenta Apple. `py scripts/verify-ios-personal.py ARCHIVO.ipa --version VERSION --bundle-id com.kaiserrpp.aitheatre.prototype` verifica el resultado también desde Windows (en macOS usar `python3`).

## Coste de esta compilación

El workflow sólo arranca manualmente y sólo en el repositorio **público**. Utiliza `macos-15-intel`, una máquina estándar gratuita de GitHub; si el repositorio pasa a privado, el trabajo se omite. No usa máquinas grandes, Expo Build, cachés de Actions ni artefactos de Actions facturables. Los instaladores se guardan como assets de una prerelease propia de GitHub, sin límites de almacenamiento total o ancho de banda de releases según su documentación.

Las credenciales Apple y certificados no se suben a GitHub. El trabajo sólo recibe el token temporal del repositorio en el paso que publica la prerelease. No modifica permisos del repositorio, planes de pago ni facturación. Se conserva la separación del almacenamiento de Vercel; la app personal abre la misma URL de producción configurada en `app.json`.

## Instalar con AltStore Classic

Seguir la [guía oficial para Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows). Usar **Classic**, no AltStore PAL.

1. Preparar las versiones de iTunes/iCloud compatibles con AltServer. Revisar primero lo instalado: no desinstalar aplicaciones Apple ni sustituirlas automáticamente.
2. Descargar AltServer de la web oficial, instalarlo y conectar el iPhone por USB, desbloqueado. Las confirmaciones de confianza, el modo de desarrollador y los permisos se completan personalmente en el dispositivo.
3. Instalar AltStore Classic mediante AltServer. Introducir la cuenta Apple, la contraseña y los códigos directamente en su diálogo; no enviarlos por chat ni guardarlos en el repositorio. Una membresía individual caducada no se renueva automáticamente por este procedimiento; si Apple rechaza la provisión gratuita de esa cuenta, conservar el error exacto y consultar el caso de vinculación pendiente antes de cambiar identidades.
4. Pasar el IPA al iPhone (por Archivos/iCloud Drive u otro medio elegido) y abrirlo desde **AltStore → My Apps → +**. AltStore realiza la firma personal.
5. Abrir AI-Theatre y completar sus permisos y preparación habituales. Seleccionar el reconocimiento nativo Apple para comprobar este instalador.

La firma gratuita **caduca a los siete días**. Antes de que caduque, renovar desde AltStore con AltServer disponible en el PC; puede intentar hacerlo en segundo plano. Apple limita a tres las apps de este tipo activas por dispositivo, contando las que ya utilices. No es una instalación permanente ni distribución para todo el grupo. El PC no ejecuta el ensayo: se necesita para instalar/renovar la firma; la aplicación utiliza la web publicada durante el ensayo.

## Primera prueba física

Comprobar voz, micrófono y una réplica real en español y otra en inglés; una pausa larga debe conservar las palabras. Verificar que entrada y voz no se solapan, pausa/reanudación y retorno del fondo. Probar una canción y el calentamiento. Enviar un informe de prueba identificado como tal; `runtime: native_ios` y `nativeAppVersion` deben corresponder al nuevo IPA. La configuración del guion y los motores existentes no se cambian por este proceso.

Si la instalación o la firma fallan, conservar el texto exacto del error. No borrar la app ni sus datos como primer paso. La nueva app tiene almacenamiento local separado de Safari, aunque comparte los materiales publicados.

## Referencias

- [Máquinas estándar de GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- [Almacenamiento y ancho de banda de releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).
- [Instalación de AltStore en Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows).
- [Caducidad y límites de AltStore](https://faq.altstore.io/altstore-classic/your-altstore).
- [Cuenta gratuita y equipos personales de Apple](https://developer.apple.com/help/account/basics/about-your-developer-account/).
