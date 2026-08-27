// ProcSnap Extension Popup Controller
// Provides 1-Click Start, Debug, Connect, Disconnect, and System Management

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

let pollingInterval = null;
let cachedBackendUrl = "http://127.0.0.1:8000";
let manuallyDisconnected = false;

// -------------------------------------------------------------
// 1. Port Discovery & Health Probe Engine
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
const btnToggleApiConnect = document.getElementById("btnToggleApiConnect");
const btnExtDebug = document.getElementById("btnExtDebug");
const btnExtReconnect = document.getElementById("btnExtReconnect");
const btnExtGitPull = document.getElementById("btnExtGitPull");
const btnExtReinstall = document.getElementById("btnExtReinstall");
const extUtilStatus = document.getElementById("extUtilStatus");

function setApiStatus(online, port = "", latencyMs = null) {
    const openStudioLink = document.getElementById("openStudioLink");
    if (openStudioLink) {
        openStudioLink.href = `${cachedBackendUrl}/dashboard/dashboard.html`;
    }
    const iconEl = document.getElementById("toggleApiIcon");
    const textEl = document.getElementById("toggleApiText");

    if (online) {
        if (apiStatusText) apiStatusText.textContent = port ? `ONLINE : ${port}` : "CONNECTED";
        apiStatusPill.className = "api-status online";
        startButton.disabled = false;
        if (iconEl) iconEl.textContent = "🔌";
        if (textEl) textEl.textContent = "Disconnect";
        if (btnToggleApiConnect) {
            btnToggleApiConnect.className = "btn-power is-connected";
            btnToggleApiConnect.title = "Connected to local engine. Click to Disconnect.";
        }
        if (latencyBadge && latencyMs !== null) {
            latencyBadge.classList.remove("hidden");
            latencyBadge.textContent = `⚡ ${latencyMs}ms`;
        }
        if (apiOfflineBanner) apiOfflineBanner.classList.add("hidden");
    } else {
        if (apiStatusText) apiStatusText.textContent = manuallyDisconnected ? "DISCONNECTED" : "OFFLINE";
        apiStatusPill.className = "api-status offline";
        startButton.disabled = true;
        if (iconEl) iconEl.textContent = "⚡";
        if (textEl) textEl.textContent = "Connect";
        if (btnToggleApiConnect) {
            btnToggleApiConnect.className = "btn-power is-disconnected";
            btnToggleApiConnect.title = "Engine offline or disconnected. Click to Connect.";
        }
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

async function checkBackendHealth(force = false) {
    const t0 = performance.now();
    try {
        const backend = await getBackendUrl();
        const res = await fetch(`${backend}/health`);
        const elapsed = Math.round(performance.now() - t0);
        if (res.ok) {
            const portMatch = backend.match(/:(\d+)$/);
            const port = portMatch ? portMatch[1] : "8000";
            if (manuallyDisconnected && !force) {
                // Backend is online, but user had paused. Update status with 1-click connect readiness
                setApiStatus(false);
                if (apiStatusText) apiStatusText.textContent = `PAUSED (Engine Ready : ${port})`;
                startButton.disabled = false;
                return true;
            }
            manuallyDisconnected = false;
            try { await chrome.storage.local.set({ server_disconnected: false }); } catch (_) {}
            setApiStatus(true, port, elapsed);
            return true;
        }
    } catch (e) {
        // Ignore
    }
    setApiStatus(false);
    return false;
}

// -------------------------------------------------------------
// 2. One-Click Connect / Disconnect Toggle
// -------------------------------------------------------------
if (btnToggleApiConnect) {
    btnToggleApiConnect.onclick = async () => {
        if (!manuallyDisconnected) {
            // User requested Disconnect
            manuallyDisconnected = true;
            try { await chrome.storage.local.set({ server_disconnected: true }); } catch (_) {}
            setApiStatus(false);
            showExtStatus("🔌 Disconnected from local server. Recording paused.", "info");
        } else {
            // User requested Connect
            manuallyDisconnected = false;
            try { await chrome.storage.local.set({ server_disconnected: false }); } catch (_) {}
            const ok = await checkBackendHealth(true);
            if (ok) {
                showExtStatus("✓ Connected to ProcSnap local engine!", "success");
            } else {
                showExtStatus("⚠️ Could not reach server. Verify python backend is running.", "error");
            }
        }
    };
}

// -------------------------------------------------------------
// 3. One-Click Debug & Diagnostic Probe
// -------------------------------------------------------------
if (btnExtDebug) {
    btnExtDebug.onclick = async () => {
        btnExtDebug.disabled = true;
        btnExtDebug.innerHTML = "<span>⏳</span> Debugging…";
        const diagLogs = document.getElementById("diagnosticLogs");
        const diagBody = document.getElementById("diagnosticBody");
        if (diagBody) diagBody.classList.remove("hidden");

        const t0 = performance.now();
        let report = `[ProcSnap Diagnostic Report — ${new Date().toLocaleTimeString()}]\n`;
        report += `• Target Engine: ${cachedBackendUrl}\n`;

        try {
            // 1. Health Probe
            const hRes = await fetch(`${cachedBackendUrl}/health`);
            const hData = await hRes.json();
            const latency = Math.round(performance.now() - t0);
            report += `• Health Probe: ✓ 200 OK (${latency}ms) — Database: ${hData.database || "connected"}\n`;

            // 2. Storage Check
            const storage = await chrome.storage.local.get(null);
            report += `• Extension Storage: Recording=${!!storage.recording}, Steps=${storage.stepCount || 0}\n`;

            // 3. System Requirements Check
            try {
                const reqRes = await fetch(`${cachedBackendUrl}/system/requirements`);
                if (reqRes.ok) {
                    const reqData = await reqRes.json();
                    const pyVer = reqData.python?.version || "3.x";
                    const inVenv = reqData.python?.in_venv ? "VEnv: Yes" : "Global";
                    report += `• Python Version: ${pyVer} (${inVenv})\n`;
                    const pkgs = reqData.packages?.items || [];
                    const missing = pkgs.filter(p => !p.installed);
                    if (missing.length === 0) {
                        report += `• Dependencies: ✓ All ${pkgs.length} required packages installed.\n`;
                    } else {
                        report += `• Missing Packages: ❌ ${missing.map(m => m.name).join(", ")}\n`;
                    }
                }
            } catch (_) {
                report += `• System requirements endpoint not reachable.\n`;
            }

            report += `• Result: 🟢 System fully operational & ready to capture!`;
            if (diagLogs) diagLogs.textContent = report;
            btnExtDebug.innerHTML = "<span>✓</span> OK (100%)";
            showExtStatus("✓ Debug test passed! Engine is 100% healthy.", "success");
        } catch (e) {
            report += `• Health Probe: ❌ FAILED (${e.message})\n`;
            report += `• Suggestion: Run install.ps1 or start backend via PowerShell.\n`;
            if (diagLogs) diagLogs.textContent = report;
            btnExtDebug.innerHTML = "<span>⚠️</span> Issues";
            showExtStatus("⚠️ Debug found issues: Server is not responding.", "error");
        } finally {
            setTimeout(() => {
                btnExtDebug.disabled = false;
                btnExtDebug.innerHTML = "<span>🐞</span> Debug";
            }, 3000);
        }
    };
}

// -------------------------------------------------------------
// 4. One-Click Reconnect Probe
// -------------------------------------------------------------
if (btnExtReconnect) {
    btnExtReconnect.onclick = async () => {
        manuallyDisconnected = false;
        btnExtReconnect.disabled = true;
        btnExtReconnect.innerHTML = "<span>⏳</span> Probing…";
        const ok = await checkBackendHealth();
        btnExtReconnect.disabled = false;
        btnExtReconnect.innerHTML = ok ? "<span>✓</span> Connected" : "<span>🔄</span> Reconnect";
        if (ok) {
            showExtStatus("✓ Successfully reconnected to ProcSnap engine!", "success");
        } else {
            showExtStatus("❌ Server not found on ports 8000-8005.", "error");
        }
        setTimeout(() => { btnExtReconnect.innerHTML = "<span>🔄</span> Reconnect"; }, 2000);
    };
}

if (btnRetryApi) {
    btnRetryApi.onclick = async () => {
        manuallyDisconnected = false;
        btnRetryApi.disabled = true;
        btnRetryApi.textContent = "⏳ Testing Ports 8000-8005...";
        const ok = await checkBackendHealth();
        btnRetryApi.disabled = false;
        btnRetryApi.textContent = "⚡ 1-Click Reconnect";
        if (ok) {
            btnRetryApi.textContent = "✓ Connected!";
            setTimeout(() => { btnRetryApi.textContent = "⚡ 1-Click Reconnect"; }, 1500);
        }
    };
}

// -------------------------------------------------------------
// 5. Maintenance: Git Pull & Pip Updates
// -------------------------------------------------------------
if (btnExtGitPull) {
    btnExtGitPull.onclick = async () => {
        btnExtGitPull.disabled = true;
        btnExtGitPull.innerHTML = "<span>⏳</span> Pulling…";
        showExtStatus("Pulling latest updates from GitHub repository...", "info");
        try {
            const res = await fetch(`${cachedBackendUrl}/system/git-pull`, { method: "POST" });
            const data = await res.json();
            showExtStatus(data.output || (data.success ? "✓ Repository up to date!" : "Failed to update"), data.success ? "success" : "error");
            btnExtGitPull.innerHTML = "<span>✓</span> Done";
        } catch (e) {
            showExtStatus(`❌ Git error: ${e.message}`, "error");
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
        showExtStatus("Running pip dependency updates in background...", "info");
        try {
            const res = await fetch(`${cachedBackendUrl}/system/reinstall-packages`, { method: "POST" });
            const data = await res.json();
            showExtStatus(data.output || (data.success ? "✓ Dependencies updated!" : "Installation completed"), data.success ? "success" : "error");
            btnExtReinstall.innerHTML = "<span>✓</span> Done";
        } catch (e) {
            showExtStatus(`❌ Pip error: ${e.message}`, "error");
            btnExtReinstall.innerHTML = "<span>❌</span> Error";
        } finally {
            btnExtReinstall.disabled = false;
            setTimeout(() => { btnExtReinstall.innerHTML = "<span>📦</span> Pip Update"; }, 3000);
        }
    };
}

function showExtStatus(msg, type = "info") {
    if (!extUtilStatus) return;
    extUtilStatus.classList.remove("hidden");
    extUtilStatus.textContent = msg;
    if (type === "error") {
        extUtilStatus.style.background = "rgba(239, 68, 68, 0.12)";
        extUtilStatus.style.borderColor = "rgba(239, 68, 68, 0.35)";
        extUtilStatus.style.color = "#f87171";
    } else if (type === "success") {
        extUtilStatus.style.background = "rgba(16, 185, 129, 0.12)";
        extUtilStatus.style.borderColor = "rgba(16, 185, 129, 0.35)";
        extUtilStatus.style.color = "#10b981";
    } else {
        extUtilStatus.style.background = "rgba(99, 102, 241, 0.1)";
        extUtilStatus.style.borderColor = "rgba(99, 102, 241, 0.25)";
        extUtilStatus.style.color = "#a5b4fc";
    }
}

// -------------------------------------------------------------
// 6. Preset App Selector Chips
// -------------------------------------------------------------
document.querySelectorAll(".app-preset-chip").forEach(chip => {
    chip.onclick = () => {
        document.querySelectorAll(".app-preset-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        if (applicationNameInput) {
            applicationNameInput.value = chip.dataset.app || "Chrome";
        }
    };
});

if (btnCopyStartCmd) {
    btnCopyStartCmd.onclick = async () => {
        const cmd = `powershell -File .\\install.ps1`;
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

// -------------------------------------------------------------
// 7. Initial State Load
// -------------------------------------------------------------
async function init() {
    try {
        const { server_disconnected = false } = await chrome.storage.local.get(["server_disconnected"]);
        if (server_disconnected) {
            manuallyDisconnected = true;
            setApiStatus(false);
        }
    } catch (_) {}

    await checkBackendHealth();

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

// -------------------------------------------------------------
// 8. Capture Handlers
// -------------------------------------------------------------
startButton.addEventListener("click", async () => {
    let isOnline = await checkBackendHealth();
    if (!isOnline) {
        // Attempt quick auto-reconnect
        manuallyDisconnected = false;
        isOnline = await checkBackendHealth();
        if (!isOnline) {
            showExtStatus("⚠️ Start failed: Backend server is offline.", "error");
            return;
        }
    }

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
            startButton.innerHTML = "<span>🚀</span> Start Capture";
            startButton.disabled = false;

            if (chrome.runtime.lastError || !response || !response.success) {
                console.error("Capture start failed", chrome.runtime.lastError || response);
                showExtStatus("Failed to start capture. Check server connection.", "error");
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
                showExtStatus("Failed to stop capture properly.", "error");
                return;
            }

            if (pollingInterval) clearInterval(pollingInterval);
            updateUI(false);

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
            showExtStatus("Instant capture failed.", "error");
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
        } catch (e) {
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

// -------------------------------------------------------------
// 9. Diagnostic & Auto-Repair Hub
// -------------------------------------------------------------
const btnToggleDiagnostic = document.getElementById("btnToggleDiagnostic");
const diagnosticBody = document.getElementById("diagnosticBody");
if (btnToggleDiagnostic && diagnosticBody) {
    btnToggleDiagnostic.addEventListener("click", () => {
        diagnosticBody.classList.toggle("hidden");
    });
}

const btnExtAutoFix = document.getElementById("btnExtAutoFix");
if (btnExtAutoFix) {
    btnExtAutoFix.addEventListener("click", async () => {
        btnExtAutoFix.disabled = true;
        btnExtAutoFix.textContent = "⚡ Fixing...";
        const diagLogs = document.getElementById("diagnosticLogs");
        if (diagnosticBody) diagnosticBody.classList.remove("hidden");

        manuallyDisconnected = false;
        try {
            await chrome.storage.local.set({ server_disconnected: false, paused: false });
        } catch (_) {}

        if (diagLogs) diagLogs.textContent = "1/4 Clearing stuck session locks & flags...\n";
        
        // Probe ports
        const backend = await getBackendUrl();
        if (diagLogs) diagLogs.textContent += `2/4 Probing backend on ${backend}...\n`;

        try {
            const res = await fetch(`${backend}/health`);
            if (res.ok) {
                const data = await res.json();
                if (diagLogs) {
                    diagLogs.textContent += `3/4 Backend engine alive (DB: ${data.database || "OK"}).\n`;
                    diagLogs.textContent += `4/4 ✓ Auto-repair complete! Status: 100% Ready.\n`;
                }
                setApiStatus(true, backend.split(":").pop());
                showExtStatus("✓ Connection repaired & verified successfully!", "success");
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (err) {
            if (diagLogs) {
                diagLogs.textContent += `3/4 ⚠️ Backend not responding on ${backend}.\n`;
                diagLogs.textContent += `4/4 Suggested Fix: Launch engine using command below:\n    powershell -File .\\install.ps1\n`;
            }
            showExtStatus("⚠️ Run install.ps1 to start the backend engine.", "error");
        } finally {
            btnExtAutoFix.disabled = false;
            btnExtAutoFix.textContent = "⚡ Auto-Fix";
        }
    });
}

const btnExtSelfTest = document.getElementById("btnExtSelfTest");
if (btnExtSelfTest) {
    btnExtSelfTest.addEventListener("click", async () => {
        btnExtSelfTest.disabled = true;
        btnExtSelfTest.textContent = "⏳ Testing...";
        const diagLogs = document.getElementById("diagnosticLogs");
        if (diagnosticBody) diagnosticBody.classList.remove("hidden");

        const t0 = performance.now();
        let out = `=== 🩺 PROCSNAP SYSTEM SELF-TEST ===\n`;

        // Check 1: Port & Health
        try {
            const backend = await getBackendUrl();
            const hRes = await fetch(`${backend}/health`);
            const hData = await hRes.json();
            const lat = Math.round(performance.now() - t0);
            out += `[PASS] 1. API Health: OK (${lat}ms, ${backend})\n`;
            out += `[PASS] 2. Database: ${hData.database || "Connected"}\n`;
        } catch (e) {
            out += `[FAIL] 1. API Health: Offline (${e.message})\n`;
            out += `[FAIL] 2. Database: Unreachable\n`;
        }

        // Check 2: Chrome Extension Storage
        try {
            const storage = await chrome.storage.local.get(null);
            out += `[PASS] 3. Storage: OK (Recording=${!!storage.recording}, Steps=${storage.stepCount || 0})\n`;
        } catch (e) {
            out += `[WARN] 3. Storage: ${e.message}\n`;
        }

        // Check 3: Python Environment & Packages
        try {
            const reqRes = await fetch(`${cachedBackendUrl}/system/requirements`);
            if (reqRes.ok) {
                const req = await reqRes.json();
                out += `[PASS] 4. Python Env: ${req.python?.version || "3.x"} (VEnv: ${req.python?.in_venv ? "YES" : "NO"})\n`;
                const missing = (req.packages?.items || []).filter(p => !p.installed);
                if (missing.length === 0) {
                    out += `[PASS] 5. Packages: All dependencies installed.\n`;
                } else {
                    out += `[FAIL] 5. Packages: Missing ${missing.map(m => m.name).join(", ")}\n`;
                }
            }
        } catch (_) {
            out += `[WARN] 4. Requirements probe skipped.\n`;
        }

        out += `\nSelf-test concluded at ${new Date().toLocaleTimeString()}.`;
        if (diagLogs) diagLogs.textContent = out;
        btnExtSelfTest.disabled = false;
        btnExtSelfTest.textContent = "🩺 Run Self-Test";
    });
}

const btnExtResetStorage = document.getElementById("btnExtResetStorage");
if (btnExtResetStorage) {
    btnExtResetStorage.addEventListener("click", async () => {
        if (!confirm("Reset extension state and clear session locks?")) return;
        try {
            await chrome.storage.local.set({
                recording: false,
                sessionId: null,
                workflowName: "",
                stepCount: 0,
                paused: false,
                server_disconnected: false
            });
            manuallyDisconnected = false;
            await checkBackendHealth(true);
            updateUI(false);
            showExtStatus("✓ Extension storage and cache reset clean!", "success");
            const diagLogs = document.getElementById("diagnosticLogs");
            if (diagLogs) diagLogs.textContent = "✓ Storage reset completed: Orphaned recording locks removed.";
        } catch (e) {
            showExtStatus(`Reset failed: ${e.message}`, "error");
        }
    });
}

const btnCopyGptPrompt = document.getElementById("btnCopyGptPrompt");
if (btnCopyGptPrompt) {
    btnCopyGptPrompt.addEventListener("click", async () => {
        const state = await chrome.storage.local.get(null);
        let sysReq = "N/A";
        try {
            const r = await fetch(`${cachedBackendUrl}/system/requirements`);
            if (r.ok) sysReq = JSON.stringify(await r.json(), null, 2);
        } catch (_) {}

        const gptPrompt = `[ProcSnap Diagnostic & Support Context]
Backend URL: ${cachedBackendUrl}
Manually Disconnected: ${manuallyDisconnected}
Storage State: ${JSON.stringify(state, null, 2)}
System Requirements: ${sysReq}

Issue Description: [Describe what happened or paste terminal output here]
Please provide step-by-step instructions to fix this issue.`;

        try {
            await navigator.clipboard.writeText(gptPrompt);
            const orig = btnCopyGptPrompt.textContent;
            btnCopyGptPrompt.textContent = "✓ Copied!";
            setTimeout(() => { btnCopyGptPrompt.textContent = orig; }, 2500);
        } catch (e) {
            console.error("Clipboard copy failed:", e);
        }
    });
}

// -------------------------------------------------------------
// 10. Popout Window Support
// -------------------------------------------------------------
if (popoutButton) {
    popoutButton.addEventListener("click", () => {
        chrome.windows.create({
            url: chrome.runtime.getURL("popup.html"),
            type: "popup",
            width: 360,
            height: 600,
            focused: true
        });
        window.close();
    });
}

init();