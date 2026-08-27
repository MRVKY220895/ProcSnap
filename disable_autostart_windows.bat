@echo off
title ProcSnap - Disable Auto-Start on Windows Login
color 0E

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\ProcSnap_Background.lnk"

if exist "%SHORTCUT_PATH%" (
    del /f /q "%SHORTCUT_PATH%"
    echo [OK] ProcSnap Auto-Start disabled successfully.
) else (
    echo [INFO] Auto-Start was not configured.
)

pause
