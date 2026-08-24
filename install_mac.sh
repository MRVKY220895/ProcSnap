#!/usr/bin/env bash
# ==============================================================================
#                      ProcSnap - macOS Installer Script
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "==============================================================================="
echo "                    ProcSnap Studio - macOS Setup & Installer"
echo "==============================================================================="
echo ""

# 1. Ensure permissions
chmod +x "$DIR/start_mac.sh" 2>/dev/null || true

# 2. Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "[!] Python 3 not found."
    if command -v brew &> /dev/null; then
        echo "[..] Installing Python via Homebrew..."
        brew install python
    else
        echo "[!] Please install Homebrew or Python 3 from https://www.python.org/downloads/"
        exit 1
    fi
fi

# 3. Create virtual environment
echo "[..] Setting up Python virtual environment..."
python3 -m venv "$DIR/backend/.venv"
"$DIR/backend/.venv/bin/pip" install -q --upgrade pip
"$DIR/backend/.venv/bin/pip" install -q -r "$DIR/backend/requirements.txt"
echo "[✓] Backend dependencies installed successfully."

# 4. Open Chrome Extension Instructions
echo ""
echo "==============================================================================="
echo "  INSTALLING CHROME EXTENSION ON MAC:"
echo "  1. Open Google Chrome / Brave / Edge"
echo "  2. Go to: chrome://extensions"
echo "  3. Enable 'Developer mode' (toggle top right)"
echo "  4. Click 'Load unpacked' and select the folder:"
echo "     $DIR/extension"
echo "==============================================================================="
echo ""

# Try opening Chrome extensions page
if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
elif [ -d "/Applications/Brave Browser.app" ]; then
    open -a "Brave Browser" "brave://extensions" 2>/dev/null || true
elif [ -d "/Applications/Microsoft Edge.app" ]; then
    open -a "Microsoft Edge" "edge://extensions" 2>/dev/null || true
fi

echo "[✓] Installation complete!"
echo "    To start ProcSnap anytime, run: ./start_mac.sh"
echo ""

read -p "Do you want to launch ProcSnap Studio now? (Y/n): " RUN_NOW
if [[ "$RUN_NOW" =~ ^[Yy]$ ]] || [[ -z "$RUN_NOW" ]]; then
    exec "$DIR/start_mac.sh"
fi