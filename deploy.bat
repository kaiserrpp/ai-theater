@echo off
chcp 65001 > nul

:: Comprobamos si el usuario ha pasado un parámetro (el mensaje)
if "%~1"=="" (
    echo ❌ Error: Necesitas poner un mensaje para el commit.
    echo 💡 Ejemplo de uso: .\deploy.bat "v2026.04.003: Añadido reconocimiento de voz"
    exit /b 1
)

echo 📦 1/3: Preparando archivos (git add .) ...
git add .

echo 📝 2/3: Creando commit ...
git commit -m "%~1"

echo 🚀 3/3: Subiendo a la nube (git push) ...
git push

echo.
echo ✅ ¡Completado! Vercel ya esta compilando tu nueva version.