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
echo   [5] Clear all workflows & screenshots (Reset Database with auto-backup)
echo   [6] Perform Full Re-installation
echo   [7] Launch ProcSnap Studio
echo   [8] Exit
echo.
set /p CHOICE="Enter option (1-8): "

if "%CHOICE%"=="1" goto REPAIR_DEPS
if "%CHOICE%"=="2" goto REPAIR_SHORTCUTS
if "%CHOICE%"=="3" goto REPAIR_EXT
if "%CHOICE%"=="4" goto REPAIR_VENV
if "%CHOICE%"=="5" goto RESET_DB
if "%CHOICE%"=="6" goto FULL_REINSTALL
if "%CHOICE%"=="7" goto LAUNCH
if "%CHOICE%"=="8" exit /b 0
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
:RESET_DB
echo.
echo ===============================================================================
echo                   RESET DATABASE & SCREENSHOTS
echo ===============================================================================
echo.
echo [!] WARNING: This will remove all recorded workflows and screenshots.
echo     A backup of your database will be saved before resetting.
echo.
set /p CONFIRM_RESET="Are you sure you want to proceed? (Y/N): "
if /i not "!CONFIRM_RESET!"=="Y" (
    echo [..] Reset cancelled.
    pause
    goto MENU
)

cd /d "%INSTALL_DIR%"
if exist "backend\procsnap.db" (
    echo [..] Creating backup before reset...
    if not exist "backend\storage\backups" mkdir "backend\storage\backups"
    copy /Y "backend\procsnap.db" "backend\storage\backups\procsnap_backup_before_reset.db" >nul 2>&1
    del /F /Q "backend\procsnap.db" >nul 2>&1
    echo [✓] Backup created at backend\storage\backups\
)
if exist "backend\screenshots" (
    echo [..] Cleaning screenshot cache...
    rmdir /S /Q "backend\screenshots" >nul 2>&1
    mkdir "backend\screenshots" >nul 2>&1
)
echo.
echo [✓] SUCCESS: Database and screenshots have been reset cleanly.
echo     ProcSnap will create a fresh database on the next launch.
echo.
pause
goto MENU

:FULL_REINSTALL
echo.
call "%SRC_DIR%install.bat"
exit /b 0

:LAUNCH
start "" "%INSTALL_DIR%\start.bat"
exit /b 0
