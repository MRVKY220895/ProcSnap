@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Repair & Reconfigure Tool
color 0E

set "INSTALL_DIR=%LOCALAPPDATA%\ProcSnap"
set "SRC_DIR=%~dp0"
if not exist "%INSTALL_DIR%" set "INSTALL_DIR=%SRC_DIR%"

:MENU
cls
echo ===============================================================================
echo                    ProcSnap - Repair & Reconfigure Tool
echo ===============================================================================
echo.
echo Select the component you want to re-run or repair:
echo.
echo   [1] Reinstall / update Python backend dependencies
echo   [2] Re-create Desktop & Start Menu shortcuts
echo   [3] Re-open Browser Extension installer (Chrome, Edge, Brave, Opera, Vivaldi)
echo   [4] Reset & rebuild Python virtual environment (.venv)
echo   [5] Perform Full Re-installation
echo   [6] Launch ProcSnap Studio
echo   [7] Exit
echo.
set /p CHOICE="Enter option (1-7): "

if "%CHOICE%"=="1" goto REPAIR_DEPS
if "%CHOICE%"=="2" goto REPAIR_SHORTCUTS
if "%CHOICE%"=="3" goto REPAIR_EXT
if "%CHOICE%"=="4" goto REPAIR_VENV
if "%CHOICE%"=="5" goto FULL_REINSTALL
if "%CHOICE%"=="6" goto LAUNCH
if "%CHOICE%"=="7" exit /b 0
goto MENU

:REPAIR_DEPS
echo.
echo [..] Reinstalling Python dependencies...
cd /d "%INSTALL_DIR%"
if exist "backend\.venv\Scripts\python.exe" (
    backend\.venv\Scripts\python.exe -m pip install -q --upgrade pip
    backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
    echo [✓] SUCCESS: Dependencies reinstalled.
) else (
    echo [✗] Error: Virtualenv missing. Please run option 4 first.
)
pause
goto MENU

:REPAIR_SHORTCUTS
echo.
echo [..] Re-creating shortcuts...
cscript //nologo "%INSTALL_DIR%\create_desktop_shortcut.vbs" >nul 2>&1
echo [✓] SUCCESS: Shortcuts restored to Desktop and Start Menu.
pause
goto MENU

:REPAIR_EXT
echo.
call "%INSTALL_DIR%\install_extension.bat"
goto MENU

:REPAIR_VENV
echo.
echo [..] Rebuilding virtual environment...
cd /d "%INSTALL_DIR%"
if exist "backend\.venv\" rmdir /S /Q "backend\.venv" >nul 2>&1
python -m venv backend\.venv
if errorlevel 1 (
    py -m venv backend\.venv
)
if exist "backend\.venv\Scripts\python.exe" (
    echo [..] Installing requirements...
    backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
    echo [✓] SUCCESS: Virtual environment rebuilt.
) else (
    echo [✗] FAILED: Could not create virtual environment.
)
pause
goto MENU

:FULL_REINSTALL
echo.
call "%SRC_DIR%install.bat"
exit /b 0

:LAUNCH
start "" "%INSTALL_DIR%\start.bat"
exit /b 0
