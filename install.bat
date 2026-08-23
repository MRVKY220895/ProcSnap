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

echo [1/6] Preparing installation directory:
echo       %INSTALL_DIR%
echo.

if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%" >nul 2>&1
)

:: Copying core project files
echo [2/6] Copying application files to your user folder...
robocopy "%SRC_DIR%backend" "%INSTALL_DIR%\backend" /E /XD .venv __pycache__ .git /XF *.pyc /NFL /NDL /NJH /NJS >nul
robocopy "%SRC_DIR%dashboard" "%INSTALL_DIR%\dashboard" /E /NFL /NDL /NJH /NJS >nul
robocopy "%SRC_DIR%extension" "%INSTALL_DIR%\extension" /E /NFL /NDL /NJH /NJS >nul
copy /Y "%SRC_DIR%start.bat" "%INSTALL_DIR%\start.bat" >nul
copy /Y "%SRC_DIR%install_extension.bat" "%INSTALL_DIR%\install_extension.bat" >nul
copy /Y "%SRC_DIR%uninstall.bat" "%INSTALL_DIR%\uninstall.bat" >nul
copy /Y "%SRC_DIR%create_desktop_shortcut.vbs" "%INSTALL_DIR%\create_desktop_shortcut.vbs" >nul
echo       [OK] Application files copied.
echo.

:: Check Python
echo [3/6] Verifying Python environment...
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
    echo [!] Python not detected. Attempting user-space installation via winget...
    winget install --id Python.Python.3.13 --scope user --accept-source-agreements --accept-package-agreements --silent
    if errorlevel 1 (
        echo [!] Winget unavailable. Please install Python from https://python.org/downloads/
        echo     (Make sure to check "Add python.exe to PATH")
        pause
        exit /b 1
    )
    set "PY_CMD=python"
)
echo       [OK] Python found: !PY_CMD!
echo.

:: Virtual Environment setup in user space
echo [4/6] Setting up virtual environment and Python dependencies...
cd /d "%INSTALL_DIR%"
if not exist "backend\.venv\" (
    echo       Creating Python virtual environment...
    !PY_CMD! -m venv backend\.venv
)

if exist "backend\.venv\Scripts\python.exe" (
    echo       Installing / updating required packages...
    backend\.venv\Scripts\python.exe -m pip install -q --upgrade pip >nul 2>&1
    backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
    echo       [OK] Python dependencies installed.
) else (
    echo [ERROR] Virtual environment creation failed.
    pause
    exit /b 1
)
echo.

:: Create Shortcuts (Desktop + Start Menu)
echo [5/6] Creating Desktop and Start Menu shortcuts...
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
echo       [OK] ProcSnap shortcut added to Desktop and Start Menu.
echo.

:: Extension setup
echo [6/6] Browser Extension Installation...
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
