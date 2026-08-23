@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Uninstaller
color 0C

echo ===============================================================================
echo                           ProcSnap Uninstaller
echo ===============================================================================
echo.
echo This will remove ProcSnap from your user profile:
echo   %LOCALAPPDATA%\ProcSnap
echo.
set /p CONFIRM="Are you sure you want to uninstall ProcSnap? (Y/N) [default: N]: "
if /i not "%CONFIRM%"=="Y" (
    echo [INFO] Uninstall canceled.
    pause
    exit /b 0
)

echo.
echo [1/3] Terminating any running ProcSnap backend processes...
taskkill /F /IM python.exe /FI "WINDOWTITLE eq ProcSnap*" >nul 2>&1

echo [2/3] Removing shortcuts...
powershell -NoProfile -Command "
$desktop = [Environment]::GetFolderPath('Desktop') + '\ProcSnap.lnk'
$startMenu = [Environment]::GetFolderPath('Programs') + '\ProcSnap.lnk'
if (Test-Path $desktop) { Remove-Item $desktop -Force }
if (Test-Path $startMenu) { Remove-Item $startMenu -Force }
" >nul 2>&1
echo       [OK] Shortcuts removed.

echo [3/3] Deleting application files...
set "INSTALL_DIR=%LOCALAPPDATA%\ProcSnap"
if exist "%INSTALL_DIR%" (
    rmdir /S /Q "%INSTALL_DIR%" >nul 2>&1
)
echo       [OK] ProcSnap folder removed.

echo.
echo ===============================================================================
echo                      ProcSnap Successfully Uninstalled
echo ===============================================================================
echo.
pause
exit /b 0
