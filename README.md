# ProcSnap 📸

> **100% Local, Private Process Recorder & SOP Annotation Studio**  
> Automatically generate step-by-step Standard Operating Procedures (SOPs), user guides, and interactive training workflows right from your desktop and browser.

---

## ✨ Key Features

- **🛡️ 100% Local & Private** — No cloud dependencies, no tracking. All data stays strictly on your machine.
- **⚡ Zero Admin Restriction** — Seamless one-click installer works inside user-space (`%LOCALAPPDATA%`) with no UAC or administrator elevation needed.
- **🌐 Universal Browser Extension** — Capture web actions effortlessly in **Google Chrome**, **Microsoft Edge**, **Brave**, **Opera**, or **Vivaldi**.
- **🖥️ Native Desktop Capture** — 4-tier fallback engine (MSS ➔ PIL ➔ PowerShell GDI ➔ Subprocess) captures any desktop application with precision.
- **🎨 Interactive Canvas & Annotation Engine** — Add spotlights, callouts, arrows, rectangles, blur sensitive data, and crop screenshots.
- **🤖 AI SOP Enhancement** — One-click AI title/description generator and polishing via local Ollama models.
- **📤 Versatile Export Options** — Export to PDF, Word/DOCX, Markdown, Confluence Wiki Markup, CSV, and interactive HTML slideshows.

---

## 🚀 Quick Start & Installation

### Option 1: One-Click User Installer (Recommended - No Admin Required)
1. Download or clone this repository.
2. Double-click `install.bat`.
3. The installer will:
   - Copy ProcSnap to `%LOCALAPPDATA%\ProcSnap`
   - Setup a dedicated Python environment automatically
   - Add Desktop & Start Menu shortcuts
   - Guide you to add the extension to your favorite browser

---

### Option 2: Portable / Standalone Run
Just double-click `start.bat` in this folder:
```cmd
start.bat
```
The server will start at `http://127.0.0.1:8000` and automatically launch the Studio Dashboard.

---

## 🧩 Installing the Browser Extension

Run `install_extension.bat` or follow these steps:

1. Open your favorite Chromium-based browser:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
   - **Opera**: `opera://extensions`
2. Toggle on **Developer mode** (top-right switch).
3. Click **Load unpacked** (top-left button).
4. Select the `extension/` folder inside ProcSnap.
5. Done! Click the **ProcSnap** icon in your browser toolbar to start recording.

---

## 📁 Project Structure

```text
ProcSnap/
├── backend/               # FastAPI local backend & SQLite engine
│   ├── main.py            # API routes, desktop capture, AI endpoints
│   ├── requirements.txt   # Python dependencies
│   └── capture.ps1        # Fallback desktop capture script
├── dashboard/             # SOP Studio Web Dashboard
│   ├── dashboard.html     # Studio UI
│   └── dashboard.js       # Annotation engine & workflow manager
├── extension/             # Manifest V3 browser extension
│   ├── manifest.json      # Extension manifest
│   ├── background.js      # Background recording service worker
│   ├── content.js         # DOM action listener & smart overlay
│   └── popup.html / js    # Extension recording controls
├── install.bat            # Non-admin user installer
├── install_extension.bat  # Browser extension helper
├── start.bat              # Standalone / portable launcher
└── uninstall.bat          # Clean user uninstaller
```

---

## 📄 License
MIT License. Free and open source.
