@echo off
setlocal EnableExtensions

rem =====================================================================
rem   Qwen3Prime
rem   Instalador Independiente para Windows 11 (Python 3.12 recomendado)
rem =====================================================================

cd /d "%~dp0"

echo =====================================================================
echo   Qwen3Prime
echo   Instalacion de entorno virtual independiente (.venv)
echo =====================================================================
echo.

:DETECT_PYTHON
set "PYTHON_EXE="

rem 1. Priorizar Python 3.12 en rutas estandar o py launcher
call :PROBE_EXE "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
call :PROBE_EXE "C:\Python312\python.exe"
call :PROBE_EXE "C:\Program Files\Python312\python.exe"
call :PROBE_PY_LAUNCHER -3.12

rem 2. Respaldo: Python 3.11 / 3.10 / cualquier Python 3.10+ real
call :PROBE_PY_LAUNCHER -3.11
call :PROBE_PY_LAUNCHER -3.10
call :PROBE_EXE "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
call :PROBE_EXE "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
call :PROBE_PY_LAUNCHER -3
call :PROBE_EXE "python"

if defined PYTHON_EXE goto :FOUND_PY

echo [AVISO] No se encontro ningun interprete real de Python 3.10 - 3.12 instalado.
echo.
where py >nul 2>nul
if not errorlevel 1 (
    echo Windows detecto el gestor 'py', pero falta descargar el runtime de Python 3.12.
    echo Puedes elegir una opcion:
    echo   [1] Instalar Python 3.12 automaticamente ahora usando: py install 3.12
    echo   [2] Escribir manualmente la ruta a un python.exe existente
    echo   [3] Cancelar y descargar Python 3.12 desde https://www.python.org/downloads/
    echo.
    set /p PY_CHOICE="Elige 1, 2 o 3: "
    if "%PY_CHOICE%"=="1" (
        echo.
        echo Ejecutando: py install 3.12 ...
        py install 3.12
        goto :DETECT_PYTHON
    )
    if "%PY_CHOICE%"=="2" (
        set /p CUSTOM_PY="Ruta completa a python.exe: "
        if defined CUSTOM_PY (
            set "CUSTOM_PY=%CUSTOM_PY:"=%"
            call :PROBE_EXE "%CUSTOM_PY%"
            if defined PYTHON_EXE goto :FOUND_PY
        )
    )
) else (
    echo Descarga e instala Python 3.12 (64-bit) desde:
    echo   https://www.python.org/downloads/
    echo Durante la instalacion marca la casilla "Add Python to PATH".
)
echo.
pause
exit /b 1

:FOUND_PY
for /f "delims=" %%V in ('"%PYTHON_EXE%" --version 2^>^&1') do set "PY_VER=%%V"
echo [OK] Python detectado: %PY_VER%
echo      Ruta: %PYTHON_EXE%
echo.

rem 3. Crear entorno virtual propio en .venv
if not exist "%~dp0.venv\Scripts\python.exe" (
    echo [1/4] Creando entorno virtual independiente en .venv ...
    "%PYTHON_EXE%" -m venv "%~dp0.venv"
    if errorlevel 1 (
        echo [ERROR] No se pudo crear el entorno virtual .venv.
        pause
        exit /b 1
    )
) else (
    echo [1/4] Entorno virtual .venv ya existe; se reutilizara para actualizar paquetes.
)

set "VENV_PY=%~dp0.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    echo [ERROR] No se encontro "%VENV_PY%" tras crear el entorno virtual.
    pause
    exit /b 1
)

echo [2/4] Actualizando pip, setuptools y wheel...
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 (
    echo [ERROR] Fallo la actualizacion de pip.
    pause
    exit /b 1
)

rem 4. Detectar GPU NVIDIA para instalar PyTorch CUDA 12.8 (incl. RTX 5060) o CPU
echo.
echo [3/4] Detectando aceleracion GPU NVIDIA CUDA...
nvidia-smi >nul 2>nul
if not errorlevel 1 (
    echo [OK] GPU NVIDIA detectada mediante nvidia-smi.
    echo Instalando PyTorch con soporte CUDA 12.8 compatible RTX 30xx / 40xx / 50xx...
    "%VENV_PY%" -m pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
    if errorlevel 1 (
        echo [AVISO] Fallo el indice cu128; intentando indice PyTorch por defecto...
        "%VENV_PY%" -m pip install --upgrade torch torchvision torchaudio
    )
) else (
    echo [INFO] No se detecto GPU NVIDIA dedicada. Modo CPU para Ryzen 5 5600G.
    echo Instalando PyTorch para CPU...
    "%VENV_PY%" -m pip install --upgrade torch torchvision torchaudio
)
if errorlevel 1 (
    echo [ERROR] No se pudo instalar PyTorch.
    pause
    exit /b 1
)

rem 5. Instalar qwen-tts y dependencias del estudio
echo.
echo [4/4] Instalando qwen-tts, FastAPI y utilidades de audio...
"%VENV_PY%" -m pip install --upgrade -r "%~dp0requirements.txt"
if errorlevel 1 (
    echo [ERROR] Fallo la instalacion de dependencias en requirements.txt.
    pause
    exit /b 1
)

rem 6. Comprobar si dist/index.html existe; si falto al descargar, intentar compilar si npm esta disponible
if not exist "%~dp0dist\index.html" (
    where npm >nul 2>nul
    if not errorlevel 1 (
        echo.
        echo [Frontend] Compilando interfaz web en dist/...
        pushd "%~dp0"
        call npm install && call npm run build
        popd
    ) else (
        echo.
        echo [AVISO] No se encontro dist\index.html ni npm en el equipo.
        echo Verifica que la carpeta dist\ este incluida junto al proyecto.
    )
)

echo.
echo [Verificacion rapida de modulos instalados]
"%VENV_PY%" -c "import torch, qwen_tts, fastapi, soundfile; print('PyTorch:', torch.__version__, '| CUDA disponible:', torch.cuda.is_available(), '| qwen_tts: OK | FastAPI: OK')"
if errorlevel 1 (
    echo [AVISO] Algunos modulos no respondieron durante la verificacion. Revisa los mensajes anteriores.
)

echo.
echo =====================================================================
echo   INSTALACION COMPLETADA
echo =====================================================================
echo  1. Copia tu voz principal "Brian Warm Clonacion Voz.wav" dentro de:
echo     %~dp0voices\
echo  2. Ejecuta "Iniciar_Qwen3Prime.bat" para abrir el estudio.
echo  3. Los modelos Qwen3-TTS 0.6B y 1.7B se descargaran automaticamente
echo     desde Hugging Face la primera vez que los cargues.
echo =====================================================================
pause
exit /b 0

:PROBE_EXE
if defined PYTHON_EXE goto :eof
set "CAND_EXE="
del /q "%TEMP%\qwen_py_check.txt" >nul 2>nul
"%~1" -c "import sys, venv; assert sys.version_info >= (3,10); print(sys.executable)" > "%TEMP%\qwen_py_check.txt" 2>nul
if exist "%TEMP%\qwen_py_check.txt" (
    set /p CAND_EXE=<"%TEMP%\qwen_py_check.txt"
)
if defined CAND_EXE if exist "%CAND_EXE%" (
    set "PYTHON_EXE=%CAND_EXE%"
)
del /q "%TEMP%\qwen_py_check.txt" >nul 2>nul
goto :eof

:PROBE_PY_LAUNCHER
if defined PYTHON_EXE goto :eof
set "CAND_EXE="
del /q "%TEMP%\qwen_py_check.txt" >nul 2>nul
py %~1 -c "import sys, venv; assert sys.version_info >= (3,10); print(sys.executable)" > "%TEMP%\qwen_py_check.txt" 2>nul
if exist "%TEMP%\qwen_py_check.txt" (
    set /p CAND_EXE=<"%TEMP%\qwen_py_check.txt"
)
if defined CAND_EXE if exist "%CAND_EXE%" (
    set "PYTHON_EXE=%CAND_EXE%"
)
del /q "%TEMP%\qwen_py_check.txt" >nul 2>nul
goto :eof
