@echo off
setlocal EnableDelayedExpansion
title ProcSnap - User Installer (No Admin Required)
color 0A

echo ===============================================================================
echo                ProcSnap - Workflow Studio Installer
echo             (100%% Local - No Admin Rights Required)
echo ===============================================================================
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\ProcSnap"
set "SRC_DIR=%~dp0"

:STAGE_FILES
echo [1/6] Copying application files to %INSTALL_DIR% ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
robocopy "%SRC_DIR%backend" "%INSTALL_DIR%\backend" /E /XD .venv __pycache__ .git /XF *.pyc /NFL /NDL /NJH /NJS >nul
robocopy "%SRC_DIR%dashboard" "%INSTALL_DIR%\dashboard" /E /NFL /NDL /NJH /NJS >nul
robocopy "%SRC_DIR%extension" "%INSTALL_DIR%\extension" /E /NFL /NDL /NJH /NJS >nul
copy /Y "%SRC_DIR%start.bat" "%INSTALL_DIR%\start.bat" >nul
copy /Y "%SRC_DIR%install_extension.bat" "%INSTALL_DIR%\install_extension.bat" >nul
copy /Y "%SRC_DIR%uninstall.bat" "%INSTALL_DIR%\uninstall.bat" >nul
copy /Y "%SRC_DIR%repair.bat" "%INSTALL_DIR%\repair.bat" >nul
copy /Y "%SRC_DIR%create_desktop_shortcut.vbs" "%INSTALL_DIR%\create_desktop_shortcut.vbs" >nul
if errorlevel 8 (
    echo [✗] FAILED: Could not copy application files.
    goto PROMPT_RETRY_FILES
)
echo       [✓] SUCCESS: Application files copied.
echo.
goto STAGE_PYTHON

:PROMPT_RETRY_FILES
echo.
echo Options: [1] Retry file copy  [2] Skip and continue  [3] Abort
set /p OPT="Select option (1-3) [default: 1]: "
if "%OPT%"=="" set OPT=1
if "%OPT%"=="1" goto STAGE_FILES
if "%OPT%"=="2" goto STAGE_PYTHON
exit /b 1

:STAGE_PYTHON
echo [2/6] Verifying Python runtime environment...
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
    echo [..] Python not found. Attempting automatic user-space install via winget...
    winget install --id Python.Python.3.13 --scope user --accept-source-agreements --accept-package-agreements --silent
    if errorlevel 1 (
        echo [✗] FAILED: Python installation could not be completed automatically.
        goto PROMPT_RETRY_PYTHON
    )
    set "PY_CMD=python"
)
echo       [✓] SUCCESS: Python detected (!PY_CMD!)
echo.
goto STAGE_VENV

:PROMPT_RETRY_PYTHON
echo.
echo Options: [1] Retry Python check/install  [2] Skip and continue  [3] Abort
set /p OPT="Select option (1-3) [default: 1]: "
if "%OPT%"=="" set OPT=1
if "%OPT%"=="1" goto STAGE_PYTHON
if "%OPT%"=="2" goto STAGE_VENV
exit /b 1

:STAGE_VENV
echo [3/6] Setting up virtual environment...
cd /d "%INSTALL_DIR%"
if not exist "backend\.venv\" (
    echo       Creating isolated Python virtualenv...
    !PY_CMD! -m venv backend\.venv
    if errorlevel 1 (
        echo [✗] FAILED: Virtual environment creation failed.
        goto PROMPT_RETRY_VENV
    )
)
echo       [✓] SUCCESS: Virtual environment ready.
echo.
goto STAGE_DEPS

:PROMPT_RETRY_VENV
echo.
echo Options: [1] Retry venv creation  [2] Skip and continue  [3] Abort
set /p OPT="Select option (1-3) [default: 1]: "
if "%OPT%"=="" set OPT=1
if "%OPT%"=="1" goto STAGE_VENV
if "%OPT%"=="2" goto STAGE_DEPS
exit /b 1

:STAGE_DEPS
echo [4/6] Installing / updating dependencies...
backend\.venv\Scripts\python.exe -m pip install -q --upgrade pip >nul 2>&1
backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
if errorlevel 1 (
    echo [✗] FAILED: Some packages failed to install. Please check your internet connection.
    goto PROMPT_RETRY_DEPS
)
echo       [✓] SUCCESS: All backend dependencies installed.
echo.
goto STAGE_SHORTCUTS

:PROMPT_RETRY_DEPS
echo.
echo Options: [1] Retry package installation  [2] Skip and continue  [3] Abort
set /p OPT="Select option (1-3) [default: 1]: "
if "%OPT%"=="" set OPT=1
if "%OPT%"=="1" goto STAGE_DEPS
if "%OPT%"=="2" goto STAGE_SHORTCUTS
exit /b 1

:STAGE_SHORTCUTS
echo [5/6] Creating Desktop & Start Menu shortcuts...
set "VBS_SCRIPT=%TEMP%\create_procsnap_shortcuts.vbs"
(
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo strDesktop = WshShell.SpecialFolders^("Desktop"^)
    echo strPrograms = WshShell.SpecialFolders^("Programs"^)
    echo.
    echo ' Desktop shortcut
    echo Set oLink1 = WshShell.CreateShortcut^(strDesktop ^& "\ProcSnap.lnk"^)
    echo oLink1.TargetPath = "%INSTALL_DIR%\start.bat"
    echo oLink1.WorkingDirectory = "%INSTALL_DIR%"
    echo oLink1.Description = "ProcSnap - Local Process Recorder & SOP Studio"
    echo oLink1.IconLocation = "shell32.dll, 220"
    echo oLink1.Save
    echo.
    echo ' Start Menu shortcut
    echo Set oLink2 = WshShell.CreateShortcut^(strPrograms ^& "\ProcSnap.lnk"^)
    echo oLink2.TargetPath = "%INSTALL_DIR%\start.bat"
    echo oLink2.WorkingDirectory = "%INSTALL_DIR%"
    echo oLink2.Description = "ProcSnap - Local Process Recorder & SOP Studio"
    echo oLink2.IconLocation = "shell32.dll, 220"
    echo oLink2.Save
) > "%VBS_SCRIPT%"

cscript //nologo "%VBS_SCRIPT%" >nul 2>&1
del /f /q "%VBS_SCRIPT%" >nul 2>&1
echo       [✓] SUCCESS: ProcSnap shortcuts added to Desktop and Start Menu.
echo.

:STAGE_EXTENSION
echo [6/6] Setting up browser extension...
call "%INSTALL_DIR%\install_extension.bat"
echo.

cls
echo ===============================================================================
echo                       ProcSnap Installation Complete!
echo ===============================================================================
echo.
echo   Location:    %INSTALL_DIR%
echo   Shortcuts:   Desktop + Start Menu (ProcSnap.lnk)
echo.
echo   To launch ProcSnap anytime, double-click the ProcSnap icon on your Desktop.
echo.
set /p LAUNCH_NOW="Would you like to start ProcSnap now? (Y/N) [default: Y]: "
if "%LAUNCH_NOW%"=="" set LAUNCH_NOW=Y
if /i "%LAUNCH_NOW%"=="Y" (
    start "" "%INSTALL_DIR%\start.bat"
)

exit /b 0
