@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Workflow Studio
color 0A

:: Ensure working directory is the script folder
cd /d "%~dp0"

echo.
echo  ============================================
echo   ProcSnap - Workflow Studio
echo   Starting up...
echo  ============================================
echo.

:: ─────────────────────────────────────────────
:: STEP 1: Check Python installation
:: ─────────────────────────────────────────────
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
            if exist "%%P\python.exe" (
                set "PY_CMD=%%P\python.exe"
            )
        )
    )
)

if "%PY_CMD%"=="" (
    echo [!] Python not found. Attempting to install via winget...
    winget install --id Python.Python.3.13 --scope user --accept-source-agreements --accept-package-agreements --silent
    if errorlevel 1 (
        echo [ERROR] Could not install Python automatically.
        echo         Please install Python 3.10+ from https://www.python.org/downloads/
        echo         Make sure to tick "Add Python to PATH" during installation.
        pause
        exit /b 1
    )
    set "PY_CMD=python"
)

echo [OK] Python detected.

:: ─────────────────────────────────────────────
:: STEP 2: Create virtual environment if missing
:: ─────────────────────────────────────────────
if not exist "backend\.venv\" (
    echo [..] Creating virtual environment (first run only)...
    !PY_CMD! -m venv backend\.venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created.
) else (
    echo [OK] Virtual environment exists.
)

:: ─────────────────────────────────────────────
:: STEP 3: Install / upgrade dependencies
:: ─────────────────────────────────────────────
echo [..] Checking and installing dependencies...
backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies. Check your internet connection.
    pause
    exit /b 1
)
echo [OK] Dependencies ready.

:: ─────────────────────────────────────────────
:: STEP 4: Start backend server (with automatic port fallback)
:: ─────────────────────────────────────────────
set "APP_PORT=8000"
for /L %%P in (8000, 1, 8010) do (
    netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul 2>&1
    if errorlevel 1 (
        set "APP_PORT=%%P"
        goto :PortFound
    )
)
:PortFound

echo.
if not "%APP_PORT%"=="8000" (
    echo [NOTE] Port 8000 was busy. Automatically falling back to port %APP_PORT%
)
echo [..] Starting ProcSnap server on http://127.0.0.1:%APP_PORT% ...
echo [..] Opening dashboard in browser...
echo.
start "" "http://127.0.0.1:%APP_PORT%/dashboard/dashboard.html"
backend\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port %APP_PORT% --app-dir backend

pause
