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
const pulseDot = document.getElementById("pulse-dot");
const activeStatusTitle = document.getElementById("active-status-title");
const stepCountBadge = document.getElementById("step-count-badge");
const popoutButton = document.getElementById("popout-btn");

let pollingInterval = null;
let cachedBackendUrl = "http://127.0.0.1:8000";

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

let manuallyDisconnected = false;
const apiOfflineBanner = document.getElementById("api-offline-banner");
const btnRetryApi = document.getElementById("btnRetryApi");
const btnCopyStartCmd = document.getElementById("btnCopyStartCmd");
const btnToggleApiConnect = document.getElementById("btnToggleApiConnect");
const btnExtStartAPI = document.getElementById("btnExtStartAPI");
const btnExtGitPull = document.getElementById("btnExtGitPull");
const btnExtReinstall = document.getElementById("btnExtReinstall");
const extUtilStatus = document.getElementById("extUtilStatus");

function setApiStatus(online, port = "") {
    const openStudioLink = document.getElementById("openStudioLink");
    if (openStudioLink) {
        openStudioLink.href = `${cachedBackendUrl}/dashboard/dashboard.html`;
    }
    if (online) {
        apiStatusPill.textContent = port ? `Online (Port ${port})` : "API Connected";
        apiStatusPill.className = "api-status online";
        startButton.disabled = false;
        if (btnToggleApiConnect) {
            btnToggleApiConnect.textContent = "🔌";
            btnToggleApiConnect.title = "Connected — Click to Disconnect API";
        }
        if (apiOfflineBanner) apiOfflineBanner.classList.add("hidden");
    } else {
        apiStatusPill.textContent = manuallyDisconnected ? "Disconnected" : "API Offline";
        apiStatusPill.className = "api-status offline";
        startButton.disabled = true;
        if (btnToggleApiConnect) {
            btnToggleApiConnect.textContent = "⚡";
            btnToggleApiConnect.title = "Disconnected — Click to Start / Connect API";
        }
        if (apiOfflineBanner) apiOfflineBanner.classList.remove("hidden");
    }
}

async function checkBackendHealth() {
    if (manuallyDisconnected) {
        setApiStatus(false);
        return false;
    }
    try {
        const backend = await getBackendUrl();
        const res = await fetch(`${backend}/health`);
        if (res.ok) {
            const portMatch = backend.match(/:(\d+)$/);
            const port = portMatch ? portMatch[1] : "8000";
            setApiStatus(true, port);
            return true;
        }
    } catch (e) {
        // Ignore
    }
    setApiStatus(false);
    return false;
}

if (btnToggleApiConnect) {
    btnToggleApiConnect.onclick = async () => {
        if (!manuallyDisconnected) {
            manuallyDisconnected = true;
            setApiStatus(false);
        } else {
            manuallyDisconnected = false;
            await checkBackendHealth();
        }
    };
}

if (btnRetryApi) {
    btnRetryApi.onclick = async () => {
        manuallyDisconnected = false;
        btnRetryApi.disabled = true;
        btnRetryApi.textContent = "⏳ Testing Ports 8000-8005...";
        const ok = await checkBackendHealth();
        btnRetryApi.disabled = false;
        btnRetryApi.textContent = "⚡ Start / Reconnect API";
        if (ok) {
            btnRetryApi.textContent = "✓ Connected!";
            setTimeout(() => { btnRetryApi.textContent = "⚡ Start / Reconnect API"; }, 1500);
        }
    };
}

if (btnExtStartAPI) {
    btnExtStartAPI.onclick = async () => {
        manuallyDisconnected = false;
        btnExtStartAPI.disabled = true;
        btnExtStartAPI.innerHTML = "<span>⏳</span> Connecting…";
        const ok = await checkBackendHealth();
        btnExtStartAPI.disabled = false;
        btnExtStartAPI.innerHTML = ok ? "<span>✓</span> Connected" : "<span>⚡</span> Connect";
        setTimeout(() => { btnExtStartAPI.innerHTML = "<span>⚡</span> Connect"; }, 2000);
    };
}

if (btnExtGitPull) {
    btnExtGitPull.onclick = async () => {
        btnExtGitPull.disabled = true;
        btnExtGitPull.innerHTML = "<span>⏳</span> Pulling…";
        if (extUtilStatus) {
            extUtilStatus.classList.remove("hidden");
            extUtilStatus.textContent = "Pulling latest update from GitHub repository...";
        }
        try {
            const res = await fetch(`${cachedBackendUrl}/system/git-pull`, { method: "POST" });
            const data = await res.json();
            if (extUtilStatus) {
                extUtilStatus.textContent = data.output || (data.success ? "✓ Up to date!" : "Failed to update");
            }
            btnExtGitPull.innerHTML = "<span>✓</span> Done";
        } catch(e) {
            if (extUtilStatus) extUtilStatus.textContent = `❌ Error: ${e.message}`;
            btnExtGitPull.innerHTML = "<span>❌</span> Error";
        } finally {
            btnExtGitPull.disabled = false;
            setTimeout(() => { btnExtGitPull.innerHTML = "<span>⬇️</span> Git Pull"; }, 3000);
        }
    };
}

if (btnExtReinstall) {
    btnExtReinstall.onclick = async () => {
        btnExtReinstall.disabled = true;
        btnExtReinstall.innerHTML = "<span>⏳</span> Updating…";
        if (extUtilStatus) {
            extUtilStatus.classList.remove("hidden");
            extUtilStatus.textContent = "Running pip dependency updates in background...";
        }
        try {
            const res = await fetch(`${cachedBackendUrl}/system/reinstall-packages`, { method: "POST" });
            const data = await res.json();
            if (extUtilStatus) {
                extUtilStatus.textContent = data.output || (data.success ? "✓ Dependencies updated!" : "Installation completed");
            }
            btnExtReinstall.innerHTML = "<span>✓</span> Done";
        } catch(e) {
            if (extUtilStatus) extUtilStatus.textContent = `❌ Error: ${e.message}`;
            btnExtReinstall.innerHTML = "<span>❌</span> Error";
        } finally {
            btnExtReinstall.disabled = false;
            setTimeout(() => { btnExtReinstall.innerHTML = "<span>📦</span> Pip Update"; }, 3000);
        }
    };
}

if (btnCopyStartCmd) {
    btnCopyStartCmd.onclick = async () => {
        const cmd = `backend\\.venv\\Scripts\\python.exe -m uvicorn backend.main:app --port 8000`;
        try {
            await navigator.clipboard.writeText(cmd);
            const prev = btnCopyStartCmd.textContent;
            btnCopyStartCmd.textContent = "✓ Command Copied!";
            setTimeout(() => { btnCopyStartCmd.textContent = prev; }, 2000);
        } catch (_) {
            alert(`Start command:\n${cmd}`);
        }
    };
}

if (apiStatusPill) {
    apiStatusPill.onclick = () => checkBackendHealth();
}

function updateUI(recording, name = "Untitled Workflow", steps = 0, paused = false) {
    if (recording) {
        setupPanel.classList.add("hidden");
        activePanel.classList.remove("hidden");
        activeWfName.textContent = name;
        stepCounter.textContent = `${steps} step${steps === 1 ? "" : "s"} captured`;
        if (stepCountBadge) stepCountBadge.textContent = String(steps);
        
        if (paused) {
            activeStatusTitle.textContent = "Paused";
            pulseDot.style.background = "#eab308"; // yellow
            pulseDot.style.boxShadow = "none";
            pauseButton.textContent = "Resume Capture";
            pauseButton.className = "btn btn-primary";
        } else {
            activeStatusTitle.textContent = "Capturing...";
            pulseDot.style.background = "#ef4444"; // red
            pulseDot.style.boxShadow = "";
            pauseButton.textContent = "Pause Capture";
            pauseButton.className = "btn btn-secondary";
        }
    } else {
        setupPanel.classList.remove("hidden");
        activePanel.classList.add("hidden");
    }
}

function startPollingState() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        chrome.storage.local.get(["recording", "sessionId", "workflowName", "stepCount", "paused"], (result) => {
            if (result.recording && result.sessionId) {
                updateUI(true, result.workflowName, result.stepCount || 0, result.paused === true);
            } else {
                updateUI(false);
                clearInterval(pollingInterval);
            }
        });
    }, 1000);
}

// Initial state load
async function init() {
    const isOnline = await checkBackendHealth();
    
    chrome.storage.local.get(["recording", "sessionId", "workflowName", "stepCount", "paused"], (result) => {
        const active = result.recording === true && !!result.sessionId;
        updateUI(active, result.workflowName, result.stepCount || 0, result.paused === true);
        if (active) {
            startPollingState();
        }
    });

    // Check API health periodically
    setInterval(checkBackendHealth, 5000);
}

startButton.addEventListener("click", async () => {
    const isOnline = await checkBackendHealth();
    if (!isOnline) return;

    let name = workflowNameInput.value.trim();
    if (!name) name = "Untitled Workflow";
    const app = applicationNameInput.value.trim() || "Chrome";

    startButton.disabled = true;
    startButton.textContent = "Starting...";

    chrome.runtime.sendMessage(
        {
            type: "START_RECORDING",
            name: name,
            application: app
        },
        (response) => {
            startButton.textContent = "Start Capture";
            startButton.disabled = false;

            if (chrome.runtime.lastError || !response || !response.success) {
                console.error("Capture start failed", chrome.runtime.lastError || response);
                alert("Failed to start capture. Make sure backend is running.");
                return;
            }

            updateUI(true, name, 0, false);
            startPollingState();
        }
    );
});

stopButton.addEventListener("click", () => {
    stopButton.disabled = true;
    stopButton.textContent = "Stopping...";

    chrome.runtime.sendMessage(
        {
            type: "STOP_RECORDING"
        },
        (response) => {
            stopButton.textContent = "Complete Capture";
            stopButton.disabled = false;

            if (chrome.runtime.lastError || !response || !response.success) {
                console.error("Capture stop failed", chrome.runtime.lastError || response);
                alert("Failed to stop capture properly.");
                return;
            }

            if (pollingInterval) clearInterval(pollingInterval);
            updateUI(false);
            
            // Open the dashboard to the completed session if returned
            if (response.session && response.session.id) {
                const url = `${cachedBackendUrl}/dashboard/dashboard.html?session_id=${response.session.id}`;
                window.open(url, "_blank");
            }
        }
    );
});

pauseButton.addEventListener("click", () => {
    chrome.storage.local.get(["paused"], (result) => {
        const nextPaused = !result.paused;
        chrome.storage.local.set({ paused: nextPaused }, () => {
            chrome.runtime.sendMessage({ type: "PAUSE_STATE_CHANGED", paused: nextPaused });
            // Retrieve actual steps count
            chrome.storage.local.get(["stepCount", "workflowName"], (res) => {
                updateUI(true, res.workflowName, res.stepCount || 0, nextPaused);
            });
        });
    });
});

captureManualButton.addEventListener("click", () => {
    captureManualButton.disabled = true;
    const origText = captureManualButton.textContent;
    captureManualButton.textContent = "Capturing...";
    
    chrome.runtime.sendMessage({ type: "CAPTURE_MANUAL" }, (response) => {
        captureManualButton.disabled = false;
        captureManualButton.textContent = origText;
        if (chrome.runtime.lastError || !response || !response.success) {
            console.error("Manual capture failed");
            alert("Instant capture failed.");
        }
    });
});

const btnCaptureDesktopPopup = document.getElementById("btnCaptureDesktopPopup");
if (btnCaptureDesktopPopup) {
    btnCaptureDesktopPopup.addEventListener("click", async () => {
        btnCaptureDesktopPopup.disabled = true;
        const orig = btnCaptureDesktopPopup.innerHTML;
        btnCaptureDesktopPopup.innerHTML = "<span>📸</span> Grabbing Dialog...";
        try {
            const { sessionId } = await chrome.storage.local.get(["sessionId"]);
            if (!sessionId) throw new Error("No active session");
            const res = await fetch(`${cachedBackendUrl}/sessions/${sessionId}/capture-desktop-popup`, { method: "POST" });
            const data = await res.json();
            if (data.success) {
                btnCaptureDesktopPopup.innerHTML = "<span>✓</span> Captured Dialog!";
                const { stepCount = 0 } = await chrome.storage.local.get(["stepCount"]);
                await chrome.storage.local.set({ stepCount: stepCount + 1 });
            } else {
                throw new Error(data.message || "Failed");
            }
        } catch(e) {
            btnCaptureDesktopPopup.innerHTML = "<span>❌</span> Failed";
            console.error("Popup capture failed:", e);
        } finally {
            setTimeout(() => {
                btnCaptureDesktopPopup.disabled = false;
                btnCaptureDesktopPopup.innerHTML = orig;
            }, 2500);
        }
    });
}

const btnToggleDiagnostic = document.getElementById("btnToggleDiagnostic");
const diagnosticBody = document.getElementById("diagnosticBody");
if (btnToggleDiagnostic && diagnosticBody) {
    btnToggleDiagnostic.addEventListener("click", () => {
        diagnosticBody.classList.toggle("hidden");
    });
}

const btnCopyGptPrompt = document.getElementById("btnCopyGptPrompt");
if (btnCopyGptPrompt) {
    btnCopyGptPrompt.addEventListener("click", async () => {
        const state = await chrome.storage.local.get(null);
        const gptPrompt = `I am using ProcSnap local SOP documentation engine.
Backend URL: ${cachedBackendUrl}
Active Storage State: ${JSON.stringify(state, null, 2)}
System Status: Checked ports 8000-8005.
Issue description: [Paste your specific issue or error message here].
Please diagnose the issue and provide the exact steps or PowerShell command to resolve it.`;

        try {
            await navigator.clipboard.writeText(gptPrompt);
            const orig = btnCopyGptPrompt.textContent;
            btnCopyGptPrompt.textContent = "✓ Copied for GPT!";
            setTimeout(() => { btnCopyGptPrompt.textContent = orig; }, 2500);
        } catch(e) {
            console.error("Clipboard copy failed:", e);
        }
    });
}

init();