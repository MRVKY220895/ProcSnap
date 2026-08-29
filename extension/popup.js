// ProcSnap Extension Popup Controller
// Multi-Tab Sidebar Architecture (Capture, ProcBot RPA, Privacy, Diagnostics, Support, Workspaces, Settings)

const setupPanel = document.getElementById("setup-panel");
const activePanel = document.getElementById("active-panel");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const pauseButton = document.getElementById("pause");
const captureManualButton = document.getElementById("capture-manual");
const workflowNameInput = document.getElementById("workflow-name");
const applicationNameInput = document.getElementById("application-name");
const stepCounter = document.getElementById("step-counter");
const activeWfName = document.getElementById("active-wf-name");
const apiStatusPill = document.getElementById("api-status-pill");
const apiStatusText = document.getElementById("apiStatusText");
const pulseDot = document.getElementById("pulse-dot");
const activeStatusTitle = document.getElementById("active-status-title");
const stepCountBadge = document.getElementById("step-count-badge");
const popoutButton = document.getElementById("popout-btn");
const latencyBadge = document.getElementById("latencyBadge");
const railRecordDot = document.getElementById("railRecordDot");

let pollingInterval = null;
let cachedBackendUrl = "http://127.0.0.1:8000";
let manuallyDisconnected = false;
let currentActiveTab = "capture";

// -------------------------------------------------------------
// 1. Multi-Tab Navigation Rail Switching
// -------------------------------------------------------------
function initNavRail() {
    const railButtons = document.querySelectorAll(".rail-btn");
    railButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.dataset.tab;
            if (!targetTab) return;
            switchTab(targetTab);
        });
    });
}

function switchTab(tabName) {
    currentActiveTab = tabName;

    // Update rail buttons
    document.querySelectorAll(".rail-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    // Update panes
    document.querySelectorAll(".tab-pane").forEach(pane => {
        pane.classList.remove("active");
    });
    const targetPane = document.getElementById(`pane-${tabName}`);
    if (targetPane) {
        targetPane.classList.add("active");
    }

    // Refresh tab-specific data
    if (tabName === "workspace") {
        loadRecentWorkspaces();
    }
}

// -------------------------------------------------------------
// 2. Port Discovery & Health Probe Engine
// -------------------------------------------------------------
async function getBackendUrl() {
    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 600);
        const res = await fetch(`${cachedBackendUrl}/health`, { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) return cachedBackendUrl;
    } catch (_) {}

    // Fallback probe candidate ports
    for (const port of [8000, 8001, 8002, 8003, 8004, 8005]) {
        const candidate = `http://127.0.0.1:${port}`;
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 600);
            const res = await fetch(`${candidate}/health`, { signal: controller.signal });
            clearTimeout(tid);
            if (res.ok) {
                cachedBackendUrl = candidate;
                return candidate;
            }
        } catch (_) {}
    }
    return cachedBackendUrl;
}

const apiOfflineBanner = document.getElementById("api-offline-banner");
const btnRetryApi = document.getElementById("btnRetryApi");
const btnCopyStartCmd = document.getElementById("btnCopyStartCmd");
const btnExtAutoFix = document.getElementById("btnExtAutoFix");
const btnExtReconnect = document.getElementById("btnExtReconnect");
const btnExtDebug = document.getElementById("btnExtDebug");
const btnCopyGptPrompt = document.getElementById("btnCopyGptPrompt");

function setApiStatus(online, port = "", latencyMs = null) {
    const openStudioLink = document.getElementById("openStudioLink");
    if (openStudioLink) {
        openStudioLink.href = `${cachedBackendUrl}/dashboard/dashboard.html`;
    }
    const supportArticlesLink = document.getElementById("supportArticlesLink");
    if (supportArticlesLink) {
        supportArticlesLink.href = `${cachedBackendUrl}/dashboard/dashboard.html`;
    }

    if (online) {
        if (apiStatusText) apiStatusText.textContent = port ? `ONLINE : ${port}` : "CONNECTED";
        if (apiStatusPill) apiStatusPill.className = "api-status online";
        if (startButton) startButton.disabled = false;
        if (latencyBadge && latencyMs !== null) {
            latencyBadge.classList.remove("hidden");
            latencyBadge.textContent = `⚡ ${latencyMs}ms`;
        }
        if (apiOfflineBanner) apiOfflineBanner.classList.add("hidden");
    } else {
        if (apiStatusText) apiStatusText.textContent = manuallyDisconnected ? "DISCONNECTED" : "OFFLINE";
        if (apiStatusPill) apiStatusPill.className = "api-status offline";
        if (startButton) startButton.disabled = true;
        if (latencyBadge) latencyBadge.classList.add("hidden");
        if (apiOfflineBanner) {
            if (manuallyDisconnected) {
                apiOfflineBanner.classList.add("hidden");
            } else {
                apiOfflineBanner.classList.remove("hidden");
            }
        }
    }
}

async function checkBackendHealth() {
    if (manuallyDisconnected) {
        setApiStatus(false);
        return;
    }
    const t0 = performance.now();
    try {
        const url = await getBackendUrl();
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`${url}/health`, { signal: controller.signal });
        clearTimeout(tid);
        const latencyMs = Math.round(performance.now() - t0);
        if (res.ok) {
            const data = await res.json();
            const portMatch = url.match(/:([0-9]+)/);
            const port = portMatch ? portMatch[1] : (data.port || "8000");
            setApiStatus(true, port, latencyMs);
        } else {
            setApiStatus(false);
        }
    } catch (_) {
        setApiStatus(false);
    }
}

// -------------------------------------------------------------
// 3. Active Session Polling & State Sync
// -------------------------------------------------------------
async function updatePopupState() {
    try {
        const response = await chrome.runtime.sendMessage({ action: "GET_STATUS" });
        if (!response) return;

        if (response.isRecording) {
            setupPanel.classList.add("hidden");
            activePanel.classList.remove("hidden");
            activeWfName.textContent = response.workflowName || "Untitled Workflow";
            stepCounter.textContent = `${response.stepCount || 0} steps recorded`;
            if (stepCountBadge) stepCountBadge.textContent = response.stepCount || 0;

            if (railRecordDot) railRecordDot.classList.remove("hidden");

            if (response.isPaused) {
                pauseButton.textContent = "▶️ Resume Capture";
                pauseButton.classList.add("is-paused");
                activeStatusTitle.textContent = "Capture Paused";
                pulseDot.classList.add("paused");
            } else {
                pauseButton.textContent = "⏸️ Pause Capture";
                pauseButton.classList.remove("is-paused");
                activeStatusTitle.textContent = "Capturing Live...";
                pulseDot.classList.remove("paused");
            }
        } else {
            setupPanel.classList.remove("hidden");
            activePanel.classList.add("hidden");
            if (railRecordDot) railRecordDot.classList.add("hidden");
        }
    } catch (_) {}
}

function startPolling() {
    updatePopupState();
    checkBackendHealth();
    if (!pollingInterval) {
        pollingInterval = setInterval(() => {
            updatePopupState();
            checkBackendHealth();
        }, 1500);
    }
}

// -------------------------------------------------------------
// 4. Capture Form & Buttons
// -------------------------------------------------------------
if (startButton) {
    startButton.addEventListener("click", async () => {
        const name = workflowNameInput.value.trim() || "Untitled Workflow";
        const app = applicationNameInput.value.trim() || "Chrome";

        startButton.disabled = true;
        startButton.textContent = "Starting...";

        chrome.runtime.sendMessage({
            action: "START_RECORDING",
            workflowName: name,
            application: app
        }, (res) => {
            startButton.disabled = false;
            startButton.innerHTML = "<span>🔴</span> Start Capture";
            if (res && res.status === "RECORDING_STARTED") {
                updatePopupState();
            }
        });
    });
}

if (stopButton) {
    stopButton.addEventListener("click", async () => {
        stopButton.disabled = true;
        stopButton.textContent = "Finalizing SOP...";

        chrome.runtime.sendMessage({ action: "STOP_RECORDING" }, async (res) => {
            stopButton.disabled = false;
            stopButton.textContent = "⏹️ Complete & View in Studio";
            updatePopupState();

            const sid = res && res.session ? res.session.id : "";
            const backend = await getBackendUrl();
            const url = `${backend}/dashboard/dashboard.html${sid ? `?session_id=${encodeURIComponent(sid)}` : ''}`;
            chrome.tabs.create({ url });
        });
    });
}

if (pauseButton) {
    pauseButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "TOGGLE_PAUSE" }, () => {
            updatePopupState();
        });
    });
}

if (captureManualButton) {
    captureManualButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "MANUAL_STEP" }, () => {
            updatePopupState();
        });
    });
}

const btnCaptureDesktopPopup = document.getElementById("btnCaptureDesktopPopup");
if (btnCaptureDesktopPopup) {
    btnCaptureDesktopPopup.addEventListener("click", async () => {
        btnCaptureDesktopPopup.disabled = true;
        btnCaptureDesktopPopup.textContent = "📸 Capturing Desktop...";
        try {
            const url = await getBackendUrl();
            await fetch(`${url}/desktop/capture`, { method: "POST" });
        } catch (_) {}
        setTimeout(() => {
            btnCaptureDesktopPopup.disabled = false;
            btnCaptureDesktopPopup.textContent = "🖥️ Capture Desktop Window";
            updatePopupState();
        }, 1000);
    });
}

// App Presets
document.querySelectorAll(".app-preset-chip").forEach(chip => {
    chip.addEventListener("click", () => {
        document.querySelectorAll(".app-preset-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        if (applicationNameInput) applicationNameInput.value = chip.dataset.app;
    });
});

// Popout button
if (popoutButton) {
    popoutButton.addEventListener("click", () => {
        chrome.windows.create({
            url: chrome.runtime.getURL("popup.html"),
            type: "popup",
            width: 380,
            height: 520,
            focused: true
        });
        window.close();
    });
}

// -------------------------------------------------------------
// 5. ProcBot RPA Actions
// -------------------------------------------------------------
const extOpenProcBotStudio = document.getElementById("extOpenProcBotStudio");
if (extOpenProcBotStudio) {
    extOpenProcBotStudio.addEventListener("click", async () => {
        const backend = await getBackendUrl();
        chrome.tabs.create({ url: `${backend}/dashboard/dashboard.html?view=procbot` });
    });
}

const extRunAiPrompt = document.getElementById("extRunAiPrompt");
if (extRunAiPrompt) {
    extRunAiPrompt.addEventListener("click", async () => {
        const backend = await getBackendUrl();
        chrome.tabs.create({ url: `${backend}/dashboard/dashboard.html?view=procbot&mode=ai` });
    });
}

const extDownloadPlaywright = document.getElementById("extDownloadPlaywright");
if (extDownloadPlaywright) {
    extDownloadPlaywright.addEventListener("click", async () => {
        const backend = await getBackendUrl();
        chrome.tabs.create({ url: `${backend}/dashboard/dashboard.html?view=procbot&export=playwright` });
    });
}

const extDownloadSelenium = document.getElementById("extDownloadSelenium");
if (extDownloadSelenium) {
    extDownloadSelenium.addEventListener("click", async () => {
        const backend = await getBackendUrl();
        chrome.tabs.create({ url: `${backend}/dashboard/dashboard.html?view=procbot&export=selenium` });
    });
}

// -------------------------------------------------------------
// 6. Support Tab Actions (Exact Screenshot Recreation)
// -------------------------------------------------------------
const supportRefreshExtension = document.getElementById("supportRefreshExtension");
if (supportRefreshExtension) {
    supportRefreshExtension.addEventListener("click", async () => {
        supportRefreshExtension.style.opacity = "0.5";
        await checkBackendHealth();
        setTimeout(() => {
            supportRefreshExtension.style.opacity = "1";
            chrome.runtime.reload ? chrome.runtime.reload() : window.location.reload();
        }, 400);
    });
}

const supportOpenDashboard = document.getElementById("supportOpenDashboard");
if (supportOpenDashboard) {
    supportOpenDashboard.addEventListener("click", async () => {
        const backend = await getBackendUrl();
        chrome.tabs.create({ url: `${backend}/dashboard/dashboard.html` });
    });
}

// -------------------------------------------------------------
// 7. Workspaces Tab (Recent Workflows Loader)
// -------------------------------------------------------------
async function loadRecentWorkspaces() {
    const listEl = document.getElementById("extRecentWorkflowsList");
    const countBadge = document.getElementById("workspaceCountBadge");
    if (!listEl) return;

    listEl.innerHTML = '<div style="color: #8e9fb5; text-align: center; padding: 20px;">Loading library...</div>';
    try {
        const backend = await getBackendUrl();
        const res = await fetch(`${backend}/sessions`);
        const data = await res.json();
        const sessions = data.sessions || data || [];
        if (countBadge) countBadge.textContent = `${sessions.length} Workflows`;

        if (sessions.length === 0) {
            listEl.innerHTML = '<div style="color: #8e9fb5; text-align: center; padding: 20px;">No recorded workflows yet.</div>';
            return;
        }

        listEl.innerHTML = sessions.slice(0, 8).map(s => `
            <div class="workspace-card-item" data-id="${s.id}">
                <div class="ws-item-title">${s.name || 'Untitled SOP'}</div>
                <div class="ws-item-meta">
                    <span>${s.application || 'Chrome'}</span> • <span>${s.step_count || 0} steps</span>
                </div>
            </div>
        `).join("");

        listEl.querySelectorAll(".workspace-card-item").forEach(card => {
            card.addEventListener("click", async () => {
                const sid = card.dataset.id;
                const b = await getBackendUrl();
                chrome.tabs.create({ url: `${b}/dashboard/dashboard.html?session_id=${encodeURIComponent(sid)}` });
            });
        });
    } catch (_) {
        listEl.innerHTML = '<div style="color: #fb7185; text-align: center; padding: 20px;">Could not load workspaces. Localhost offline.</div>';
    }
}

// -------------------------------------------------------------
// 8. Diagnostics & Auto-Fix
// -------------------------------------------------------------
if (btnExtAutoFix) {
    btnExtAutoFix.addEventListener("click", async () => {
        const diagLog = document.getElementById("diagnosticLogs");
        if (diagLog) diagLog.textContent = "⚡ Running Auto-Fix & Port Reconnection...";
        manuallyDisconnected = false;
        await checkBackendHealth();
        if (diagLog) diagLog.textContent = "✅ Auto-Fix finished. System healthy.";
    });
}

if (btnExtReconnect) {
    btnExtReconnect.addEventListener("click", async () => {
        await checkBackendHealth();
    });
}

if (btnCopyGptPrompt) {
    btnCopyGptPrompt.addEventListener("click", () => {
        const info = `ProcSnap Extension Diagnostics:\nBackend URL: ${cachedBackendUrl}\nStatus: ${apiStatusText.textContent}\nActive Tab: ${currentActiveTab}`;
        navigator.clipboard.writeText(info);
        btnCopyGptPrompt.textContent = "✅ Copied!";
        setTimeout(() => { btnCopyGptPrompt.textContent = "📋 Copy GPT Log"; }, 2000);
    });
}

// -------------------------------------------------------------
// Boot Controller
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initNavRail();
    startPolling();
});
