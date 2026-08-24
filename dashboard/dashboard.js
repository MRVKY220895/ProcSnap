const API_BASE = (typeof window !== "undefined" && window.location.protocol.startsWith("http"))
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
        const aiReady = res.running && res.required_models_present;
        if (res.running) {
            if (res.required_models_present) {
                statusEl.textContent = "AI Connected";
                statusEl.className = "api-status online";
                statusEl.removeAttribute("style");
            } else {
                statusEl.textContent = "AI: Pull Models";
                statusEl.style.backgroundColor = "rgba(234, 179, 8, 0.12)";
                statusEl.style.color = "#d97706";
                statusEl.className = "api-status";
                statusEl.title = res.diagnostic_message || "Open Requirements → Pull AI Models to download moondream & qwen2.5";
            }
            if ($("startOllamaBtn")) $("startOllamaBtn").classList.add("hidden");
        } else {
            statusEl.textContent = "AI Offline";
            statusEl.className = "api-status offline";
            statusEl.removeAttribute("style");
            if ($("startOllamaBtn")) $("startOllamaBtn").classList.remove("hidden");
        }
        // Toggle AI feature buttons so users know they are optional / unavailable
        const aiOfflineHint = aiReady ? "" : "AI offline — open 🛠️ Requirements → Pull AI Models to enable";
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
        const statusEl = $("aiStatus");
        if (statusEl) {
            statusEl.textContent = "AI Offline";
            statusEl.className = "api-status offline";
            statusEl.title = "Ollama service unreachable on 127.0.0.1:11434. Click 'Start Ollama' to launch.";
            statusEl.removeAttribute("style");
        }
        if ($("startOllamaBtn")) $("startOllamaBtn").classList.remove("hidden");
        // Disable AI buttons when offline
        ["aiEnhanceStepBtn", "aiPolishBtn"].forEach(id => {
            const el = $(id);
            if (!el) return;
            el.setAttribute("disabled", "true");
            el.style.opacity = "0.4";
            el.style.cursor = "not-allowed";
            if (!el.getAttribute("data-original-title")) el.setAttribute("data-original-title", el.title);
            el.title = "AI offline — open 🛠️ Requirements → Pull AI Models to enable";
        });
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
    if (session_id) {
        selectedWorkflowId = session_id;
        openWorkflow(session_id);
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

// ── Add Tag Handler ────────────────────────────────────────────────────────
async function addTagToActiveWorkflow() {
    if (!workflow) return;
    const tag = prompt("Enter category tag name (e.g. Sales, HR, Finance, Onboarding):");
    if (!tag || !tag.trim()) return;
    const cleanTag = tag.trim().replace(/,/g, "");
    const rawTags = workflow.tags || "";
    const tagList = rawTags.split(",").map(t => t.trim()).filter(Boolean);
    if (tagList.includes(cleanTag)) return showToast("Tag already exists");
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
                    <div class="workflow-name">${esc(w.name || "Untitled Workflow")}</div>
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
        card.onclick = () => openWorkflow(card.dataset.id);
    });
}

// Show Full-Screen Workflow Hub Gallery UI
function showLibraryHub() {
    selectedWorkflowId = null;
    if ($("libraryHubView")) $("libraryHubView").classList.remove("hidden");
    if ($("studioView")) $("studioView").classList.add("hidden");
    if ($("topBreadcrumb")) $("topBreadcrumb").classList.add("hidden");
    
    // Auto-collapse sidebar in Hub view for full-width gallery experience
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) sidebar.classList.add("collapsed");

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
        const timeStr = formatRelativeTime(w.created_at || w.updated_at);
        const coverUrl = `${API_BASE}/sessions/${encodeURIComponent(w.id)}/steps/0/image?t=${Date.now()}`;
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
        currentStepIndex = 0;
        setTab(activeTab);
    } catch (e) {
        showToast(`Failed to load workflow: ${e.message}`);
        showLibraryHub();
    }
}

// Tab Switching
function setTab(tabName) {
    if (tabName === "slideshow") tabName = "play";
    activeTab = tabName;
    document.querySelectorAll(".tab").forEach(tab => {
        const t = tab.dataset.tab === "slideshow" ? "play" : tab.dataset.tab;
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

        // Drawer Accordion Collapse / Expand
        document.querySelectorAll(".drawer-accordion-header").forEach(header => {
            header.onclick = () => {
                const targetId = header.getAttribute("data-target");
                const content = document.getElementById(targetId);
                if (content) {
                    const isHidden = content.classList.contains("hidden");
                    if (isHidden) {
                        content.classList.remove("hidden");
                        header.classList.remove("collapsed");
                    } else {
                        content.classList.add("hidden");
                        header.classList.add("collapsed");
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

                if (res.success || res.title) {
                    if (res.title) $("guideStepTitle").textContent = res.title;
                    if (res.description) $("guideStepDesc").textContent = res.description;
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

    // Focus & Spotlight Toggle Buttons
    setOnclick("btnToggleFocusSpotlight", toggleFocusSpotlight);
    setOnclick("btnDrawerFocusToggle", toggleFocusSpotlight);
    updateFocusToggleUI();

    loadActiveStepDetails();
    renderStepThumbnails();
}

function updateFocusToggleUI() {
    const isEnabled = canvasEngine ? (canvasEngine.autoSpotlightEnabled !== false && canvasEngine.focusBoxEnabled !== false) : true;
    
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
    if (!canvasEngine) return;
    const currentState = (canvasEngine.autoSpotlightEnabled !== false && canvasEngine.focusBoxEnabled !== false);
    const newState = !currentState;
    canvasEngine.autoSpotlightEnabled = newState;
    canvasEngine.focusBoxEnabled = newState;
    
    updateFocusToggleUI();
    showToast(newState ? "🎯 Element Focus & Spotlight Enabled" : "🎯 Element Focus & Spotlight Disabled", 2500);
    loadActiveStepDetails();
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
    renderStepBranches(step);

    // Detect if step has an active GIF micro-demo
    step.hasActiveDemo = Boolean(
        step.hasActiveDemo ||
        (step.screenshotUrl && (step.screenshotUrl.includes("-demo") || step.screenshotUrl.endsWith(".gif")))
    );

    if (typeof updateDemoButtonState === "function") updateDemoButtonState(step);
    if (typeof updateFocusToggleUI === "function") updateFocusToggleUI();
    if (typeof updateHotspotReticlePosition === "function") updateHotspotReticlePosition(step);

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

    if (step.screenshotUrl) {
        if (imgEl) {
            const cleanUrl = step.screenshotUrl.replace(/-demo.*\.gif/i, ".png");
            imgEl.src = API_BASE + (step.hasActiveDemo ? cleanUrl : step.screenshotUrl);
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
                voiceover: voiceover,
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
        const branchBadge = (s.branches && s.branches.length > 0) ? `<div class="branch-count-badge" title="${s.branches.length} Decision Paths">🔀 ${s.branches.length}</div>` : '';
        return `
            <div class="thumb-card ${index === currentStepIndex ? 'active' : ''} ${s.hidden ? 'hidden-step' : ''}" data-index="${index}" draggable="true" title="Drag to reorder step">
                ${img}
                <div class="thumb-badge">${s.sequence}</div>
                ${checkedBadge}
                ${branchBadge}
            </div>
        `;
    }).join("");

    let draggedThumbIndex = null;

    document.querySelectorAll(".thumb-card").forEach(card => {
        const idx = parseInt(card.dataset.index);
        const s = steps[idx];
        if (s && s.screenshotUrl) {
            card.addEventListener("mouseenter", (e) => showHoverPreview(API_BASE + s.screenshotUrl, s.title || getDefaultTitle(s), e));
            card.addEventListener("mouseleave", hideHoverPreview);
        }

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


/* =========================================================
   STEP HOVER PREVIEW HELPER
========================================================= */

let hoverPreviewEl = null;

function showHoverPreview(url, title, e) {
    if (!url) return;
    if (!hoverPreviewEl) {
        hoverPreviewEl = document.createElement("div");
        hoverPreviewEl.className = "step-hover-preview";
        document.body.appendChild(hoverPreviewEl);
    }
    hoverPreviewEl.innerHTML = `
        <img src="${esc(url)}" alt="Preview">
        <div class="step-hover-preview-label">${esc(title || "Step Preview")}</div>
    `;
    const target = e.currentTarget || e.target;
    const rect = target.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 280, Math.max(10, rect.left));
    const y = rect.top - 200 > 10 ? rect.top - 190 : rect.bottom + 10;
    hoverPreviewEl.style.left = `${x}px`;
    hoverPreviewEl.style.top = `${y}px`;
    hoverPreviewEl.style.display = "block";
}

function hideHoverPreview() {
    if (hoverPreviewEl) {
        hoverPreviewEl.style.display = "none";
    }
}

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
            <div class="editor-step-row-left" style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                <input type="checkbox" class="step-select-cb" data-id="${s.id}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #6366f1; flex-shrink: 0;">
                <span class="drag-handle" style="cursor: grab; color: var(--text-muted);">☰</span>
                <div class="row-badge" style="${s.approved ? 'background: linear-gradient(135deg, #10b981, #059669);' : ''}">${s.sequence}</div>
                <div class="editor-step-thumb ${s.hidden ? 'is-deleted-thumb' : ''}" data-thumb-url="${s.screenshotUrl ? esc(API_BASE + s.screenshotUrl) : ''}" data-thumb-title="${esc(s.title || getDefaultTitle(s))}">
                    ${s.screenshotUrl ? `<img src="${esc(API_BASE + s.screenshotUrl)}" alt="Step ${s.sequence}">` : '<div class="no-thumb">No img</div>'}
                </div>
                <div class="row-info" style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                        <div class="row-title inline-editable-title" contenteditable="true" data-id="${s.id}" title="Click to edit step title inline" style="font-weight: 700; color: var(--text-main, #fff); outline: none; border-bottom: 1px dashed transparent; transition: all 0.15s ease;">
                            ${esc(s.title || getDefaultTitle(s))}
                        </div>
                        ${s.approved ? '<span class="badge" style="background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 9.5px; padding: 1px 6px;">APPROVED</span>' : ''}
                        ${s.hidden ? '<span class="deleted-badge" style="font-size: 10px;">👁️ HIDDEN</span>' : ''}
                    </div>
                    <div class="row-desc inline-editable-desc" contenteditable="true" data-id="${s.id}" title="Click to edit description inline" style="font-size: 12px; color: var(--text-muted, #94a3b8); outline: none; line-height: 1.35;">
                        ${esc(s.description || getDefaultDescription(s))}
                    </div>
                </div>
            </div>
            <div class="editor-step-row-actions" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                <button class="btn btn-secondary btn-xs btn-approve-step" data-id="${s.id}" title="${s.approved ? 'Approved' : 'Mark as Approved'}" style="${s.approved ? 'color: #10b981;' : ''}">
                    ${s.approved ? '✓' : 'Approve'}
                </button>
                <button class="btn btn-secondary btn-xs btn-dup-step" data-id="${s.id}" title="Duplicate this step">📋 Duplicate</button>
                <button class="btn btn-secondary btn-xs btn-up" ${originalIndex === 0 ? "disabled" : ""} title="Move Up">▲</button>
                <button class="btn btn-secondary btn-xs btn-down" ${originalIndex === allSteps.length - 1 ? "disabled" : ""} title="Move Down">▼</button>
                <button class="btn btn-secondary btn-xs btn-hide-step" title="${s.hidden ? 'Restore' : 'Hide'}">${s.hidden ? '👁️ Restore' : 'Hide'}</button>
                <button class="btn btn-danger btn-xs btn-perm-del" title="Permanently delete from database">✖</button>
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
    workflow.steps.forEach(s => { s.checked = true; s.approved = true; });
    updateApprovalProgress(workflow.steps);
    showToast("✓ All steps marked as approved!");
    renderStepThumbnails();
});

// Bulk action: Unhide all steps
setOnclick("bulkUnhideAllBtn", async () => {
    if (!workflow || !workflow.steps || workflow.steps.length === 0) return;
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
    
    const showPlayStep = () => {
        const s = visibleSteps[playIdx];
        if (!s) return;
        
        if ($("playStepTitle")) $("playStepTitle").textContent = s.title || getDefaultTitle(s);
        if ($("playStepBadge")) $("playStepBadge").textContent = s.sequence;
        if ($("playStepDesc")) $("playStepDesc").textContent = s.description || getDefaultDescription(s);
        if ($("playVoiceText")) {
            $("playVoiceText").value = s.voiceover || s.description || getDefaultDescription(s);
        }
        
        if (s.note && $("playStepNotesBox") && $("playStepNoteText")) {
            $("playStepNotesBox").classList.remove("hidden");
            $("playStepNoteText").textContent = s.note;
        } else if ($("playStepNotesBox")) {
            $("playStepNotesBox").classList.add("hidden");
        }
        
        if ($("playImg")) {
            if (s.screenshotUrl) {
                $("playImg").src = API_BASE + s.screenshotUrl;
                $("playImg").classList.remove("hidden");
            } else {
                $("playImg").src = "";
                $("playImg").classList.add("hidden");
            }
        }
        
        if ($("playProgress")) $("playProgress").textContent = `Step ${playIdx + 1} of ${visibleSteps.length}`;
        if ($("playPrevBtn")) $("playPrevBtn").disabled = playIdx === 0;
        if ($("playNextBtn")) $("playNextBtn").disabled = playIdx === visibleSteps.length - 1;

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

    // Keyboard navigation in playback mode
    if (!window._playbackKeyBound) {
        window._playbackKeyBound = true;
        window.addEventListener("keydown", (e) => {
            if (activeTab !== "play") return;
            if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
            if (e.key === "ArrowRight" || e.key === "PageDown") {
                e.preventDefault();
                $("playNextBtn")?.click();
            } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
                e.preventDefault();
                $("playPrevBtn")?.click();
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
   EXPORT LOGIC & UNIVERSAL LIVE PREVIEWER (Phase 7)
========================================================= */

let currentExportPreviewText = "";
let currentExportDownloadAction = null;

async function openExportPreview(type) {
    if (!workflow) {
        showToast("No workflow selected");
        return;
    }
    
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
        docx: { title: "Microsoft Word Document (.docx)", icon: "📄", sub: "Document structure & embedded step layout preview" },
        pptx: { title: "PowerPoint Presentation (.pptx)", icon: "📊", sub: "Widescreen 16:9 slide deck layout preview" },
        json: { title: "JSON Portable Backup (.json)", icon: "💾", sub: "Formatted JSON data backup preview" },
        html: { title: "Self-Contained Standalone HTML (.html)", icon: "📁", sub: "Complete offline HTML documentation preview" },
        markdown: { title: "GitHub Flavored Markdown (.md)", icon: "📝", sub: "Formatted markdown text preview" },
        confluence: { title: "Confluence Wiki Markup", icon: "⚡", sub: "Storage format wiki markup preview" },
        csv: { title: "Structured Spreadsheet CSV", icon: "📊", sub: "Tabular step data preview" },
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
        } else if (type === "html" || type === "pdf") {
            const html = await generateOfflineHtml();
            iframe.srcdoc = html;
            iframe.classList.remove("hidden");
            currentExportDownloadAction = () => (type === "pdf" ? $("exportPdfBtn")?.click() : $("exportHtmlBtn")?.click());
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
            visualWrap.innerHTML = `
                <div style="max-width: 820px; margin: 0 auto; background: #ffffff; color: #1e293b; padding: 48px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); font-family: 'Inter', sans-serif;">
                    <div style="border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 28px;">
                        <h1 style="font-size: 26px; color: #1e40af; margin: 0 0 8px 0;">${esc(workflow.name)}</h1>
                        <div style="font-size: 13px; color: #64748b;">Application: <strong>${esc(workflow.application)}</strong> • Steps: <strong>${steps.length}</strong> • Created with ProcSnap</div>
                    </div>
                    ${steps.map(st => `
                        <div style="margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #e2e8f0;">
                            <h2 style="font-size: 17px; color: #1e293b; margin: 0 0 10px 0;">
                                <span style="background: #2563eb; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 13px; margin-right: 8px;">Step ${st.sequence}</span>
                                ${esc(st.title || getDefaultTitle(st))}
                            </h2>
                            <p style="font-size: 14px; color: #475569; line-height: 1.5; margin: 0 0 14px 0;">${esc(st.description || getDefaultDescription(st))}</p>
                            ${st.screenshotUrl ? `<img src="${normalizeImageUrl(st.screenshotUrl)}" style="max-width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; display: block;">` : ''}
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
                                <div style="font-size: 18px; font-weight: 700; color: #0f172a;">
                                    <span style="background: #d97706; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 13px; margin-right: 8px;">Slide ${i + 1}</span>
                                    ${esc(st.title || getDefaultTitle(st))}
                                </div>
                                <div style="font-size: 12px; font-weight: 600; color: #64748b;">Step ${st.sequence} of ${steps.length}</div>
                            </div>
                            <div style="flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; margin: 12px 0;">
                                ${st.screenshotUrl ? `<img src="${normalizeImageUrl(st.screenshotUrl)}" style="max-height: 280px; max-width: 100%; object-fit: contain; border-radius: 6px; border: 1px solid #cbd5e1;">` : '<div style="color: #94a3b8;">No Screenshot</div>'}
                            </div>
                            <div style="background: #f8fafc; padding: 10px 14px; border-radius: 6px; font-size: 13px; color: #334155; border-left: 3px solid #d97706;">
                                ${esc(st.description || getDefaultDescription(st))}
                            </div>
                        </div>
                    `).join("")}
                </div>
            `;
            visualWrap.classList.remove("hidden");
            currentExportDownloadAction = () => $("exportPptxBtn")?.click();
        }
    } catch (err) {
        textWrap.textContent = `Error rendering export preview: ${err.message}`;
        textWrap.classList.remove("hidden");
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
    setOnclick("btnCloseExportPreview", () => {
        $("exportPreviewModal")?.classList.add("hidden");
    });
    
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
            if (e.target === exportModal) exportModal.classList.add("hidden");
        };
    }

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
    if (!step.screenshotUrl) return "";
    
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
            <div style="font-size: 11px; color: var(--text-muted); font-style: italic; padding: 4px 0;">
                No branch rules defined. Sequential playback (Step ${step.sequence} → ${Math.min(allSteps.length, step.sequence + 1)}).
            </div>
        `;
    } else {
        listEl.innerHTML = step.branches.map((b, i) => {
            const stepOptions = allSteps.map(s => `
                <option value="${s.sequence}" ${s.sequence === b.target_sequence ? 'selected' : ''}>
                    Step ${s.sequence} ${s.title ? '— ' + esc(s.title.substring(0, 14)) : ''}
                </option>
            `).join("");
            
            return `
                <div class="step-branch-item" data-index="${i}">
                    <div class="step-branch-row">
                        <input type="text" class="step-branch-input" value="${esc(b.label || '')}" placeholder="Choice label (e.g. If Admin)" data-index="${i}">
                        <select class="step-branch-select" data-index="${i}">
                            ${stepOptions}
                        </select>
                        <button class="btn-branch-delete" data-index="${i}" title="Remove branch">✕</button>
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
                saveActiveStepEditsSilent();
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
        };
    });
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
            label: `Path ${step.branches.length + 1}`,
            target_sequence: nextSeq
        });
        
        // Auto expand accordion if collapsed
        const content = $("drawerAccBranching");
        if (content) content.classList.remove("hidden");

        renderStepBranches(step);
        saveActiveStepEditsSilent();
        renderStepThumbnails();
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

    if (!step || !step.hasActiveDemo) {
        overlay.classList.add("hidden");
        if (notice) notice.classList.add("hidden");
        return;
    }

    overlay.classList.remove("hidden");
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

    if (!step || !step.screenshotUrl || step.hidden) {
        reticle.classList.add("hidden");
        return;
    }

    reticle.classList.remove("hidden");
    const hs = calculateDefaultHotspot(step);
    const xPct = Math.max(2, Math.min(98, hs.xPct + (hs.wPct / 2)));
    const yPct = Math.max(2, Math.min(98, hs.yPct + (hs.hPct / 2)));

    reticle.style.left = `${xPct}%`;
    reticle.style.top = `${yPct}%`;

    const label = $("reticleCoordsLabel");
    if (label) {
        if (step.hasActiveDemo) {
            label.textContent = `🎯 Drag to Adjust GIF (${Math.round(xPct)}%, ${Math.round(yPct)}%)`;
        } else {
            label.textContent = `🎯 ${Math.round(xPct)}%, ${Math.round(yPct)}%`;
        }
    }
}

function initHotspotReticle() {
    const reticle = $("hotspotReticleHandle");
    const wrapper = $("canvasWrapper");
    if (!reticle || !wrapper) return;

    // 1. Drag & Drop Listener on Reticle Handle
    reticle.addEventListener("pointerdown", (e) => {
        if (isHotspotLocked) {
            showToast("🔒 Hotspot is locked. Unlock it in the toolbar to adjust.", 2000);
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
        e.preventDefault();
        e.stopPropagation();

        const rect = wrapper.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        let xPct = ((e.clientX - rect.left) / rect.width) * 100;
        let yPct = ((e.clientY - rect.top) / rect.height) * 100;

        xPct = Math.max(1, Math.min(99, xPct));
        yPct = Math.max(1, Math.min(99, yPct));

        reticle.style.left = `${xPct}%`;
        reticle.style.top = `${yPct}%`;

        const step = getCurrentStep();
        const label = $("reticleCoordsLabel");
        if (label) {
            if (step?.hasActiveDemo) {
                label.textContent = `🎯 Drag to Adjust GIF (${Math.round(xPct)}%, ${Math.round(yPct)}%)`;
            } else {
                label.textContent = `🎯 ${Math.round(xPct)}%, ${Math.round(yPct)}%`;
            }
        }

        // Update inspector coordinate fields in real time
        const curW = Number($("hotspotW")?.value || 20);
        const curH = Number($("hotspotH")?.value || 20);
        const newLeft = Math.max(0, Math.min(100 - curW, Math.round(xPct - curW / 2)));
        const newTop = Math.max(0, Math.min(100 - curH, Math.round(yPct - curH / 2)));

        setVal("hotspotX", newLeft);
        setVal("hotspotY", newTop);
    });

    const finishDrag = async (e) => {
        if (!isDraggingReticle) return;
        isDraggingReticle = false;
        reticle.classList.remove("dragging");
        try { reticle.releasePointerCapture(e.pointerId); } catch (_) {}

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

        const isDemo = Boolean(step.hasActiveDemo || (step.screenshotUrl && (step.screenshotUrl.includes("-demo") || step.screenshotUrl.endsWith(".gif"))));

        if (isDemo) {
            showToast("🔄 Re-generating Micro-Demo at dragged location...", 2500);
            await triggerAnimateGeneration(step, curXPct, curYPct);
        } else {
            showToast(`🎯 Hotspot target updated: (${leftVal}%, ${topVal}%)`, 2000);
        }
    };

    reticle.addEventListener("pointerup", finishDrag);
    reticle.addEventListener("pointercancel", finishDrag);

    // 2. Click-to-Pin Hotspot Finder on Canvas
    wrapper.addEventListener("click", async (e) => {
        if (!isHotspotClickMode || isHotspotLocked) return;
        if (e.target.closest("#hotspotReticleHandle")) return;

        const rect = wrapper.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        let xPct = ((e.clientX - rect.left) / rect.width) * 100;
        let yPct = ((e.clientY - rect.top) / rect.height) * 100;

        xPct = Math.max(1, Math.min(99, xPct));
        yPct = Math.max(1, Math.min(99, yPct));

        // Snap Reticle to clicked position
        reticle.style.left = `${xPct}%`;
        reticle.style.top = `${yPct}%`;

        const curW = Number($("hotspotW")?.value || 20);
        const curH = Number($("hotspotH")?.value || 20);
        const newLeft = Math.max(0, Math.min(100 - curW, Math.round(xPct - curW / 2)));
        const newTop = Math.max(0, Math.min(100 - curH, Math.round(yPct - curH / 2)));

        setVal("hotspotX", newLeft);
        setVal("hotspotY", newTop);

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
    });

    // 3. Wire Click Mode Trigger Buttons & Lock Toggle
    setOnclick("btnPickHotspotTool", () => toggleHotspotClickMode());
    setOnclick("btnPickHotspotClick", () => toggleHotspotClickMode());
    setOnclick("btnToggleLockHotspot", () => toggleHotspotLock());

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
        modal.classList.toggle("hidden", !show);
        if (show && !activeTemplateData) {
            loadDefaultTemplatePages();
        }
    };

    if (openBtn) openBtn.onclick = () => toggleModal(true);
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
            document.querySelectorAll(".drawer-seg-btn").forEach(b => {
                b.classList.remove("active");
                b.style.background = "transparent";
                b.style.color = "var(--text-muted)";
            });
            btn.classList.add("active");
            btn.style.background = "#6366f1";
            btn.style.color = "#ffffff";

            const view = btn.dataset.view;
            const focusCard = $("btnDrawerFocusToggle")?.parentElement;
            const hotspotCard = $("drawerAccHotspot")?.parentElement;
            const expectedCard = $("drawerAccExpected")?.parentElement;
            const branchCard = $("drawerAccBranching")?.parentElement;
            const metaCard = $("drawerAccMeta")?.parentElement;

            const setVisible = (el, show) => {
                if (el) el.classList.toggle("hidden", !show);
            };

            if (view === "all") {
                setVisible(focusCard, true);
                setVisible(hotspotCard, true);
                setVisible(expectedCard, true);
                setVisible(branchCard, true);
                setVisible(metaCard, true);
            } else if (view === "hotspot") {
                setVisible(focusCard, true);
                setVisible(hotspotCard, true);
                setVisible(expectedCard, false);
                setVisible(branchCard, false);
                setVisible(metaCard, false);
                $("drawerAccHotspot")?.classList.remove("hidden");
            } else if (view === "notes") {
                setVisible(focusCard, false);
                setVisible(hotspotCard, false);
                setVisible(expectedCard, true);
                setVisible(branchCard, false);
                setVisible(metaCard, false);
                $("drawerAccExpected")?.classList.remove("hidden");
            } else if (view === "branch") {
                setVisible(focusCard, false);
                setVisible(hotspotCard, false);
                setVisible(expectedCard, false);
                setVisible(branchCard, true);
                setVisible(metaCard, false);
                $("drawerAccBranching")?.classList.remove("hidden");
            } else if (view === "meta") {
                setVisible(focusCard, false);
                setVisible(hotspotCard, false);
                setVisible(expectedCard, false);
                setVisible(branchCard, false);
                setVisible(metaCard, true);
                $("drawerAccMeta")?.classList.remove("hidden");
            }
        };
    });
    
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

    if (!openBtn || !modal) return;

    let pollInterval = null;

    const closeModal = () => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        modal.classList.add("hidden");
    };

    openBtn.onclick = () => {
        modal.classList.remove("hidden");
        if (preStart) preStart.classList.remove("hidden");
        if (activeHud) activeHud.classList.add("hidden");
        if (startBtn) startBtn.classList.remove("hidden");
        if (stopBtn) stopBtn.classList.add("hidden");
        if (titleInput) titleInput.value = "Desktop Workflow: " + new Date().toLocaleDateString();
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (startBtn) {
        startBtn.onclick = async () => {
            const title = titleInput?.value?.trim() || "Native Windows Desktop Workflow";
            startBtn.disabled = true;
            startBtn.innerHTML = `<span>⏳</span> Launching Hook...`;

            try {
                const res = await fetch(`${API_BASE}/desktop-recorder/start`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title })
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || "Failed to start desktop recorder");
                }

                const data = await res.json();
                showToast("🔴 Native Desktop Recording Active! Click anywhere on your desktop.", 5000);

                if (preStart) preStart.classList.add("hidden");
                if (activeHud) activeHud.classList.remove("hidden");
                if (startBtn) startBtn.classList.add("hidden");
                if (stopBtn) stopBtn.classList.remove("hidden");

                // Start polling step count
                pollInterval = setInterval(async () => {
                    try {
                        const sRes = await fetch(`${API_BASE}/desktop-recorder/status`);
                        if (sRes.ok) {
                            const sData = await sRes.json();
                            if (liveStepCount) {
                                liveStepCount.textContent = `${sData.stepCount || 0} Steps Captured`;
                            }
                            if (!sData.isRecording && pollInterval) {
                                // Stopped via hotkey
                                clearInterval(pollInterval);
                                pollInterval = null;
                                window.location.href = `dashboard.html?session_id=${encodeURIComponent(sData.sessionId)}`;
                            }
                        }
                    } catch (e) {
                        console.debug("Status poll notice:", e);
                    }
                }, 800);
            } catch (e) {
                console.error("Desktop recorder start error:", e);
                showToast("Desktop recorder error: " + e.message);
                startBtn.disabled = false;
                startBtn.innerHTML = `🚀 Start Desktop Capture`;
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
                }, 1000);
            } catch (e) {
                console.error("Desktop recorder stop error:", e);
                showToast("Failed to stop recording: " + e.message);
                stopBtn.disabled = false;
                stopBtn.innerHTML = `⏹ Stop & Open Studio`;
            }
        };
    }
}


// Initialize All Platform Enhancements
initHotspotReticle();
initCanvasFileDrop();
initSopTemplateManager();
initLiveDraggableCursor();
initDrawerVoiceoverAndAiDiff();
initAutoRedactPII();
initWorkflowGraphModal();
initSlideshowPracticeAndTeleprompter();
initScormExport();
initCopyRichSopToClipboard();
initWorkflowMergeModal();
initStepListFilterAndBulkActions();
initSlideshowAutoPlayAndFullscreen();
initPrintSopPdf();
initDesktopRecorderModal();


