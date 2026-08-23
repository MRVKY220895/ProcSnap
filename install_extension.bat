@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Extension Installer
color 0B

:: Determine extension path
set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%extension"
if not exist "%EXT_DIR%\manifest.json" (
    if exist "%SCRIPT_DIR%..\extension\manifest.json" (
        set "EXT_DIR=%SCRIPT_DIR%..\extension"
    )
)

cls
echo ===============================================================================
echo                ProcSnap - Browser Extension Installer
echo ===============================================================================
echo.
echo Extension folder:
echo   "%EXT_DIR%"
echo.
echo [1] Copying extension folder path to clipboard...
powershell -NoProfile -Command "Set-Clipboard -Value '%EXT_DIR%'" >nul 2>&1
echo   [OK] Path copied to your Windows clipboard!
echo.
echo -------------------------------------------------------------------------------
echo  Select your favorite browser to install the ProcSnap extension:
echo -------------------------------------------------------------------------------
echo.
echo   [1] Google Chrome
echo   [2] Microsoft Edge
echo   [3] Brave Browser
echo   [4] Opera / Opera GX
echo   [5] Vivaldi
echo   [6] Open default browser
echo   [7] Skip extension setup (I will load it manually later)
echo.

set /p CHOICE="Enter choice (1-7) [default: 1]: "
if "%CHOICE%"=="" set CHOICE=1

echo.
if "%CHOICE%"=="1" goto CHROME
if "%CHOICE%"=="2" goto EDGE
if "%CHOICE%"=="3" goto BRAVE
if "%CHOICE%"=="4" goto OPERA
if "%CHOICE%"=="5" goto VIVALDI
if "%CHOICE%"=="6" goto DEFAULT_BROWSER
if "%CHOICE%"=="7" goto SKIP

:CHROME
echo [..] Launching Google Chrome Extensions page...
start chrome "chrome://extensions"
goto INSTRUCTIONS

:EDGE
echo [..] Launching Microsoft Edge Extensions page...
start msedge "edge://extensions"
goto INSTRUCTIONS

:BRAVE
echo [..] Launching Brave Extensions page...
start brave "brave://extensions"
if errorlevel 1 (
    if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" (
        start "" "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" "brave://extensions"
    )
)
goto INSTRUCTIONS

:OPERA
echo [..] Launching Opera Extensions page...
start opera "opera://extensions"
goto INSTRUCTIONS

:VIVALDI
echo [..] Launching Vivaldi Extensions page...
start vivaldi "vivaldi://extensions"
goto INSTRUCTIONS

:DEFAULT_BROWSER
echo [..] Opening extensions page in your default browser...
start "" "chrome://extensions"
goto INSTRUCTIONS

:INSTRUCTIONS
echo.
echo ===============================================================================
echo                     HOW TO LOAD THE EXTENSION (30 SECONDS)
echo ===============================================================================
echo.
echo   1. In the browser tab that just opened:
echo      Enable "Developer mode" (toggle in the top-right corner).
echo.
echo   2. Click the "Load unpacked" button (top-left).
echo.
echo   3. In the folder selection dialog, press Ctrl+V to paste the path:
echo      %EXT_DIR%
echo.
echo   4. Click "Select Folder".
echo.
echo   [DONE] The ProcSnap extension is now installed and ready to record!
echo ===============================================================================
echo.
pause
goto END

:SKIP
echo [INFO] Extension setup skipped. You can run 'install_extension.bat' anytime.

:END
exit /b 0
