@echo off
setlocal EnableExtensions

rem =====================================================================
rem   Qwen3Prime
rem   Lanzador local en Windows 11 (127.0.0.1:8000)
rem =====================================================================

cd /d "%~dp0"

set "VENV_PY=%~dp0.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo =====================================================================
    echo [AVISO] No se encontro el entorno virtual .venv en este estudio.
    echo Ejecuta primero "install.bat" para instalar Python 3.12, PyTorch y qwen-tts.
    echo =====================================================================
    pause
    exit /b 1
)

echo =====================================================================
echo   Qwen3Prime
echo   Iniciando servidor local seguro (puerto preferido 8000)...
echo   Cierra esta ventana o pulsa Ctrl+C para detener el servidor.
echo =====================================================================
echo.

"%VENV_PY%" "%~dp0backend\main.py" --port 8000

echo.
echo El servidor se ha detenido.
pause
