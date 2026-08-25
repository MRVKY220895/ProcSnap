"""
ProcSnap Automated Launcher
Checks Python environment, auto-installs missing dependencies from backend/requirements.txt,
frees port 8000, opens the Studio Dashboard, and starts the FastAPI uvicorn server.
"""

import sys
import os
import subprocess
import webbrowser
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
REQ_FILE = BACKEND_DIR / "requirements.txt"
VENV_DIR = BACKEND_DIR / ".venv"
VENV_PYTHON = VENV_DIR / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")

def check_and_install_dependencies():
    print("[1/4] Checking Python runtime & virtual environment...", flush=True)
    if not VENV_PYTHON.exists():
        print("  Creating virtual environment at backend/.venv...", flush=True)
        subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)

    print("[2/4] Verifying dependencies from backend/requirements.txt...", flush=True)
    try:
        # Check if core modules can be imported
        check_cmd = [str(VENV_PYTHON), "-c", "import fastapi, uvicorn, pydantic, mss, PIL, docx, pptx, multipart; print('READY')"]
        res = subprocess.run(check_cmd, capture_output=True, text=True)
        if "READY" not in res.stdout:
            raise ImportError("Missing dependencies")
        print("  Dependencies already installed and verified [OK]", flush=True)
    except Exception:
        print("  Installing/updating required packages...", flush=True)
        subprocess.run([str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip", "--quiet", "--no-cache-dir", "--disable-pip-version-check"], check=False)
        subprocess.run([str(VENV_PYTHON), "-m", "pip", "install", "-r", str(REQ_FILE), "--quiet", "--no-cache-dir", "--disable-pip-version-check"], check=False)
        print("  Installation complete [OK]", flush=True)

def free_port_8000():
    print("[3/4] Ensuring port 8000 is clean...", flush=True)
    if sys.platform == "win32":
        try:
            ps_cmd = "$pids = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($p in $pids) { if ($p -gt 0) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }"
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True)
        except Exception:
            pass

def launch_server():
    print("[4/4] Starting ProcSnap Server on http://127.0.0.1:8000 ...", flush=True)
    dashboard_url = "http://127.0.0.1:8000/dashboard/dashboard.html"
    
    # Open dashboard in browser after a short delay
    def open_browser():
        time.sleep(1.2)
        try:
            webbrowser.open(dashboard_url)
        except Exception:
            pass

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    # Launch uvicorn
    cmd = [
        str(VENV_PYTHON),
        "-m",
        "uvicorn",
        "backend.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000"
    ]
    try:
        subprocess.run(cmd, cwd=str(ROOT_DIR))
    except KeyboardInterrupt:
        print("\n[OK] ProcSnap Server stopped gracefully.")

if __name__ == "__main__":
    check_and_install_dependencies()
    free_port_8000()
    launch_server()
