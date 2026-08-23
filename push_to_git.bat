@echo off
setlocal EnableDelayedExpansion
title ProcSnap - Git Push
color 0A

cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"

echo ===============================================================================
echo                     ProcSnap - Push to GitHub Repository
echo ===============================================================================
echo.
echo Target Repository:
echo   https://github.com/MRVKY220895/ProcSnap.git
echo.

git remote remove origin >nul 2>&1
git remote add origin https://github.com/MRVKY220895/ProcSnap.git
git branch -M main

echo [1/2] Syncing latest commits...
echo.
echo [2/2] Pushing to GitHub (main branch)...
echo.
git push -u origin main

if errorlevel 1 (
    echo.
    echo ===============================================================================
    echo [NOTE] If GitHub asked for a password, note that GitHub requires a
    echo        Personal Access Token (PAT) instead of your regular password.
    echo.
    echo        To create a token in 30 seconds:
    echo        1. Go to: https://github.com/settings/tokens/new
    echo        2. Check the "repo" checkbox.
    echo        3. Generate token and paste it as your password when prompted.
    echo ===============================================================================
) else (
    echo.
    echo ===============================================================================
    echo                     [SUCCESS] ProcSnap pushed to GitHub!
    echo       View your repository: https://github.com/MRVKY220895/ProcSnap
    echo ===============================================================================
)

echo.
pause
