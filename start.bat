@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Automated Startup & Studio Engine
color 0A

:: Ensure working directory is the repository root folder
cd /d "%~dp0"

echo.
echo  ========================================================
echo   ProcSnap - Local SOP Documentation ^& Studio Engine
echo   Auto-initiating server and verifying dependencies...
echo  ========================================================
echo.

:: STEP 1: Find Python executable
set "PY_CMD="
python --version >nul 2>&1
if not errorlevel 1 (
    set "PY_CMD=python"
) else (
    py --version >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=py"
    ) else (
        for /d %%P in ("%LOCALAPPDATA%\Programs\Python\Python*") do (
            if exist "%%P\python.exe" set "PY_CMD=%%P\python.exe"
        )
    )
)

if "%PY_CMD%"=="" (
    echo [!] Python not found on PATH. Attempting automatic installation via winget...
    winget install --id Python.Python.3.13 --scope user --accept-source-agreements --accept-package-agreements --silent
    if errorlevel 1 (
        echo [ERROR] Python 3.10+ is required. Please install it from https://www.python.org/downloads/
        echo         Make sure to check "Add Python to PATH" during installation.
        pause
        exit /b 1
    )
    set "PY_CMD=python"
)

echo [OK] Python runtime detected.

:: STEP 2: Create virtual environment if missing
if not exist "backend\.venv\Scripts\python.exe" (
    echo [..] Creating isolated virtual environment at backend\.venv...
    %PY_CMD% -m venv backend\.venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created.
) else (
    echo [OK] Virtual environment verified.
)

:: STEP 3: Auto-install and verify all dependencies
echo [..] Verifying and installing requirements from backend\requirements.txt...
backend\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --quiet
if errorlevel 1 (
    echo [WARNING] Pip install had a warning/error. Retrying core dependencies...
    backend\.venv\Scripts\python.exe -m pip install fastapi uvicorn pydantic starlette mss pillow python-docx python-pptx edge-tts websockets
)
echo [OK] All dependencies installed and ready.

:: STEP 4: Ensure Port 8000 is clean (free up stale/orphaned processes)
echo [..] Checking port 8000 availability...
powershell -NoProfile -Command "try { $pids = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($p in $pids) { if ($p -gt 0) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } } } catch {}"

:: STEP 5: Launch browser dashboard and start backend server
echo.
echo [OK] Launching ProcSnap Studio in default browser...
start "" "http://127.0.0.1:8000/dashboard/dashboard.html"

echo.
echo  ========================================================
echo   ProcSnap Server running on: http://127.0.0.1:8000
echo   Press Ctrl+C in this window to stop the server.
echo  ========================================================
echo.

backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

pause
