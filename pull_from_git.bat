@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Pull Latest Update from GitHub
color 0B

cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"

echo ===============================================================================
echo                  ProcSnap - Check for Updates (GitHub Pull)
echo ===============================================================================
echo.
echo   Repository: https://github.com/MRVKY220895/ProcSnap.git
echo   Branch:     main
echo.

:: Check git is available
where git >nul 2>&1
if errorlevel 1 (
    echo [!] Git was not found in PATH.
    echo.
    echo     Download from: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

echo [1/3] Verifying remote origin...
git remote set-url origin https://github.com/MRVKY220895/ProcSnap.git >nul 2>&1
echo       [OK] Remote verified.
echo.

echo [2/3] Fetching latest changes from GitHub...
echo.
git pull origin main
echo.

if errorlevel 1 (
    echo ===============================================================================
    echo [!] git pull encountered an issue. See output above for details.
    echo.
    echo     Common causes:
    echo       1. No internet connection
    echo       2. Merge conflict - local edits clash with remote changes
    echo       3. Authentication required for private repo
    echo ===============================================================================
) else (
    echo ===============================================================================
    echo                      [SUCCESS] ProcSnap is up to date!
    echo.
    echo   All latest changes applied. Restart ProcSnap to use the new version.
    echo ===============================================================================
    echo.
    set /p RESTART_NOW="Would you like to restart ProcSnap now? (Y/N) [default: Y]: "
    if "!RESTART_NOW!"=="" set RESTART_NOW=Y
    if /i "!RESTART_NOW!"=="Y" (
        echo.
        echo Starting ProcSnap...
        start "" "%~dp0start.bat"
    )
)

echo.
pause
