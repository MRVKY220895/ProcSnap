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

const apiOfflineBanner = document.getElementById("api-offline-banner");
const btnRetryApi = document.getElementById("btnRetryApi");
const btnCopyStartCmd = document.getElementById("btnCopyStartCmd");

function setApiStatus(online, port = "") {
    const openStudioLink = document.getElementById("openStudioLink");
    if (openStudioLink) {
        openStudioLink.href = `${cachedBackendUrl}/dashboard/dashboard.html`;
    }
    if (online) {
        apiStatusPill.textContent = port ? `Online (Port ${port})` : "API Connected";
        apiStatusPill.className = "api-status online";
        startButton.disabled = false;
        if (apiOfflineBanner) apiOfflineBanner.classList.add("hidden");
    } else {
        apiStatusPill.textContent = "API Offline";
        apiStatusPill.className = "api-status offline";
        startButton.disabled = true;
        if (apiOfflineBanner) apiOfflineBanner.classList.remove("hidden");
    }
}

async function checkBackendHealth() {
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

if (btnRetryApi) {
    btnRetryApi.onclick = async () => {
        btnRetryApi.disabled = true;
        btnRetryApi.textContent = "⏳ Testing Ports 8000-8005...";
        const ok = await checkBackendHealth();
        btnRetryApi.disabled = false;
        btnRetryApi.textContent = "🔄 Retry Connection";
        if (ok) {
            btnRetryApi.textContent = "✓ Connected!";
            setTimeout(() => { btnRetryApi.textContent = "🔄 Retry Connection"; }, 1500);
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

if (popoutButton) {
    popoutButton.addEventListener("click", () => {
        chrome.windows.create({
            url: chrome.runtime.getURL("popup.html?pinned=1"),
            type: "popup",
            width: 360,
            height: 520
        });
    });
}

init();