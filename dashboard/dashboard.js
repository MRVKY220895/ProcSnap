const API_BASE = (typeof window !== "undefined" && window.location.protocol.startsWith("http"))
    ? ""
    : "http://127.0.0.1:8000";

let workflows = [];
let selectedWorkflowId = null;
let workflow = null;
let currentStepIndex = 0;
let activeTab = "guide";
let canvasEngine = null;

const $ = id => document.getElementById(id);

// Safe DOM Property Setters (prevents 'Cannot set properties of null')
const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
const setSrc = (id, val) => { const el = $(id); if (el) el.src = val; };
const setDisabled = (id, val) => { const el = $(id); if (el) el.disabled = !!val; };
const setChecked = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
const setOnclick = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
const setOnchange = (id, fn) => { const el = $(id); if (el) el.onchange = fn; };

// Safe HTML Escape
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

// Formatter for timestamp
const fmt = v => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const actionTitle = v => (v || "action").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());

// Toast Notification helper
function showToast(m) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = m;
    toast.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove("show"), 2500);
}

// REST API Helper
async function api(path, opt = {}) {
    const url = API_BASE + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const r = await fetch(url, {
            ...opt,
            signal: opt.signal || controller.signal,
            headers: {
                "Content-Type": "application/json",
                ...(opt.headers || {})
            }
        });
        clearTimeout(timeoutId);
        let d = null;
        try { d = await r.json(); } catch(e) {}
        if (!r.ok) throw Error(d?.detail || `HTTP ${r.status}`);
        return d;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// Get actionable element readable name
function getTargetName(e = {}) {
    e = (e && typeof e === "object") ? e : {};
    const raw = e.ariaLabel || e.placeholder || e.name || e.text || e.id || e.role || e.tagName || "";
    const val = String(raw).replace(/\s+/g, " ").trim();
    return val || "element";
}

// Generate default title based on step actions
function getDefaultTitle(s) {
    s = s || {};
    const act = (s.action || "").toLowerCase();
    const target = getTargetName(s.element);

    if (act === "click") return `Click on ${target}`;
    if (act === "input" || act === "change") return s.value ? `Type "${s.value}" into ${target}` : `Enter text into ${target}`;
    if (act === "desktop_capture") return s.title || "Desktop Screen Capture";
    if (["checkbox", "check"].includes(act)) return `Check the ${target}`;
    if (act === "uncheck") return `Uncheck the ${target}`;
    if (["navigate", "navigation"].includes(act)) return `Navigate to URL`;
    if (act === "right_click") return `Right click on the ${target}`;
    if (act === "focus") return `Focus on the ${target}`;
    if (act === "scroll") return `Scroll the page`;
    if (act === "keyboard_shortcut") return `Press shortcut ${s.value || ""}`;
    return `Perform action`;
}

// Generate default description
function getDefaultDescription(s) {
    s = s || {};
    const act = (s.action || "").toLowerCase();
    const target = getTargetName(s.element);
    
    if (["input", "change", "type"].includes(act)) {
        return s.value ? `Type "${s.value}" into the ${target} field.` : `Type the required details in the ${target} field.`;
    }
    if (["select", "select_option"].includes(act)) {
        return s.selectedText ? `Select "${s.selectedText}" from the options.` : `Select the required option from the list.`;
    }
    if (act === "click") return `Click the ${target} to proceed.`;
    if (["navigate", "navigation"].includes(act)) return `Go to ${s.url || "the website"}.`;
    if (act === "right_click") return `Right click on the ${target} to open the context menu.`;
    if (act === "scroll") return s.value ? `${s.value}.` : `Scroll down the page.`;
    if (act === "keyboard_shortcut") return `Trigger the keyboard action: ${s.value || ""}.`;
    return `Perform the action on the page.`;
}

async function checkStatus() {
    try {
        await api("/health");
        setText("apiStatus", "Connected");
        const statusEl = $("apiStatus");
        if (statusEl) {
            statusEl.className = "api-status online";
            statusEl.removeAttribute("style");
        }
    } catch (e) {
        setText("apiStatus", "API Offline");
        const statusEl = $("apiStatus");
        if (statusEl) {
            statusEl.className = "api-status offline";
            statusEl.removeAttribute("style");
        }
    }
    try {
        const res = await api("/ai/status");
        const statusEl = $("aiStatus");
        if (res.diagnostic_message && statusEl) {
            statusEl.title = res.diagnostic_message;
        }
        if (res.running) {
            if (res.required_models_present) {
                statusEl.textContent = "AI Connected";
                statusEl.className = "api-status online";
                statusEl.removeAttribute("style");
            } else {
                statusEl.textContent = "AI Pulling Models";
                statusEl.style.backgroundColor = "rgba(234, 179, 8, 0.12)";
                statusEl.style.color = "#d97706";
                statusEl.className = "api-status";
            }
            if ($("startOllamaBtn")) $("startOllamaBtn").classList.add("hidden");
        } else {
            statusEl.textContent = "AI Offline";
            statusEl.className = "api-status offline";
            statusEl.removeAttribute("style");
            if ($("startOllamaBtn")) $("startOllamaBtn").classList.remove("hidden");
        }
    } catch (e) {
        const statusEl = $("aiStatus");
        if (statusEl) {
            statusEl.textContent = "AI Offline";
            statusEl.className = "api-status offline";
            statusEl.title = "Ollama service unreachable on 127.0.0.1:11434. Click 'Start Ollama' to launch.";
            statusEl.removeAttribute("style");
        }
        if ($("startOllamaBtn")) $("startOllamaBtn").classList.remove("hidden");
    }
}

// Initialize Application
async function init() {
    // Run status check and library load in parallel for faster startup
    setInterval(checkStatus, 5000);
    try {
        await Promise.all([
            checkStatus().catch(e => console.warn("Status check error:", e)),
            loadWorkflows().catch(e => {
                console.warn("Workflow load error:", e);
                const listEl = $("workflowList");
                if (listEl) listEl.innerHTML = `<div class="no-results">Error loading: ${e.message}</div>`;
            })
        ]);
    } catch(e) {
        console.warn("Init error:", e);
    }
    
    // Dismiss AI Error Banner binding
    if ($("dismissAiErrorBtn")) {
        $("dismissAiErrorBtn").onclick = () => {
            if ($("aiErrorBanner")) $("aiErrorBanner").classList.add("hidden");
        };
    }

    // Start Ollama binding with live status polling and exact error display
    if ($("startOllamaBtn")) {
        $("startOllamaBtn").onclick = async () => {
            const btn = $("startOllamaBtn");
            btn.textContent = "Starting AI...";
            btn.disabled = true;
            if ($("aiErrorBanner")) $("aiErrorBanner").classList.add("hidden");

            try {
                const res = await api("/ai/start-ollama", { method: "POST" });
                showToast(res.message || "Starting Ollama...");
                
                let pollAttempts = 0;
                const pollInterval = setInterval(async () => {
                    pollAttempts++;
                    try {
                        const statusRes = await api("/ai/status");
                        const statusEl = $("aiStatus");
                        if (statusRes.running) {
                            if (statusRes.required_models_present) {
                                showToast("✅ AI Engine Ready! All models loaded.");
                                clearInterval(pollInterval);
                                btn.textContent = "Start Ollama";
                                btn.disabled = false;
                                btn.classList.add("hidden");
                                if ($("aiErrorBanner")) $("aiErrorBanner").classList.add("hidden");
                                await checkStatus();
                            } else {
                                btn.textContent = "Pulling Models...";
                                if (statusEl) {
                                    statusEl.textContent = "AI Pulling Models";
                                    statusEl.style.backgroundColor = "rgba(234, 179, 8, 0.12)";
                                    statusEl.style.color = "#d97706";
                                }
                            }
                        } else {
                            btn.textContent = `Starting... (${pollAttempts * 3}s)`;
                        }
                    } catch(err) {
                        console.warn("Ollama poll check:", err);
                    }
                    if (pollAttempts > 30) {
                        clearInterval(pollInterval);
                        btn.textContent = "Start Ollama";
                        btn.disabled = false;
                    }
                }, 3000);
            } catch(e) {
                const exactErr = e.message || e.toString();
                if ($("aiErrorText")) $("aiErrorText").textContent = `Ollama Start Error: ${exactErr}`;
                if ($("aiErrorBanner")) $("aiErrorBanner").classList.remove("hidden");
                btn.textContent = "Start Ollama";
                btn.disabled = false;
            }
        };
    }

    // System Requirements Diagnostic Modal binding
    if ($("systemRequirementsBtn")) {
        $("systemRequirementsBtn").onclick = () => {
            openSystemRequirementsModal();
        };
    }

    // Toggle sidebar listener
    const toggleSidebarBtn = $("toggleSidebarBtn");
    if (toggleSidebarBtn) {
        if (localStorage.getItem("sidebar_collapsed") === "true") {
            document.querySelector(".sidebar")?.classList.add("collapsed");
        }
        toggleSidebarBtn.onclick = () => {
            const sidebar = document.querySelector(".sidebar");
            if (sidebar) {
                sidebar.classList.toggle("collapsed");
                localStorage.setItem("sidebar_collapsed", sidebar.classList.contains("collapsed"));
            }
        };
    }

    // Register topbar rename listener
    if ($("detailName")) {
        $("detailName").addEventListener("blur", async () => {
            if (!workflow) return;
            const newName = $("detailName").textContent.trim();
            if (!newName || newName === workflow.name) return;
            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name: newName })
                });
                workflow.name = newName;
                showToast("Workflow renamed.");
                await loadWorkflows();
            } catch (e) {
                showToast(e.message);
            }
        });
    }

    // Check query params for auto-open
    const params = new URLSearchParams(window.location.search);
    const session_id = params.get("session_id");
    if (session_id) {
        selectedWorkflowId = session_id;
        openWorkflow(session_id);
    }
}

// Load Workflows List
async function loadWorkflows() {
    try {
        const data = await api("/sessions");
        workflows = data.sessions || [];
        renderWorkflowList();
        
        if (workflows.length > 0) {
            if (selectedWorkflowId && workflows.some(w => w.id === selectedWorkflowId)) {
                await openWorkflow(selectedWorkflowId);
            } else {
                await openWorkflow(workflows[0].id);
            }
        } else {
            showEmptyState();
        }
    } catch (e) {
        const listEl = $("workflowList");
        if (listEl) listEl.innerHTML = `<div class="no-results">Error loading workflows: ${esc(e.message)}</div>`;
    }
}

// Render Workflows Sidebar List
function renderWorkflowList() {
    const searchEl = $("searchInput");
    const q = (searchEl ? searchEl.value : "").trim().toLowerCase();
    const listEl = $("workflowList");
    if (!listEl) return;

    const filtered = workflows.filter(w => 
        (w.name || "").toLowerCase().includes(q) || 
        (w.application || "").toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="no-results">No workflows found</div>';
        return;
    }

    listEl.innerHTML = filtered.map(w => `
        <div class="workflow-card ${w.id === selectedWorkflowId ? 'selected' : ''}" data-id="${esc(w.id)}">
            <div class="workflow-name">${esc(w.name || "Untitled Workflow")}</div>
            <div class="workflow-meta">
                <span>${w.stepCount || 0} step${w.stepCount === 1 ? "" : "s"}</span>
                <span class="status ${esc(w.status || 'completed')}">${esc(w.status || 'completed')}</span>
            </div>
        </div>
    `).join("");

    document.querySelectorAll(".workflow-card").forEach(card => {
        card.onclick = () => openWorkflow(card.dataset.id);
    });
}

// Show Empty State UI
function showEmptyState() {
    $("emptyState").classList.remove("hidden");
    $("studioView").classList.add("hidden");
}

// Open and load detailed workflow
async function openWorkflow(id) {
    selectedWorkflowId = id;
    renderWorkflowList();
    
    try {
        workflow = await api(`/sessions/${encodeURIComponent(id)}`);
        if ($("emptyState")) $("emptyState").classList.add("hidden");
        if ($("studioView")) $("studioView").classList.remove("hidden");
        
        setText("detailName", workflow.name || "Untitled Workflow");
        setText("detailApplication", workflow.application || "Chrome");
        setText("detailMeta", `${workflow.stepCount || 0} steps • ${workflow.status || 'completed'} • Started ${fmt(workflow.startedAt)}`);
        
        currentStepIndex = 0;
        setTab(activeTab);
    } catch (e) {
        showToast(`Failed to load workflow: ${e.message}`);
        showEmptyState();
    }
}

// Tab Switching
function setTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll(".tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
    });

    ["guide", "steps", "play", "export"].forEach(tab => {
        $(`tab-${tab}`).classList.toggle("hidden", tab !== tabName);
    });

    if (tabName === "guide") renderGuideTab();
    if (tabName === "steps") renderStepsTab();
    if (tabName === "play") renderPlaybackTab();
    if (tabName === "export") renderExportTab();
}

document.querySelectorAll(".tab").forEach(tab => {
    tab.onclick = () => setTab(tab.dataset.tab);
});


/* =========================================================
   CANVAS ANNOTATION ENGINE (Phase 6)
========================================================= */

class AnnotationCanvasEngine {
    constructor(canvasId, imgId, wrapperId, onSaveCallback) {
        this.canvas = $(canvasId);
        this.img = $(imgId);
        this.wrapper = $(wrapperId);
        this.onSave = onSaveCallback;
        this.ctx = this.canvas.getContext("2d");
        
        this.annotations = [];
        this.activeTool = "select";
        this.isDrawing = false;
        this.activeShape = null;
        this.dragOffset = null;
        this.isResizing = false;
        
        // Undo / Redo history stacks (each entry is a deep-cloned annotation array)
        this.undoStack = [];
        this.redoStack = [];
        this._MAX_HISTORY = 50;
        
        // Text style state
        this.textStyle = {
            color: "#7c3aed",
            bgColor: "#7c3aed",
            textColor: "#ffffff",
            styleName: "callout-purple"
        };
        
        // Preset text value
        this.textPreset = "";
        
        // Active Palette Values (Phase 10)
        this.currentColor = "#ef4444";
        this.currentLineWidth = 3;
        this.currentOpacity = 1;
        this.currentTextSize = 12;
        this.currentFontFamily = "Inter";
        this.autoSpotlightEnabled = false; // Auto-spotlight OFF by default
        
        this.img.onload = () => this.resizeCanvas();
        window.addEventListener("resize", () => this.resizeCanvas());

        this.initEvents();
        this.initPaletteEvents();
        this.setTool("select");
    }

    initPaletteEvents() {
        // Color preset selection
        document.querySelectorAll(".color-dot").forEach(dot => {
            dot.onclick = () => {
                document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"));
                dot.classList.add("active");
                this.currentColor = dot.dataset.color;
                if (document.getElementById("currentColorIndicator")) {
                    document.getElementById("currentColorIndicator").style.backgroundColor = this.currentColor;
                }
                this.applyStyleToActiveShape("color", this.currentColor);
            };
        });

        // Custom color picker
        const customColor = $("customColorPicker");
        if (customColor) {
            customColor.oninput = () => {
                document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"));
                this.currentColor = customColor.value;
                if (document.getElementById("currentColorIndicator")) {
                    document.getElementById("currentColorIndicator").style.backgroundColor = this.currentColor;
                }
                this.applyStyleToActiveShape("color", this.currentColor);
            };
        }

        // Thickness / Line width
        const thickSlider = $("lineWidthSlider");
        if (thickSlider) {
            thickSlider.oninput = () => {
                const val = thickSlider.value;
                $("lineWidthVal").textContent = `${val}px`;
                this.currentLineWidth = parseInt(val);
                this.applyStyleToActiveShape("lineWidth", this.currentLineWidth);
            };
        }

        // Opacity
        const opSlider = $("opacitySlider");
        if (opSlider) {
            opSlider.oninput = () => {
                const val = opSlider.value;
                $("opacityVal").textContent = `${val}%`;
                this.currentOpacity = parseFloat(val) / 100;
                this.applyStyleToActiveShape("opacity", this.currentOpacity);
            };
        }

        // Text Size
        const sizeSlider = $("textSizeSlider");
        if (sizeSlider) {
            sizeSlider.oninput = () => {
                const val = sizeSlider.value;
                $("textSizeVal").textContent = `${val}px`;
                this.currentTextSize = parseInt(val);
                this.applyStyleToActiveShape("textSize", this.currentTextSize);
            };
        }

        // Font Family
        const fontSelect = $("fontFamilySelect");
        if (fontSelect) {
            fontSelect.onchange = () => {
                this.currentFontFamily = fontSelect.value;
                this.applyStyleToActiveShape("fontFamily", this.currentFontFamily);
            };
        }
    }

    applyStyleToActiveShape(property, value) {
        if (this.activeShape && this.activeTool === "select") {
            this.pushHistory();
            
            if (property === "lineWidth") this.activeShape.lineWidth = value;
            else if (property === "color") this.activeShape.color = value;
            else if (property === "opacity") this.activeShape.opacity = value;
            else if (property === "textSize") this.activeShape.textSize = value;
            else if (property === "fontFamily") this.activeShape.fontFamily = value;
            
            this.drawAll();
            this.onSave(this.annotations);
        }
    }

    syncPaletteFromShape(shape) {
        if (!shape) return;
        
        // Sync color
        const color = shape.color || "#ef4444";
        document.querySelectorAll(".color-dot").forEach(d => {
            if (d.dataset.color === color) d.classList.add("active");
            else d.classList.remove("active");
        });
        if (document.getElementById("currentColorIndicator")) {
            document.getElementById("currentColorIndicator").style.backgroundColor = color;
        }
        if ($("customColorPicker")) $("customColorPicker").value = color.startsWith("#") ? color : "#ef4444";
        this.currentColor = color;

        // Sync line width
        const lw = shape.lineWidth || 3;
        if ($("lineWidthSlider")) {
            $("lineWidthSlider").value = lw;
            $("lineWidthVal").textContent = `${lw}px`;
        }
        this.currentLineWidth = lw;

        // Sync opacity
        const op = shape.opacity !== undefined ? shape.opacity : 1;
        if ($("opacitySlider")) {
            $("opacitySlider").value = Math.round(op * 100);
            $("opacityVal").textContent = `${Math.round(op * 100)}%`;
        }
        this.currentOpacity = op;

        // Sync text size
        const ts = shape.textSize || 12;
        if ($("textSizeSlider")) {
            $("textSizeSlider").value = ts;
            $("textSizeVal").textContent = `${ts}px`;
        }
        this.currentTextSize = ts;

        // Sync font family
        const ff = shape.fontFamily || "Inter";
        if ($("fontFamilySelect")) {
            $("fontFamilySelect").value = ff;
        }
        this.currentFontFamily = ff;
    }

    /* ---- History helpers ---- */

    // Call BEFORE any mutation to snapshot current state
    pushHistory() {
        this.undoStack.push(JSON.stringify(this.annotations));
        if (this.undoStack.length > this._MAX_HISTORY) this.undoStack.shift();
        this.redoStack = []; // new action clears redo
        this._refreshUndoRedoButtons();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(JSON.stringify(this.annotations));
        this.annotations = JSON.parse(this.undoStack.pop());
        this.activeShape = null;
        this.drawAll();
        this.onSave(this.annotations);
        this._refreshUndoRedoButtons();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        this.undoStack.push(JSON.stringify(this.annotations));
        this.annotations = JSON.parse(this.redoStack.pop());
        this.activeShape = null;
        this.drawAll();
        this.onSave(this.annotations);
        this._refreshUndoRedoButtons();
    }

    _refreshUndoRedoButtons() {
        const undoBtn = $("undoBtn");
        const redoBtn = $("redoBtn");
        if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
    }

    setAnnotations(annotations) {
        this.annotations = JSON.parse(JSON.stringify(annotations || []));
        this.drawAll();
    }

    setTool(tool) {
        this.activeTool = tool;
        this.canvas.className = tool === "select" ? "cursor-select" : (tool === "pan" ? "cursor-grab" : "");
        this.drawAll();
        
        // Dynamic Palette visibility controls (Phase 10)
        const thickGroup = $("group-line-width");
        const opacityGroup = $("group-opacity");
        const textSizeGroup = $("group-text-size");
        const fontFamilyGroup = $("group-font-family");
        
        if (thickGroup) thickGroup.style.display = ["arrow", "rect", "text"].includes(tool) ? "flex" : "none";
        if (opacityGroup) opacityGroup.style.display = ["circle", "rect", "arrow", "text", "blur", "highlight"].includes(tool) ? "flex" : "none";
        if (textSizeGroup) textSizeGroup.style.display = (tool === "text") ? "flex" : "none";
        if (fontFamilyGroup) fontFamilyGroup.style.display = (tool === "text") ? "flex" : "none";
    }

    resizeCanvas() {
        if (!this.img.naturalWidth) return;
        
        const rect = this.img.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        this.drawAll();
    }

    // Convert viewport/client coordinates to Image-Space Coordinates (natural scale)
    clientToImage(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.img.naturalWidth / rect.width;
        const scaleY = this.img.naturalHeight / rect.height;
        
        let x = (clientX - rect.left) * scaleX;
        let y = (clientY - rect.top) * scaleY;

        const snapCheckbox = $("snapToGridCheckbox");
        if (snapCheckbox && snapCheckbox.checked) {
            x = Math.round(x / 10) * 10;
            y = Math.round(y / 10) * 10;
        }
        
        return { x, y };
    }

    // Convert Image-Space coordinates to Canvas (viewport) drawing coordinates
    imageToCanvas(imgX, imgY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width / this.img.naturalWidth;
        const scaleY = rect.height / this.img.naturalHeight;
        
        return {
            x: imgX * scaleX,
            y: imgY * scaleY
        };
    }

    initEvents() {
        this.canvas.onmousedown = (e) => this.handleMouseDown(e);
        this.canvas.onmousemove = (e) => this.handleMouseMove(e);
        this.canvas.onmouseup = (e) => this.handleMouseUp(e);
        this.canvas.oncontextmenu = (e) => this.handleContextMenu(e);

        // Double-click inline edit for text/circle annotations
        this.canvas.ondblclick = (e) => {
            const coords = this.clientToImage(e.clientX, e.clientY);
            const clickedShape = this.findShapeAt(coords.x, coords.y);
            if (clickedShape) {
                if (clickedShape.type === "text") {
                    const newText = prompt("Edit text annotation:", clickedShape.text || "");
                    if (newText !== null) {
                        this.pushHistory();
                        clickedShape.text = newText;
                        this.drawAll();
                        this.onSave(this.annotations);
                    }
                } else if (clickedShape.type === "circle") {
                    const newLabel = prompt("Edit step number/label:", clickedShape.label || "");
                    if (newLabel !== null) {
                        this.pushHistory();
                        clickedShape.label = newLabel;
                        this.drawAll();
                        this.onSave(this.annotations);
                    }
                }
            }
        };

        document.addEventListener("click", () => {
            const menu = $("annotationContextMenu");
            if (menu) menu.classList.add("hidden");
        });
        
        // Keyboard shortcuts
        // Keyboard shortcuts
        window.onkeydown = (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            const isEditingText = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

            // Undo: Ctrl+Z
            if (ctrl && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                this.undo();
                return;
            }
            // Redo: Ctrl+Y or Ctrl+Shift+Z
            if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
                e.preventDefault();
                this.redo();
                return;
            }
            // Delete selected shape (Delete / Backspace key)
            if (!isEditingText && (e.key === "Delete" || e.key === "Backspace") && this.activeShape) {
                e.preventDefault();
                this.pushHistory();
                this.annotations = this.annotations.filter(s => s !== this.activeShape);
                this.activeShape = null;
                this.drawAll();
                this.onSave(this.annotations);
                showToast("Annotation deleted");
            }
        };
    }

    handleContextMenu(e) {
        e.preventDefault();
        const coords = this.clientToImage(e.clientX, e.clientY);
        const clickedShape = this.findShapeAt(coords.x, coords.y);
        
        if (!clickedShape) {
            $("annotationContextMenu").classList.add("hidden");
            return;
        }

        this.activeShape = clickedShape;
        this.drawAll();

        const menu = $("annotationContextMenu");
        menu.classList.remove("hidden");
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        $("menu-duplicate").onclick = (ev) => {
            ev.stopPropagation();
            menu.classList.add("hidden");
            this.pushHistory();
            const copy = JSON.parse(JSON.stringify(clickedShape));
            copy.id = Math.random().toString(36).substr(2, 9);
            copy.x += 20;
            copy.y += 20;
            this.annotations.push(copy);
            this.activeShape = copy;
            this.drawAll();
            this.onSave(this.annotations);
        };

        $("menu-front").onclick = (ev) => {
            ev.stopPropagation();
            menu.classList.add("hidden");
            this.pushHistory();
            this.annotations = this.annotations.filter(s => s !== clickedShape);
            this.annotations.push(clickedShape);
            this.drawAll();
            this.onSave(this.annotations);
        };

        $("menu-back").onclick = (ev) => {
            ev.stopPropagation();
            menu.classList.add("hidden");
            this.pushHistory();
            this.annotations = this.annotations.filter(s => s !== clickedShape);
            this.annotations.unshift(clickedShape);
            this.drawAll();
            this.onSave(this.annotations);
        };

        $("menu-delete").onclick = (ev) => {
            ev.stopPropagation();
            menu.classList.add("hidden");
            this.pushHistory();
            this.annotations = this.annotations.filter(s => s !== clickedShape);
            this.activeShape = null;
            this.drawAll();
            this.onSave(this.annotations);
        };
    }

    handleMouseDown(e) {
        if (this.activeTool === "pan") {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            const stage = $("screenshotStage");
            this.initialScroll = { left: stage ? stage.scrollLeft : 0, top: stage ? stage.scrollTop : 0 };
            return;
        }

        const coords = this.clientToImage(e.clientX, e.clientY);
        
        if (this.activeTool === "select") {
            const clickedShape = this.findShapeAt(coords.x, coords.y);
            if (clickedShape) {
                // Snapshot before drag so drag end can undo the move
                this._dragStartSnapshot = JSON.stringify(this.annotations);
                this.activeShape = clickedShape;
                this.isDrawing = true;
                this.dragOffset = {
                    x: coords.x - clickedShape.x,
                    y: coords.y - clickedShape.y
                };
                // Sync palette controls to selected shape style
                this.syncPaletteFromShape(clickedShape);
            } else {
                this.activeShape = null;
            }
            this.drawAll();
        } else {
            // Snapshot BEFORE creating new shape
            this.pushHistory();
            this.isDrawing = true;
            let label = "";
            if (this.activeTool === "circle") {
                const circles = this.annotations.filter(s => s.type === "circle");
                label = String(circles.length + 1);
            }
            
            const isText = this.activeTool === "text";
            const isHighlight = this.activeTool === "highlight";
            this.activeShape = {
                id: Math.random().toString(36).substr(2, 9),
                type: this.activeTool,
                x: coords.x,
                y: coords.y,
                w: 0,
                h: 0,
                color: isText ? this.textStyle.color : this.currentColor,
                bgColor: isText ? this.textStyle.bgColor : null,
                textColor: isText ? this.textStyle.textColor : null,
                styleName: isText ? this.textStyle.styleName : null,
                lineWidth: this.currentLineWidth,
                opacity: isHighlight ? 0.4 : this.currentOpacity,
                textSize: this.currentTextSize,
                fontFamily: this.currentFontFamily,
                label: label,
                text: isText ? (this.textPreset || "") : ""
            };
            this.textPreset = "";
            this.annotations.push(this.activeShape);
        }
    }

    handleMouseMove(e) {
        if (this.isPanning) {
            const dx = e.clientX - this.panStart.x;
            const dy = e.clientY - this.panStart.y;
            const stage = $("screenshotStage");
            if (stage) {
                stage.scrollLeft = this.initialScroll.left - dx;
                stage.scrollTop = this.initialScroll.top - dy;
            }
            return;
        }

        if (!this.isDrawing || !this.activeShape) return;
        
        const coords = this.clientToImage(e.clientX, e.clientY);
        
        if (this.activeTool === "select") {
            // Drag shape
            this.activeShape.x = coords.x - this.dragOffset.x;
            this.activeShape.y = coords.y - this.dragOffset.y;
        } else {
            // Resize shape while drawing
            this.activeShape.w = coords.x - this.activeShape.x;
            this.activeShape.h = coords.y - this.activeShape.y;
        }
        
        this.drawAll();
    }

    handleMouseUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            return;
        }

        if (!this.isDrawing) return;
        this.isDrawing = false;
        
        if (this.activeTool === "select") {
            // Commit drag: snapshot the state BEFORE drag started as undo entry
            if (this._dragStartSnapshot) {
                const before = this._dragStartSnapshot;
                const after = JSON.stringify(this.annotations);
                if (before !== after) {
                    // Push the pre-drag snapshot so Ctrl+Z will undo the move
                    this.undoStack.push(before);
                    if (this.undoStack.length > this._MAX_HISTORY) this.undoStack.shift();
                    this.redoStack = [];
                    this._refreshUndoRedoButtons();
                }
                this._dragStartSnapshot = null;
            }
        } else {
            if (this.activeTool === "crop") {
                const shape = this.activeShape;
                this.annotations = this.annotations.filter(s => s !== shape);
                this.undoStack.pop();
                this._refreshUndoRedoButtons();
                this.activeShape = null;

                if (Math.abs(shape.w) > 10 && Math.abs(shape.h) > 10) {
                    setTimeout(async () => {
                        if (confirm("Crop the screenshot to this selected region?")) {
                            try {
                                const steps = workflow.steps || [];
                                const step = steps[currentStepIndex];
                                const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/screenshot/crop`, {
                                    method: "POST",
                                    body: JSON.stringify({
                                        x: shape.x,
                                        y: shape.y,
                                        w: shape.w,
                                        h: shape.h
                                    })
                                });

                                if (res.success) {
                                    step.screenshotUrl = res.screenshotUrl;
                                    const x1 = Math.min(shape.x, shape.x + shape.w);
                                    const y1 = Math.min(shape.y, shape.y + shape.h);
                                    if (step.annotations) {
                                        step.annotations.forEach(a => {
                                            a.x = a.x - x1;
                                            a.y = a.y - y1;
                                        });
                                    }
                                    loadActiveStepDetails();
                                    renderStepThumbnails();
                                    showToast("Image cropped successfully.");
                                } else {
                                    showToast("Failed to crop image.");
                                }
                            } catch (err) {
                                showToast("Error cropping image: " + err.message);
                            }
                        }
                        this.setTool("select");
                        document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
                        $("tool-select").classList.add("active");
                    }, 50);
                }
            } else {
                // Avoid micro-clicks that create invisible shapes
                if (Math.abs(this.activeShape.w) < 5 && Math.abs(this.activeShape.h) < 5) {
                    if (this.activeShape.type === "circle") {
                        this.activeShape.w = 50;
                        this.activeShape.h = 50;
                    } else if (this.activeShape.type === "text") {
                        this.activeShape.w = 120;
                        this.activeShape.h = 40;
                        this.editText(this.activeShape);
                    } else {
                        // Remove micro shape, but also remove the history entry we just pushed
                        this.annotations.pop();
                        this.undoStack.pop();
                        this._refreshUndoRedoButtons();
                        this.activeShape = null;
                    }
                } else if (this.activeShape.type === "text") {
                    this.editText(this.activeShape);
                }
            }
        }
        
        this.drawAll();
        this.onSave(this.annotations);
    }

    findShapeAt(x, y) {
        // Iterate backwards to select topmost item
        for (let i = this.annotations.length - 1; i >= 0; i--) {
            const s = this.annotations[i];
            if (s.type === "circle") {
                // Circle hit test
                const r = s.w / 2;
                const cx = s.x + r;
                const cy = s.y + r;
                const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                if (dist <= r + 10) return s;
            } else {
                // Box hit test
                const xMin = Math.min(s.x, s.x + s.w);
                const xMax = Math.max(s.x, s.x + s.w);
                const yMin = Math.min(s.y, s.y + s.h);
                const yMax = Math.max(s.y, s.y + s.h);
                
                if (x >= xMin - 10 && x <= xMax + 10 && y >= yMin - 10 && y <= yMax + 10) {
                    return s;
                }
            }
        }
        return null;
    }

    editText(shape) {
        // If shape has a preset text already set, commit immediately
        if (shape.text && shape.text.length > 0) {
            // Ensure size is set
            if (Math.abs(shape.w) < 5) {
                const approxW = Math.max(120, shape.text.length * 8 + 24);
                shape.w = approxW;
                shape.h = 36;
            }
            this.drawAll();
            this.onSave(this.annotations);
            return;
        }
        
        const canvasCoords = this.imageToCanvas(shape.x, shape.y);
        const input = document.createElement("input");
        input.type = "text";
        input.value = shape.text || "";
        input.placeholder = "Type callout text...";
        input.style.position = "absolute";
        input.style.left = `${canvasCoords.x}px`;
        input.style.top = `${canvasCoords.y}px`;
        input.style.zIndex = 100;
        input.style.border = `2px solid ${shape.color || "#7c3aed"}`;
        input.style.outline = "none";
        input.style.padding = "5px 8px";
        input.style.background = shape.bgColor || "#ffffff";
        input.style.color = shape.textColor || "#000000";
        input.style.fontSize = "12px";
        input.style.fontFamily = "Inter, sans-serif";
        input.style.fontWeight = "600";
        input.style.borderRadius = "4px";
        input.style.minWidth = "120px";
        input.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
        
        this.wrapper.appendChild(input);
        input.focus();
        input.select();
        
        const commit = () => {
            shape.text = input.value.trim() || "";
            if (shape.text && Math.abs(shape.w) < 5) {
                shape.w = Math.max(120, shape.text.length * 8 + 24);
                shape.h = 36;
            }
            if (input.parentNode) input.parentNode.removeChild(input);
            this.drawAll();
            this.onSave(this.annotations);
        };
        
        input.onblur = commit;
        input.onkeydown = (e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
                // Cancel — remove the shape
                this.annotations = this.annotations.filter(s => s !== shape);
                if (input.parentNode) input.parentNode.removeChild(input);
                this.drawAll();
            }
        };
    }

    drawAll() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 1. Draw Red Dashed Focus Box around target element
        if (this.focusBoxEnabled !== false && workflow && workflow.steps && workflow.steps[currentStepIndex]) {
            const step = workflow.steps[currentStepIndex];
            const screen = step.element?.screen;
            if (screen && screen.width > 0 && screen.height > 0) {
                const sw = Number(screen.viewportWidth || screen.width);
                const sh = Number(screen.viewportHeight || screen.height);
                if (sw && sh) {
                    const scaleX = this.canvas.width / sw;
                    const scaleY = this.canvas.height / sh;
                    
                    const x = screen.x * scaleX;
                    const y = screen.y * scaleY;
                    const w = screen.width * scaleX;
                    const h = screen.height * scaleY;
                    
                    // Only draw if target element is inside visible canvas bounds
                    if (x >= -10 && y >= -10 && x + w <= this.canvas.width + 30 && y + h <= this.canvas.height + 30) {
                        this.ctx.save();
                        this.ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
                        this.ctx.lineWidth = 3;
                        this.ctx.setLineDash([6, 4]);
                        this.ctx.strokeRect(x, y, w, h);
                        this.ctx.restore();
                    }
                }
            }
        }

        // 2. Render annotations
        this.annotations.forEach(s => {
            const pos = this.imageToCanvas(s.x, s.y);
            const w = s.w * (this.canvas.width / this.img.naturalWidth);
            const h = s.h * (this.canvas.height / this.img.naturalHeight);
            
            this.ctx.save();
            
            // Apply shape opacity
            this.ctx.globalAlpha = s.opacity !== undefined ? s.opacity : 1;
            
            // Set basic line thickness
            this.ctx.lineWidth = s.lineWidth || 3;
            
            if (s === this.activeShape && this.activeTool === "select") {
                this.ctx.strokeStyle = "#7c3aed"; // Active select indicator
            } else {
                this.ctx.strokeStyle = s.color || "#ef4444";
            }
            
            if (s.type === "circle") {
                // Circle marker
                const r = Math.max(16, Math.abs(w / 2));
                const cx = pos.x + r;
                const cy = pos.y + r;
                
                this.ctx.beginPath();
                this.ctx.arc(cx, cy, r, 0, 2 * Math.PI);
                this.ctx.fillStyle = s.color || "#ef4444";
                this.ctx.fill();
                this.ctx.stroke();
                
                // Label sequence number
                this.ctx.fillStyle = "#ffffff";
                this.ctx.font = "bold 13px Arial";
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
                this.ctx.fillText(s.label || "1", cx, cy);
            }
            else if (s.type === "rect") {
                this.ctx.strokeRect(pos.x, pos.y, w, h);
                this.ctx.fillStyle = s.color ? (s.color + "26") : "rgba(239, 68, 68, 0.15)"; // 15% opacity suffix
                this.ctx.fillRect(pos.x, pos.y, w, h);
            }
            else if (s.type === "highlight") {
                this.ctx.fillStyle = s.color ? (s.color + "66") : "rgba(253, 224, 71, 0.4)"; // 40% opacity suffix
                this.ctx.fillRect(pos.x, pos.y, w, h);
            }
            else if (s.type === "blur") {
                this.ctx.fillStyle = "#151821";
                this.ctx.fillRect(pos.x, pos.y, w, h);
                
                this.ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
                this.ctx.fillRect(pos.x, pos.y, w, h);
                
                this.ctx.strokeStyle = "#4b5563";
                this.ctx.lineWidth = 1;
                this.ctx.setLineDash([4, 4]);
                this.ctx.strokeRect(pos.x, pos.y, w, h);
                this.ctx.setLineDash([]);
                
                this.ctx.fillStyle = "#9ca3af";
                this.ctx.font = "10px sans-serif";
                this.ctx.textAlign = "center";
                this.ctx.fillText("REDACTED", pos.x + w/2, pos.y + h/2 + 3);
            }
            else if (s.type === "crop") {
                this.ctx.strokeStyle = "#3b82f6";
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([6, 4]);
                this.ctx.strokeRect(pos.x, pos.y, w, h);
                this.ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
                this.ctx.fillRect(pos.x, pos.y, w, h);
                this.ctx.setLineDash([]);
            }
            else if (s.type === "spotlight") {
                const cx = pos.x + w / 2;
                const cy = pos.y + h / 2;
                const rx = Math.abs(w / 2) + 20;
                const ry = Math.abs(h / 2) + 20;
                const cw = this.canvas.width;
                const ch = this.canvas.height;

                // Dark overlay with ellipse punch-out using composite
                this.ctx.save();
                this.ctx.globalAlpha = 0.45;
                this.ctx.fillStyle = "#000000";
                this.ctx.fillRect(0, 0, cw, ch);
                this.ctx.globalCompositeOperation = "destination-out";
                this.ctx.beginPath();
                this.ctx.ellipse(cx, cy, rx + 10, ry + 10, 0, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.restore();

                // Glowing border ring
                this.ctx.save();
                this.ctx.globalAlpha = 1;
                this.ctx.strokeStyle = s.color || "#6366f1";
                this.ctx.lineWidth = 3;
                this.ctx.shadowColor = s.color || "#6366f1";
                this.ctx.shadowBlur = 14;
                this.ctx.beginPath();
                this.ctx.ellipse(cx, cy, rx + 10, ry + 10, 0, 0, 2 * Math.PI);
                this.ctx.stroke();
                this.ctx.restore();

                // Step number badge
                if (s.label) {
                    const bx = cx + rx + 10;
                    const by = cy - ry - 10;
                    this.ctx.save();
                    this.ctx.fillStyle = s.color || "#6366f1";
                    this.ctx.beginPath();
                    this.ctx.arc(bx, by, 12, 0, 2 * Math.PI);
                    this.ctx.fill();
                    this.ctx.fillStyle = "#ffffff";
                    this.ctx.font = "bold 11px Arial";
                    this.ctx.textAlign = "center";
                    this.ctx.textBaseline = "middle";
                    this.ctx.fillText(s.label, bx, by);
                    this.ctx.restore();
                }
            }
            else if (s.type === "arrow") {
                this.drawArrow(pos.x, pos.y, pos.x + w, pos.y + h, s.lineWidth || 3);
            }
            else if (s.type === "text") {
                const bgCol = s.bgColor || "#7c3aed";
                const txtCol = s.textColor || "#ffffff";
                const borderCol = s.color || "#7c3aed";
                const rw = Math.abs(w) || 120;
                const rh = Math.abs(h) || 36;
                const rx = w < 0 ? pos.x + w : pos.x;
                const ry = h < 0 ? pos.y + h : pos.y;
                
                // Rounded rect fill
                const rad = 5;
                this.ctx.beginPath();
                this.ctx.moveTo(rx + rad, ry);
                this.ctx.lineTo(rx + rw - rad, ry);
                this.ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rad);
                this.ctx.lineTo(rx + rw, ry + rh - rad);
                this.ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rad, ry + rh);
                this.ctx.lineTo(rx + rad, ry + rh);
                this.ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rad);
                this.ctx.lineTo(rx, ry + rad);
                this.ctx.quadraticCurveTo(rx, ry, rx + rad, ry);
                this.ctx.closePath();
                this.ctx.fillStyle = bgCol;
                this.ctx.fill();
                this.ctx.strokeStyle = borderCol;
                this.ctx.lineWidth = s.lineWidth || 2;
                this.ctx.stroke();
                
                this.ctx.fillStyle = txtCol;
                const textSize = s.textSize || 12;
                const fontFamily = s.fontFamily || "Inter";
                this.ctx.font = `bold ${textSize}px ${fontFamily}, Arial, sans-serif`;
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
                const displayText = s.text || "";
                this.ctx.fillText(displayText, rx + rw / 2, ry + rh / 2);
            }
            
            this.ctx.restore();
        });
    }

    drawArrow(fromx, fromy, tox, toy, lineWidth = 3) {
        const color = this.ctx.strokeStyle;
        const dx = tox - fromx;
        const dy = toy - fromy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 2) return;
        
        const angle = Math.atan2(dy, dx);
        const headLen = Math.min(28, Math.max(16, len * 0.22)); // proportional head
        const headAngle = Math.PI / 6; // 30 degrees
        
        // Shorten line so it doesn't overlap arrowhead
        const bodyEndX = tox - headLen * 0.72 * Math.cos(angle);
        const bodyEndY = toy - headLen * 0.72 * Math.sin(angle);
        
        // Draw shaft (thicker line)
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;
        this.ctx.lineCap = "round";
        this.ctx.beginPath();
        this.ctx.moveTo(fromx, fromy);
        this.ctx.lineTo(bodyEndX, bodyEndY);
        this.ctx.stroke();
        
        // Draw filled triangular arrowhead
        this.ctx.beginPath();
        this.ctx.moveTo(tox, toy); // tip
        this.ctx.lineTo(
            tox - headLen * Math.cos(angle - headAngle),
            toy - headLen * Math.sin(angle - headAngle)
        );
        this.ctx.lineTo(
            tox - headLen * 0.5 * Math.cos(angle),
            toy - headLen * 0.5 * Math.sin(angle)
        );
        this.ctx.lineTo(
            tox - headLen * Math.cos(angle + headAngle),
            toy - headLen * Math.sin(angle + headAngle)
        );
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.restore();
    }

    /**
     * Generate a spotlight annotation from a step's element.screen coordinates.
     * Converts viewport pixel coords → image-relative pixel coords.
     */
    generateSpotlightFromElement(element, stepSequence) {
        if (!element || !element.screen) return null;
        const sc = element.screen;
        if (!sc.viewportWidth || !sc.viewportHeight || sc.width <= 0 || sc.height <= 0) return null;

        const imgW = this.img.naturalWidth || 1280;
        const imgH = this.img.naturalHeight || 800;

        // element.screen coords are CSS px relative to viewport; image was captured at same viewport size
        const scaleX = imgW / sc.viewportWidth;
        const scaleY = imgH / sc.viewportHeight;

        const posX = sc.x * scaleX;
        const posY = sc.y * scaleY;
        const posW = sc.width * scaleX;
        const posH = sc.height * scaleY;

        // Bounds validation: omit if element position is outside visible image bounds
        if (posY + posH > imgH + 20 || posX + posW > imgW + 20 || posY < -20 || posX < -20) {
            return null;
        }

        return {
            id: "auto-spotlight",
            type: "spotlight",
            x: posX,
            y: posY,
            w: posW,
            h: posH,
            color: "#6366f1",
            opacity: 1,
            lineWidth: 3,
            label: String(stepSequence || "1"),
            autoGenerated: true
        };
    }

    /**
     * Apply auto-spotlight for a step. Removes any previous auto-generated spotlight
     * and inserts a new one based on element coordinates.
     */
    applyAutoSpotlight(element, stepSequence, existingAnnotations) {
        const filtered = (existingAnnotations || []).filter(a => !a.autoGenerated);
        if (!this.autoSpotlightEnabled) return filtered;
        const spot = this.generateSpotlightFromElement(element, stepSequence);
        if (!spot) return filtered;
        return [spot, ...filtered]; // spotlight as bottom layer
    }
}


/* =========================================================
   GUIDE & DETAILS LOGIC
========================================================= */

let currentZoom = 1.0;

function applyZoom(zoomFactor) {
    currentZoom = Math.min(3.0, Math.max(0.5, zoomFactor));
    const wrapper = $("canvasWrapper");
    if (wrapper) {
        if (currentZoom <= 1.0) {
            wrapper.style.transform = "none";
        } else {
            wrapper.style.transform = `scale(${currentZoom})`;
            wrapper.style.transformOrigin = "center center";
        }
    }
    const label = $("zoomLabel");
    if (label) {
        label.textContent = currentZoom <= 1.0 ? "Fit" : `${Math.round(currentZoom * 100)}%`;
    }
}

function autoFitZoom() {
    applyZoom(1.0);
    if (canvasEngine) canvasEngine.resizeCanvas();
}

function renderGuideTab() {
    const steps = workflow.steps || [];
    
    if (steps.length === 0) {
        if ($("guideImg")) $("guideImg").classList.add("hidden");
        if ($("canvasWrapper")) $("canvasWrapper").classList.add("hidden");
        if ($("noScreenshot")) {
            $("noScreenshot").classList.remove("hidden");
            $("noScreenshot").textContent = "No steps in this workflow yet. Click '🖥️ Capture Desktop Screen' above to add your first step!";
        }
        return;
    }

    if (!canvasEngine) {
        canvasEngine = new AnnotationCanvasEngine(
            "annotationCanvas",
            "guideImg",
            "canvasWrapper",
            (annotations) => saveStepAnnotations(annotations)
        );

        // Bind drawing tool triggers (excluding text, which has its own caret)
        ["select", "pan", "circle", "arrow", "rect", "highlight", "blur", "crop"].forEach(tool => {
            $(`tool-${tool}`).onclick = () => {
                document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
                $(`tool-${tool}`).classList.add("active");
                canvasEngine.setTool(tool);
                // Close text picker if open
                $("textStylePicker").classList.add("hidden");
            };
        });

        // Text tool main button
        $("tool-text").onclick = () => {
            document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
            $("tool-text").classList.add("active");
            canvasEngine.setTool("text");
            $("textStylePicker").classList.add("hidden");
        };

        // Text style caret toggle
        $("tool-text-caret").onclick = (e) => {
            e.stopPropagation();
            $("textStylePicker").classList.toggle("hidden");
        };

        // Text style buttons (color schemes)
        document.querySelectorAll(".text-style-btn").forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll(".text-style-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                canvasEngine.textStyle = {
                    color: btn.dataset.color,
                    bgColor: btn.dataset.bg,
                    textColor: btn.dataset.text,
                    styleName: btn.dataset.style
                };
                // Activate text tool
                document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
                $("tool-text").classList.add("active");
                canvasEngine.setTool("text");
                $("textStylePicker").classList.add("hidden");
            };
        });

        // Text preset buttons (quick labels)
        document.querySelectorAll(".text-preset-btn").forEach(btn => {
            btn.onclick = () => {
                canvasEngine.textPreset = btn.dataset.preset;
                // Activate text tool
                document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
                $("tool-text").classList.add("active");
                canvasEngine.setTool("text");
                $("textStylePicker").classList.add("hidden");
            };
        });

        // Color Picker toggle
        if ($("tool-color-picker")) {
            $("tool-color-picker").onclick = (e) => {
                e.stopPropagation();
                $("palettePanel").classList.toggle("hidden");
            };
        }

        // Close pickers when clicking elsewhere
        document.addEventListener("click", (e) => {
            const textWrapper = $("textToolWrapper");
            const textPicker = $("textStylePicker");
            if (textWrapper && textPicker && !textWrapper.contains(e.target) && !textPicker.contains(e.target)) {
                textPicker.classList.add("hidden");
            }
            const colorBtn = $("tool-color-picker");
            const palette = $("palettePanel");
            if (colorBtn && palette && !colorBtn.contains(e.target) && !palette.contains(e.target)) {
                palette.classList.add("hidden");
            }
        });

        $("clearAnnotationsBtn").onclick = () => {
            if (canvasEngine && canvasEngine.activeShape) {
                // Delete selected annotation shape
                canvasEngine.pushHistory();
                canvasEngine.annotations = canvasEngine.annotations.filter(s => s !== canvasEngine.activeShape);
                canvasEngine.activeShape = null;
                canvasEngine.drawAll();
                saveStepAnnotations(canvasEngine.annotations);
                showToast("Selected annotation deleted");
            } else {
                // Clear all annotations
                if (confirm("Clear all annotations on this step?")) {
                    canvasEngine.pushHistory();
                    canvasEngine.setAnnotations([]);
                    saveStepAnnotations([]);
                    showToast("All annotations cleared");
                }
            }
        };

        if ($("deleteCurrentStepBtn")) {
            $("deleteCurrentStepBtn").onclick = async () => {
                const steps = workflow.steps || [];
                if (currentStepIndex < 0 || currentStepIndex >= steps.length) return;
                const step = steps[currentStepIndex];
                if (confirm(`Are you sure you want to delete Step ${currentStepIndex + 1}?`)) {
                    try {
                        await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/edits`, {
                            method: "PATCH",
                            body: JSON.stringify({ hidden: true })
                        });
                        step.hidden = true;
                        showToast(`Step ${currentStepIndex + 1} deleted`);

                        const visibleSteps = workflow.steps.filter(s => !s.hidden);
                        if (visibleSteps.length > 0) {
                            if (currentStepIndex >= visibleSteps.length) {
                                currentStepIndex = visibleSteps.length - 1;
                            }
                            renderGuideTab();
                        } else {
                            renderGuideTab();
                        }
                        renderStepsTab();
                    } catch(err) {
                        showToast(err.message);
                    }
                }
            };
        }

// Helper for robust frame capture from DisplayMedia stream
function captureStreamFrame(stream) {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.style.position = "fixed";
        video.style.top = "-9999px";
        video.style.left = "-9999px";
        video.style.width = "1px";
        video.style.height = "1px";
        video.style.opacity = "0";
        video.srcObject = stream;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        document.body.appendChild(video);

        let resolved = false;

        const cleanup = () => {
            try {
                stream.getTracks().forEach(t => t.stop());
                video.pause();
                video.srcObject = null;
                if (video.parentNode) video.parentNode.removeChild(video);
            } catch(e) {}
        };

        const doGrab = () => {
            if (resolved) return;
            resolved = true;
            try {
                const tempCanvas = document.createElement("canvas");
                const w = video.videoWidth || 1920;
                const h = video.videoHeight || 1080;
                tempCanvas.width = w;
                tempCanvas.height = h;
                const ctx = tempCanvas.getContext("2d");
                ctx.drawImage(video, 0, 0, w, h);
                
                cleanup();
                
                const dataUrl = tempCanvas.toDataURL("image/png");
                resolve(dataUrl);
            } catch (err) {
                cleanup();
                reject(err);
            }
        };

        video.onloadeddata = () => {
            video.play().then(() => setTimeout(doGrab, 300)).catch(() => setTimeout(doGrab, 300));
        };

        video.onerror = (err) => {
            cleanup();
            reject(err);
        };

        // Safety fallback timeout
        setTimeout(doGrab, 1000);
    });
}


        // ── Desktop Capture Modal: open on button click ──────────────────────
        if ($("captureDesktopBtn")) {
            $("captureDesktopBtn").onclick = () => openDesktopCaptureModal();
        }



        if ($("tool-color-picker")) {
            $("tool-color-picker").onclick = () => {
                const bar = $("canvasPaletteBar");
                if (bar) bar.classList.toggle("hidden");
            };
        }

        setOnclick("undoBtn", () => canvasEngine && canvasEngine.undo());
        setOnclick("redoBtn", () => canvasEngine && canvasEngine.redo());

        setOnclick("recalcHighlightBtn", () => {
            if (canvasEngine) {
                canvasEngine.focusBoxEnabled = !canvasEngine.focusBoxEnabled;
                canvasEngine.drawAll();
                showToast(canvasEngine.focusBoxEnabled ? "Red Focus Box ON" : "Red Focus Box OFF");
            }
        });

        // Steps bottom drawer toggle
        setOnclick("stepsDrawerToggle", () => {
            const drawer = $("stepsBottomDrawer");
            if (drawer) drawer.classList.toggle("collapsed");
        });

        const drawerHeader = $("stepsDrawerHeader");
        if (drawerHeader) {
            drawerHeader.onclick = (e) => {
                const collapseBtn = $("stepsDrawerCollapse");
                if (collapseBtn && !collapseBtn.contains(e.target) && e.target !== collapseBtn) return;
                const drawer = $("stepsBottomDrawer");
                if (drawer) drawer.classList.toggle("collapsed");
            };
        }

        setOnclick("stepsDrawerCollapse", () => {
            const drawer = $("stepsBottomDrawer");
            if (drawer) drawer.classList.toggle("collapsed");
        });

        // Step detail drawer close
        setOnclick("drawerCloseBtn", () => {
            const drawer = $("stepDetailDrawer");
            if (drawer) drawer.classList.remove("open");
        });

        // Navigation
        setOnclick("prevBtn", () => {
            if (currentStepIndex > 0) {
                currentStepIndex--;
                loadActiveStepDetails();
            }
        });

        setOnclick("nextBtn", () => {
            if (currentStepIndex < steps.length - 1) {
                currentStepIndex++;
                loadActiveStepDetails();
            }
        });

        // Save Edits Click (Manual)
        setOnclick("saveEditsBtn", saveActiveStepEdits);
        setOnclick("hideStepBtn", toggleActiveStepHidden);

        // Auto-Save listeners for step details (Requirement 4)
        const autoSaveInputs = [
            "guideStepTitle", "guideStepDesc", "guideStepExpected", 
            "guideStepNote", "guideStepVoiceover", "guideHotspotPrompt",
            "hotspotX", "hotspotY", "hotspotW", "hotspotH"
        ];
        autoSaveInputs.forEach(id => {
            const el = $(id);
            if (el) {
                el.addEventListener("input", () => scheduleAutoSave(600));
                el.addEventListener("change", () => scheduleAutoSave(200));
            }
        });

        // Hotspot Editor buttons (Requirement 2)
        setOnclick("btnAutoDetectHotspot", () => {
            const steps = workflow.steps || [];
            const step = steps[currentStepIndex];
            if (!step || !step.element || !step.element.screen) {
                showToast("No recorded DOM element coordinates for this step");
                return;
            }
            const sc = step.element.screen;
            const vw = sc.viewportWidth || 1280;
            const vh = sc.viewportHeight || 800;
            const xPct = Math.round(Math.max(0, Math.min(95, (sc.x / vw) * 100)));
            const yPct = Math.round(Math.max(0, Math.min(95, (sc.y / vh) * 100)));
            const wPct = Math.round(Math.max(4, Math.min(80, (sc.width / vw) * 100)));
            const hPct = Math.round(Math.max(4, Math.min(80, (sc.height / vh) * 100)));
            setVal("hotspotX", xPct);
            setVal("hotspotY", yPct);
            setVal("hotspotW", wPct);
            setVal("hotspotH", hPct);
            showToast("Hotspot auto-detected from recorded action");
            scheduleAutoSave(200);
        });

        setOnclick("btnSyncFromSpotlight", () => {
            const steps = workflow.steps || [];
            const step = steps[currentStepIndex];
            if (!step) return;
            const annotations = Array.isArray(step.annotations) ? step.annotations : [];
            const spot = annotations.find(a => a.type === "spotlight" || a.type === "rect" || a.type === "circle");
            if (spot && spot.w > 0 && spot.h > 0) {
                const imgW = 1280;
                const imgH = 800;
                const xPct = Math.round(Math.max(0, Math.min(95, (spot.x / imgW) * 100)));
                const yPct = Math.round(Math.max(0, Math.min(95, (spot.y / imgH) * 100)));
                const wPct = Math.round(Math.max(4, Math.min(80, (spot.w / imgW) * 100)));
                const hPct = Math.round(Math.max(4, Math.min(80, (spot.h / imgH) * 100)));
                setVal("hotspotX", xPct);
                setVal("hotspotY", yPct);
                setVal("hotspotW", wPct);
                setVal("hotspotH", hPct);
                showToast("Hotspot synced from canvas spotlight");
                scheduleAutoSave(200);
            } else {
                showToast("No spotlight annotation found on canvas");
            }
        });

        setOnclick("btnResetHotspot", () => {
            setVal("hotspotX", 40);
            setVal("hotspotY", 40);
            setVal("hotspotW", 20);
            setVal("hotspotH", 20);
            showToast("Hotspot reset to center");
            scheduleAutoSave(200);
        });

        // Zoom Click Bindings (Phase 11)
        setOnclick("zoomInBtn", () => {
            applyZoom(currentZoom + 0.1);
            if (canvasEngine) canvasEngine.resizeCanvas();
        });
        setOnclick("zoomOutBtn", () => {
            applyZoom(currentZoom - 0.1);
            if (canvasEngine) canvasEngine.resizeCanvas();
        });
        setOnclick("zoomFitBtn", () => {
            autoFitZoom();
        });

        // Step checked/approval change (Phase 10 / User request)
        setOnchange("guideStepChecked", async () => {
            const steps = workflow.steps || [];
            const step = steps[currentStepIndex];
            if (!step) return;

            const isChecked = $("guideStepChecked").checked;
            step.checked = isChecked;

            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/edits`, {
                    method: "PATCH",
                    body: JSON.stringify({ checked: isChecked })
                });
                renderStepThumbnails(); // redraw check icon overlay
                showToast(isChecked ? "Step approved." : "Step unapproved.");
            } catch (e) {
                showToast("Failed to update step approval state: " + e.message);
                $("guideStepChecked").checked = !isChecked; // revert
                step.checked = !isChecked;
            }
        });

        // Replace Step Screenshot (Phase 11)
        $("replaceScreenshotInput").onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const steps = workflow.steps || [];
            const step = steps[currentStepIndex];
            if (!step) return;

            const reader = new FileReader();
            reader.onload = async () => {
                const base64Img = reader.result;
                try {
                    const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/screenshot`, {
                        method: "POST",
                        body: JSON.stringify({ image: base64Img })
                    });
                    if (res.success) {
                        step.screenshotUrl = res.screenshotUrl;
                        loadActiveStepDetails();
                        renderStepThumbnails();
                        showToast("Screenshot replaced successfully.");
                    } else {
                        showToast("Failed to replace screenshot.");
                    }
                } catch (err) {
                    showToast("Error replacing screenshot: " + err.message);
                }
            };
            reader.readAsDataURL(file);
        };

        // AI Enhance Step
        $("aiEnhanceStepBtn").onclick = async () => {
            const steps = workflow.steps || [];
            const step = steps[currentStepIndex];
            if (!step) return;

            const originalText = $("aiEnhanceStepBtn").textContent;
            $("aiEnhanceStepBtn").textContent = "✨ Thinking...";
            $("aiEnhanceStepBtn").disabled = true;

            try {
                const res = await api("/ai/describe-step", {
                    method: "POST",
                    body: JSON.stringify({
                        step_id: step.id,
                        session_id: workflow.id
                    })
                });

                if (res.success) {
                    $("guideStepTitle").textContent = res.title;
                    $("guideStepDesc").textContent = res.description;
                    $("guideStepExpected").value = res.expected;
                    
                    step.title = res.title;
                    step.description = res.description;
                    step.expected = res.expected;

                    showToast("Step details enhanced with AI.");
                } else {
                    showToast("Ollama is running, but enhance failed.");
                }
            } catch (e) {
                console.error("AI Enhance Error:", e);
                showToast("Ollama Offline. Start Ollama and load models first.");
            } finally {
                $("aiEnhanceStepBtn").textContent = originalText;
                $("aiEnhanceStepBtn").disabled = false;
            }
        };

        // AI Polish SOP
        $("aiPolishBtn").onclick = async () => {
            if (!workflow) return;

            const originalText = $("aiPolishBtn").textContent;
            $("aiPolishBtn").textContent = "🤖 Polishing...";
            $("aiPolishBtn").disabled = true;

            try {
                const res = await api("/ai/polish-sop", {
                    method: "POST",
                    body: JSON.stringify({
                        session_id: workflow.id
                    })
                });

                if (res.success) {
                    showToast("SOP text polished by AI.");
                    await openWorkflow(workflow.id);
                } else {
                    showToast("SOP polish failed.");
                }
            } catch (e) {
                console.error("AI Polish Error:", e);
                showToast("AI Offline. Please start Ollama first.");
            } finally {
                $("aiPolishBtn").textContent = originalText;
                $("aiPolishBtn").disabled = false;
            }
        };

        // AI Auto-Redact
        $("tool-ai-redact").onclick = async () => {
            const steps = workflow.steps || [];
            const step = steps[currentStepIndex];
            if (!step) return;

            const originalHtml = $("tool-ai-redact").innerHTML;
            $("tool-ai-redact").innerHTML = "...";
            $("tool-ai-redact").disabled = true;

            try {
                const res = await api("/ai/detect-redact", {
                    method: "POST",
                    body: JSON.stringify({
                        step_id: step.id,
                        session_id: workflow.id
                    })
                });

                if (res.success && res.regions && res.regions.length > 0) {
                    canvasEngine.pushHistory();
                    const currentAnnotations = step.annotations || [];
                    const updated = [...currentAnnotations, ...res.regions];
                    
                    step.annotations = updated;
                    canvasEngine.setAnnotations(updated);
                    await saveStepAnnotations(updated);
                    
                    showToast(`AI redacted ${res.regions.length} sensitive area(s).`);
                } else {
                    showToast("No confidential fields detected on this page.");
                }
            } catch (e) {
                console.error("AI Redact Error:", e);
                showToast("Ollama Offline. Start Ollama and pull models first.");
            } finally {
                $("tool-ai-redact").innerHTML = originalHtml;
                $("tool-ai-redact").disabled = false;
            }
        };
    }

    // Spotlight Toggle button
    if ($("tool-spotlight-toggle")) {
        $("tool-spotlight-toggle").onclick = () => {
            canvasEngine.autoSpotlightEnabled = !canvasEngine.autoSpotlightEnabled;
            const btn = $("tool-spotlight-toggle");
            const dot = $("spotlightIndicator");
            if (canvasEngine.autoSpotlightEnabled) {
                btn.classList.add("active");
                if (dot) dot.style.background = "#6366f1";
                showToast("Auto-Spotlight ON — element focus ring enabled.");
            } else {
                btn.classList.remove("active");
                if (dot) dot.style.background = "#9ca3af";
                showToast("Auto-Spotlight OFF — showing plain screenshots.");
            }
            // Refresh current step to toggle spotlight
            loadActiveStepDetails();
        };
    }

    loadActiveStepDetails();
    renderStepThumbnails();
}

// Safely extract and parse annotations array from step object
function getStepAnnotations(step) {
    if (!step) return [];
    let raw = step.annotations;
    if (!raw && step.edits && step.edits.annotations) {
        raw = step.edits.annotations;
    }
    if (!raw) return [];
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch(e) {
            return [];
        }
    }
    if (Array.isArray(raw)) return raw;
    return [];
}

// Load Details of active step into Guide pane
function loadActiveStepDetails() {
    const steps = workflow.steps || [];
    const step = steps[currentStepIndex];
    if (!step) return;

    // Badge and Nav State
    setText("guideStepBadge", `Step ${step.sequence}`);
    setText("stepProgress", `Step ${currentStepIndex + 1} of ${steps.length}`);
    setDisabled("prevBtn", currentStepIndex === 0);
    setDisabled("nextBtn", currentStepIndex === steps.length - 1);

    // Set step checked/approval state
    setChecked("guideStepChecked", !!step.checked);

    // Field texts
    setText("guideStepTitle", step.title || getDefaultTitle(step));
    setText("guideStepDesc", step.description || getDefaultDescription(step));
    setVal("guideStepExpected", step.expected || "");
    setVal("guideStepNote", step.note || "");
    setVal("guideStepVoiceover", step.voiceover || "");

    // Populate Interactive Hotspot values (Requirement 2)
    const hs = calculateDefaultHotspot(step);
    setVal("hotspotX", Math.round(hs.xPct));
    setVal("hotspotY", Math.round(hs.yPct));
    setVal("hotspotW", Math.round(hs.wPct));
    setVal("hotspotH", Math.round(hs.hPct));
    setVal("guideHotspotPrompt", step.hotspot?.prompt || hs.prompt || (step.title || getDefaultTitle(step)));

    // Reset auto-save badge
    const autoSaveBadge = $("autoSaveIndicator");
    if (autoSaveBadge) {
        autoSaveBadge.textContent = "Saved ✓";
        autoSaveBadge.className = "auto-save-indicator";
    }

    const hideBtn = $("hideStepBtn");
    if (hideBtn) {
        hideBtn.textContent = step.hidden ? "Show Step" : "Hide Step";
        hideBtn.className = step.hidden ? "btn btn-secondary btn-sm" : "btn btn-danger btn-sm";
    }

    // Meta details
    setText("guideMetaAction", actionTitle(step.action));
    setText("guideMetaValue", step.value || "—");
    setText("guideMetaSelector", step.element?.cssSelector || "—");
    setText("guideMetaXpath", step.element?.xpath || "—");

    // Open step detail drawer automatically
    const drawer = $("stepDetailDrawer");
    if (drawer) drawer.classList.add("open");

    // Apply auto-fit zoom on step load
    autoFitZoom();

    // Set screenshot image and sync canvas
    const imgEl = $("guideImg");
    const canvasWrap = $("canvasWrapper");
    const noScr = $("noScreenshot");

    if (step.screenshotUrl) {
        if (imgEl) {
            imgEl.src = API_BASE + step.screenshotUrl;
            imgEl.classList.remove("hidden");
        }
        if (canvasWrap) canvasWrap.classList.remove("hidden");
        if (noScr) noScr.classList.add("hidden");

        // Apply annotations cleanly after image loads
        const applyAnnotationsWithSpotlight = () => {
            autoFitZoom();
            if (!canvasEngine) return;
            const userAnno = getStepAnnotations(step);
            const withSpot = canvasEngine.applyAutoSpotlight(
                step.element,
                step.sequence,
                userAnno
            );
            canvasEngine.setAnnotations(withSpot);
        };

        if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
            applyAnnotationsWithSpotlight();
        } else if (imgEl) {
            imgEl.onload = applyAnnotationsWithSpotlight;
        }
    } else {
        if (imgEl) imgEl.classList.add("hidden");
        if (canvasWrap) canvasWrap.classList.add("hidden");
        if (noScr) noScr.classList.remove("hidden");
        if (canvasEngine) canvasEngine.setAnnotations([]);
    }
}

// Calculate or retrieve default hotspot for a step
function calculateDefaultHotspot(step) {
    if (step.hotspot && typeof step.hotspot.xPct === "number") {
        return step.hotspot;
    }
    const annotations = Array.isArray(step.annotations) ? step.annotations : [];
    const spot = annotations.find(a => a.type === "spotlight" || a.type === "rect" || a.type === "circle");
    if (spot && spot.w > 0 && spot.h > 0) {
        return {
            xPct: Math.max(0, Math.min(95, (spot.x / 1280) * 100)),
            yPct: Math.max(0, Math.min(95, (spot.y / 800) * 100)),
            wPct: Math.max(4, Math.min(80, (spot.w / 1280) * 100)),
            hPct: Math.max(4, Math.min(80, (spot.h / 800) * 100)),
            prompt: step.title || getDefaultTitle(step)
        };
    }
    if (step.element && step.element.screen) {
        const sc = step.element.screen;
        const vw = sc.viewportWidth || 1280;
        const vh = sc.viewportHeight || 800;
        if (sc.width > 0 && sc.height > 0 && vw > 0 && vh > 0) {
            return {
                xPct: Math.max(0, Math.min(95, (sc.x / vw) * 100)),
                yPct: Math.max(0, Math.min(95, (sc.y / vh) * 100)),
                wPct: Math.max(4, Math.min(80, (sc.width / vw) * 100)),
                hPct: Math.max(4, Math.min(80, (sc.height / vh) * 100)),
                prompt: step.title || getDefaultTitle(step)
            };
        }
    }
    return {
        xPct: 40,
        yPct: 40,
        wPct: 20,
        hPct: 20,
        prompt: step.title || getDefaultTitle(step)
    };
}

// Debounced Auto-Save Engine (Requirement 4)
let autoSaveDebounceTimer = null;
function scheduleAutoSave(delayMs = 600) {
    const indicator = $("autoSaveIndicator");
    if (indicator) {
        indicator.textContent = "Saving...";
        indicator.className = "auto-save-indicator saving";
    }
    clearTimeout(autoSaveDebounceTimer);
    autoSaveDebounceTimer = setTimeout(async () => {
        await saveActiveStepEditsSilent();
        if (indicator) {
            indicator.textContent = "Saved ✓";
            indicator.className = "auto-save-indicator";
        }
    }, delayMs);
}

// Silent save function for background auto-saving
async function saveActiveStepEditsSilent() {
    const steps = workflow.steps || [];
    const step = steps[currentStepIndex];
    if (!step) return;

    const title = $("guideStepTitle") ? $("guideStepTitle").textContent.trim() : step.title;
    const desc = $("guideStepDesc") ? $("guideStepDesc").textContent.trim() : step.description;
    const expected = $("guideStepExpected") ? $("guideStepExpected").value.trim() : (step.expected || "");
    const note = $("guideStepNote") ? $("guideStepNote").value.trim() : (step.note || "");
    const voiceover = $("guideStepVoiceover") ? $("guideStepVoiceover").value.trim() : (step.voiceover || "");

    // Read hotspot values
    const hx = parseFloat($("hotspotX")?.value) || 40;
    const hy = parseFloat($("hotspotY")?.value) || 40;
    const hw = parseFloat($("hotspotW")?.value) || 20;
    const hh = parseFloat($("hotspotH")?.value) || 20;
    const hPrompt = $("guideHotspotPrompt")?.value.trim() || title;

    step.hotspot = {
        xPct: Math.max(0, Math.min(95, hx)),
        yPct: Math.max(0, Math.min(95, hy)),
        wPct: Math.max(4, Math.min(80, hw)),
        hPct: Math.max(4, Math.min(80, hh)),
        prompt: hPrompt
    };

    step.title = title;
    step.description = desc;
    step.expected = expected;
    step.note = note;
    step.voiceover = voiceover;

    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/edits`, {
            method: "PATCH",
            body: JSON.stringify({
                title: title,
                description: desc,
                expected: expected,
                note: note,
                voiceover: voiceover
            })
        });
    } catch (e) {
        console.warn("Silent auto-save notice:", e);
    }
}

// Render horizontal thumbnails row
function renderStepThumbnails() {
    const steps = workflow.steps || [];
    const strip = $("thumbnailsStrip");
    const countEl = $("stepsDrawerCount");
    if (countEl) countEl.textContent = `${steps.length} step${steps.length === 1 ? "" : "s"}`;
    
    strip.innerHTML = steps.map((s, index) => {
        const img = s.screenshotUrl ? `<img src="${esc(API_BASE + s.screenshotUrl)}" alt="Step ${s.sequence}">` : '<div class="no-screenshot-thumb">No img</div>';
        const checkedBadge = s.checked ? '<div class="thumb-checked-badge">✓</div>' : '';
        return `
            <div class="thumb-card ${index === currentStepIndex ? 'active' : ''} ${s.hidden ? 'hidden-step' : ''}" data-index="${index}">
                ${img}
                <div class="thumb-badge">${s.sequence}</div>
                ${checkedBadge}
            </div>
        `;
    }).join("");

    document.querySelectorAll(".thumb-card").forEach(card => {
        card.onclick = () => {
            currentStepIndex = parseInt(card.dataset.index);
            loadActiveStepDetails();
            renderStepThumbnails();
            const newActive = strip.querySelector(".thumb-card.active");
            if (newActive) newActive.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        };
    });

    const active = strip.querySelector(".thumb-card.active");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

// Save active step annotations to DB
async function saveStepAnnotations(annotations) {
    const steps = workflow.steps || [];
    const step = steps[currentStepIndex];
    if (!step) return;

    step.annotations = annotations;
    
    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/annotations`, {
            method: "PUT",
            body: JSON.stringify({ data: JSON.stringify(annotations) })
        });
    } catch(e) {
        showToast(`Failed to save annotations: ${e.message}`);
    }
}

// Save titles/descriptions edits (Manual button handler)
async function saveActiveStepEdits() {
    await saveActiveStepEditsSilent();
    showToast("Step details saved successfully.");
    renderStepThumbnails();
}

// Toggle active step visibility
async function toggleActiveStepHidden() {
    const steps = workflow.steps || [];
    const step = steps[currentStepIndex];
    if (!step) return;

    const newHidden = !step.hidden;

    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/edits`, {
            method: "PATCH",
            body: JSON.stringify({ hidden: newHidden })
        });
        
        step.hidden = newHidden;
        showToast(newHidden ? "Step hidden from export." : "Step visible in export.");
        
        loadActiveStepDetails();
        renderStepThumbnails();
    } catch (e) {
        showToast(`Visibility toggle failed: ${e.message}`);
    }
}


/* =========================================================
   STEP LIST EDITOR LOGIC (Tab 2)
========================================================= */

function renderStepsTab() {
    const steps = workflow.steps || [];
    const container = $("stepListContainer");

    if (steps.length === 0) {
        container.innerHTML = '<div class="no-results">No steps in this workflow</div>';
        return;
    }

    container.innerHTML = steps.map((s, index) => `
        <div class="editor-step-row ${s.hidden ? 'is-deleted' : ''}" data-id="${s.id}" data-index="${index}">
            <div class="editor-step-row-left">
                <span class="drag-handle">☰</span>
                <div class="row-badge">${s.sequence}</div>
                <div class="editor-step-thumb ${s.hidden ? 'is-deleted-thumb' : ''}">
                    ${s.screenshotUrl ? `<img src="${esc(API_BASE + s.screenshotUrl)}" alt="Step ${s.sequence}">` : '<div class="no-thumb">No img</div>'}
                </div>
                <div class="row-info">
                    <div class="row-title">
                        ${esc(s.title || getDefaultTitle(s))}
                        ${s.hidden ? '<span class="deleted-badge">🗑️ DELETED / HIDDEN</span>' : ''}
                    </div>
                    <div class="row-desc">${esc(s.description || getDefaultDescription(s))}</div>
                </div>
            </div>
            <div class="editor-step-row-actions">
                ${s.hidden ? `
                    <button class="btn btn-restore btn-sm btn-restore-step">↺ Restore Step</button>
                    <button class="btn btn-danger btn-sm btn-perm-del" title="Permanently delete from database">✖ Delete</button>
                ` : `
                    <button class="btn btn-secondary btn-sm btn-up" ${index === 0 ? "disabled" : ""}>▲</button>
                    <button class="btn btn-secondary btn-sm btn-down" ${index === steps.length - 1 ? "disabled" : ""}>▼</button>
                    <button class="btn btn-secondary btn-sm btn-hide-step" title="Hide this step from SOP exports">Hide</button>
                    <button class="btn btn-danger btn-sm btn-perm-del" title="Permanently delete from database">Delete</button>
                `}
            </div>
        </div>
    `).join("");

    // Bind movements
    container.querySelectorAll(".btn-up").forEach(btn => {
        btn.onclick = (e) => {
            const index = parseInt(e.target.closest(".editor-step-row").dataset.index);
            swapSteps(index, index - 1);
        };
    });

    container.querySelectorAll(".btn-down").forEach(btn => {
        btn.onclick = (e) => {
            const index = parseInt(e.target.closest(".editor-step-row").dataset.index);
            swapSteps(index, index + 1);
        };
    });

    // Hide step
    container.querySelectorAll(".btn-hide-step").forEach(btn => {
        btn.onclick = async (e) => {
            const row = e.target.closest(".editor-step-row");
            const id = parseInt(row.dataset.id);
            const index = parseInt(row.dataset.index);
            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${id}/edits`, {
                    method: "PATCH",
                    body: JSON.stringify({ hidden: true })
                });
                workflow.steps[index].hidden = true;
                showToast("Step hidden from SOP exports");
                renderStepsTab();
                renderStepThumbnails();
            } catch(err) {
                showToast(`Failed: ${err.message}`);
            }
        };
    });

    // Restore hidden/deleted step
    container.querySelectorAll(".btn-restore-step").forEach(btn => {
        btn.onclick = async (e) => {
            const row = e.target.closest(".editor-step-row");
            const id = parseInt(row.dataset.id);
            const index = parseInt(row.dataset.index);
            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${id}/edits`, {
                    method: "PATCH",
                    body: JSON.stringify({ hidden: false })
                });
                workflow.steps[index].hidden = false;
                showToast("Step restored to SOP!");
                renderStepsTab();
                renderStepThumbnails();
            } catch(err) {
                showToast(`Failed to restore: ${err.message}`);
            }
        };
    });

    // Permanent step delete
    container.querySelectorAll(".btn-perm-del").forEach(btn => {
        btn.onclick = async (e) => {
            const row = e.target.closest(".editor-step-row");
            const id = parseInt(row.dataset.id);
            const index = parseInt(row.dataset.index);
            if (confirm("Are you sure you want to PERMANENTLY delete this step? This will erase its screenshot and data from disk.")) {
                try {
                    await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${id}`, {
                        method: "DELETE"
                    });
                    workflow.steps.splice(index, 1);
                    // Renumber sequences locally
                    workflow.steps.forEach((st, i) => st.sequence = i + 1);
                    if (currentStepIndex >= workflow.steps.length) {
                        currentStepIndex = Math.max(0, workflow.steps.length - 1);
                    }
                    showToast("Step permanently deleted");
                    renderStepsTab();
                    renderStepThumbnails();
                    if (workflow.steps.length > 0) {
                        loadActiveStepDetails();
                    }
                } catch(err) {
                    showToast(`Delete failed: ${err.message}`);
                }
            }
        };
    });
}

// Reordering steps swap logic
async function swapSteps(idx1, idx2) {
    const steps = workflow.steps;
    if (idx1 < 0 || idx1 >= steps.length || idx2 < 0 || idx2 >= steps.length) return;
    
    // Swap sequence numbers
    const seq1 = steps[idx1].sequence;
    const seq2 = steps[idx2].sequence;
    
    steps[idx1].sequence = seq2;
    steps[idx2].sequence = seq1;
    
    // Swap array items
    const temp = steps[idx1];
    steps[idx1] = steps[idx2];
    steps[idx2] = temp;
    
    showToast("Steps reordered.");
    renderStepsTab();
}

// Insert manual step logic
setOnclick("addNewStepBtn", async () => {
    // Add empty placeholder step to session steps
    try {
        const nextSeq = workflow.steps.length + 1;
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/steps`, {
            method: "POST",
            body: JSON.stringify({
                action: "manual",
                timestamp: new Date().toISOString(),
                url: window.location.href,
                title: "Manual Custom Step",
                value: ""
            })
        });

        if (res.success) {
            // Re-fetch workflow to ensure DB defaults load properly
            workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
            showToast("Manual step inserted.");
            renderStepsTab();
        }
    } catch(e) {
        showToast(`Failed to insert step: ${e.message}`);
    }
});


/* =========================================================
   PLAYBACK LOGIC (Tab 3)
========================================================= */

function renderPlaybackTab() {
    const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
    
    if (visibleSteps.length === 0) {
        $("tab-play").innerHTML = '<div class="no-results">No visible steps to play</div>';
        return;
    }

    let playIdx = 0;
    
    const showPlayStep = () => {
        const s = visibleSteps[playIdx];
        if (!s) return;
        
        $("playStepTitle").textContent = s.title || getDefaultTitle(s);
        $("playStepBadge").textContent = s.sequence;
        $("playStepDesc").textContent = s.description || getDefaultDescription(s);
        if ($("playVoiceText")) {
            $("playVoiceText").value = s.voiceover || s.description || getDefaultDescription(s);
        }
        
        if (s.note) {
            $("playStepNotesBox").classList.remove("hidden");
            $("playStepNoteText").textContent = s.note;
        } else {
            $("playStepNotesBox").classList.add("hidden");
        }
        
        if (s.screenshotUrl) {
            $("playImg").src = API_BASE + s.screenshotUrl;
            $("playImg").classList.remove("hidden");
        } else {
            $("playImg").src = "";
            $("playImg").classList.add("hidden");
        }
        
        $("playProgress").textContent = `Step ${playIdx + 1} of ${visibleSteps.length}`;
        $("playPrevBtn").disabled = playIdx === 0;
        $("playNextBtn").disabled = playIdx === visibleSteps.length - 1;

        // PPT Presenter View: Update Previous Slide Preview Card
        const prevStep = playIdx > 0 ? visibleSteps[playIdx - 1] : null;
        if (prevStep && $("pptPrevCard")) {
            $("pptPrevCard").style.visibility = "visible";
            if ($("pptPrevBadge")) $("pptPrevBadge").textContent = prevStep.sequence;
            if ($("pptPrevTitle")) $("pptPrevTitle").textContent = prevStep.title || getDefaultTitle(prevStep);
            if ($("pptPrevImg")) $("pptPrevImg").src = prevStep.screenshotUrl ? API_BASE + prevStep.screenshotUrl : "";
            $("pptPrevCard").onclick = () => { playIdx--; showPlayStep(); };
        } else if ($("pptPrevCard")) {
            $("pptPrevCard").style.visibility = "hidden";
        }

        // PPT Presenter View: Update Next Slide Preview Card
        const nextStep = playIdx < visibleSteps.length - 1 ? visibleSteps[playIdx + 1] : null;
        if (nextStep && $("pptNextCard")) {
            $("pptNextCard").style.visibility = "visible";
            if ($("pptNextBadge")) $("pptNextBadge").textContent = nextStep.sequence;
            if ($("pptNextTitle")) $("pptNextTitle").textContent = nextStep.title || getDefaultTitle(nextStep);
            if ($("pptNextImg")) $("pptNextImg").src = nextStep.screenshotUrl ? API_BASE + nextStep.screenshotUrl : "";
            $("pptNextCard").onclick = () => { playIdx++; showPlayStep(); };
        } else if ($("pptNextCard")) {
            $("pptNextCard").style.visibility = "hidden";
        }

        // PPT Presenter View: Render Filmstrip Deck at bottom
        if ($("pptDeckFilmstrip")) {
            $("pptDeckFilmstrip").innerHTML = visibleSteps.map((st, i) => `
                <div class="thumb-card ${i === playIdx ? 'active' : ''}" data-index="${i}">
                    ${st.screenshotUrl ? `<img src="${esc(API_BASE + st.screenshotUrl)}" alt="Step ${st.sequence}">` : '<div class="no-screenshot-thumb">No img</div>'}
                    <div class="thumb-badge">${st.sequence}</div>
                </div>
            `).join("");

            $("pptDeckFilmstrip").querySelectorAll(".thumb-card").forEach(card => {
                card.onclick = () => {
                    playIdx = parseInt(card.dataset.index);
                    showPlayStep();
                };
            });
        }
    };
    
    setOnclick("playPrevBtn", () => {
        if (playIdx > 0) {
            playIdx--;
            showPlayStep();
        }
    });
    
    setOnclick("playNextBtn", () => {
        if (playIdx < visibleSteps.length - 1) {
            playIdx++;
            showPlayStep();
        }
    });

    setOnclick("playVoiceBtn", async () => {
        const step = visibleSteps[playIdx];
        if (!step) return;
        
        const btn = $("playVoiceBtn");
        const originalHtml = btn.innerHTML;
        btn.innerHTML = "Generating...";
        btn.disabled = true;
        
        try {
            const text = ($("playVoiceText") && $("playVoiceText").value.trim()) 
                ? $("playVoiceText").value.trim() 
                : (step.voiceover || step.description || step.title || "No description available.");
            const voice = $("voiceSelect") ? $("voiceSelect").value : "en-US";
            const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/tts`, {
                method: "POST",
                body: JSON.stringify({ text, voice })
            });
            if (res.success && res.audioUrl) {
                const audio = $("ttsAudioPlayer");
                if (audio) {
                    audio.src = API_BASE + res.audioUrl;
                    audio.play();
                }
            }
        } catch (e) {
            showToast("Failed to generate voiceover: " + e.message);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });
    
    showPlayStep();
}


/* =========================================================
   EXPORT LOGIC (Phase 7)
========================================================= */

function renderExportTab() {
    // Simply holds UI buttons trigger bindings
    setOnclick("exportInteractiveBtn", async () => {
        if (!workflow) return;
        showToast("Generating Interactive Guided Walkthrough...");
        try {
            const html = await generateInteractiveWalkthroughHtml();
            downloadFile(`${safeName(workflow.name)}-interactive.html`, html, "text/html");
            showToast("Interactive Walkthrough exported!");
        } catch (e) {
            showToast("Failed to export walkthrough: " + e.message);
            console.error(e);
        }
    });

    setOnclick("exportDocxBtn", async () => {
        if (!workflow) return;
        showToast("Generating Microsoft Word (.docx) document...");
        try {
            const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(workflow.id)}/export/docx`);
            if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
            const blob = await res.blob();
            downloadBlob(`${safeName(workflow.name)}.docx`, blob);
            showToast("Word document exported!");
        } catch (e) {
            showToast("Failed to export Word document: " + e.message);
            console.error(e);
        }
    });

    setOnclick("exportHtmlBtn", async () => {
        showToast("Generating offline HTML package...");
        const html = await generateOfflineHtml();
        downloadFile(`${safeName(workflow.name)}.html`, html, "text/html");
    });

    setOnclick("exportMarkdownBtn", async () => {
        showToast("Generating Markdown document...");
        const md = await generateMarkdown();
        downloadFile(`${safeName(workflow.name)}.md`, md, "text/markdown");
    });

    setOnclick("exportConfluenceBtn", () => {
        const markup = generateConfluenceMarkup();
        downloadFile(`${safeName(workflow.name)}-confluence.txt`, markup, "text/plain");
        showToast("Confluence markup generated!");
    });

    setOnclick("exportCsvBtn", () => {
        const csv = generateCsv();
        downloadFile(`${safeName(workflow.name)}.csv`, csv, "text/csv");
        showToast("CSV file generated!");
    });

    setOnclick("exportPdfBtn", async () => {
        const win = window.open("", "_blank");
        showToast("Preparing printable view...");
        const html = await generateOfflineHtml();
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 800);
    });
}

// Convert image URL to base64 with baked canvas annotations
async function getBakedBase64Image(step) {
    if (!step.screenshotUrl) return "";
    
    const imgUrl = API_BASE + step.screenshotUrl;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgUrl;
    
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    
    // Draw original image
    ctx.drawImage(img, 0, 0);

    // 1. Draw Element focus box if present in image space
    const screen = step.element?.screen;
    if (screen) {
        const sw = Number(screen.viewportWidth || screen.width);
        const sh = Number(screen.viewportHeight || screen.height);
        if (sw && sh) {
            const scaleX = img.naturalWidth / sw;
            const scaleY = img.naturalHeight / sh;
            
            const x = screen.x * scaleX;
            const y = screen.y * scaleY;
            const w = screen.width * scaleX;
            const h = screen.height * scaleY;
            
            ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
        }
    }

    // 2. Draw active annotations
    const annotations = step.annotations || [];
    annotations.forEach(s => {
        ctx.lineWidth = 4;
        ctx.strokeStyle = s.color || "#ef4444";
        
        if (s.type === "circle") {
            const r = Math.max(16, s.w / 2);
            const cx = s.x + r;
            const cy = s.y + r;
            
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = s.color || "#ef4444";
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 16px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(s.label || "1", cx, cy);
        }
        else if (s.type === "rect") {
            ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
            ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        else if (s.type === "blur") {
            ctx.fillStyle = "#151821";
            ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.strokeStyle = "#4b5563";
            ctx.lineWidth = 1;
            ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = "#9ca3af";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("REDACTED", s.x + s.w/2, s.y + s.h/2 + 4);
        }
        else if (s.type === "arrow") {
            const headlen = 16;
            const dx = s.w;
            const dy = s.h;
            const angle = Math.atan2(dy, dx);
            
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x + s.w, s.y + s.h);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(s.x + s.w, s.y + s.h);
            ctx.lineTo(s.x + s.w - headlen * Math.cos(angle - Math.PI / 6), s.y + s.h - headlen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(s.x + s.w - headlen * Math.cos(angle + Math.PI / 6), s.y + s.h - headlen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
        }
        else if (s.type === "text") {
            ctx.strokeStyle = "#7c3aed";
            ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = "#7c3aed";
            ctx.fillRect(s.x, s.y, s.w, s.h);
            
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 14px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(s.text || "Note", s.x + s.w/2, s.y + s.h/2);
        }
    });

    return canvas.toDataURL("image/png");
}

// Generate Offline-ready self-contained HTML SOP package
async function generateOfflineHtml() {
    const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
    const title = esc(workflow.name || "ProcSnap SOP Guide");
    
    // Pre-bake all images to base64
    const stepsHtml = [];
    for (const s of visibleSteps) {
        const base64 = s.screenshotUrl ? await getBakedBase64Image(s) : "";
        const imageBlock = base64 ? `<div class="sop-image-container"><img src="${base64}" alt="Step ${s.sequence}"></div>` : '<div class="no-image-placeholder">No image captured</div>';
        const noteBlock = s.note ? `<div class="sop-note"><strong>Note:</strong> ${esc(s.note)}</div>` : "";
        const expectedBlock = s.expected ? `<div class="sop-expected"><strong>Expected Result:</strong> ${esc(s.expected)}</div>` : "";
        
        stepsHtml.push(`
            <section class="sop-step">
                <div class="sop-step-header">
                    <span class="sop-step-number">Step ${s.sequence}</span>
                    <h2 class="sop-step-title">${esc(s.title || getDefaultTitle(s))}</h2>
                </div>
                <p class="sop-step-description">${esc(s.description || getDefaultDescription(s))}</p>
                ${noteBlock}
                ${expectedBlock}
                ${imageBlock}
            </section>
        `);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1f2937;
            background-color: #ffffff;
            line-height: 1.5;
            max-width: 900px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        header {
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 20px;
            margin-bottom: 40px;
        }
        h1 {
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 8px;
            color: #111827;
        }
        .meta {
            font-size: 13px;
            color: #6b7280;
        }
        .sop-step {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 32px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            page-break-inside: avoid;
        }
        .sop-step-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
        }
        .sop-step-number {
            background-color: #111827;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            padding: 4px 10px;
            border-radius: 999px;
            text-transform: uppercase;
        }
        .sop-step-title {
            font-size: 18px;
            font-weight: 700;
            margin: 0;
            color: #111827;
        }
        .sop-step-description {
            font-size: 14px;
            color: #4b5563;
            margin-bottom: 16px;
        }
        .sop-note {
            background-color: #f5f3ff;
            border-left: 4px solid #7c3aed;
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 13px;
            margin-bottom: 16px;
        }
        .sop-expected {
            background-color: #ecfdf5;
            border-left: 4px solid #10b981;
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 13px;
            margin-bottom: 16px;
        }
        .sop-image-container {
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid #e5e7eb;
            background-color: #f9fafb;
            text-align: center;
        }
        .sop-image-container img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
        }
        .no-image-placeholder {
            padding: 40px;
            background-color: #f9fafb;
            color: #9ca3af;
            font-size: 13px;
            border-radius: 8px;
            text-align: center;
            border: 1px dashed #d1d5db;
        }
        @media print {
            body {
                padding: 0;
            }
            .sop-step {
                box-shadow: none;
                border-color: #d1d5db;
                page-break-after: always;
            }
        }
    </style>
</head>
<body>
    <header>
        <h1>${title}</h1>
        <div class="meta">Recorded with ${esc(workflow.application || "System")} • Generated on ${new Date().toLocaleDateString()}</div>
    </header>
    <main>
        ${stepsHtml.join("")}
    </main>
</body>
</html>`;
}

// Generate Interactive Walkthrough (.html) package with click-to-proceed simulation
async function generateInteractiveWalkthroughHtml() {
    const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
    const title = esc(workflow.name || "ProcSnap Interactive Walkthrough");
    const appName = esc(workflow.application || "Application");
    
    // Prepare interactive steps payload
    const interactiveSteps = [];
    for (const s of visibleSteps) {
        let base64 = "";
        let naturalW = 1280;
        let naturalH = 800;
        
        if (s.screenshotUrl) {
            try {
                base64 = await getBakedBase64Image(s);
            } catch (e) {
                console.warn("Could not bake image for interactive export:", e);
                base64 = API_BASE + s.screenshotUrl;
            }
        }

        // Calculate hotspot bounding box in percentages (0-100%)
        let hotspot = calculateDefaultHotspot(s);
        if (s.hotspot && typeof s.hotspot.xPct === "number") {
            hotspot = {
                xPct: s.hotspot.xPct,
                yPct: s.hotspot.yPct,
                wPct: s.hotspot.wPct,
                hPct: s.hotspot.hPct,
                prompt: s.hotspot.prompt || s.title || getDefaultTitle(s),
                type: "custom"
            };
        }

        interactiveSteps.push({
            sequence: s.sequence,
            title: s.title || getDefaultTitle(s),
            description: s.description || getDefaultDescription(s),
            note: s.note || "",
            expected: s.expected || "",
            action: s.action || "click",
            value: s.value || "",
            image: base64,
            hotspot: hotspot
        });
    }

    const stepsJson = JSON.stringify(interactiveSteps).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} — Interactive Walkthrough</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            user-select: none;
        }

        /* Top Header Bar */
        header {
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 100;
        }
        .header-title-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .app-badge {
            background: linear-gradient(135deg, #6366f1, #a855f7);
            color: white;
            font-size: 11px;
            font-weight: 800;
            padding: 4px 10px;
            border-radius: 999px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        .wf-title {
            font-size: 16px;
            font-weight: 700;
            color: #ffffff;
        }
        .header-controls {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .progress-indicator {
            font-size: 13px;
            color: #94a3b8;
            font-weight: 500;
        }
        .progress-track {
            width: 140px;
            height: 6px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 999px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #6366f1, #10b981);
            width: 0%;
            transition: width 0.3s ease;
        }
        .btn-icon {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #e2e8f0;
            padding: 6px 12px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .btn-icon:hover {
            background: rgba(255, 255, 255, 0.15);
            color: #ffffff;
            border-color: rgba(255, 255, 255, 0.25);
        }

        /* Main Workspace Stage */
        main {
            flex: 1;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            overflow: hidden;
            background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
        }

        .viewport-wrapper {
            position: relative;
            max-width: 100%;
            max-height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .interactive-screen {
            position: relative;
            display: inline-block;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            overflow: hidden;
            cursor: default;
        }

        .interactive-screen img {
            display: block;
            max-width: 88vw;
            max-height: 72vh;
            width: auto;
            height: auto;
            user-select: none;
            pointer-events: none;
        }

        /* Interactive Target Hotspot */
        .hotspot-box {
            position: absolute;
            border: 3px solid #6366f1;
            background: rgba(99, 102, 241, 0.25);
            border-radius: 8px;
            cursor: pointer;
            z-index: 50;
            animation: hotspotGlow 1.8s infinite ease-in-out;
            transition: all 0.15s ease;
        }
        .hotspot-box:hover {
            background: rgba(99, 102, 241, 0.4);
            border-color: #818cf8;
            transform: scale(1.02);
        }

        .hotspot-pointer-tag {
            position: absolute;
            top: -34px;
            left: 50%;
            transform: translateX(-50%);
            background: #6366f1;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            padding: 4px 10px;
            border-radius: 6px;
            white-space: nowrap;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.5);
            display: flex;
            align-items: center;
            gap: 4px;
            pointer-events: none;
            animation: bounceDown 1.2s infinite ease-in-out;
        }
        .hotspot-pointer-tag::after {
            content: "";
            position: absolute;
            bottom: -5px;
            left: 50%;
            transform: translateX(-50%);
            border-width: 5px 5px 0;
            border-style: solid;
            border-color: #6366f1 transparent;
        }

        @keyframes hotspotGlow {
            0%, 100% {
                box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.7), 0 0 16px rgba(99, 102, 241, 0.4);
            }
            50% {
                box-shadow: 0 0 0 14px rgba(99, 102, 241, 0), 0 0 28px rgba(99, 102, 241, 0.8);
            }
        }

        @keyframes bounceDown {
            0%, 100% { transform: translate(-50%, 0); }
            50% { transform: translate(-50%, -6px); }
        }

        /* Floating Step Instruction Card */
        .instruction-card {
            position: absolute;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 23, 42, 0.94);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
            border-radius: 14px;
            padding: 16px 24px;
            width: 90%;
            max-width: 640px;
            z-index: 90;
            display: flex;
            flex-direction: column;
            gap: 8px;
            animation: slideUp 0.3s ease;
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translate(-50%, 16px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }

        .card-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .step-pill {
            background: #3b82f6;
            color: white;
            font-size: 11px;
            font-weight: 800;
            padding: 3px 8px;
            border-radius: 6px;
            text-transform: uppercase;
        }
        .hint-badge {
            font-size: 12px;
            color: #a5b4fc;
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 500;
        }
        .step-title {
            font-size: 16px;
            font-weight: 700;
            color: #ffffff;
        }
        .step-desc {
            font-size: 13.5px;
            color: #cbd5e1;
            line-height: 1.4;
        }
        .step-note-box {
            background: rgba(124, 58, 237, 0.15);
            border-left: 3px solid #8b5cf6;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            color: #ddd6fe;
        }

        /* Ripple effect on click */
        .ripple {
            position: absolute;
            border-radius: 50%;
            transform: scale(0);
            animation: rippleAnim 0.6s ease-out;
            pointer-events: none;
            z-index: 1000;
        }
        .ripple.success {
            background: rgba(16, 185, 129, 0.5);
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.8);
        }
        .ripple.miss {
            background: rgba(239, 68, 68, 0.4);
        }

        @keyframes rippleAnim {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }

        /* Shake animation on miss */
        .shake-screen {
            animation: shake 0.4s ease-in-out;
        }
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-8px); }
            40%, 80% { transform: translateX(8px); }
        }

        /* Bottom Controls Footer */
        footer {
            background: rgba(15, 23, 42, 0.95);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding: 10px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 100;
        }
        .footer-nav {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        /* Celebration Screen */
        .celebration-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(15, 23, 42, 0.92);
            backdrop-filter: blur(20px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            padding: 24px;
            text-align: center;
        }
        .celebration-card {
            background: #1e293b;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 40px 48px;
            border-radius: 20px;
            max-width: 520px;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes popIn {
            from { transform: scale(0.8); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        .celebration-icon {
            font-size: 56px;
        }
        .celebration-title {
            font-size: 26px;
            font-weight: 800;
            color: #ffffff;
        }
        .celebration-subtitle {
            font-size: 14px;
            color: #94a3b8;
            line-height: 1.5;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            width: 100%;
            margin: 12px 0;
        }
        .stat-box {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 12px;
        }
        .stat-val {
            font-size: 20px;
            font-weight: 800;
            color: #6366f1;
        }
        .stat-lbl {
            font-size: 11px;
            color: #94a3b8;
            text-transform: uppercase;
            font-weight: 600;
            margin-top: 2px;
        }
        .btn-restart {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            border: none;
            padding: 12px 28px;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 10px 25px rgba(99, 102, 241, 0.4);
            transition: all 0.2s;
        }
        .btn-restart:hover {
            transform: translateY(-2px);
            box-shadow: 0 14px 30px rgba(99, 102, 241, 0.6);
        }
        #confettiCanvas {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none;
            z-index: 10000;
        }
    </style>
</head>
<body>
    <canvas id="confettiCanvas"></canvas>

    <!-- Top Header -->
    <header>
        <div class="header-title-group">
            <span class="app-badge">Interactive SOP</span>
            <span class="wf-title">${title}</span>
        </div>
        <div class="header-controls">
            <div class="progress-indicator">
                <span id="stepCounterText">Step 1 of 1</span>
            </div>
            <div class="progress-track">
                <div id="progressBarFill" class="progress-fill"></div>
            </div>
            <button id="soundToggleBtn" class="btn-icon" title="Toggle Sound Feedback">
                🔊 Sound ON
            </button>
            <button id="fullscreenBtn" class="btn-icon" title="Toggle Fullscreen">
                ⛶ Fullscreen
            </button>
        </div>
    </header>

    <!-- Interactive Workspace Stage -->
    <main id="mainStage">
        <div class="viewport-wrapper" id="viewportWrapper">
            <div class="interactive-screen" id="interactiveScreen">
                <img id="stepImage" src="" alt="Interactive step">
                <div id="hotspotBox" class="hotspot-box">
                    <div class="hotspot-pointer-tag">👉 CLICK HERE</div>
                </div>
            </div>
        </div>

        <!-- Floating Instruction Card -->
        <div class="instruction-card" id="instructionCard">
            <div class="card-header-row">
                <span class="step-pill" id="stepPill">Step 1</span>
                <span class="hint-badge">💡 Click the glowing area to proceed</span>
            </div>
            <div class="step-title" id="stepTitleText">Loading...</div>
            <div class="step-desc" id="stepDescText">Please follow the highlighted step action.</div>
            <div class="step-note-box" id="stepNoteBox" style="display: none;"></div>
        </div>
    </main>

    <!-- Bottom Controls Footer -->
    <footer>
        <div class="footer-nav">
            <button id="prevBtn" class="btn-icon">◀ Back</button>
            <button id="nextBtn" class="btn-icon">Skip Step ▶</button>
        </div>
        <div style="font-size: 12px; color: #64748b;">
            Press <kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">Space</kbd> or <kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">→</kbd> to advance
        </div>
    </footer>

    <!-- Completion Celebration Modal -->
    <div id="celebrationOverlay" class="celebration-overlay" style="display: none;">
        <div class="celebration-card">
            <div class="celebration-icon">🎉</div>
            <h2 class="celebration-title">Walkthrough Completed!</h2>
            <p class="celebration-subtitle">You have successfully completed all steps in <strong>${title}</strong>.</p>
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-val" id="statSteps">0</div>
                    <div class="stat-lbl">Steps</div>
                </div>
                <div class="stat-box">
                    <div class="stat-val" id="statAccuracy">100%</div>
                    <div class="stat-lbl">Accuracy</div>
                </div>
                <div class="stat-box">
                    <div class="stat-val" id="statTime">0s</div>
                    <div class="stat-lbl">Time Taken</div>
                </div>
            </div>
            <button id="restartBtn" class="btn-restart">🔄 Restart Walkthrough</button>
        </div>
    </div>

    <script>
        const steps = ${stepsJson};
        let currentIdx = 0;
        let soundEnabled = true;
        let totalClicks = 0;
        let correctClicks = 0;
        let startTime = Date.now();

        // Web Audio Synthesizer (Zero Dependencies)
        let audioCtx = null;
        function getAudioContext() {
            if (!audioCtx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) audioCtx = new AudioContext();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            return audioCtx;
        }

        function playChime() {
            if (!soundEnabled) return;
            try {
                const ctx = getAudioContext();
                if (!ctx) return;
                const now = ctx.currentTime;

                // Two-tone chord (F5 and A5)
                [698.46, 880.00].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(freq, now + (i * 0.06));
                    gain.gain.setValueAtTime(0.15, now + (i * 0.06));
                    gain.gain.exponentialRampToValueAtTime(0.001, now + (i * 0.06) + 0.35);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + (i * 0.06));
                    osc.stop(now + (i * 0.06) + 0.4);
                });
            } catch(e) {}
        }

        function playMissTone() {
            if (!soundEnabled) return;
            try {
                const ctx = getAudioContext();
                if (!ctx) return;
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "triangle";
                osc.frequency.setValueAtTime(220, now);
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.22);
            } catch(e) {}
        }

        function playCelebrationFanfare() {
            if (!soundEnabled) return;
            try {
                const ctx = getAudioContext();
                if (!ctx) return;
                const now = ctx.currentTime;
                const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = "triangle";
                    osc.frequency.setValueAtTime(freq, now + (i * 0.12));
                    gain.gain.setValueAtTime(0.2, now + (i * 0.12));
                    gain.gain.exponentialRampToValueAtTime(0.001, now + (i * 0.12) + 0.5);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + (i * 0.12));
                    osc.stop(now + (i * 0.12) + 0.55);
                });
            } catch(e) {}
        }

        // Render current step
        function renderStep() {
            if (currentIdx >= steps.length) {
                showCompletion();
                return;
            }

            const step = steps[currentIdx];
            const pct = Math.round(((currentIdx + 1) / steps.length) * 100);

            document.getElementById("stepCounterText").textContent = "Step " + (currentIdx + 1) + " of " + steps.length + " (" + pct + "%)";
            document.getElementById("progressBarFill").style.width = pct + "%";
            document.getElementById("stepPill").textContent = "Step " + (currentIdx + 1);
            document.getElementById("stepTitleText").textContent = step.title || ("Step " + (currentIdx + 1));
            document.getElementById("stepDescText").textContent = step.description || "Click the highlighted region to continue.";

            const noteBox = document.getElementById("stepNoteBox");
            if (step.note) {
                noteBox.style.display = "block";
                noteBox.innerHTML = "<strong>Note:</strong> " + step.note;
            } else if (step.expected) {
                noteBox.style.display = "block";
                noteBox.innerHTML = "<strong>Expected:</strong> " + step.expected;
            } else {
                noteBox.style.display = "none";
            }

            // Set image
            const img = document.getElementById("stepImage");
            img.src = step.image;

            // Position Hotspot
            const hs = step.hotspot || { xPct: 40, yPct: 40, wPct: 20, hPct: 20 };
            const box = document.getElementById("hotspotBox");
            box.style.left = hs.xPct + "%";
            box.style.top = hs.yPct + "%";
            box.style.width = hs.wPct + "%";
            box.style.height = hs.hPct + "%";

            // Update nav buttons
            document.getElementById("prevBtn").disabled = currentIdx === 0;
            document.getElementById("nextBtn").textContent = (currentIdx === steps.length - 1) ? "Finish ▶" : "Skip Step ▶";
        }

        // Create visual ripple
        function createRipple(e, isSuccess) {
            const screen = document.getElementById("interactiveScreen");
            const rect = screen.getBoundingClientRect();
            const ripple = document.createElement("div");
            ripple.className = "ripple " + (isSuccess ? "success" : "miss");
            const size = 30;
            ripple.style.width = size + "px";
            ripple.style.height = size + "px";
            ripple.style.left = (e.clientX - rect.left - size/2) + "px";
            ripple.style.top = (e.clientY - rect.top - size/2) + "px";
            screen.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        }

        // Handle correct hotspot click
        document.getElementById("hotspotBox").addEventListener("click", (e) => {
            e.stopPropagation();
            totalClicks++;
            correctClicks++;
            createRipple(e, true);
            playChime();
            setTimeout(() => {
                currentIdx++;
                renderStep();
            }, 300);
        });

        // Handle click outside hotspot (Miss)
        document.getElementById("interactiveScreen").addEventListener("click", (e) => {
            totalClicks++;
            createRipple(e, false);
            playMissTone();
            const screen = document.getElementById("interactiveScreen");
            screen.classList.remove("shake-screen");
            void screen.offsetWidth;
            screen.classList.add("shake-screen");
        });

        // Nav Buttons
        document.getElementById("prevBtn").addEventListener("click", () => {
            if (currentIdx > 0) {
                currentIdx--;
                renderStep();
            }
        });

        document.getElementById("nextBtn").addEventListener("click", () => {
            currentIdx++;
            renderStep();
        });

        document.getElementById("soundToggleBtn").addEventListener("click", () => {
            soundEnabled = !soundEnabled;
            document.getElementById("soundToggleBtn").textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
        });

        document.getElementById("fullscreenBtn").addEventListener("click", () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        // Keyboard navigation
        document.addEventListener("keydown", (e) => {
            if (e.key === "ArrowRight" || e.key === " ") {
                currentIdx++;
                renderStep();
            } else if (e.key === "ArrowLeft" && currentIdx > 0) {
                currentIdx--;
                renderStep();
            }
        });

        // Confetti physics animation
        function launchConfetti() {
            const canvas = document.getElementById("confettiCanvas");
            const ctx = canvas.getContext("2d");
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            const particles = [];
            const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#10b981", "#f59e0b", "#3b82f6"];
            for (let i = 0; i < 150; i++) {
                particles.push({
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    vx: (Math.random() - 0.5) * 16,
                    vy: (Math.random() - 0.8) * 16,
                    size: Math.random() * 8 + 4,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    rot: Math.random() * 360,
                    rotSpeed: (Math.random() - 0.5) * 10
                });
            }

            let frame = 0;
            function draw() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                particles.forEach(p => {
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vy += 0.3; // gravity
                    p.rot += p.rotSpeed;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate((p.rot * Math.PI) / 180);
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                    ctx.restore();
                });
                frame++;
                if (frame < 180) requestAnimationFrame(draw);
                else ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            draw();
        }

        // Show completion celebration
        function showCompletion() {
            document.getElementById("celebrationOverlay").style.display = "flex";
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const accuracy = totalClicks > 0 ? Math.round((correctClicks / totalClicks) * 100) : 100;
            document.getElementById("statSteps").textContent = steps.length;
            document.getElementById("statAccuracy").textContent = accuracy + "%";
            document.getElementById("statTime").textContent = elapsed + "s";
            playCelebrationFanfare();
            launchConfetti();
        }

        document.getElementById("restartBtn").addEventListener("click", () => {
            document.getElementById("celebrationOverlay").style.display = "none";
            currentIdx = 0;
            totalClicks = 0;
            correctClicks = 0;
            startTime = Date.now();
            renderStep();
        });

        // Initialize first step
        renderStep();
    </script>
</body>
</html>`;
}

// Generate Markdown with inline baked images
async function generateMarkdown() {
    const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
    const lines = [
        `# ${workflow.name || "ProcSnap SOP Guide"}`,
        `> Generated from local recording. Application: **${workflow.application || "Chrome"}**`,
        `---`
    ];

    for (const s of visibleSteps) {
        lines.push(`## Step ${s.sequence}: ${s.title || getDefaultTitle(s)}`);
        lines.push(`${s.description || getDefaultDescription(s)}`);
        lines.push("");

        if (s.note) {
            lines.push(`> **Note:** ${s.note}`);
            lines.push("");
        }

        if (s.expected) {
            lines.push(`> **Expected Result:** ${s.expected}`);
            lines.push("");
        }

        if (s.screenshotUrl) {
            const base64 = await getBakedBase64Image(s);
            lines.push(`![Step ${s.sequence} Screenshot](${base64})`);
        } else {
            lines.push(`*No screenshot captured for this step.*`);
        }
        lines.push("---");
    }

    return lines.join("\n");
}

// Generate Confluence wiki storage format
function generateConfluenceMarkup() {
    const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
    const list = visibleSteps.map(s => {
        let block = `h3. Step ${s.sequence}: ${s.title || getDefaultTitle(s)}\n`;
        block += `${s.description || getDefaultDescription(s)}\n\n`;
        if (s.note) block += `{note}*Note:* ${s.note}{note}\n\n`;
        if (s.expected) block += `{info}*Expected Result:* ${s.expected}{info}\n\n`;
        block += `-----\n`;
        return block;
    });

    return `h1. ${workflow.name || "SOP Workflow Guide"}\n\n${list.join("\n")}`;
}

// Generate structured CSV
function generateCsv() {
    const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
    
    // Headers
    const headers = ["Step", "Title", "Description", "Action", "Value", "Expected Result", "Note", "URL"];
    const rows = [headers];

    visibleSteps.forEach(s => {
        rows.push([
            s.sequence,
            s.title || getDefaultTitle(s),
            s.description || getDefaultDescription(s),
            s.action,
            s.value || "",
            s.expected || "",
            s.note || "",
            s.url || ""
        ]);
    });

    return rows.map(r => r.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}

// File downloader utility
function downloadFile(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Binary Blob downloader utility
function downloadBlob(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Safe alphanumeric name for filenames
function safeName(n) {
    return (n || "procsnap-workflow").replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-").slice(0, 80);
}

// Handle workflow delete button click
setOnclick("deleteBtn", async () => {
    if (!workflow) return;
    if (!confirm(`Are you sure you want to permanently delete workflow "${workflow.name}"? This deletes all captured steps and files.`)) return;

    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}`, { method: "DELETE" });
        selectedWorkflowId = null;
        workflow = null;
        showToast("Workflow deleted.");
        await loadWorkflows();
    } catch(e) {
        showToast(e.message);
    }
});

// Search list listener
if ($("searchInput")) $("searchInput").oninput = renderWorkflowList;

// Refresh Library listener
setOnclick("refreshBtn", async () => {
    await loadWorkflows();
    showToast("Library refreshed.");
});

// Start
init();


// ═══════════════════════════════════════════════════════════════════════════
// Desktop Screenshot Capture Modal Controller
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Opens the Desktop Capture modal and populates the monitor list.
 */
async function openDesktopCaptureModal() {
    const modal = $("desktopCaptureModal");
    if (!modal) return;

    // Reset UI state
    dcSetStatus("", "");
    const countdown = $("dcCountdown");
    if (countdown) countdown.classList.add("hidden");

    // Pre-fill title with sensible default
    const titleInput = $("dcStepTitle");
    if (titleInput && !titleInput.value) {
        const stepNum = workflow ? (workflow.steps || []).length + 1 : 1;
        titleInput.value = `Desktop Screen Capture ${stepNum}`;
    }

    // Show modal
    modal.classList.remove("hidden");

    // Populate monitor list
    await dcLoadMonitors();

    // Focus title
    if (titleInput) setTimeout(() => titleInput.focus(), 200);
}

/** Close the modal. */
function closeDesktopCaptureModal() {
    const modal = $("desktopCaptureModal");
    if (modal) modal.classList.add("hidden");
}

/** Set status message in the modal. */
function dcSetStatus(msg, type = "") {
    const el = $("dcStatus");
    if (!el) return;
    if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
    el.classList.remove("hidden", "dc-error", "dc-success");
    if (type) el.classList.add(type);
    el.textContent = msg;
}

/** Fetch available monitors from the backend and populate the dropdown. */
async function dcLoadMonitors() {
    const sel = $("dcMonitorSelect");
    if (!sel) return;
    try {
        const res = await api("/desktop/monitors");
        if (res && res.monitors && res.monitors.length) {
            sel.innerHTML = res.monitors.map(m =>
                `<option value="${esc(String(m.index))}"${m.isPrimary ? " selected" : ""}>${esc(m.label)}</option>`
            ).join("");
        } else {
            sel.innerHTML = `<option value="1">Primary Monitor</option>`;
        }
    } catch(e) {
        sel.innerHTML = `<option value="1">Primary Monitor</option>`;
        console.warn("Could not load monitors:", e);
    }
}

/**
 * After a successful capture API response, reload the workflow and jump to the new step.
 */
async function dcHandleSuccess(res) {
    closeDesktopCaptureModal();
    showToast("✅ Desktop screenshot captured!");
    await openWorkflow(res.sessionId);
    // Jump to the newly added step (last step)
    currentStepIndex = (workflow && workflow.steps) ? workflow.steps.length - 1 : 0;
    renderGuideTab();
}

// ── Wire modal buttons ───────────────────────────────────────────────────

/** Close button */
if ($("dcModalClose")) {
    $("dcModalClose").onclick = closeDesktopCaptureModal;
}

/** Close on overlay background click */
if ($("desktopCaptureModal")) {
    $("desktopCaptureModal").addEventListener("click", (e) => {
        if (e.target === $("desktopCaptureModal")) closeDesktopCaptureModal();
    });
}

/** Close on Escape key */
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("desktopCaptureModal") && !$("desktopCaptureModal").classList.contains("hidden")) {
        closeDesktopCaptureModal();
    }
});

/**
 * PRIMARY CAPTURE: Python mss / PIL — instant, no browser permissions needed.
 */
if ($("dcCaptureNativeBtn")) {
    $("dcCaptureNativeBtn").onclick = async () => {
        const monitorIndex = parseInt($("dcMonitorSelect")?.value || "1", 10);
        const title = $("dcStepTitle")?.value?.trim() || null;
        const sessionId = (workflow && workflow.id) ? workflow.id : null;

        $("dcCaptureNativeBtn").disabled = true;
        $("dcCapturePickerBtn").disabled = true;
        dcSetStatus("📸 Capturing desktop screen…", "");

        try {
            const res = await api("/desktop/capture", {
                method: "POST",
                body: JSON.stringify({
                    session_id: sessionId,
                    monitor_index: monitorIndex,
                    title: title || undefined
                })
            });

            if (res && res.success) {
                await dcHandleSuccess(res);
            } else {
                dcSetStatus("❌ Capture failed — please try again.", "dc-error");
            }
        } catch(e) {
            dcSetStatus("❌ Error: " + e.message, "dc-error");
            console.error("Native desktop capture error:", e);
        } finally {
            if ($("dcCaptureNativeBtn")) $("dcCaptureNativeBtn").disabled = false;
            if ($("dcCapturePickerBtn")) $("dcCapturePickerBtn").disabled = false;
        }
    };
}

/**
 * SECONDARY CAPTURE: Browser getDisplayMedia with 3-second countdown.
 * The countdown gives the user time to switch to the target window after
 * the OS picker closes — which prevents the tab-suspension blank frame bug.
 */
if ($("dcCapturePickerBtn")) {
    $("dcCapturePickerBtn").onclick = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            dcSetStatus("❌ Your browser does not support screen capture. Use Capture Natively instead.", "dc-error");
            return;
        }

        const title = $("dcStepTitle")?.value?.trim() || null;
        const sessionId = (workflow && workflow.id) ? workflow.id : null;

        $("dcCaptureNativeBtn").disabled = true;
        $("dcCapturePickerBtn").disabled = true;
        dcSetStatus("🌐 Opening screen picker — select a window or desktop…", "");

        let stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always", frameRate: { ideal: 30 } },
                audio: false
            });
        } catch(err) {
            $("dcCaptureNativeBtn").disabled = false;
            $("dcCapturePickerBtn").disabled = false;
            if (err.name === "NotAllowedError") {
                dcSetStatus("Capture cancelled.", "");
            } else {
                dcSetStatus("❌ Screen picker error: " + err.message, "dc-error");
            }
            return;
        }

        // Show countdown — user has time to switch to the target window
        const countdownEl = $("dcCountdown");
        const numEl = $("dcCountdownNum");
        if (countdownEl) countdownEl.classList.remove("hidden");

        let count = 3;
        if (numEl) numEl.textContent = count;
        await new Promise(resolve => {
            const tick = setInterval(() => {
                count--;
                if (numEl) numEl.textContent = count;
                if (count <= 0) { clearInterval(tick); resolve(); }
            }, 1000);
        });

        if (countdownEl) countdownEl.classList.add("hidden");
        dcSetStatus("📷 Grabbing frame…", "");

        try {
            // Use the robust video-element frame grabber
            const dataUrl = await captureStreamFrame(stream);

            if (!dataUrl || dataUrl.length < 500) {
                throw new Error("Captured frame appears to be blank. Try 'Capture Natively' instead.");
            }

            dcSetStatus("💾 Saving screenshot…", "");
            const res = await api("/desktop/capture-base64", {
                method: "POST",
                body: JSON.stringify({ session_id: sessionId, image: dataUrl, title: title || undefined })
            });

            if (res && res.success) {
                await dcHandleSuccess(res);
            } else {
                dcSetStatus("❌ Save failed — please try again.", "dc-error");
            }
        } catch(err) {
            dcSetStatus("❌ " + err.message, "dc-error");
            console.error("Browser screen picker capture error:", err);
            // Stop stream tracks if still running
            try { stream.getTracks().forEach(t => t.stop()); } catch(_) {}
        } finally {
            if ($("dcCaptureNativeBtn")) $("dcCaptureNativeBtn").disabled = false;
            if ($("dcCapturePickerBtn")) $("dcCapturePickerBtn").disabled = false;
        }
    };
}


/* =========================================================
   SYSTEM REQUIREMENTS & DIAGNOSTICS CONTROLLER
========================================================= */

function openSystemRequirementsModal() {
    const modal = $("systemRequirementsModal");
    if (!modal) return;
    modal.classList.remove("hidden");

    // Close button listeners
    const closeBtn = $("closeRequirementsModalBtn");
    const closeBtn2 = $("closeRequirementsModalBtn2");
    if (closeBtn) closeBtn.onclick = () => modal.classList.add("hidden");
    if (closeBtn2) closeBtn2.onclick = () => modal.classList.add("hidden");

    // Re-scan button
    const refreshBtn = $("refreshReqBtn");
    if (refreshBtn) refreshBtn.onclick = loadSystemRequirements;

    // Fix shortcuts
    const btnShortcuts = $("btnRepairShortcuts");
    if (btnShortcuts) {
        btnShortcuts.onclick = async () => {
            btnShortcuts.disabled = true;
            try {
                const res = await api("/system/repair-shortcuts", { method: "POST" });
                showToast(res.message || "Shortcuts verified!");
                await loadSystemRequirements();
            } catch(e) {
                showToast("Shortcuts repair failed: " + e.message);
            } finally {
                btnShortcuts.disabled = false;
            }
        };
    }

    // Launch extension installer helper
    const btnExt = $("btnLaunchExtHelper");
    if (btnExt) {
        btnExt.onclick = async () => {
            try {
                const res = await api("/system/open-extension-installer", { method: "POST" });
                showToast(res.message || "Extension installer launched!");
            } catch(e) {
                showToast("Extension helper error: " + e.message);
            }
        };
    }

    // Start Ollama inside modal
    const btnAi = $("btnStartOllamaInModal");
    if (btnAi) {
        btnAi.onclick = async () => {
            btnAi.disabled = true;
            btnAi.textContent = "Starting AI...";
            try {
                const res = await api("/ai/start-ollama", { method: "POST" });
                showToast(res.message || "Ollama started");
                setTimeout(loadSystemRequirements, 2500);
            } catch(e) {
                showToast("Ollama error: " + e.message);
            } finally {
                btnAi.disabled = false;
                btnAi.textContent = "🤖 Start Ollama AI";
            }
        };
    }

    // Reinstall Packages Button (Pip)
    const btnReinstall = $("reinstallPackagesBtn");
    if (btnReinstall) {
        btnReinstall.onclick = async () => {
            const terminalWrap = $("repairTerminalWrapper");
            const terminalOut = $("repairTerminalOutput");
            const terminalStatus = $("repairTerminalStatus");
            if (terminalWrap) terminalWrap.classList.remove("hidden");
            if (terminalStatus) {
                terminalStatus.textContent = "Running pip install...";
                terminalStatus.style.color = "#a5b4fc";
            }
            if (terminalOut) terminalOut.textContent = "Running: python -m pip install --upgrade -r requirements.txt\nPlease wait...\n";

            btnReinstall.disabled = true;
            btnReinstall.textContent = "🔄 Installing...";

            try {
                const res = await api("/system/reinstall-packages", { method: "POST" });
                if (terminalOut) terminalOut.textContent = res.output || "Installation finished.";
                if (res.success) {
                    if (terminalStatus) {
                        terminalStatus.textContent = "✓ Success";
                        terminalStatus.style.color = "#34d399";
                    }
                    showToast("Dependencies installed / updated successfully!");
                } else {
                    if (terminalStatus) {
                        terminalStatus.textContent = "✗ Error (Exit code " + (res.return_code || 1) + ")";
                        terminalStatus.style.color = "#f87171";
                    }
                    showToast("Some packages encountered issues during install.");
                }
                await loadSystemRequirements();
            } catch(e) {
                if (terminalOut) terminalOut.textContent = "Execution failed: " + e.message;
                if (terminalStatus) {
                    terminalStatus.textContent = "✗ Error";
                    terminalStatus.style.color = "#f87171";
                }
                showToast("Pip execution failed: " + e.message);
            } finally {
                btnReinstall.disabled = false;
                btnReinstall.textContent = "🔄 Re-install / Update Packages";
            }
        };
    }

    loadSystemRequirements();
}

async function loadSystemRequirements() {
    try {
        const data = await api("/system/requirements");
        if (!data || !data.success) throw new Error("Invalid response");

        // 1. Overall Banner
        const banner = $("reqStatusBanner");
        const bIcon = $("reqBannerIcon");
        const bTitle = $("reqBannerTitle");
        const bDesc = $("reqBannerDesc");

        if (data.status === "ready") {
            if (banner) banner.className = "req-overall-banner ok";
            if (bIcon) bIcon.textContent = "✓";
            if (bTitle) bTitle.textContent = "System Fully Operational";
            if (bDesc) bDesc.textContent = "All core packages, database, and background services are active and healthy.";
        } else {
            if (banner) banner.className = "req-overall-banner needs_attention";
            if (bIcon) bIcon.textContent = "!";
            if (bTitle) bTitle.textContent = "Attention Needed";
            if (bDesc) bDesc.textContent = "Some required dependencies or components are not yet installed.";
        }

        // 2. Python Card
        if (data.python) {
            setText("valPyVer", `Python ${data.python.version}`);
            setText("valPyVenv", data.python.in_venv ? "Virtualenv: Isolated" : "System Python");
            const badgePy = $("badgePython");
            if (badgePy) badgePy.className = "req-badge-ok";
        }

        // 3. Database Card
        if (data.database) {
            setText("valDbStatus", data.database.connected ? "Connected" : "Disconnected");
            const mb = (data.database.size_bytes / (1024 * 1024)).toFixed(2);
            setText("valDbStats", `${data.database.workflows_count} workflows • ${data.database.steps_count} steps (${mb} MB)`);
            const badgeDb = $("badgeDatabase");
            if (badgeDb) {
                badgeDb.className = data.database.connected ? "req-badge-ok" : "req-badge-missing";
                badgeDb.textContent = data.database.connected ? "✓ OK" : "✗ Error";
            }
        }

        // 4. AI Card
        if (data.ollama) {
            setText("valAiStatus", data.ollama.running ? "Ollama Active" : "Ollama Offline");
            const modelsCount = (data.ollama.models || []).length;
            setText("valAiModels", `${modelsCount} model${modelsCount === 1 ? "" : "s"} installed`);
            const badgeAi = $("badgeAI");
            if (badgeAi) {
                if (data.ollama.running && data.ollama.required_models_present) {
                    badgeAi.className = "req-badge-ok";
                    badgeAi.textContent = "✓ Ready";
                } else if (data.ollama.running) {
                    badgeAi.className = "req-badge-warn";
                    badgeAi.textContent = "Pull Models";
                } else {
                    badgeAi.className = "req-badge-warn";
                    badgeAi.textContent = "Optional";
                }
            }
        }

        // 5. Extension Card
        if (data.extension) {
            setText("valExtStatus", data.extension.ready ? "Extension Ready" : "Missing Folder");
            const badgeExt = $("badgeExtension");
            if (badgeExt) {
                badgeExt.className = data.extension.ready ? "req-badge-ok" : "req-badge-missing";
                badgeExt.textContent = data.extension.ready ? "✓ Ready" : "✗ Missing";
            }
        }

        // 6. Packages Table
        const tbody = $("reqPackagesTbody");
        if (tbody && data.packages && data.packages.items) {
            tbody.innerHTML = data.packages.items.map(p => `
                <tr>
                    <td style="font-weight: 700; color: #fff;">${esc(p.name)}</td>
                    <td><code>${esc(p.version)}</code></td>
                    <td style="color: var(--text-muted);">${esc(p.required)}</td>
                    <td>
                        <span class="${p.installed ? 'req-badge-ok' : 'req-badge-missing'}" style="position: static;">
                            ${p.installed ? '✓ Installed' : '✗ Missing'}
                        </span>
                    </td>
                    <td style="font-size: 11px; color: var(--text-muted);">${esc(p.description)}</td>
                </tr>
            `).join("");
        }

    } catch (e) {
        console.error("Failed to load system requirements:", e);
        showToast("Error checking requirements: " + e.message);
    }
}

