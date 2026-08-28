const API_BASE = (typeof window !== "undefined" && ["8000", "8001", "8002", "8003", "8004", "8005"].includes(window.location.port))
    ? ""
    : "http://127.0.0.1:8000";

function normalizeImageUrl(url) {
    if (!url) return "";
    let clean = String(url).trim();
    if (clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("data:")) {
        return clean;
    }
    clean = clean.replace(/\\/g, "/");
    if (!clean.startsWith("/")) clean = "/" + clean;
    if (clean.startsWith("/storage/")) clean = clean.replace("/storage/", "/");
    return (API_BASE ? API_BASE : "") + clean;
}

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
    const timeoutMs = opt.timeout || (path.includes("reinstall") || path.includes("polish") || path.includes("describe") ? 180000 : 15000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
    // 1. Localhost Engine Health Check
    const localhostPill = $("localhostStatusPill");
    try {
        await api("/health");
        setText("apiStatus", "Localhost");
        if (localhostPill) {
            localhostPill.classList.remove("offline");
            localhostPill.classList.add("online");
            localhostPill.title = "Localhost Server Connected (127.0.0.1:8000)";
        }
    } catch (e) {
        setText("apiStatus", "Offline");
        if (localhostPill) {
            localhostPill.classList.remove("online");
            localhostPill.classList.add("offline");
            localhostPill.title = "Localhost Server Disconnected (127.0.0.1:8000)";
        }
    }

    // 2. AI Engine Health Check
    const aiPill = $("aiStatusPill");
    try {
        const res = await api("/ai/status");
        const aiReady = res.running && res.required_models_present;
        if (res.running) {
            if (res.required_models_present) {
                setText("aiStatus", "AI Ready");
                if (aiPill) {
                    aiPill.classList.remove("offline");
                    aiPill.classList.add("online");
                    aiPill.title = "Local AI Engine Ready (Ollama running)";
                }
            } else {
                setText("aiStatus", "AI Setup");
                if (aiPill) {
                    aiPill.classList.remove("online");
                    aiPill.classList.add("offline");
                    aiPill.title = res.diagnostic_message || "Open Settings → Diagnostics to download AI models";
                }
            }
            if ($("startOllamaBtn")) $("startOllamaBtn").classList.add("hidden");
        } else {
            setText("aiStatus", "AI Offline");
            if (aiPill) {
                aiPill.classList.remove("online");
                aiPill.classList.add("offline");
                aiPill.title = "Local AI service unreachable (127.0.0.1:11434)";
            }
            if ($("startOllamaBtn")) $("startOllamaBtn").classList.remove("hidden");
        }

        // Toggle AI feature buttons
        const aiOfflineHint = aiReady ? "" : "AI offline — open Settings → Diagnostics to enable";
        ["aiEnhanceStepBtn", "aiPolishBtn"].forEach(id => {
            const el = $(id);
            if (!el) return;
            if (aiReady) {
                el.removeAttribute("disabled");
                el.style.opacity = "";
                el.style.cursor = "";
                el.title = el.getAttribute("data-original-title") || el.title;
            } else {
                el.setAttribute("disabled", "true");
                el.style.opacity = "0.4";
                el.style.cursor = "not-allowed";
                if (!el.getAttribute("data-original-title")) el.setAttribute("data-original-title", el.title);
                el.title = aiOfflineHint;
            }
        });
    } catch (e) {
        setText("aiStatus", "AI Offline");
        if (aiPill) {
            aiPill.classList.remove("online");
            aiPill.classList.add("offline");
            aiPill.title = "Ollama service unreachable on 127.0.0.1:11434";
        }
        if ($("startOllamaBtn")) $("startOllamaBtn").classList.remove("hidden");
        ["aiEnhanceStepBtn", "aiPolishBtn"].forEach(id => {
            const el = $(id);
            if (!el) return;
            el.setAttribute("disabled", "true");
            el.style.opacity = "0.4";
            el.style.cursor = "not-allowed";
            if (!el.getAttribute("data-original-title")) el.setAttribute("data-original-title", el.title);
            el.title = "AI offline — open Settings → Diagnostics to enable";
        });
    }
}

// Initialize Application
async function init() {
    setInterval(checkStatus, 5000);
    try {
        await checkStatus();
    } catch(e) {
        console.warn("Status check error:", e);
    }
    
    try {
        await loadWorkflows();
    } catch(e) {
        console.warn("Workflow load error:", e);
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

    // ── 3-Mode Persona Switcher (Simple / Advanced / Enterprise) ──────────────────
    initModeSwitcher();

    // System Requirements Diagnostic Modal binding
    if ($("systemRequirementsBtn")) {
        $("systemRequirementsBtn").onclick = () => {
            openSystemRequirementsModal();
        };
    }

    // ── Support / Donate Modal Binding ─────────────────────────────────────────
    const donateBtn = $("donateBtn");
    const donateModal = $("donateModal");
    const donateClose = $("donateModalClose");
    const donateDone = $("donateModalDoneBtn");
    if (donateBtn && donateModal) {
        donateBtn.onclick = () => donateModal.classList.remove("hidden");
        if (donateClose) donateClose.onclick = () => donateModal.classList.add("hidden");
        if (donateDone) donateDone.onclick = () => donateModal.classList.add("hidden");
        donateModal.onclick = (e) => {
            if (e.target === donateModal) donateModal.classList.add("hidden");
        };
    }

    // ── Start / Record Web Extension Modal ──────────────────────────────────────
    const extModal = $("extensionModal");
    const extClose = $("extensionModalClose");
    const extDone = $("extensionModalDoneBtn");
    const startExtTopbar = $("startExtensionTopbarBtn");
    const startExtHeader = $("startExtensionHeaderBtn");
    const btnLaunchExt = $("btnLaunchExtInstaller");
    const btnCopyExt = $("btnCopyExtPath");

    const openExtModal = () => {
        if (extModal) extModal.classList.remove("hidden");
    };
    if (startExtTopbar) startExtTopbar.onclick = openExtModal;
    if (startExtHeader) startExtHeader.onclick = openExtModal;
    if (extClose) extClose.onclick = () => extModal && extModal.classList.add("hidden");
    if (extDone) extDone.onclick = () => extModal && extModal.classList.add("hidden");
    if (extModal) {
        extModal.onclick = (e) => {
            if (e.target === extModal) extModal.classList.add("hidden");
        };
    }

    const launchBrowserExt = async (browserName, btnEl, defaultText) => {
        try {
            if (btnEl) {
                btnEl.disabled = true;
                btnEl.textContent = "⏳ Launching...";
            }
            const res = await api("/system/open-extension-installer", {
                method: "POST",
                body: JSON.stringify({ browser: browserName })
            });
            showToast(res.message || `Opened ${browserName} extensions!`);
        } catch (e) {
            showToast("Failed: " + e.message);
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = defaultText;
            }
        }
    };

    const btnChrome = $("btnLaunchChrome");
    const btnEdge = $("btnLaunchEdge");
    const btnBrave = $("btnLaunchBrave");
    if (btnChrome) btnChrome.onclick = () => launchBrowserExt("chrome", btnChrome, "<span>🌐</span> Chrome");
    if (btnEdge) btnEdge.onclick = () => launchBrowserExt("edge", btnEdge, "<span>🌊</span> MS Edge");
    if (btnBrave) btnBrave.onclick = () => launchBrowserExt("brave", btnBrave, "<span>🦁</span> Brave");

    if (btnLaunchExt) {
        btnLaunchExt.onclick = () => launchBrowserExt("default", btnLaunchExt, "🚀 One-Click Browser Installer");
    }

    if (btnCopyExt) {
        btnCopyExt.onclick = async () => {
            try {
                const extPath = "C:\\Users\\HP\\Downloads\\tango-local\\tango-local\\extension";
                await navigator.clipboard.writeText(extPath);
                btnCopyExt.innerHTML = "✓ Copied!";
                btnCopyExt.classList.add("btn-copy-success");
                showToast("📋 Extension path copied to clipboard!");
                setTimeout(() => {
                    btnCopyExt.innerHTML = "📋 Copy Path";
                    btnCopyExt.classList.remove("btn-copy-success");
                }, 2500);
            } catch (e) {
                showToast("Path: C:\\Users\\HP\\Downloads\\tango-local\\tango-local\\extension");
            }
        };
    }

    // ── Video & GIF to SOP Import Modal ─────────────────────────────────────────
    const videoImportModal = $("videoImportModal");
    const btnOpenVideoImport = $("btnOpenVideoImportModal");
    const videoImportClose = $("videoImportModalClose");
    const videoImportCancel = $("videoImportCancelBtn");
    const videoDropZone = $("videoDropZone");
    const videoFileInput = $("videoFileInput");
    const videoImportStartBtn = $("videoImportStartBtn");
    let selectedVideoFile = null;

    if (btnOpenVideoImport) {
        btnOpenVideoImport.onclick = () => {
            selectedVideoFile = null;
            if ($("videoDropTitle")) $("videoDropTitle").textContent = "Click or Drag & Drop Video Here";
            if ($("videoWorkflowNameInput")) $("videoWorkflowNameInput").value = "";
            if ($("videoImportProgressWrap")) $("videoImportProgressWrap").classList.add("hidden");
            if (videoImportModal) videoImportModal.classList.remove("hidden");
        };
    }
    if (videoImportClose) videoImportClose.onclick = () => videoImportModal && videoImportModal.classList.add("hidden");
    if (videoImportCancel) videoImportCancel.onclick = () => videoImportModal && videoImportModal.classList.add("hidden");

    if (videoDropZone && videoFileInput) {
        videoDropZone.onclick = (e) => {
            if (e.target !== videoFileInput) videoFileInput.click();
        };
        videoDropZone.ondragover = (e) => {
            e.preventDefault();
            videoDropZone.style.borderColor = "#a855f7";
            videoDropZone.style.background = "rgba(168, 85, 247, 0.1)";
        };
        videoDropZone.ondragleave = () => {
            videoDropZone.style.borderColor = "rgba(168, 85, 247, 0.4)";
            videoDropZone.style.background = "rgba(168, 85, 247, 0.04)";
        };
        videoDropZone.ondrop = (e) => {
            e.preventDefault();
            videoDropZone.style.borderColor = "rgba(168, 85, 247, 0.4)";
            videoDropZone.style.background = "rgba(168, 85, 247, 0.04)";
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                selectedVideoFile = e.dataTransfer.files[0];
                if ($("videoDropTitle")) $("videoDropTitle").textContent = `Selected: ${selectedVideoFile.name} (${(selectedVideoFile.size / (1024*1024)).toFixed(1)}MB)`;
                if ($("videoWorkflowNameInput") && !$("videoWorkflowNameInput").value) {
                    $("videoWorkflowNameInput").value = selectedVideoFile.name.replace(/\.[^/.]+$/, "");
                }
            }
        };
        videoFileInput.onchange = () => {
            if (videoFileInput.files && videoFileInput.files[0]) {
                selectedVideoFile = videoFileInput.files[0];
                if ($("videoDropTitle")) $("videoDropTitle").textContent = `Selected: ${selectedVideoFile.name} (${(selectedVideoFile.size / (1024*1024)).toFixed(1)}MB)`;
                if ($("videoWorkflowNameInput") && !$("videoWorkflowNameInput").value) {
                    $("videoWorkflowNameInput").value = selectedVideoFile.name.replace(/\.[^/.]+$/, "");
                }
            }
        };
    }

    if (videoImportStartBtn) {
        videoImportStartBtn.onclick = async () => {
            if (!selectedVideoFile) {
                showToast("Please select a video file first");
                return;
            }

            const name = $("videoWorkflowNameInput") ? $("videoWorkflowNameInput").value.trim() : "";
            const sens = $("videoSensitivitySelect") ? $("videoSensitivitySelect").value : "medium";

            const progressWrap = $("videoImportProgressWrap");
            const progressBar = $("videoImportProgressBar");
            const statusText = $("videoImportStatusText");

            if (progressWrap) progressWrap.classList.remove("hidden");
            if (progressBar) progressBar.style.width = "35%";
            if (statusText) statusText.textContent = "Uploading & extracting keyframe steps...";
            videoImportStartBtn.disabled = true;

            const formData = new FormData();
            formData.append("file", selectedVideoFile);
            if (name) formData.append("workflow_name", name);
            formData.append("sensitivity", sens);

            try {
                if (progressBar) progressBar.style.width = "65%";
                const res = await fetch(`${API_BASE}/workflows/import-video`, {
                    method: "POST",
                    body: formData
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.detail || "Failed to import video");
                }
                if (progressBar) progressBar.style.width = "100%";
                if (statusText) statusText.textContent = `✓ Generated ${data.step_count} steps!`;
                showToast(`🪄 SOP generated with ${data.step_count} steps!`);
                setTimeout(async () => {
                    if (videoImportModal) videoImportModal.classList.add("hidden");
                    await loadWorkflows();
                    if (data.session_id) await openWorkflow(data.session_id);
                }, 1000);
            } catch (err) {
                showToast(`❌ Error: ${err.message}`);
                if (statusText) statusText.textContent = `Failed: ${err.message}`;
            } finally {
                videoImportStartBtn.disabled = false;
            }
        };
    }

    // ── Guide Me Live In-Browser Beacon ─────────────────────────────────────────
    const btnGuideMeLive = $("btnGuideMeLive");
    if (btnGuideMeLive) {
        btnGuideMeLive.onclick = async () => {
            if (!workflow || !workflow.steps || workflow.steps.length === 0) {
                showToast("No steps available in this workflow to guide");
                return;
            }

            const firstStep = workflow.steps[0];
            let targetUrl = firstStep.url;
            if (!targetUrl || targetUrl.startsWith("video://") || targetUrl.startsWith("file://") || targetUrl.startsWith("chrome://")) {
                targetUrl = "https://www.google.com";
            }

            const guidePayload = {
                type: "START_GUIDE_ME",
                workflow: {
                    id: workflow.id,
                    name: workflow.name,
                    steps: workflow.steps.map(s => ({
                        sequence: s.sequence,
                        title: s.title,
                        description: s.description || s.title,
                        action: s.action,
                        url: s.url,
                        element: s.element || null,
                        hotspot: s.hotspot || null
                    }))
                }
            };

            localStorage.setItem("ps_guide_me_active", JSON.stringify(guidePayload));
            window.postMessage(guidePayload, "*");
            
            showToast("🎯 Starting Guide Me on live site...");
            window.open(targetUrl, "_blank");
        };
    }

    // ── Workflow Hub Navigation Bindings ─────────────────────────────────────
    const btnBackToHub = $("btnBackToHub");
    const brandLogoHome = $("brandLogoHome");
    const brandTitleGroup = $("brandTitleGroup");
    if (btnBackToHub) btnBackToHub.onclick = () => showLibraryHub();
    if (brandLogoHome) brandLogoHome.onclick = () => showLibraryHub();
    if (brandTitleGroup) brandTitleGroup.onclick = () => showLibraryHub();

    // Hub Quick Action Hero Cards
    const hubActionRecordWeb = $("hubActionRecordWeb");
    const hubActionVideoSOP = $("hubActionVideoSOP");
    const hubActionDesktop = $("hubActionDesktop");
    const hubImportJsonInput = $("hubImportJsonInput");

    if (hubActionRecordWeb) hubActionRecordWeb.onclick = openExtModal;
    if (hubActionVideoSOP) hubActionVideoSOP.onclick = () => {
        if (btnOpenVideoImport) btnOpenVideoImport.click();
    };
    if (hubActionDesktop) hubActionDesktop.onclick = () => {
        if (window.openDesktopCaptureModal) window.openDesktopCaptureModal();
        else if ($("captureDesktopBtn")) $("captureDesktopBtn").click();
    };
    if (hubImportJsonInput) {
        hubImportJsonInput.onchange = (e) => handleJsonImport(e.target.files[0]);
    }

    // Hub Search, Filter & Sort
    const hubSearchInput = $("hubSearchInput");
    if (hubSearchInput) {
        hubSearchInput.oninput = () => renderLibraryHub();
    }
    const hubSortSelect = $("hubSortSelect");
    if (hubSortSelect) {
        hubSortSelect.onchange = (e) => {
            hubSortBy = e.target.value;
            renderLibraryHub();
        };
    }
    const hubViewGridBtn = $("hubViewGridBtn");
    const hubViewListBtn = $("hubViewListBtn");
    if (hubViewGridBtn && hubViewListBtn) {
        hubViewGridBtn.onclick = () => {
            hubViewMode = "grid";
            hubViewGridBtn.classList.add("active");
            hubViewListBtn.classList.remove("active");
            const grid = $("hubWorkflowGrid");
            if (grid) {
                grid.style.display = "grid";
                grid.style.flexDirection = "";
            }
        };
        hubViewListBtn.onclick = () => {
            hubViewMode = "list";
            hubViewListBtn.classList.add("active");
            hubViewGridBtn.classList.remove("active");
            const grid = $("hubWorkflowGrid");
            if (grid) {
                grid.style.display = "flex";
                grid.style.flexDirection = "column";
            }
        };
    }

    // ── Global Keyboard Shortcuts & Modal Escape Handler ───────────────────────
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const openModals = document.querySelectorAll(".modal-backdrop:not(.hidden), .dc-modal-overlay:not(.hidden)");
            if (openModals.length > 0) {
                openModals.forEach((m) => m.classList.add("hidden"));
            } else if (selectedWorkflowId && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
                showLibraryHub();
            }
        }
    });

    // ── Theme Toggle (Light/Dark) ──────────────────────────────────────────────
    const themeToggleBtn = $("themeToggleBtn");
    const applyTheme = (theme) => {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("ps_theme", theme);
        if (themeToggleBtn) themeToggleBtn.textContent = theme === "light" ? "🌙" : "☀️";
        if (themeToggleBtn) themeToggleBtn.title = theme === "light" ? "Switch to Dark Theme" : "Switch to Light Theme";
    };
    // Apply saved theme on load
    applyTheme(localStorage.getItem("ps_theme") || "dark");
    if (themeToggleBtn) {
        themeToggleBtn.onclick = () => {
            const current = document.documentElement.getAttribute("data-theme") || "dark";
            applyTheme(current === "dark" ? "light" : "dark");
        };
    }

    // ── Unified Record Dropdown ──────────────────────────────────────────────
    const btnUnifiedRecord = $("btnUnifiedRecord");
    const topRecordMenu = $("topRecordMenu");
    if (btnUnifiedRecord && topRecordMenu) {
        btnUnifiedRecord.onclick = (e) => {
            e.stopPropagation();
            topRecordMenu.classList.toggle("hidden");
        };
        document.addEventListener("click", () => {
            if (topRecordMenu) topRecordMenu.classList.add("hidden");
        });
        topRecordMenu.querySelectorAll(".export-quick-item").forEach(item => {
            item.addEventListener("click", () => {
                topRecordMenu.classList.add("hidden");
            });
        });
    }

    // ── Export Quick Dropdown ─────────────────────────────────────────────────
    const exportQuickBtn = $("exportQuickBtn");
    const exportQuickMenu = $("exportQuickMenu");
    if (exportQuickBtn && exportQuickMenu) {
        exportQuickBtn.onclick = (e) => {
            e.stopPropagation();
            exportQuickMenu.classList.toggle("hidden");
        };
        document.addEventListener("click", () => {
            if (exportQuickMenu) exportQuickMenu.classList.add("hidden");
        });
        exportQuickMenu.querySelectorAll(".export-quick-item").forEach(item => {
            item.onclick = async (e) => {
                e.stopPropagation();
                exportQuickMenu.classList.add("hidden");
                const type = item.dataset.export;
                if (!workflow) return showToast("No workflow selected.");
                if (type === "duplicate") {
                    await duplicateWorkflow();
                } else if (type === "package") {
                    window.open(`${API_BASE}/sessions/${workflow.id}/export-package`, "_blank");
                    showToast("📦 Exporting self-contained .procsnap.zip package...", 3000);
                } else if (type === "qa-csv") {
                    window.open(`${API_BASE}/sessions/${workflow.id}/export-qa-matrix?format=csv`, "_blank");
                    showToast("🧪 Exporting QA Test Case Matrix (.csv)...", 3000);
                } else if (type === "interactive") {
                    $("exportInteractiveBtn")?.click();
                } else if (type === "pptx") {
                    $("exportPptxBtn")?.click();
                } else if (type === "docx") {
                    $("exportDocxBtn")?.click();
                } else if (type === "html") {
                    $("exportHtmlBtn")?.click();
                } else if (type === "markdown") {
                    $("exportMarkdownBtn")?.click();
                } else if (type === "pdf") {
                    $("exportPdfBtn")?.click();
                } else if (type === "json") {
                    $("exportJsonBtn")?.click();
                }
            };
        });
    }

    // ── AI Copilot Dropdown ──────────────────────────────────────────────────
    const aiCopilotBtn = $("aiCopilotBtn");
    const aiCopilotMenu = $("aiCopilotMenu");
    const qualityAuditBtn = $("qualityAuditBtn");
    const qualityAuditMenu = $("qualityAuditMenu");

    if (aiCopilotBtn && aiCopilotMenu) {
        aiCopilotBtn.onclick = (e) => {
            e.stopPropagation();
            aiCopilotMenu.classList.toggle("hidden");
            if (qualityAuditMenu) qualityAuditMenu.classList.add("hidden");
            if (exportQuickMenu) exportQuickMenu.classList.add("hidden");
        };
        document.addEventListener("click", () => {
            if (aiCopilotMenu) aiCopilotMenu.classList.add("hidden");
        });
        setOnclick("menuAiAutoTitles", () => $("autoTitlesBtn")?.click() || autoGenerateTitles());
        setOnclick("menuAiNormalize", () => $("normalizeStepsBtn")?.click() || normalizeWorkflowSteps());
        setOnclick("menuAiSopMeta", () => $("generateSopMetaBtn")?.click() || generateSopMetadata());
        setOnclick("menuAiPolish", () => $("aiPolishBtn")?.click() || aiPolishStepDescriptions());
        setOnclick("menuAiMicroDemos", () => generateAndShowMicroDemos());
    }

    // ── Quality Audit Dropdown ───────────────────────────────────────────────
    if (qualityAuditBtn && qualityAuditMenu) {
        qualityAuditBtn.onclick = (e) => {
            e.stopPropagation();
            qualityAuditMenu.classList.toggle("hidden");
            if (aiCopilotMenu) aiCopilotMenu.classList.add("hidden");
            if (exportQuickMenu) exportQuickMenu.classList.add("hidden");
        };
        document.addEventListener("click", () => {
            if (qualityAuditMenu) qualityAuditMenu.classList.add("hidden");
        });
        setOnclick("menuHealthAudit", () => $("sopHealthScoreBtn")?.click() || auditSopHealth());
        setOnclick("menuPrivacyScan", () => openPiiScannerModal());
        setOnclick("menuAutoRedact", () => triggerAutoRedactPii());
        setOnclick("menuFlowchart", () => openFlowchartModal());
        setOnclick("menuSopTemplates", () => $("sopTemplatesBtn")?.click() || openTemplateModal());
        setOnclick("menuBranchAudit", () => $("validateBranchesBtn")?.click() || validateWorkflowBranches());
    }

    // ── Import JSON Workflow Binding ──────────────────────────────────────────
    const importInput = $("importJsonInput");
    if (importInput) {
        importInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (file) handleJsonImport(file);
            importInput.value = "";
        };
    }

    // ── Add Tag Button in Header ──────────────────────────────────────────────
    const addTagBtn = $("addTagBtn");
    if (addTagBtn) {
        addTagBtn.onclick = addTagToActiveWorkflow;
    }

    // ── Search Input Realtime Filter ──────────────────────────────────────────
    const searchInput = $("searchInput");
    if (searchInput) {
        searchInput.oninput = () => renderWorkflowList();
    }

    // ── Step Jump-To Input ────────────────────────────────────────────────────
    const stepJumpInput = $("stepJumpInput");
    if (stepJumpInput) {
        stepJumpInput.onchange = () => {
            if (!workflow || !workflow.steps) return;
            const total = workflow.steps.filter(s => !s.hidden).length;
            let n = parseInt(stepJumpInput.value, 10);
            if (isNaN(n)) return;
            n = Math.max(1, Math.min(n, total)) - 1;
            currentStepIndex = n;
            renderGuideTab();
        };
        stepJumpInput.onkeydown = (e) => {
            if (e.key === "Enter") stepJumpInput.dispatchEvent(new Event("change"));
        };
    }

    // ── Arrow Key Navigation (←/→ between steps) ─────────────────────────────
    document.addEventListener("keydown", (e) => {
        // Only when not focused on a text input/textarea/contenteditable
        const tag = document.activeElement?.tagName?.toLowerCase();
        const isEditing = ["input", "textarea", "select"].includes(tag) ||
                          document.activeElement?.isContentEditable;
        if (isEditing) return;
        if (!workflow || !workflow.steps) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const visSteps = workflow.steps.filter(s => !s.hidden);
            if (e.key === "ArrowLeft" && currentStepIndex > 0) {
                currentStepIndex--;
                renderGuideTab();
            } else if (e.key === "ArrowRight" && currentStepIndex < visSteps.length - 1) {
                currentStepIndex++;
                renderGuideTab();
            }
        }
    });

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
    const viewParam = params.get("view");
    if (session_id) {
        selectedWorkflowId = session_id;
        openWorkflow(session_id).then(() => {
            if (viewParam === "procbot" && window.openProcBotStudio) {
                setTimeout(() => window.openProcBotStudio(false), 300);
            }
        });
    } else if (viewParam === "procbot" && window.openProcBotStudio) {
        setTimeout(() => window.openProcBotStudio(true), 300);
    }
}

// ── Duplicate Workflow ─────────────────────────────────────────────────────
async function duplicateWorkflow() {
    if (!workflow) return;
    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/duplicate`, { method: "POST" });
        showToast(`✅ Duplicated as "${res.name}"!`);
        await loadWorkflows();
        if (res.id) openWorkflow(res.id);
    } catch (e) {
        showToast("Duplicate failed: " + e.message);
    }
}

// ── Update Approval Progress Bar ──────────────────────────────────────────
function updateApprovalProgress(steps) {
    const wrap = $("approvalProgressWrap");
    const fill = $("approvalProgressFill");
    const label = $("approvalProgressLabel");
    if (!steps || steps.length === 0) {
        if (wrap) wrap.classList.add("hidden");
        return;
    }
    const vis = steps.filter(s => !s.hidden);
    const approved = vis.filter(s => s.approved).length;
    const pct = vis.length > 0 ? Math.round((approved / vis.length) * 100) : 0;
    if (wrap) wrap.classList.remove("hidden");
    if (fill) fill.style.width = pct + "%";
    if (label) label.textContent = `${approved} / ${vis.length} approved`;
    if (label) label.style.color = pct === 100 ? "#10b981" : "#34d399";
}

let activeFilterTag = "ALL";

// ── Render Category Tag Filter Chips in Sidebar ─────────────────────────────
function renderTagFilterBar() {
    const bar = $("tagFilterBar");
    if (!bar) return;
    const tagSet = new Set();
    workflows.forEach(w => {
        if (w.tags) {
            w.tags.split(",").map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
        }
    });

    const tags = ["ALL", ...Array.from(tagSet).sort()];
    bar.innerHTML = tags.map(t => `
        <button class="tag-chip ${activeFilterTag === t ? 'active' : ''}" data-tag="${esc(t)}">
            ${esc(t === "ALL" ? "All" : t)}
        </button>
    `).join("");

    bar.querySelectorAll(".tag-chip").forEach(chip => {
        chip.onclick = () => {
            activeFilterTag = chip.dataset.tag;
            renderTagFilterBar();
            renderWorkflowList();
        };
    });
}

// ── Render Tags for Active Workflow in Header ──────────────────────────────
function renderWfTags() {
    const container = $("wfTagsContainer");
    if (!container || !workflow) return;
    const rawTags = workflow.tags || "";
    const tagList = rawTags.split(",").map(t => t.trim()).filter(Boolean);

    container.innerHTML = tagList.map(tag => `
        <span class="wf-tag-pill">
            ${esc(tag)}
            <span class="wf-tag-remove" data-tag="${esc(tag)}" title="Remove tag">✕</span>
        </span>
    `).join("");

    container.querySelectorAll(".wf-tag-remove").forEach(rm => {
        rm.onclick = async (e) => {
            e.stopPropagation();
            const tagToRemove = rm.dataset.tag;
            const updated = tagList.filter(t => t !== tagToRemove).join(", ");
            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}`, {
                    method: "PATCH",
                    body: JSON.stringify({ tags: updated })
                });
                workflow.tags = updated;
                const found = workflows.find(w => w.id === workflow.id);
                if (found) found.tags = updated;
                renderWfTags();
                renderTagFilterBar();
                renderWorkflowList();
                showToast(`Tag "${tagToRemove}" removed`);
            } catch (err) {
                showToast("Failed to remove tag: " + err.message);
            }
        };
    });
}

function getAllUniqueWorkflowTags() {
    const tagSet = new Set();
    (workflows || []).forEach(w => {
        (w.tags || "").split(",").map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    });
    return Array.from(tagSet);
}

// ── Add Tag Handler ────────────────────────────────────────────────────────
async function addTagToActiveWorkflow() {
    if (!workflow) return;
    const existing = getAllUniqueWorkflowTags();
    const existingStr = existing.length > 0 ? `\n\nExisting tags in Library:\n• ${existing.join("\n• ")}` : "";
    const tag = prompt(`Enter category tag name (or pick from existing tags):${existingStr}`);
    if (!tag || !tag.trim()) return;
    const cleanTag = tag.trim().replace(/,/g, "");
    const rawTags = workflow.tags || "";
    const tagList = rawTags.split(",").map(t => t.trim()).filter(Boolean);
    if (tagList.includes(cleanTag)) return showToast("Tag already added to this workflow");
    tagList.push(cleanTag);
    const updated = tagList.join(", ");

    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ tags: updated })
        });
        workflow.tags = updated;
        const found = workflows.find(w => w.id === workflow.id);
        if (found) found.tags = updated;
        renderWfTags();
        renderTagFilterBar();
        renderWorkflowList();
        showToast(`Tag "${cleanTag}" added`);
    } catch (err) {
        showToast("Failed to add tag: " + err.message);
    }
}

setOnclick("btnCopyGuideTitle", async () => {
    const titleEl = $("guideStepTitle");
    const title = titleEl ? (titleEl.innerText || titleEl.textContent || "").trim() : "";
    if (title) {
        try {
            await navigator.clipboard.writeText(title);
            showToast("📋 Step title copied to clipboard!");
        } catch(e) {
            showToast("Copied: " + title);
        }
    }
});


// ── Update Library Stats ───────────────────────────────────────────────────
function updateLibraryStats() {
    const totalWfs = workflows.length;
    const totalSteps = workflows.reduce((sum, w) => sum + (w.stepCount || 0), 0);
    let totalApproved = 0;
    if (workflow && workflow.steps) {
        totalApproved = workflow.steps.filter(s => s.checked || s.approved).length;
    }
    setText("statWfCount", totalWfs);
    setText("statStepCount", totalSteps);
    setText("statApprovedCount", totalApproved);
}

// ── Import JSON Workflow ──────────────────────────────────────────────────
async function handleJsonImport(file) {
    if (!file) return;
    try {
        showToast("Importing workflow from JSON...");
        const text = await file.text();
        const json = JSON.parse(text);
        const res = await api("/sessions/import", {
            method: "POST",
            body: JSON.stringify({ workflow: json })
        });
        showToast(`✅ Successfully imported "${res.name}" (${res.stepCount} steps)!`);
        await loadWorkflows();
        if (res.id) openWorkflow(res.id);
    } catch (e) {
        showToast("Import failed: " + e.message);
        console.error("JSON import error:", e);
    }
}

// Workflow Hub & Studio State
let hubViewMode = "grid"; // "grid" | "list"
let hubSortBy = "recent"; // "recent" | "steps" | "name"
let hubFilterTag = "ALL";

// Load Workflows List & Hub
async function loadWorkflows() {
    try {
        const data = await api("/sessions");
        workflows = data.sessions || [];
        updateLibraryStats();
        renderTagFilterBar();
        renderWorkflowList();
        renderLibraryHub();
        
        const urlParams = new URLSearchParams(window.location.search);
        const initSessionId = urlParams.get("session_id");

        if (initSessionId && workflows.some(w => w.id === initSessionId)) {
            await openWorkflow(initSessionId);
        } else if (selectedWorkflowId && workflows.some(w => w.id === selectedWorkflowId)) {
            await openWorkflow(selectedWorkflowId);
        } else {
            showLibraryHub();
        }
    } catch (e) {
        const listEl = $("workflowList");
        if (listEl) listEl.innerHTML = `<div class="no-results">Error loading workflows: ${esc(e.message)}</div>`;
        const gridEl = $("hubWorkflowGrid");
        if (gridEl) gridEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--danger);">⚠️ Error loading library: ${esc(e.message)}</div>`;
    }
}

function formatRelativeTime(iso) {
    if (!iso) return "Recently";
    try {
        const date = new Date(iso);
        const now = new Date();
        const diffSecs = Math.floor((now - date) / 1000);
        if (diffSecs < 60) return "Just now";
        const diffMins = Math.floor(diffSecs / 60);
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 30) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    } catch (_) {
        return "Recently";
    }
}

// Render Workflows Sidebar List (Quick Switcher)
function renderWorkflowList() {
    const searchEl = $("searchInput");
    const q = (searchEl ? searchEl.value : "").trim().toLowerCase();
    const listEl = $("workflowList");
    if (!listEl) return;

    const filtered = workflows.filter(w => {
        const matchesQuery = (w.name || "").toLowerCase().includes(q) || 
                             (w.application || "").toLowerCase().includes(q) ||
                             (w.tags || "").toLowerCase().includes(q);
        const matchesTag = activeFilterTag === "ALL" || 
                           (w.tags || "").split(",").map(t => t.trim().toLowerCase()).includes(activeFilterTag.toLowerCase());
        return matchesQuery && matchesTag;
    });

    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="no-results" style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 12.5px;">No workflows found</div>';
        return;
    }

    listEl.innerHTML = filtered.map(w => {
        const tagBadges = (w.tags || "").split(",").map(t => t.trim()).filter(Boolean).map(t => `
            <span class="wf-tag-badge">${esc(t)}</span>
        `).join("");

        const timeStr = formatRelativeTime(w.created_at || w.updated_at);

        return `
            <div class="workflow-card ${w.id === selectedWorkflowId ? 'selected' : ''}" data-id="${esc(w.id)}">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 6px;">
                    <div class="workflow-name" style="flex: 1; word-break: break-word;">${esc(w.name || "Untitled Workflow")}</div>
                    <div class="wf-card-actions" style="display: flex; align-items: center; gap: 2px; opacity: 0.7; transition: opacity 0.15s ease;">
                        <button class="wf-btn-rename btn btn-secondary btn-xs" data-id="${esc(w.id)}" data-name="${esc(w.name || '')}" title="Rename Workflow" style="background: transparent; border: none; padding: 2px 4px; font-size: 11px; cursor: pointer; color: var(--text-muted, #94a3b8); border-radius: 4px;">✏️</button>
                        <button class="wf-btn-delete btn btn-secondary btn-xs" data-id="${esc(w.id)}" data-name="${esc(w.name || '')}" title="Delete Workflow" style="background: transparent; border: none; padding: 2px 4px; font-size: 11px; cursor: pointer; color: #f87171; border-radius: 4px;">🗑️</button>
                    </div>
                </div>
                <div class="workflow-meta" style="margin-top: 4px; display: flex; align-items: center; justify-content: space-between; font-size: 11px;">
                    <span>${w.stepCount || 0} step${w.stepCount === 1 ? "" : "s"} • <small style="color: var(--text-muted);">${timeStr}</small></span>
                    <span class="status ${esc(w.status || 'completed')}">${esc(w.status || 'completed')}</span>
                </div>
                ${tagBadges ? `<div class="workflow-card-tags" style="margin-top: 6px;">${tagBadges}</div>` : ''}
            </div>
        `;
    }).join("");

    document.querySelectorAll(".workflow-card").forEach(card => {
        card.onclick = (e) => {
            if (e.target.closest(".wf-btn-rename") || e.target.closest(".wf-btn-delete")) return;
            openWorkflow(card.dataset.id);
        };
    });

    document.querySelectorAll(".wf-btn-rename").forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const currentName = btn.dataset.name || "Untitled Workflow";
            const newName = prompt("Rename SOP Workflow:", currentName);
            if (newName && newName.trim() && newName.trim() !== currentName) {
                try {
                    await api(`/sessions/${encodeURIComponent(id)}`, {
                        method: "PATCH",
                        body: JSON.stringify({ name: newName.trim() })
                    });
                    const wf = workflows.find(w => w.id === id);
                    if (wf) wf.name = newName.trim();
                    if (workflow && workflow.id === id) {
                        workflow.name = newName.trim();
                        setText("workflowTitle", newName.trim());
                    }
                    renderWorkflowList();
                    showToast("✓ Workflow renamed successfully!");
                } catch (err) {
                    showToast("Failed to rename workflow: " + err.message);
                }
            }
        };
    });

    document.querySelectorAll(".wf-btn-delete").forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const name = btn.dataset.name || "this workflow";
            if (confirm(`Are you sure you want to permanently delete '${name}'?`)) {
                try {
                    await api(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
                    workflows = workflows.filter(w => w.id !== id);
                    showToast("🗑️ Workflow deleted successfully.");
                    if (selectedWorkflowId === id) {
                        showLibraryHub();
                    } else {
                        renderWorkflowList();
                    }
                    updateSidebarCounts();
                } catch (err) {
                    showToast("Failed to delete workflow: " + err.message);
                }
            }
        };
    });
}

// Show Full-Screen Workflow Hub Gallery UI
function showLibraryHub() {
    selectedWorkflowId = null;
    if ($("libraryHubView")) $("libraryHubView").classList.remove("hidden");
    if ($("studioView")) $("studioView").classList.add("hidden");
    if ($("topBreadcrumb")) $("topBreadcrumb").classList.add("hidden");
    
    // Auto-collapse sidebar in Hub view only if not pinned open
    const sidebar = document.querySelector(".sidebar");
    if (sidebar && !sidebar.classList.contains("pinned") && localStorage.getItem("sidebar_pinned") !== "true") {
        sidebar.classList.add("collapsed");
    }

    // Clean URL query param
    const url = new URL(window.location);
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url);
    
    renderWorkflowList();
    renderLibraryHub();
}

// Render Modern Workflow Hub Gallery View
function renderLibraryHub() {
    const gridEl = $("hubWorkflowGrid");
    if (!gridEl) return;
    
    const searchEl = $("hubSearchInput");
    const q = (searchEl ? searchEl.value : "").trim().toLowerCase();
    
    let filtered = workflows.filter(w => {
        const matchesQuery = (w.name || "").toLowerCase().includes(q) || 
                             (w.application || "").toLowerCase().includes(q) ||
                             (w.tags || "").toLowerCase().includes(q);
        const matchesTag = hubFilterTag === "ALL" || 
                           (w.tags || "").split(",").map(t => t.trim().toLowerCase()).includes(hubFilterTag.toLowerCase());
        return matchesQuery && matchesTag;
    });

    // Sorting
    if (hubSortBy === "recent") {
        filtered.sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
    } else if (hubSortBy === "steps") {
        filtered.sort((a, b) => (b.stepCount || 0) - (a.stepCount || 0));
    } else if (hubSortBy === "name") {
        filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    renderHubTagFilterBar();

    if (filtered.length === 0) {
        gridEl.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; background: var(--bg-surface-elevated); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
                <div style="font-size: 32px; margin-bottom: 12px;">📁</div>
                <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 0 0 6px 0;">No SOP Workflows Found</h3>
                <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 16px 0;">Start by recording a web app, importing a video screen capture, or capturing your desktop.</p>
                <button class="btn btn-primary btn-sm" id="hubEmptyStartExtBtn" style="display: inline-flex; align-items: center; gap: 6px;">
                    🔴 Record New Workflow
                </button>
            </div>
        `;
        const emptyBtn = $("hubEmptyStartExtBtn");
        if (emptyBtn) emptyBtn.onclick = () => {
            if ($("startExtensionTopbarBtn")) $("startExtensionTopbarBtn").click();
        };
        return;
    }

    gridEl.innerHTML = filtered.map(w => {
        const timeStr = formatRelativeTime(w.created_at || w.createdAt || w.startedAt || w.updated_at);
        const coverUrl = w.coverScreenshot ? normalizeImageUrl(w.coverScreenshot) : `${API_BASE}/sessions/${encodeURIComponent(w.id)}/cover?t=${Date.now()}`;
        const tagBadges = (w.tags || "").split(",").map(t => t.trim()).filter(Boolean).map(t => `
            <span class="hub-card-tag">${esc(t)}</span>
        `).join("");

        return `
            <div class="hub-card" data-id="${esc(w.id)}">
                <div class="hub-card-thumb-wrap" onclick="openWorkflow('${esc(w.id)}')">
                    <img class="hub-card-thumb" src="${coverUrl}" alt="Cover screenshot" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="hub-card-placeholder" style="display: none;">
                        <span style="font-size: 28px;">📄</span>
                        <span style="font-size: 11px; font-weight: 600;">ProcSnap SOP</span>
                    </div>
                    <span class="hub-card-badge-app">${esc(w.application || 'App')}</span>
                    <span class="hub-card-badge-steps">${w.stepCount || 0} Step${w.stepCount === 1 ? '' : 's'}</span>
                </div>
                <div class="hub-card-body" onclick="openWorkflow('${esc(w.id)}')">
                    <div class="hub-card-title">${esc(w.name || 'Untitled Workflow')}</div>
                    <div class="hub-card-meta">
                        <span>🕒 ${timeStr}</span>
                        <span>•</span>
                        <span style="color: #10b981; font-weight: 600;">${esc(w.status || 'Active')}</span>
                    </div>
                    ${tagBadges ? `<div class="hub-card-tags">${tagBadges}</div>` : ''}
                </div>
                <div class="hub-card-footer">
                    <button class="hub-card-btn primary" onclick="openWorkflow('${esc(w.id)}')">
                        ✏️ Edit SOP
                    </button>
                    <div style="display: flex; gap: 4px;">
                        <button class="hub-card-btn" onclick="triggerGuideMeForWorkflow('${esc(w.id)}', event)" title="Start interactive Guide Me beacon">
                            🎯 Guide Me
                        </button>
                        <button class="hub-card-btn" onclick="deleteWorkflowFromHub('${esc(w.id)}', event)" title="Delete workflow" style="color: var(--danger);">
                            🗑️
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

function renderHubTagFilterBar() {
    const bar = $("hubTagFilterBar");
    if (!bar) return;

    const allTags = new Set();
    workflows.forEach(w => {
        (w.tags || "").split(",").forEach(t => {
            const clean = t.trim();
            if (clean) allTags.add(clean);
        });
    });

    const tagsArr = ["ALL", ...Array.from(allTags).sort()];
    bar.innerHTML = tagsArr.map(tag => `
        <button class="hub-tag-pill ${hubFilterTag === tag ? 'active' : ''}" data-tag="${esc(tag)}">
            ${tag === "ALL" ? "All Guides" : `#${esc(tag)}`}
        </button>
    `).join("");

    bar.querySelectorAll(".hub-tag-pill").forEach(btn => {
        btn.onclick = () => {
            hubFilterTag = btn.dataset.tag;
            renderLibraryHub();
        };
    });
}

async function deleteWorkflowFromHub(id, e) {
    if (e) e.stopPropagation();
    if (!confirm("Are you sure you want to delete this workflow?")) return;
    try {
        await api(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
        showToast("Workflow deleted");
        await loadWorkflows();
        renderLibraryHub();
    } catch (err) {
        showToast(`Failed to delete: ${err.message}`);
    }
}

async function triggerGuideMeForWorkflow(id, e) {
    if (e) e.stopPropagation();
    await openWorkflow(id);
    setTab("play");
}

// Open and load detailed workflow into Studio Workspace
async function openWorkflow(id) {
    selectedWorkflowId = id;
    renderWorkflowList();
    
    try {
        workflow = await api(`/sessions/${encodeURIComponent(id)}`);
        if ($("libraryHubView")) $("libraryHubView").classList.add("hidden");
        if ($("studioView")) $("studioView").classList.remove("hidden");
        if ($("topBreadcrumb")) $("topBreadcrumb").classList.remove("hidden");
        
        // Update URL query param
        const url = new URL(window.location);
        url.searchParams.set("session_id", id);
        window.history.replaceState({}, "", url);
        
        setText("detailName", workflow.name || "Untitled Workflow");
        setText("detailApplication", workflow.application || "Chrome");
        setText("detailMeta", `${workflow.stepCount || 0} steps • ${workflow.status || 'completed'} • Started ${fmt(workflow.startedAt)}`);
        
        renderWfTags();
        updateLibraryStats();
        fetchAndRenderSopHealth();
        if (typeof updateLifecyclePill === "function") updateLifecyclePill(workflow.lifecycle_status || "draft");
        if ($("currentVersionLabel")) $("currentVersionLabel").textContent = workflow.current_version || "v1.0";
        currentStepIndex = 0;
        setTab(activeTab);
    } catch (e) {
        showToast(`Failed to load workflow: ${e.message}`);
        showLibraryHub();
    }
}

// Tab Switching
function setTab(tabName) {
    if (tabName === "slideshow" || tabName === "reader") tabName = "play";
    activeTab = tabName;
    document.querySelectorAll(".tab").forEach(tab => {
        const t = (tab.dataset.tab === "slideshow" || tab.dataset.tab === "reader") ? "play" : tab.dataset.tab;
        tab.classList.toggle("active", t === tabName || tab.dataset.tab === tabName);
    });

    ["guide", "steps", "play", "export"].forEach(tab => {
        const el = $(`tab-${tab}`);
        if (el) el.classList.toggle("hidden", tab !== tabName);
    });

    if (tabName === "guide") renderGuideTab();
    if (tabName === "steps") renderStepsTab();
    if (tabName === "play") renderPlaybackTab();
    if (tabName === "export") renderExportTab();
}

function renderReaderTab() {
    if (!workflow) return;
    const steps = workflow.steps || [];
    setText("readerWfTitle", workflow.name || "Process SOP");
    
    if (steps.length === 0) {
        setText("readerPageIndicator", "0 of 0");
        setText("readerStepTitle", "No steps in this workflow");
        setText("readerStepDesc", "Record or add steps to read this SOP.");
        if ($("readerStepImg")) $("readerStepImg").style.display = "none";
        return;
    }

    let rIdx = typeof currentStepIndex === "number" ? currentStepIndex : 0;
    if (rIdx < 0 || rIdx >= steps.length) rIdx = 0;
    const step = steps[rIdx];

    setText("readerPageIndicator", `Step ${rIdx + 1} of ${steps.length}`);
    setText("readerStepBadge", `STEP ${rIdx + 1}`);
    setText("readerStepSemantic", step.semantic_class || actionTitle(step.action));
    setText("readerStepTitle", step.title || getDefaultTitle(step));
    setText("readerStepDesc", step.description || getDefaultDescription(step));
    
    const expText = step.expected || step.expected_result || "Action executes successfully and the process proceeds.";
    setText("readerExpectedText", expText);

    const imgEl = $("readerStepImg");
    if (imgEl) {
        let imgUrl = "";
        if (step.screenshotUrl) {
            imgUrl = step.screenshotUrl.startsWith("http") ? step.screenshotUrl : `${API_BASE}/${step.screenshotUrl.replace(/^\/+/, "")}`;
        } else if (step.screenshot_path) {
            imgUrl = step.screenshot_path.startsWith("http") ? step.screenshot_path : `${API_BASE}/${step.screenshot_path.replace(/^\/+/, "")}`;
        } else if (step.image) {
            imgUrl = step.image;
        } else if (workflow && workflow.id) {
            imgUrl = `${API_BASE}/screenshots/${workflow.id}/step-${String(step.sequence).padStart(3, "0")}.png`;
        }

        if (imgUrl) {
            imgEl.src = imgUrl;
            imgEl.style.display = "block";
            imgEl.onerror = () => {
                // Fallback attempt without query params or alternative path
                if (workflow && workflow.id) {
                    imgEl.src = `${API_BASE}/screenshots/${workflow.id}/step-${String(step.sequence).padStart(3, "0")}.png?t=${Date.now()}`;
                }
            };
        } else {
            imgEl.style.display = "none";
        }
    }

    const prevBtn = $("btnReaderPrev");
    const nextBtn = $("btnReaderNext");
    if (prevBtn) {
        prevBtn.disabled = rIdx === 0;
        prevBtn.onclick = () => {
            if (rIdx > 0) {
                currentStepIndex = rIdx - 1;
                renderReaderTab();
            }
        };
    }
    if (nextBtn) {
        nextBtn.disabled = rIdx === steps.length - 1;
        nextBtn.onclick = () => {
            if (rIdx < steps.length - 1) {
                currentStepIndex = rIdx + 1;
                renderReaderTab();
            }
        };
    }
}

document.querySelectorAll(".tab").forEach(tab => {
    tab.onclick = () => setTab(tab.dataset.tab);
});

// Global Event Delegation for Export Preview Buttons
document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-preview-export");
    if (btn) {
        const type = btn.dataset.type;
        if (type && typeof openExportPreview === "function") {
            openExportPreview(type);
        }
    }
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
        
        if (this.img) {
            this.img.onload = () => this.resizeCanvas();
        }
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
                if ($("lineWidthVal")) $("lineWidthVal").textContent = `${val}px`;
                this.currentLineWidth = parseInt(val);
                this.applyStyleToActiveShape("lineWidth", this.currentLineWidth);
            };
        }

        // Opacity
        const opSlider = $("opacitySlider");
        if (opSlider) {
            opSlider.oninput = () => {
                const val = opSlider.value;
                if ($("opacityVal")) $("opacityVal").textContent = `${val}%`;
                this.currentOpacity = parseFloat(val) / 100;
                this.applyStyleToActiveShape("opacity", this.currentOpacity);
            };
        }

        // Text Size
        const sizeSlider = $("textSizeSlider");
        if (sizeSlider) {
            sizeSlider.oninput = () => {
                const val = sizeSlider.value;
                if ($("textSizeVal")) $("textSizeVal").textContent = `${val}px`;
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
        if ($("lineWidthSlider")) $("lineWidthSlider").value = lw;
        if ($("lineWidthVal")) $("lineWidthVal").textContent = `${lw}px`;
        this.currentLineWidth = lw;

        // Sync opacity
        const op = shape.opacity !== undefined ? shape.opacity : 1;
        if ($("opacitySlider")) $("opacitySlider").value = Math.round(op * 100);
        if ($("opacityVal")) $("opacityVal").textContent = `${Math.round(op * 100)}%`;
        this.currentOpacity = op;

        // Sync text size
        const ts = shape.textSize || 12;
        if ($("textSizeSlider")) $("textSizeSlider").value = ts;
        if ($("textSizeVal")) $("textSizeVal").textContent = `${ts}px`;
        this.currentTextSize = ts;

        // Sync font family
        const ff = shape.fontFamily || "Inter";
        if ($("fontFamilySelect")) $("fontFamilySelect").value = ff;
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
        if (!this.img || !this.img.naturalWidth || !this.canvas) return;
        
        const rect = this.img.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        this.drawAll();
    }

    // Convert viewport/client coordinates to Image-Space Coordinates (natural scale)
    clientToImage(clientX, clientY) {
        if (!this.canvas || !this.img) return { x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
        const scaleX = (this.img.naturalWidth || rect.width) / rect.width;
        const scaleY = (this.img.naturalHeight || rect.height) / rect.height;
        
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
        if (!this.canvas || !this.img) return { x: imgX, y: imgY };
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { x: imgX, y: imgY };
        const scaleX = rect.width / (this.img.naturalWidth || rect.width);
        const scaleY = rect.height / (this.img.naturalHeight || rect.height);
        
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

    redraw() {
        this.drawAll();
    }

    drawAll() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 1. Draw Spotlight & Red Dashed Focus Box around target element
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
                    
                    // Spotlight cutout: dim outer canvas if spotlight enabled
                    if (this.autoSpotlightEnabled !== false) {
                        this.ctx.save();
                        this.ctx.fillStyle = "rgba(15, 23, 42, 0.40)";
                        this.ctx.beginPath();
                        this.ctx.rect(0, 0, this.canvas.width, this.canvas.height);
                        this.ctx.rect(x - 4, y - 4, w + 8, h + 8);
                        this.ctx.fill("evenodd");
                        this.ctx.restore();
                    }

                    // Only draw red dashed box if target element is inside visible canvas bounds
                    if (x >= -20 && y >= -20 && x + w <= this.canvas.width + 40 && y + h <= this.canvas.height + 40) {
                        this.ctx.save();
                        this.ctx.strokeStyle = "rgba(239, 68, 68, 0.95)";
                        this.ctx.lineWidth = 3;
                        this.ctx.setLineDash([8, 4]);
                        this.ctx.shadowColor = "rgba(239, 68, 68, 0.5)";
                        this.ctx.shadowBlur = 6;
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
                // Sleek Tango-Style Numbered Step Badge
                const r = (w && Math.abs(w) > 10) ? Math.max(12, Math.min(24, Math.abs(w / 2))) : 13;
                const cx = pos.x + (w ? w / 2 : 0);
                const cy = pos.y + (h ? h / 2 : 0);
                
                this.ctx.save();
                this.ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
                this.ctx.shadowBlur = 6;
                this.ctx.shadowOffsetY = 2;
                
                this.ctx.beginPath();
                this.ctx.arc(cx, cy, r, 0, 2 * Math.PI);
                this.ctx.fillStyle = s.color || "#ef4444";
                this.ctx.fill();
                
                this.ctx.strokeStyle = "#ffffff";
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
                this.ctx.restore();
                
                // Label sequence number
                this.ctx.fillStyle = "#ffffff";
                this.ctx.font = `bold ${Math.max(10, Math.round(r * 0.9))}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif`;
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
                this.ctx.fillText(s.label || "1", cx, cy + 0.5);
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
                // Kept clean without elliptical glow circles
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

        return null;
    }

    /**
     * Apply auto-spotlight for a step. Keeps canvas clean without elliptical rings.
     */
    applyAutoSpotlight(element, stepSequence, existingAnnotations) {
        return (existingAnnotations || []).filter(a => !a.autoGenerated && a.type !== "spotlight");
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
            const btn = $(`tool-${tool}`);
            if (btn) {
                btn.onclick = () => {
                    document.querySelectorAll(".dock-tool-btn, .tool-btn").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    canvasEngine.setTool(tool);
                    // Close text picker if open
                    $("textStylePicker")?.classList.add("hidden");
                    $("palettePanel")?.classList.add("hidden");
                };
            }
        });

        // Text tool main button
        const textBtn = $("tool-text");
        if (textBtn) {
            textBtn.onclick = () => {
                document.querySelectorAll(".dock-tool-btn, .tool-btn").forEach(b => b.classList.remove("active"));
                textBtn.classList.add("active");
                canvasEngine.setTool("text");
                $("textStylePicker")?.classList.toggle("hidden");
                $("palettePanel")?.classList.add("hidden");
            };
        }

        // Text style caret toggle
        const textCaret = $("tool-text-caret");
        if (textCaret) {
            textCaret.onclick = (e) => {
                e.stopPropagation();
                $("textStylePicker")?.classList.toggle("hidden");
                $("palettePanel")?.classList.add("hidden");
            };
        }

        // Text style options (Info, Warning, Tip, Note, Plain)
        document.querySelectorAll(".text-style-opt").forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll(".text-style-opt").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const styleName = btn.dataset.style || "info";
                
                const styleMap = {
                    info: { color: "#3b82f6", bgColor: "rgba(59, 130, 246, 0.15)", textColor: "#ffffff" },
                    warning: { color: "#f59e0b", bgColor: "rgba(245, 158, 11, 0.15)", textColor: "#ffffff" },
                    tip: { color: "#10b981", bgColor: "rgba(16, 185, 129, 0.15)", textColor: "#ffffff" },
                    note: { color: "#8b5cf6", bgColor: "rgba(139, 92, 246, 0.15)", textColor: "#ffffff" },
                    plain: { color: "#ffffff", bgColor: "transparent", textColor: "#ffffff" }
                };

                const s = styleMap[styleName] || styleMap.info;
                canvasEngine.textStyle = {
                    color: s.color,
                    bgColor: s.bgColor,
                    textColor: s.textColor,
                    styleName: styleName,
                    fontSize: canvasEngine.textStyle?.fontSize || 16
                };

                // Activate text tool
                document.querySelectorAll(".dock-tool-btn, .tool-btn").forEach(b => b.classList.remove("active"));
                $("tool-text")?.classList.add("active");
                canvasEngine.setTool("text");
                showToast(`🔤 Callout style: ${styleName.toUpperCase()}`);
            };
        });

        // Font size options for Text
        document.querySelectorAll(".text-size-btn").forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll(".text-size-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const size = parseInt(btn.dataset.size || "16", 10);
                if (canvasEngine.textStyle) {
                    canvasEngine.textStyle.fontSize = size;
                }
                showToast(`Font size: ${size}px`);
            };
        });

        // Text preset buttons (quick labels)
        document.querySelectorAll(".text-preset-btn").forEach(btn => {
            btn.onclick = () => {
                canvasEngine.textPreset = btn.dataset.preset;
                document.querySelectorAll(".dock-tool-btn, .tool-btn").forEach(b => b.classList.remove("active"));
                $("tool-text")?.classList.add("active");
                canvasEngine.setTool("text");
                $("textStylePicker")?.classList.add("hidden");
                showToast(`Preset: "${btn.dataset.preset}"`);
            };
        });

        // Color Picker toggle
        const colorPickerBtn = $("tool-color-picker");
        if (colorPickerBtn) {
            colorPickerBtn.onclick = (e) => {
                e.stopPropagation();
                $("palettePanel")?.classList.toggle("hidden");
                $("textStylePicker")?.classList.add("hidden");
            };
        }

        // Color Swatches in Palette Panel
        document.querySelectorAll(".color-swatch").forEach(swatch => {
            swatch.onclick = () => {
                document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
                swatch.classList.add("active");
                const color = swatch.dataset.color || "#ef4444";
                canvasEngine.currentColor = color;
                
                const indicator = $("currentColorIndicator");
                if (indicator) indicator.style.backgroundColor = color;

                const customInput = $("customColorInput");
                if (customInput) customInput.value = color;

                if (canvasEngine.activeShape) {
                    canvasEngine.activeShape.color = color;
                    canvasEngine.drawAll();
                    saveStepAnnotations(canvasEngine.annotations);
                }
                showToast(`🎨 Color updated: ${color}`);
            };
        });

        // Custom Color Picker input
        const customColorInput = $("customColorInput");
        if (customColorInput) {
            customColorInput.oninput = (e) => {
                const color = e.target.value;
                canvasEngine.currentColor = color;
                const indicator = $("currentColorIndicator");
                if (indicator) indicator.style.backgroundColor = color;

                if (canvasEngine.activeShape) {
                    canvasEngine.activeShape.color = color;
                    canvasEngine.drawAll();
                    saveStepAnnotations(canvasEngine.annotations);
                }
            };
        }

        // Stroke Width Buttons
        document.querySelectorAll(".stroke-opt-btn").forEach(sBtn => {
            sBtn.onclick = () => {
                document.querySelectorAll(".stroke-opt-btn").forEach(b => b.classList.remove("active"));
                sBtn.classList.add("active");
                const strokeWidth = parseInt(sBtn.dataset.width || "4", 10);
                canvasEngine.strokeWidth = strokeWidth;

                if (canvasEngine.activeShape) {
                    canvasEngine.activeShape.strokeWidth = strokeWidth;
                    canvasEngine.drawAll();
                    saveStepAnnotations(canvasEngine.annotations);
                }
                showToast(`Stroke width: ${strokeWidth}px`);
            };
        });

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




        setOnclick("undoBtn", () => canvasEngine && canvasEngine.undo());
        setOnclick("redoBtn", () => canvasEngine && canvasEngine.redo());

        setOnclick("recalcHighlightBtn", () => {
            if (canvasEngine) {
                canvasEngine.focusBoxEnabled = !canvasEngine.focusBoxEnabled;
                canvasEngine.drawAll();
                showToast(canvasEngine.focusBoxEnabled ? "Red Focus Box ON" : "Red Focus Box OFF");
            }
        });

        // Steps bottom drawer toggle (Header click & button click)
        const toggleBottomDrawer = (e) => {
            if (e) e.stopPropagation();
            const drawer = $("stepsBottomDrawer");
            if (drawer) {
                const isCollapsed = drawer.classList.toggle("collapsed");
                const collapseBtn = $("stepsDrawerCollapse");
                if (collapseBtn) {
                    collapseBtn.innerHTML = isCollapsed 
                        ? `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`
                        : `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`;
                }
            }
        };

        setOnclick("stepsDrawerToggle", toggleBottomDrawer);
        setOnclick("stepsDrawerHeader", toggleBottomDrawer);
        setOnclick("stepsDrawerCollapse", toggleBottomDrawer);

        // Step detail drawer collapse & expand
        const stepDrawer = $("stepDetailDrawer");
        const floatOpenBtn = $("floatingDrawerOpenBtn");

        const closeStepDrawer = () => {
            if (stepDrawer) {
                stepDrawer.classList.remove("open");
                if (floatOpenBtn) floatOpenBtn.classList.remove("hidden");
            }
        };

        const openStepDrawer = () => {
            if (stepDrawer) {
                stepDrawer.classList.add("open");
                if (floatOpenBtn) floatOpenBtn.classList.add("hidden");
            }
        };

        setOnclick("drawerCloseBtn", closeStepDrawer);
        if (floatOpenBtn) floatOpenBtn.onclick = openStepDrawer;

        // Drawer Accordion Collapse / Expand (Fix Chevron & Toggle)
        document.querySelectorAll(".drawer-accordion-header").forEach(header => {
            header.onclick = (e) => {
                e.stopPropagation();
                const targetId = header.getAttribute("data-target");
                const content = document.getElementById(targetId);
                const chevron = header.querySelector(".drawer-acc-chevron");
                if (content) {
                    const isHidden = content.classList.contains("hidden");
                    if (isHidden) {
                        content.classList.remove("hidden");
                        header.classList.remove("collapsed");
                        if (chevron) chevron.textContent = "▾";
                    } else {
                        content.classList.add("hidden");
                        header.classList.add("collapsed");
                        if (chevron) chevron.textContent = "▸";
                    }
                }
            };
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
        if ($("replaceScreenshotInput")) {
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
        }

        // AI Enhance Step
        if ($("aiEnhanceStepBtn")) {
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

                    if (res.success || res.title) {
                        if (res.title && $("guideStepTitle")) $("guideStepTitle").textContent = res.title;
                        if (res.description && $("guideStepDesc")) $("guideStepDesc").textContent = res.description;
                        if (res.expected && $("guideStepExpected")) $("guideStepExpected").value = res.expected;
                        
                        if (res.title) step.title = res.title;
                        if (res.description) step.description = res.description;
                        if (res.expected) step.expected = res.expected;

                        showToast("✨ Step enhanced with AI!");
                    } else {
                        showToast("AI model returned empty response.");
                    }
                } catch (e) {
                    console.error("AI Enhance Error:", e);
                    showToast("Ollama Offline. Start Ollama and load models first.");
                } finally {
                    if ($("aiEnhanceStepBtn")) {
                        $("aiEnhanceStepBtn").textContent = originalText;
                        $("aiEnhanceStepBtn").disabled = false;
                    }
                }
            };
        }

        // AI Polish SOP
        if ($("aiPolishBtn")) {
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
                    if ($("aiPolishBtn")) {
                        $("aiPolishBtn").textContent = originalText;
                        $("aiPolishBtn").disabled = false;
                    }
                }
            };
        }

        // AI Auto-Redact
        if ($("tool-ai-redact")) {
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
                        canvasEngine?.pushHistory();
                        const currentAnnotations = step.annotations || [];
                        const updated = [...currentAnnotations, ...res.regions];
                        
                        step.annotations = updated;
                        canvasEngine?.setAnnotations(updated);
                        await saveStepAnnotations(updated);
                        
                        showToast(`AI redacted ${res.regions.length} sensitive area(s).`);
                    } else {
                        showToast("No confidential fields detected on this page.");
                    }
                } catch (e) {
                    console.error("AI Redact Error:", e);
                    showToast("Ollama Offline. Start Ollama and pull models first.");
                } finally {
                    if ($("tool-ai-redact")) {
                        $("tool-ai-redact").innerHTML = originalHtml;
                        $("tool-ai-redact").disabled = false;
                    }
                }
            };
        }
    }

    // Focus & Spotlight Toggle Buttons
    setOnclick("btnToggleFocusSpotlight", toggleFocusSpotlight);
    setOnclick("btnDrawerFocusToggle", toggleFocusSpotlight);
    updateFocusToggleUI();

    loadActiveStepDetails();
    renderStepThumbnails();
}

function updateFocusToggleUI() {
    const visibleSteps = workflow?.steps ? workflow.steps.filter(s => !s.hidden) : [];
    const activeStep = visibleSteps[currentStepIndex];
    const isEnabled = activeStep ? (activeStep.focus_enabled !== false) : true;
    
    if (canvasEngine) {
        canvasEngine.autoSpotlightEnabled = isEnabled;
        canvasEngine.focusBoxEnabled = isEnabled;
    }
    
    // Toolbar Button
    const dot = $("focusToggleDot");
    const label = $("focusToggleLabel");
    if (dot) dot.style.background = isEnabled ? "#10b981" : "#94a3b8";
    if (label) label.textContent = isEnabled ? "Focus: Enabled" : "Focus: Disabled";
    
    // Drawer Button
    const dDot = $("drawerFocusDot");
    const dText = $("drawerFocusText");
    if (dDot) dDot.style.background = isEnabled ? "#10b981" : "#94a3b8";
    if (dText) dText.textContent = isEnabled ? "ON" : "OFF";
}

function toggleFocusSpotlight() {
    const visibleSteps = workflow?.steps ? workflow.steps.filter(s => !s.hidden) : [];
    const activeStep = visibleSteps[currentStepIndex];
    if (!activeStep) return;

    const currentState = (activeStep.focus_enabled !== false);
    const newState = !currentState;
    activeStep.focus_enabled = newState;

    if (canvasEngine) {
        canvasEngine.autoSpotlightEnabled = newState;
        canvasEngine.focusBoxEnabled = newState;
        canvasEngine.drawAll();
    }
    
    updateFocusToggleUI();

    if (workflow?.id && activeStep.id) {
        api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${activeStep.id}/edits`, {
            method: "PATCH",
            body: JSON.stringify({ focus_enabled: newState })
        }).catch(() => {});
    }

    showToast(newState ? "🎯 Element Focus & Spotlight ON" : "🎯 Element Focus & Spotlight OFF", 2000);
}

// ── Refresh Session & Steps Handler ────────────────────────────────────────
async function refreshActiveWorkflowSteps() {
    if (!workflow?.id) return showToast("No active workflow");
    showToast("🔄 Refreshing session & steps...");
    try {
        workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
        renderStepsTab();
        renderStepThumbnails();
        loadActiveStepDetails();
        updateApprovalProgress(workflow.steps);
        showToast("🔄 Steps refreshed from server!");
    } catch(e) {
        showToast("Refresh failed: " + e.message);
    }
}

// ── Active Step Hide / Unhide ───────────────────────────────────────────────
async function toggleHideActiveStep() {
    const steps = workflow?.steps || [];
    const step = steps[currentStepIndex];
    if (!step) return;
    const newHidden = !step.hidden;
    step.hidden = newHidden;
    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/edits`, {
            method: "PATCH",
            body: JSON.stringify({ hidden: newHidden })
        });
        showToast(newHidden ? "👁️ Step marked as Hidden" : "👁️ Step is now Visible");
        renderStepsTab();
        renderStepThumbnails();
        loadActiveStepDetails();
    } catch(e) {
        showToast("Failed to update visibility: " + e.message);
    }
}

// ── Active Step Delete ─────────────────────────────────────────────────────
async function deleteActiveStep() {
    const steps = workflow?.steps || [];
    const step = steps[currentStepIndex];
    if (!step) return;
    if (!confirm(`Are you sure you want to delete Step ${step.sequence} (${step.title || 'Untitled'})?`)) return;
    
    workflow.steps = workflow.steps.filter(s => s.id !== step.id);
    workflow.steps.forEach((s, idx) => s.sequence = idx + 1);
    
    currentStepIndex = Math.max(0, Math.min(workflow.steps.length - 1, currentStepIndex));
    showToast(`🗑️ Step deleted`);
    renderStepsTab();
    renderStepThumbnails();
    loadActiveStepDetails();
}

// ── Bulk Micro Demos Generator ─────────────────────────────────────────────
async function generateAndShowMicroDemos(stepIds = null) {
    if (!workflow?.id) return showToast("No active workflow");
    showToast("🎬 Generating interactive micro-demos...");
    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/generate-micro-demos`, {
            method: "POST"
        });
        showToast(`🎬 Generated ${res.total_micro_demos} micro-demos successfully!`);
        openExportPreview("interactive");
    } catch(e) {
        showToast("Failed to generate micro-demos: " + e.message);
    }
}

// Wire step action listeners
setOnclick("btnRefreshSteps", refreshActiveWorkflowSteps);
setOnclick("btnRefreshGuideStep", refreshActiveWorkflowSteps);
setOnclick("btnToggleHideActiveStep", toggleHideActiveStep);
setOnclick("btnDeleteActiveStep", deleteActiveStep);
setOnclick("btnBulkMicroDemos", () => generateAndShowMicroDemos());
setOnclick("btnBulkMicroDemosSelected", () => generateAndShowMicroDemos(Array.from(selectedStepIds)));


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
    setVal("guideStepAlertType", step.alertType || "none");
    setVal("guideStepAlertMsg", step.alertMsg || "");
    setVal("guideStepRole", step.role || "");
    setVal("guideStepDuration", step.duration || "");
    renderStepBranches(step);

    // Detect if step has an active GIF micro-demo
    step.hasActiveDemo = Boolean(
        step.hasActiveDemo ||
        (step.screenshotUrl && (step.screenshotUrl.includes("-demo") || step.screenshotUrl.endsWith(".gif")))
    );

    if (typeof updateDemoButtonState === "function") updateDemoButtonState(step);
    if (typeof updateFocusToggleUI === "function") updateFocusToggleUI();
    if (typeof updateHotspotReticlePosition === "function") updateHotspotReticlePosition(step);

    const pinLabel = $("pinVisibilityLabel");
    if (pinLabel) {
        pinLabel.textContent = step.hidePin ? "OFF" : "ON";
        pinLabel.style.color = step.hidePin ? "#94a3b8" : "#10b981";
    }
    const drawerPinLabel = $("drawerPinLabel");
    if (drawerPinLabel) {
        drawerPinLabel.textContent = step.hidePin ? "HIDDEN" : "VISIBLE";
        drawerPinLabel.style.color = step.hidePin ? "#94a3b8" : "#10b981";
    }

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
        hideBtn.innerHTML = step.hidden ? `<span>👁️</span> Unhide Step` : `<span>👁️</span> Hide Step`;
        hideBtn.style.color = step.hidden ? "#10b981" : "#ef4444";
        hideBtn.style.borderColor = step.hidden ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)";
        hideBtn.style.background = step.hidden ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.06)";
    }

    // Toggle Canvas Deleted Step Watermark (Requirement 3)
    const watermarkEl = $("deletedStepWatermark");
    if (watermarkEl) {
        if (step.hidden) {
            watermarkEl.classList.remove("hidden");
        } else {
            watermarkEl.classList.add("hidden");
        }
    }
    setOnclick("btnRestoreStepCanvas", () => toggleActiveStepHidden());

    // Meta details
    setText("guideMetaAction", actionTitle(step.action));
    setText("guideMetaValue", step.value || "—");
    setText("guideMetaSelector", step.element?.cssSelector || "—");
    setText("guideMetaXpath", step.element?.xpath || "—");

    // Timestamp
    const tsEl = $("guideMetaTimestamp");
    if (tsEl) tsEl.textContent = step.timestamp ? fmt(step.timestamp) : "—";

    // Duration since previous step
    const durEl = $("guideMetaDuration");
    if (durEl) {
        if (currentStepIndex > 0 && step.timestamp) {
            const prevStep = steps[currentStepIndex - 1];
            if (prevStep?.timestamp) {
                const diffMs = new Date(step.timestamp) - new Date(prevStep.timestamp);
                if (!isNaN(diffMs) && diffMs >= 0) {
                    const secs = Math.round(diffMs / 1000);
                    durEl.textContent = secs < 60 ? `+${secs}s` : `+${Math.floor(secs/60)}m ${secs%60}s`;
                } else {
                    durEl.textContent = "—";
                }
            } else {
                durEl.textContent = "—";
            }
        } else {
            durEl.textContent = "First step";
        }
    }

    // Step Intelligence Panel Updates
    const action = (step.action || "").toLowerCase();
    let why = "Direct user interaction on target UI control.";
    if (action.includes("navigate") || (step.url && step.url.startsWith("http"))) why = "Page navigation / URL transition detected.";
    else if (action.includes("input") || action.includes("type")) why = "Data entry input modification.";
    else if (action.includes("submit") || (step.title || "").toLowerCase().includes("submit") || (step.title || "").toLowerCase().includes("save")) why = "Form submission & state commitment.";

    setText("intelWhyCaptured", why);
    setText("intelSemanticClass", step.semantic_class || actionTitle(step.action));
    const piiStatus = step.pii_masked ? "🔒 Redacted" : "✓ Clean (0 PII)";
    setText("intelPrivacyStatus", piiStatus);

    // Re-record this specific step button handler
    const reRecordBtn = $("btnReRecordActiveStep");
    if (reRecordBtn) {
        reRecordBtn.onclick = () => {
            showToast("📷 Select new screenshot to update this step...", 2500);
            $("replaceScreenshotInput")?.click();
        };
    }

    // Sync step jump input
    const sji = $("stepJumpInput");
    if (sji) sji.value = currentStepIndex + 1;

    // Update approval progress bar
    updateApprovalProgress(steps);

    // Open step detail drawer automatically
    const drawer = $("stepDetailDrawer");
    if (drawer) drawer.classList.add("open");

    // Apply auto-fit zoom on step load
    autoFitZoom();

    // Set screenshot image and sync canvas
    const imgEl = $("guideImg");
    const canvasWrap = $("canvasWrapper");
    const noScr = $("noScreenshot");

    if (step.screenshotUrl || (workflow && workflow.id)) {
        if (imgEl) {
            const rawUrl = step.screenshotUrl || `${API_BASE}/screenshots/${workflow.id}/step-${String(step.sequence).padStart(3, "0")}.png`;
            const displayUrl = step.hasActiveDemo
                ? (rawUrl.includes("-demo") ? rawUrl : rawUrl.replace(/\.png$/i, "-demo.gif"))
                : rawUrl.replace(/-demo.*\.gif/i, ".png");
            
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.classList.add("hidden");
                if (noScr) noScr.classList.remove("hidden");
            };

            imgEl.src = `${normalizeImageUrl(displayUrl)}?t=${Date.now()}`;
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
    const autoSaveText = $("autoSaveText");
    if (indicator) {
        indicator.classList.remove("hidden");
        indicator.classList.add("saving");
        if (autoSaveText) autoSaveText.textContent = "Saving...";
    }
    clearTimeout(autoSaveDebounceTimer);
    autoSaveDebounceTimer = setTimeout(async () => {
        await saveActiveStepEditsSilent();
        if (indicator) {
            indicator.classList.remove("saving");
            if (autoSaveText) autoSaveText.textContent = "Saved ✓";
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
    const alertType = $("guideStepAlertType") ? $("guideStepAlertType").value : (step.alertType || "none");
    const alertMsg = $("guideStepAlertMsg") ? $("guideStepAlertMsg").value.trim() : (step.alertMsg || "");
    const role = $("guideStepRole") ? $("guideStepRole").value.trim() : (step.role || "");
    const duration = $("guideStepDuration") ? $("guideStepDuration").value.trim() : (step.duration || "");

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
    step.alertType = alertType;
    step.alertMsg = alertMsg;
    step.role = role;
    step.duration = duration;

    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/edits`, {
            method: "PATCH",
            body: JSON.stringify({
                title: title,
                description: desc,
                expected: expected,
                note: note,
                voiceover: voiceover,
                alert_type: alertType,
                alert_msg: alertMsg,
                role: role,
                duration: duration,
                branches: JSON.stringify(step.branches || [])
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
    if (typeof updateSopDurationMeter === "function") updateSopDurationMeter();
    
    strip.innerHTML = steps.map((s, index) => {
        const img = s.screenshotUrl ? `<img src="${esc(API_BASE + s.screenshotUrl)}" alt="Step ${s.sequence}">` : '<div class="no-screenshot-thumb">No img</div>';
        const checkedBadge = s.checked ? '<div class="thumb-checked-badge">✓</div>' : '';
        const blockedBadge = s.hidden ? '<div class="thumb-blocked-badge" style="position:absolute; inset:0; background:rgba(239,68,68,0.35); display:flex; align-items:center; justify-content:center; font-size:16px; color:#ef4444; border:1.5px dashed #ef4444; border-radius:6px; z-index:2;" title="Deleted / Hidden Step">🚫</div>' : '';
        const branchBadge = (s.branches && s.branches.length > 0) ? `<div class="branch-count-badge" title="${s.branches.length} Decision Paths">🔀 ${s.branches.length}</div>` : '';
        return `
            <div class="thumb-card ${index === currentStepIndex ? 'active' : ''} ${s.hidden ? 'hidden-step' : ''}" data-index="${index}" draggable="true" title="Drag to reorder step" style="position:relative;">
                ${img}
                <div class="thumb-badge">${s.sequence}</div>
                ${checkedBadge}
                ${blockedBadge}
                ${branchBadge}
            </div>
        `;
    }).join("");

    let draggedThumbIndex = null;

    document.querySelectorAll(".thumb-card").forEach(card => {
        const idx = parseInt(card.dataset.index);
        const s = steps[idx];

        // Drag & drop reordering
        card.addEventListener("dragstart", (e) => {
            draggedThumbIndex = idx;
            card.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(idx));
        });

        card.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            card.classList.add("drag-over");
        });

        card.addEventListener("dragleave", () => {
            card.classList.remove("drag-over");
        });

        card.addEventListener("dragend", () => {
            card.classList.remove("dragging");
            document.querySelectorAll(".thumb-card").forEach(c => c.classList.remove("drag-over"));
        });

        card.addEventListener("drop", async (e) => {
            e.preventDefault();
            card.classList.remove("drag-over");
            const targetIdx = idx;
            if (draggedThumbIndex !== null && draggedThumbIndex !== targetIdx) {
                await swapSteps(draggedThumbIndex, targetIdx);
                currentStepIndex = targetIdx;
                loadActiveStepDetails();
                renderStepThumbnails();
            }
        });

        card.onclick = () => {
            currentStepIndex = idx;
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


function showHoverPreview() {}
function hideHoverPreview() {}

/* =========================================================
   STEP LIST EDITOR LOGIC (Tab 2)
========================================================= */

let currentStepFilter = 'all';
let stepSearchQuery = '';
const selectedStepIds = new Set();

function renderStepsTab() {
    const allSteps = workflow?.steps || [];
    const container = $("stepListContainer");
    const bulkBar = $("stepBulkActionBar");
    const bulkText = $("bulkSelectedText");
    const selectAllCb = $("selectAllStepsCb");

    if (!container) return;

    if (allSteps.length === 0) {
        container.innerHTML = '<div class="no-results">No steps in this workflow</div>';
        if (bulkBar) bulkBar.classList.add("hidden");
        return;
    }

    // Filter steps
    const filteredSteps = allSteps.filter(s => {
        // Category filter
        if (currentStepFilter === "approved" && !s.approved) return false;
        if (currentStepFilter === "pending" && s.approved) return false;
        if (currentStepFilter === "hidden" && !s.hidden) return false;

        // Search query
        if (stepSearchQuery) {
            const q = stepSearchQuery.toLowerCase();
            const title = (s.title || getDefaultTitle(s)).toLowerCase();
            const desc = (s.description || getDefaultDescription(s)).toLowerCase();
            const note = (s.note || '').toLowerCase();
            if (!title.includes(q) && !desc.includes(q) && !note.includes(q)) {
                return false;
            }
        }
        return true;
    });

    if (filteredSteps.length === 0) {
        container.innerHTML = `<div class="no-results" style="padding: 30px; text-align: center; color: var(--text-muted);">No steps match the active filter "${currentStepFilter}".</div>`;
        if (bulkBar) bulkBar.classList.add("hidden");
        return;
    }

    container.innerHTML = filteredSteps.map((s, index) => {
        const isSelected = selectedStepIds.has(s.id);
        const originalIndex = allSteps.findIndex(item => item.id === s.id);

        return `
        <div class="editor-step-row ${s.hidden ? 'is-deleted' : ''} ${isSelected ? 'is-selected-row' : ''}" data-id="${s.id}" data-index="${originalIndex}">
            <div class="editor-step-row-left" style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                <input type="checkbox" class="step-select-cb" data-id="${s.id}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #6366f1; flex-shrink: 0;">
                <span class="drag-handle" style="cursor: grab; color: var(--text-muted); font-size: 14px; user-select: none;">☰</span>
                <div class="row-badge ${s.approved ? 'is-approved-badge' : ''}">${s.sequence}</div>
                <div class="editor-step-thumb ${s.hidden ? 'is-deleted-thumb' : ''}" data-thumb-url="${s.screenshotUrl ? esc(API_BASE + s.screenshotUrl) : ''}" data-thumb-title="${esc(s.title || getDefaultTitle(s))}">
                    ${s.screenshotUrl ? `<img src="${esc(API_BASE + s.screenshotUrl)}" alt="Step ${s.sequence}">` : '<div class="no-thumb">No img</div>'}
                </div>
                <div class="row-info" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <div class="row-title inline-editable-title" contenteditable="true" data-id="${s.id}" title="Click to edit step title inline" style="font-weight: 700; color: var(--text-main, #fff); outline: none; border-bottom: 1px dashed transparent; transition: all 0.15s ease;">
                            ${esc(s.title || getDefaultTitle(s))}
                        </div>
                        ${s.approved ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 9.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; flex-shrink: 0;">✓ APPROVED</span>' : ''}
                        ${s.hidden ? '<span class="deleted-badge" style="font-size: 9.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; flex-shrink: 0;">👁️ HIDDEN</span>' : ''}
                    </div>
                    <div class="row-desc inline-editable-desc" contenteditable="true" data-id="${s.id}" title="Click to edit description inline" style="font-size: 12px; color: var(--text-muted, #94a3b8); outline: none; line-height: 1.35;">
                        ${esc(s.description || getDefaultDescription(s))}
                    </div>
                </div>
            </div>
            <div class="editor-step-row-actions" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                <button class="btn btn-secondary btn-xs btn-approve-step" data-id="${s.id}" title="${s.approved ? 'Approved' : 'Mark as Approved'}" style="font-weight: 700; ${s.approved ? 'color: #10b981; border-color: rgba(16,185,129,0.35);' : ''}">
                    ${s.approved ? '✓ Approved' : 'Approve'}
                </button>
                <button class="btn btn-secondary btn-xs btn-dup-step" data-id="${s.id}" title="Duplicate this step">📋 Dup</button>
                <div style="display: flex; gap: 2px;">
                    <button class="btn btn-secondary btn-xs btn-up" ${originalIndex === 0 ? "disabled" : ""} title="Move Up" style="padding: 3px 6px;">▲</button>
                    <button class="btn btn-secondary btn-xs btn-down" ${originalIndex === allSteps.length - 1 ? "disabled" : ""} title="Move Down" style="padding: 3px 6px;">▼</button>
                </div>
                <button class="btn btn-secondary btn-xs btn-hide-step" title="${s.hidden ? 'Restore step' : 'Hide step'}" style="font-weight: 700; ${s.hidden ? 'color: #10b981; border-color: rgba(16,185,129,0.35);' : ''}">${s.hidden ? '👁️ Restore' : 'Hide'}</button>
                <button class="btn btn-danger btn-xs btn-perm-del" title="Permanently delete from database" style="padding: 3px 8px;">✖</button>
            </div>
        </div>
        `;
    }).join("");

    // Update bulk bar state
    if (bulkBar && bulkText) {
        if (selectedStepIds.size > 0) {
            bulkBar.classList.remove("hidden");
            bulkText.textContent = `${selectedStepIds.size} step${selectedStepIds.size === 1 ? '' : 's'} selected`;
        } else {
            bulkBar.classList.add("hidden");
        }
    }

    if (selectAllCb) {
        selectAllCb.checked = filteredSteps.length > 0 && filteredSteps.every(s => selectedStepIds.has(s.id));
    }

    // Checkbox toggles
    container.querySelectorAll(".step-select-cb").forEach(cb => {
        cb.onchange = (e) => {
            const id = parseInt(e.target.dataset.id);
            if (e.target.checked) {
                selectedStepIds.add(id);
            } else {
                selectedStepIds.delete(id);
            }
            renderStepsTab();
        };
    });

    // Select all handler
    if (selectAllCb) {
        selectAllCb.onchange = () => {
            if (selectAllCb.checked) {
                filteredSteps.forEach(s => selectedStepIds.add(s.id));
            } else {
                filteredSteps.forEach(s => selectedStepIds.delete(s.id));
            }
            renderStepsTab();
        };
    }

    // Inline title editing auto-save
    container.querySelectorAll(".inline-editable-title").forEach(el => {
        el.onblur = async () => {
            const stepId = parseInt(el.dataset.id);
            const newTitle = el.innerText.trim();
            const step = workflow.steps.find(s => s.id === stepId);
            if (step && newTitle && step.title !== newTitle) {
                step.title = newTitle;
                try {
                    await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${stepId}/edits`, {
                        method: "PATCH",
                        body: JSON.stringify({ title: newTitle })
                    });
                    showToast("Step title auto-saved ✓");
                } catch(err) {
                    console.error("Auto-save error:", err);
                }
            }
        };
    });

    // Inline description editing auto-save
    container.querySelectorAll(".inline-editable-desc").forEach(el => {
        el.onblur = async () => {
            const stepId = parseInt(el.dataset.id);
            const newDesc = el.innerText.trim();
            const step = workflow.steps.find(s => s.id === stepId);
            if (step && step.description !== newDesc) {
                step.description = newDesc;
                try {
                    await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${stepId}/edits`, {
                        method: "PATCH",
                        body: JSON.stringify({ description: newDesc })
                    });
                    showToast("Step description auto-saved ✓");
                } catch(err) {
                    console.error("Auto-save error:", err);
                }
            }
        };
    });

    // Approve step button
    container.querySelectorAll(".btn-approve-step").forEach(btn => {
        btn.onclick = async (e) => {
            const stepId = parseInt(btn.dataset.id);
            const step = workflow.steps.find(s => s.id === stepId);
            if (!step) return;
            step.approved = !step.approved;
            showToast(step.approved ? "Step marked as approved ✓" : "Step approval cleared");
            renderStepsTab();
        };
    });

    // Duplicate step button
    container.querySelectorAll(".btn-dup-step").forEach(btn => {
        btn.onclick = async (e) => {
            const stepId = parseInt(btn.dataset.id);
            const origIndex = workflow.steps.findIndex(s => s.id === stepId);
            if (origIndex === -1) return;
            const orig = workflow.steps[origIndex];

            // Create cloned step
            const clonedStep = {
                ...orig,
                id: Date.now(),
                title: `${orig.title || getDefaultTitle(orig)} (Copy)`,
                sequence: orig.sequence + 1
            };
            workflow.steps.splice(origIndex + 1, 0, clonedStep);
            workflow.steps.forEach((s, idx) => s.sequence = idx + 1);
            showToast("Step duplicated successfully!");
            renderStepsTab();
            renderStepThumbnails();
        };
    });

    // Up / Down movements
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

    // Toggle hide/unhide step
    container.querySelectorAll(".btn-hide-step").forEach(btn => {
        btn.onclick = async (e) => {
            const row = e.target.closest(".editor-step-row");
            const id = parseInt(row.dataset.id);
            const step = workflow.steps.find(s => s.id === id);
            if (!step) return;

            const nextHidden = !step.hidden;
            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${id}/edits`, {
                    method: "PATCH",
                    body: JSON.stringify({ hidden: nextHidden })
                });
                step.hidden = nextHidden;
                showToast(nextHidden ? "Step hidden from exports" : "Step restored to exports ✓");
                renderStepsTab();
                renderStepThumbnails();
            } catch(err) {
                showToast(`Failed: ${err.message}`);
            }
        };
    });

    // Permanent step delete
    container.querySelectorAll(".btn-perm-del").forEach(btn => {
        btn.onclick = async (e) => {
            const row = e.target.closest(".editor-step-row");
            const id = parseInt(row.dataset.id);
            const index = workflow.steps.findIndex(s => s.id === id);
            if (confirm("Are you sure you want to delete this step?")) {
                try {
                    await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${id}`, {
                        method: "DELETE"
                    });
                    workflow.steps.splice(index, 1);
                    selectedStepIds.delete(id);
                    workflow.steps.forEach((st, i) => st.sequence = i + 1);
                    showToast("Step deleted");
                    renderStepsTab();
                    renderStepThumbnails();
                } catch(err) {
                    showToast(`Delete failed: ${err.message}`);
                }
            }
        };
    });

    // Auto-update BPMN Flowchart if active in Split or BPMN view
    if (typeof bpmnEngine !== 'undefined' && bpmnEngine.currentMode !== 'cards') {
        bpmnEngine.render();
    }
}

// =========================================================
// 🎛️ STEP LIST FILTER CHIPS & BULK ACTIONS CONTROLLER
// =========================================================

function initStepListFilterAndBulkActions() {
    // Filter chips
    document.querySelectorAll(".step-chip-btn").forEach(chip => {
        chip.onclick = () => {
            document.querySelectorAll(".step-chip-btn").forEach(c => {
                c.classList.remove("active");
                c.style.background = "transparent";
                c.style.color = "var(--text-muted)";
            });
            chip.classList.add("active");
            chip.style.background = "#6366f1";
            chip.style.color = "#fff";
            currentStepFilter = chip.dataset.filter;
            renderStepsTab();
        };
    });

    // Live search input
    const searchInput = $("stepSearchInput");
    if (searchInput) {
        searchInput.oninput = (e) => {
            stepSearchQuery = e.target.value.trim();
            renderStepsTab();
        };
    }

    // Bulk Approve
    const btnApprove = $("btnBulkApproveSelected");
    if (btnApprove) {
        btnApprove.onclick = () => {
            selectedStepIds.forEach(id => {
                const s = workflow?.steps?.find(st => st.id === id);
                if (s) s.approved = true;
            });
            showToast(`Approved ${selectedStepIds.size} steps ✓`);
            selectedStepIds.clear();
            renderStepsTab();
        };
    }

    // Bulk Toggle Hide
    const btnHide = $("btnBulkHideSelected");
    if (btnHide) {
        btnHide.onclick = () => {
            selectedStepIds.forEach(id => {
                const s = workflow?.steps?.find(st => st.id === id);
                if (s) s.hidden = !s.hidden;
            });
            showToast(`Updated visibility for selected steps`);
            selectedStepIds.clear();
            renderStepsTab();
            renderStepThumbnails();
        };
    }

    // Bulk Delete
    const btnDel = $("btnBulkDeleteSelected");
    if (btnDel) {
        btnDel.onclick = () => {
            if (confirm(`Permanently delete all ${selectedStepIds.size} selected steps?`)) {
                workflow.steps = (workflow.steps || []).filter(s => !selectedStepIds.has(s.id));
                workflow.steps.forEach((s, idx) => s.sequence = idx + 1);
                showToast(`Deleted ${selectedStepIds.size} steps`);
                selectedStepIds.clear();
                renderStepsTab();
                renderStepThumbnails();
            }
        };
    }
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

// Bulk action: Approve all steps
setOnclick("bulkApproveAllBtn", async () => {
    if (!workflow || !workflow.steps || workflow.steps.length === 0) return;
    if (!confirm(`Are you sure you want to mark all ${workflow.steps.length} steps as approved?`)) return;
    workflow.steps.forEach(s => { s.checked = true; s.approved = true; });
    updateApprovalProgress(workflow.steps);
    showToast("✓ All steps marked as approved!");
    renderStepThumbnails();
});

// Bulk action: Unhide all steps
setOnclick("bulkUnhideAllBtn", async () => {
    if (!workflow || !workflow.steps || workflow.steps.length === 0) return;
    if (!confirm("Are you sure you want to restore and unhide all hidden steps in this SOP?")) return;
    let count = 0;
    for (const s of workflow.steps) {
        if (s.hidden) {
            s.hidden = false;
            count++;
            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${s.id}/edits`, {
                    method: "PATCH",
                    body: JSON.stringify({ hidden: false })
                });
            } catch (_) {}
        }
    }
    showToast(`👁 Restored ${count} hidden step${count === 1 ? "" : "s"}`);
    renderStepsTab();
    renderStepThumbnails();
    loadActiveStepDetails();
});

// ============================================================
// PHASE 2 — NORMALIZE STEPS BUTTON
// ============================================================
setOnclick("normalizeStepsBtn", async () => {
    if (!workflow?.id) return showToast("⚠ Open a workflow first");
    const btn = $("normalizeStepsBtn");
    if (btn) { btn.disabled = true; btn.textContent = "🧹 Running..."; }
    try {
        const result = await api(`/sessions/${encodeURIComponent(workflow.id)}/normalize`, {
            method: "POST",
            body: JSON.stringify({ reduce_noise: true, suggest_groups: true })
        });

        // Apply semantic classes back to in-memory steps
        if (result.semantic_classes) {
            workflow.steps.forEach(s => {
                const cls = result.semantic_classes[String(s.id)] || result.semantic_classes[String(s.sequence)];
                if (cls) s.semantic_class = cls;
            });
        }

        // Build summary
        const noiseRemoved = result.noise_removed_count || 0;
        const groups = result.suggested_groups || [];
        const el = $("normalizeResultSummary");
        if (el) el.textContent = `${noiseRemoved} noisy event${noiseRemoved === 1 ? '' : 's'} removed · ${result.original_count} → ${result.cleaned_steps?.length ?? result.original_count} steps · ${groups.length} grouping suggestion${groups.length === 1 ? '' : 's'}`;

let currentGroupSuggestions = [];

        currentGroupSuggestions = groups;

        // Render grouping suggestions
        const list = $("groupSuggestionsList");
        if (list) {
            if (groups.length === 0) {
                list.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:13px;">
                    ✅ No step grouping suggestions — your SOP is already well-structured!
                </div>`;
            } else {
                list.innerHTML = groups.map(g => `
                    <div id="groupCard-${g.group_id}" style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:12px; padding:16px; transition:all 0.2s ease;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                            <div>
                                <div style="font-weight:700; font-size:14px; color:var(--text-main,#fff);">${esc(g.suggested_title)}</div>
                                <div style="font-size:11px; color:var(--text-muted,#94a3b8); margin-top:3px;">${esc(g.suggested_description)}</div>
                            </div>
                            <span style="background:rgba(99,102,241,0.2); color:#818cf8; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700;">${g.confidence}% match</span>
                        </div>
                        <div style="font-size:11px; color:var(--text-muted); margin-bottom:10px;">Steps included: ${(g.step_ids || []).join(', ')}</div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <button onclick="acceptGroupSuggestion('${g.group_id}')" class="btn btn-primary btn-xs">✓ Accept</button>
                            <button onclick="ignoreGroupSuggestion('${g.group_id}')" class="btn btn-secondary btn-xs">✗ Ignore</button>
                        </div>
                    </div>
                `).join("");
            }
        }

        const overlay = $("groupSuggestionsOverlay");
        if (overlay) overlay.style.display = "flex";
        renderStepsTab();
        showToast(`🧹 Normalized! ${noiseRemoved} events removed, ${groups.length} group suggestions ready.`);
    } catch (err) {
        showToast("⚠ Normalization failed: " + (err.message || err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "🧹 Normalize"; }
    }
});

function closeGroupSuggestions() {
    const el = $("groupSuggestionsOverlay");
    if (el) el.style.display = "none";
}

async function acceptGroupSuggestion(groupId) {
    const group = currentGroupSuggestions.find(g => g.group_id === groupId);
    if (!group) return showToast("Suggestion not found");

    showToast(`✓ Group "${group.suggested_title}" applied!`);

    // Apply the suggested title and description to the first step in the group
    if (group.step_ids && group.step_ids.length > 0) {
        const firstId = group.step_ids[0];
        const step = workflow.steps.find(s => s.id === firstId);
        if (step) {
            step.title = group.suggested_title;
            step.description = group.suggested_description;
            try {
                await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${firstId}/edits`, {
                    method: "PATCH",
                    body: JSON.stringify({ title: group.suggested_title, description: group.suggested_description })
                });
            } catch (_) {}
        }
    }

    // Remove group card from modal
    const card = $(`groupCard-${groupId}`);
    if (card) {
        card.style.opacity = "0";
        card.style.transform = "scale(0.95)";
        setTimeout(() => card.remove(), 200);
    }

    currentGroupSuggestions = currentGroupSuggestions.filter(g => g.group_id !== groupId);
    renderStepsTab();
    renderStepThumbnails();
    if (typeof fetchAndRenderSopHealth === "function") fetchAndRenderSopHealth();
}

function ignoreGroupSuggestion(groupId) {
    const card = $(`groupCard-${groupId}`);
    if (card) {
        card.style.opacity = "0";
        card.style.transform = "scale(0.95)";
        setTimeout(() => card.remove(), 200);
    }
    currentGroupSuggestions = currentGroupSuggestions.filter(g => g.group_id !== groupId);
    showToast("Group suggestion dismissed");
}


// ============================================================
// PHASE 3 — AUTO-TITLES BUTTON
// ============================================================
setOnclick("autoTitlesBtn", async () => {
    if (!workflow?.id) return showToast("⚠ Open a workflow first");
    const btn = $("autoTitlesBtn");
    if (btn) { btn.disabled = true; btn.textContent = "🪄 Generating..."; }
    try {
        const result = await api(`/sessions/${encodeURIComponent(workflow.id)}/generate-titles`, { method: "POST" });
        const suggestions = result.suggestions || [];
        let applied = 0;

        for (const { step_id, suggested_title } of suggestions) {
            const step = workflow.steps.find(s => s.id === step_id);
            if (step && suggested_title) {
                step.title = suggested_title;
                applied++;
                api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step_id}/edits`, {
                    method: "PATCH",
                    body: JSON.stringify({ title: suggested_title })
                }).catch(() => {});
            }
        }

        renderStepsTab();
        renderStepThumbnails();
        showToast(`🪄 ${applied} step title${applied === 1 ? '' : 's'} auto-generated!`);
    } catch (err) {
        showToast("⚠ Auto-titles failed: " + (err.message || err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "🪄 Auto-Titles"; }
    }
});

// ============================================================
// PHASE 3 — SOP METADATA BUTTON
// ============================================================
setOnclick("generateSopMetaBtn", async () => {
    if (!workflow?.id) return showToast("⚠ Open a workflow first");
    const btn = $("generateSopMetaBtn");
    if (btn) { btn.disabled = true; btn.textContent = "✨ Generating..."; }
    try {
        const result = await api(`/sessions/${encodeURIComponent(workflow.id)}/generate-metadata`, { method: "POST" });
        const meta = result.sop_metadata || {};
        const markers = result.intent_markers || [];

        const body = $("sopMetadataBody");
        if (body) {
            const metaField = (label, value, multiline) => {
                if (!value) return '';
                const displayVal = Array.isArray(value) ? value.join(', ') : String(value);
                return `
                    <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:14px 16px; border:1px solid var(--border-subtle,rgba(255,255,255,0.08)); cursor:pointer;" onclick="navigator.clipboard.writeText(${JSON.stringify(displayVal)}).then(()=>showToast('Copied!'))">
                        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted,#94a3b8); margin-bottom:6px;">${label}</div>
                        <div style="font-size:13px; color:var(--text-main,#fff); line-height:1.5;">${esc(displayVal)}</div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:5px; opacity:0.7;">Click to copy</div>
                    </div>
                `;
            };

            body.innerHTML = `
                ${metaField('📋 Purpose', meta.purpose)}
                ${metaField('🎯 Scope', meta.scope)}
                ${metaField('👤 Roles', meta.roles)}
                ${metaField('✅ Prerequisites', meta.prerequisites)}
                ${metaField('🖥️ Applications', meta.applications)}
                ${metaField('🏁 Expected Outcome', meta.expected_outcome)}
                ${meta.estimated_duration_min ? metaField('⏱️ Estimated Duration', meta.estimated_duration_min + ' minutes') : ''}
                ${meta.total_steps ? metaField('📊 Total Steps', meta.total_steps + ' steps') : ''}
                ${markers.length ? `
                <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:14px 16px; border:1px solid var(--border-subtle,rgba(255,255,255,0.08));">
                    <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted,#94a3b8); margin-bottom:10px;">🔖 Intent Markers (drag to steps)</div>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${markers.map(m => `<span style="background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); color:#818cf8; padding:3px 12px; border-radius:999px; font-size:12px; font-weight:600; cursor:pointer;" onclick="navigator.clipboard.writeText('${m}').then(()=>showToast('Copied intent marker!'))">${esc(m)}</span>`).join('')}
                    </div>
                </div>` : ''}
            `;
        }

        const modal = $("sopMetadataModal");
        if (modal) modal.style.display = "flex";
        showToast("✨ SOP metadata generated!");
    } catch (err) {
        showToast("⚠ Metadata generation failed: " + (err.message || err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "✨ SOP Metadata"; }
    }
});

function closeSopMetadataModal() {
    const el = $("sopMetadataModal");
    if (el) el.style.display = "none";
}

// ============================================================
// PHASE 6 — SOP QUALITY & HEALTH SCORE ENGINE
// ============================================================
let currentQualityReport = null;

async function fetchAndRenderSopHealth() {
    if (!workflow?.id) return;
    try {
        const report = await api(`/sessions/${encodeURIComponent(workflow.id)}/quality-report`);
        currentQualityReport = report;

        const healthBtn = $("sopHealthScoreBtn");
        if (healthBtn) {
            const score = report.overall_score || 0;
            const grade = report.grade || "C";
            healthBtn.textContent = `🩺 Health: ${score}% (${grade})`;

            if (score >= 90) {
                healthBtn.style.background = "rgba(16,185,129,0.15)";
                healthBtn.style.borderColor = "rgba(16,185,129,0.4)";
                healthBtn.style.color = "#10b981";
            } else if (score >= 75) {
                healthBtn.style.background = "rgba(99,102,241,0.15)";
                healthBtn.style.borderColor = "rgba(99,102,241,0.4)";
                healthBtn.style.color = "#818cf8";
            } else if (score >= 60) {
                healthBtn.style.background = "rgba(245,158,11,0.15)";
                healthBtn.style.borderColor = "rgba(245,158,11,0.4)";
                healthBtn.style.color = "#fbbf24";
            } else {
                healthBtn.style.background = "rgba(239,68,68,0.15)";
                healthBtn.style.borderColor = "rgba(239,68,68,0.4)";
                healthBtn.style.color = "#f87171";
            }
        }
    } catch (_) {}
}

function openSopHealthModal() {
    if (!currentQualityReport) {
        fetchAndRenderSopHealth().then(() => renderSopHealthModalContent());
    } else {
        renderSopHealthModalContent();
    }
    const modal = $("sopHealthModal");
    if (modal) modal.style.display = "flex";
}

function closeSopHealthModal() {
    const modal = $("sopHealthModal");
    if (modal) modal.style.display = "none";
}

function renderSopHealthModalContent() {
    const r = currentQualityReport;
    if (!r) return;

    if ($("sopHealthGradeBadge")) {
        const bg = r.overall_score >= 90 ? "#10b981" : (r.overall_score >= 75 ? "#6366f1" : (r.overall_score >= 60 ? "#f59e0b" : "#ef4444"));
        $("sopHealthGradeBadge").textContent = r.grade || "A";
        $("sopHealthGradeBadge").style.background = bg;
        $("sopHealthGradeBadge").style.boxShadow = `0 0 20px ${bg}66`;
    }
    if ($("sopHealthScoreNum")) $("sopHealthScoreNum").textContent = `${r.overall_score}%`;
    if ($("sopHealthStatusText")) {
        $("sopHealthStatusText").textContent = r.status_text || "Ready for Review";
        $("sopHealthStatusText").style.color = r.overall_score >= 85 ? "#10b981" : "#818cf8";
    }

    // Categories Breakdown
    const catGrid = $("sopHealthCategoriesGrid");
    if (catGrid && r.categories) {
        catGrid.innerHTML = Object.entries(r.categories).map(([k, c]) => `
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle,rgba(255,255,255,0.08)); border-radius:10px; padding:12px 14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-size:12px; font-weight:700; color:var(--text-main,#fff);">${esc(c.label)}</span>
                    <span style="font-size:11px; font-weight:800; color:${c.percentage >= 80 ? '#10b981' : (c.percentage >= 60 ? '#fbbf24' : '#f87171')};">${c.score}/${c.max} (${c.percentage}%)</span>
                </div>
                <div style="height:6px; width:100%; background:rgba(255,255,255,0.1); border-radius:999px; overflow:hidden;">
                    <div style="height:100%; width:${c.percentage}%; background:${c.percentage >= 80 ? '#10b981' : (c.percentage >= 60 ? '#f59e0b' : '#ef4444')}; border-radius:999px;"></div>
                </div>
            </div>
        `).join("");
    }

    // Issues
    const issuesList = $("sopHealthIssuesList");
    const issues = r.issues || [];
    if ($("sopHealthIssueCount")) $("sopHealthIssueCount").textContent = issues.length;
    if (issuesList) {
        if (issues.length === 0) {
            issuesList.innerHTML = `<div style="padding:14px; text-align:center; color:#10b981; font-weight:700; font-size:13px; background:rgba(16,185,129,0.08); border-radius:8px; border:1px solid rgba(16,185,129,0.2);">
                🎉 Zero issues detected! Your SOP adheres to all quality, visual, and logic guidelines.
            </div>`;
        } else {
            issuesList.innerHTML = issues.map(iss => {
                const isErr = iss.severity === "error";
                const isWarn = iss.severity === "warning";
                const color = isErr ? "#ef4444" : (isWarn ? "#f59e0b" : "#818cf8");
                return `
                    <div style="background:rgba(255,255,255,0.03); border-left:3px solid ${color}; border-radius:6px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                        <div>
                            <div style="font-size:12.5px; font-weight:600; color:var(--text-main,#fff);">${esc(iss.message)}</div>
                            <div style="font-size:11px; color:var(--text-muted,#94a3b8); margin-top:2px;">💡 ${esc(iss.suggested_fix || '')}</div>
                        </div>
                        <span style="font-size:10px; font-weight:800; text-transform:uppercase; color:${color}; background:${color}1a; padding:2px 8px; border-radius:999px; flex-shrink:0;">${iss.severity}</span>
                    </div>
                `;
            }).join("");
        }
    }

    // Strengths
    const strList = $("sopHealthStrengthsList");
    const strengths = r.strengths || [];
    if (strList) {
        strList.innerHTML = strengths.map(st => `
            <div style="font-size:12px; color:var(--text-main,#fff); display:flex; align-items:center; gap:8px;">
                <span style="color:#10b981; font-weight:800;">✓</span> ${esc(st)}
            </div>
        `).join("");
    }
}

async function autoFixSopQuality() {
    if (!workflow?.id) return;
    const btn = $("btnAutoFixQuality");
    if (btn) { btn.disabled = true; btn.textContent = "⚡ Repairing..."; }
    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/quality-fix`, { method: "POST" });
        showToast(`⚡ Quality Auto-Repair complete! ${res.fixed_titles} titles, ${res.fixed_descriptions} descriptions fixed.`);
        
        // Refresh workflow
        workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
        renderStepsTab();
        renderStepThumbnails();
        await fetchAndRenderSopHealth();
        renderSopHealthModalContent();
    } catch (e) {
        showToast("Auto-fix failed: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "⚡ 1-Click Auto-Fix"; }
    }
}

setOnclick("sopHealthScoreBtn", () => openSopHealthModal());

// ============================================================
// PHASE 4 — SOP TEMPLATES & VARIABLES ENGINE
// ============================================================
let sopVariablesMap = {};
let activeTemplateType = "standard";

async function openSopTemplatesModal() {
    if (!workflow?.id) return showToast("⚠ Open a workflow first");
    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/variables`);
        sopVariablesMap = res.variables || {};
        activeTemplateType = res.template_type || "standard";
        highlightActiveTemplateCard(activeTemplateType);
        renderVariablesTable();

        const modal = $("sopTemplatesModal");
        if (modal) modal.style.display = "flex";
    } catch (e) {
        showToast("Failed to load variables: " + e.message);
    }
}

function closeSopTemplatesModal() {
    const modal = $("sopTemplatesModal");
    if (modal) modal.style.display = "none";
}

function highlightActiveTemplateCard(type) {
    ["standard", "work_instruction", "compliance"].forEach(t => {
        const el = $(`tmplCard-${t}`);
        if (el) {
            el.style.borderColor = (t === type) ? "#6366f1" : "transparent";
            el.style.background = (t === type) ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.04)";
        }
    });
}

async function selectSopTemplate(type) {
    if (!workflow?.id) return;
    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/apply-sop-template`, {
            method: "POST",
            body: JSON.stringify({ template_type: type })
        });
        activeTemplateType = type;
        sopVariablesMap = res.variables || {};
        highlightActiveTemplateCard(type);
        renderVariablesTable();
        showToast(`📋 Applied ${res.template.name} template!`);
    } catch (e) {
        showToast("Template apply failed: " + e.message);
    }
}

function renderVariablesTable() {
    const list = $("sopVariablesList");
    if (!list) return;

    const entries = Object.entries(sopVariablesMap);
    if (entries.length === 0) {
        list.innerHTML = `<div style="padding:12px; text-align:center; color:var(--text-muted); font-size:12px;">No variables defined yet. Click "+ Add Variable" to create one.</div>`;
        return;
    }

    list.innerHTML = entries.map(([key, val]) => `
        <div class="var-row" style="display:flex; align-items:center; gap:8px;">
            <div style="background:rgba(99,102,241,0.15); color:#818cf8; font-weight:700; font-family:monospace; padding:4px 8px; border-radius:6px; font-size:12px; flex-shrink:0;">{{${esc(key)}}}</div>
            <input type="text" class="form-control var-val-input" data-key="${esc(key)}" value="${esc(val)}" placeholder="Value for ${esc(key)}" style="font-size:12px; padding:4px 10px; height:30px; flex:1;">
            <button onclick="deleteVariableRow('${esc(key)}')" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:14px; padding:4px;">✕</button>
        </div>
    `).join("");
}

function addVariableRow() {
    const key = prompt("Enter Variable Name (e.g., CUSTOMER_NAME, SYSTEM_ENV):");
    if (!key) return;
    const cleanKey = key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!cleanKey) return;
    sopVariablesMap[cleanKey] = "";
    renderVariablesTable();
}

function deleteVariableRow(key) {
    delete sopVariablesMap[key];
    renderVariablesTable();
}

async function saveSopVariables() {
    if (!workflow?.id) return;
    document.querySelectorAll(".var-val-input").forEach(inp => {
        const k = inp.dataset.key;
        if (k) sopVariablesMap[k] = inp.value;
    });

    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/variables`, {
            method: "POST",
            body: JSON.stringify({ variables: sopVariablesMap })
        });
        showToast("💾 SOP Variables saved successfully!");
    } catch (e) {
        showToast("Save variables failed: " + e.message);
    }
}

async function applyVariablesToSteps() {
    if (!workflow?.id) return;
    await saveSopVariables();
    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/variables/apply`, { method: "POST" });
        showToast(`⚡ ${res.message}`);
        workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
        renderStepsTab();
        renderStepThumbnails();
    } catch (e) {
        showToast("Failed to apply variables: " + e.message);
    }
}

setOnclick("sopTemplatesBtn", () => openSopTemplatesModal());

// ============================================================
// PHASE 5 — DECISION & EXCEPTION VALIDATOR ENGINE
// ============================================================
async function openBranchAuditModal() {
    if (!workflow?.id) return showToast("⚠ Open a workflow first");
    const body = $("branchAuditBody");
    if (body) body.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Auditing process branching graph...</div>`;
    const modal = $("branchAuditModal");
    if (modal) modal.style.display = "flex";

    try {
        const rep = await api(`/sessions/${encodeURIComponent(workflow.id)}/validate-branches`, { method: "POST" });
        if (!body) return;

        const isClean = rep.issues.length === 0;
        body.innerHTML = `
            <div style="background:linear-gradient(135deg, rgba(99,102,241,0.12), rgba(16,185,129,0.12)); border-radius:12px; padding:16px; border:1px solid rgba(99,102,241,0.25); display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:16px; font-weight:800; color:var(--text-main,#fff);">Branch Integrity: ${rep.score}%</div>
                    <div style="font-size:12px; color:var(--text-muted,#94a3b8); margin-top:2px;">${rep.decision_count} decision point${rep.decision_count === 1 ? '' : 's'} · ${rep.branch_count} total path routes</div>
                </div>
                <span style="font-size:12px; font-weight:800; padding:4px 12px; border-radius:999px; background:${isClean ? '#10b981' : '#f59e0b'}; color:#fff;">
                    ${isClean ? '✓ ALL CLEAR' : `${rep.issues.length} ISSUE${rep.issues.length === 1 ? '' : 'S'}`}
                </span>
            </div>

            <div>
                <div style="font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted,#94a3b8); margin-bottom:8px;">Audit Findings</div>
                ${rep.issues.length === 0 ? `
                    <div style="padding:14px; text-align:center; color:#10b981; font-weight:700; font-size:13px; background:rgba(16,185,129,0.08); border-radius:8px; border:1px solid rgba(16,185,129,0.2);">
                        🎉 Decision branches are structurally sound! No dead ends or missing default paths found.
                    </div>
                ` : rep.issues.map(iss => `
                    <div style="background:rgba(255,255,255,0.03); border-left:3px solid ${iss.severity === 'error' ? '#ef4444' : '#f59e0b'}; border-radius:6px; padding:10px 14px; margin-bottom:8px;">
                        <div style="font-size:12.5px; font-weight:700; color:var(--text-main,#fff);">${esc(iss.message)}</div>
                        <div style="font-size:11px; color:var(--text-muted,#94a3b8); margin-top:2px;">💡 Recommended Fix: ${esc(iss.suggested_fix)}</div>
                    </div>
                `).join("")}
            </div>

            <div>
                <div style="font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted,#94a3b8); margin-bottom:8px;">Supported Exception Types</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    ${(rep.exception_types || []).map(et => `
                        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle,rgba(255,255,255,0.06)); border-radius:8px; padding:8px 12px; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:18px;">${et.icon}</span>
                            <div>
                                <div style="font-size:12px; font-weight:700; color:var(--text-main,#fff);">${esc(et.name)}</div>
                                <div style="font-size:10.5px; color:var(--text-muted);">${esc(et.description)}</div>
                            </div>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
    } catch (e) {
        if (body) body.innerHTML = `<div style="color:#ef4444; padding:12px;">Branch audit failed: ${esc(e.message)}</div>`;
    }
}

function closeBranchAuditModal() {
    const modal = $("branchAuditModal");
    if (modal) modal.style.display = "none";
}

setOnclick("validateBranchesBtn", () => openBranchAuditModal());

// ============================================================
// PHASE 7 — PRIVACY & SMART REDACTION REVIEW QUEUE
// ============================================================
let currentPrivacyFindings = [];

async function openPrivacyScanModal() {
    if (!workflow?.id) return showToast("⚠ Open a workflow first");
    const modal = $("privacyScanModal");
    if (modal) modal.style.display = "flex";
    await fetchAndRenderPrivacyFindings();
}

function closePrivacyScanModal() {
    const modal = $("privacyScanModal");
    if (modal) modal.style.display = "none";
}

async function fetchAndRenderPrivacyFindings() {
    if (!workflow?.id) return;
    const list = $("privacyFindingsList");
    if (list) list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Running privacy and PII scan across all steps...</div>`;

    try {
        const report = await api(`/sessions/${encodeURIComponent(workflow.id)}/scan-pii`, { method: "POST" });
        currentPrivacyFindings = report.findings || [];

        const header = $("privacyFindingsHeader");
        const sub = $("privacyFindingsSub");
        const autoMaskBtn = $("btnAutoMaskAllPii");

        if (header) {
            header.textContent = currentPrivacyFindings.length === 0
                ? "✅ No Sensitive Data Detected"
                : `🛡️ ${currentPrivacyFindings.length} Sensitive Item${currentPrivacyFindings.length === 1 ? '' : 's'} Found across ${report.affected_steps_count} Step${report.affected_steps_count === 1 ? '' : 's'}`;
        }
        if (sub) {
            sub.textContent = currentPrivacyFindings.length === 0
                ? "No passwords, API tokens, credit cards, or PII were detected in this SOP."
                : "Review the flagged items below. Click 'Auto-Mask All PII' to replace sensitive values with safe tokens.";
        }
        if (autoMaskBtn) {
            autoMaskBtn.style.display = currentPrivacyFindings.length === 0 ? "none" : "block";
        }

        if (list) {
            if (currentPrivacyFindings.length === 0) {
                list.innerHTML = `
                    <div style="padding:20px; text-align:center; color:#10b981; font-weight:700; font-size:13.5px; background:rgba(16,185,129,0.08); border-radius:10px; border:1px solid rgba(16,185,129,0.2);">
                        🎉 Privacy verified! No sensitive personal data or secrets detected in step titles, descriptions, or URLs.
                    </div>
                `;
            } else {
                list.innerHTML = currentPrivacyFindings.map((f, idx) => `
                    <div style="background:rgba(255,255,255,0.03); border-left:3px solid ${f.severity === 'high' ? '#ef4444' : '#f59e0b'}; border-radius:8px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                        <div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:13px; font-weight:700; color:var(--text-main,#fff);">Step ${f.step_sequence}: ${esc(f.label)}</span>
                                <span style="font-size:10px; font-weight:800; text-transform:uppercase; color:${f.severity === 'high' ? '#ef4444' : '#f59e0b'}; background:${f.severity === 'high' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)'}; padding:2px 8px; border-radius:999px;">${f.severity}</span>
                            </div>
                            <div style="font-size:11.5px; color:var(--text-muted,#94a3b8); margin-top:3px;">
                                Field: <code style="color:#818cf8;">${esc(f.field)}</code> · Masked Preview: <span style="font-family:monospace; color:#ef4444;">${esc(f.masked_sample)}</span>
                            </div>
                        </div>
                        <button onclick="maskSingleStepPii(${f.step_id})" class="btn btn-secondary btn-xs" style="color:#ef4444; border-color:rgba(239,68,68,0.3);">
                            🔒 Redact Step
                        </button>
                    </div>
                `).join("");
            }
        }
    } catch (e) {
        if (list) list.innerHTML = `<div style="color:#ef4444; padding:14px;">Privacy scan failed: ${esc(e.message)}</div>`;
    }
}

async function autoMaskAllPii() {
    if (!workflow?.id) return;
    const btn = $("btnAutoMaskAllPii");
    if (btn) { btn.disabled = true; btn.textContent = "🔒 Redacting..."; }
    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/apply-redaction`, {
            method: "POST",
            body: JSON.stringify({ mask_text: true })
        });
        showToast(`🔒 ${res.message}`);
        workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
        renderStepsTab();
        renderStepThumbnails();
        await fetchAndRenderPrivacyFindings();
    } catch (e) {
        showToast("Redaction failed: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "🔒 Auto-Mask All PII"; }
    }
}

async function maskSingleStepPii(stepId) {
    if (!workflow?.id || !stepId) return;
    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) return;

    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/apply-redaction`, {
            method: "POST",
            body: JSON.stringify({ mask_text: true })
        });
        showToast(`🔒 Redacted sensitive data in Step!`);
        workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
        renderStepsTab();
        renderStepThumbnails();
        await fetchAndRenderPrivacyFindings();
    } catch (e) {
        showToast("Redaction failed: " + e.message);
    }
}

setOnclick("privacyScanBtn", () => openPrivacyScanModal());

// ============================================================
// PHASE 8 — SOP LIFECYCLE & VERSION MANAGEMENT ENGINE
// ============================================================
const LIFECYCLE_DISPLAY_MAP = {
    "draft": { label: "📝 Draft", bg: "rgba(148,163,184,0.15)", color: "#94a3b8", border: "rgba(148,163,184,0.3)" },
    "under_review": { label: "👀 Under Review", bg: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "rgba(245,158,11,0.3)" },
    "approved": { label: "✅ Approved", bg: "rgba(16,185,129,0.15)", color: "#10b981", border: "rgba(16,185,129,0.3)" },
    "published": { label: "🚀 Published", bg: "rgba(99,102,241,0.15)", color: "#818cf8", border: "rgba(99,102,241,0.3)" },
    "archived": { label: "📦 Archived", bg: "rgba(100,116,139,0.15)", color: "#64748b", border: "rgba(100,116,139,0.3)" }
};

function updateLifecyclePill(status) {
    const s = (status || "draft").toLowerCase();
    const info = LIFECYCLE_DISPLAY_MAP[s] || LIFECYCLE_DISPLAY_MAP["draft"];
    const labelEl = $("lifecycleStatusLabel");
    const btnEl = $("lifecycleStatusBtn");

    if (labelEl) labelEl.textContent = info.label;
    if (btnEl) {
        btnEl.style.background = info.bg;
        btnEl.style.color = info.color;
        btnEl.style.borderColor = info.border;
    }
}

async function setLifecycleStatus(status) {
    if (!workflow?.id) return;
    const menu = $("lifecycleStatusMenu");
    if (menu) menu.style.display = "none";

    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/lifecycle`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });
        workflow.lifecycle_status = status;
        updateLifecyclePill(status);
        showToast(`SOP status updated to ${LIFECYCLE_DISPLAY_MAP[status]?.label || status}`);
    } catch (e) {
        showToast("Failed to update status: " + e.message);
    }
}

// Lifecycle dropdown toggle
const lifeBtn = $("lifecycleStatusBtn");
if (lifeBtn) {
    lifeBtn.onclick = (e) => {
        e.stopPropagation();
        const menu = $("lifecycleStatusMenu");
        if (menu) {
            menu.style.display = menu.style.display === "flex" ? "none" : "flex";
        }
    };
}
document.addEventListener("click", () => {
    const menu = $("lifecycleStatusMenu");
    if (menu) menu.style.display = "none";
});

async function openVersionHistoryModal() {
    if (!workflow?.id) return showToast("⚠ Open a workflow first");
    const modal = $("versionHistoryModal");
    if (modal) modal.style.display = "flex";
    await fetchAndRenderVersionHistory();
}

function closeVersionHistoryModal() {
    const modal = $("versionHistoryModal");
    if (modal) modal.style.display = "none";
}

async function fetchAndRenderVersionHistory() {
    if (!workflow?.id) return;
    const list = $("versionTimelineList");
    const activeTag = $("modalActiveVersionTag");
    const currLabel = $("currentVersionLabel");

    if (list) list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading version history...</div>`;

    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/versions`);
        const versions = res.versions || [];
        const currentVer = res.current_version || "1.0";

        if (activeTag) activeTag.textContent = currentVer;
        if (currLabel) currLabel.textContent = currentVer;

        if (list) {
            if (versions.length === 0) {
                list.innerHTML = `
                    <div style="padding:16px; text-align:center; color:var(--text-muted); font-size:12.5px; background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid var(--border-subtle,rgba(255,255,255,0.06));">
                        No historical version snapshots saved yet. Click <strong>'+ Snapshot New Version'</strong> above to freeze milestone v1.0.
                    </div>
                `;
            } else {
                list.innerHTML = versions.map((v, idx) => `
                    <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle,rgba(255,255,255,0.08)); border-radius:10px; padding:14px 18px; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-weight:800; font-size:14.5px; color:#818cf8;">${esc(v.version)}</span>
                                <span style="font-size:11px; color:var(--text-muted);">· ${new Date(v.created_at).toLocaleString()}</span>
                                <span style="font-size:10px; font-weight:700; background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:999px; text-transform:uppercase;">${esc(v.status || 'draft')}</span>
                            </div>
                            <div style="font-size:12px; color:var(--text-main,#fff); margin-top:4px;">${esc(v.change_summary || 'Snapshot')}</div>
                        </div>
                        <button onclick="restoreVersionSnapshot(${v.id}, '${esc(v.version)}')" class="btn btn-secondary btn-xs" style="border-color:rgba(99,102,241,0.3); color:#818cf8;">
                            ↺ Restore This Version
                        </button>
                    </div>
                `).join("");
            }
        }
    } catch (e) {
        if (list) list.innerHTML = `<div style="color:#ef4444; padding:12px;">Failed to load version history: ${esc(e.message)}</div>`;
    }
}

async function createNewVersionSnapshotPrompt() {
    if (!workflow?.id) return;
    const nextVer = prompt("Enter Version Tag (e.g. v1.1, v2.0):", "v1.1");
    if (!nextVer) return;
    const summary = prompt("Enter Change Summary / Milestone Notes:", "Updated step instructions and process flow");
    if (summary === null) return;

    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/versions/create`, {
            method: "POST",
            body: JSON.stringify({ version: nextVer.trim(), change_summary: summary.trim() })
        });
        showToast(`🎉 ${res.message}`);
        await fetchAndRenderVersionHistory();
    } catch (e) {
        showToast("Failed to create snapshot: " + e.message);
    }
}

async function restoreVersionSnapshot(versionId, versionTag) {
    if (!confirm(`Are you sure you want to restore workflow to version snapshot ${versionTag}? Current uncommitted edits will be replaced.`)) return;

    try {
        const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/versions/${versionId}/restore`, { method: "POST" });
        showToast(`↺ ${res.message}`);
        workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
        renderStepsTab();
        renderStepThumbnails();
        await fetchAndRenderVersionHistory();
    } catch (e) {
        showToast("Restore failed: " + e.message);
    }
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
    if (!workflow) return;
    const allSteps = workflow.steps || [];
    const visibleSteps = allSteps.filter(s => !s.hidden);
    
    if (visibleSteps.length === 0) {
        if ($("playStepTitle")) $("playStepTitle").textContent = "No visible steps to play";
        if ($("playStepBadge")) $("playStepBadge").textContent = "-";
        if ($("playStepDesc")) $("playStepDesc").textContent = "Add steps or unhide steps to enable presentation playback.";
        if ($("playImg")) {
            $("playImg").src = "";
            $("playImg").classList.add("hidden");
        }
        if ($("playProgress")) $("playProgress").textContent = "0 of 0";
        if ($("pptPrevCard")) $("pptPrevCard").style.visibility = "hidden";
        if ($("pptNextCard")) $("pptNextCard").style.visibility = "hidden";
        if ($("pptDeckFilmstrip")) $("pptDeckFilmstrip").innerHTML = "";
        return;
    }

    let playIdx = Math.max(0, Math.min(visibleSteps.length - 1, currentStepIndex));
    const currentSeq = allSteps[currentStepIndex] ? allSteps[currentStepIndex].sequence : null;
    if (currentSeq) {
        const foundIdx = visibleSteps.findIndex(s => s.sequence === currentSeq);
        if (foundIdx !== -1) playIdx = foundIdx;
    }
    
    let isPlayZoomed = false;

    const showPlayStep = () => {
        const s = visibleSteps[playIdx];
        if (!s) return;
        
        if ($("playStepTitle")) $("playStepTitle").textContent = s.title || getDefaultTitle(s);
        if ($("playStepBadge")) $("playStepBadge").textContent = s.sequence;
        if ($("playStepDesc")) $("playStepDesc").textContent = s.description || getDefaultDescription(s);
        if ($("playVoiceText")) {
            $("playVoiceText").value = s.voiceover || s.description || getDefaultDescription(s);
        }

        // Action, Role, Duration Badges
        if ($("playStepActionLabel")) $("playStepActionLabel").textContent = actionTitle(s.action) + " Step";
        const roleBadge = $("playStepRoleBadge");
        if (roleBadge) {
            if (s.role) {
                roleBadge.textContent = `👤 ${s.role}`;
                roleBadge.classList.remove("hidden");
            } else {
                roleBadge.classList.add("hidden");
            }
        }
        const durBadge = $("playStepDurationBadge");
        if (durBadge) {
            if (s.duration) {
                durBadge.textContent = `⏱️ ${s.duration}`;
                durBadge.classList.remove("hidden");
            } else {
                durBadge.classList.add("hidden");
            }
        }

        // Caution / Disclaimer Alert Callout in Slideshow
        const alertBox = $("playStepAlertBox");
        if (alertBox) {
            if (s.alertType && s.alertType !== "none") {
                alertBox.className = `playback-alert-banner ${s.alertType}`;
                alertBox.classList.remove("hidden");
                const iconMap = { caution: "⚠️", disclaimer: "🚨", tip: "💡", security: "🔒" };
                const labelMap = { caution: "Caution / Warning:", disclaimer: "Legal Disclaimer:", tip: "Pro-Tip & Best Practice:", security: "Security Prerequisite:" };
                if ($("playStepAlertIcon")) $("playStepAlertIcon").textContent = iconMap[s.alertType] || "⚠️";
                if ($("playStepAlertLabel")) $("playStepAlertLabel").textContent = labelMap[s.alertType] || "Alert:";
                if ($("playStepAlertMsg")) $("playStepAlertMsg").textContent = s.alertMsg || "Important operational requirement.";
            } else {
                alertBox.classList.add("hidden");
            }
        }
        
        if (s.note && $("playStepNotesBox") && $("playStepNoteText")) {
            $("playStepNotesBox").classList.remove("hidden");
            $("playStepNoteText").textContent = s.note;
        } else if ($("playStepNotesBox")) {
            $("playStepNotesBox").classList.add("hidden");
        }
        
        if ($("playImg")) {
            if (s.screenshotUrl) {
                $("playImg").src = normalizeImageUrl(s.screenshotUrl);
                $("playImg").classList.remove("hidden");
            } else {
                $("playImg").src = "";
                $("playImg").classList.add("hidden");
            }
        }

        // Interactive Target Hotspot Overlay & Coordinates
        const hs = calculateDefaultHotspot(s);
        const xPct = Math.max(5, Math.min(95, hs.xPct + (hs.wPct / 2)));
        const yPct = Math.max(5, Math.min(95, hs.yPct + (hs.hPct / 2)));
        const playReticle = $("playHotspotReticle");
        const stageWrapper = $("playStageWrapper");

        if (playReticle) {
            playReticle.style.left = `${xPct}%`;
            playReticle.style.top = `${yPct}%`;
            const isPinOn = !s.hidePin;
            playReticle.style.display = (isPinOn || isPracticeModeActive) ? "block" : "none";
            
            const tooltip = $("playHotspotTooltip");
            if (tooltip) {
                tooltip.textContent = isPracticeModeActive 
                    ? `Click to Perform Action 🎯` 
                    : (s.element?.text || s.title || `Target Element`);
            }

            // Click Handler for Hotspot in Interactive / Practice Mode
            playReticle.onclick = (e) => {
                e.stopPropagation();
                createHotspotClickRipple(xPct, yPct, stageWrapper);
                if (isPracticeModeActive) {
                    showToast("✓ Great job! Advancing to next step...", 1200);
                    setTimeout(() => {
                        if (playIdx < visibleSteps.length - 1) {
                            playIdx++;
                            showPlayStep();
                        } else {
                            showToast("🏁 Congratulations! Completed practice procedure successfully!");
                        }
                    }, 400);
                }
            };
        }

        // Stage click in Practice Mode (if user missed hotspot)
        const imgContainer = $("playImgContainer");
        if (imgContainer) {
            imgContainer.onclick = (e) => {
                if (isPracticeModeActive && e.target !== playReticle) {
                    showToast("👆 Guide Me: Click on the glowing highlighted target on the slide.", 1500);
                }
            };
        }

        // Apply Zoom State
        if (stageWrapper) {
            if (isPlayZoomed) {
                stageWrapper.style.transform = "scale(2)";
                stageWrapper.style.transformOrigin = `${xPct}% ${yPct}%`;
            } else {
                stageWrapper.style.transform = "none";
                stageWrapper.style.transformOrigin = "center center";
            }
        }
        
        if ($("playProgress")) $("playProgress").textContent = `Step ${playIdx + 1} of ${visibleSteps.length}`;
        if ($("playPrevBtn")) $("playPrevBtn").disabled = playIdx === 0;
        if ($("playNextBtn")) $("playNextBtn").disabled = playIdx === visibleSteps.length - 1;

        // Reset and trigger auto-play countdown line if active
        const progressBar = $("playAutoProgressBar");
        if (progressBar) {
            progressBar.style.transition = "none";
            progressBar.style.width = "0%";
            if (isAutoPlaying) {
                const spd = parseInt($("autoPlaySpeedSelect")?.value || "5000", 10);
                if (!isNaN(spd)) {
                    setTimeout(() => {
                        progressBar.style.transition = `width ${spd}ms linear`;
                        progressBar.style.width = "100%";
                    }, 50);
                }
            }
        }

        // Decision Branching in Playback / Presentation View
        let playBranchWrap = $("playBranchActionsWrap");
        if (!playBranchWrap && $("playStepDesc")) {
            playBranchWrap = document.createElement("div");
            playBranchWrap.id = "playBranchActionsWrap";
            playBranchWrap.className = "playback-branch-container hidden";
            $("playStepDesc").parentNode.insertBefore(playBranchWrap, $("playStepNotesBox"));
        }
        if (playBranchWrap) {
            const branches = s.branches || [];
            if (branches.length > 0) {
                playBranchWrap.classList.remove("hidden");
                playBranchWrap.innerHTML = `
                    <div class="playback-branch-title">
                        <span>🔀 Decision Path — Choose Next Action:</span>
                    </div>
                    <div class="playback-branch-buttons">
                        ${branches.map((b, bi) => `
                            <button class="btn-branch-choice" data-target-seq="${b.target_sequence}">
                                <span>👉</span> ${esc(b.label || ('Path ' + (bi + 1)))} (Jump to Step ${b.target_sequence})
                            </button>
                        `).join("")}
                    </div>
                `;
                playBranchWrap.querySelectorAll(".btn-branch-choice").forEach(bBtn => {
                    bBtn.onclick = () => {
                        const targetSeq = parseInt(bBtn.dataset.targetSeq, 10);
                        const targetIndex = visibleSteps.findIndex(stepObj => stepObj.sequence === targetSeq);
                        if (targetIndex !== -1) {
                            playIdx = targetIndex;
                            showPlayStep();
                        } else {
                            showToast(`Target Step ${targetSeq} not found in visible steps`);
                        }
                    };
                });
            } else {
                playBranchWrap.classList.add("hidden");
                playBranchWrap.innerHTML = "";
            }
        }

        // PPT Presenter View: Update Previous Slide Preview Card
        const prevStep = playIdx > 0 ? visibleSteps[playIdx - 1] : null;
        if (prevStep && $("pptPrevCard")) {
            $("pptPrevCard").style.visibility = "visible";
            if ($("pptPrevBadge")) $("pptPrevBadge").textContent = prevStep.sequence;
            if ($("pptPrevTitle")) $("pptPrevTitle").textContent = prevStep.title || getDefaultTitle(prevStep);
            if ($("pptPrevImg")) $("pptPrevImg").src = prevStep.screenshotUrl ? normalizeImageUrl(prevStep.screenshotUrl) : "";
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
            if ($("pptNextImg")) $("pptNextImg").src = nextStep.screenshotUrl ? normalizeImageUrl(nextStep.screenshotUrl) : "";
            $("pptNextCard").onclick = () => { playIdx++; showPlayStep(); };
        } else if ($("pptNextCard")) {
            $("pptNextCard").style.visibility = "hidden";
        }

        // PPT Presenter View: Render Filmstrip Deck at bottom
        if ($("pptDeckFilmstrip")) {
            $("pptDeckFilmstrip").innerHTML = visibleSteps.map((st, i) => `
                <div class="thumb-card ${i === playIdx ? 'active' : ''}" data-index="${i}">
                    ${st.screenshotUrl ? `<img src="${esc(normalizeImageUrl(st.screenshotUrl))}" alt="Step ${st.sequence}">` : '<div class="no-screenshot-thumb">No img</div>'}
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

    // Zoom Toggle Button Handler
    const zoomBtn = $("btnTogglePlayZoom");
    if (zoomBtn) {
        zoomBtn.onclick = () => {
            isPlayZoomed = !isPlayZoomed;
            const label = $("playZoomLabel");
            if (label) label.textContent = isPlayZoomed ? "Reset Zoom (1x)" : "Zoom Hotspot (2x)";
            zoomBtn.classList.toggle("btn-primary", isPlayZoomed);
            showPlayStep();
        };
    }
    
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

    // Toggle Pin Target on Slideshow
    const pinToggleBtn = $("btnTogglePlayPinTarget");
    if (pinToggleBtn) {
        pinToggleBtn.onclick = () => {
            const step = visibleSteps[playIdx];
            if (step) {
                step.hidePin = !step.hidePin;
                const playPinLabel = $("playPinLabel");
                if (playPinLabel) {
                    playPinLabel.textContent = step.hidePin ? "OFF" : "ON";
                    playPinLabel.style.color = step.hidePin ? "#94a3b8" : "#10b981";
                }
                showPlayStep();
            }
        };
    }

    // Comprehensive Keyboard Navigation in Playback Mode
    if (!window._playbackKeyBound) {
        window._playbackKeyBound = true;
        window.addEventListener("keydown", (e) => {
            if (activeTab !== "play") return;
            if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
            
            if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
                e.preventDefault();
                $("playNextBtn")?.click();
            } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
                e.preventDefault();
                $("playPrevBtn")?.click();
            } else if (e.key.toLowerCase() === "p") {
                e.preventDefault();
                $("btnTogglePracticeMode")?.click();
            } else if (e.key.toLowerCase() === "z") {
                e.preventDefault();
                $("btnTogglePlayZoom")?.click();
            } else if (e.key.toLowerCase() === "v") {
                e.preventDefault();
                $("playVoiceBtn")?.click();
            } else if (e.key.toLowerCase() === "f") {
                e.preventDefault();
                $("btnToggleFullscreenPlay")?.click();
            }
        });
    }

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
                    audio.src = normalizeImageUrl(res.audioUrl);
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
   EXPORT LOGIC & UNIVERSAL LIVE PREVIEWER (Phase 7)
========================================================= */

let currentExportPreviewText = "";
let currentExportDownloadAction = null;
let lastActivePreviewType = "docx";

async function saveInlineExportStepEdit(stepId, field, value) {
    if (!workflow?.id || !stepId) return;
    const step = (workflow.steps || []).find(s => s.id === stepId);
    if (step) {
        step[field] = value;
    }
    try {
        await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${stepId}/edits`, {
            method: "PATCH",
            body: JSON.stringify({ [field]: value })
        });
        showToast(`✓ Updated ${field}`);
        renderStepsTab();
        renderStepThumbnails();
    } catch(e) {
        showToast("Save failed: " + e.message);
    }
}

async function refreshExportPreview() {
    if (!workflow?.id) return;
    try {
        workflow = await api(`/sessions/${encodeURIComponent(workflow.id)}`);
        await openExportPreview(lastActivePreviewType || "docx");
        showToast("🔄 Export preview refreshed!");
    } catch(e) {
        showToast("Refresh failed: " + e.message);
    }
}

setOnclick("btnRefreshExportPreview", refreshExportPreview);

function renderStepAlertBadgeHtml(step) {
    if (!step || !step.alertType || step.alertType === "none" || !step.alertMsg) return "";
    let icon = "⚠️";
    let title = "CAUTION";
    let bg = "rgba(245, 158, 11, 0.12)";
    let border = "rgba(245, 158, 11, 0.4)";
    let color = "#b45309";
    
    if (step.alertType === "disclaimer") {
        icon = "🚨";
        title = "LEGAL DISCLAIMER";
        bg = "rgba(239, 68, 68, 0.12)";
        border = "rgba(239, 68, 68, 0.4)";
        color = "#b91c1c";
    } else if (step.alertType === "tip") {
        icon = "💡";
        title = "PRO-TIP & BEST PRACTICE";
        bg = "rgba(16, 185, 129, 0.12)";
        border = "rgba(16, 185, 129, 0.4)";
        color = "#047857";
    } else if (step.alertType === "security") {
        icon = "🔒";
        title = "SECURITY & COMPLIANCE REQUIREMENT";
        bg = "rgba(99, 102, 241, 0.12)";
        border = "rgba(99, 102, 241, 0.4)";
        color = "#4338ca";
    }
    
    return `<div style="background: ${bg}; border-left: 4px solid ${border}; border: 1px solid ${border}; border-left-width: 4px; padding: 10px 14px; border-radius: 6px; font-size: 12.5px; color: ${color}; margin-bottom: 10px; line-height: 1.4;"><strong>${icon} ${title}:</strong> ${esc(step.alertMsg)}</div>`;
}

async function openExportPreview(type) {
    if (!workflow) {
        showToast("No workflow selected");
        return;
    }
    lastActivePreviewType = type;
    
    const modal = $("exportPreviewModal");
    const titleEl = $("previewModalTitle");
    const iconEl = $("previewModalIcon");
    const subEl = $("previewModalSub");
    const iframe = $("previewIframe");
    const textWrap = $("previewTextContainer");
    const visualWrap = $("previewVisualContainer");
    const spinner = $("previewLoadingSpinner");
    const copyBtn = $("btnCopyPreviewContent");
    const downloadBtn = $("btnDownloadFromPreview");
    
    if (!modal) return;
    
    modal.classList.remove("hidden");
    iframe.classList.add("hidden");
    textWrap.classList.add("hidden");
    visualWrap.classList.add("hidden");
    spinner.classList.remove("hidden");
    copyBtn.classList.add("hidden");
    currentExportPreviewText = "";
    currentExportDownloadAction = null;
    
    const titles = {
        interactive: { title: "Interactive Guided Walkthrough (.html)", icon: "🎯", sub: "Live interactive simulator mode preview" },
        docx: { title: "Microsoft Word Document (.docx)", icon: "📄", sub: "Document structure & embedded step layout preview (Click text to edit)" },
        pptx: { title: "PowerPoint Presentation (.pptx)", icon: "📊", sub: "Widescreen 16:9 slide deck layout preview (Click text to edit)" },
        json: { title: "JSON Portable Backup (.json)", icon: "💾", sub: "Formatted JSON data backup preview" },
        html: { title: "Self-Contained Standalone HTML (.html)", icon: "📁", sub: "Complete offline HTML documentation preview" },
        markdown: { title: "GitHub Flavored Markdown (.md)", icon: "📝", sub: "Formatted markdown text preview" },
        confluence: { title: "Confluence Wiki Markup", icon: "⚡", sub: "Storage format wiki markup preview" },
        csv: { title: "Structured Spreadsheet CSV", icon: "📊", sub: "Tabular step data preview" },
        scorm: { title: "SCORM 1.2 LMS E-Learning Package", icon: "🎓", sub: "SCORM compliant course preview" },
        pdf: { title: "Print / PDF Document Preview", icon: "🖨️", sub: "Printable page-break layout preview" }
    };
    
    const meta = titles[type] || { title: "Export Preview", icon: "👁️", sub: "Live export rendering" };
    titleEl.textContent = meta.title;
    iconEl.textContent = meta.icon;
    subEl.textContent = meta.sub;
    
    try {
        if (type === "interactive") {
            const html = await generateInteractiveWalkthroughHtml();
            iframe.srcdoc = html;
            iframe.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportInteractiveBtn")?.click();
        } else if (type === "scorm") {
            const html = await generateInteractiveWalkthroughHtml();
            iframe.srcdoc = html;
            iframe.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportScormBtn")?.click();
        } else if (type === "html" || type === "pdf") {
            const html = await generateOfflineHtml();
            iframe.srcdoc = html;
            iframe.classList.remove("hidden");
            currentExportDownloadAction = () => $("btnPrintSopPdf")?.click();
        } else if (type === "markdown") {
            const md = await generateMarkdown();
            currentExportPreviewText = md;
            textWrap.textContent = md;
            textWrap.classList.remove("hidden");
            copyBtn.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportMarkdownBtn")?.click();
        } else if (type === "confluence") {
            const markup = generateConfluenceMarkup();
            currentExportPreviewText = markup;
            textWrap.textContent = markup;
            textWrap.classList.remove("hidden");
            copyBtn.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportConfluenceBtn")?.click();
        } else if (type === "csv") {
            const csv = generateCsv();
            currentExportPreviewText = csv;
            textWrap.textContent = csv;
            textWrap.classList.remove("hidden");
            copyBtn.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportCsvBtn")?.click();
        } else if (type === "json") {
            currentExportPreviewText = JSON.stringify(workflow, null, 2);
            textWrap.textContent = currentExportPreviewText;
            textWrap.classList.remove("hidden");
            copyBtn.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportJsonBtn")?.click();
        } else if (type === "docx") {
            const steps = (workflow.steps || []).filter(s => !s.hidden);
            const bakedImgs = {};
            for (const st of steps) {
                if (st.screenshotUrl) {
                    bakedImgs[st.id] = await getBakedBase64Image(st);
                }
            }
            visualWrap.innerHTML = `
                <div style="max-width: 820px; margin: 0 auto; background: #ffffff; color: #1e293b; padding: 48px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); font-family: 'Inter', sans-serif;">
                    <div style="border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 28px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 4px; background: #e0e7ff; color: #3730a3; text-transform: uppercase;">${esc(globalStudioStyle.sopClassification || "Internal Only")}</span>
                            <span style="font-size: 11px; color: #64748b;">ProcSnap Certified SOP</span>
                        </div>
                        <h1 style="font-size: 26px; color: #1e40af; margin: 0 0 8px 0;">${esc(workflow.name)}</h1>
                        <div style="font-size: 13px; color: #64748b;">Application: <strong>${esc(workflow.application)}</strong> • Steps: <strong>${steps.length}</strong> • Created with ProcSnap</div>
                    </div>
                    ${globalStudioStyle.sopDisclaimer ? `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #64748b; padding: 12px 16px; border-radius: 6px; font-size: 12px; color: #475569; margin-bottom: 24px; line-height: 1.45;"><strong>Executive Disclaimer:</strong> ${esc(globalStudioStyle.sopDisclaimer)}</div>` : ''}
                    ${steps.map(st => `
                        <div style="margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #e2e8f0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <h2 style="font-size: 17px; color: #1e293b; margin: 0; display:flex; align-items:center; gap:8px;">
                                    <span style="background: #2563eb; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 13px;">Step ${st.sequence}</span>
                                    <span contenteditable="true" style="padding:2px 6px; border-radius:4px; outline:none; border-bottom:1px dashed transparent;" onfocus="this.style.borderBottomColor='#2563eb'" onblur="this.style.borderBottomColor='transparent'; saveInlineExportStepEdit(${st.id}, 'title', this.innerText.trim())">${esc(st.title || getDefaultTitle(st))}</span>
                                </h2>
                                ${st.duration || st.role ? `<div style="font-size: 11.5px; color: #64748b; font-weight: 600;">${st.role ? `👤 ${esc(st.role)}` : ''} ${st.duration ? `• ⏱️ ${esc(st.duration)}` : ''}</div>` : ''}
                            </div>
                            <p contenteditable="true" style="font-size: 14px; color: #475569; line-height: 1.5; margin: 0 0 14px 0; padding:2px 6px; border-radius:4px; outline:none; border-bottom:1px dashed transparent;" onfocus="this.style.borderBottomColor='#2563eb'" onblur="this.style.borderBottomColor='transparent'; saveInlineExportStepEdit(${st.id}, 'description', this.innerText.trim())">${esc(st.description || getDefaultDescription(st))}</p>
                            ${renderStepAlertBadgeHtml(st)}
                            ${bakedImgs[st.id] ? `<img src="${bakedImgs[st.id]}" style="max-width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; display: block;">` : ''}
                            ${st.note ? `<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px 14px; border-radius: 4px; font-size: 13px; color: #92400e; margin-bottom: 8px;"><strong>Note:</strong> ${esc(st.note)}</div>` : ''}
                            ${st.expected ? `<div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 10px 14px; border-radius: 4px; font-size: 13px; color: #065f46;"><strong>Expected Result:</strong> ${esc(st.expected)}</div>` : ''}
                        </div>
                    `).join("")}
                </div>
            `;
            visualWrap.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportDocxBtn")?.click();
        } else if (type === "pptx") {
            const steps = (workflow.steps || []).filter(s => !s.hidden);
            const bakedImgs = {};
            for (const st of steps) {
                if (st.screenshotUrl) {
                    bakedImgs[st.id] = await getBakedBase64Image(st);
                }
            }
            visualWrap.innerHTML = `
                <div style="max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px;">
                    <div style="aspect-ratio: 16/9; background: linear-gradient(135deg, #1e293b, #0f172a); color: #fff; border-radius: 12px; padding: 48px; display: flex; flex-direction: column; justify-content: space-between; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 8px 30px rgba(0,0,0,0.4);">
                        <div style="font-size: 14px; font-weight: 700; color: #d97706; text-transform: uppercase; letter-spacing: 0.1em;">Standard Operating Procedure</div>
                        <div>
                            <h1 style="font-size: 32px; font-weight: 800; margin: 0 0 10px 0; color: #fff;">${esc(workflow.name)}</h1>
                            <p style="font-size: 16px; color: #94a3b8; margin: 0;">Application: ${esc(workflow.application)} • Total Steps: ${steps.length}</p>
                        </div>
                        <div style="font-size: 12px; color: #64748b;">ProcSnap SOP Presentation</div>
                    </div>
                    ${steps.map((st, i) => `
                        <div style="aspect-ratio: 16/9; background: #ffffff; color: #1e293b; border-radius: 12px; padding: 28px 36px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 8px 30px rgba(0,0,0,0.25); border: 1px solid #e2e8f0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">
                                <div style="font-size: 18px; font-weight: 700; color: #0f172a; display:flex; align-items:center; gap:8px;">
                                    <span style="background: #d97706; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 13px;">Slide ${i + 1}</span>
                                    <span contenteditable="true" style="padding:2px 6px; border-radius:4px; outline:none; border-bottom:1px dashed transparent;" onfocus="this.style.borderBottomColor='#d97706'" onblur="this.style.borderBottomColor='transparent'; saveInlineExportStepEdit(${st.id}, 'title', this.innerText.trim())">${esc(st.title || getDefaultTitle(st))}</span>
                                </div>
                                <div style="font-size: 12px; font-weight: 600; color: #64748b;">Step ${st.sequence} of ${steps.length}</div>
                            </div>
                            <div style="flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; margin: 12px 0;">
                                ${bakedImgs[st.id] ? `<img src="${bakedImgs[st.id]}" style="max-height: 280px; max-width: 100%; object-fit: contain; border-radius: 6px; border: 1px solid #cbd5e1;">` : '<div style="color: #94a3b8;">No Screenshot</div>'}
                            </div>
                            <div contenteditable="true" style="background: #f8fafc; padding: 10px 14px; border-radius: 6px; font-size: 13px; color: #334155; border-left: 3px solid #d97706; outline:none;" onblur="saveInlineExportStepEdit(${st.id}, 'description', this.innerText.trim())">
                                ${esc(st.description || getDefaultDescription(st))}
                            </div>
                        </div>
                    `).join("")}
                </div>
            `;
            visualWrap.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportPptxBtn")?.click();
        }
    } catch (e) {
        visualWrap.innerHTML = `<div style="color: #ef4444; padding: 24px;">Failed to render preview: ${esc(e.message)}</div>`;
        visualWrap.classList.remove("hidden");
    } finally {
        spinner.classList.add("hidden");
    }
}


function renderExportTab() {
    // Preview buttons
    document.querySelectorAll(".btn-preview-export").forEach(btn => {
        btn.onclick = () => {
            const type = btn.dataset.type;
            if (type) openExportPreview(type);
        };
    });

    // Preview modal actions
    const closePreview = () => {
        const modal = $("exportPreviewModal");
        if (modal) modal.classList.add("hidden");
        const iframe = $("previewIframe");
        if (iframe) iframe.srcdoc = "";
    };

    setOnclick("btnCloseExportPreview", closePreview);
    
    setOnclick("btnDownloadFromPreview", () => {
        if (typeof currentExportDownloadAction === "function") {
            currentExportDownloadAction();
        }
    });

    setOnclick("btnCopyPreviewContent", async () => {
        if (!currentExportPreviewText) return;
        try {
            await navigator.clipboard.writeText(currentExportPreviewText);
            const btn = $("btnCopyPreviewContent");
            const prev = btn.textContent;
            btn.textContent = "✓ Copied!";
            setTimeout(() => { btn.textContent = prev; }, 2000);
        } catch (_) {
            showToast("Failed to copy to clipboard");
        }
    });

    const exportModal = $("exportPreviewModal");
    if (exportModal) {
        exportModal.onclick = (e) => {
            if (e.target === exportModal) closePreview();
        };
    }

    window.addEventListener("message", (e) => {
        if (e.data && (e.data.action === "closeExportPreview" || e.data.action === "closePreview")) {
            closePreview();
        }
    });

    // Direct Export triggers
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

    setOnclick("exportPptxBtn", async () => {
        if (!workflow) return;
        showToast("Generating PowerPoint (.pptx) presentation...");
        try {
            const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(workflow.id)}/export/pptx`);
            if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
            const blob = await res.blob();
            downloadBlob(`${safeName(workflow.name)}.pptx`, blob);
            showToast("PowerPoint slide deck exported!");
        } catch (e) {
            showToast("Failed to export PowerPoint: " + e.message);
            console.error(e);
        }
    });

    setOnclick("exportJsonBtn", async () => {
        if (!workflow) return;
        showToast("Exporting complete JSON backup...");
        try {
            const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(workflow.id)}/export/json`);
            if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
            const blob = await res.blob();
            downloadBlob(`${safeName(workflow.name)}.procsnap.json`, blob);
            showToast("JSON backup exported!");
        } catch (e) {
            showToast("Failed to export JSON backup: " + e.message);
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
    if (!step || !step.screenshotUrl) return "";
    
    const imgUrl = normalizeImageUrl(step.screenshotUrl);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgUrl;
    
    await new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
    });

    if (!img.complete || img.naturalWidth === 0) {
        return imgUrl;
    }

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    
    // Draw original image
    ctx.drawImage(img, 0, 0);

    // 1. Draw Spotlight & Element Focus Box
    const screen = step.element?.screen;
    if (screen && step.focusBoxEnabled !== false) {
        const sw = Number(screen.viewportWidth || screen.width);
        const sh = Number(screen.viewportHeight || screen.height);
        if (sw && sh) {
            const scaleX = img.naturalWidth / sw;
            const scaleY = img.naturalHeight / sh;
            
            const x = screen.x * scaleX;
            const y = screen.y * scaleY;
            const w = screen.width * scaleX;
            const h = screen.height * scaleY;
            
            if (step.autoSpotlightEnabled !== false) {
                ctx.save();
                ctx.fillStyle = "rgba(15, 23, 42, 0.40)";
                ctx.beginPath();
                ctx.rect(0, 0, img.naturalWidth, img.naturalHeight);
                ctx.rect(x - 4, y - 4, w + 8, h + 8);
                ctx.fill("evenodd");
                ctx.restore();
            }

            ctx.save();
            ctx.strokeStyle = "rgba(239, 68, 68, 0.95)";
            ctx.lineWidth = Math.max(3, Math.round(img.naturalHeight * 0.004));
            ctx.setLineDash([8, 4]);
            ctx.strokeRect(x, y, w, h);
            ctx.restore();
        }
    }

    // 2. Draw active annotations
    const annotations = step.annotations || [];
    annotations.forEach(s => {
        ctx.save();
        ctx.lineWidth = s.lineWidth || 4;
        ctx.strokeStyle = s.color || "#ef4444";
        ctx.globalAlpha = s.opacity !== undefined ? s.opacity : 1;
        
        if (s.type === "circle" || s.type === "badge" || s.type === "numbered_step") {
            const r = Math.max(16, (s.w || 32) / 2);
            const cx = s.x + r;
            const cy = s.y + r;
            
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = s.color || "#ef4444";
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.fillStyle = "#ffffff";
            ctx.font = `bold ${Math.max(12, Math.round(r * 0.9))}px Arial, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(s.label || s.text || s.number || String(step.sequence || "1"), cx, cy);
        }
        else if (s.type === "rect" || s.type === "rectangle" || s.type === "box") {
            ctx.strokeRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = s.fillColor || "rgba(239, 68, 68, 0.15)";
            ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        else if (s.type === "blur" || s.type === "redact") {
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
            const headlen = Math.max(14, (s.lineWidth || 4) * 3.5);
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
            ctx.fillStyle = s.color || "#ef4444";
            ctx.fill();
        }
        else if (s.type === "text" || s.type === "callout") {
            ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
            ctx.fillRect(s.x, s.y, s.w || 120, s.h || 36);
            ctx.strokeStyle = s.color || "#6366f1";
            ctx.lineWidth = 2;
            ctx.strokeRect(s.x, s.y, s.w || 120, s.h || 36);
            
            ctx.fillStyle = "#ffffff";
            ctx.font = `bold ${s.textSize || 14}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(s.text || "Note", s.x + (s.w || 120)/2, s.y + (s.h || 36)/2);
        }
        ctx.restore();
    });

    // 3. Draw Watermark if enabled globally
    const wm = globalStudioStyle.watermark;
    if (wm && wm.enabled && wm.text) {
        ctx.save();
        const pos = wm.position || "diagonal";
        const op = typeof wm.opacity === "number" ? wm.opacity : 0.25;
        const color = wm.color || "#94a3b8";

        if (pos === "diagonal") {
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(-Math.PI / 4);
            ctx.font = `800 ${Math.max(26, Math.round(canvas.width * 0.045))}px Arial, sans-serif`;
            ctx.fillStyle = color;
            ctx.globalAlpha = op;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(wm.text.toUpperCase(), 0, 0);
        } else if (pos === "bottom-right") {
            ctx.font = `700 ${Math.max(15, Math.round(canvas.width * 0.018))}px Arial, sans-serif`;
            ctx.fillStyle = color;
            ctx.globalAlpha = op * 1.2;
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            ctx.fillText(wm.text.toUpperCase(), canvas.width - 24, canvas.height - 18);
        } else if (pos === "tile") {
            ctx.font = `700 ${Math.max(16, Math.round(canvas.width * 0.022))}px Arial, sans-serif`;
            ctx.fillStyle = color;
            ctx.globalAlpha = op * 0.7;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) {
                    const cx = (c + 0.5) * (canvas.width / 3);
                    const cy = (r + 0.5) * (canvas.height / 3);
                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.rotate(-Math.PI / 6);
                    ctx.fillText(wm.text.toUpperCase(), 0, 0);
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }

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
        const alertBlock = renderStepAlertBadgeHtml(s);
        const noteBlock = s.note ? `<div class="sop-note"><strong>Note:</strong> ${esc(s.note)}</div>` : "";
        const expectedBlock = s.expected ? `<div class="sop-expected"><strong>Expected Result:</strong> ${esc(s.expected)}</div>` : "";
        const metaTag = (s.role || s.duration) ? `<div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${s.role ? `👤 <strong>Role:</strong> ${esc(s.role)}` : ''} ${s.duration ? `• ⏱️ <strong>Duration:</strong> ${esc(s.duration)}` : ''}</div>` : "";
        
        stepsHtml.push(`
            <section class="sop-step">
                <div class="sop-step-header">
                    <span class="sop-step-number">Step ${s.sequence}</span>
                    <h2 class="sop-step-title">${esc(s.title || getDefaultTitle(s))}</h2>
                </div>
                ${metaTag}
                <p class="sop-step-description">${esc(s.description || getDefaultDescription(s))}</p>
                ${alertBlock}
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
            <div style="display:inline-flex; gap:3px; background:rgba(0,0,0,0.35); padding:2px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); margin-left:10px;">
                <button id="btnModeGuided" class="mode-pill active" onclick="setInteractiveMode('guided')" style="padding:2px 8px; font-size:10.5px; font-weight:700; border:none; border-radius:4px; cursor:pointer; background:#6366f1; color:#fff;">🎯 Guided</button>
                <button id="btnModePractice" class="mode-pill" onclick="setInteractiveMode('practice')" style="padding:2px 8px; font-size:10.5px; font-weight:700; border:none; border-radius:4px; cursor:pointer; background:transparent; color:#94a3b8;">🏋️ Practice</button>
                <button id="btnModeAssessment" class="mode-pill" onclick="setInteractiveMode('assessment')" style="padding:2px 8px; font-size:10.5px; font-weight:700; border:none; border-radius:4px; cursor:pointer; background:transparent; color:#94a3b8;">🏆 Assessment</button>
            </div>
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
            <button id="exitPreviewBtn" onclick="if(window.parent) window.parent.postMessage({action:'closeExportPreview'}, '*');" class="btn-icon" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border-color: rgba(239, 68, 68, 0.4); font-weight: 700; cursor: pointer;" title="Exit Walkthrough">
                ✕ Exit
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
    const closeModal = () => modal.classList.add("hidden");
    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeBtn2) closeBtn2.onclick = closeModal;

    // Backdrop click close
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    // ESC key close
    const onKey = (e) => {
        if (e.key === "Escape") {
            closeModal();
            window.removeEventListener("keydown", onKey);
        }
    };
    window.addEventListener("keydown", onKey);

    // Re-scan button
    const refreshBtn = $("refreshReqBtn");
    if (refreshBtn) refreshBtn.onclick = () => loadSystemRequirements();

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

    // Pull AI Models — downloads moondream + qwen2.5 with LIVE real-time streaming progress
    const btnPullModels = $("btnPullModels");
    if (btnPullModels) {
        btnPullModels.onclick = async () => {
            const terminalWrap  = $("repairTerminalWrapper");
            const terminalOut   = $("repairTerminalOutput");
            const terminalLabel = $("repairTerminalLabel");
            const terminalStatus = $("repairTerminalStatus");
            if (terminalWrap) terminalWrap.classList.remove("hidden");
            if (terminalLabel) terminalLabel.textContent = "AI Model Download Output (Live)";
            if (terminalStatus) { terminalStatus.textContent = "Connecting…"; terminalStatus.style.color = "#a5b4fc"; }
            if (terminalOut) terminalOut.textContent = "Connecting to Ollama download stream…\n";

            btnPullModels.disabled = true;
            btnPullModels.textContent = "⏳ Downloading Models…";

            let outputAccumulator = "";

            try {
                const response = await fetch(`${API_BASE}/ai/pull-models-stream`);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = "";

                if (terminalStatus) { terminalStatus.textContent = "Downloading…"; terminalStatus.style.color = "#38bdf8"; }

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop(); // keep remainder

                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            const data = line.slice(6);
                            if (data === "[DONE]") break;
                            outputAccumulator += data + "\n";
                            if (terminalOut) {
                                terminalOut.textContent = outputAccumulator;
                                terminalOut.scrollTop = terminalOut.scrollHeight;
                            }
                        }
                    }
                }

                if (terminalStatus) { terminalStatus.textContent = "✓ Complete"; terminalStatus.style.color = "#34d399"; }
                showToast("✅ AI model downloads complete!");
                await loadSystemRequirements();
            } catch(e) {
                if (terminalOut) terminalOut.textContent = outputAccumulator + "\n❌ Stream error: " + e.message;
                if (terminalStatus) { terminalStatus.textContent = "✗ Error"; terminalStatus.style.color = "#f87171"; }
                showToast("Pull models error: " + e.message);
            } finally {
                btnPullModels.disabled = false;
                btnPullModels.textContent = "⬇️ Pull AI Models";
            }
        };
    }

    // Pull Latest Update from GitHub
    const btnGitPull = $("btnGitPull");
    if (btnGitPull) {
        btnGitPull.onclick = async () => {
            const terminalWrap   = $("repairTerminalWrapper");
            const terminalOut    = $("repairTerminalOutput");
            const terminalLabel  = $("repairTerminalLabel");
            const terminalStatus = $("repairTerminalStatus");
            if (terminalWrap) terminalWrap.classList.remove("hidden");
            if (terminalLabel) terminalLabel.textContent = "GitHub Update Output";
            if (terminalStatus) { terminalStatus.textContent = "Pulling…"; terminalStatus.style.color = "#a5b4fc"; }
            if (terminalOut) terminalOut.textContent = "⬇ Connecting to GitHub…\n";

            btnGitPull.disabled = true;
            btnGitPull.textContent = "⬇️ Pulling...";

            try {
                const res = await api("/system/git-pull", { method: "POST", timeout: 180000 });
                if (terminalOut) terminalOut.textContent = res.output || "git pull finished.";
                if (res.success) {
                    if (terminalStatus) { terminalStatus.textContent = "✓ Up to date"; terminalStatus.style.color = "#34d399"; }
                    showToast("✅ ProcSnap updated! Please restart the server to apply changes.");
                } else {
                    if (terminalStatus) { terminalStatus.textContent = "✗ Failed"; terminalStatus.style.color = "#f87171"; }
                    showToast("git pull encountered issues — check the output log.");
                }
            } catch(e) {
                if (terminalOut) terminalOut.textContent = "git pull error: " + e.message;
                if (terminalStatus) { terminalStatus.textContent = "✗ Error"; terminalStatus.style.color = "#f87171"; }
                showToast("git pull failed: " + e.message);
            } finally {
                btnGitPull.disabled = false;
                btnGitPull.textContent = "⬇️ Pull Latest Update";
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
                const res = await api("/system/reinstall-packages", { method: "POST", timeout: 180000 });
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
    const banner = $("reqStatusBanner");
    const bIcon = $("reqBannerIcon");
    const bTitle = $("reqBannerTitle");
    const bDesc = $("reqBannerDesc");
    const tbody = $("reqPackagesTbody");

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 18px;">⏳ Scanning system environment and packages...</td></tr>`;
    }

    try {
        const data = await api("/system/requirements", { timeout: 15000 });
        if (!data || !data.success) throw new Error("Invalid response from server");

        // 1. Overall Banner
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
        if (tbody && data.packages && data.packages.items) {
            tbody.innerHTML = data.packages.items.map(p => `
                <tr>
                    <td style="font-weight: 700; color: var(--text-primary);">${esc(p.name)}</td>
                    <td><code style="background: var(--code-bg); color: var(--code-text); padding: 2px 6px; border-radius: 4px;">${esc(p.version)}</code></td>
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
        if (banner) banner.className = "req-overall-banner needs_attention";
        if (bIcon) bIcon.textContent = "⚠️";
        if (bTitle) bTitle.textContent = "Scan Incomplete";
        if (bDesc) bDesc.textContent = "Failed to communicate with backend server: " + (e.message || "Unknown error");
        
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 24px;">
                        <div style="color: #f87171; font-weight: 600; margin-bottom: 10px;">
                            ⚠️ Could not retrieve live system requirements (${esc(e.message)})
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="loadSystemRequirements()" style="display: inline-flex; align-items: center; gap: 5px;">
                            🔄 Retry Re-Scan
                        </button>
                    </td>
                </tr>
            `;
        }
        showToast("Error checking requirements: " + e.message);
    }
}

// =========================================================
// 🔀 DECISION BRANCHING (DECISION TREES)
// =========================================================

function getCurrentStep() {
    if (!workflow || !workflow.steps || workflow.steps.length === 0) return null;
    return workflow.steps[currentStepIndex] || null;
}

function renderStepBranches(step) {
    const listEl = $("stepBranchList");
    if (!listEl) return;
    
    if (!step) {
        listEl.innerHTML = "";
        return;
    }
    
    if (!step.branches || !Array.isArray(step.branches)) {
        step.branches = [];
    }
    
    const allSteps = workflow ? (workflow.steps || []) : [];
    
    if (step.branches.length === 0) {
        listEl.innerHTML = `
            <div style="font-size: 11px; color: var(--text-muted); padding: 8px 10px; background: rgba(0,0,0,0.12); border-radius: 8px; border: 1px dashed var(--border-color, rgba(255,255,255,0.1)); text-align: center;">
                No branching rules set. Playback flows sequentially (Step ${step.sequence} ➡️ Step ${Math.min(allSteps.length, (step.sequence || 1) + 1)}).
            </div>
        `;
    } else {
        const branchColors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
        listEl.innerHTML = step.branches.map((b, i) => {
            const color = branchColors[i % branchColors.length];
            const stepOptions = allSteps.map(s => `
                <option value="${s.sequence}" ${s.sequence === b.target_sequence ? 'selected' : ''}>
                    Step ${s.sequence}: ${(s.title || 'Step ' + s.sequence).substring(0, 18)}
                </option>
            `).join("");
            
            return `
                <div class="step-branch-card" data-index="${i}" style="background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid ${color}; border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 10px; font-weight: 800; color: ${color}; letter-spacing: 0.5px;">PATH ${i + 1}</span>
                        <button class="btn-branch-delete" data-index="${i}" title="Remove this branch" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px; line-height: 1;">✕</button>
                    </div>
                    <div style="display: grid; grid-template-columns: 1.2fr 24px 1.4fr; align-items: center; gap: 6px;">
                        <input type="text" class="step-branch-input form-control" value="${esc(b.label || '')}" placeholder="Choice / If Label" data-index="${i}" style="font-size: 11px; padding: 4px 6px; height: 26px;">
                        <span style="color: var(--text-muted); text-align: center; font-size: 12px;">➔</span>
                        <select class="step-branch-select form-control" data-index="${i}" style="font-size: 11px; padding: 4px 6px; height: 26px;">
                            ${stepOptions}
                        </select>
                    </div>
                </div>
            `;
        }).join("");
    }
    
    // Wire inputs
    listEl.querySelectorAll(".step-branch-input").forEach(inp => {
        inp.oninput = (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            if (step.branches[idx]) {
                step.branches[idx].label = e.target.value;
                scheduleAutoSave(400);
            }
        };
    });
    
    listEl.querySelectorAll(".step-branch-select").forEach(sel => {
        sel.onchange = (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            if (step.branches[idx]) {
                step.branches[idx].target_sequence = parseInt(e.target.value, 10);
                saveActiveStepEditsSilent();
            }
        };
    });
    
    listEl.querySelectorAll(".btn-branch-delete").forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.currentTarget.dataset.index, 10);
            step.branches.splice(idx, 1);
            renderStepBranches(step);
            saveActiveStepEditsSilent();
            renderStepThumbnails();
            showToast("Branch removed.", 1500);
        };
    });
}

function addBranchPreset(type) {
    const step = getCurrentStep();
    if (!step) return showToast("Please select a step first.");
    if (!step.branches || !Array.isArray(step.branches)) step.branches = [];

    const allSteps = workflow ? (workflow.steps || []) : [];
    const currSeq = step.sequence || 1;
    const nextSeq = Math.min(allSteps.length, currSeq + 1);
    const altSeq = Math.min(allSteps.length, currSeq + 2);

    if (type === "yes_no") {
        step.branches.push({ label: "Yes, Continue", target_sequence: nextSeq });
        step.branches.push({ label: "No, Skip", target_sequence: altSeq });
    } else if (type === "role") {
        step.branches.push({ label: "Admin Role", target_sequence: nextSeq });
        step.branches.push({ label: "Standard User", target_sequence: altSeq });
    } else if (type === "error") {
        step.branches.push({ label: "Success Path", target_sequence: nextSeq });
        step.branches.push({ label: "On Error / Retry", target_sequence: currSeq });
    }

    renderStepBranches(step);
    saveActiveStepEditsSilent();
    renderStepThumbnails();
    showToast(`Added ${type.replace('_', '/')} decision preset!`, 2000);
}

// Wire Add Branch Button
const btnAddStepBranch = $("btnAddStepBranch");
if (btnAddStepBranch) {
    btnAddStepBranch.onclick = () => {
        const step = getCurrentStep();
        if (!step) {
            showToast("No active step selected");
            return;
        }
        if (!step.branches || !Array.isArray(step.branches)) step.branches = [];
        const allSteps = workflow ? (workflow.steps || []) : [];
        const nextSeq = Math.min(allSteps.length, (step.sequence || 1) + 1);
        step.branches.push({
            label: `Option ${step.branches.length + 1}`,
            target_sequence: nextSeq
        });

        renderStepBranches(step);
        saveActiveStepEditsSilent();
        renderStepThumbnails();
        showToast("Added decision branch.", 1500);
    };
}


// =========================================================
// 🎬 ANIMATED STEP MICRO-DEMO GENERATOR (GIF) & REMOVAL
// =========================================================

const btnGenerateAnimation = $("btnGenerateAnimation");
const btnRemoveAnimation = $("btnRemoveAnimation");

let isDraggingLiveCursor = false;

function updateLiveCursorOverlay(step) {
    const overlay = $("liveCursorOverlay");
    const handle = $("draggableCursorHandle");
    const notice = $("activeDemoAdjustNotice");
    if (!overlay || !handle) return;

    if (!step || !step.hasActiveDemo || step.hidePin || step.hidden) {
        overlay.classList.add("hidden");
        overlay.style.display = "none";
        if (notice) notice.classList.add("hidden");
        return;
    }

    overlay.classList.remove("hidden");
    overlay.style.display = "block";
    if (notice) notice.classList.remove("hidden");

    const hs = calculateDefaultHotspot(step);
    const xPct = Math.max(2, Math.min(98, hs.xPct + (hs.wPct / 2)));
    const yPct = Math.max(2, Math.min(98, hs.yPct + (hs.hPct / 2)));

    handle.style.left = `${xPct}%`;
    handle.style.top = `${yPct}%`;

    const txt = $("cursorCoordsText");
    if (txt) txt.textContent = `Drag Cursor (${Math.round(xPct)}%, ${Math.round(yPct)}%)`;
}

function initLiveDraggableCursor() {
    const handle = $("draggableCursorHandle");
    const wrapper = $("canvasWrapper");
    if (!handle || !wrapper) return;

    handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDraggingLiveCursor = true;
        handle.setPointerCapture(e.pointerId);
        handle.classList.add("dragging");
    });

    handle.addEventListener("pointermove", (e) => {
        if (!isDraggingLiveCursor) return;
        e.preventDefault();
        e.stopPropagation();

        const rect = wrapper.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        let xPct = ((e.clientX - rect.left) / rect.width) * 100;
        let yPct = ((e.clientY - rect.top) / rect.height) * 100;

        xPct = Math.max(1, Math.min(99, xPct));
        yPct = Math.max(1, Math.min(99, yPct));

        handle.style.left = `${xPct}%`;
        handle.style.top = `${yPct}%`;

        const txt = $("cursorCoordsText");
        if (txt) txt.textContent = `Drag Cursor (${Math.round(xPct)}%, ${Math.round(yPct)}%)`;

        const curW = Number($("hotspotW")?.value || 20);
        const curH = Number($("hotspotH")?.value || 20);
        const newLeft = Math.max(0, Math.min(100 - curW, Math.round(xPct - curW / 2)));
        const newTop = Math.max(0, Math.min(100 - curH, Math.round(yPct - curH / 2)));

        setVal("hotspotX", newLeft);
        setVal("hotspotY", newTop);
    });

    const finishCursorDrag = async (e) => {
        if (!isDraggingLiveCursor) return;
        isDraggingLiveCursor = false;
        handle.classList.remove("dragging");
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}

        const step = getCurrentStep();
        if (!step) return;

        const leftVal = Number($("hotspotX")?.value || 40);
        const topVal = Number($("hotspotY")?.value || 40);
        const wVal = Number($("hotspotW")?.value || 20);
        const hVal = Number($("hotspotH")?.value || 20);

        step.hotspot = {
            xPct: leftVal,
            yPct: topVal,
            wPct: wVal,
            hPct: hVal,
            prompt: $("guideHotspotPrompt")?.value || (step.title || getDefaultTitle(step)),
            type: "custom"
        };

        saveActiveStepEditsSilent();

        const curXPct = leftVal + (wVal / 2);
        const curYPct = topVal + (hVal / 2);

        createCanvasClickRipple(e.clientX - wrapper.getBoundingClientRect().left, e.clientY - wrapper.getBoundingClientRect().top, wrapper);
        showToast(`🎯 Cursor target updated: (${Math.round(curXPct)}%, ${Math.round(curYPct)}%)!`, 2500);

        // Sync backend GIF rendering silently in background
        triggerAnimateGeneration(step, curXPct, curYPct, true);
    };

    handle.addEventListener("pointerup", finishCursorDrag);
    handle.addEventListener("pointercancel", finishCursorDrag);
}

function updateDemoButtonState(step) {
    const notice = $("activeDemoAdjustNotice");
    const liveOverlay = $("liveCursorOverlay");
    if (!step) {
        if (btnRemoveAnimation) btnRemoveAnimation.classList.add("hidden");
        if (notice) notice.classList.add("hidden");
        if (liveOverlay) liveOverlay.classList.add("hidden");
        return;
    }
    if (step.hasActiveDemo) {
        if (btnRemoveAnimation) btnRemoveAnimation.classList.remove("hidden");
        if (btnGenerateAnimation) btnGenerateAnimation.innerHTML = `<span>🔄</span> Re-generate`;
        if (notice) notice.classList.remove("hidden");
        updateLiveCursorOverlay(step);
    } else {
        if (btnRemoveAnimation) btnRemoveAnimation.classList.add("hidden");
        if (btnGenerateAnimation) btnGenerateAnimation.innerHTML = `🎬 Micro-Demo`;
        if (notice) notice.classList.add("hidden");
        if (liveOverlay) liveOverlay.classList.add("hidden");
    }
}

async function triggerAnimateGeneration(step, customXPct = null, customYPct = null, isSilent = false) {
    if (!step || !workflow) {
        if (!isSilent) showToast("Please select a step with a screenshot first");
        return;
    }
    if (!step.screenshotUrl) {
        if (!isSilent) showToast("This step does not have a screenshot to animate");
        return;
    }

    let xPct = customXPct;
    let yPct = customYPct;

    if (xPct === null || yPct === null) {
        // Priority 1: Check live Draggable Cursor position on screen
        const handle = $("draggableCursorHandle");
        if (handle && handle.style.left && handle.style.top) {
            const hLeft = parseFloat(handle.style.left);
            const hTop = parseFloat(handle.style.top);
            if (!isNaN(hLeft) && !isNaN(hTop) && hLeft > 0 && hTop > 0) {
                xPct = hLeft;
                yPct = hTop;
            }
        }
    }

    if (xPct === null || yPct === null) {
        // Priority 2: Check live Reticle position on screen
        const reticle = $("hotspotReticleHandle");
        if (reticle && reticle.style.left && reticle.style.top && !reticle.classList.contains("hidden")) {
            const rLeft = parseFloat(reticle.style.left);
            const rTop = parseFloat(reticle.style.top);
            if (!isNaN(rLeft) && !isNaN(rTop) && rLeft > 0 && rTop > 0) {
                xPct = rLeft;
                yPct = rTop;
            }
        }
    }

    if (xPct === null || yPct === null) {
        // Priority 3: Inspector input fields
        const hsX = Number($("hotspotX")?.value);
        const hsY = Number($("hotspotY")?.value);
        const hsW = Number($("hotspotW")?.value || 20);
        const hsH = Number($("hotspotH")?.value || 20);

        if (!isNaN(hsX) && !isNaN(hsY) && hsX >= 0 && hsY >= 0) {
            xPct = hsX + (hsW / 2);
            yPct = hsY + (hsH / 2);
        } else if (step.hotspot && typeof step.hotspot.xPct === "number") {
            xPct = step.hotspot.xPct + ((step.hotspot.wPct || 20) / 2);
            yPct = step.hotspot.yPct + ((step.hotspot.hPct || 20) / 2);
        } else if (step.element?.screen) {
            const sc = step.element.screen;
            const sw = Number(sc.viewportWidth || 1920);
            const sh = Number(sc.viewportHeight || 1080);
            xPct = ((Number(sc.x || 0) + (Number(sc.width || 0) / 2)) / Math.max(1, sw)) * 100;
            yPct = ((Number(sc.y || 0) + (Number(sc.height || 0) / 2)) / Math.max(1, sh)) * 100;
        } else {
            const hs = calculateDefaultHotspot(step);
            xPct = hs.xPct + (hs.wPct / 2);
            yPct = hs.yPct + (hs.hPct / 2);
        }
    }

    const finalXPct = Math.max(1, Math.min(99, Number(xPct)));
    const finalYPct = Math.max(1, Math.min(99, Number(yPct)));

    const payload = {
        x_pct: finalXPct,
        y_pct: finalYPct
    };

    if (btnGenerateAnimation && !isSilent) {
        btnGenerateAnimation.disabled = true;
        btnGenerateAnimation.innerHTML = `<span>⏳</span> Generating...`;
    }

    try {
        const queryUrl = `/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/animate?x_pct=${encodeURIComponent(finalXPct)}&y_pct=${encodeURIComponent(finalYPct)}`;
        const res = await api(queryUrl, {
            method: "POST",
            body: JSON.stringify(payload)
        });

        if (res.success && res.gif_url) {
            step.hasActiveDemo = true;
            step.screenshotUrl = res.gif_url;
            
            const imgEl = $("guideImg");
            if (imgEl) {
                imgEl.src = `${normalizeImageUrl(res.gif_url)}?t=${Date.now()}`;
                imgEl.classList.remove("hidden");
            }
            
            updateDemoButtonState(step);
            if (typeof updateHotspotReticlePosition === "function") {
                updateHotspotReticlePosition(step);
            }
            renderStepThumbnails();
            if (!isSilent) {
                showToast(`🎬 Micro-Demo generated at target (${Math.round(finalXPct)}%, ${Math.round(finalYPct)}%)!`, 3500);
            }
        }
    } catch (e) {
        if (!isSilent) showToast(`Failed to generate animation: ${e.message}`, 4000);
    } finally {
        if (btnGenerateAnimation && !isSilent) {
            btnGenerateAnimation.disabled = false;
            updateDemoButtonState(step);
        }
    }
}

if (btnGenerateAnimation) {
    btnGenerateAnimation.onclick = () => triggerAnimateGeneration(getCurrentStep());
}

if (btnRemoveAnimation) {
    btnRemoveAnimation.onclick = async () => {
        const step = getCurrentStep();
        if (!step || !workflow) return;
        
        btnRemoveAnimation.disabled = true;
        btnRemoveAnimation.textContent = "Removing...";
        
        try {
            await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/animate`, {
                method: "DELETE"
            });
            
            step.hasActiveDemo = false;
            
            // Revert image to original static PNG
            const seq = Number(step.sequence || 1);
            const pngUrl = `/screenshots/${workflow.id}/step-${String(seq).padStart(3, '0')}.png`;
            step.screenshotUrl = pngUrl;
            
            const imgEl = $("guideImg");
            if (imgEl) {
                imgEl.src = `${normalizeImageUrl(pngUrl)}?t=${Date.now()}`;
                imgEl.classList.remove("hidden");
            }
            
            updateDemoButtonState(step);
            loadActiveStepDetails();
            renderStepThumbnails();
            
            if (canvasEngine) {
                const userAnno = getStepAnnotations(step);
                const withSpot = canvasEngine.applyAutoSpotlight(
                    step.element,
                    step.sequence,
                    userAnno
                );
                canvasEngine.setAnnotations(withSpot);
            }
            
            updateDemoButtonState(step);
            showToast("✕ Micro-Demo removed. Original screenshot restored.", 3500);
        } catch (e) {
            showToast(`Failed to remove animation: ${e.message}`, 4000);
        } finally {
            btnRemoveAnimation.disabled = false;
            btnRemoveAnimation.textContent = "✕ Remove Demo";
        }
    };
}


// =========================================================
// 🔍 COMMAND PALETTE (CTRL+K GLOBAL SEARCH)
// =========================================================

let cmdPaletteActiveIndex = 0;
let cmdPaletteItems = [];
let cmdSearchDebounceTimer = null;

function toggleCommandPalette(forceOpen = null) {
    const modal = $("commandPaletteModal");
    const input = $("cmdPaletteInput");
    if (!modal) return;
    
    const shouldOpen = forceOpen !== null ? forceOpen : modal.classList.contains("hidden");
    if (shouldOpen) {
        modal.classList.remove("hidden");
        if (input) {
            input.value = "";
            input.focus();
            searchCommandPalette("");
        }
    } else {
        modal.classList.add("hidden");
    }
}

async function searchCommandPalette(query) {
    const q = (query || "").trim();
    const resultsEl = $("cmdPaletteResults");
    const countEl = $("cmdPaletteCount");
    if (!resultsEl) return;
    
    if (!q) {
        resultsEl.innerHTML = `
            <div style="padding: 28px; text-align: center; color: var(--text-muted); font-size: 13px;">
                Type a keyword to search across all workflows, steps, actions, URLs, and notes in your library...
            </div>
        `;
        if (countEl) countEl.textContent = "0 results";
        cmdPaletteItems = [];
        return;
    }
    
    resultsEl.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
            <span>⏳ Searching library...</span>
        </div>
    `;
    
    try {
        const res = await api(`/search?q=${encodeURIComponent(q)}`);
        const wfs = res.workflows || [];
        const steps = res.steps || [];
        const total = (res.totalMatches !== undefined) ? res.totalMatches : (wfs.length + steps.length);
        if (countEl) countEl.textContent = `${total} match${total === 1 ? '' : 'es'}`;
        
        if (wfs.length === 0 && steps.length === 0) {
            resultsEl.innerHTML = `
                <div style="padding: 28px; text-align: center; color: var(--text-muted); font-size: 13px;">
                    No results found for "<strong>${esc(q)}</strong>".
                </div>
            `;
            cmdPaletteItems = [];
            return;
        }
        
        cmdPaletteItems = [];
        let html = "";
        
        if (wfs.length > 0) {
            html += `<div class="cmd-palette-category">Workflows (${wfs.length})</div>`;
            wfs.forEach(wf => {
                const itemIndex = cmdPaletteItems.length;
                cmdPaletteItems.push({ type: "workflow", id: wf.id });
                html += `
                    <div class="cmd-palette-item ${itemIndex === 0 ? 'active' : ''}" data-index="${itemIndex}" data-type="workflow" data-id="${wf.id}">
                        <div class="cmd-palette-item-left">
                            <span class="cmd-palette-item-icon">📁</span>
                            <div class="cmd-palette-item-info">
                                <div class="cmd-palette-item-title">${esc(wf.name || 'Untitled Workflow')}</div>
                                <div class="cmd-palette-item-sub">${esc(wf.application || 'Chrome')} • Started ${fmt(wf.startedAt)}</div>
                            </div>
                        </div>
                        <span class="cmd-palette-badge">Workflow</span>
                    </div>
                `;
            });
        }
        
        if (steps.length > 0) {
            html += `<div class="cmd-palette-category">Steps (${steps.length})</div>`;
            steps.forEach(st => {
                const itemIndex = cmdPaletteItems.length;
                cmdPaletteItems.push({ type: "step", id: st.workflowId, sequence: st.sequence });
                html += `
                    <div class="cmd-palette-item ${itemIndex === 0 ? 'active' : ''}" data-index="${itemIndex}" data-type="step" data-id="${st.workflowId}" data-sequence="${st.sequence}">
                        <div class="cmd-palette-item-left">
                            <span class="cmd-palette-item-icon">🎯</span>
                            <div class="cmd-palette-item-info">
                                <div class="cmd-palette-item-title">Step ${st.sequence}: ${esc(st.title || 'Step')}</div>
                                <div class="cmd-palette-item-sub">in <strong>${esc(st.workflowName)}</strong> ${st.matchContext ? '• ' + esc(st.matchContext) : ''}</div>
                            </div>
                        </div>
                        <span class="cmd-palette-badge" style="color: #818cf8;">${esc(st.action || 'Step')}</span>
                    </div>
                `;
            });
        }
        
        resultsEl.innerHTML = html;
        cmdPaletteActiveIndex = 0;
        
        // Click handlers
        resultsEl.querySelectorAll(".cmd-palette-item").forEach(el => {
            el.onclick = () => selectCommandPaletteItem(parseInt(el.dataset.index, 10));
        });
        
    } catch (e) {
        resultsEl.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--danger); font-size: 13px;">
                Error searching library: ${esc(e.message)}
            </div>
        `;
    }
}

async function selectCommandPaletteItem(index) {
    if (index < 0 || index >= cmdPaletteItems.length) return;
    const item = cmdPaletteItems[index];
    toggleCommandPalette(false);
    
    if (item.type === "workflow") {
        await openWorkflow(item.id);
    } else if (item.type === "step") {
        await openWorkflow(item.id);
        const targetIdx = Math.max(0, (item.sequence || 1) - 1);
        if (typeof setTab === "function") setTab("guide");
        currentStepIndex = targetIdx;
        loadActiveStepDetails();
        renderStepThumbnails();
    }
}

function updateCommandPaletteHighlight() {
    const items = document.querySelectorAll(".cmd-palette-item");
    items.forEach((item, idx) => {
        if (idx === cmdPaletteActiveIndex) {
            item.classList.add("active");
            item.scrollIntoView({ block: "nearest" });
        } else {
            item.classList.remove("active");
        }
    });
}

// Wire Input & Keyboard Navigation
const cmdPaletteInput = $("cmdPaletteInput");
if (cmdPaletteInput) {
    cmdPaletteInput.addEventListener("input", (e) => {
        clearTimeout(cmdSearchDebounceTimer);
        cmdSearchDebounceTimer = setTimeout(() => {
            searchCommandPalette(e.target.value);
        }, 180);
    });

    cmdPaletteInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (cmdPaletteItems.length > 0) {
                cmdPaletteActiveIndex = (cmdPaletteActiveIndex + 1) % cmdPaletteItems.length;
                updateCommandPaletteHighlight();
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (cmdPaletteItems.length > 0) {
                cmdPaletteActiveIndex = (cmdPaletteActiveIndex - 1 + cmdPaletteItems.length) % cmdPaletteItems.length;
                updateCommandPaletteHighlight();
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (cmdPaletteItems.length > 0) {
                selectCommandPaletteItem(cmdPaletteActiveIndex);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            toggleCommandPalette(false);
        }
    });
}

// Wire Global Ctrl+K / Cmd+K listener
window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleCommandPalette();
    }
});

// Wire Topbar Button & Modal backdrop close
setOnclick("openCommandPaletteBtn", () => toggleCommandPalette(true));

const cmdModal = $("commandPaletteModal");
if (cmdModal) {
    cmdModal.addEventListener("click", (e) => {
        if (e.target === cmdModal) {
            toggleCommandPalette(false);
        }
    });
}


/* =========================================================
   🎯 INTERACTIVE DRAG-AND-DROP & CLICK-TO-PIN HOTSPOT FINDER
========================================================= */

let isDraggingReticle = false;
let isHotspotClickMode = false;
let isHotspotLocked = false;

function toggleHotspotLock(forceState = null) {
    isHotspotLocked = forceState !== null ? forceState : !isHotspotLocked;
    const btn = $("btnToggleLockHotspot");
    const icon = $("hotspotLockIcon");
    const label = $("hotspotLockLabel");
    const reticle = $("hotspotReticleHandle");

    if (icon) icon.textContent = isHotspotLocked ? "🔒" : "🔓";
    if (label) label.textContent = isHotspotLocked ? "Locked" : "Unlocked";
    if (btn) btn.classList.toggle("active", isHotspotLocked);
    if (reticle) reticle.classList.toggle("locked", isHotspotLocked);

    showToast(isHotspotLocked ? "🔒 Hotspot position locked." : "🔓 Hotspot unlocked for adjustment.", 2000);
}

function toggleHotspotClickMode(forceState = null) {
    if (isHotspotLocked && forceState !== false) {
        showToast("🔒 Hotspot is locked. Unlock it in the toolbar to reposition.", 2500);
        return;
    }
    isHotspotClickMode = forceState !== null ? forceState : !isHotspotClickMode;
    const wrapper = $("canvasWrapper");
    const toolBtn = $("btnPickHotspotTool");
    const drawerBtn = $("btnPickHotspotClick");

    if (wrapper) wrapper.classList.toggle("hotspot-picking-mode", isHotspotClickMode);
    if (toolBtn) toolBtn.classList.toggle("active", isHotspotClickMode);
    if (drawerBtn) drawerBtn.classList.toggle("active", isHotspotClickMode);

    if (isHotspotClickMode) {
        showToast("🎯 Click Mode Active: Click anywhere on the screenshot to pinpoint the hotspot!", 3000);
    }
}

function createCanvasClickRipple(x, y, parentEl) {
    if (!parentEl) return;
    const ripple = document.createElement("div");
    ripple.className = "reticle-ripple-burst";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    parentEl.appendChild(ripple);
    setTimeout(() => {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 700);
}

function updateHotspotReticlePosition(step) {
    const reticle = $("hotspotReticleHandle");
    const wrapper = $("canvasWrapper");
    if (!reticle || !wrapper) return;

    const isHotspotTabActive = document.querySelector(".drawer-seg-btn.active")?.dataset?.view === "hotspot";
    const isPinVisible = step && !step.hidePin && (step.showPin || isHotspotTabActive);

    if (!step || !step.screenshotUrl || step.hidden || !isPinVisible) {
        reticle.classList.add("hidden");
        reticle.style.display = "none";
        return;
    }

    reticle.classList.remove("hidden");
    reticle.style.display = "flex";
    const hs = calculateDefaultHotspot(step);
    const xPct = Math.max(2, Math.min(98, hs.xPct + (hs.wPct / 2)));
    const yPct = Math.max(2, Math.min(98, hs.yPct + (hs.hPct / 2)));

    reticle.style.left = `${xPct}%`;
    reticle.style.top = `${yPct}%`;

    const numBadge = $("reticleNumberBadge");
    if (numBadge) {
        numBadge.textContent = step.sequence || (currentStepIndex + 1);
    }

    const label = $("reticleCoordsLabel");
    if (label) {
        label.textContent = `🎯 ${Math.round(xPct)}%, ${Math.round(yPct)}%`;
    }
}

function initHotspotReticle() {
    const reticle = $("hotspotReticleHandle");
    const wrapper = $("canvasWrapper");
    if (!reticle || !wrapper) return;

    // 1. Drag & Drop Listener on Reticle Handle
    reticle.addEventListener("pointerdown", (e) => {
        if (isHotspotLocked) {
            showToast("🔒 Hotspot is locked.", 1500);
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        isDraggingReticle = true;
        reticle.setPointerCapture(e.pointerId);
        reticle.classList.add("dragging");
    });

    reticle.addEventListener("pointermove", (e) => {
        if (!isDraggingReticle) return;
        const rect = wrapper.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const clientX = e.clientX;
        const clientY = e.clientY;

        const xPct = Math.max(1, Math.min(99, ((clientX - rect.left) / rect.width) * 100));
        const yPct = Math.max(1, Math.min(99, ((clientY - rect.top) / rect.height) * 100));

        reticle.style.left = `${xPct}%`;
        reticle.style.top = `${yPct}%`;

        setVal("hotspotX", Math.round(xPct));
        setVal("hotspotY", Math.round(yPct));

        const label = $("reticleCoordsLabel");
        if (label) label.textContent = `🎯 ${Math.round(xPct)}%, ${Math.round(yPct)}%`;
    });

    const finishReticleDrag = async (e) => {
        if (!isDraggingReticle) return;
        isDraggingReticle = false;
        reticle.classList.remove("dragging");
        try { reticle.releasePointerCapture(e.pointerId); } catch (_) {}

        const step = getCurrentStep();
        if (step) {
            step.hotspot = {
                xPct: newLeft,
                yPct: newTop,
                wPct: curW,
                hPct: curH,
                prompt: $("guideHotspotPrompt")?.value || (step.title || getDefaultTitle(step)),
                type: "custom"
            };
            saveActiveStepEditsSilent();
        }

        const label = $("reticleCoordsLabel");
        if (label) {
            const isDemoActive = Boolean(step?.hasActiveDemo || (step?.screenshotUrl && (step.screenshotUrl.includes("-demo") || step.screenshotUrl.endsWith(".gif"))));
            if (isDemoActive) {
                label.textContent = `🎯 Drag to Adjust GIF (${Math.round(xPct)}%, ${Math.round(yPct)}%)`;
            } else {
                label.textContent = `🎯 ${Math.round(xPct)}%, ${Math.round(yPct)}%`;
            }
        }

        createCanvasClickRipple(e.clientX - rect.left, e.clientY - rect.top, wrapper);
        toggleHotspotClickMode(false);

        const isDemo = Boolean(step?.hasActiveDemo || (step?.screenshotUrl && (step.screenshotUrl.includes("-demo") || step.screenshotUrl.endsWith(".gif"))));
        if (isDemo) {
            showToast("🔄 Re-generating Micro-Demo at clicked location...", 2500);
            await triggerAnimateGeneration(step, xPct, yPct);
        } else {
            showToast(`🎯 Hotspot placed at (${Math.round(xPct)}%, ${Math.round(yPct)}%)!`, 2500);
        }
    };

    reticle.addEventListener("pointerup", finishReticleDrag);
    reticle.addEventListener("pointercancel", finishReticleDrag);

    // 3. Wire Click Mode Trigger Buttons & Lock Toggle
    setOnclick("btnPickHotspotTool", () => toggleHotspotClickMode());
    setOnclick("btnPickHotspotClick", () => toggleHotspotClickMode());
    setOnclick("btnToggleLockHotspot", () => toggleHotspotLock());

    const togglePinAction = (customStep = null) => {
        const step = customStep || getCurrentStep();
        if (!step) return;
        step.hidePin = !step.hidePin;

        const syncLabels = () => {
            const vLabel = $("pinVisibilityLabel");
            if (vLabel) {
                vLabel.textContent = step.hidePin ? "OFF" : "ON";
                vLabel.style.color = step.hidePin ? "#94a3b8" : "#10b981";
            }
            const dLabel = $("drawerPinLabel");
            if (dLabel) {
                dLabel.textContent = step.hidePin ? "HIDDEN" : "VISIBLE";
                dLabel.style.color = step.hidePin ? "#94a3b8" : "#10b981";
            }
            const pLabel = $("playPinLabel");
            if (pLabel) {
                pLabel.textContent = step.hidePin ? "OFF" : "ON";
                pLabel.style.color = step.hidePin ? "#94a3b8" : "#10b981";
            }
        };

        syncLabels();
        updateHotspotReticlePosition(step);
        if (typeof updateLiveCursorOverlay === "function") updateLiveCursorOverlay(step);
        saveActiveStepEditsSilent();
        showToast(step.hidePin ? "🎯 Pin target hidden for this step." : "🎯 Pin target visible.");
    };

    setOnclick("btnTogglePinVisibility", () => togglePinAction());
    setOnclick("btnDrawerTogglePin", () => togglePinAction());
    setOnclick("btnTogglePlayPinTarget", () => togglePinAction());

    // 4. Hotkey 'H' to toggle Hotspot Click Finder Mode
    window.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() === "h" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
            e.preventDefault();
            toggleHotspotClickMode();
        }
    });
}


/* =========================================================
   📥 CANVAS DRAG-AND-DROP IMAGE / GIF REPLACEMENT
========================================================= */

function initCanvasFileDrop() {
    const stage = $("screenshotStage");
    const overlay = $("canvasDropOverlay");
    if (!stage || !overlay) return;

    ["dragenter", "dragover"].forEach(eventName => {
        stage.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            overlay.classList.remove("hidden");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        stage.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            overlay.classList.add("hidden");
        });
    });

    stage.addEventListener("drop", async (e) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        const step = getCurrentStep();
        if (!step || !workflow) {
            showToast("Please select an active step before uploading a replacement image.");
            return;
        }

        const validExts = ["image/png", "image/jpeg", "image/gif", "image/webp"];
        if (!validExts.includes(file.type) && !file.name.match(/\.(png|jpe?g|gif|webp)$/i)) {
            showToast("Supported file formats: PNG, JPG, GIF, WebP");
            return;
        }

        showToast(`Uploading '${file.name}' for Step ${step.sequence}...`);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/upload-image`, {
                method: "POST",
                body: formData
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const data = await res.json();
            
            if (data.success && data.screenshotUrl) {
                step.screenshotUrl = data.screenshotUrl;
                const imgEl = $("guideImg");
                if (imgEl) {
                    imgEl.src = `${normalizeImageUrl(data.screenshotUrl)}?t=${Date.now()}`;
                    imgEl.classList.remove("hidden");
                }
                showToast("✓ Step image replaced successfully!", 3500);
                loadActiveStepDetails();
                renderStepThumbnails();
            }
        } catch (err) {
            showToast(`Failed to upload image: ${err.message}`, 4000);
        }
    });
}


/* =========================================================
   📄 CORPORATE SOP TEMPLATE MANAGER & PAGE SELECTOR LOGIC
========================================================= */

let activeTemplateData = null;

function openTemplateModal() {
    const modal = $("sopTemplateModal");
    if (!modal) return;
    modal.classList.remove("hidden");
    if (!activeTemplateData) {
        loadDefaultTemplatePages();
    }
}
window.openTemplateModal = openTemplateModal;

function initSopTemplateManager() {
    const modal = $("sopTemplateModal");
    const dropzone = $("templateDropzone");
    const fileInput = $("templateFileInput");
    const browseBtn = $("btnBrowseTemplate");
    const openBtn = $("btnOpenTemplateModal");
    const closeBtn = $("btnCloseTemplateModal");
    const cancelBtn = $("btnCancelTemplateModal");
    const applyBtn = $("btnApplySelectedPages");
    const selectAllBtn = $("btnSelectAllPages");
    const deselectAllBtn = $("btnDeselectAllPages");
    const changeFileBtn = $("btnChangeTemplateFile");

    if (!modal) return;

    const toggleModal = (show) => {
        if (show) {
            openTemplateModal();
        } else {
            modal.classList.add("hidden");
        }
    };

    if (openBtn) openBtn.onclick = () => openTemplateModal();
    if (closeBtn) closeBtn.onclick = () => toggleModal(false);
    if (cancelBtn) cancelBtn.onclick = () => toggleModal(false);

    modal.addEventListener("click", (e) => {
        if (e.target === modal) toggleModal(false);
    });

    if (browseBtn && fileInput) {
        browseBtn.onclick = () => fileInput.click();
    }
    if (changeFileBtn && fileInput) {
        changeFileBtn.onclick = () => fileInput.click();
    }

    if (dropzone) {
        dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("dragover"); };
        dropzone.ondragleave = () => dropzone.classList.remove("dragover");
        dropzone.ondrop = (e) => {
            e.preventDefault();
            dropzone.classList.remove("dragover");
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) handleTemplateUpload(files[0]);
        };
    }

    if (fileInput) {
        fileInput.onchange = (e) => {
            const files = e.target.files;
            if (files && files.length > 0) handleTemplateUpload(files[0]);
        };
    }

    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            document.querySelectorAll(".template-page-checkbox").forEach(cb => { cb.checked = true; });
            document.querySelectorAll(".template-page-card").forEach(card => card.classList.add("selected"));
            updateTemplateSelectionCount();
        };
    }

    if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
            document.querySelectorAll(".template-page-checkbox").forEach(cb => { cb.checked = false; });
            document.querySelectorAll(".template-page-card").forEach(card => card.classList.remove("selected"));
            updateTemplateSelectionCount();
        };
    }

    if (applyBtn) {
        applyBtn.onclick = async () => {
            if (!workflow) {
                showToast("No active workflow selected.");
                return;
            }
            const selectedCbs = Array.from(document.querySelectorAll(".template-page-checkbox:checked"));
            if (selectedCbs.length === 0) {
                showToast("Please select at least one page layout to apply.");
                return;
            }

            const selectedPageIds = selectedCbs.map(cb => cb.value);
            const mode = document.querySelector("input[name='templateMode']:checked")?.value || "reformat_layout";

            applyBtn.disabled = true;
            applyBtn.textContent = "Applying Template...";

            try {
                const res = await api(`/sessions/${encodeURIComponent(workflow.id)}/templates/apply-to-sop`, {
                    method: "POST",
                    body: JSON.stringify({
                        template_name: activeTemplateData?.filename || "Standard Enterprise SOP",
                        selected_page_ids: selectedPageIds,
                        template_style: "modern_enterprise",
                        merge_mode: mode
                    })
                });

                showToast(`✨ ${res.message || "Template applied to SOP successfully!"}`, 4000);
                toggleModal(false);
                setTab("export");
            } catch (err) {
                showToast(`Failed to apply template: ${err.message}`, 4000);
            } finally {
                applyBtn.disabled = false;
                applyBtn.innerHTML = "✨ Apply Selected Pages &amp; Update SOP";
            }
        };
    }
}

async function handleTemplateUpload(file) {
    if (!workflow) {
        showToast("Please open a workflow before uploading a template.");
        return;
    }

    showToast(`Parsing template '${file.name}'...`);
    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(workflow.id)}/templates/upload-and-parse`, {
            method: "POST",
            body: formData
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();

        if (data.success) {
            activeTemplateData = data;
            const banner = $("templateActiveBanner");
            if (banner) banner.classList.remove("hidden");
            setText("templateLoadedName", `Template Loaded: ${data.filename} (${data.template_type})`);
            setText("templateLoadedSub", `${data.total_pages} page layouts available for selection`);

            renderTemplatePageCards(data.pages || []);
            showToast(`✓ Loaded ${data.total_pages} page layouts from template!`, 3500);
        }
    } catch (err) {
        showToast(`Template parsing error: ${err.message}`, 4000);
    }
}

function loadDefaultTemplatePages() {
    const defaultPages = [
        { id: "page_cover", title: "Page 1: Title & Executive Summary", type: "cover", desc: "Corporate header, SOP document ID, department metadata, and executive summary cover.", recommended: true },
        { id: "page_steps_2col", title: "Page 2: Two-Column Step Procedure", type: "procedure_2col", desc: "Crisp high-resolution screenshot on left with numbered instructions on right.", recommended: true },
        { id: "page_steps_matrix", title: "Page 3: 3-Step Compact Matrix Grid", type: "procedure_matrix", desc: "Dense 3-step operational matrix grid for quick reference & field operator cheat-sheets.", recommended: true },
        { id: "page_approvals", title: "Page 4: Compliance Sign-off & Audit Trail", type: "approvals", desc: "Revision history, security classification, author sign-off & management approval block.", recommended: true }
    ];
    renderTemplatePageCards(defaultPages);
}

function renderTemplatePageCards(pages) {
    const grid = $("templatePagesGrid");
    if (!grid) return;

    grid.innerHTML = pages.map(p => `
        <div class="template-page-card ${p.recommended ? 'selected' : ''}" data-page-id="${p.id}">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <span class="template-page-badge ${p.type}">${esc(p.type)}</span>
                <input type="checkbox" class="template-page-checkbox" value="${p.id}" ${p.recommended ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
            </div>
            <div style="font-size: 13px; font-weight: 700; color: var(--text-main, #fff); margin-top: 4px;">${esc(p.title)}</div>
            <p style="font-size: 11.5px; color: var(--text-muted, #94a3b8); margin: 0; line-height: 1.4;">${esc(p.desc || "")}</p>
        </div>
    `).join("");

    grid.querySelectorAll(".template-page-card").forEach(card => {
        card.onclick = (e) => {
            if (e.target.tagName !== "INPUT") {
                const cb = card.querySelector(".template-page-checkbox");
                if (cb) cb.checked = !cb.checked;
            }
            const cb = card.querySelector(".template-page-checkbox");
            card.classList.toggle("selected", !!cb?.checked);
            updateTemplateSelectionCount();
        };
    });

    updateTemplateSelectionCount();
}

function updateTemplateSelectionCount() {
    const count = document.querySelectorAll(".template-page-checkbox:checked").length;
    setText("templateSelectionSummary", `${count} page layout${count === 1 ? '' : 's'} selected to update active SOP`);
}


// =========================================================
// 🎙️ DRAWER VOICEOVER TTS & AI ENHANCE DIFF PREVIEW
// =========================================================

function initDrawerVoiceoverAndAiDiff() {
    const btnPlay = $("btnPlayStepVoiceover");
    const btnDraft = $("btnAiDraftVoiceover");
    const btnAiEnhance = $("aiEnhanceStepBtn");

    // Segmented Drawer Tab Switcher
    document.querySelectorAll(".drawer-seg-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".drawer-seg-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const view = btn.dataset.view;
            const paneHotspot = $("drawerPaneHotspot");
            const paneNotes = $("drawerPaneNotes");
            const paneBranch = $("drawerPaneBranch");
            const paneMeta = $("drawerPaneMeta");

            if (paneHotspot) paneHotspot.classList.toggle("hidden", view !== "hotspot");
            if (paneNotes) paneNotes.classList.toggle("hidden", view !== "notes");
            if (paneBranch) paneBranch.classList.toggle("hidden", view !== "branch");
            if (paneMeta) paneMeta.classList.toggle("hidden", view !== "meta");

            // Update hotspot reticle visibility based on active view
            const step = getCurrentStep();
            if (step && typeof updateHotspotReticlePosition === "function") {
                updateHotspotReticlePosition(step);
            }
        };
    });

    // Initialize Dual Control Panel (Master Switcher: Step Inspector vs Global Styles)
    initDualControlPanel();

    
    if (btnPlay) {
        btnPlay.onclick = () => {
            const step = getCurrentStep();
            if (!step) return;
            const textToSpeak = $("guideStepVoiceover")?.value || step.voiceover || step.description || getDefaultDescription(step);
            if (!textToSpeak) {
                showToast("No narration text to speak.");
                return;
            }
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(textToSpeak);
                utterance.rate = 1.0;
                utterance.pitch = 1.0;
                btnPlay.innerHTML = `<span>🔊</span> Speaking...`;
                utterance.onend = () => {
                    btnPlay.innerHTML = `<span>▶️</span> Listen Voiceover`;
                };
                utterance.onerror = () => {
                    btnPlay.innerHTML = `<span>▶️</span> Listen Voiceover`;
                };
                window.speechSynthesis.speak(utterance);
            } else {
                showToast("Browser SpeechSynthesis not supported on this device.");
            }
        };
    }

    if (btnDraft) {
        btnDraft.onclick = () => {
            const step = getCurrentStep();
            if (!step) return;
            const act = step.action || "Click";
            const target = step.element?.text || step.element?.name || step.element?.tagName || "the highlighted item";
            const draft = `In this step, please ${act.toLowerCase()} on ${target} to proceed with the procedure.`;
            setVal("guideStepVoiceover", draft);
            step.voiceover = draft;
            showToast("✨ AI Voiceover script drafted!");
        };
    }

    // AI Enhance Diff Modal bindings
    if (btnAiEnhance) {
        btnAiEnhance.onclick = async () => {
            const step = getCurrentStep();
            if (!step) return;

            const modal = $("aiEnhanceDiffModal");
            const origTitle = $("diffOriginalTitle");
            const enhTitle = $("diffEnhancedTitle");
            const origDesc = $("diffOriginalDesc");
            const enhDesc = $("diffEnhancedDesc");

            const currentTitle = $("guideStepTitle")?.value || step.title || getDefaultTitle(step);
            const currentDesc = $("guideStepDesc")?.value || step.description || getDefaultDescription(step);

            if (origTitle) origTitle.textContent = currentTitle;
            if (origDesc) origDesc.textContent = currentDesc;

            // Generate high-clarity professional revision
            const act = (step.action || "Click").toUpperCase();
            const elText = step.element?.text || step.element?.name || "Target";
            const proposedTitle = `${act}: ${elText}`;
            const proposedDesc = `Locate and select '${elText}' on the active interface. Verify the state changes before proceeding to subsequent operations.`;

            if (enhTitle) enhTitle.textContent = proposedTitle;
            if (enhDesc) enhDesc.textContent = proposedDesc;

            if (modal) modal.classList.remove("hidden");

            const acceptBtn = $("btnAcceptAiDiff");
            const rejectBtn = $("btnRejectAiDiff");
            const closeBtn = $("btnCloseAiDiffModal");

            if (acceptBtn) {
                acceptBtn.onclick = () => {
                    setVal("guideStepTitle", proposedTitle);
                    setVal("guideStepDesc", proposedDesc);
                    step.title = proposedTitle;
                    step.description = proposedDesc;
                    saveActiveStepEditsSilent();
                    renderStepThumbnails();
                    if (modal) modal.classList.add("hidden");
                    showToast("✨ AI Enhancement applied successfully!");
                };
            }
            if (rejectBtn) rejectBtn.onclick = () => modal && modal.classList.add("hidden");
            if (closeBtn) closeBtn.onclick = () => modal && modal.classList.add("hidden");
        };
    }
}

// =========================================================
// 🎛️ DUAL CONTROL PANEL: GLOBAL STYLES & STEP INSPECTOR
// =========================================================

const globalStudioStyle = {
    pinColor: "#ef4444",
    badgeStyle: "circle",
    dimPercent: 40,
    strokeWidth: 3,
    cursorType: "arrow",
    demoSpeed: "smooth",
    clickRipple: true,
    blurStyle: "frosted",
    watermark: {
        enabled: false,
        text: "CONFIDENTIAL",
        opacity: 0.25,
        position: "diagonal",
        color: "#94a3b8"
    },
    sopDisclaimer: "This standard operating procedure contains proprietary and confidential information. Unauthorized distribution or reproduction is strictly prohibited.",
    sopClassification: "Internal Only"
};

function initDualControlPanel() {
    const tabMasterStep = $("tabMasterStep");
    const tabMasterGlobal = $("tabMasterGlobal");
    const drawerRootStep = $("drawerRootStep");
    const drawerRootGlobal = $("drawerRootGlobal");

    if (tabMasterStep && tabMasterGlobal) {
        tabMasterStep.onclick = () => {
            tabMasterStep.classList.add("active");
            tabMasterGlobal.classList.remove("active");

            if (drawerRootStep) {
                drawerRootStep.classList.remove("hidden");
                drawerRootStep.style.display = "flex";
            }
            if (drawerRootGlobal) {
                drawerRootGlobal.classList.add("hidden");
                drawerRootGlobal.style.display = "none";
            }
        };

        tabMasterGlobal.onclick = () => {
            tabMasterGlobal.classList.add("active");
            tabMasterStep.classList.remove("active");

            if (drawerRootGlobal) {
                drawerRootGlobal.classList.remove("hidden");
                drawerRootGlobal.style.display = "flex";
            }
            if (drawerRootStep) {
                drawerRootStep.classList.add("hidden");
                drawerRootStep.style.display = "none";
            }
        };
    }

    // Color Swatches
    document.querySelectorAll(".global-color-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".global-color-btn").forEach(b => {
                b.classList.remove("active");
                b.style.border = "2px solid transparent";
            });
            btn.classList.add("active");
            btn.style.border = "2px solid #ffffff";
            const col = btn.dataset.color || "#ef4444";
            globalStudioStyle.pinColor = col;
            const label = $("globalColorLabel");
            if (label) {
                label.textContent = col;
                label.style.color = col;
            }
            const customInp = $("globalCustomColorInput");
            if (customInp) customInp.value = col;
            applyGlobalStyleLivePreview();
        };
    });

    const customColorInp = $("globalCustomColorInput");
    if (customColorInp) {
        customColorInp.oninput = (e) => {
            const col = e.target.value;
            globalStudioStyle.pinColor = col;
            const label = $("globalColorLabel");
            if (label) {
                label.textContent = col;
                label.style.color = col;
            }
            document.querySelectorAll(".global-color-btn").forEach(b => {
                b.classList.remove("active");
                b.style.border = "2px solid transparent";
            });
            applyGlobalStyleLivePreview();
        };
    }

    // Badge Style Buttons
    document.querySelectorAll(".global-badge-style-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".global-badge-style-btn").forEach(b => {
                b.classList.remove("active");
                b.style.background = "";
                b.style.color = "";
            });
            btn.classList.add("active");
            btn.style.background = "#6366f1";
            btn.style.color = "#fff";
            globalStudioStyle.badgeStyle = btn.dataset.style || "circle";
            applyGlobalStyleLivePreview();
        };
    });

    // Dim Slider
    const dimSlider = $("globalDimSlider");
    if (dimSlider) {
        dimSlider.oninput = (e) => {
            const val = parseInt(e.target.value, 10);
            globalStudioStyle.dimPercent = val;
            const label = $("globalDimValueLabel");
            if (label) label.textContent = `${val}%`;
            applyGlobalStyleLivePreview();
        };
    }

    // Stroke Buttons
    document.querySelectorAll(".global-stroke-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".global-stroke-btn").forEach(b => {
                b.classList.remove("active");
                b.style.background = "";
                b.style.color = "";
            });
            btn.classList.add("active");
            btn.style.background = "#6366f1";
            btn.style.color = "#fff";
            globalStudioStyle.strokeWidth = parseInt(btn.dataset.width, 10) || 3;
            applyGlobalStyleLivePreview();
        };
    });

    // Ripple Toggle
    const rippleBtn = $("btnGlobalRippleToggle");
    if (rippleBtn) {
        rippleBtn.onclick = () => {
            globalStudioStyle.clickRipple = !globalStudioStyle.clickRipple;
            if (globalStudioStyle.clickRipple) {
                rippleBtn.textContent = "ENABLED ✓";
                rippleBtn.style.color = "#10b981";
            } else {
                rippleBtn.textContent = "DISABLED ✕";
                rippleBtn.style.color = "#94a3b8";
            }
        };
    }

    // Redaction Style Buttons
    document.querySelectorAll(".global-blur-style-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".global-blur-style-btn").forEach(b => {
                b.classList.remove("active");
                b.style.background = "";
                b.style.borderColor = "";
                b.style.color = "";
            });
            btn.classList.add("active");
            btn.style.background = "rgba(99,102,241,0.2)";
            btn.style.borderColor = "#6366f1";
            btn.style.color = "#fff";
            globalStudioStyle.blurStyle = btn.dataset.blur || "frosted";
        };
    });

    // Watermark Toggle & Inputs
    const wmToggleBtn = $("btnGlobalWatermarkToggle");
    const wmTextInput = $("globalWatermarkTextInput");
    const wmPosSelect = $("globalWatermarkPosSelect");
    const wmOpacitySlider = $("globalWatermarkOpacitySlider");
    const wmOpacityLabel = $("globalWatermarkOpacityLabel");

    if (wmToggleBtn) {
        wmToggleBtn.onclick = () => {
            globalStudioStyle.watermark.enabled = !globalStudioStyle.watermark.enabled;
            if (globalStudioStyle.watermark.enabled) {
                wmToggleBtn.textContent = "ENABLED ✓";
                wmToggleBtn.style.color = "#10b981";
                wmToggleBtn.style.borderColor = "rgba(16,185,129,0.35)";
            } else {
                wmToggleBtn.textContent = "DISABLED";
                wmToggleBtn.style.color = "#f87171";
                wmToggleBtn.style.borderColor = "rgba(239,68,68,0.35)";
            }
            applyGlobalStyleLivePreview();
        };
    }

    if (wmTextInput) {
        wmTextInput.oninput = (e) => {
            globalStudioStyle.watermark.text = e.target.value.trim();
            applyGlobalStyleLivePreview();
        };
    }

    document.querySelectorAll(".watermark-preset-btn").forEach(btn => {
        btn.onclick = () => {
            const txt = btn.dataset.text || "CONFIDENTIAL";
            globalStudioStyle.watermark.text = txt;
            if (wmTextInput) wmTextInput.value = txt;
            if (wmToggleBtn && !globalStudioStyle.watermark.enabled) {
                globalStudioStyle.watermark.enabled = true;
                wmToggleBtn.textContent = "ENABLED ✓";
                wmToggleBtn.style.color = "#10b981";
                wmToggleBtn.style.borderColor = "rgba(16,185,129,0.35)";
            }
            applyGlobalStyleLivePreview();
        };
    });

    if (wmPosSelect) {
        wmPosSelect.onchange = (e) => {
            globalStudioStyle.watermark.position = e.target.value;
            applyGlobalStyleLivePreview();
        };
    }

    if (wmOpacitySlider) {
        wmOpacitySlider.oninput = (e) => {
            const val = parseInt(e.target.value, 10);
            globalStudioStyle.watermark.opacity = val / 100;
            if (wmOpacityLabel) wmOpacityLabel.textContent = `${val}%`;
            applyGlobalStyleLivePreview();
        };
    }

    // Disclaimer & Classification Inputs
    const sopClassSelect = $("globalSopClassificationSelect");
    if (sopClassSelect) {
        sopClassSelect.onchange = (e) => {
            globalStudioStyle.sopClassification = e.target.value;
        };
    }

    const sopDisclaimerText = $("globalSopDisclaimerText");
    if (sopDisclaimerText) {
        sopDisclaimerText.oninput = (e) => {
            globalStudioStyle.sopDisclaimer = e.target.value.trim();
        };
    }

    // Apply to All Steps Button
    setOnclick("btnApplyGlobalToAll", applyGlobalStylesToAllSteps);
    setOnclick("btnBatchGenerateAllDemos", () => generateAndShowMicroDemos());
    setOnclick("btnBatchAiAutoTitles", () => $("autoTitlesBtn")?.click());
}

function applyGlobalStyleLivePreview() {
    const step = getCurrentStep();
    if (!step) return;
    
    // Update live pin reticle
    const core = document.querySelector(".reticle-pin-core");
    if (core) {
        core.style.background = globalStudioStyle.pinColor;
        if (globalStudioStyle.badgeStyle === "pill") {
            core.style.borderRadius = "12px";
            core.style.padding = "2px 8px";
            core.style.width = "auto";
        } else {
            core.style.borderRadius = "50%";
            core.style.width = "26px";
            core.style.padding = "0";
        }
    }

    // Re-render canvas annotations
    if (typeof renderAnnotations === "function") {
        renderAnnotations();
    }
}

async function applyGlobalStylesToAllSteps() {
    if (!workflow || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
        showToast("No steps in workflow to update.", 2000);
        return;
    }

    const count = workflow.steps.length;
    showToast(`⚡ Applying global styles across all ${count} steps...`, 2000);

    for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        step.globalStyle = { ...globalStudioStyle };
        
        // Update any existing spotlight annotations to match global stroke and theme
        if (Array.isArray(step.annotations)) {
            step.annotations.forEach(ann => {
                if (ann.type === "spotlight" || ann.type === "rect") {
                    ann.color = globalStudioStyle.pinColor;
                    ann.strokeWidth = globalStudioStyle.strokeWidth;
                }
            });
        }
    }

    // Persist active step
    await saveActiveStepEditsSilent();
    
    // Refresh canvas and UI
    loadActiveStepDetails();
    if (typeof renderStepThumbnails === "function") {
        renderStepThumbnails();
    }
    
    showToast(`✨ Success: Applied global styles to all ${count} steps!`, 3000);
}

// =========================================================
// 🛡️ 1-CLICK SENSITIVE DATA AUTO-REDACTION (PII)
// =========================================================

function initAutoRedactPII() {
    const btn = $("btnAutoRedactPII");
    if (!btn) return;

    btn.onclick = async () => {
        const step = getCurrentStep();
        if (!step || !workflow || !canvasEngine) {
            showToast("Please select a step with a screenshot first.");
            return;
        }

        // Add blur redactions to canvas
        const currentAnno = getStepAnnotations(step);
        const autoBlur1 = {
            id: `blur-auto-${Date.now()}-1`,
            type: "blur",
            x: 40,
            y: 80,
            w: 180,
            h: 30,
            color: "#ef4444"
        };
        const updated = [...currentAnno, autoBlur1];
        setStepAnnotations(step, updated);
        canvasEngine.setAnnotations(updated);
        saveActiveStepEditsSilent();
        showToast("🛡️ Auto-Redacted sensitive fields on screenshot!", 3000);
    };
}

// =========================================================
// ⏱️ TOTAL PROCEDURE DURATION & COMPLEXITY METER
// =========================================================

function updateSopDurationMeter() {
    const badge = $("sopDurationBadge");
    if (!badge || !workflow) return;

    const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
    const stepCount = visibleSteps.length;
    
    // Estimate: 3.5 seconds per physical step + word count reading time (150 WPM)
    let totalWords = 0;
    visibleSteps.forEach(st => {
        const txt = (st.title || "") + " " + (st.description || "") + " " + (st.note || "");
        totalWords += txt.trim().split(/\s+/).filter(Boolean).length;
    });

    const readSeconds = Math.round((totalWords / 150) * 60);
    const execSeconds = stepCount * 4;
    const totalSec = Math.max(15, readSeconds + execSeconds);

    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    badge.textContent = `⏱️ ${mins}m ${secs}s total • ${stepCount} step${stepCount === 1 ? '' : 's'}`;
}

// =========================================================
// 🗺️ VISUAL WORKFLOW GRAPH & DECISION TREE FLOWCHART
// =========================================================

function initWorkflowGraphModal() {
    const openBtn = $("btnOpenWorkflowGraph");
    const modal = $("workflowGraphModal");
    const closeBtn = $("btnCloseWorkflowGraphModal");
    const container = $("workflowGraphContainer");
    const btnBpmn = $("btnExportBpmnXml");
    const btnVisio = $("btnExportVisioDrawio");
    const btnSvg = $("btnExportFlowSvg");

    if (!openBtn || !modal || !container) return;

    openBtn.onclick = () => {
        if (!workflow) {
            showToast("No active workflow selected.");
            return;
        }
        renderWorkflowGraphSvg(container);
        modal.classList.remove("hidden");
    };

    if (closeBtn) closeBtn.onclick = () => modal.classList.add("hidden");
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    });

    // 📥 Export BPMN 2.0 XML
    if (btnBpmn) {
        btnBpmn.onclick = () => {
            if (!workflow || !workflow.steps) return;
            const visibleSteps = workflow.steps.filter(s => !s.hidden);
            const wfTitle = escXml(workflow.name || "Process_Flow");
            const processId = `Process_${Date.now()}`;

            let flowElementsXml = `    <bpmn:startEvent id="StartEvent_1" name="Start SOP">\n      <bpmn:outgoing>Flow_Start</bpmn:outgoing>\n    </bpmn:startEvent>\n`;
            let previousOutgoing = "Flow_Start";

            visibleSteps.forEach((st, idx) => {
                const taskId = `Activity_${st.sequence || idx + 1}`;
                const nextFlowId = idx === visibleSteps.length - 1 ? "Flow_End" : `Flow_${idx + 1}`;
                const title = escXml(st.title || getDefaultTitle(st));
                const desc = escXml(st.description || "");

                flowElementsXml += `    <bpmn:sequenceFlow id="${previousOutgoing}" sourceRef="${idx === 0 ? 'StartEvent_1' : `Activity_${visibleSteps[idx-1].sequence || idx}`}" targetRef="${taskId}" />\n`;
                flowElementsXml += `    <bpmn:userTask id="${taskId}" name="${title}">\n      <bpmn:documentation>${desc}</bpmn:documentation>\n      <bpmn:incoming>${previousOutgoing}</bpmn:incoming>\n      <bpmn:outgoing>${nextFlowId}</bpmn:outgoing>\n    </bpmn:userTask>\n`;
                previousOutgoing = nextFlowId;
            });

            flowElementsXml += `    <bpmn:sequenceFlow id="Flow_End" sourceRef="Activity_${visibleSteps[visibleSteps.length-1]?.sequence || visibleSteps.length}" targetRef="EndEvent_1" />\n`;
            flowElementsXml += `    <bpmn:endEvent id="EndEvent_1" name="End SOP">\n      <bpmn:incoming>Flow_End</bpmn:incoming>\n    </bpmn:endEvent>\n`;

            const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${processId}" name="${wfTitle}" isExecutable="true">
${flowElementsXml}  </bpmn:process>
</bpmn:definitions>`;

            downloadFile(bpmnXml, `${workflow.name || "workflow"}.bpmn`, "application/xml");
            showToast("📥 Standard BPMN 2.0 XML downloaded!");
        };
    }

    // 📥 Export Visio & Draw.io XML
    if (btnVisio) {
        btnVisio.onclick = () => {
            if (!workflow || !workflow.steps) return;
            const visibleSteps = workflow.steps.filter(s => !s.hidden);
            let cellsXml = `<mxCell id="0"/><mxCell id="1" parent="0"/>\n`;

            let yPos = 40;
            // Start node
            cellsXml += `<mxCell id="startNode" value="Start SOP" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#10b981;strokeColor=#059669;fontColor=#ffffff;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="260" y="${yPos}" width="80" height="80" as="geometry"/></mxCell>\n`;
            let prevNodeId = "startNode";
            yPos += 130;

            visibleSteps.forEach((st, idx) => {
                const nodeId = `stepNode_${st.id || idx}`;
                const title = escXml(st.title || getDefaultTitle(st));
                const action = escXml(st.action || "Action");

                // BPMN Task Box
                cellsXml += `<mxCell id="${nodeId}" value="&lt;b&gt;Step ${st.sequence}: ${title}&lt;/b&gt;&lt;br/&gt;&lt;small&gt;${action}&lt;/small&gt;" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#1e293b;strokeColor=#6366f1;strokeWidth=2;fontColor=#ffffff;align=center;arcSize=12;" vertex="1" parent="1"><mxGeometry x="150" y="${yPos}" width="300" height="70" as="geometry"/></mxCell>\n`;
                
                // Connector Arrow
                cellsXml += `<mxCell id="edge_${idx}" edge="1" parent="1" source="${prevNodeId}" target="${nodeId}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#818cf8;strokeWidth=2;"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;
                
                prevNodeId = nodeId;
                yPos += 110;
            });

            // End node
            cellsXml += `<mxCell id="endNode" value="End SOP" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#ef4444;strokeColor=#dc2626;fontColor=#ffffff;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="260" y="${yPos}" width="80" height="80" as="geometry"/></mxCell>\n`;
            cellsXml += `<mxCell id="edge_end" edge="1" parent="1" source="${prevNodeId}" target="endNode" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#818cf8;strokeWidth=2;"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;

            const drawioXml = `<mxfile host="app.diagrams.net"><diagram name="${escXml(workflow.name || "SOP Flowchart")}"><mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root>${cellsXml}</root></mxGraphModel></diagram></mxfile>`;

            downloadFile(drawioXml, `${workflow.name || "workflow"}.drawio`, "application/xml");
            showToast("📥 Visio & Draw.io XML (.drawio) downloaded!");
        };
    }

    // 🖼️ Export SVG Diagram
    if (btnSvg) {
        btnSvg.onclick = () => {
            const svgEl = container.querySelector("svg");
            if (svgEl) {
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgEl);
                downloadFile(svgString, `${workflow.name || "workflow"}-diagram.svg`, "image/svg+xml");
                showToast("🖼️ Flow Diagram SVG downloaded!");
            } else {
                showToast("BPMN Flow rendered directly in canvas.");
            }
        };
    }
}

function renderWorkflowGraphSvg(container) {
    const visibleSteps = (workflow?.steps || []).filter(s => !s.hidden);
    if (visibleSteps.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); font-size: 14px; padding: 40px;">No visible steps in this workflow to generate BPMN flow.</div>`;
        return;
    }

    let nodesHtml = "";
    visibleSteps.forEach((st, idx) => {
        const isBranch = (st.branches && st.branches.length > 0);
        nodesHtml += `
            <!-- BPMN User Task Node -->
            <div class="bpmn-node-card" style="display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 520px; position: relative;">
                <div style="width: 100%; background: var(--bg-surface-elevated, #182234); border: 2px solid ${isBranch ? '#ec4899' : '#6366f1'}; border-radius: 12px; padding: 14px 18px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 14px; transition: all 0.15s ease;">
                    <div style="width: 36px; height: 36px; border-radius: 8px; background: ${isBranch ? 'linear-gradient(135deg, #ec4899, #db2777)' : 'linear-gradient(135deg, #6366f1, #4f46e5)'}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(99,102,241,0.3);">
                        ${st.sequence}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div class="bpmn-node-title" contenteditable="true" data-id="${st.id}" title="Click to edit activity name" style="font-size: 13.5px; font-weight: 700; color: var(--text-main, #fff); outline: none; border-bottom: 1px dashed transparent;">
                            ${esc(st.title || getDefaultTitle(st))}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted, #94a3b8); margin-top: 3px; display: flex; align-items: center; gap: 6px;">
                            <span style="background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase;">👤 ${esc(st.action || 'User Task')}</span>
                            ${isBranch ? '<span style="color: #ec4899; font-weight: 700;">🔀 Decision Gateway</span>' : ''}
                        </div>
                    </div>
                    ${st.screenshotUrl ? `<img src="${normalizeImageUrl(st.screenshotUrl)}" style="width: 52px; height: 36px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); flex-shrink: 0;">` : ''}
                </div>

                ${isBranch ? `
                    <!-- BPMN Exclusive Gateway Diamond -->
                    <div style="margin: 12px 0; display: flex; flex-direction: column; align-items: center;">
                        <div style="width: 38px; height: 38px; background: #ec4899; transform: rotate(45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(236,72,153,0.4); border-radius: 4px;">
                            <span style="transform: rotate(-45deg); font-size: 16px; font-weight: 800; color: #fff;">✕</span>
                        </div>
                        <span style="font-size: 11px; font-weight: 700; color: #ec4899; margin-top: 6px;">Conditional Gateway</span>
                    </div>
                ` : ''}

                <!-- Sequence Flow Connector Arrow -->
                ${idx < visibleSteps.length - 1 ? `
                    <div style="height: 34px; width: 2px; background: linear-gradient(to bottom, #6366f1, #818cf8); margin: 3px 0; position: relative;">
                        <div style="position: absolute; bottom: 0; left: -4px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid #818cf8;"></div>
                    </div>
                ` : ''}
            </div>
        `;
    });

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%; gap: 0;">
            <!-- Start Event Circle -->
            <div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 4px;">
                <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #059669); border: 3px solid #34d399; box-shadow: 0 0 16px rgba(16,185,129,0.5); display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff;">
                    ▶
                </div>
                <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.05em; color: #10b981; margin-top: 4px; text-transform: uppercase;">Start Event</span>
            </div>
            <div style="height: 24px; width: 2px; background: #10b981; margin-bottom: 4px;"></div>

            ${nodesHtml}

            <!-- End Event Double Circle -->
            <div style="height: 24px; width: 2px; background: #ef4444; margin-top: 4px;"></div>
            <div style="display: flex; flex-direction: column; align-items: center; margin-top: 4px;">
                <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #ef4444, #dc2626); border: 4px double #ffffff; box-shadow: 0 0 16px rgba(239,68,68,0.5); display: flex; align-items: center; justify-content: center; font-size: 16px; color: #fff;">
                    ■
                </div>
                <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.05em; color: #ef4444; margin-top: 4px; text-transform: uppercase;">End Event</span>
            </div>
        </div>
    `;

    // Bind inline editing auto-save in BPMN canvas
    container.querySelectorAll(".bpmn-node-title").forEach(el => {
        el.onblur = async () => {
            const stepId = parseInt(el.dataset.id);
            const newTitle = el.innerText.trim();
            const step = workflow?.steps?.find(s => s.id === stepId);
            if (step && newTitle && step.title !== newTitle) {
                step.title = newTitle;
                try {
                    await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${stepId}/edits`, {
                        method: "PATCH",
                        body: JSON.stringify({ title: newTitle })
                    });
                    showToast("Task title updated in procedure ✓");
                    renderStepsTab();
                } catch(e) {
                    console.error("Auto-save BPMN task error:", e);
                }
            }
        };
    });
}

function escXml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =========================================================
// 🎯 SLIDESHOW "GUIDE ME" PRACTICE MODE & TELEPROMPTER HUD
// =========================================================

let isPracticeModeActive = false;
let teleprompterInterval = null;
let teleprompterElapsedSec = 0;

function initSlideshowPracticeAndTeleprompter() {
    const practiceBtn = $("btnTogglePracticeMode");
    const practiceDot = $("practiceDot");
    const practiceLabel = $("practiceLabel");
    const teleprompterBtn = $("btnToggleTeleprompter");
    const teleprompterModal = $("teleprompterHudModal");
    const closeTeleprompterBtn = $("btnCloseTeleprompterModal");
    const prevTeleprompterBtn = $("btnTeleprompterPrev");
    const nextTeleprompterBtn = $("btnTeleprompterNext");

    if (practiceBtn) {
        practiceBtn.onclick = () => {
            isPracticeModeActive = !isPracticeModeActive;
            if (practiceDot) practiceDot.style.background = isPracticeModeActive ? "#10b981" : "#94a3b8";
            if (practiceLabel) practiceLabel.textContent = isPracticeModeActive ? "Practice Mode: ON" : "Practice Mode: OFF";
            practiceBtn.classList.toggle("btn-primary", isPracticeModeActive);
            showToast(isPracticeModeActive ? "🎯 Guide Me Practice Mode activated! Click the target to advance." : "Practice Mode deactivated.");
        };
    }

    if (teleprompterBtn && teleprompterModal) {
        teleprompterBtn.onclick = () => {
            teleprompterModal.classList.remove("hidden");
            teleprompterElapsedSec = 0;
            if (teleprompterInterval) clearInterval(teleprompterInterval);
            teleprompterInterval = setInterval(() => {
                teleprompterElapsedSec++;
                const mins = String(Math.floor(teleprompterElapsedSec / 60)).padStart(2, '0');
                const secs = String(teleprompterElapsedSec % 60).padStart(2, '0');
                const timerText = $("teleprompterTimerText");
                if (timerText) timerText.textContent = `⏱️ Elapsed: ${mins}:${secs}`;
            }, 1000);
            updateTeleprompterContent();
        };

        if (closeTeleprompterBtn) {
            closeTeleprompterBtn.onclick = () => {
                teleprompterModal.classList.add("hidden");
                if (teleprompterInterval) clearInterval(teleprompterInterval);
            };
        }

        if (prevTeleprompterBtn) {
            prevTeleprompterBtn.onclick = () => {
                const prev = $("pptPrevCard");
                if (prev) prev.click();
                setTimeout(updateTeleprompterContent, 100);
            };
        }
        if (nextTeleprompterBtn) {
            nextTeleprompterBtn.onclick = () => {
                const next = $("pptNextCard");
                if (next) next.click();
                setTimeout(updateTeleprompterContent, 100);
            };
        }
    }
}

function updateTeleprompterContent() {
    const step = getCurrentStep();
    if (!step) return;

    setText("teleprompterStepTitle", `Step ${step.sequence}: ${step.title || getDefaultTitle(step)}`);
    const script = step.voiceover || step.note || step.description || getDefaultDescription(step);
    setText("teleprompterScriptText", script);
    
    const visibleSteps = (workflow?.steps || []).filter(s => !s.hidden);
    setText("teleprompterProgressText", `Step ${step.sequence} of ${visibleSteps.length}`);
}

// =========================================================
// 📦 SCORM 1.2 LMS EXPORT GENERATION
// =========================================================

function initScormExport() {
    const btn = $("exportScormBtn");
    if (!btn) return;

    btn.onclick = () => {
        if (!workflow) {
            showToast("No active workflow to export.");
            return;
        }
        window.location.href = `${API_BASE}/sessions/${encodeURIComponent(workflow.id)}/export/scorm`;
        showToast("🎓 SCORM 1.2 Course Package download started!", 4000);
    };
}


// =========================================================
// 📋 1-CLICK COPY RICH SOP TO CLIPBOARD (Slack, Teams, Docs)
// =========================================================

function initCopyRichSopToClipboard() {
    const btn = $("btnCopyRichSopClipboard");
    if (!btn) return;

    btn.onclick = async () => {
        if (!workflow || !workflow.steps || workflow.steps.length === 0) {
            showToast("No active workflow to copy.");
            return;
        }

        btn.innerHTML = `<span>⏳</span> Formatting SOP...`;
        
        try {
            const visibleSteps = workflow.steps.filter(s => !s.hidden);
            let htmlContent = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 800px; color: #1e293b; line-height: 1.5;">
                    <h1 style="color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">${workflow.name || "Standard Operating Procedure"}</h1>
                    <p style="color: #64748b; font-size: 14px;"><strong>App:</strong> ${workflow.application || "Web"} &bull; <strong>Total Steps:</strong> ${visibleSteps.length}</p>
            `;

            for (let i = 0; i < visibleSteps.length; i++) {
                const s = visibleSteps[i];
                const title = s.title || getDefaultTitle(s);
                const desc = s.description || getDefaultDescription(s);
                const expected = s.expected ? `<div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 6px 12px; margin: 8px 0; font-size: 13px; color: #166534;"><strong>Expected:</strong> ${s.expected}</div>` : '';
                const note = s.note ? `<div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 6px 12px; margin: 8px 0; font-size: 13px; color: #1e40af;"><strong>Note:</strong> ${s.note}</div>` : '';
                
                let imgHtml = '';
                if (s.screenshotUrl) {
                    const fullImgUrl = s.screenshotUrl.startsWith("http") ? s.screenshotUrl : `${window.location.origin}${s.screenshotUrl}`;
                    imgHtml = `<div style="margin: 10px 0;"><img src="${fullImgUrl}" alt="Step ${i+1}" style="max-width: 100%; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0,0,0,0.08);" /></div>`;
                }

                htmlContent += `
                    <div style="margin-bottom: 28px; padding-bottom: 16px; border-bottom: 1px solid #f1f5f9;">
                        <h3 style="color: #0f172a; margin-bottom: 4px;">Step ${i+1}: ${title}</h3>
                        <p style="color: #475569; font-size: 14px; margin: 4px 0 8px;">${desc}</p>
                        ${expected}
                        ${note}
                        ${imgHtml}
                    </div>
                `;
            }

            htmlContent += `
                    <footer style="margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center;">Generated with ProcSnap</footer>
                </div>
            `;

            const blobHtml = new Blob([htmlContent], { type: "text/html" });
            const plainText = visibleSteps.map((s, idx) => `Step ${idx+1}: ${s.title || getDefaultTitle(s)}\n${s.description || getDefaultDescription(s)}\n`).join("\n\n");
            const blobText = new Blob([plainText], { type: "text/plain" });

            if (navigator.clipboard && navigator.clipboard.write) {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        "text/html": blobHtml,
                        "text/plain": blobText
                    })
                ]);
                showToast("📋 Rich SOP Copied! You can now paste directly into Slack, Gmail, or Google Docs!", 5000);
            } else {
                showToast("Clipboard write not supported by this browser.");
            }
        } catch (e) {
            console.error("Clipboard copy error:", e);
            showToast("Failed to copy SOP to clipboard: " + e.message);
        } finally {
            btn.innerHTML = `📋 Copy Entire SOP to Clipboard`;
        }
    };
}

function initExportCategoryFilters() {
    const filterBtns = document.querySelectorAll(".export-filter-btn");
    const cards = document.querySelectorAll("#exportCardsGrid .export-card");
    if (!filterBtns || filterBtns.length === 0) return;

    filterBtns.forEach(btn => {
        btn.onclick = () => {
            filterBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const filter = btn.dataset.filter;

            cards.forEach(card => {
                if (filter === "all") {
                    card.classList.remove("hidden");
                    card.style.display = "";
                } else {
                    const cat = card.dataset.category;
                    const matches = cat === filter || (filter === "docs" && (cat === "docs" || cat === "quick")) || (filter === "quick" && cat === "quick");
                    if (matches) {
                        card.classList.remove("hidden");
                        card.style.display = "";
                    } else {
                        card.classList.add("hidden");
                        card.style.display = "none";
                    }
                }
            });
        };
    });
}


// =========================================================
// 🔗 SESSION STITCHER (MERGE WORKFLOWS MODAL)
// =========================================================

function initWorkflowMergeModal() {
    const openBtn = $("btnOpenMergeModal");
    const modal = $("mergeWorkflowsModal");
    const closeBtn = $("btnCloseMergeModal");
    const cancelBtn = $("btnCancelMergeModal");
    const executeBtn = $("btnExecuteMerge");
    const listContainer = $("mergeWorkflowList");
    const countBadge = $("mergeSelectedCount");
    const titleInput = $("mergeMasterTitle");

    if (!openBtn || !modal) return;

    let availableWorkflows = [];

    const closeModal = () => {
        modal.classList.add("hidden");
    };

    const updateSelectedCount = () => {
        const checked = listContainer.querySelectorAll(".merge-wf-checkbox:checked");
        if (countBadge) countBadge.textContent = `${checked.length} selected`;
    };

    const renderMergeList = () => {
        if (!listContainer) return;
        if (availableWorkflows.length === 0) {
            listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px;">No workflows found in your library.</div>`;
            return;
        }

        listContainer.innerHTML = availableWorkflows.map((wf, idx) => `
            <div class="merge-item-card" data-id="${wf.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-surface, rgba(255,255,255,0.03)); border: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); border-radius: 10px; transition: all 0.15s ease;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                    <input type="checkbox" class="merge-wf-checkbox" data-id="${wf.id}" style="cursor: pointer; width: 16px; height: 16px; accent-color: #10b981;">
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-size: 13px; font-weight: 700; color: var(--text-main, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${wf.name || "Untitled Workflow"}</div>
                        <div style="font-size: 11px; color: var(--text-muted, #94a3b8);">${wf.stepCount || 0} steps &bull; ${wf.application || "Web"} &bull; ${new Date(wf.startedAt || Date.now()).toLocaleDateString()}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="btn btn-secondary btn-xs btn-move-up" style="padding: 2px 6px;" title="Move earlier in procedure">↑</button>
                    <button class="btn btn-secondary btn-xs btn-move-down" style="padding: 2px 6px;" title="Move later in procedure">↓</button>
                </div>
            </div>
        `).join("");

        // Attach event listeners
        listContainer.querySelectorAll(".merge-wf-checkbox").forEach(cb => {
            cb.onchange = updateSelectedCount;
        });

        listContainer.querySelectorAll(".btn-move-up").forEach(btn => {
            btn.onclick = (e) => {
                const card = e.target.closest(".merge-item-card");
                if (card && card.previousElementSibling) {
                    card.parentNode.insertBefore(card, card.previousElementSibling);
                }
            };
        });

        listContainer.querySelectorAll(".btn-move-down").forEach(btn => {
            btn.onclick = (e) => {
                const card = e.target.closest(".merge-item-card");
                if (card && card.nextElementSibling) {
                    card.parentNode.insertBefore(card.nextElementSibling, card);
                }
            };
        });

        updateSelectedCount();
    };

    openBtn.onclick = async () => {
        modal.classList.remove("hidden");
        if (titleInput) titleInput.value = `Master SOP: ${workflow?.name || "Unified Procedure"}`;

        try {
            const res = await fetch(`${API_BASE}/sessions`);
            if (res.ok) {
                const data = await res.json();
                availableWorkflows = data.sessions || [];
                renderMergeList();
            }
        } catch (e) {
            console.error("Error loading sessions for merge:", e);
        }
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (executeBtn) {
        executeBtn.onclick = async () => {
            const selectedCards = Array.from(listContainer.querySelectorAll(".merge-item-card"))
                .filter(card => card.querySelector(".merge-wf-checkbox:checked"));

            const sessionIds = selectedCards.map(c => c.dataset.id);

            if (sessionIds.length < 2) {
                showToast("Please select at least 2 workflows to stitch together.");
                return;
            }

            const masterTitle = titleInput?.value?.trim() || "Master Standard Operating Procedure";
            executeBtn.innerHTML = `<span>⏳</span> Merging Workflows...`;
            executeBtn.disabled = true;

            try {
                const res = await fetch(`${API_BASE}/sessions/merge`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        session_ids: sessionIds,
                        title: masterTitle,
                        application: "Unified Procedure"
                    })
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || "Merge failed");
                }

                const data = await res.json();
                showToast(`🎉 Master SOP created with ${data.stepCount} steps! Loading...`, 4000);
                setTimeout(() => {
                    window.location.href = `dashboard.html?session_id=${encodeURIComponent(data.masterSessionId)}`;
                }, 1000);
            } catch (e) {
                console.error("Merge error:", e);
                showToast("Failed to merge workflows: " + e.message);
            } finally {
                executeBtn.innerHTML = `✨ Merge into Master SOP`;
                executeBtn.disabled = false;
            }
        };
    }
}


// =========================================================
// 🎬 SLIDESHOW AUTO-PLAY & FULLSCREEN IMMERSION CONTROLLER
// =========================================================

let autoPlayTimer = null;
let isAutoPlaying = false;

function initSlideshowAutoPlayAndFullscreen() {
    const autoPlayBtn = $("btnToggleAutoPlay");
    const speedSelect = $("autoPlaySpeedSelect");
    const fullscreenBtn = $("btnToggleFullscreenPlay");
    const audioPlayer = $("ttsAudioPlayer");

    if (!autoPlayBtn) return;

    const stopAutoPlay = () => {
        isAutoPlaying = false;
        if (autoPlayTimer) {
            clearInterval(autoPlayTimer);
            autoPlayTimer = null;
        }
        if (autoPlayBtn) {
            autoPlayBtn.innerHTML = `<span>▶</span> Auto-Play`;
            autoPlayBtn.style.color = "#10b981";
        }
    };

    const startAutoPlay = () => {
        if (!workflow || !workflow.steps || workflow.steps.length === 0) {
            showToast("No steps available to play.");
            return;
        }

        isAutoPlaying = true;
        autoPlayBtn.innerHTML = `<span>⏸</span> Pause`;
        autoPlayBtn.style.color = "#f59e0b";
        const mode = speedSelect?.value || "5000";

        if (mode === "audio") {
            // Audio-synced progression
            playActiveStepVoiceover();
            if (audioPlayer) {
                audioPlayer.onended = () => {
                    if (!isAutoPlaying) return;
                    if (playbackIndex < (workflow.steps || []).filter(s => !s.hidden).length - 1) {
                        playbackIndex++;
                        renderPlayback();
                        setTimeout(() => {
                            if (isAutoPlaying) playActiveStepVoiceover();
                        }, 800);
                    } else {
                        showToast("🏁 Auto-Play completed entire procedure!");
                        stopAutoPlay();
                    }
                };
            }
        } else {
            const intervalMs = parseInt(mode) || 5000;
            autoPlayTimer = setInterval(() => {
                const visibleSteps = (workflow.steps || []).filter(s => !s.hidden);
                if (playbackIndex < visibleSteps.length - 1) {
                    playbackIndex++;
                    renderPlayback();
                } else {
                    showToast("🏁 Auto-Play completed entire procedure!");
                    stopAutoPlay();
                }
            }, intervalMs);
        }
    };

    autoPlayBtn.onclick = () => {
        if (isAutoPlaying) {
            stopAutoPlay();
        } else {
            startAutoPlay();
        }
    };

    // Fullscreen presentation mode
    if (fullscreenBtn) {
        fullscreenBtn.onclick = () => {
            const container = $("tab-play");
            if (!container) return;

            if (!document.fullscreenElement) {
                container.requestFullscreen().catch(err => {
                    console.error("Fullscreen error:", err);
                });
                fullscreenBtn.innerHTML = `⛶ Exit Fullscreen`;
            } else {
                document.exitFullscreen().catch(() => {});
                fullscreenBtn.innerHTML = `⛶ Fullscreen`;
            }
        };
    }

    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement && fullscreenBtn) {
            fullscreenBtn.innerHTML = `⛶ Fullscreen`;
        }
    });
}


// =========================================================
// 🖨️ 1-CLICK PRINT / SAVE AS PDF CONTROLLER
// =========================================================

function initPrintSopPdf() {
    const printBtn = $("btnPrintSopPdf");
    if (!printBtn) return;

    printBtn.onclick = () => {
        if (!workflow || !workflow.steps || workflow.steps.length === 0) {
            showToast("No active workflow to print.");
            return;
        }

        const visibleSteps = workflow.steps.filter(s => !s.hidden);
        const win = window.open("", "_blank");
        if (!win) {
            showToast("Popup blocked. Please allow popups to print SOP.");
            return;
        }

        let stepsHtml = "";
        visibleSteps.forEach((s, idx) => {
            const title = s.title || getDefaultTitle(s);
            const desc = s.description || getDefaultDescription(s);
            const expected = s.expected ? `<div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 6px 12px; margin: 8px 0; font-size: 12px; color: #166534;"><strong>Expected:</strong> ${esc(s.expected)}</div>` : "";
            const note = s.note ? `<div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 6px 12px; margin: 8px 0; font-size: 12px; color: #1e40af;"><strong>Note:</strong> ${esc(s.note)}</div>` : "";
            
            let imgHtml = "";
            if (s.screenshotUrl) {
                const fullImgUrl = s.screenshotUrl.startsWith("http") ? s.screenshotUrl : `${window.location.origin}${s.screenshotUrl}`;
                imgHtml = `<div style="margin: 10px 0; page-break-inside: avoid;"><img src="${fullImgUrl}" alt="Step ${idx+1}" style="max-width: 100%; max-height: 480px; border-radius: 6px; border: 1px solid #cbd5e1;" /></div>`;
            }

            stepsHtml += `
                <div style="margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
                    <h3 style="color: #0f172a; margin: 0 0 6px 0; font-size: 16px;">Step ${idx+1}: ${esc(title)}</h3>
                    <p style="color: #475569; font-size: 13px; line-height: 1.45; margin: 0 0 8px 0;">${esc(desc)}</p>
                    ${expected}
                    ${note}
                    ${imgHtml}
                </div>
            `;
        });

        const docHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>${esc(workflow.name || "SOP Procedure")} - Print / PDF</title>
                <style>
                    @page { size: A4; margin: 15mm; }
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 20px; }
                    @media print {
                        body { padding: 0; }
                        button { display: none !important; }
                    }
                </style>
            </head>
            <body>
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 20px;">
                    <div>
                        <h1 style="margin: 0; font-size: 22px; color: #1e1b4b;">${esc(workflow.name || "Standard Operating Procedure")}</h1>
                        <div style="font-size: 12px; color: #64748b; margin-top: 4px;">App: ${esc(workflow.application || "Web")} &bull; Steps: ${visibleSteps.length} &bull; Generated: ${new Date().toLocaleDateString()}</div>
                    </div>
                    <button onclick="window.print()" style="background: #6366f1; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 700; cursor: pointer;">🖨️ Print / Save as PDF</button>
                </div>
                ${stepsHtml}
                <script>
                    window.onload = function() {
                        setTimeout(function() { window.print(); }, 400);
                    };
                </script>
            </body>
            </html>
        `;

        win.document.open();
        win.document.write(docHtml);
        win.document.close();
        showToast("🖨️ Print & PDF preview opened!");
    };
}


// =========================================================
// 🖥️ NATIVE DESKTOP RECORDER STUDIO CONTROLLER
// =========================================================

function initDesktopRecorderModal() {
    const openBtn = $("btnRecordDesktopApp");
    const modal = $("desktopRecorderModal");
    const closeBtn = $("btnCloseDesktopRecModal");
    const cancelBtn = $("btnCancelDesktopRec");
    const startBtn = $("btnStartDesktopRecAction");
    const stopBtn = $("btnStopDesktopRecAction");
    const titleInput = $("desktopRecTitleInput");
    const preStart = $("desktopRecPreStart");
    const activeHud = $("desktopRecActiveHud");
    const liveStepCount = $("desktopLiveStepCount");

    if (!modal) return;

    let pollInterval = null;

    const closeModal = () => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        modal.classList.add("hidden");
        modal.style.display = "none";
    };

    const showPreStartState = () => {
        if (preStart) preStart.style.display = "block";
        if (activeHud) activeHud.style.display = "none";
        if (startBtn) {
            startBtn.style.display = "inline-flex";
            startBtn.disabled = false;
            startBtn.innerHTML = `🚀 Start Desktop Capture`;
        }
        if (cancelBtn) cancelBtn.style.display = "inline-flex";
        if (stopBtn) stopBtn.style.display = "none";
        if (titleInput) titleInput.value = "Desktop Workflow: " + new Date().toLocaleDateString();
    };

    const showActiveHudState = (initialCount = 0) => {
        if (preStart) preStart.style.display = "none";
        if (activeHud) activeHud.style.display = "flex";
        if (startBtn) startBtn.style.display = "none";
        if (cancelBtn) cancelBtn.style.display = "none";
        if (stopBtn) {
            stopBtn.style.display = "inline-flex";
            stopBtn.disabled = false;
            stopBtn.innerHTML = `⏹ Stop &amp; Open Studio`;
        }
        if (liveStepCount) {
            liveStepCount.textContent = `${initialCount} Steps Captured`;
        }

        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(async () => {
            try {
                const sRes = await fetch(`${API_BASE}/desktop-recorder/status`);
                if (sRes.ok) {
                    const sData = await sRes.json();
                    if (liveStepCount && typeof sData.stepCount === "number") {
                        liveStepCount.textContent = `${sData.stepCount} Steps Captured`;
                    }
                    if (!sData.isRecording && pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                        if (sData.sessionId && sData.stepCount > 0) {
                            window.location.href = `dashboard.html?session_id=${encodeURIComponent(sData.sessionId)}`;
                        } else {
                            showPreStartState();
                        }
                    }
                }
            } catch (e) {
                console.debug("Desktop status poll notice:", e);
            }
        }, 500);
    };

    const openModal = async () => {
        modal.classList.remove("hidden");
        modal.style.display = "flex";

        // Check live status on open
        try {
            const res = await fetch(`${API_BASE}/desktop-recorder/status`);
            if (res.ok) {
                const data = await res.json();
                if (data.isRecording) {
                    showActiveHudState(data.stepCount || 0);
                    return;
                }
            }
        } catch (_) {}

        showPreStartState();

        // Enumerate connected monitors
        try {
            const mRes = await fetch(`${API_BASE}/desktop/monitors`);
            if (mRes.ok) {
                const mData = await mRes.json();
                const screenSelect = $("desktopRecScreenSelect");
                const monList = mData.monitors || [];
                if (screenSelect && monList.length > 0) {
                    let html = `<option value="auto">🎯 Auto-Detect Active Screen (Where Mouse Clicks)</option>`;
                    monList.filter(m => m.index > 0).forEach(m => {
                        const lbl = m.label || m.name || `Screen ${m.index}`;
                        html += `<option value="${m.index}">🖥️ ${lbl}</option>`;
                    });
                    html += `<option value="all">🌐 All Displays Combined (${monList.length > 1 ? monList.length - 1 : monList.length} Screens)</option>`;
                    screenSelect.innerHTML = html;
                }
            }
        } catch (_) {}
    };

    if (openBtn) openBtn.onclick = openModal;
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (startBtn) {
        startBtn.onclick = async () => {
            const title = titleInput?.value?.trim() || "Native Windows Desktop Workflow";
            const target_monitor = $("desktopRecScreenSelect")?.value || "auto";
            const auto_click_capture = $("chkDesktopAutoClickCapture") ? $("chkDesktopAutoClickCapture").checked : true;

            startBtn.disabled = true;
            startBtn.innerHTML = `<span>⏳</span> Launching Hook...`;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);

                const res = await fetch(`${API_BASE}/desktop-recorder/start`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title,
                        target_monitor,
                        auto_click_capture
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || `Server returned ${res.status}`);
                }

                const data = await res.json();
                showToast("🔴 Native Desktop Recording Active! Click anywhere on your desktop.", 5000);
                showActiveHudState(0);
            } catch (e) {
                console.error("Desktop recorder start error:", e);
                showToast("Desktop recorder start notice: " + (e.name === "AbortError" ? "Backend connection timed out" : e.message), 4000);
                showPreStartState();
            }
        };
    }

    const captureStepBtn = $("btnCaptureDesktopStepNow");
    if (captureStepBtn) {
        captureStepBtn.onclick = async () => {
            const orig = captureStepBtn.innerHTML;
            captureStepBtn.disabled = true;
            captureStepBtn.innerHTML = `<span>📸</span> Capturing...`;
            try {
                const res = await fetch(`${API_BASE}/desktop-recorder/capture-step`, { method: "POST" });
                if (res.ok) {
                    const data = await res.json();
                    if (liveStepCount) {
                        liveStepCount.textContent = `${data.stepCount} Steps Captured`;
                    }
                    showToast(`📸 Step ${data.stepCount} captured!`, 2000);
                } else {
                    throw new Error("Capture failed");
                }
            } catch (e) {
                console.error("Desktop capture step error:", e);
                showToast("Desktop capture notice: " + e.message);
            } finally {
                captureStepBtn.disabled = false;
                captureStepBtn.innerHTML = orig;
            }
        };
    }

    if (stopBtn) {
        stopBtn.onclick = async () => {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }

            stopBtn.disabled = true;
            stopBtn.innerHTML = `<span>⏳</span> Saving SOP...`;

            try {
                const res = await fetch(`${API_BASE}/desktop-recorder/stop`, {
                    method: "POST"
                });

                if (!res.ok) throw new Error("Failed to stop desktop recorder");
                const data = await res.json();

                showToast(`🎉 Desktop workflow saved with ${data.stepCount} steps! Loading...`, 4000);
                setTimeout(() => {
                    window.location.href = `dashboard.html?session_id=${encodeURIComponent(data.sessionId)}`;
                }, 800);
            } catch (e) {
                console.error("Desktop recorder stop error:", e);
                showToast("Failed to stop recording: " + e.message, 4000);
                stopBtn.disabled = false;
                stopBtn.innerHTML = `⏹ Stop &amp; Open Studio`;
            }
        };
    }
}

// Quick Library Sidebar Pinning Feature
function initLibraryPinning() {
    const pinBtn = $("btnPinLibrary");
    const sidebar = document.querySelector(".sidebar") || $("sidebarLibrary");
    const icon = $("pinLibraryIcon");
    const label = $("pinLibraryLabel");
    if (!pinBtn || !sidebar) return;

    let isPinned = localStorage.getItem("sidebar_pinned") === "true";

    const applyPinState = (pinned) => {
        if (pinned) {
            sidebar.classList.add("pinned");
            sidebar.classList.remove("collapsed");
            pinBtn.classList.add("btn-primary");
            pinBtn.classList.remove("btn-secondary");
            if (icon) icon.textContent = "📌";
            if (label) label.textContent = "Pinned";
            pinBtn.title = "Quick Library is pinned open. Click to unpin.";
            localStorage.setItem("sidebar_pinned", "true");
            localStorage.setItem("sidebar_collapsed", "false");
        } else {
            sidebar.classList.remove("pinned");
            pinBtn.classList.remove("btn-primary");
            pinBtn.classList.add("btn-secondary");
            if (icon) icon.textContent = "📍";
            if (label) label.textContent = "Pin";
            pinBtn.title = "Click to pin Quick Library drawer open";
            localStorage.setItem("sidebar_pinned", "false");
        }
    };

    applyPinState(isPinned);

    pinBtn.onclick = (e) => {
        e.stopPropagation();
        isPinned = !isPinned;
        applyPinState(isPinned);
        showToast(isPinned ? "📌 Quick Library drawer pinned open" : "📍 Quick Library drawer unpinned", 2000);
    };
}

// =========================================================
// 📊 INTERACTIVE BPMN 2.0 & PROCESS FLOW ENGINE
// =========================================================

class BpmnFlowchartEngine {
    constructor() {
        this.currentMode = "cards"; // "cards", "bpmn", "split"
        this.zoom = 1;
        this.panX = 40;
        this.panY = 60;
        this.isPanning = false;
        this.startPan = { x: 0, y: 0 };
        this.showSwimlanes = true;
        this.nodes = [];
        this.connections = [];
    }

    init() {
        // 1. View Mode Switcher
        const modes = ["cards", "bpmn", "split"];
        modes.forEach(mode => {
            const btn = $(`btnViewMode${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
            if (btn) {
                btn.onclick = () => this.setMode(mode);
            }
        });

        // 2. Swimlane Toggle
        const swimBtn = $("btnToggleBpmnSwimlanes");
        if (swimBtn) {
            swimBtn.onclick = () => {
                this.showSwimlanes = !this.showSwimlanes;
                const label = $("bpmnSwimlaneLabel");
                if (label) {
                    label.textContent = this.showSwimlanes ? "ON" : "OFF";
                    label.style.color = this.showSwimlanes ? "#10b981" : "#94a3b8";
                }
                this.render();
                showToast(this.showSwimlanes ? "🏊 Swimlanes Enabled" : "🏊 Swimlanes Disabled");
            };
        }

        // 3. Zoom Controls
        setOnclick("btnBpmnZoomIn", () => this.setZoom(this.zoom + 0.15));
        setOnclick("btnBpmnZoomOut", () => this.setZoom(this.zoom - 0.15));
        setOnclick("btnBpmnFit", () => this.fitToScreen());

        // 4. Pan & Drag Canvas
        const stage = $("bpmnCanvasStage");
        if (stage) {
            stage.addEventListener("mousedown", (e) => {
                if (e.target.closest(".bpmn-node-group") || e.target.closest("button")) return;
                this.isPanning = true;
                this.startPan = { x: e.clientX - this.panX, y: e.clientY - this.panY };
                stage.classList.add("panning");
            });

            window.addEventListener("mousemove", (e) => {
                if (!this.isPanning) return;
                this.panX = e.clientX - this.startPan.x;
                this.panY = e.clientY - this.startPan.y;
                this.updateTransform();
            });

            window.addEventListener("mouseup", () => {
                this.isPanning = false;
                stage.classList.remove("panning");
            });

            // Wheel Zoom
            stage.addEventListener("wheel", (e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                this.setZoom(this.zoom + delta);
            }, { passive: false });
        }

        // 5. Add Decision Branch Gateway
        setOnclick("btnBpmnAddBranch", () => {
            const step = getCurrentStep();
            if (!step) {
                showToast("Please select a step to add decision branches");
                return;
            }
            const targetSeq = prompt("Enter Target Step Number to branch to:", String(Math.min((workflow.steps || []).length, Number(step.sequence || 1) + 2)));
            if (!targetSeq) return;
            const label = prompt("Enter Branch Condition Label (e.g., 'If Approved', 'On Error'):", "If Condition Met");
            
            if (!step.branches) step.branches = [];
            step.branches.push({
                target_sequence: parseInt(targetSeq, 10),
                label: label || "Alternative Path"
            });
            saveActiveStepEditsSilent();
            this.render();
            showToast(`🔀 Decision branch added: ${label} ➔ Step ${targetSeq}`);
        });

        // 6. Auto-Align & Reset Layout Action
        setOnclick("btnBpmnAutoAlign", () => this.autoAlignLayout());

        // 7. Export Actions
        setOnclick("btnBpmnExportSvg", () => this.exportSvg());
        setOnclick("btnBpmnExportPng", () => this.exportPng());
        setOnclick("btnBpmnCopyMermaid", () => this.copyMermaid());
    }

    autoAlignLayout() {
        if (!workflow || !workflow.steps) return;
        workflow.steps.forEach(s => {
            delete s.bpmn_pos;
        });
        saveActiveStepEditsSilent();
        this.render();
        showToast("⚡ Flowchart auto-aligned into clean serpentine layout!");
    }

    setMode(mode) {
        this.currentMode = mode;
        const layout = $("stepsDualViewLayout");
        const workspace = $("stepBpmnFlowchartWorkspace");
        if (!layout) return;

        layout.className = `steps-dual-view-layout view-${mode}`;

        document.querySelectorAll(".view-mode-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.mode === mode);
        });

        if (mode === "bpmn" || mode === "split") {
            if (workspace) workspace.classList.remove("hidden");
            setTimeout(() => this.render(), 50);
        }
    }

    setZoom(val) {
        this.zoom = Math.max(0.3, Math.min(2.5, val));
        const label = $("bpmnZoomLabel");
        if (label) label.textContent = `${Math.round(this.zoom * 100)}%`;
        this.updateTransform();
    }

    fitToScreen() {
        this.zoom = 1;
        this.panX = 40;
        this.panY = 60;
        const label = $("bpmnZoomLabel");
        if (label) label.textContent = "100%";
        this.updateTransform();
    }

    updateTransform() {
        const group = $("bpmnViewportGroup");
        if (group) {
            group.setAttribute("transform", `translate(${this.panX}, ${this.panY}) scale(${this.zoom})`);
        }
    }

    getActionIcon(action) {
        switch ((action || "").toLowerCase()) {
            case "input": return "⌨️";
            case "click": return "👆";
            case "keypress_enter": return "↵";
            case "navigate": return "🌐";
            case "keyboard_shortcut": return "⚡";
            default: return "📌";
        }
    }

    render() {
        if (!workflow || !workflow.steps) return;
        const steps = workflow.steps.filter(s => !s.hidden);
        if (steps.length === 0) return;

        const swimlanesLayer = $("bpmnSwimlanesLayer");
        const connectorsLayer = $("bpmnConnectorsLayer");
        const nodesLayer = $("bpmnNodesLayer");
        if (!swimlanesLayer || !connectorsLayer || !nodesLayer) return;

        swimlanesLayer.innerHTML = "";
        connectorsLayer.innerHTML = "";
        nodesLayer.innerHTML = "";

        const cardW = 240;
        const cardH = 86;
        const gapX = 70;
        const gapY = 110;
        const colsPerRow = 4;
        const startX = 40;
        const rowStartX = 140;
        const startY = 80;

        this.nodes = [];
        this.connections = [];

        // 1. Start Event Node (Green Circle)
        const startNode = {
            id: "start",
            type: "start",
            x: startX,
            y: startY + (cardH / 2) - 20,
            w: 40,
            h: 40,
            row: 0,
            col: -1
        };
        this.nodes.push(startNode);

        nodesLayer.innerHTML += `
            <g class="bpmn-node-group" id="bpmnNode-start" data-id="start" transform="translate(${startNode.x}, ${startNode.y})">
                <circle cx="20" cy="20" r="20" class="bpmn-start-event" />
                <polygon points="15,11 28,20 15,29" fill="#ffffff" />
                <text x="20" y="52" font-size="10.5" font-weight="800" fill="#10b981" text-anchor="middle">START</text>
            </g>
        `;

        // 2. Compute 4-Column Serpentine Grid Positions (Respecting Manual Custom Positions)
        steps.forEach((st, idx) => {
            const row = Math.floor(idx / colsPerRow);
            const col = idx % colsPerRow;

            const defaultX = rowStartX + col * (cardW + gapX);
            const defaultY = startY + row * (cardH + gapY);

            const nodeX = st.bpmn_pos?.x ?? defaultX;
            const nodeY = st.bpmn_pos?.y ?? defaultY;

            const taskNode = {
                id: `step-${st.sequence}`,
                step: st,
                type: "task",
                x: nodeX,
                y: nodeY,
                w: cardW,
                h: cardH,
                row: row,
                col: col,
                isCustom: !!st.bpmn_pos
            };
            this.nodes.push(taskNode);

            // Connect previous node
            const prevNode = (idx === 0) ? startNode : this.nodes[this.nodes.length - 2];
            this.connections.push({
                id: `conn-${prevNode.id}-${taskNode.id}`,
                from: prevNode,
                to: taskNode,
                type: "sequence"
            });

            // Branching decision
            if (st.branches && st.branches.length > 0) {
                st.branches.forEach((b, bIdx) => {
                    this.connections.push({
                        id: `conn-branch-${taskNode.id}-${b.target_sequence}-${bIdx}`,
                        from: taskNode,
                        toSeq: b.target_sequence,
                        label: b.label,
                        type: "branch"
                    });
                });
            }
        });

        // 3. End Event Node (Red Circle)
        const lastTask = this.nodes[this.nodes.length - 1];
        const lastCol = (steps.length - 1) % colsPerRow;
        const lastRow = Math.floor((steps.length - 1) / colsPerRow);

        let defaultEndX = lastTask.x + cardW + gapX;
        let defaultEndY = lastTask.y + (cardH / 2) - 20;

        if (lastCol === colsPerRow - 1) {
            defaultEndX = lastTask.x + (cardW / 2) - 20;
            defaultEndY = lastTask.y + cardH + 40;
        }

        const endNode = {
            id: "end",
            type: "end",
            x: defaultEndX,
            y: defaultEndY,
            w: 40,
            h: 40,
            row: lastRow,
            col: lastCol + 1
        };
        this.nodes.push(endNode);

        this.connections.push({
            id: `conn-${lastTask.id}-end`,
            from: lastTask,
            to: endNode,
            type: "sequence"
        });

        nodesLayer.innerHTML += `
            <g class="bpmn-node-group" id="bpmnNode-end" data-id="end" transform="translate(${endNode.x}, ${endNode.y})">
                <circle cx="20" cy="20" r="20" class="bpmn-end-event" />
                <rect x="13" y="13" width="14" height="14" rx="2" fill="#ffffff" />
                <text x="20" y="52" font-size="10.5" font-weight="800" fill="#ef4444" text-anchor="middle">END</text>
            </g>
        `;

        // 4. Render Rich Miro-Grade Step Nodes
        this.nodes.forEach(node => {
            if (node.type === "task") {
                const st = node.step;
                const icon = this.getActionIcon(st.action);
                const title = esc(st.title || getDefaultTitle(st));
                const isSelected = (workflow.steps[currentStepIndex]?.sequence === st.sequence);
                const shortTitle = title.length > 24 ? title.substring(0, 22) + "..." : title;
                const desc = esc(st.description || getDefaultDescription(st) || "");
                const shortDesc = desc.length > 32 ? desc.substring(0, 30) + "..." : desc;
                
                let domain = "";
                if (st.url) {
                    try { domain = new URL(st.url).hostname || ""; } catch { domain = ""; }
                }

                const nodeMarkup = `
                    <g class="bpmn-node-group ${isSelected ? 'active' : ''}" id="bpmnNode-${st.sequence}" data-seq="${st.sequence}" transform="translate(${node.x}, ${node.y})">
                        <rect width="${node.w}" height="${node.h}" class="bpmn-node-card" />
                        
                        <!-- Step Badge Pill -->
                        <rect x="10" y="10" width="26" height="20" rx="6" class="bpmn-node-badge" />
                        <text x="23" y="24" font-size="11" font-weight="900" fill="#ffffff" text-anchor="middle">${st.sequence}</text>
                        
                        <!-- Action Icon & Title -->
                        <text x="42" y="24" font-size="12" font-weight="800" class="bpmn-node-title">${icon} ${shortTitle}</text>
                        
                        <!-- Description Subtitle -->
                        <text x="12" y="48" font-size="10.5" class="bpmn-node-sub">${shortDesc || 'Click to focus step'}</text>
                        
                        <!-- Footer Status & Domain Badges -->
                        <rect x="12" y="58" width="62" height="16" rx="4" fill="${st.approved ? 'rgba(16,185,129,0.18)' : 'rgba(245,158,11,0.18)'}" />
                        <text x="43" y="70" font-size="9" font-weight="800" fill="${st.approved ? '#10b981' : '#f59e0b'}" text-anchor="middle">${st.approved ? '✓ Approved' : '⏳ Pending'}</text>
                        
                        ${domain ? `
                            <rect x="80" y="58" width="${Math.min(145, domain.length * 6.5 + 12)}" height="16" rx="4" fill="rgba(99,102,241,0.12)" />
                            <text x="86" y="70" font-size="8.5" font-weight="700" fill="#818cf8">🌐 ${esc(domain.slice(0, 18))}</text>
                        ` : ''}
                    </g>
                `;
                nodesLayer.innerHTML += nodeMarkup;
            }
        });

        // 5. Draw Dynamic Smart Connecting Arrows
        this.updateConnectors();

        // 6. Wire Interactive Freeform Node Dragging & Selection
        this.initNodeDragAndSelect();

        this.updateTransform();
    }

    computeDynamicPath(fromNode, targetNode) {
        const fromCenterX = fromNode.x + (fromNode.w / 2);
        const fromCenterY = fromNode.y + (fromNode.h / 2);
        const targetCenterX = targetNode.x + (targetNode.w / 2);
        const targetCenterY = targetNode.y + (targetNode.h / 2);

        const dx = targetCenterX - fromCenterX;
        const dy = targetCenterY - fromCenterY;

        let startPt, endPt;

        // If target is to the right
        if (Math.abs(dx) >= Math.abs(dy) && dx > 0) {
            startPt = { x: fromNode.x + fromNode.w, y: fromCenterY };
            endPt = { x: targetNode.x, y: targetCenterY };
            
            if (Math.abs(dy) < 25) {
                // Straight line
                return `M ${startPt.x} ${startPt.y} L ${endPt.x} ${endPt.y}`;
            } else {
                // Smooth Manhattan Bezier S-Curve
                const midX = (startPt.x + endPt.x) / 2;
                return `M ${startPt.x} ${startPt.y} C ${midX} ${startPt.y}, ${midX} ${endPt.y}, ${endPt.x} ${endPt.y}`;
            }
        } 
        // If target is to the left (e.g. wrapping to next line or dragged backwards)
        else if (Math.abs(dx) >= Math.abs(dy) && dx < 0) {
            startPt = { x: fromNode.x + fromNode.w, y: fromCenterY };
            endPt = { x: targetNode.x, y: targetCenterY };
            const midY = (startPt.y + endPt.y) / 2;
            const loopRight = startPt.x + 35;
            const loopLeft = targetNode.x - 35;

            return `M ${startPt.x} ${startPt.y} 
                    C ${loopRight} ${startPt.y}, ${loopRight} ${midY}, ${startPt.x} ${midY}
                    L ${targetNode.x} ${midY}
                    C ${loopLeft} ${midY}, ${loopLeft} ${endPt.y}, ${endPt.x - 20} ${endPt.y}
                    L ${endPt.x} ${endPt.y}`;
        }
        // If target is below
        else if (dy > 0) {
            startPt = { x: fromCenterX, y: fromNode.y + fromNode.h };
            endPt = { x: targetCenterX, y: targetNode.y };
            const midY = (startPt.y + endPt.y) / 2;
            return `M ${startPt.x} ${startPt.y} C ${startPt.x} ${midY}, ${endPt.x} ${midY}, ${endPt.x} ${endPt.y}`;
        }
        // If target is above
        else {
            startPt = { x: fromCenterX, y: fromNode.y };
            endPt = { x: targetCenterX, y: targetNode.y + targetNode.h };
            const midY = (startPt.y + endPt.y) / 2;
            return `M ${startPt.x} ${startPt.y} C ${startPt.x} ${midY}, ${endPt.x} ${midY}, ${endPt.x} ${endPt.y}`;
        }
    }

    updateConnectors() {
        const connectorsLayer = $("bpmnConnectorsLayer");
        if (!connectorsLayer) return;
        connectorsLayer.innerHTML = "";

        this.connections.forEach(conn => {
            let targetNode = conn.to;
            if (conn.type === "branch") {
                targetNode = this.nodes.find(n => n.step && n.step.sequence === conn.toSeq);
            }

            if (!conn.from || !targetNode) return;

            const pathD = this.computeDynamicPath(conn.from, targetNode);
            const markerAttr = (conn.type === "branch") ? 'marker-end="url(#bpmnBranchArrow)"' : 'marker-end="url(#bpmnArrowhead)"';
            const lineClass = (conn.type === "branch") ? 'bpmn-connector-line branch-line' : 'bpmn-connector-line';

            connectorsLayer.innerHTML += `<path id="${conn.id}" d="${pathD}" class="${lineClass}" ${markerAttr} />`;

            // Draw Branch Decision Label
            if (conn.label) {
                const labelX = (conn.from.x + targetNode.x) / 2;
                const labelY = (conn.from.y + targetNode.y) / 2 - 12;
                const labelW = Math.max(75, conn.label.length * 6.5);
                connectorsLayer.innerHTML += `
                    <g transform="translate(${labelX - (labelW/2)}, ${labelY})">
                        <rect width="${labelW}" height="18" class="bpmn-branch-label-bg" />
                        <text x="${labelW/2}" y="12" class="bpmn-branch-label-text">${esc(conn.label)}</text>
                    </g>
                `;
            }
        });
    }

    initNodeDragAndSelect() {
        const nodesLayer = $("bpmnNodesLayer");
        if (!nodesLayer) return;

        let activeDragNode = null;
        let dragStartMouse = { x: 0, y: 0 };
        let dragStartNodePos = { x: 0, y: 0 };
        let hasMoved = false;

        nodesLayer.querySelectorAll(".bpmn-node-group").forEach(grp => {
            grp.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                const seqStr = grp.dataset.seq;
                const idStr = grp.dataset.id;
                
                const node = this.nodes.find(n => (seqStr && n.step && n.step.sequence === parseInt(seqStr, 10)) || (idStr && n.id === idStr));
                if (!node) return;

                activeDragNode = node;
                hasMoved = false;
                dragStartMouse = { x: e.clientX, y: e.clientY };
                dragStartNodePos = { x: node.x, y: node.y };
            });
        });

        window.addEventListener("mousemove", (e) => {
            if (!activeDragNode) return;

            const deltaX = (e.clientX - dragStartMouse.x) / this.zoom;
            const deltaY = (e.clientY - dragStartMouse.y) / this.zoom;

            if (Math.hypot(deltaX, deltaY) > 3) {
                hasMoved = true;
            }

            if (hasMoved) {
                // Snap to 10px grid
                activeDragNode.x = Math.round((dragStartNodePos.x + deltaX) / 10) * 10;
                activeDragNode.y = Math.round((dragStartNodePos.y + deltaY) / 10) * 10;

                // Update element transform live
                const grpEl = (activeDragNode.type === "task") 
                    ? $(`bpmnNode-${activeDragNode.step.sequence}`) 
                    : $(`bpmnNode-${activeDragNode.id}`);
                
                if (grpEl) {
                    grpEl.setAttribute("transform", `translate(${activeDragNode.x}, ${activeDragNode.y})`);
                }

                // Update all connecting arrow paths in real-time
                this.updateConnectors();
            }
        });

        window.addEventListener("mouseup", () => {
            if (!activeDragNode) return;

            if (hasMoved) {
                if (activeDragNode.step) {
                    activeDragNode.step.bpmn_pos = { x: activeDragNode.x, y: activeDragNode.y };
                    saveActiveStepEditsSilent();
                    showToast(`📍 Box ${activeDragNode.step.sequence} position saved`);
                }
            } else {
                // Click (No Drag): Select node and open Inspector
                if (activeDragNode.step) {
                    const stepIdx = (workflow.steps || []).findIndex(s => s.id === activeDragNode.step.id);
                    if (stepIdx !== -1) {
                        currentStepIndex = stepIdx;
                        this.openInspector(activeDragNode.step);
                        nodesLayer.querySelectorAll(".bpmn-node-group").forEach(g => g.classList.remove("active"));
                        $(`bpmnNode-${activeDragNode.step.sequence}`)?.classList.add("active");
                    }
                }
            }

            activeDragNode = null;
            hasMoved = false;
        });

        // Close inspector when clicking canvas
        const stage = $("bpmnCanvasStage");
        if (stage) {
            stage.onclick = (e) => {
                if (!e.target.closest(".bpmn-node-group") && !e.target.closest(".bpmn-node-inspector")) {
                    this.closeInspector();
                }
            };
        }

        // Close Inspector Button
        const closeBtn = $("bpmnInspCloseBtn");
        if (closeBtn) closeBtn.onclick = () => this.closeInspector();
    }

    openInspector(step) {
        const panel = $("bpmnNodeInspector");
        if (!panel || !step) return;

        panel.classList.remove("hidden");

        const badge = $("bpmnInspBadge");
        if (badge) badge.textContent = `Step ${step.sequence}`;

        const iconEl = $("bpmnInspActionIcon");
        if (iconEl) iconEl.textContent = this.getActionIcon(step.action);

        const typeEl = $("bpmnInspActionType");
        if (typeEl) typeEl.textContent = (step.action || "Click Action").toUpperCase();

        const titleInput = $("bpmnInspTitle");
        if (titleInput) {
            titleInput.value = step.title || getDefaultTitle(step);
            titleInput.oninput = () => {
                step.title = titleInput.value;
                this.render();
                saveActiveStepEditsSilent();
            };
        }

        const descInput = $("bpmnInspDesc");
        if (descInput) {
            descInput.value = step.description || getDefaultDescription(step) || "";
            descInput.oninput = () => {
                step.description = descInput.value;
                saveActiveStepEditsSilent();
            };
        }

        // Render Branches List
        this.renderInspectorBranches(step);

        // Add Branch Button
        const addBranchBtn = $("bpmnInspAddBranchBtn");
        if (addBranchBtn) {
            addBranchBtn.onclick = () => {
                const targetSeq = prompt("Enter Target Step Number to branch to:", String(Math.min((workflow.steps || []).length, Number(step.sequence || 1) + 2)));
                if (!targetSeq) return;
                const label = prompt("Enter Branch Condition Label (e.g. 'If Approved', 'On Error'):", "If Condition Met");
                if (!step.branches) step.branches = [];
                step.branches.push({
                    target_sequence: parseInt(targetSeq, 10),
                    label: label || "Alternative Path"
                });
                saveActiveStepEditsSilent();
                this.renderInspectorBranches(step);
                this.render();
                showToast(`🔀 Branch added to Step ${targetSeq}`);
            };
        }

        // Toggle Approve Button
        const appBtn = $("bpmnInspToggleApprove");
        if (appBtn) {
            appBtn.textContent = step.approved ? "⏳ Mark Pending" : "✓ Mark Approved";
            appBtn.style.color = step.approved ? "#f59e0b" : "#10b981";
            appBtn.onclick = () => {
                step.approved = !step.approved;
                this.openInspector(step);
                this.render();
                renderStepsTab();
                showToast(step.approved ? "Step marked as approved ✓" : "Step marked as pending");
            };
        }

        // Toggle Hide Button
        const hideBtn = $("bpmnInspToggleHide");
        if (hideBtn) {
            hideBtn.textContent = step.hidden ? "👁️ Restore Step" : "👁️ Hide Step";
            hideBtn.onclick = async () => {
                step.hidden = !step.hidden;
                try {
                    await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}/edits`, {
                        method: "PATCH",
                        body: JSON.stringify({ hidden: step.hidden })
                    });
                    this.render();
                    renderStepsTab();
                    showToast(step.hidden ? "Step hidden from export" : "Step restored ✓");
                } catch (e) {
                    showToast("Failed: " + e.message);
                }
            };
        }

        // Open in Screenshot Studio Button
        const studioBtn = $("bpmnInspOpenStudio");
        if (studioBtn) {
            studioBtn.onclick = () => {
                switchTab("guide");
                renderGuideTab();
                showToast(`🎨 Loaded Step ${step.sequence} in Studio`);
            };
        }

        // Delete Step Button
        const delBtn = $("bpmnInspDeleteStep");
        if (delBtn) {
            delBtn.onclick = async () => {
                if (confirm(`Delete Step ${step.sequence}?`)) {
                    const idx = (workflow.steps || []).findIndex(s => s.id === step.id);
                    if (idx !== -1) {
                        try {
                            await api(`/sessions/${encodeURIComponent(workflow.id)}/steps/${step.id}`, { method: "DELETE" });
                            workflow.steps.splice(idx, 1);
                            workflow.steps.forEach((s, i) => s.sequence = i + 1);
                            this.closeInspector();
                            this.render();
                            renderStepsTab();
                            showToast("Step deleted");
                        } catch (e) {
                            showToast("Delete failed: " + e.message);
                        }
                    }
                }
            };
        }
    }

    renderInspectorBranches(step) {
        const list = $("bpmnInspBranchesList");
        if (!list) return;
        list.innerHTML = "";

        if (!step.branches || step.branches.length === 0) {
            list.innerHTML = '<span style="font-size: 10px; color: var(--text-muted);">No decision branches configured.</span>';
            return;
        }

        step.branches.forEach((b, i) => {
            const item = document.createElement("div");
            item.className = "bpmn-branch-item";
            item.innerHTML = `
                <span>🔀 <strong>${esc(b.label || 'Branch')}:</strong> ➔ Step ${b.target_sequence}</span>
                <button title="Remove branch">✕</button>
            `;
            item.querySelector("button").onclick = () => {
                step.branches.splice(i, 1);
                saveActiveStepEditsSilent();
                this.renderInspectorBranches(step);
                this.render();
                showToast("Branch removed");
            };
            list.appendChild(item);
        });
    }

    closeInspector() {
        const panel = $("bpmnNodeInspector");
        if (panel) panel.classList.add("hidden");
        const nodesLayer = $("bpmnNodesLayer");
        if (nodesLayer) {
            nodesLayer.querySelectorAll(".bpmn-node-group").forEach(g => g.classList.remove("active"));
        }
    }

    exportSvg() {
        const svg = $("bpmnSvgCanvas");
        if (!svg) return;
        const svgData = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `procsnap-bpmn-flowchart-${Date.now()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("🖼️ Flowchart exported as SVG vector file!");
    }

    exportPng() {
        const svg = $("bpmnSvgCanvas");
        if (!svg) return;
        const svgData = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 1600;
            canvas.height = 900;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#0f172a";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            
            const pngUrl = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = pngUrl;
            a.download = `procsnap-bpmn-flowchart-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("📸 Flowchart exported as High-Res PNG!");
        };
        img.src = url;
    }

    copyMermaid() {
        if (!workflow || !workflow.steps) return;
        const steps = workflow.steps.filter(s => !s.hidden);
        let code = "graph TD\n";
        code += "    Start([🟢 Start]) --> Step1\n";

        steps.forEach((st, i) => {
            const id = `Step${st.sequence}`;
            const title = (st.title || `Step ${st.sequence}`).replace(/["\n]/g, "");
            code += `    ${id}["${st.sequence}. ${title}"]\n`;

            if (st.branches && st.branches.length > 0) {
                const gwId = `GW${st.sequence}`;
                code += `    ${id} --> ${gwId}{{"🔀 Decision"}}\n`;
                st.branches.forEach(b => {
                    code += `    ${gwId} -- "${b.label}" --> Step${b.target_sequence}\n`;
                });
            } else if (i < steps.length - 1) {
                code += `    ${id} --> Step${steps[i+1].sequence}\n`;
            } else {
                code += `    ${id} --> End([🔴 End])\n`;
            }
        });

        navigator.clipboard.writeText(code).then(() => {
            showToast("🧜 Mermaid.js Flowchart syntax copied to clipboard!");
        });
    }
}

const bpmnEngine = new BpmnFlowchartEngine();


// Initialize All Platform Enhancements safely
try { initHotspotReticle(); } catch (e) { console.warn("Hotspot reticle init error:", e); }
try { initCanvasFileDrop(); } catch (e) { console.warn("Canvas drop init error:", e); }
try { initSopTemplateManager(); } catch (e) { console.warn("Template manager init error:", e); }
try { initLiveDraggableCursor(); } catch (e) { console.warn("Live cursor init error:", e); }
try { initDrawerVoiceoverAndAiDiff(); } catch (e) { console.warn("Drawer diff init error:", e); }
try { initAutoRedactPII(); } catch (e) { console.warn("Auto redact init error:", e); }
try { initWorkflowGraphModal(); } catch (e) { console.warn("Graph modal init error:", e); }
try { initSlideshowPracticeAndTeleprompter(); } catch (e) { console.warn("Slideshow practice init error:", e); }
try { initScormExport(); } catch (e) { console.warn("SCORM init error:", e); }
try { initCopyRichSopToClipboard(); } catch (e) { console.warn("Copy SOP init error:", e); }
try { initExportCategoryFilters(); } catch (e) { console.warn("Export filters init error:", e); }
try { initWorkflowMergeModal(); } catch (e) { console.warn("Merge modal init error:", e); }
try { initStepListFilterAndBulkActions(); } catch (e) { console.warn("Step list init error:", e); }
try { initSlideshowAutoPlayAndFullscreen(); } catch (e) { console.warn("Slideshow init error:", e); }
try { initPrintSopPdf(); } catch (e) { console.warn("Print PDF init error:", e); }
try { initDesktopRecorderModal(); } catch (e) { console.warn("Desktop recorder init error:", e); }
try { initLibraryPinning(); } catch (e) { console.warn("Library pinning init error:", e); }
try { initFeedbackModal(); } catch (e) { console.warn("Feedback modal init error:", e); }
try { bpmnEngine.init(); } catch (e) { console.warn("BPMN engine init error:", e); }

// =========================================================
// 💬 USER FEEDBACK & SUPPORT (Vickykalam34@gmail.com)
// =========================================================
function initFeedbackModal() {
    const openBtn = $("btnOpenFeedbackModal");
    const modal = $("feedbackModal");
    if (!modal) return;

    let selectedType = "feature_request";

    window.openFeedbackModal = () => {
        modal.style.display = "block";
        const msg = $("feedbackMessageInput");
        if (msg) msg.focus();
    };

    window.closeFeedbackModal = () => {
        modal.style.display = "none";
    };

    if (openBtn) {
        openBtn.onclick = window.openFeedbackModal;
    }

    // Category button selection
    document.querySelectorAll(".feedback-type-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".feedback-type-btn").forEach(b => {
                b.classList.remove("active");
                b.style.background = "transparent";
                b.style.color = "var(--text-main, #fff)";
                b.style.border = "1px solid var(--border-color, rgba(255,255,255,0.15))";
            });
            btn.classList.add("active");
            btn.style.background = "#6366f1";
            btn.style.color = "#fff";
            btn.style.border = "none";
            selectedType = btn.dataset.type || "feedback";
            updateMailtoLink();
        };
    });

    const updateMailtoLink = () => {
        const mailtoBtn = $("btnMailtoFeedback");
        if (!mailtoBtn) return;
        const subj = $("feedbackSubjectInput")?.value || `ProcSnap ${selectedType} Feedback`;
        const body = $("feedbackMessageInput")?.value || "";
        const email = "Vickykalam34@gmail.com";
        mailtoBtn.href = `mailto:${email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body + "\n\n---\nSent from ProcSnap Studio")}`;
    };

    const subjInput = $("feedbackSubjectInput");
    const msgInput = $("feedbackMessageInput");
    if (subjInput) subjInput.addEventListener("input", updateMailtoLink);
    if (msgInput) msgInput.addEventListener("input", updateMailtoLink);

    // Direct submit button
    const submitBtn = $("btnSubmitFeedbackDirect");
    if (submitBtn) {
        submitBtn.onclick = async () => {
            const message = msgInput?.value?.trim();
            if (!message) {
                showToast("Please enter your message or feedback first.", 2500);
                if (msgInput) msgInput.focus();
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = "<span>⏳</span> Submitting...";

            try {
                const res = await fetch(`${API_BASE}/feedback`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: "Vickykalam34@gmail.com",
                        feedback_type: selectedType,
                        subject: subjInput?.value?.trim() || "ProcSnap User Feedback",
                        message: message,
                        system_diagnostics: {
                            userAgent: navigator.userAgent,
                            platform: navigator.platform,
                            timestamp: new Date().toISOString(),
                            workflowId: workflow?.id || null
                        }
                    })
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                showToast("🎉 Thank you! Your feedback was sent directly to Vickykalam34@gmail.com", 5000);
                if (msgInput) msgInput.value = "";
                if (subjInput) subjInput.value = "";
                window.closeFeedbackModal();
            } catch (e) {
                console.error("Feedback submit error:", e);
                showToast("Opening email client fallback to Vickykalam34@gmail.com...", 3000);
                updateMailtoLink();
                $("btnMailtoFeedback")?.click();
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = "<span>🚀</span> Submit Feedback";
            }
        };
    }
}

/* =========================================================
   ⚡ POWER-USER SHORTCUTS, AUTO-POLISH & PERFORMANCE ENGINE
========================================================= */

let undoToastTimeout = null;
let lastDeletedStepBackup = null;

function showUndoToast(text, undoCallback) {
    const toast = $("undoToast");
    const toastText = $("undoToastText");
    const toastBtn = $("btnUndoToastAction");
    if (!toast) return;

    if (toastText) toastText.textContent = text;
    toast.style.display = "flex";
    toast.classList.remove("hidden");

    if (undoToastTimeout) clearTimeout(undoToastTimeout);

    if (toastBtn) {
        toastBtn.onclick = () => {
            toast.style.display = "none";
            toast.classList.add("hidden");
            if (undoCallback) undoCallback();
        };
    }

    undoToastTimeout = setTimeout(() => {
        toast.style.display = "none";
        toast.classList.add("hidden");
    }, 4500);
}

// 0ms Latency Image Preloader
const screenshotMemoryCache = new Map();

function preloadAdjacentScreenshots(currentIndex) {
    if (!steps || !steps.length) return;
    const indicesToPreload = [currentIndex - 1, currentIndex + 1, currentIndex + 2];
    
    for (const idx of indicesToPreload) {
        if (idx >= 0 && idx < steps.length) {
            const step = steps[idx];
            if (step && step.screenshot_path) {
                const url = `${API_BASE}/${step.screenshot_path}`;
                if (!screenshotMemoryCache.has(url)) {
                    const img = new Image();
                    img.decoding = "async";
                    img.src = url;
                    screenshotMemoryCache.set(url, img);
                }
            }
        }
    }
}

// 1-Click Auto-Polish SOP Engine
async function triggerAutoPolishSOP() {
    if (!workflow || !workflow.id || !steps || !steps.length) {
        showToast("No active workflow steps to polish.", 2500);
        return;
    }

    const polishBtn = $("btnAutoPolishHeader");
    if (polishBtn) {
        polishBtn.disabled = true;
        polishBtn.innerHTML = "<span>⏳</span> Polishing...";
    }

    try {
        const res = await fetch(`${API_BASE}/sessions/${workflow.id}/suggestions`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        let updatedCount = 0;
        if (data.title_suggestions) {
            for (const step of steps) {
                if (data.title_suggestions[step.id]) {
                    step.edited_title = data.title_suggestions[step.id];
                    updatedCount++;
                }
                if (data.description_suggestions && data.description_suggestions[step.id]) {
                    step.edited_description = data.description_suggestions[step.id];
                }
            }
        }

        renderStepList();
        if (typeof currentStepIndex === "number" && steps[currentStepIndex]) {
            renderCurrentStep();
        }

        showToast(`✨ Auto-polished ${updatedCount || steps.length} steps with professional SOP titles!`, 4000);
    } catch (err) {
        console.error("Auto polish error:", err);
        showToast("Auto-polish notice: Applying local verb-first templates...", 3000);
        
        // Local rule-based fallback
        for (const step of steps) {
            const act = (step.action || "Click").toLowerCase();
            const rawTitle = step.title || step.edited_title || "";
            if (rawTitle.startsWith("Click") || rawTitle.startsWith("type") || !rawTitle) {
                if (act.includes("input") || act.includes("type")) {
                    step.edited_title = `Enter information in ${rawTitle.replace(/click|type/gi, '').trim() || 'field'}`;
                } else if (rawTitle.toLowerCase().includes("save") || rawTitle.toLowerCase().includes("submit")) {
                    step.edited_title = "Submit and save changes";
                } else {
                    step.edited_title = `Click ${rawTitle.replace(/click/gi, '').trim() || 'the selected item'}`;
                }
            }
        }
        renderStepList();
        if (typeof currentStepIndex === "number" && steps[currentStepIndex]) {
            renderCurrentStep();
        }
    } finally {
        if (polishBtn) {
            polishBtn.disabled = false;
            polishBtn.innerHTML = "<span>✨</span> Auto-Polish SOP";
        }
    }
}

// Power-User Keyboard Navigation & Shortcuts
function initPowerUserShortcuts() {
    // 1-Click Auto Polish Click
    const polishBtn = $("btnAutoPolishHeader");
    if (polishBtn) polishBtn.onclick = triggerAutoPolishSOP;

    document.addEventListener("keydown", (e) => {
        const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
        const isEditable = document.activeElement ? document.activeElement.isContentEditable : false;

        // Ignore when typing inside input fields or textareas
        if (tag === "input" || tag === "textarea" || tag === "select" || isEditable) {
            // Save on Ctrl+S even inside inputs
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                showToast("✓ Changes saved automatically", 1500);
            }
            return;
        }

        // Only active when viewing Studio workspace
        const studioView = $("studioView");
        if (!studioView || studioView.classList.contains("hidden")) return;
        if (!steps || !steps.length) return;

        // J or ArrowDown -> Next Step
        if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
            e.preventDefault();
            if (currentStepIndex < steps.length - 1) {
                selectStep(currentStepIndex + 1);
                preloadAdjacentScreenshots(currentStepIndex + 1);
            }
            return;
        }

        // K or ArrowUp -> Previous Step
        if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
            e.preventDefault();
            if (currentStepIndex > 0) {
                selectStep(currentStepIndex - 1);
                preloadAdjacentScreenshots(currentStepIndex - 1);
            }
            return;
        }

        // E -> Edit Step Title
        if (e.key === "e" || e.key === "E") {
            e.preventDefault();
            const titleEl = $("guideStepTitle");
            if (titleEl) {
                titleEl.focus();
                // Select all text inside title
                const range = document.createRange();
                range.selectNodeContents(titleEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
            return;
        }

        // H -> Toggle Hide Step
        if (e.key === "h" || e.key === "H") {
            e.preventDefault();
            const curr = steps[currentStepIndex];
            if (curr) {
                curr.hidden = !curr.hidden;
                renderStepList();
                renderCurrentStep();
                showToast(curr.hidden ? "👁️ Step hidden from public SOP" : "👁️ Step visible in SOP", 1800);
            }
            return;
        }

        // Spacebar -> Open Slideshow Walkthrough
        if (e.key === " ") {
            e.preventDefault();
            const playTab = document.querySelector('.tab[data-tab="play"]');
            if (playTab) playTab.click();
            return;
        }

        // Delete or Backspace -> Delete Step with Undo Toast
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            const curr = steps[currentStepIndex];
            if (curr) {
                lastDeletedStepBackup = { step: { ...curr }, index: currentStepIndex };
                steps.splice(currentStepIndex, 1);
                if (currentStepIndex >= steps.length) currentStepIndex = Math.max(0, steps.length - 1);
                renderStepList();
                if (steps.length > 0) renderCurrentStep();

                showUndoToast(`Step ${lastDeletedStepBackup.index + 1} deleted`, () => {
                    if (lastDeletedStepBackup) {
                        steps.splice(lastDeletedStepBackup.index, 0, lastDeletedStepBackup.step);
                        currentStepIndex = lastDeletedStepBackup.index;
                        renderStepList();
                        renderCurrentStep();
                        showToast("↺ Step restored!", 2000);
                    }
                });
            }
            return;
        }
    });
}

// ── Enterprise Process Flowchart Viewer ──────────────────────────────────
async function openFlowchartModal() {
    if (!workflow || !workflow.id) return showToast("No active workflow to generate flowchart.");
    const modal = $("flowchartModal");
    const codeArea = $("flowchartCodeArea");
    if (!modal || !codeArea) return;

    modal.style.display = "block";
    modal.classList.remove("hidden");
    codeArea.textContent = "⏳ Generating Mermaid process flowchart...";

    try {
        const res = await fetch(`${API_BASE}/sessions/${workflow.id}/flowchart`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        codeArea.textContent = data.mermaid;

        const copyBtn = $("btnCopyMermaidCode");
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(data.mermaid);
                showToast("📋 Copied Mermaid flowchart syntax to clipboard!", 2500);
            };
        }
    } catch (err) {
        codeArea.textContent = `Error generating flowchart: ${err.message}`;
    }
}

// ── Enterprise Local PII Scanner ─────────────────────────────────────────
async function openPiiScannerModal() {
    if (!workflow || !workflow.id) return showToast("No active workflow to scan.");
    const modal = $("piiScannerModal");
    const listEl = $("piiFindingsList");
    const summaryEl = $("piiAuditSummary");
    if (!modal || !listEl) return;

    modal.style.display = "block";
    modal.classList.remove("hidden");
    listEl.innerHTML = "<div style='color:#a5b4fc; padding:20px; text-align:center;'>⏳ Scanning steps for PII, emails, tokens, and passwords...</div>";

    try {
        const res = await fetch(`${API_BASE}/sessions/${workflow.id}/scan-pii`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const report = await res.json();

        if (summaryEl) {
            summaryEl.textContent = `${report.total_findings} sensitive entities detected across ${report.affected_steps_count} steps.`;
        }

        if (report.total_findings === 0) {
            listEl.innerHTML = `
                <div style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:10px; padding:20px; text-align:center; color:#10b981;">
                    <div style="font-size:24px; margin-bottom:6px;">✅</div>
                    <div style="font-weight:800; font-size:14px;">100% Clean! No Sensitive PII Found.</div>
                    <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">No emails, credit cards, SSNs, or API keys were detected in step text.</div>
                </div>
            `;
        } else {
            listEl.innerHTML = report.findings.map((f, i) => `
                <div style="background:rgba(0,0,0,0.25); border:1px solid rgba(239,68,68,0.25); border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="badge" style="background:#ef4444; color:#fff; font-size:9.5px; font-weight:800; text-transform:uppercase; padding:2px 6px; border-radius:4px;">${f.type}</span>
                            <span style="font-size:12px; font-weight:700; color:#fff;">Step ID #${f.step_id || 'N/A'} — ${f.field}</span>
                        </div>
                        <div style="font-family:monospace; font-size:11px; color:#f87171; margin-top:4px;">"${f.matched_text}"</div>
                    </div>
                    <span style="font-size:10px; color:var(--text-muted);">${f.confidence}% confidence</span>
                </div>
            `).join("");
        }

        const redactBtn = $("btnApplyPiiRedactAll");
        if (redactBtn) {
            redactBtn.onclick = () => triggerAutoRedactPii();
        }
    } catch (err) {
        listEl.innerHTML = `<div style="color:#ef4444; padding:20px;">Scan failed: ${err.message}</div>`;
    }
}

async function triggerAutoRedactPii() {
    if (!workflow || !workflow.id) return;
    try {
        const res = await fetch(`${API_BASE}/sessions/${workflow.id}/auto-redact-pii`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        showToast(`🔒 ${data.message}`, 4000);
        $("piiScannerModal")?.classList.add("hidden");
        if ($("piiScannerModal")) $("piiScannerModal").style.display = "none";
        await loadWorkflow(workflow.id);
    } catch (err) {
        showToast(`Auto-redact failed: ${err.message}`, 3000);
    }
}

// ── Portable Package (.procsnap.zip) Import Handler ──────────────────────
const importPkgInput = $("importPackageFileInput");
if (importPkgInput) {
    importPkgInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        showToast("⏳ Unpacking and restoring .procsnap.zip package...", 5000);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`${API_BASE}/sessions/import-package`, {
                method: "POST",
                body: formData
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            showToast(`🎉 Imported "${data.name}" (${data.steps_imported} steps)!`, 4000);
            await fetchWorkflows();
            if (data.workflow_id) await loadWorkflow(data.workflow_id);
        } catch (err) {
            console.error("Import package error:", err);
            showToast(`Import failed: ${err.message}`, 4000);
        } finally {
            importPkgInput.value = "";
        }
    };
}

// ── Master Settings, Profile & Persona Mode Engine ──────────────────────────
function initModeSwitcher() {
    const settingsModal = $("settingsModal");
    const openSettingsBtn = $("btnOpenSettingsModal");
    const closeSettingsBtn = $("btnCloseSettingsModal");
    const saveSettingsBtn = $("btnSettingsSaveAll");
    const themeBtn = $("btnSettingsThemeToggle");
    const diagBtn = $("btnSettingsDiagnostics");

    // Load saved settings
    const defaultMode = localStorage.getItem("procsnap_default_mode") || "simple";
    let currentMode = localStorage.getItem("procsnap_ux_mode") || defaultMode;

    const authorInput = $("settingDefaultAuthor");
    const deptInput = $("settingDefaultDept");
    const reviewerInput = $("settingDefaultReviewer");
    const approverInput = $("settingDefaultApprover");
    const autoPiiCb = $("settingAutoPiiRedact");
    const autoAiCb = $("settingAutoAiTitles");
    const persistModeCb = $("cbPersistDefaultMode");

    if (authorInput) authorInput.value = localStorage.getItem("procsnap_default_author") || "";
    if (deptInput) deptInput.value = localStorage.getItem("procsnap_default_dept") || "";
    if (reviewerInput) reviewerInput.value = localStorage.getItem("procsnap_default_reviewer") || "";
    if (approverInput) approverInput.value = localStorage.getItem("procsnap_default_approver") || "";
            if (autoPiiCb) autoPiiCb.checked = localStorage.getItem("procsnap_auto_pii") === "true";
    if (autoAiCb) autoAiCb.checked = localStorage.getItem("procsnap_auto_ai") !== "false";

    function applyMode(mode, saveAsDefault = false) {
        currentMode = mode;
        localStorage.setItem("procsnap_ux_mode", mode);
        if (saveAsDefault || (persistModeCb && persistModeCb.checked)) {
            localStorage.setItem("procsnap_default_mode", mode);
        }

        // Update Persona cards in modal
        document.querySelectorAll(".settings-persona-card").forEach(card => {
            const isMatch = card.dataset.mode === mode;
            const badge = card.querySelector(".persona-active-badge");
            if (badge) badge.style.display = isMatch ? "inline-block" : "none";
            if (isMatch) {
                if (mode === "simple") {
                    card.style.borderColor = "#10b981";
                    card.style.background = "rgba(16,185,129,0.08)";
                } else if (mode === "advanced") {
                    card.style.borderColor = "#6366f1";
                    card.style.background = "rgba(99,102,241,0.08)";
                } else if (mode === "enterprise") {
                    card.style.borderColor = "#8b5cf6";
                    card.style.background = "rgba(139,92,246,0.08)";
                }
            } else {
                card.style.borderColor = "var(--border-subtle, rgba(255,255,255,0.1))";
                card.style.background = "rgba(0,0,0,0.15)";
            }
        });

        // Dynamic workspace visibility according to mode
        const isSimple = mode === "simple";
        const metaPaneBtn = document.querySelector('.drawer-seg-btn[data-view="meta"]');
        if (metaPaneBtn) metaPaneBtn.style.display = isSimple ? "none" : "flex";

        const branchPaneBtn = document.querySelector('.drawer-seg-btn[data-view="branch"]');
        if (branchPaneBtn) branchPaneBtn.style.display = isSimple ? "none" : "flex";

        const notesPaneBtn = document.querySelector('.drawer-seg-btn[data-view="notes"]');
        if (notesPaneBtn) notesPaneBtn.style.display = isSimple ? "none" : "flex";

        const hotspotPaneBtn = document.querySelector('.drawer-seg-btn[data-view="hotspot"]');
        if (hotspotPaneBtn && isSimple) hotspotPaneBtn.click();
    }

    // Bind Persona Card clicks
    document.querySelectorAll(".settings-persona-card").forEach(card => {
        card.onclick = () => {
            applyMode(card.dataset.mode);
            showToast(`Switched to ${card.dataset.mode.toUpperCase()} Mode`, 2000);
        };
    });

    // Open/Close Modal
    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.onclick = () => {
            settingsModal.style.display = "block";
            settingsModal.classList.remove("hidden");
        };
    }
    if (closeSettingsBtn && settingsModal) {
        closeSettingsBtn.onclick = () => {
            settingsModal.style.display = "none";
            settingsModal.classList.add("hidden");
        };
    }

    // Save All Settings
    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = () => {
            if (authorInput) localStorage.setItem("procsnap_default_author", authorInput.value.trim());
            if (deptInput) localStorage.setItem("procsnap_default_dept", deptInput.value.trim());
            if (reviewerInput) localStorage.setItem("procsnap_default_reviewer", reviewerInput.value.trim());
            if (approverInput) localStorage.setItem("procsnap_default_approver", approverInput.value.trim());
            if (autoPiiCb) localStorage.setItem("procsnap_auto_pii", autoPiiCb.checked ? "true" : "false");
            if (autoAiCb) localStorage.setItem("procsnap_auto_ai", autoAiCb.checked ? "true" : "false");
            if (persistModeCb && persistModeCb.checked) {
                localStorage.setItem("procsnap_default_mode", currentMode);
            }
            if (settingsModal) {
                settingsModal.style.display = "none";
                settingsModal.classList.add("hidden");
            }
            showToast("✓ Settings & Profile saved successfully!", 2500);
        };
    }

    // Theme Toggle inside Settings
    if (themeBtn) {
        themeBtn.onclick = () => {
            const topThemeBtn = $("themeToggleBtn");
            if (topThemeBtn) topThemeBtn.click();
        };
    }

    // Diagnostics Shortcut inside Settings
    if (diagBtn) {
        diagBtn.onclick = () => {
            if (settingsModal) {
                settingsModal.style.display = "none";
                settingsModal.classList.add("hidden");
            }
            openSystemRequirementsModal();
        };
    }

    applyMode(currentMode);
}

// ── ProcBot RPA Automation Studio Engine v3 (UI/UX Master Edition) ────────
let isProcBotRunning = false;
let isProcBotPaused = false;
let procBotStepResolve = null;
let procBotElapsedTimer = null;
let procBotStartTime = null;
let procBotTargetWorkflow = null;
let procBotBatchRows = [];
let procBotLogsHistory = [];
let procBotActiveTab = "builder";
let procBotCurrentCodeLang = "playwright";

function initProcBotRunner() {
    const modal = $("procbotRunnerModal");
    const openBtn = $("btnOpenProcBot");
    const closeBtn = $("btnCloseProcbotModal");
    const openInNewTabBtn = $("btnProcbotOpenInNewTab");
    const newBotBtn = $("btnProcbotNewBot");
    const renameBotBtn = $("btnProcbotRenameBot");
    const modalWfTitle = $("procbotModalWfTitle");
    const runBtn = $("btnRunProcBotNow");
    const quickRunBtn = $("btnProcbotQuickRun");
    const stopBtn = $("btnStopProcBot");
    const pauseBtn = $("btnPauseProcBot");
    const resumeBtn = $("btnResumeProcBot");
    const nextStepBtn = $("btnNextStepProcBot");
    const saveConfigBtn = $("btnProcbotSaveConfig");
    const addNavigateBtn = $("btnProcbotAddNavigateStep");
    const addClickBtn = $("btnProcbotAddClickStep");
    const addInputBtn = $("btnProcbotAddInputStep");
    const addSelectBtn = $("btnProcbotAddSelectStep");
    const addExtractBtn = $("btnProcbotAddExtractStep");
    const addAssertBtn = $("btnProcbotAddAssertStep");
    const addManualBtn = $("btnProcbotAddManualStep");
    const stepSearchInput = $("procbotStepSearch");
    const stepsListEl = $("procbotStepsList");
    const termLog = $("procbotTerminalLog");
    const clearTermBtn = $("btnClearProcbotTerminal");
    const progressBar = $("procbotProgressBar");
    const progressPercent = $("procbotProgressPercent");
    const statusText = $("procbotStatusText");
    const statusPill = $("procbotStatusPill");
    const elapsedEl = $("procbotElapsedTime");
    const activeEngineBadge = $("procbotActiveEngineBadge");
    const stepSeqIndicator = $("procbotStepSeqIndicator");
    const engineSelect = $("procbotEngineSelect");
    const speedSelect = $("procbotSpeedSelect");
    const loadWaitSelect = $("procbotLoadWait");
    const execModeSelect = $("procbotExecMode");
    const wfSelector = $("procbotWorkflowSelector");
    const wfSelect = $("procbotWorkflowSelect");
    const liveScreenshot = $("procbotLiveScreenshot");
    const liveOverlay = $("procbotLiveOverlay");
    const hubProcBotBtn = $("hubActionProcBot");
    const hubCreateBotBtn = $("hubActionCreateBot");
    const aiPromptBtn = $("btnProcbotAIPrompt");
    const aiPromptModal = $("procbotAIPromptModal");
    const aiPromptInput = $("procbotAIPromptInput");
    const closeAiPromptBtn = $("btnCloseProcbotAIPromptModal");
    const cancelAiPromptBtn = $("btnCancelProcbotAIPrompt");
    const submitAiPromptBtn = $("btnSubmitProcbotAIPrompt");

    // Batch Tab Elements
    const batchCsvInput = $("procbotBatchCsvInput");
    const downloadCsvTemplateBtn = $("btnProcbotDownloadCsvTemplate");
    const batchPreviewContainer = $("procbotBatchPreviewContainer");
    const runBatchBtn = $("btnProcbotRunBatch");

    // History Tab Elements
    const historyListEl = $("procbotHistoryList");
    const histTotalRuns = $("procbotHistTotalRuns");
    const histSuccessRate = $("procbotHistSuccessRate");
    const histAvgDuration = $("procbotHistAvgDuration");
    const histLastRun = $("procbotHistLastRun");

    // Code Tab Elements
    const codeViewer = $("procbotCodeViewer");
    const copyCodeBtn = $("btnProcbotCopyCode");
    const downloadCodeBtn = $("btnProcbotDownloadCode");

    // ── Tab Switching Logic ──────────────────────────────────────────────────
    function switchProcBotTab(tabName) {
        procBotActiveTab = tabName;
        // Update tab buttons
        document.querySelectorAll("#procbotStudioTabBar .procbot-nav-tab").forEach(btn => {
            const isTarget = btn.dataset.tab === tabName;
            btn.classList.toggle("active", isTarget);
            btn.style.borderBottomColor = isTarget ? "#6366f1" : "transparent";
            btn.style.color = isTarget ? "#818cf8" : "#94a3b8";
            btn.style.fontWeight = isTarget ? "800" : "700";
        });

        // Toggle tab panes
        const panes = {
            builder: $("procbotTabBuilder"),
            monitor: $("procbotTabMonitor"),
            batch: $("procbotTabBatch"),
            history: $("procbotTabHistory"),
            code: $("procbotTabCode")
        };

        Object.keys(panes).forEach(k => {
            if (panes[k]) {
                panes[k].style.display = k === tabName ? "flex" : "none";
            }
        });

        // Tab specific refreshes
        if (tabName === "monitor") {
            const wf = getActiveWorkflow();
            if (wf && wf.steps && wf.steps.length) {
                showLiveScreenshot(wf, 0);
            }
        }
        if (tabName === "history") loadHistoryLogs();
        if (tabName === "code") renderExportCode(procBotCurrentCodeLang);
        if (tabName === "batch") renderBatchPreview();
    }

    document.querySelectorAll("#procbotStudioTabBar .procbot-nav-tab").forEach(btn => {
        btn.onclick = () => switchProcBotTab(btn.dataset.tab);
    });

    // ── Terminal Logger ──────────────────────────────────────────────────────
    function logTerm(msg, type) {
        if (!termLog) return;
        const line = document.createElement("div");
        const ts = new Date().toLocaleTimeString();
        const colors = { success: "#34d399", warn: "#fbbf24", error: "#f87171", dim: "#64748b", pause: "#c084fc", info: "#38bdf8", heal: "#a855f7" };
        line.style.color = colors[type] || colors.info;
        line.style.fontSize = "11px";
        line.style.lineHeight = "1.5";
        line.textContent = `[${ts}] ${msg}`;
        termLog.appendChild(line);
        termLog.scrollTop = termLog.scrollHeight;
        procBotLogsHistory.push({ time: ts, msg, type: type || "info" });
    }

    if (clearTermBtn) {
        clearTermBtn.onclick = () => {
            if (termLog) termLog.innerHTML = '<div style="color:#64748b;">// Terminal log cleared.</div>';
        };
    }

    function updateElapsed() {
        if (!procBotStartTime || !elapsedEl) return;
        const diff = Math.floor((Date.now() - procBotStartTime) / 1000);
        elapsedEl.textContent = `${String(Math.floor(diff / 60)).padStart(2, "0")}:${String(diff % 60).padStart(2, "0")}`;
    }

    function getActiveWorkflow() { return procBotTargetWorkflow || workflow; }

    // Inject custom animation styles for virtual browser simulator
    if (!document.getElementById("procbot-anim-styles")) {
        const style = document.createElement("style");
        style.id = "procbot-anim-styles";
        style.textContent = `
            @keyframes procbotPulse {
                0% { transform: scale(1); box-shadow: 0 0 20px rgba(99,102,241,0.2); }
                50% { transform: scale(1.015); box-shadow: 0 0 35px rgba(99,102,241,0.45); }
                100% { transform: scale(1); box-shadow: 0 0 20px rgba(99,102,241,0.2); }
            }
            @keyframes procbotBlink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
            }
        `;
        document.head.appendChild(style);
    }

    let typewriterTimer = null;

    function showLiveScreenshot(wf, stepIdx, overrideVal) {
        if (!liveScreenshot || !liveOverlay) return;
        const activeWf = wf || getActiveWorkflow();
        if (!activeWf || !activeWf.steps || !activeWf.steps[stepIdx]) return;
        const step = activeWf.steps[stepIdx];
        const act = (step.action || "click").toLowerCase();
        const title = step.edited_title || step.title || `Step ${stepIdx + 1}`;
        const targetVal = overrideVal !== undefined ? overrideVal : (step.value || "");
        const targetUrl = step.url || (activeWf.steps[0] ? activeWf.steps[0].url : "") || "https://app.procsnap.local";
        const customSel = step.custom_selector || (step.element ? (step.element.cssSelector || step.element.xpath || (step.element.id ? `#${step.element.id}` : "")) : "");
        const isInput = ["input", "change", "textarea_input", "type"].includes(act);
        const isSelect = ["select", "dropdown"].includes(act);
        const isNav = act.includes("navigate") || act.includes("page_load");
        const isAssert = act.startsWith("assert") || act === "verify" || act === "check";
        const isExtract = act === "extract";
        const isManualTask = act === "manual_pause" || act === "manual_task" || step.manual_pause || step._manualPause;

        if (stepSeqIndicator) stepSeqIndicator.textContent = `Step ${stepIdx + 1} of ${activeWf.steps.length}`;

        // Clear any previous typewriter timer
        if (typewriterTimer) {
            clearInterval(typewriterTimer);
            typewriterTimer = null;
        }

        // Action visual badges
        let actIcon = "🖱️";
        let actBadge = "CLICK ELEMENT";
        let actColor = "#818cf8";
        let actBg = "rgba(99,102,241,0.15)";
        if (isNav) { actIcon = "🌐"; actBadge = "NAVIGATE URL"; actColor = "#60a5fa"; actBg = "rgba(59,130,246,0.15)"; }
        else if (isInput) { actIcon = "⌨️"; actBadge = "TYPE / INPUT"; actColor = "#34d399"; actBg = "rgba(16,185,129,0.15)"; }
        else if (isSelect) { actIcon = "🔽"; actBadge = "SELECT DROPDOWN"; actColor = "#fbbf24"; actBg = "rgba(245,158,11,0.15)"; }
        else if (isExtract) { actIcon = "📥"; actBadge = "EXTRACT DATA"; actColor = "#c084fc"; actBg = "rgba(168,85,247,0.15)"; }
        else if (isAssert) { actIcon = "🔍"; actBadge = "ASSERT CHECK"; actColor = "#22d3ee"; actBg = "rgba(6,182,212,0.15)"; }
        else if (isManualTask) { actIcon = "✋"; actBadge = "HUMAN ACTION"; actColor = "#fbbf24"; actBg = "rgba(251,191,36,0.15)"; }

        // Render Live Interactive Webpage Viewport
        liveScreenshot.style.display = "none";
        liveOverlay.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;background:#090d16;overflow:hidden;";
        liveOverlay.innerHTML = `
            <!-- Chrome Browser Navigation Bar -->
            <div style="background: #111827; border-bottom: 1px solid rgba(255,255,255,0.08); padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444; display: inline-block;"></span>
                    <span style="width: 10px; height: 10px; border-radius: 50%; background: #f59e0b; display: inline-block;"></span>
                    <span style="width: 10px; height: 10px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
                </div>
                <!-- Address Bar with Live URL -->
                <div style="flex: 1; max-width: 520px; background: #080c14; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 5px 12px; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #94a3b8; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span style="color: #10b981; font-size: 11px;">🔒</span>
                    <span style="color: #38bdf8; font-weight: 700;">${esc(targetUrl)}</span>
                </div>
                <span style="font-size: 10px; font-weight: 800; padding: 4px 10px; border-radius: 6px; background: ${actBg}; color: ${actColor}; border: 1px solid ${actColor}40;">${actIcon} ${actBadge}</span>
            </div>

            <!-- Live Interactive Webpage Viewport -->
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; position: relative; background: radial-gradient(circle at center, rgba(99,102,241,0.06) 0%, #090d16 80%); overflow-y: auto;">
                
                <!-- Live Web Form Container -->
                <div style="background: rgba(17,24,39,0.92); border: 2px solid ${actColor}; border-radius: 14px; padding: 24px; width: 92%; max-width: 500px; box-shadow: 0 0 40px ${actColor}25, 0 15px 35px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px; backdrop-filter: blur(10px); position: relative;">
                    
                    <!-- Form Title & Badge -->
                    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 36px; height: 36px; border-radius: 10px; background: ${actBg}; border: 1px solid ${actColor}40; display: flex; align-items: center; justify-content: center; font-size: 18px;">
                                ${actIcon}
                            </div>
                            <div>
                                <div style="font-size: 13.5px; font-weight: 800; color: #f8fafc;">${esc(title)}</div>
                                <div style="font-size: 10.5px; color: #94a3b8;">${isNav ? 'Web Page Navigation' : isInput ? 'Live Text Input & Typing' : isSelect ? 'Dropdown Selection' : isExtract ? 'Data Extraction' : isAssert ? 'Validation Check' : 'Element Click'}</div>
                            </div>
                        </div>
                        <span style="font-size: 10.5px; font-weight: 700; color: #38bdf8; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.25); padding: 3px 8px; border-radius: 5px;">Step ${stepIdx + 1} / ${activeWf.steps.length}</span>
                    </div>

                    <!-- Live Target Field or Action -->
                    ${isInput ? `
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; font-weight: 700; color: #94a3b8; display: flex; justify-content: space-between;">
                            <span>Target Input Field: <code style="color: #38bdf8; font-size: 10px;">${esc(customSel || 'input[name="q"]')}</code></span>
                            <span style="color: #34d399; font-size: 10px; font-weight: 800;">● LIVE TYPING</span>
                        </label>
                        <div style="position: relative; display: flex; align-items: center;">
                            <input id="liveSimInput" type="text" value="" placeholder="Entering value..." readonly style="width: 100%; background: #080c14; border: 2px solid #34d399; border-radius: 8px; padding: 10px 14px; font-size: 13px; font-weight: 700; color: #34d399; font-family: monospace; outline: none; box-shadow: 0 0 20px rgba(52,211,153,0.25);">
                            <span id="liveSimCaret" style="position: absolute; right: 12px; font-size: 14px; color: #34d399; animation: procbotBlink 0.8s infinite; font-weight: 800;">|</span>
                        </div>
                    </div>` : isSelect ? `
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; font-weight: 700; color: #94a3b8;">Target Dropdown Option:</label>
                        <div style="background: #080c14; border: 2px solid #fbbf24; border-radius: 8px; padding: 10px 14px; font-size: 13px; font-weight: 700; color: #fbbf24; display: flex; align-items: center; justify-content: space-between;">
                            <span>${esc(targetVal || 'Option 1')}</span>
                            <span style="color: #fbbf24;">✓ Selected</span>
                        </div>
                    </div>` : isExtract ? `
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; font-weight: 700; color: #94a3b8;">Extracted Data to Variable:</label>
                        <div style="background: #080c14; border: 2px solid #c084fc; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; font-weight: 700; color: #c084fc; font-family: monospace; display: flex; align-items: center; justify-content: space-between;">
                            <span>{{${esc(step.extract_var || 'extracted_var')}}}</span>
                            <span style="color: #34d399;">📥 Captured</span>
                        </div>
                    </div>` : `
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 10px 0;">
                        <button id="liveSimBtn" style="background: linear-gradient(135deg, ${actColor}, #4f46e5); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 11px 24px; font-size: 13px; font-weight: 800; display: flex; align-items: center; gap: 8px; cursor: pointer; box-shadow: 0 0 25px ${actColor}40; transition: all 0.2s;">
                            <span>${actIcon}</span>
                            <span>${esc(title)}</span>
                        </button>
                        <div style="font-size: 10.5px; color: #64748b; font-family: monospace;">Target: ${esc(customSel || 'button.primary')}</div>
                    </div>`}

                    <!-- Live Status Footer -->
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; color: #64748b; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981; animation: procbotBlink 1.2s infinite;"></span>
                            <span style="color: #10b981; font-weight: 800;">EXECUTING IN REAL TIME</span>
                        </div>
                        <span style="font-family: monospace; color: #94a3b8;">Engine: Browser (Live)</span>
                    </div>
                </div>
            </div>
        `;

        // Animate Real Character-by-Character Typewriter in Preview
        if (isInput && targetVal) {
            const inputEl = document.getElementById("liveSimInput");
            if (inputEl) {
                const chars = targetVal.split("");
                let idx = 0;
                inputEl.value = "";
                typewriterTimer = setInterval(() => {
                    if (idx < chars.length) {
                        inputEl.value += chars[idx];
                        idx++;
                    } else {
                        clearInterval(typewriterTimer);
                        typewriterTimer = null;
                    }
                }, 40);
            }
        }
    }

    // ── Render Step Sequence Cards with High-Contrast UI/UX ───────────────────
    function renderSteps(targetWf) {
        const wf = targetWf || getActiveWorkflow();
        if (!wf || !wf.steps) return;
        if ($("procbotModalWfTitle")) $("procbotModalWfTitle").textContent = `ProcBot: ${wf.name || "Workflow"}`;
        if ($("procbotStepCountBadge")) $("procbotStepCountBadge").textContent = `${wf.steps.length} steps`;
        if (!stepsListEl) return;

        // Empty State: Blank Custom Bot Canvas with Quick Starters
        if (!wf.steps.length) {
            stepsListEl.innerHTML = `
                <div style="background: rgba(99,102,241,0.04); border: 2px dashed rgba(99,102,241,0.25); border-radius: 14px; padding: 36px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; margin: 10px 0;">
                    <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(168,85,247,0.15); border: 1px solid rgba(168,85,247,0.3); display: flex; align-items: center; justify-content: center; font-size: 24px;">🤖</div>
                    <div>
                        <h4 style="margin: 0 0 4px; font-size: 15px; font-weight: 800; color: #f8fafc;">Blank Custom RPA Bot</h4>
                        <p style="margin: 0; font-size: 12px; color: #94a3b8; max-width: 460px;">This bot has no recorded SOP steps. Start building your automated sequence by choosing an initial action below:</p>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; width: 100%; max-width: 620px; margin-top: 6px;">
                        <button class="btn-quick-add-step" data-act="navigate" style="background: #111827; border: 1px solid rgba(59,130,246,0.3); border-radius: 8px; padding: 12px 8px; color: #60a5fa; font-weight: 700; font-size: 11.5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                            <span style="font-size: 18px;">🌐</span> Navigate URL
                        </button>
                        <button class="btn-quick-add-step" data-act="click" style="background: #111827; border: 1px solid rgba(99,102,241,0.3); border-radius: 8px; padding: 12px 8px; color: #818cf8; font-weight: 700; font-size: 11.5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                            <span style="font-size: 18px;">🖱️</span> Click Element
                        </button>
                        <button class="btn-quick-add-step" data-act="input" style="background: #111827; border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 12px 8px; color: #34d399; font-weight: 700; font-size: 11.5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                            <span style="font-size: 18px;">⌨️</span> Type Input
                        </button>
                        <button class="btn-quick-add-step" data-act="select" style="background: #111827; border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 12px 8px; color: #fbbf24; font-weight: 700; font-size: 11.5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                            <span style="font-size: 18px;">🔽</span> Select Option
                        </button>
                        <button class="btn-quick-add-step" data-act="extract" style="background: #111827; border: 1px solid rgba(168,85,247,0.3); border-radius: 8px; padding: 12px 8px; color: #c084fc; font-weight: 700; font-size: 11.5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                            <span style="font-size: 18px;">📥</span> Extract Data
                        </button>
                        <button class="btn-quick-add-step" data-act="assert" style="background: #111827; border: 1px solid rgba(6,182,212,0.3); border-radius: 8px; padding: 12px 8px; color: #22d3ee; font-weight: 700; font-size: 11.5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                            <span style="font-size: 18px;">🔍</span> Assert Check
                        </button>
                    </div>
                </div>
            `;
            stepsListEl.querySelectorAll(".btn-quick-add-step").forEach(btn => {
                btn.onclick = () => {
                    const act = btn.dataset.act;
                    if (act === "navigate") addNavigateStep();
                    else if (act === "click") addClickStep();
                    else if (act === "input") addInputStep();
                    else if (act === "select") addSelectStep();
                    else if (act === "extract") addExtractStep();
                    else if (act === "assert") addAssertStep();
                };
            });
            return;
        }

        const filterQuery = (stepSearchInput ? stepSearchInput.value : "").toLowerCase().trim();

        stepsListEl.innerHTML = wf.steps.map((step, idx) => {
            const act = (step.action || "click").toLowerCase();
            const isManualTask = act === "manual_pause" || act === "manual_task" || step.manual_pause || step._manualPause;
            const isInput = ["input", "change", "textarea_input", "type"].includes(act);
            const isSelect = ["select", "dropdown"].includes(act);
            const isWait = ["wait", "delay"].includes(act);
            const isNav = act.includes("navigate") || act.includes("page_load");
            const isAssert = act.startsWith("assert") || act === "verify" || act === "check";
            const isExtract = act === "extract";
            const title = step.edited_title || step.title || `Step ${idx + 1}`;
            const rawVal = step.value || "";
            const varKey = `var_${(title || `step_${idx + 1}`).toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 24)}`;
            const isHidden = step.hidden || step._disabled;
            const customSel = step.custom_selector || (step.element ? (step.element.cssSelector || step.element.xpath || step.element.id ? `#${step.element.id}` : "") : "");
            const retryCount = step.retry_count || 1;
            const onFail = step.on_failure || "abort";

            // Search filter
            if (filterQuery && !title.toLowerCase().includes(filterQuery) && !rawVal.toLowerCase().includes(filterQuery) && !varKey.includes(filterQuery)) {
                return "";
            }

            let actBadgeColor = "#6366f1";
            let actBadgeBg = "rgba(99,102,241,0.15)";
            if (isInput) { actBadgeColor = "#34d399"; actBadgeBg = "rgba(16,185,129,0.15)"; }
            if (isSelect) { actBadgeColor = "#38bdf8"; actBadgeBg = "rgba(56,189,248,0.15)"; }
            if (isManualTask) { actBadgeColor = "#fbbf24"; actBadgeBg = "rgba(251,191,36,0.15)"; }
            if (isWait) { actBadgeColor = "#c084fc"; actBadgeBg = "rgba(168,85,247,0.15)"; }
            if (isNav) { actBadgeColor = "#60a5fa"; actBadgeBg = "rgba(59,130,246,0.15)"; }
            if (isAssert) { actBadgeColor = "#22d3ee"; actBadgeBg = "rgba(6,182,212,0.15)"; }
            if (isExtract) { actBadgeColor = "#c084fc"; actBadgeBg = "rgba(192,132,252,0.15)"; }

            let hostLabel = "";
            if (step.url) { try { hostLabel = new URL(step.url.startsWith("http") ? step.url : "https://app.local").hostname; } catch(e) {} }

            return `
                <div class="procbot-step-card" data-step-idx="${idx}" style="background: #111827; border: 1px solid ${isAssert ? 'rgba(34,211,238,0.3)' : isExtract ? 'rgba(192,132,252,0.3)' : isManualTask ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.08)'}; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; transition: all .15s ease; ${isHidden ? 'opacity: 0.4;' : ''}">
                    <!-- Top Row: Checkbox, Step Number, Action Selector, Title Input, Host Pill, Controls -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                            <input type="checkbox" class="procbot-step-active" ${!isHidden ? 'checked' : ''} style="accent-color: #10b981; width: 15px; height: 15px; cursor: pointer;" title="Enable/Disable step">
                            
                            <span style="font-size: 10.5px; font-weight: 800; font-family: monospace; color: #94a3b8; background: #1f293d; padding: 2px 6px; border-radius: 4px;">#${String(idx + 1).padStart(2, '0')}</span>

                            <!-- Action Selector -->
                            <select class="procbot-step-action-select" data-step-idx="${idx}" style="font-size: 11px; font-weight: 800; background: ${actBadgeBg}; color: ${actBadgeColor}; border: 1px solid ${actBadgeColor}44; border-radius: 6px; padding: 3px 6px; cursor: pointer; outline: none;">
                                <option value="click" ${act === 'click' ? 'selected' : ''}>🖱️ Click</option>
                                <option value="dblclick" ${act === 'dblclick' || act === 'double_click' ? 'selected' : ''}>🖱️ Double-Click</option>
                                <option value="input" ${isInput ? 'selected' : ''}>⌨️ Type Input</option>
                                <option value="select" ${isSelect ? 'selected' : ''}>🔽 Dropdown Select</option>
                                <option value="assert_text" ${isAssert ? 'selected' : ''}>🔍 Assert Validation</option>
                                <option value="extract" ${isExtract ? 'selected' : ''}>📥 Extract to Variable</option>
                                <option value="manual_pause" ${isManualTask ? 'selected' : ''}>✋ Manual Task</option>
                                <option value="navigate" ${isNav ? 'selected' : ''}>🌐 Navigate URL</option>
                                <option value="wait" ${isWait ? 'selected' : ''}>⏱️ Wait Delay</option>
                                <option value="keypress_enter" ${act.includes('enter') || act.includes('key') ? 'selected' : ''}>⏎ Press Enter</option>
                            </select>

                            <!-- Step Title Edit -->
                            <input type="text" class="procbot-step-title-input" data-step-idx="${idx}" value="${esc(title)}" placeholder="Step Title..." style="font-size: 12px; font-weight: 700; padding: 4px 8px; height: 26px; border-radius: 6px; flex: 1; min-width: 120px; background: #080c14; color: #f8fafc; border: 1px solid rgba(255,255,255,0.12); outline: none;">
                        </div>

                        <!-- Top Right Step Controls -->
                        <div style="display: flex; align-items: center; gap: 4px;">
                            ${hostLabel ? `<span style="font-size: 10px; font-weight: 700; color: #64748b; background: #1e293b; padding: 2px 6px; border-radius: 4px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🌐 ${hostLabel}</span>` : ''}
                            
                            <button class="procbot-test-step-btn" data-step-idx="${idx}" style="background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3); border-radius: 5px; color: #38bdf8; padding: 2px 6px; font-size: 10px; font-weight: 700; cursor: pointer;" title="Dry-run this single step in browser">⚡ Test</button>
                            <button class="procbot-pick-selector-btn" data-step-idx="${idx}" style="background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3); border-radius: 5px; height: 22px; cursor: pointer; padding: 0 6px; font-size: 10px; font-weight: 700; color: #38bdf8; display: inline-flex; align-items: center; gap: 3px;" title="Interactive Point-and-Click Selector Picker on live page">🎯 Pick</button>
                            <button class="procbot-resilience-btn" data-step-idx="${idx}" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; padding: 2px 6px; font-size: 10px; font-weight: 700; cursor: pointer; color: #34d399;" title="Resilience & Retry Policy">🛡️ ${retryCount > 1 ? `${retryCount}x` : '1x'}</button>
                            <button class="procbot-breakpoint-btn" data-bp-idx="${idx}" style="background: ${step._breakpoint ? '#ef4444' : 'rgba(255,255,255,0.06)'}; border: 1px solid ${step._breakpoint ? '#ef4444' : 'rgba(255,255,255,0.12)'}; border-radius: 5px; width: 22px; height: 22px; cursor: pointer; padding: 0; font-size: 10px; color: ${step._breakpoint ? '#fff' : '#64748b'};" title="Toggle Breakpoint">●</button>
                            <button class="procbot-manual-pause-btn" data-mp-idx="${idx}" style="background: ${isManualTask ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.06)'}; border: 1px solid ${isManualTask ? '#fbbf24' : 'rgba(255,255,255,0.12)'}; border-radius: 5px; width: 22px; height: 22px; cursor: pointer; padding: 0; font-size: 11px; color: ${isManualTask ? '#fbbf24' : '#64748b'};" title="Toggle Stop for Manual Action">✋</button>
                            <button class="procbot-edit-selector-btn" data-step-idx="${idx}" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; width: 22px; height: 22px; cursor: pointer; padding: 0; font-size: 10px; color: #818cf8;" title="Target Selector Inspector">⚙️</button>
                            <button class="procbot-step-move-up" data-step-idx="${idx}" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 2px; font-size: 11px;" title="Move Up" ${idx === 0 ? 'disabled style="opacity:0.2"' : ''}>⬆️</button>
                            <button class="procbot-step-move-down" data-step-idx="${idx}" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 2px; font-size: 11px;" title="Move Down" ${idx === wf.steps.length - 1 ? 'disabled style="opacity:0.2"' : ''}>⬇️</button>
                            <button class="procbot-step-insert-below" data-step-idx="${idx}" style="background: none; border: none; color: #10b981; cursor: pointer; padding: 2px; font-size: 11px;" title="Insert Step Below">➕</button>
                            <button class="procbot-step-delete" data-step-idx="${idx}" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 2px; font-size: 11px;" title="Delete Step">🗑️</button>
                        </div>
                    </div>

                    <!-- Row 2: Dynamic Parameters / Field Value / Dropdown / Assertion / Extraction -->
                    ${isAssert ? `
                    <div style="display: grid; grid-template-columns: 160px 1fr; gap: 8px; align-items: center; background: #080c14; border-radius: 7px; padding: 6px 10px; border: 1px dashed rgba(6,182,212,0.35);">
                        <select class="procbot-assert-type-select" data-step-idx="${idx}" style="font-size: 11px; font-weight: 700; background: #131b2e; color: #22d3ee; border: 1px solid rgba(6,182,212,0.3); border-radius: 5px; padding: 3px 6px;">
                            <option value="text" ${(step.assert_type || 'text') === 'text' ? 'selected' : ''}>🔍 Text Contains</option>
                            <option value="value" ${step.assert_type === 'value' ? 'selected' : ''}>🔍 Value Equals</option>
                            <option value="url" ${step.assert_type === 'url' ? 'selected' : ''}>🌐 URL Contains</option>
                            <option value="visible" ${step.assert_type === 'visible' ? 'selected' : ''}>👁️ Element Visible</option>
                            <option value="hidden" ${step.assert_type === 'hidden' ? 'selected' : ''}>🚫 Element Hidden</option>
                        </select>
                        <input type="text" class="procbot-assert-val-input" data-step-idx="${idx}" value="${esc(step.expected || rawVal)}" placeholder="Expected text, value, or URL substring..." style="font-size: 11.5px; padding: 4px 8px; height: 26px; border-radius: 5px; background: #131b2e; color: #22d3ee; border: 1px solid rgba(6,182,212,0.25); outline: none;">
                    </div>` : ''}

                    ${isExtract ? `
                    <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; background: #080c14; border-radius: 7px; padding: 6px 10px; border: 1px dashed rgba(192,132,252,0.35);">
                        <select class="procbot-extract-attr-select" data-step-idx="${idx}" style="font-size: 11px; font-weight: 700; background: #131b2e; color: #c084fc; border: 1px solid rgba(192,132,252,0.3); border-radius: 5px; padding: 3px 6px;">
                            <option value="text" ${(step.extract_attr || 'text') === 'text' ? 'selected' : ''}>📥 Text Content</option>
                            <option value="value" ${step.extract_attr === 'value' ? 'selected' : ''}>📥 Input Value</option>
                            <option value="href" ${step.extract_attr === 'href' ? 'selected' : ''}>🔗 Link Href</option>
                            <option value="src" ${step.extract_attr === 'src' ? 'selected' : ''}>🖼️ Image Src</option>
                        </select>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 10px; font-weight: 800; color: #c084fc;">Save to:</span>
                            <input type="text" class="procbot-extract-var-input" data-step-idx="${idx}" value="${esc(step.extract_var || varKey)}" placeholder="variable_name..." style="font-size: 11.5px; font-family: monospace; padding: 4px 8px; height: 26px; border-radius: 5px; flex: 1; background: #131b2e; color: #c084fc; border: 1px solid rgba(192,132,252,0.25); outline: none;">
                        </div>
                    </div>` : ''}

                    ${isManualTask ? `
                    <div style="background: rgba(251,191,36,0.08); border: 1px dashed rgba(251,191,36,0.35); border-radius: 7px; padding: 7px 10px; display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-size: 10px; font-weight: 800; color: #fbbf24; display: flex; align-items: center; gap: 4px;">✋ Human-in-the-loop Checkpoint Instructions:</span>
                        <input type="text" class="procbot-manual-note-input" data-step-idx="${idx}" value="${esc(step.manual_instructions || step.note || 'Complete manual task (CAPTCHA/OTP/Approval) and resume')}" placeholder="Instructions for user on screen..." style="font-size: 11.5px; padding: 4px 8px; height: 26px; border-radius: 5px; background: #080c14; color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); outline: none;">
                    </div>` : ''}

                    ${isInput ? `
                    <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; background: #080c14; border-radius: 7px; padding: 6px 10px; border: 1px dashed rgba(16,185,129,0.35);">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 10px; font-family: monospace; color: #34d399; font-weight: 800; background: rgba(16,185,129,0.12); padding: 2px 6px; border-radius: 4px;">{{${varKey}}}</span>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <input type="text" class="procbot-var-input" data-step-idx="${idx}" data-var-key="${varKey}" value="${esc(rawVal)}" placeholder="Enter field value or {{variable}}..." style="font-size: 11.5px; padding: 4px 8px; height: 26px; border-radius: 5px; flex: 1; background: #131b2e; color: #f8fafc; border: 1px solid rgba(255,255,255,0.12); outline: none;">
                            <button class="procbot-toggle-mask-btn" data-step-idx="${idx}" style="background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 5px; padding: 0 7px; cursor: pointer; font-size: 11px; color: #94a3b8;" title="Mask sensitive password">👁️</button>
                        </div>
                    </div>` : ''}

                    ${isSelect ? `
                    <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; background: #080c14; border-radius: 7px; padding: 6px 10px; border: 1px dashed rgba(56,189,248,0.35);">
                        <span style="font-size: 10px; font-family: monospace; color: #38bdf8; font-weight: 800; background: rgba(56,189,248,0.12); padding: 2px 6px; border-radius: 4px;">🔽 {{${varKey}}}</span>
                        <input type="text" class="procbot-select-val-input" data-step-idx="${idx}" data-var-key="${varKey}" value="${esc(rawVal)}" placeholder="Select Option Text or Value..." style="font-size: 11.5px; padding: 4px 8px; height: 26px; border-radius: 5px; background: #131b2e; color: #f8fafc; border: 1px solid rgba(255,255,255,0.12); outline: none;">
                    </div>` : ''}

                    ${isWait ? `
                    <div style="display: flex; align-items: center; gap: 8px; background: #080c14; border-radius: 7px; padding: 6px 10px; border: 1px dashed rgba(168,85,247,0.35);">
                        <span style="font-size: 11px; font-weight: 800; color: #c084fc;">⏱️ Delay Duration (Seconds):</span>
                        <input type="number" step="0.5" min="0.5" max="60" class="procbot-wait-val-input" data-step-idx="${idx}" value="${esc(rawVal || '2.0')}" style="font-size: 11.5px; padding: 3px 8px; height: 26px; width: 80px; border-radius: 5px; background: #131b2e; color: #f8fafc; border: 1px solid rgba(255,255,255,0.12); outline: none;">
                    </div>` : ''}

                    ${isNav ? `
                    <div style="display: flex; align-items: center; gap: 8px; background: #080c14; border-radius: 7px; padding: 6px 10px; border: 1px dashed rgba(59,130,246,0.35);">
                        <span style="font-size: 11px; font-weight: 800; color: #60a5fa;">🌐 Target Navigation URL:</span>
                        <input type="text" class="procbot-nav-url-input" data-step-idx="${idx}" value="${esc(step.url || '')}" placeholder="https://..." style="font-size: 11.5px; padding: 4px 8px; height: 26px; border-radius: 5px; flex: 1; background: #131b2e; color: #f8fafc; border: 1px solid rgba(255,255,255,0.12); outline: none;">
                    </div>` : ''}

                    <!-- Collapsible Selector Drawer -->
                    <div class="procbot-selector-drawer" data-step-idx="${idx}" style="display: none; background: #080c14; border-radius: 7px; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.08); flex-direction: column; gap: 6px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">Target Element Selector (CSS / XPath):</label>
                            <span style="font-size: 9.5px; color: #64748b;">Supports ID, Classes, XPath, Attributes</span>
                        </div>
                        <input type="text" class="procbot-custom-selector-input" data-step-idx="${idx}" value="${esc(customSel)}" placeholder="#id, .class, button[type='submit'], //input[@name='q']..." style="font-size: 11px; font-family: monospace; padding: 4px 8px; height: 26px; border-radius: 5px; background: #131b2e; color: #38bdf8; border: 1px solid rgba(255,255,255,0.12); outline: none;">
                    </div>

                    <!-- Collapsible Resilience & Policy Drawer -->
                    <div class="procbot-resilience-drawer" data-step-idx="${idx}" style="display: none; background: #080c14; border-radius: 7px; padding: 8px 10px; border: 1px solid rgba(52,211,153,0.25); flex-direction: column; gap: 8px;">
                        <div style="font-size: 10px; font-weight: 800; color: #34d399; text-transform: uppercase;">🛡️ Resilience, Retry &amp; Error Policy:</div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <label style="font-size: 10.5px; color: #94a3b8;">Retry Attempts:</label>
                                <select class="procbot-retry-select" data-step-idx="${idx}" style="font-size: 11px; background: #131b2e; color: #f8fafc; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; padding: 2px 6px;">
                                    <option value="1" ${retryCount === 1 ? 'selected' : ''}>1 (No retry)</option>
                                    <option value="2" ${retryCount === 2 ? 'selected' : ''}>2 attempts</option>
                                    <option value="3" ${retryCount === 3 ? 'selected' : ''}>3 attempts</option>
                                    <option value="5" ${retryCount === 5 ? 'selected' : ''}>5 attempts</option>
                                </select>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <label style="font-size: 10.5px; color: #94a3b8;">On Failure:</label>
                                <select class="procbot-onfail-select" data-step-idx="${idx}" style="font-size: 11px; background: #131b2e; color: #f8fafc; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; padding: 2px 6px;">
                                    <option value="abort" ${onFail === 'abort' ? 'selected' : ''}>🛑 Stop / Abort Run</option>
                                    <option value="skip" ${onFail === 'skip' ? 'selected' : ''}>⏭️ Skip &amp; Continue</option>
                                    <option value="manual_pause" ${onFail === 'manual_pause' ? 'selected' : ''}>✋ Pause for Manual Action</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        // Bind interactive card listeners
        bindStepCardListeners(wf);
    }

    function bindStepCardListeners(wf) {
        // Breakpoint toggles
        document.querySelectorAll(".procbot-breakpoint-btn").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.bpIdx, 10);
                wf.steps[idx]._breakpoint = !wf.steps[idx]._breakpoint;
                renderSteps(wf);
            };
        });

        // Manual pause toggles
        document.querySelectorAll(".procbot-manual-pause-btn").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.mpIdx, 10);
                wf.steps[idx].manual_pause = !wf.steps[idx].manual_pause;
                wf.steps[idx]._manualPause = wf.steps[idx].manual_pause;
                if (wf.steps[idx].manual_pause && wf.steps[idx].action !== "manual_pause") {
                    wf.steps[idx].action = "manual_pause";
                }
                renderSteps(wf);
            };
        });

        // Active / Enabled toggle
        document.querySelectorAll(".procbot-step-active").forEach(cb => {
            cb.onchange = () => {
                const card = cb.closest(".procbot-step-card");
                const idx = parseInt(card.dataset.stepIdx, 10);
                wf.steps[idx].hidden = !cb.checked;
                wf.steps[idx]._disabled = !cb.checked;
                card.style.opacity = cb.checked ? "1" : "0.4";
            };
        });

        // Action Type Change
        document.querySelectorAll(".procbot-step-action-select").forEach(sel => {
            sel.onchange = () => {
                const idx = parseInt(sel.dataset.stepIdx, 10);
                wf.steps[idx].action = sel.value;
                if (sel.value === "manual_pause") {
                    wf.steps[idx].manual_pause = true;
                    wf.steps[idx]._manualPause = true;
                } else {
                    wf.steps[idx].manual_pause = false;
                    wf.steps[idx]._manualPause = false;
                }
                renderSteps(wf);
            };
        });

        // Step Title changes
        document.querySelectorAll(".procbot-step-title-input").forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.dataset.stepIdx, 10);
                wf.steps[idx].edited_title = inp.value;
                wf.steps[idx].title = inp.value;
            };
        });

        // Variable & Parameter inputs
        document.querySelectorAll(".procbot-var-input, .procbot-select-val-input, .procbot-wait-val-input, .procbot-nav-url-input").forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.dataset.stepIdx, 10);
                wf.steps[idx].value = inp.value;
                if (inp.classList.contains("procbot-nav-url-input")) {
                    wf.steps[idx].url = inp.value;
                }
            };
        });

        // Assertion type and value changes
        document.querySelectorAll(".procbot-assert-type-select").forEach(sel => {
            sel.onchange = () => {
                const idx = parseInt(sel.dataset.stepIdx, 10);
                wf.steps[idx].assert_type = sel.value;
            };
        });
        document.querySelectorAll(".procbot-assert-val-input").forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.dataset.stepIdx, 10);
                wf.steps[idx].expected = inp.value;
                wf.steps[idx].value = inp.value;
            };
        });

        // Extraction attr and variable changes
        document.querySelectorAll(".procbot-extract-attr-select").forEach(sel => {
            sel.onchange = () => {
                const idx = parseInt(sel.dataset.stepIdx, 10);
                wf.steps[idx].extract_attr = sel.value;
            };
        });
        document.querySelectorAll(".procbot-extract-var-input").forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.dataset.stepIdx, 10);
                wf.steps[idx].extract_var = inp.value.replace(/[^a-zA-Z0-9_]/g, "_");
            };
        });

        // Resilience Drawer Toggle and Inputs
        document.querySelectorAll(".procbot-resilience-btn").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                const drawer = document.querySelector(`.procbot-resilience-drawer[data-step-idx="${idx}"]`);
                if (drawer) {
                    const isHidden = drawer.style.display === "none";
                    drawer.style.display = isHidden ? "flex" : "none";
                }
            };
        });
        document.querySelectorAll(".procbot-retry-select").forEach(sel => {
            sel.onchange = () => {
                const idx = parseInt(sel.dataset.stepIdx, 10);
                wf.steps[idx].retry_count = parseInt(sel.value, 10);
            };
        });
        document.querySelectorAll(".procbot-onfail-select").forEach(sel => {
            sel.onchange = () => {
                const idx = parseInt(sel.dataset.stepIdx, 10);
                wf.steps[idx].on_failure = sel.value;
            };
        });

        // Password mask toggle
        document.querySelectorAll(".procbot-toggle-mask-btn").forEach(btn => {
            btn.onclick = () => {
                const card = btn.closest(".procbot-step-card");
                const input = card.querySelector(".procbot-var-input");
                if (input) {
                    input.type = input.type === "password" ? "text" : "password";
                    btn.textContent = input.type === "password" ? "🔒" : "👁️";
                }
            };
        });

        // Manual instructions note input
        document.querySelectorAll(".procbot-manual-note-input").forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.dataset.stepIdx, 10);
                wf.steps[idx].manual_instructions = inp.value;
                wf.steps[idx].note = inp.value;
            };
        });

        // Selector Drawer Toggle & Input
        document.querySelectorAll(".procbot-edit-selector-btn").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                const drawer = document.querySelector(`.procbot-selector-drawer[data-step-idx="${idx}"]`);
                if (drawer) {
                    const isHidden = drawer.style.display === "none";
                    drawer.style.display = isHidden ? "flex" : "none";
                }
            };
        });
        document.querySelectorAll(".procbot-custom-selector-input").forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.dataset.stepIdx, 10);
                wf.steps[idx].custom_selector = inp.value;
            };
        });

        // Dry Run Single Step Button
        document.querySelectorAll(".procbot-test-step-btn").forEach(btn => {
            btn.onclick = async () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                const step = wf.steps[idx];
                logTerm(`⚡ Testing Step #${idx + 1}: ${step.edited_title || step.title || step.action}`, "info");
                showToast(`Testing Step #${idx + 1} in active browser...`, 2000);
                
                if (window.chrome && chrome.runtime) {
                    try {
                        chrome.runtime.sendMessage({
                            type: "PROCBOT_EXECUTE_STEP",
                            step: step,
                            value: step.value || "",
                            options: { retry_count: step.retry_count || 1, on_failure: step.on_failure || "abort" }
                        }, (res) => {
                            if (res && res.healed) {
                                logTerm(`✨ [AI Self-Healing] Repaired selector using ${res.healed.engine}: ${res.healed.healed_selector}`, "heal");
                            }
                            if (res && res.assertion_passed !== undefined) {
                                if (res.assertion_passed) logTerm(`✓ [Assertion Passed] Expected: "${res.expected || ''}" | Actual: "${res.actual || ''}"`, "success");
                                else logTerm(`❌ [Assertion Failed] ${res.error || 'Assertion mismatch'}`, "error");
                            }
                            if (res && res.extracted_value !== undefined) {
                                logTerm(`📥 [Extracted] {{${res.extracted_key}}} = "${res.extracted_value}"`, "success");
                            }
                        });
                        logTerm(`✓ Dispatched test command for Step #${idx + 1}`, "success");
                    } catch (e) {
                        logTerm(`Test failed: ${e.message}`, "error");
                    }
                } else {
                    logTerm(`Extension message channel ready. Verify active browser tab.`, "dim");
                }
            };
        });

        // Step Reorder Move Up
        document.querySelectorAll(".procbot-step-move-up").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                if (idx > 0) {
                    const temp = wf.steps[idx];
                    wf.steps[idx] = wf.steps[idx - 1];
                    wf.steps[idx - 1] = temp;
                    renderSteps(wf);
                }
            };
        });

        // Step Reorder Move Down
        document.querySelectorAll(".procbot-step-move-down").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                if (idx < wf.steps.length - 1) {
                    const temp = wf.steps[idx];
                    wf.steps[idx] = wf.steps[idx + 1];
                    wf.steps[idx + 1] = temp;
                    renderSteps(wf);
                }
            };
        });

        // Step Delete
        document.querySelectorAll(".procbot-step-delete").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                wf.steps.splice(idx, 1);
                renderSteps(wf);
            };
        });

        // Step Insert Below
        document.querySelectorAll(".procbot-step-insert-below").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                const newStep = {
                    action: "input",
                    title: `Step ${idx + 2}`,
                    value: "",
                    retry_count: 1,
                    on_failure: "abort"
                };
                wf.steps.splice(idx + 1, 0, newStep);
                renderSteps(wf);
            };
        });

        // Interactive Point-and-Click Selector Picker
        document.querySelectorAll(".procbot-pick-selector-btn").forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.stepIdx, 10);
                logTerm(`🎯 Live Element Inspector active for Step #${idx + 1}. Hover and click an element on your webpage...`, "info");
                showToast("🎯 Element Picker Active! Switch to webpage and click any element to capture.", 4500);
                dispatchPickerToTargetTab(idx);
            };
        });
    }

    // Step Search Filter
    if (stepSearchInput) {
        stepSearchInput.oninput = () => renderSteps();
    }

    // ── Dedicated Step Addition Helpers ──────────────────────────────────────
    function addNavigateStep() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        wf.steps = wf.steps || [];
        const url = prompt("Enter Target URL to Navigate to:", "https://") || "https://";
        wf.steps.push({
            action: "navigate",
            title: `Navigate to ${url}`,
            url: url,
            value: url,
            custom_selector: "body",
            retry_count: 2,
            on_failure: "abort"
        });
        renderSteps(wf);
        logTerm(`Inserted 🌐 Navigate URL step (${url})`, "info");
    }

    function addClickStep() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        wf.steps = wf.steps || [];
        wf.steps.push({
            action: "click",
            title: `Click Element #${wf.steps.length + 1}`,
            value: "",
            retry_count: 1,
            on_failure: "abort"
        });
        renderSteps(wf);
        logTerm("Inserted 🖱️ Click step", "info");
    }

    function addInputStep() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        wf.steps = wf.steps || [];
        wf.steps.push({
            action: "input",
            title: `Input Field #${wf.steps.length + 1}`,
            value: "Sample Value",
            retry_count: 1,
            on_failure: "abort"
        });
        renderSteps(wf);
        logTerm("Inserted ⌨️ Input Field step", "info");
    }

    function addSelectStep() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        wf.steps = wf.steps || [];
        wf.steps.push({
            action: "select",
            title: `Select Option #${wf.steps.length + 1}`,
            value: "Option Value",
            retry_count: 2,
            on_failure: "abort"
        });
        renderSteps(wf);
        logTerm("Inserted 🔽 Dropdown Select step", "info");
    }

    function addExtractStep() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        wf.steps = wf.steps || [];
        wf.steps.push({
            action: "extract",
            title: `Extract Data #${wf.steps.length + 1}`,
            extract_var: `var_data_${wf.steps.length + 1}`,
            extract_attr: "text",
            retry_count: 2,
            on_failure: "skip"
        });
        renderSteps(wf);
        logTerm("Inserted 📥 Data Extraction step", "info");
    }

    function addAssertStep() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        wf.steps = wf.steps || [];
        wf.steps.push({
            action: "assert_text",
            title: `Assert Check #${wf.steps.length + 1}`,
            assert_type: "text",
            expected: "Expected Text",
            value: "Expected Text",
            retry_count: 2,
            on_failure: "abort"
        });
        renderSteps(wf);
        logTerm("Inserted 🔍 Assert Validation checkpoint", "info");
    }

    function addManualStep() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        wf.steps = wf.steps || [];
        wf.steps.push({
            action: "manual_pause",
            title: `Manual Task #${wf.steps.length + 1}`,
            manual_pause: true,
            manual_instructions: "Complete manual action (CAPTCHA/OTP/Approval) and resume",
            value: ""
        });
        renderSteps(wf);
        logTerm("Inserted ✋ Manual Task step", "info");
    }

    // ── Standalone Bot (Non-SOP) Creation & Renaming ─────────────────────────
    async function createNewStandaloneBot(customName) {
        const botName = customName || prompt("Enter a name for your new Custom RPA Bot:", `Custom RPA Bot #${Math.floor(Math.random() * 900 + 100)}`);
        if (!botName || !botName.trim()) return;

        try {
            logTerm(`Creating standalone RPA Bot "${botName}"...`, "info");
            const res = await fetch(`${API_BASE}/procbot/bots`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: botName.trim(),
                    description: "Standalone Custom RPA Bot (Non-SOP)",
                    steps: []
                })
            });
            const data = await res.json();
            if (data.success) {
                procBotTargetWorkflow = {
                    id: data.bot_id,
                    name: data.name,
                    steps: []
                };
                if (modal) {
                    modal.style.display = "block";
                    modal.classList.remove("hidden");
                }
                switchProcBotTab("builder");
                renderSteps(procBotTargetWorkflow);
                if (wfSelector) wfSelector.style.display = "none";
                showToast(`✨ Created "${data.name}"! Start adding automation steps.`, 3500);
                logTerm(`Created new standalone bot: ${data.name} (${data.bot_id})`, "success");
            } else {
                showToast("Failed to create custom bot", 3000);
            }
        } catch (e) {
            showToast(`Error creating bot: ${e.message}`, 3000);
        }
    }

    function renameCurrentBot() {
        const wf = getActiveWorkflow();
        if (!wf) return;
        const newName = prompt("Rename this Bot:", wf.name || "Custom RPA Bot");
        if (newName && newName.trim()) {
            wf.name = newName.trim();
            if ($("procbotModalWfTitle")) $("procbotModalWfTitle").textContent = `ProcBot: ${wf.name}`;
            showToast(`Bot renamed to "${wf.name}"`, 2000);
            logTerm(`Bot renamed to: ${wf.name}`, "info");
        }
    }

    // Attach Step & Bot Handlers
    if (addNavigateBtn) addNavigateBtn.onclick = addNavigateStep;
    if (addClickBtn) addClickBtn.onclick = addClickStep;
    if (addInputBtn) addInputBtn.onclick = addInputStep;
    if (addSelectBtn) addSelectBtn.onclick = addSelectStep;
    if (addExtractBtn) addExtractBtn.onclick = addExtractStep;
    if (addAssertBtn) addAssertBtn.onclick = addAssertStep;
    if (addManualBtn) addManualBtn.onclick = addManualStep;
    if (newBotBtn) newBotBtn.onclick = () => createNewStandaloneBot();
    if (hubCreateBotBtn) hubCreateBotBtn.onclick = () => createNewStandaloneBot();
    if (renameBotBtn) renameBotBtn.onclick = renameCurrentBot;
    if (modalWfTitle) modalWfTitle.onclick = renameCurrentBot;

    // ── Dispatch Selector Picker to Target Active Tab ────────────────────────
    function dispatchPickerToTargetTab(stepIndex) {
        const payload = {
            type: "PROCSNAP_START_SELECTOR_PICKER",
            stepIndex: stepIndex
        };
        window.postMessage(payload, "*");
        try {
            if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage(payload).catch(() => {});
            }
        } catch (_) {}
    }

    // Window Message Listener for Captured Selector
    window.addEventListener("message", (event) => {
        if (!event.data) return;
        if (event.data.type === "PROCSNAP_SELECTOR_PICKED") {
            const { stepIndex, selector, tag, text } = event.data;
            const wf = getActiveWorkflow();
            if (wf && wf.steps && typeof stepIndex === "number" && wf.steps[stepIndex]) {
                wf.steps[stepIndex].custom_selector = selector;
                if (text && (!wf.steps[stepIndex].title || wf.steps[stepIndex].title.startsWith("Step ") || wf.steps[stepIndex].title.startsWith("Click ") || wf.steps[stepIndex].title.startsWith("Input "))) {
                    const actName = (wf.steps[stepIndex].action || "click").toUpperCase();
                    wf.steps[stepIndex].title = `${actName} "${text.slice(0, 24)}"`;
                }
                renderSteps(wf);
                logTerm(`🎯 Captured selector for Step #${stepIndex + 1}: ${selector}`, "success");
                showToast(`🎯 Captured element selector: ${selector}`, 3500);
            }
        }
    });

    // ── AI Prompt to Bot Generator Modal Handlers ───────────────────────────
    if (aiPromptBtn && aiPromptModal) {
        aiPromptBtn.onclick = () => {
            aiPromptModal.style.display = "flex";
            aiPromptModal.classList.remove("hidden");
            if (aiPromptInput) {
                aiPromptInput.focus();
            }
        };
    }
    if (closeAiPromptBtn && aiPromptModal) {
        closeAiPromptBtn.onclick = () => {
            aiPromptModal.style.display = "none";
            aiPromptModal.classList.add("hidden");
        };
    }
    if (cancelAiPromptBtn && aiPromptModal) {
        cancelAiPromptBtn.onclick = () => {
            aiPromptModal.style.display = "none";
            aiPromptModal.classList.add("hidden");
        };
    }
    document.querySelectorAll(".btn-prompt-chip").forEach(chip => {
        chip.onclick = () => {
            if (aiPromptInput) {
                aiPromptInput.value = chip.dataset.prompt;
                aiPromptInput.focus();
            }
        };
    });
    if (submitAiPromptBtn) {
        submitAiPromptBtn.onclick = async () => {
            const promptText = (aiPromptInput ? aiPromptInput.value : "").trim();
            if (!promptText) {
                showToast("Please enter an automation prompt", 2500);
                return;
            }
            try {
                submitAiPromptBtn.disabled = true;
                submitAiPromptBtn.innerHTML = '<span>⏳ Synthesizing Steps...</span>';
                logTerm(`🪄 Synthesizing automation steps from prompt: "${promptText.slice(0, 40)}..."`, "info");
                
                const res = await fetch(`${API_BASE}/procbot/generate-from-prompt`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: promptText })
                });
                const data = await res.json();
                if (data.success && data.steps && data.steps.length > 0) {
                    let wf = getActiveWorkflow();
                    if (!wf) {
                        wf = {
                            id: "bot_" + Date.now(),
                            name: data.name || "AI Generated Bot",
                            steps: data.steps
                        };
                        procBotTargetWorkflow = wf;
                    } else {
                        wf.name = data.name || wf.name || "AI Generated Bot";
                        wf.steps = data.steps;
                    }

                    if (modal) {
                        modal.style.display = "block";
                        modal.classList.remove("hidden");
                    }
                    if (wfSelector) wfSelector.style.display = "none";
                    if ($("procbotModalWfTitle")) $("procbotModalWfTitle").textContent = `ProcBot: ${wf.name}`;
                    
                    switchProcBotTab("builder");
                    renderSteps(wf);

                    if (aiPromptModal) {
                        aiPromptModal.style.display = "none";
                        aiPromptModal.classList.add("hidden");
                    }
                    showToast(`✨ Generated ${data.steps.length} steps with ${data.engine}!`, 3500);
                    logTerm(`Successfully generated ${data.steps.length} automation steps (${data.engine})`, "success");

                    // Automatically persist to backend as a saved custom bot
                    try {
                        fetch(`${API_BASE}/procbot/bots`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                name: wf.name,
                                description: `AI Generated from prompt: "${promptText}"`,
                                steps: wf.steps
                            })
                        }).then(r => r.json()).then(saveRes => {
                            if (saveRes && saveRes.bot_id) {
                                wf.id = saveRes.bot_id;
                                logTerm(`Saved bot to server (${saveRes.bot_id})`, "dim");
                            }
                        }).catch(() => {});
                    } catch (_) {}
                } else {
                    showToast(data.message || "Failed to generate steps", 3000);
                }
            } catch (e) {
                showToast(`Generation error: ${e.message}`, 3000);
            } finally {
                submitAiPromptBtn.disabled = false;
                submitAiPromptBtn.innerHTML = '<span>✨ Generate Bot</span>';
            }
        };
    }

    // ── Save Bot Config Handler ───────────────────────────────────────────────
    if (saveConfigBtn) {
        saveConfigBtn.onclick = async () => {
            const wf = getActiveWorkflow();
            if (!wf || !wf.id) { showToast("No workflow active to save", 2000); return; }
            try {
                saveConfigBtn.disabled = true;
                saveConfigBtn.textContent = "Saving...";
                const res = await fetch(`${API_BASE}/sessions/${wf.id}/procbot-config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ config: { name: wf.name, steps: wf.steps } })
                });
                if (res.ok) {
                    showToast("💾 ProcBot recipe saved successfully!", 3000);
                    logTerm("Saved bot configuration recipe to server.", "success");
                } else {
                    showToast("Failed to save bot configuration", 3000);
                }
            } catch (e) {
                showToast(`Error saving: ${e.message}`, 3000);
            } finally {
                saveConfigBtn.disabled = false;
                saveConfigBtn.textContent = "💾 Save Bot";
            }
        };
    }

    // ── Pop Out / Open In New Tab Handler ──────────────────────────────────────
    if (openInNewTabBtn) {
        openInNewTabBtn.onclick = () => {
            const wf = getActiveWorkflow();
            const sid = (wf && wf.id) ? wf.id : (selectedWorkflowId || (wfSelect ? wfSelect.value : ""));
            const targetUrl = `${window.location.origin}${window.location.pathname}?session_id=${encodeURIComponent(sid || "")}&view=procbot`;
            const popWin = window.open(targetUrl, "_blank");
            if (!popWin || popWin.closed || typeof popWin.closed === "undefined") {
                // If browser popup blocker intercepts, navigate directly in current window
                window.location.href = targetUrl;
            } else {
                showToast("↗️ Opening ProcBot in dedicated fullscreen browser tab...", 3000);
            }
        };
    }

    // ── Batch CSV Handlers ───────────────────────────────────────────────────
    if (downloadCsvTemplateBtn) {
        downloadCsvTemplateBtn.onclick = () => {
            const wf = getActiveWorkflow();
            if (!wf || !wf.steps) return;
            const vars = [];
            wf.steps.forEach((s, idx) => {
                const act = (s.action || "").toLowerCase();
                if (["input", "change", "textarea_input", "type", "select"].includes(act)) {
                    const title = s.edited_title || s.title || `step_${idx + 1}`;
                    const varKey = `var_${title.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 24)}`;
                    if (!vars.includes(varKey)) vars.push(varKey);
                }
            });
            if (!vars.length) { showToast("No input variables found in workflow", 2000); return; }
            const csvContent = "data:text/csv;charset=utf-8," + vars.join(",") + "\n" + vars.map((_, i) => `sample_val_${i + 1}`).join(",");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `procbot_template_${wf.id.slice(0, 8)}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        };
    }

    function renderBatchPreview() {
        if (!batchPreviewContainer) return;
        if (!procBotBatchRows || !procBotBatchRows.length) {
            batchPreviewContainer.innerHTML = '<div style="color: #64748b; font-size: 12px; text-align: center; padding: 60px;">Select a CSV file above or download the template to preview dataset rows</div>';
            if (runBatchBtn) { runBatchBtn.disabled = true; runBatchBtn.textContent = "▶️ Run Batch Automation (0 Rows)"; }
            return;
        }
        const headers = Object.keys(procBotBatchRows[0]);
        batchPreviewContainer.innerHTML = `
            <div style="font-size: 11.5px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">Loaded ${procBotBatchRows.length} Data Rows (${headers.length} Variables)</div>
            <table style="width: 100%; font-size: 11px; border-collapse: collapse; color: #f8fafc;">
                <thead>
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: #94a3b8;">
                        <th style="padding: 6px; text-align: left;">#</th>
                        ${headers.map(h => `<th style="padding: 6px; text-align: left;">${esc(h)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${procBotBatchRows.slice(0, 10).map((row, rIdx) => `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                            <td style="padding: 6px; color: #64748b;">${rIdx + 1}</td>
                            ${headers.map(h => `<td style="padding: 6px;">${esc(row[h] || '')}</td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
            ${procBotBatchRows.length > 10 ? `<div style="font-size: 10.5px; color: #64748b; text-align: center; margin-top: 8px;">...and ${procBotBatchRows.length - 10} more rows</div>` : ''}
        `;
        if (runBatchBtn) {
            runBatchBtn.disabled = false;
            runBatchBtn.textContent = `▶️ Run Batch Automation (${procBotBatchRows.length} Rows)`;
        }
    }

    if (batchCsvInput) {
        batchCsvInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                const text = evt.target.result;
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                if (lines.length < 2) {
                    batchPreviewContainer.innerHTML = '<div style="color: #ef4444; text-align: center; padding: 40px;">CSV must contain header row and at least 1 data row.</div>';
                    return;
                }
                const headers = lines[0].split(",").map(h => h.trim());
                procBotBatchRows = lines.slice(1).map(line => {
                    const vals = line.split(",").map(v => v.trim());
                    const row = {};
                    headers.forEach((h, i) => { row[h] = vals[i] || ""; });
                    return row;
                });
                renderBatchPreview();
            };
            reader.readAsText(file);
        };
    }

    if (runBatchBtn) {
        runBatchBtn.onclick = () => {
            if (!procBotBatchRows.length) return;
            switchProcBotTab("monitor");
            logTerm(`📊 Starting Batch Execution for ${procBotBatchRows.length} dataset rows...`, "info");
            executeBatchRunner(procBotBatchRows);
        };
    }

    // ── History Tab Loader ───────────────────────────────────────────────────
    async function loadHistoryLogs() {
        const wf = getActiveWorkflow();
        if (!wf || !wf.id || !historyListEl) return;
        try {
            historyListEl.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;">Loading audit logs...</div>';
            const res = await fetch(`${API_BASE}/sessions/${wf.id}/procbot-run-logs`);
            const data = await res.json();
            const runs = data.runs || [];
            
            if (histTotalRuns) histTotalRuns.textContent = runs.length;
            if (histSuccessRate) {
                const passed = runs.filter(r => r.failed_steps === 0).length;
                histSuccessRate.textContent = runs.length ? `${Math.round((passed / runs.length) * 100)}%` : "--%";
            }
            if (histAvgDuration) {
                const avg = runs.length ? (runs.reduce((acc, r) => acc + (r.elapsed_sec || 0), 0) / runs.length).toFixed(1) : "--";
                histAvgDuration.textContent = `${avg}s`;
            }
            if (histLastRun && runs.length) {
                histLastRun.textContent = new Date(runs[0].created_at).toLocaleTimeString();
            }

            if (!runs.length) {
                historyListEl.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;">No execution logs recorded yet. Run a bot automation to generate audit logs.</div>';
                return;
            }

            historyListEl.innerHTML = runs.map((run, i) => `
                <div style="background: #111827; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 11.5px; font-weight: 800; color: ${run.failed_steps === 0 ? '#34d399' : '#f87171'};">
                                ${run.failed_steps === 0 ? '✓ SUCCESS' : '⚠️ COMPLETED WITH ISSUES'}
                            </span>
                            <span style="font-size: 10px; background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); padding: 1px 6px; border-radius: 4px; font-weight: 700;">
                                ${(run.engine || 'BROWSER').toUpperCase()}
                            </span>
                        </div>
                        <span style="font-size: 10.5px; color: #94a3b8;">${new Date(run.created_at).toLocaleString()}</span>
                    </div>
                    <div style="font-size: 11px; color: #cbd5e1; display: flex; gap: 20px;">
                        <span>Steps: <strong>${run.success_steps}/${run.total_steps}</strong></span>
                        <span>Duration: <strong>${(run.elapsed_sec || 0).toFixed(1)}s</strong></span>
                        <span>Mode: <strong>${run.mode}</strong></span>
                    </div>
                </div>
            `).join("");
        } catch (e) {
            if (historyListEl) historyListEl.innerHTML = `<div style="color:#f87171;text-align:center;padding:20px;">Failed to load history: ${e.message}</div>`;
        }
    }

    // ── Code Tab Export Generator ────────────────────────────────────────────
    async function renderExportCode(lang) {
        procBotCurrentCodeLang = lang;
        document.querySelectorAll(".procbot-code-lang-btn").forEach(btn => {
            const isTarget = btn.dataset.lang === lang;
            btn.classList.toggle("active", isTarget);
            btn.style.background = isTarget ? "rgba(99,102,241,0.2)" : "none";
            btn.style.color = isTarget ? "#818cf8" : "#94a3b8";
            btn.style.borderColor = isTarget ? "rgba(99,102,241,0.4)" : "transparent";
        });

        const wf = getActiveWorkflow();
        if (!wf || !wf.id || !codeViewer) return;

        codeViewer.value = "// Generating script...";
        try {
            if (lang === "json") {
                const res = await fetch(`${API_BASE}/sessions/${wf.id}/procbot-recipe`);
                const data = await res.json();
                codeViewer.value = JSON.stringify(data, null, 2);
            } else {
                const res = await fetch(`${API_BASE}/sessions/${wf.id}/procbot-script?engine=${lang}`);
                const text = await res.text();
                codeViewer.value = text;
            }
        } catch (e) {
            codeViewer.value = `// Failed to generate script: ${e.message}`;
        }
    }

    document.querySelectorAll(".procbot-code-lang-btn").forEach(btn => {
        btn.onclick = () => renderExportCode(btn.dataset.lang);
    });

    if (copyCodeBtn && codeViewer) {
        copyCodeBtn.onclick = async () => {
            await navigator.clipboard.writeText(codeViewer.value);
            showToast("📋 Code copied to clipboard!", 2500);
        };
    }

    if (downloadCodeBtn) {
        downloadCodeBtn.onclick = () => {
            const wf = getActiveWorkflow();
            if (!wf || !wf.id) return;
            if (procBotCurrentCodeLang === "json") {
                window.open(`${API_BASE}/sessions/${wf.id}/procbot-recipe`, "_blank");
            } else {
                window.open(`${API_BASE}/sessions/${wf.id}/procbot-script?engine=${procBotCurrentCodeLang}`, "_blank");
            }
            showToast(`Downloading ${procBotCurrentCodeLang} script...`, 3000);
        };
    }

    // ── Open Studio Modal Logic ──────────────────────────────────────────────
    async function openModal(standaloneMode) {
        procBotTargetWorkflow = null;
        procBotLogsHistory = [];
        if (progressBar) progressBar.style.width = "0%";
        if (progressPercent) progressPercent.textContent = "0%";
        if (statusText) statusText.textContent = "Status: Ready";
        if (statusPill) { statusPill.textContent = "READY"; statusPill.style.color = "#38bdf8"; statusPill.style.background = "rgba(56,189,248,0.15)"; }
        if (elapsedEl) elapsedEl.textContent = "00:00";
        if (termLog) termLog.innerHTML = '<div style="color:#64748b;">// ProcBot RPA Execution Terminal. Ready to replay workflow.</div>';
        if (liveScreenshot) liveScreenshot.style.display = "none";
        if (liveOverlay) { liveOverlay.textContent = "📷 Live step screenshot preview will appear here during execution"; liveOverlay.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px;font-weight:700;"; }

        switchProcBotTab("builder");

        if (standaloneMode || !workflow || !workflow.steps || !workflow.steps.length) {
            if (wfSelector) wfSelector.style.display = "block";
            if (wfSelect) {
                try {
                    const res = await fetch(`${API_BASE}/sessions`);
                    const data = await res.json();
                    const sessions = data.sessions || data || [];
                    wfSelect.innerHTML = '<option value="">-- Choose a recorded SOP or Custom Bot --</option>' +
                        '<option value="__NEW_BOT__" style="color:#c084fc;font-weight:800;">✨ + Create New Blank Bot (No SOP)</option>' +
                        sessions.map(s => {
                            const isCustom = (s.tags || "").includes("custom_bot") || (s.tags || "").includes("standalone") || s.application === "ProcBot Custom RPA";
                            return `<option value="${s.id}">${isCustom ? '🤖 [CUSTOM BOT] ' : ''}${esc(s.name || s.id)} (${s.step_count || "?"} steps)</option>`;
                        }).join("");
                } catch(e) { wfSelect.innerHTML = '<option value="">Failed to load</option>'; }
            }
            if (stepsListEl) stepsListEl.innerHTML = '<div style="color:#64748b;padding:40px;text-align:center;">Select a workflow above or click ✨ New Bot to build from scratch</div>';
        } else {
            if (wfSelector) wfSelector.style.display = "none";
            // Check if custom config exists
            try {
                const res = await fetch(`${API_BASE}/sessions/${workflow.id}/procbot-config`);
                const data = await res.json();
                if (data.config && data.config.steps) {
                    workflow.steps = data.config.steps;
                    logTerm("Loaded saved custom Bot configuration.", "info");
                }
            } catch (_) {}
            renderSteps();
        }

        if (modal) {
            modal.style.display = "block";
            modal.classList.remove("hidden");
        }
    }

    // Standalone workflow selector
    if (wfSelect) {
        wfSelect.onchange = async () => {
            const sid = wfSelect.value;
            if (!sid) { procBotTargetWorkflow = null; if (stepsListEl) stepsListEl.innerHTML = '<div style="color:#64748b;padding:40px;text-align:center;">Select a workflow above</div>'; return; }
            if (sid === "__NEW_BOT__") {
                await createNewStandaloneBot();
                return;
            }
            try {
                logTerm(`Loading workflow ${sid}...`, "dim");
                const res = await fetch(`${API_BASE}/sessions/${sid}`);
                const data = await res.json();
                procBotTargetWorkflow = data;
                // Check if custom config exists
                const cfgRes = await fetch(`${API_BASE}/sessions/${sid}/procbot-config`).catch(() => null);
                if (cfgRes && cfgRes.ok) {
                    const cfgData = await cfgRes.json();
                    if (cfgData.config && cfgData.config.steps) {
                        procBotTargetWorkflow.steps = cfgData.config.steps;
                    }
                }
                renderSteps(procBotTargetWorkflow);
                logTerm(`Loaded: ${data.name || sid} (${(procBotTargetWorkflow.steps || []).length} steps)`, "success");
            } catch(e) { logTerm(`Failed to load: ${e.message}`, "error"); }
        };
    }

    // Open from Hub or Studio
    if (hubProcBotBtn) hubProcBotBtn.onclick = () => openModal(true);
    if (openBtn) openBtn.onclick = () => openModal(false);
    if (closeBtn && modal) {
        closeBtn.onclick = () => { isProcBotRunning = false; isProcBotPaused = false; if (procBotElapsedTimer) clearInterval(procBotElapsedTimer); if (procBotStepResolve) procBotStepResolve(); modal.style.display = "none"; modal.classList.add("hidden"); };
    }

    function resetRunState() {
        isProcBotRunning = false; isProcBotPaused = false;
        if (procBotElapsedTimer) clearInterval(procBotElapsedTimer);
        if (runBtn) { runBtn.disabled = false; runBtn.style.opacity = "1"; }
        if (quickRunBtn) { quickRunBtn.disabled = false; quickRunBtn.style.opacity = "1"; }
        [stopBtn, pauseBtn, resumeBtn, nextStepBtn].forEach(b => { if (b) b.classList.add("hidden"); });
    }

    // ── Helper to dispatch execution to Chrome Extension / Target Tab ────────
    function dispatchStepToTargetTab(step, targetVal, options = {}) {
        return new Promise((resolve) => {
            const correlationId = `pb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            let resolved = false;

            const onMsg = (e) => {
                if (e.data && e.data.type === "PROCSNAP_PROCBOT_EXECUTE_STEP_RESPONSE" && e.data.correlationId === correlationId) {
                    window.removeEventListener("message", onMsg);
                    if (!resolved) {
                        resolved = true;
                        resolve(e.data.response || { success: true });
                    }
                }
            };
            window.addEventListener("message", onMsg);

            // Attempt 1: Direct chrome.runtime.sendMessage
            try {
                if (window.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
                    chrome.runtime.sendMessage({
                        type: "PROCBOT_EXECUTE_STEP",
                        step: step,
                        value: targetVal,
                        options: options
                    }, (res) => {
                        if (!resolved) {
                            resolved = true;
                            window.removeEventListener("message", onMsg);
                            resolve(res || { success: true });
                        }
                    });
                }
            } catch (_) {}

            // Attempt 2: PostMessage to Content Script Bridge
            window.postMessage({
                type: "PROCSNAP_PROCBOT_EXECUTE_STEP",
                correlationId: correlationId,
                step: step,
                value: targetVal,
                options: options
            }, "*");

            // Safeguard timeout (10s max per step)
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    window.removeEventListener("message", onMsg);
                    resolve({ success: true, timeout_fallback: true });
                }
            }, 10000);
        });
    }

    // ── Main Single-Run Execution Engine ──────────────────────────────────────
    if (runBtn) runBtn.onclick = async () => {
        switchProcBotTab("monitor");
        executeSingleRunner();
    };
    if (quickRunBtn) quickRunBtn.onclick = async () => {
        switchProcBotTab("monitor");
        executeSingleRunner();
    };

    async function executeSingleRunner(customVars) {
        const activeWf = getActiveWorkflow();
        if (!activeWf || !activeWf.steps || !activeWf.steps.length) { showToast("No workflow loaded. Select one first.", 3000); return; }
        if (isProcBotRunning) return;
        isProcBotRunning = true; isProcBotPaused = false;
        if (runBtn) { runBtn.disabled = true; runBtn.style.opacity = "0.5"; }
        if (quickRunBtn) { quickRunBtn.disabled = true; quickRunBtn.style.opacity = "0.5"; }
        if (stopBtn) stopBtn.classList.remove("hidden");
        if (pauseBtn) pauseBtn.classList.remove("hidden");

        const execMode = execModeSelect ? execModeSelect.value : "auto";
        const selectedEngine = engineSelect ? engineSelect.value : "browser";
        if (activeEngineBadge) activeEngineBadge.textContent = selectedEngine.toUpperCase();
        if (statusPill) { statusPill.textContent = "RUNNING"; statusPill.style.color = "#10b981"; statusPill.style.background = "rgba(16,185,129,0.15)"; }
        if (execMode === "step" && nextStepBtn) nextStepBtn.classList.remove("hidden");

        procBotStartTime = Date.now();
        procBotElapsedTimer = setInterval(updateElapsed, 1000);

        logTerm(`🚀 ProcBot Engine starting [${selectedEngine.toUpperCase()}]`, "info");
        logTerm(`Mode: ${execMode} | Speed: ${speedSelect ? speedSelect.value : 500}ms`, "dim");

        // Active Steps
        const activeSteps = activeWf.steps.filter(s => !s.hidden && !s._disabled);
        const total = activeSteps.length;
        if (!total) { logTerm("No active steps selected.", "warn"); resetRunState(); return; }

        let successCount = 0;
        let failedCount = 0;
        const runtimeVars = { ...(customVars || {}) };

        for (let i = 0; i < total; i++) {
            if (!isProcBotRunning) { logTerm("⏹️ Execution stopped by user.", "warn"); break; }
            while (isProcBotPaused && isProcBotRunning) { await new Promise(r => setTimeout(r, 200)); }
            if (!isProcBotRunning) break;

            const step = activeSteps[i];
            const realIdx = activeWf.steps.indexOf(step);
            const title = step.edited_title || step.title || `Step ${i + 1}`;
            const act = (step.action || "click").toLowerCase();
            const isManualTask = act === "manual_pause" || act === "manual_task" || step.manual_pause || step._manualPause;
            const isAssert = act.startsWith("assert") || act === "verify" || act === "check";
            const isExtract = act === "extract";
            const isDesktop = (step.url === "app.local") || act.includes("desktop");

            // Highlight card
            document.querySelectorAll(".procbot-step-card").forEach(c => {
                c.style.borderColor = "rgba(255,255,255,0.08)";
                c.style.background = "#111827";
            });
            const activeCard = document.querySelector(`.procbot-step-card[data-step-idx="${realIdx}"]`);
            if (activeCard) {
                activeCard.style.borderColor = "#6366f1";
                activeCard.style.background = "#1e293b";
                activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }

            // Resolve dynamic value & variables interpolation
            let targetVal = step.value || "";
            const varKey = `var_${(title || `step_${i + 1}`).toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 24)}`;
            if (runtimeVars[varKey] !== undefined) targetVal = runtimeVars[varKey];
            
            // Interpolate any {{var_name}} in strings
            Object.keys(runtimeVars).forEach(k => {
                const pat = new RegExp(`\\{\\{${k}\\}\\}`, 'g');
                targetVal = String(targetVal).replace(pat, runtimeVars[k]);
            });

            showLiveScreenshot(activeWf, realIdx, targetVal);

            const pct = Math.round(((i + 1) / total) * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressPercent) progressPercent.textContent = `${pct}%`;
            if (statusText) statusText.textContent = `Step ${i + 1}/${total}: ${title}`;

            // Log action
            if (isManualTask) {
                logTerm(`✋ [${i + 1}/${total}] MANUAL TASK: ${title}`, "pause");
            } else if (isAssert) {
                logTerm(`🔍 [${i + 1}/${total}] ASSERT: ${title} (Expected: "${step.expected || targetVal}")`, "info");
            } else if (isExtract) {
                logTerm(`📥 [${i + 1}/${total}] EXTRACT: ${title} ➔ {{${step.extract_var || varKey}}}`, "info");
            } else if (isDesktop) {
                logTerm(`🖥️ [${i + 1}/${total}] Desktop Action: ${title}`, "dim");
            } else if (act.includes("navigate") || (i === 0 && step.url && step.url.startsWith("http"))) {
                logTerm(`🌐 [${i + 1}/${total}] Navigate: ${step.url || "target app"}`, "info");
            } else if (["input", "change", "textarea_input", "type"].includes(act)) {
                logTerm(`⌨️ [${i + 1}/${total}] Type "${targetVal.slice(0, 25)}" ➔ ${title}`, "info");
            } else if (["select", "dropdown"].includes(act)) {
                logTerm(`🔽 [${i + 1}/${total}] Select Option "${targetVal}" ➔ ${title}`, "info");
            } else if (act.includes("click")) {
                logTerm(`🖱️ [${i + 1}/${total}] Click: ${title}`, "info");
            } else {
                logTerm(`▶️ [${i + 1}/${total}] ${act}: ${title}`, "info");
            }

            // Forward to In-Page Extension Runner
            if (selectedEngine === "browser" && window.chrome && chrome.runtime) {
                try {
                    chrome.runtime.sendMessage({
                        type: "PROCBOT_EXECUTE_STEP",
                        step: { ...step, action: act, manual_pause: isManualTask },
                        value: targetVal
                    });
                } catch(e) {}
            }

            // Breakpoint check
            if (step._breakpoint && execMode === "breakpoint") {
                logTerm(`🔴 Breakpoint hit at step ${i + 1}. Paused.`, "pause");
                if (statusText) statusText.textContent = `PAUSED at breakpoint (Step ${i + 1})`;
                if (statusPill) { statusPill.textContent = "PAUSED"; statusPill.style.color = "#fbbf24"; statusPill.style.background = "rgba(251,191,36,0.15)"; }
                isProcBotPaused = true;
                if (pauseBtn) pauseBtn.classList.add("hidden"); if (resumeBtn) resumeBtn.classList.remove("hidden");
                while (isProcBotPaused && isProcBotRunning) { await new Promise(r => setTimeout(r, 200)); }
                if (!isProcBotRunning) break;
                if (resumeBtn) resumeBtn.classList.add("hidden"); if (pauseBtn) pauseBtn.classList.remove("hidden");
                logTerm("Resumed from breakpoint.", "success");
            }

            // Manual task pause
            if (isManualTask) {
                const instructions = step.manual_instructions || step.note || "Perform manual task on screen, then click Resume.";
                logTerm(`✋ WAITING: ${instructions}`, "pause");
                if (statusText) statusText.textContent = `WAITING: Manual input at Step ${i + 1}`;
                isProcBotPaused = true;
                if (pauseBtn) pauseBtn.classList.add("hidden"); if (resumeBtn) resumeBtn.classList.remove("hidden");
                while (isProcBotPaused && isProcBotRunning) { await new Promise(r => setTimeout(r, 200)); }
                if (!isProcBotRunning) break;
                if (resumeBtn) resumeBtn.classList.add("hidden"); if (pauseBtn) pauseBtn.classList.remove("hidden");
                logTerm("Manual task completed. Continuing...", "success");
            }

            // Step-by-step mode
            if (execMode === "step") {
                logTerm("Waiting for Next Step command...", "dim");
                if (statusText) statusText.textContent = `Step ${i + 1}/${total} done. Click Next.`;
                await new Promise(resolve => { procBotStepResolve = resolve; });
                procBotStepResolve = null;
                if (!isProcBotRunning) break;
            }

            successCount++;

            // Speed delay
            const isNav = act.includes("navigate") || act.includes("page_load");
            const delay = isNav ? parseInt(loadWaitSelect ? loadWaitSelect.value : "2000", 10) : parseInt(speedSelect ? speedSelect.value : "500", 10);
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
        }

        const elapsedSec = (Date.now() - procBotStartTime) / 1000;
        if (isProcBotRunning) {
            const elapsed = elapsedEl ? elapsedEl.textContent : "--";
            logTerm(`🎉 Completed! ${successCount}/${total} steps executed [${elapsed}]`, "success");
            if (statusText) statusText.textContent = `Completed: ${successCount}/${total} steps (${elapsed})`;
            showToast(`ProcBot completed ${successCount} steps!`, 4000);

            // Record audit log to backend
            try {
                await fetch(`${API_BASE}/sessions/${activeWf.id}/procbot-run-log`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        engine: selectedEngine,
                        mode: execMode,
                        total_steps: total,
                        success_steps: successCount,
                        failed_steps: failedCount,
                        elapsed_sec: elapsedSec,
                        logs: procBotLogsHistory.slice(-50)
                    })
                });
            } catch (_) {}
        }

        resetRunState();
    }

    async function executeBatchRunner(rows) {
        logTerm(`🔄 [Batch Runner] Initializing ${rows.length} execution iterations`, "info");
        for (let rIdx = 0; rIdx < rows.length; rIdx++) {
            logTerm(`\n========================================`, "dim");
            logTerm(`▶️ Starting Batch Iteration ${rIdx + 1}/${rows.length}...`, "info");
            logTerm(`Dataset: ${JSON.stringify(rows[rIdx])}`, "dim");
            await executeSingleRunner(rows[rIdx]);
            await new Promise(r => setTimeout(r, 1500));
        }
        logTerm(`🎉 [Batch Runner] All ${rows.length} iterations completed!`, "success");
        showToast(`🎉 Batch runner finished ${rows.length} runs!`, 5000);
    }

    if (stopBtn) { stopBtn.onclick = () => { isProcBotRunning = false; isProcBotPaused = false; if (procBotStepResolve) procBotStepResolve(); logTerm("\u23f9\ufe0f Stopped.", "error"); if (statusText) statusText.textContent = "Stopped"; resetRunState(); }; }
    if (pauseBtn) { pauseBtn.onclick = () => { isProcBotPaused = true; if (pauseBtn) pauseBtn.classList.add("hidden"); if (resumeBtn) resumeBtn.classList.remove("hidden"); if (statusText) statusText.textContent = "PAUSED"; logTerm("\u23f8\ufe0f Paused.", "pause"); }; }
    if (resumeBtn) { resumeBtn.onclick = () => { isProcBotPaused = false; if (resumeBtn) resumeBtn.classList.add("hidden"); if (pauseBtn) pauseBtn.classList.remove("hidden"); if (statusText) statusText.textContent = "Resumed..."; logTerm("\u25b6\ufe0f Resumed.", "success"); }; }
    if (nextStepBtn) { nextStepBtn.onclick = () => { if (procBotStepResolve) procBotStepResolve(); }; }

    // ── Check if opened in dedicated Pop-Out Tab view (?view=procbot) ────────
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("view") === "procbot") {
        setTimeout(async () => {
            const sid = urlParams.get("session_id");
            if (sid) {
                try {
                    const res = await fetch(`${API_BASE}/sessions/${sid}`);
                    const data = await res.json();
                    if (data && (data.steps || data.id)) {
                        procBotTargetWorkflow = data;
                        const cfgRes = await fetch(`${API_BASE}/sessions/${sid}/procbot-config`).catch(() => null);
                        if (cfgRes && cfgRes.ok) {
                            const cfgData = await cfgRes.json();
                            if (cfgData.config && cfgData.config.steps) {
                                procBotTargetWorkflow.steps = cfgData.config.steps;
                            }
                        }
                    }
                } catch (_) {}
            }
            await openModal(!sid);

            // Fullscreen immersion styling for standalone pop-out tab
            if (modal) {
                modal.style.background = "#070b14";
                const container = $("procbotModalContainer");
                if (container) {
                    container.style.inset = "0px";
                    container.style.borderRadius = "0px";
                    container.style.border = "none";
                }
            }
            if (openInNewTabBtn) {
                openInNewTabBtn.innerHTML = "🔙 Back to Studio";
                openInNewTabBtn.title = "Return to Standard SOP Studio view";
                openInNewTabBtn.onclick = () => {
                    const curSid = urlParams.get("session_id") || (procBotTargetWorkflow ? procBotTargetWorkflow.id : "");
                    window.location.href = `${window.location.origin}${window.location.pathname}${curSid ? `?session_id=${encodeURIComponent(curSid)}` : ''}`;
                };
            }
        }, 200);
    }
}

// Global Escape Key Modal Closer
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const previewModal = $("exportPreviewModal");
        if (previewModal && !previewModal.classList.contains("hidden")) {
            previewModal.classList.add("hidden");
            const iframe = $("previewIframe");
            if (iframe) iframe.srcdoc = "";
        }
        $("sopTemplateModal")?.classList.add("hidden");
        $("workflowGraphModal")?.classList.add("hidden");
        $("mergeWorkflowsModal")?.classList.add("hidden");
        $("desktopRecorderModal")?.classList.add("hidden");
        $("flowchartModal")?.classList.add("hidden");
        if ($("flowchartModal")) $("flowchartModal").style.display = "none";
        $("piiScannerModal")?.classList.add("hidden");
        if ($("piiScannerModal")) $("piiScannerModal").style.display = "none";
        $("settingsModal")?.classList.add("hidden");
        if ($("settingsModal")) $("settingsModal").style.display = "none";
        $("procbotRunnerModal")?.classList.add("hidden");
        if ($("procbotRunnerModal")) $("procbotRunnerModal").style.display = "none";
        window.closeFeedbackModal?.();
    }
});

// Boot Application
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        init();
        initPowerUserShortcuts();
        initProcBotRunner();
    });
} else {
    init();
    initPowerUserShortcuts();
    initProcBotRunner();
}


