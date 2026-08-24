#!/usr/bin/env bash
# ==============================================================================
#                      ProcSnap - macOS Launcher Script
# ==============================================================================

set -e

# Change directory to script root
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "==============================================================================="
echo "                    ProcSnap Studio - macOS Launcher"
echo "==============================================================================="
echo ""

# 1. Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "[!] Error: python3 is not installed on this Mac."
    echo "    Please install Python 3 using Homebrew: brew install python"
    echo "    Or download from https://www.python.org/downloads/"
    exit 1
fi

PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "[✓] Detected Python $PY_VER"

# 2. Virtual Environment Setup
VENV_DIR="$DIR/backend/.venv"
VENV_PY="$VENV_DIR/bin/python"
VENV_PIP="$VENV_DIR/bin/pip"

if [ ! -f "$VENV_PY" ]; then
    echo "[..] Creating Python virtual environment in backend/.venv..."
    python3 -m venv "$VENV_DIR"
    echo "[✓] Virtual environment created."
fi

# 3. Dependencies check
echo "[..] Checking backend dependencies..."
"$VENV_PIP" install -q --upgrade pip || true
if [ -f "$DIR/backend/requirements.txt" ]; then
    "$VENV_PIP" install -q -r "$DIR/backend/requirements.txt" || true
fi
echo "[✓] Dependencies ready."

# 4. Port probing (8000 -> 8010)
APP_PORT=8000
for port in {8000..8010}; do
    if ! lsof -i :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        APP_PORT=$port
        break
    fi
done

echo "[✓] Backend will start on port $APP_PORT"
echo ""
echo "==============================================================================="
echo "  ProcSnap Studio running at: http://127.0.0.1:$APP_PORT/dashboard/dashboard.html"
echo "  Press Ctrl+C to stop the server."
echo "==============================================================================="
echo ""

# 5. Open browser in background after short delay
(
    sleep 1.5
    open "http://127.0.0.1:$APP_PORT/dashboard/dashboard.html" || true
) &

# 6. Start Uvicorn backend
exec "$VENV_PY" -m uvicorn backend.main:app --host 127.0.0.1 --port "$APP_PORT" --reload