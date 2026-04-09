@echo off
chcp 65001 > nul

:: 1. Comprobamos si el usuario ha pasado un parámetro (el mensaje)
if "%~1"=="" (
    echo ❌ Error: Necesitas poner un mensaje para el commit.
    echo 💡 Ejemplo: .\deploy.bat "Añadido reconocimiento de voz"
    exit /b 1
)

echo 🔢 1/4: Incrementando versión automáticamente...
:: Ejecutamos el script de Node y guardamos la salida en una variable
for /f "tokens=*" %%i in ('node increment-version.js') do set NEW_VERSION=%%i

echo ✅ Nueva versión generada: v%NEW_VERSION%

echo 📦 2/4: Preparando archivos (git add .) ...
git add .

echo 📝 3/4: Creando commit con versión v%NEW_VERSION% ...
:: El commit incluirá la versión automática y tu mensaje
git commit -m "v%NEW_VERSION%: %~1"

echo 🚀 4/4: Subiendo a GitHub y Vercel ...
git push

echo.
echo ✨ ¡Todo listo! Versión v%NEW_VERSION% enviada a producción.