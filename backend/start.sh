#!/bin/bash
cd "$(dirname "$0")"
echo "Starting ProcSnap Server..."
if [ ! -d ".venv" ]; then
    echo "Virtual environment (.venv) not found!"
    exit 1
fi
source .venv/bin/activate
# Try opening the browser automatically
if command -v xdg-open > /dev/null; then
    xdg-open "http://127.0.0.1:8000/dashboard/dashboard.html" &
elif command -v open > /dev/null; then
    open "http://127.0.0.1:8000/dashboard/dashboard.html" &
fi
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
