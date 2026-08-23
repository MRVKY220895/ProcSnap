@echo off
title ProcSnap Server & AI Setup
cd /d "%~dp0"

echo =========================================================
echo               PROCSNAP OFFLINE AI SETUP
echo =========================================================

where ollama >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%USERPROFILE%\AppData\Local\Programs\Ollama\ollama.exe" (
        set "OLLAMA_PATH=%USERPROFILE%\AppData\Local\Programs\Ollama\ollama.exe"
    ) else (
        echo Ollama AI engine not detected. Downloading installer...
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile 'OllamaSetup.exe'"
        echo Installing Ollama silently (no admin permissions required)...
        OllamaSetup.exe /VERYSILENT
        del OllamaSetup.exe
        set "OLLAMA_PATH=%USERPROFILE%\AppData\Local\Programs\Ollama\ollama.exe"
    )
) else (
    set "OLLAMA_PATH=ollama"
)

echo Starting Ollama AI engine...
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe">NUL
if "%errorlevel%"=="1" (
    start "" "%OLLAMA_PATH%" serve
    echo Waiting for Ollama engine to boot...
    timeout /t 5 /nobreak >nul
) else (
    echo Ollama AI engine is already running.
)

echo Pre-loading lightweight AI models (runs in background)...
start /b "" ollama pull qwen2.5:0.5b
start /b "" ollama pull moondream

echo Starting ProcSnap Backend...
if not exist .venv (
    echo Virtual environment (.venv) not found! Please run setup or create a .venv.
    pause
    exit /b
)
call .venv\Scripts\activate
start "" "http://127.0.0.1:8000/dashboard/dashboard.html"
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
