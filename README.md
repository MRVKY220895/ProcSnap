# ProcSnap 📸

> **100% Local, Enterprise-Grade SOP Studio, Desktop & Browser Recorder, and Interactive BPMN Process Flow Visualizer**  
> Automatically generate step-by-step Standard Operating Procedures (SOPs), interactive e-Learning courses, and editable BPMN 2.0 flowcharts directly from your desktop and browser actions.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-vickykalamg-orange?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/vickykalamg)
[![GitHub stars](https://img.shields.io/github/stars/MRVKY220895/ProcSnap?style=flat)](https://github.com/MRVKY220895/ProcSnap)

---

## ✨ Key Features & Capabilities

### 1. 🎥 Dual Desktop & Browser Recording Engine
- **🖥️ Native OS Windows Recorder** — Global mouse and keyboard listener (`pynput` + `mss`) captures clicks inside any Windows application (VS Code, Excel, SAP, CRM, Terminal) with foreground window title tracking and `Ctrl+Shift+Q` hotkey.
- **🌐 Smart Browser Extension** — High-performance Chromium extension with **1.5s typing debounce aggregation**, explicit **Enter keypress capture**, deep element link traversal (`Click link "Google Search"`), and multi-port backend auto-discovery (`8000–8005`).

### 2. 🎨 3-Island Floating Studio Dock
- **🧭 Island 1 (Step Navigation Pill)** — Segmented step navigation `[◀ Step 3 of 11 ▶]`, quick jump input, and isolated deletion with hover safety.
- **🎨 Island 2 (Creative Tools & Smart Hotspot)** — Single-active tool selection (`↖ Pointer`, `✋ Hand`, `⭕ Circle`, `➡️ Arrow`, `▢ Rect`, `✏️ Pen`, `🔤 Text`, `░ Blur`, `✂️ Crop`, `🛡️ Auto-Redact`).
- **🎨 Color & Stroke Palette Popover** — 8 vibrant preset swatches, native Hex color picker, and stroke widths (`2px`, `4px`, `6px`, `8px`).
- **🔤 Rich Text Callout Options** — 5 badge styles (Info, Warning, Tip, Note, Plain), 4 font sizes (`13px–26px`), and quick label presets.
- **🎯 Smart Hotspot & Micro-Demo Studio** — Element focus spotlight, draggable animated cursor micro-demo GIF generator, and universal `🎯 Pin: ON/OFF` toggle.
- **🔍 Island 3 (Viewport & History Hub)** — `↶ Undo`, `↷ Redo`, and segmented zoom controller (`−`, `Fit`, `+`).

### 3. 📊 Interactive BPMN 2.0 Process Flowchart Engine
- **🔀 Triple View Modes** — Switch instantly between `📋 Step Cards`, `📊 BPMN Flowchart`, and `🔲 Split View`.
- **🔷 True BPMN 2.0 Nodes** — Green Start event, Red End event, Activity Task cards, and Exclusive Decision Gateways (Diamonds) with labeled conditional branching.
- **🖐️ Freeform Drag & Drop** — Click and drag any box anywhere across the infinite blueprint dot-grid canvas with 10px magnetic snapping.
- **🔀 60 FPS Rubber-Band Dynamic Arrow Re-Routing** — Orthogonal Manhattan and S-curve connecting lines dynamically stretch, curve, and re-anchor in real-time as boxes move.
- **🎛️ Direct Step Node Quick Inspector** — Edit step titles, descriptions, and decision branches live from the flowchart canvas with instant auto-save.
- **⚡ 1-Click Auto-Align Reset** — Snap all boxes back into a clean, uniform serpentine 4-column layout.
- **📤 Diagram Vector & Code Exports** — 1-click export to **Scalable Vector SVG**, **High-Res PNG**, and **Mermaid.js Flowchart syntax**.

### 4. 📤 Multi-Channel Delivery, Audio & LMS Exports
- **🎓 Interactive Practice Mode & Teleprompter** — Test user knowledge with click verification and practice step playback.
- **🎙️ Edge-TTS AI Voiceover** — Generate realistic multi-voice neural audio narration for each step.
- **📦 SCORM e-Learning Export** — Export complete LMS-compatible SCORM packages for Moodle, Canvas, and Blackboard.
- **📑 Document & Deck Exports** — Export to **PDF**, **Microsoft Word (.docx)**, **PowerPoint (.pptx)**, **Markdown**, and **Standalone HTML**.

---

## 🚀 Quick Start & Installation

### Option 1: One-Click User Installer (Recommended - No Admin Required)
1. Clone or download this repository:
   ```cmd
   git clone https://github.com/MRVKY220895/ProcSnap.git
   ```
2. Double-click `install.bat`.
3. The installer will set up the Python virtual environment and create Desktop shortcuts.

---

### Option 2: Portable / Standalone Run
Double-click `start.bat` in the repository root:
```cmd
start.bat
```
The server will start at `http://127.0.0.1:8000` and automatically launch the Studio Dashboard.

---

## 🧩 Installing the Browser Extension

1. Open your Chromium-based browser:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
2. Toggle on **Developer mode** (top-right switch).
3. Click **Load unpacked** and select the `extension/` folder inside ProcSnap.
4. Pin the **ProcSnap** icon in your toolbar and click **Start Recording**!

---

## 📁 Project Architecture

```text
ProcSnap/
├── backend/               # FastAPI backend, SQLite DB, pynput OS listener, Edge-TTS
│   ├── main.py            # API routes, desktop recorder, GIF demo generator, exports
│   └── requirements.txt   # Python dependencies
├── dashboard/             # SOP Studio Web Dashboard
│   ├── dashboard.html     # Studio UI, 3-Island Dock, BPMN Flowchart canvas
│   ├── dashboard.css      # Frosted glassmorphism, BPMN blueprint styles, light/dark themes
│   └── dashboard.js       # Annotation engine, BpmnFlowchartEngine, canvas tools
├── extension/             # Manifest V3 browser extension
│   ├── manifest.json      # Extension manifest with store-ready icon set (16-256px)
│   ├── background.js      # Background service worker & multi-port health prober
│   ├── content.js         # 1.5s typing debounce, Enter capture & link traversal
│   └── popup.html / js    # Extension popup controls
├── icons/                 # High-resolution branding artwork suite
├── install.bat            # Non-admin user installer
├── start.bat              # Standalone / portable launcher
└── uninstall.bat          # Clean user uninstaller
```

---

## 📄 License
MIT License. Free and open source.

