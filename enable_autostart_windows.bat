@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Enable Auto-Start on Windows Login
color 0A

cd /d "%~dp0"

echo.
echo  ========================================================
echo   ProcSnap - Enable Automatic Background Startup
echo  ========================================================
echo.
echo [..] Setting up ProcSnap to start automatically on Windows login...

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_SCRIPT=%~dp0start_background.vbs"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\ProcSnap_Background.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_SCRIPT%\"'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'ProcSnap Background Service'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo [OK] Auto-Start successfully configured!
    echo.
    echo  ProcSnap backend will now start automatically whenever you log in.
    echo  Your browser extension will always show 'API Online'.
    echo.
) else (
    echo [ERROR] Could not create startup shortcut in:
    echo         %STARTUP_FOLDER%
)

echo Press any key to exit...
pause >nul
