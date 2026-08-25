# ProcSnap Interactive Requirements & Setup Installer
# Tests all requirements one-by-one, retries failures, installs dependencies, and launches ProcSnap

$Host.UI.RawUI.WindowTitle = "ProcSnap - Enterprise Setup & Health Checker"
Clear-Host

Write-Host @"
================================================================================
   ____                      ____                  
  / __ \_________  _____    / __/___  ____ _____  
 / /_/ / ___/ __ \/ ___/   / /_/ __ \/ __ `/ __ \ 
/ ____/ /  / /_/ / /__    _\ \/ /_/ / /_/ / /_/ / 
/_/   /_/   \____/\___/   /___/ .___/\__,_/ .___/  
                             /_/         /_/       
              Local SOP Documentation Engine
================================================================================
"@ -ForegroundColor Cyan

$WorkspaceDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $WorkspaceDir) { $WorkspaceDir = Get-Location }
Set-Location $WorkspaceDir

$Global:FailedChecks = @()

function Test-Step([string]$title, [scriptblock]$checkBlock, [scriptblock]$fixBlock) {
    Write-Host -NoNewline "  Checking $title... "
    try {
        $result = & $checkBlock
        if ($result -eq $true) {
            Write-Host "[✓ OK]" -ForegroundColor Green
            return $true
        } else {
            Write-Host "[FAILED]" -ForegroundColor Red
            if ($fixBlock) {
                Write-Host "    Attempting automated repair... " -ForegroundColor Yellow
                & $fixBlock
                $retest = & $checkBlock
                if ($retest -eq $true) {
                    Write-Host "    Repair successful [✓ OK]" -ForegroundColor Green
                    return $true
                }
            }
            $Global:FailedChecks += $title
            return $false
        }
    } catch {
        Write-Host "[ERROR: $_]" -ForegroundColor Red
        $Global:FailedChecks += $title
        return $false
    }
}

Write-Host "`n--- [1/3] VERIFYING SYSTEM & PYTHON PREREQUISITES ---" -ForegroundColor Yellow

# 1. Python Check
$PythonExe = $null
Test-Step "Python 3.10+ Runtime" {
    $py = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $py) { $py = Get-Command py.exe -ErrorAction SilentlyContinue }
    if ($py) {
        $ver = & $py.Source --version 2>&1
        $Script:PythonExe = $py.Source
        return ($ver -match "Python 3\.(1[0-9]|[2-9][0-9])")
    }
    return $false
} {
    Write-Host "    Please ensure Python 3.10+ is installed from python.org and added to PATH." -ForegroundColor DarkYellow
}

# 2. Virtual Environment Check
$VenvPython = Join-Path $WorkspaceDir "backend\.venv\Scripts\python.exe"
Test-Step "Python Virtual Environment (backend/.venv)" {
    if (Test-Path $VenvPython) {
        return $true
    }
    return $false
} {
    if ($PythonExe) {
        Write-Host "    Creating new virtualenv at backend/.venv..." -ForegroundColor Cyan
        & $PythonExe -m venv (Join-Path $WorkspaceDir "backend\.venv")
    }
}

# 3. Pip Dependencies Check
Test-Step "Backend Dependencies (FastAPI, MSS, Pillow, python-docx, python-pptx, python-multipart)" {
    if (Test-Path $VenvPython) {
        $testMod = & $VenvPython -c "import fastapi, uvicorn, mss, PIL, docx, pptx, multipart; print('OK')" 2>&1
        return ($testMod -match "OK")
    }
    return $false
} {
    if (Test-Path $VenvPython) {
        Write-Host "    Installing backend dependencies via pip..." -ForegroundColor Cyan
        & $VenvPython -m pip install --upgrade pip
        & $VenvPython -m pip install -r (Join-Path $WorkspaceDir "backend\requirements.txt")
    }
}

# 4. Database Check
$DbPath = Join-Path $WorkspaceDir "backend\procsnap.db"
Test-Step "SQLite Database Engine" {
    if (Test-Path $DbPath) { return $true }
    # Run main startup to initialize tables
    if (Test-Path $VenvPython) {
        & $VenvPython -c "import backend.main; print('DB Initialized')" 2>&1 | Out-Null
        return (Test-Path $DbPath)
    }
    return $false
}

Write-Host "`n--- [2/3] BROWSER EXTENSION SETUP ---" -ForegroundColor Yellow
$ExtDir = Join-Path $WorkspaceDir "extension"
Test-Step "Chrome/Edge Extension Files" {
    return (Test-Path (Join-Path $ExtDir "manifest.json"))
}

# Browser Selection
Write-Host "`nChoose your browser to install the ProcSnap extension:" -ForegroundColor Cyan
Write-Host "  [1] Google Chrome" -ForegroundColor White
Write-Host "  [2] Microsoft Edge" -ForegroundColor White
Write-Host "  [3] Brave Browser" -ForegroundColor White
Write-Host "  [4] Skip browser launch" -ForegroundColor Gray

$choice = Read-Host "Enter option (1-4) [default: 1]"
if (-not $choice) { $choice = "1" }

$browserUrl = "chrome://extensions"
$browserExe = "chrome.exe"
if ($choice -eq "2") {
    $browserUrl = "edge://extensions"
    $browserExe = "msedge.exe"
} elseif ($choice -eq "3") {
    $browserUrl = "brave://extensions"
    $browserExe = "brave.exe"
}

if ($choice -ne "4") {
    Write-Host "`n  Instructions to enable extension in browser:" -ForegroundColor Yellow
    Write-Host "  1. Turn ON 'Developer mode' (top-right toggle)" -ForegroundColor White
    Write-Host "  2. Click 'Load unpacked'" -ForegroundColor White
    Write-Host "  3. Select folder: $ExtDir" -ForegroundColor Green
    Start-Process $browserExe $browserUrl -ErrorAction SilentlyContinue
}

Write-Host "`n--- [3/3] LAUNCHING PROCSNAP BACKEND & STUDIO ---" -ForegroundColor Yellow

if ($Global:FailedChecks.Count -gt 0) {
    Write-Host "⚠️ Some checks failed: $($Global:FailedChecks -join ', ')" -ForegroundColor Red
    Write-Host "Please resolve them or run this script as Administrator." -ForegroundColor Yellow
} else {
    Write-Host "🎉 ALL REQUIREMENTS VERIFIED AND INSTALLED SUCCESSFULLY!" -ForegroundColor Green
    Write-Host "Starting ProcSnap local server on port 8000..." -ForegroundColor Cyan
    
    # Launch uvicorn in background
    Start-Process -FilePath $VenvPython -ArgumentList "-m", "uvicorn", "backend.main:app", "--port", "8000", "--host", "127.0.0.1" -WorkingDirectory $WorkspaceDir
    Start-Sleep -Seconds 2
    
    # Open Studio in Default Browser
    Start-Process "http://127.0.0.1:8000/dashboard/dashboard.html"
    Write-Host "✅ Studio opened at http://127.0.0.1:8000/dashboard/dashboard.html" -ForegroundColor Green
}

Write-Host "`nPress any key to exit setup..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
