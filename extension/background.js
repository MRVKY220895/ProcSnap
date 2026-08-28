let recording = false;
let currentSessionId = null;
let currentWorkflowName = "";
let currentStepCount = 0;

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
                console.log("ProcSnap extension connected to backend on:", candidate);
                return candidate;
            }
        } catch (_) {}
    }
    return cachedBackendUrl;
}

const pendingClickScreenshots = new Map();


/* =========================================================
   LOAD STATE
========================================================= */

async function loadState() {

    const result = await chrome.storage.local.get([
        "recording",
        "sessionId",
        "workflowName",
        "stepCount"
    ]);

    recording =
        result.recording === true;

    currentSessionId =
        result.sessionId || null;

    currentWorkflowName =
        result.workflowName || "";

    currentStepCount =
        result.stepCount || 0;

    console.log(
        "ProcSnap state loaded:",
        {
            recording,
            sessionId: currentSessionId,
            workflowName: currentWorkflowName,
            stepCount: currentStepCount
        }
    );

    updateExtensionStatus();
}


/* =========================================================
   EXTENSION BADGE
========================================================= */

function updateExtensionStatus() {
    if (recording && currentSessionId) {
        chrome.action.setBadgeText({
            text: String(currentStepCount > 0 ? currentStepCount : "REC")
        });

        chrome.action.setBadgeBackgroundColor({
            color: "#6366f1"
        });

        chrome.action.setTitle({
            title: `ProcSnap - Recording (${currentStepCount} steps)`
        });
    } else {
        chrome.action.setBadgeText({
            text: ""
        });

        chrome.action.setTitle({
            title: "ProcSnap - Ready"
        });
    }
}


async function notifyTabs() {

    const tabs =
        await chrome.tabs.query({});

    const result = await chrome.storage.local.get(["paused"]);
    const isPaused = result.paused === true;

    for (const tab of tabs) {

        if (!tab.id) {
            continue;
        }

        try {

            await chrome.tabs.sendMessage(
                tab.id,
                {
                    type: "RECORDING_STATE_CHANGED",
                    recording: recording,
                    sessionId: currentSessionId,
                    paused: isPaused
                }
            );

        } catch (error) {
            // Ignore restricted pages.
        }
    }
}


/* =========================================================
   START RECORDING
========================================================= */

async function startRecording(name = "Untitled Workflow", application = "Chrome") {

    console.log(
        "ProcSnap: START_RECORDING received",
        { name, application }
    );

    const backendUrl = await getBackendUrl();
    const response = await fetch(
        `${backendUrl}/sessions`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: name,
                application: application
            })
        }
    );

    console.log(
        "Session API response:",
        response.status
    );

    if (!response.ok) {
        throw new Error(
            `Session creation failed: HTTP ${response.status}`
        );
    }

    const data = await response.json();

    console.log(
        "New session:",
        data
    );

    if (
        !data.session ||
        !data.session.id
    ) {
        throw new Error(
            "Backend did not return a session ID"
        );
    }

    currentSessionId = data.session.id;
    currentWorkflowName = data.session.name || name;
    currentStepCount = 0;
    recording = true;

    // Auto-sync native desktop recorder if Desktop app or Windows capture requested
    if (application.toLowerCase().includes("desktop") || application.toLowerCase().includes("windows")) {
        try {
            await fetch(`${backendUrl}/desktop-recorder/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: currentWorkflowName })
            });
            console.log("ProcSnap: Native desktop recorder also started for", currentSessionId);
        } catch (err) {
            console.warn("ProcSnap: Desktop recorder sync notice:", err);
        }
    }

    await chrome.storage.local.set({
        recording: true,
        sessionId: currentSessionId,
        workflowName: currentWorkflowName,
        stepCount: currentStepCount,
        paused: false
    });

    console.log(
        "Recording started:",
        currentSessionId
    );

    updateExtensionStatus();
    await notifyTabs();

    return currentSessionId;
}


/* =========================================================
   STOP RECORDING
========================================================= */

async function stopRecording() {

    const stored =
        await chrome.storage.local.get([
            "recording",
            "sessionId",
            "workflowName"
        ]);

    const sessionId =
        stored.sessionId ||
        currentSessionId;

    console.log(
        "Stopping recording. Session:",
        sessionId
    );

    const backendUrl = await getBackendUrl();

    // Auto-stop native desktop recorder if active
    try {
        await fetch(`${backendUrl}/desktop-recorder/stop`, { method: "POST" });
    } catch (_) {}

    if (!sessionId) {
        recording = false;
        currentSessionId = null;
        currentWorkflowName = "";
        currentStepCount = 0;

        await chrome.storage.local.set({
            recording: false,
            sessionId: null,
            workflowName: "",
            stepCount: 0,
            paused: false
        });

        updateExtensionStatus();
        await notifyTabs();

        return {
            success: true,
            recording: false,
            session: null
        };
    }

    const response = await fetch(
        `${backendUrl}/sessions/${sessionId}/stop`,
        {
            method: "POST"
        }
    );

    console.log(
        "Stop API response:",
        response.status
    );

    if (!response.ok) {
        throw new Error(
            `Session stop failed: HTTP ${response.status}`
        );
    }

    const data = await response.json();

    console.log(
        "Completed session:",
        data
    );

    recording = false;
    currentSessionId = null;
    currentWorkflowName = "";
    currentStepCount = 0;

    await chrome.storage.local.set({
        recording: false,
        sessionId: null,
        workflowName: "",
        stepCount: 0,
        paused: false
    });

    updateExtensionStatus();
    await notifyTabs();

    return data;
}


/* =========================================================
   CAPTURE STEP
========================================================= */

async function captureStep(step, senderTabId = null, senderWindowId = null) {
    const stored = await chrome.storage.local.get([
        "recording",
        "sessionId"
    ]);

    const isRecording = stored.recording === true;
    const sessionId = stored.sessionId;

    console.log(
        "Capture step state:",
        {
            isRecording,
            sessionId,
            action: step?.action,
            screenshotMode: step?._screenshotMode
        }
    );

    if (!isRecording || !sessionId) {
        console.warn("Step ignored - no active recording session");
        return;
    }

    const pauseCheck = await chrome.storage.local.get(["paused"]);
    if (pauseCheck && pauseCheck.paused === true) {
        console.log("ProcSnap: Step ignored because recording is currently PAUSED");
        return;
    }

    const screenshotMode =
        step?._screenshotMode || "after-action";

    const apiStep = { ...step };
    delete apiStep._screenshotMode;
    delete apiStep._screenshotData;

    if (screenshotMode === "after-navigation") {
        await new Promise(resolve => setTimeout(resolve, 900));
    } else if (screenshotMode === "after-action") {
        await new Promise(resolve => setTimeout(resolve, 350));
    }

    const backendUrl = await getBackendUrl();
    const response = await fetch(
        `${backendUrl}/sessions/${sessionId}/steps`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(apiStep)
        }
    );

    if (!response.ok) {
        throw new Error(
            `Step capture failed: HTTP ${response.status}`
        );
    }

    const data = await response.json();
    const stepId = data?.step?.id || null;

    if (stepId) {
        currentStepCount = data.step.sequence || (currentStepCount + 1);
        await chrome.storage.local.set({ stepCount: currentStepCount });
        updateExtensionStatus();
    }

    let image = null;

    if (
        screenshotMode === "before-click" &&
        senderTabId !== null
    ) {
        const pending =
            pendingClickScreenshots.get(senderTabId);

        if (pending) {
            try {
                image = await pending;
            } catch (error) {
                console.warn(
                    "ProcSnap: PRE-CLICK SCREENSHOT FAILED",
                    error
                );
            } finally {
                pendingClickScreenshots.delete(senderTabId);
            }
        }
    }

    if (!image) {
        try {
            const targetWinId = senderWindowId !== null ? senderWindowId : null;
            image = await chrome.tabs.captureVisibleTab(targetWinId, { format: "png" });
        } catch (error) {
            console.warn("ProcSnap: Primary capture failed, trying active window fallback...", error);
            try {
                const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                if (activeTab && activeTab.windowId) {
                    image = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: "png" });
                } else {
                    image = await chrome.tabs.captureVisibleTab(null, { format: "png" });
                }
            } catch (fallbackError) {
                console.error("ProcSnap: VISIBLE TAB SCREENSHOT FAILED", fallbackError);
            }
        }
    }

    if (image && stepId) {
        try {
            const screenshotResponse = await fetch(
                `${backendUrl}/screenshots`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        sessionId,
                        stepId,
                        image
                    })
                }
            );

            if (!screenshotResponse.ok) {
                throw new Error(
                    `Screenshot upload failed: HTTP ${screenshotResponse.status}`
                );
            }

            const screenshotResult =
                await screenshotResponse.json();

            console.log(
                "ProcSnap: SCREENSHOT SAVED",
                screenshotResult
            );

            data.screenshot = screenshotResult;
        } catch (error) {
            console.error(
                "ProcSnap: SCREENSHOT UPLOAD ERROR",
                error
            );
        }
    } else {
        console.warn(
            "ProcSnap: No screenshot available",
            {
                stepId,
                tabId: senderTabId,
                windowId: senderWindowId,
                screenshotMode
            }
        );
    }

    return data;
}


/* =========================================================
   CAPTURE MANUAL SCREENSHOT (Phase 8)
========================================================= */

async function captureManual() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    const url = activeTab ? activeTab.url : "http://localhost";
    const title = activeTab ? activeTab.title : "Manual Capture";
    
    const step = {
        action: "manual_capture",
        timestamp: new Date().toISOString(),
        url: url,
        title: title,
        value: "Captured snapshot manually",
        element: null
    };
    
    const result = await captureStep(step, activeTab ? activeTab.id : null, activeTab ? activeTab.windowId : null);
    return result;
}


/* =========================================================
   MESSAGE HANDLER
========================================================= */

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        console.log(
            "Background message:",
            message.type
        );

        if (message.type === "START_GUIDE_ME") {
            chrome.storage.local.set({
                ps_guide_me_active: true,
                ps_guide_me_workflow: message.workflow,
                ps_guide_me_index: message.startStepIndex || 0
            });
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: "START_GUIDE_ME",
                        workflow: message.workflow,
                        startStepIndex: message.startStepIndex || 0
                    });
                }
            });
            sendResponse({ success: true });
            return false;
        }

        /* -----------------------------------------------
           START
        ------------------------------------------------ */

        if (
            message.type ===
            "START_RECORDING"
        ) {

            startRecording(message.name, message.application)

                .then(
                    (sessionId) => {

                        sendResponse({

                            success: true,

                            recording: true,

                            sessionId:
                                sessionId

                        });

                    }
                )

                .catch(
                    (error) => {

                        console.error(
                            "START FAILED:",
                            error
                        );

                        sendResponse({

                            success: false,

                            recording: false,

                            error:
                                error.message

                        });

                    }
                );

            return true;
        }


        /* -----------------------------------------------
           STOP
        ------------------------------------------------ */

        if (
            message.type ===
            "STOP_RECORDING"
        ) {

            stopRecording()

                .then(
                    (result) => {

                        sendResponse({

                            success: true,

                            recording: false,

                            session:
                                result.session ||
                                null

                        });

                    }
                )

                .catch(
                    (error) => {

                        console.error(
                            "STOP FAILED:",
                            error
                        );

                        sendResponse({

                            success: false,

                            recording: true,

                            error:
                                error.message

                        });

                    }
                );

            return true;
        }


        /* -----------------------------------------------
           GET STATE
        ------------------------------------------------ */

        if (
            message.type ===
            "GET_RECORDING_STATE"
        ) {

            chrome.storage.local.get(
                [
                    "recording",
                    "sessionId"
                ],
                (result) => {

                    const active =
                        result.recording === true &&
                        !!result.sessionId;


                    sendResponse({

                        success: true,

                        recording:
                            active,

                        sessionId:
                            result.sessionId ||
                            null

                    });

                }
            );

            return true;
        }


        /* -----------------------------------------------
           PRE-CLICK SCREENSHOT
        ------------------------------------------------ */

        if (
            message.type ===
            "PREPARE_CLICK_SCREENSHOT"
        ) {
            const tabId = sender?.tab?.id;
            const windowId = sender?.tab?.windowId;

            if (
                tabId !== undefined &&
                tabId !== null &&
                windowId !== undefined &&
                windowId !== null
            ) {
                const capturePromise =
                    chrome.tabs.captureVisibleTab(
                        windowId,
                        { format: "png" }
                    );

                pendingClickScreenshots.set(
                    tabId,
                    capturePromise
                );

                capturePromise.catch(error => {
                    console.warn(
                        "ProcSnap: PRE-CLICK CAPTURE ERROR",
                        error
                    );
                });
            }

            sendResponse({ success: true });
            return false;
        }


        /* -----------------------------------------------
           CAPTURE STEP
        ------------------------------------------------ */

        if (
            message.type ===
            "CAPTURE_STEP"
        ) {

            captureStep(
                message.data,
                sender?.tab?.id ?? null,
                sender?.tab?.windowId ?? null
            )

                .then(
                    (result) => {

                        sendResponse({

                            success: true,

                            result:
                                result

                        });

                    }
                )

                .catch(
                    (error) => {

                        console.error(
                            "CAPTURE FAILED:",
                            error
                        );

                        sendResponse({

                            success: false,

                            error:
                                error.message

                        });

                    }
                );

            return true;
        }

        /* -----------------------------------------------
           PAUSE STATE CHANGED
        ------------------------------------------------ */
        if (message.type === "PAUSE_STATE_CHANGED") {
            notifyTabs();
            return false;
        }

        /* -----------------------------------------------
           UNDO LAST STEP (In-Page Floating HUD)
        ------------------------------------------------ */
        if (message.type === "UNDO_LAST_STEP") {
            (async () => {
                if (!currentSessionId) {
                    sendResponse({ success: false, error: "No active session" });
                    return;
                }
                try {
                    const backendUrl = await getBackendUrl();
                    const res = await fetch(`${backendUrl}/sessions/${currentSessionId}/steps/last`, {
                        method: "DELETE"
                    });
                    const data = await res.json();
                    if (data.success) {
                        currentStepCount = Math.max(0, data.remainingSteps);
                        await chrome.storage.local.set({ stepCount: currentStepCount });
                        updateExtensionStatus();
                        await notifyTabs();
                        sendResponse({ success: true, remainingSteps: currentStepCount });
                    } else {
                        sendResponse({ success: false, message: data.message });
                    }
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
        }

        /* -----------------------------------------------
           FINISH RECORDING & OPEN STUDIO
        ------------------------------------------------ */
        if (message.type === "FINISH_RECORDING") {
            (async () => {
                const sId = currentSessionId;
                try {
                    const session = await stopRecording();
                    const backendUrl = await getBackendUrl();
                    const studioUrl = `${backendUrl}/dashboard/dashboard.html${sId ? `?session_id=${sId}` : ''}`;
                    await chrome.tabs.create({ url: studioUrl });
                    sendResponse({ success: true, studioUrl });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
        }

        /* -----------------------------------------------
           CAPTURE MANUAL
        ------------------------------------------------ */
        if (message.type === "CAPTURE_MANUAL") {
            captureManual()
                .then((result) => {
                    sendResponse({ success: true, result });
                })
                .catch((error) => {
                    console.error("MANUAL CAPTURE FAILED:", error);
                    sendResponse({ success: false, error: error.message });
                });
            return true;
        }

        /* -----------------------------------------------
           🤖 PROCBOT AUTOMATION RELAY TO TARGET TAB
        ------------------------------------------------ */
        if (message.type === "PROCBOT_EXECUTE_STEP") {
            (async () => {
                try {
                    const step = message.step || {};
                    const stepUrl = step.url || "";
                    const isDesktopAction = stepUrl === "app.local" || (step.action || "").includes("desktop");

                    if (isDesktopAction) {
                        sendResponse({ success: true, action: "desktop_simulated", title: step.title || "Desktop Step" });
                        return;
                    }

                    const tabs = await chrome.tabs.query({});
                    const candidateTabs = tabs.filter(t => t.url && !t.url.includes("127.0.0.1:8000/dashboard") && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"));
                    
                    let targetTab = candidateTabs[0];
                    if (stepUrl && stepUrl.startsWith("http")) {
                        try {
                            const stepHost = new URL(stepUrl).hostname;
                            const matched = candidateTabs.find(t => t.url && t.url.includes(stepHost));
                            if (matched) targetTab = matched;
                        } catch (_) {}
                    }

                    if (!targetTab && stepUrl && stepUrl.startsWith("http")) {
                        targetTab = await chrome.tabs.create({ url: stepUrl });
                        await new Promise(r => setTimeout(r, 2000));
                    }

                    if (!targetTab) {
                        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                        targetTab = activeTabs[0];
                    }

                    if (!targetTab || !targetTab.id) {
                        sendResponse({ success: false, error: "No target browser tab found to execute automation step." });
                        return;
                    }

                    try {
                        if (chrome.scripting && chrome.scripting.executeScript) {
                            await chrome.scripting.executeScript({
                                target: { tabId: targetTab.id },
                                files: ["content.js"]
                            });
                        }
                    } catch (_) {}

                    chrome.tabs.sendMessage(targetTab.id, {
                        type: "PROCBOT_EXECUTE_STEP",
                        step: message.step,
                        value: message.value,
                        options: message.options || {}
                    }, (res) => {
                        if (chrome.runtime.lastError) {
                            sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            sendResponse(res || { success: true });
                        }
                    });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
        }

        if (message.type === "PROCBOT_RESUME_MANUAL") {
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(t => {
                    if (t.id) chrome.tabs.sendMessage(t.id, { type: "PROCBOT_RESUME_MANUAL" }).catch(() => {});
                });
            });
            sendResponse({ success: true });
            return false;
        }

        // Fallback for unhandled message types
        sendResponse({ success: false, error: "Unknown message type" });
        return false;
    }
);

// Listen for external messages from dashboard.html origin
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessageExternal) {
    chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
        if (message.type === "PROCBOT_EXECUTE_STEP") {
            (async () => {
                try {
                    const step = message.step || {};
                    const stepUrl = step.url || "";
                    const isDesktopAction = stepUrl === "app.local" || (step.action || "").includes("desktop");

                    if (isDesktopAction) {
                        sendResponse({ success: true, action: "desktop_simulated", title: step.title || "Desktop Step" });
                        return;
                    }

                    const tabs = await chrome.tabs.query({});
                    const candidateTabs = tabs.filter(t => t.url && !t.url.includes("127.0.0.1:8000/dashboard") && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"));
                    
                    let targetTab = candidateTabs[0];
                    if (stepUrl && stepUrl.startsWith("http")) {
                        try {
                            const stepHost = new URL(stepUrl).hostname;
                            const matched = candidateTabs.find(t => t.url && t.url.includes(stepHost));
                            if (matched) targetTab = matched;
                        } catch (_) {}
                    }

                    if (!targetTab && stepUrl && stepUrl.startsWith("http")) {
                        targetTab = await chrome.tabs.create({ url: stepUrl });
                        await new Promise(r => setTimeout(r, 2000));
                    }

                    if (!targetTab || !targetTab.id) {
                        sendResponse({ success: false, error: "No target tab found" });
                        return;
                    }

                    chrome.tabs.sendMessage(targetTab.id, {
                        type: "PROCBOT_EXECUTE_STEP",
                        step: message.step,
                        value: message.value,
                        options: message.options || {}
                    }, (res) => {
                        sendResponse(res || { success: true });
                    });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
        }
    });
}


/* =========================================================
   🌐 MULTI-TAB SEAMLESS TRACKING CONTINUITY
========================================================= */

// When a new tab is opened while recording is active (e.g. clicking target="_blank")
if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.onCreated) {
    chrome.tabs.onCreated.addListener(async (tab) => {
        if (!recording || !currentSessionId) return;
        if (!tab.id || (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")))) return;

        console.log("[ProcSnap] New tab opened during active recording session:", tab.id);
        try {
            if (chrome.scripting && chrome.scripting.executeScript) {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ["content.js"]
                });
            }
            chrome.tabs.sendMessage(tab.id, {
                type: "RECORDING_STATE_CHANGED",
                recording: true,
                paused: false
            }).catch(() => {});
        } catch (e) {
            console.debug("[ProcSnap] Auto-injection on tab creation deferred:", e);
        }
    });
}

// When any tab updates or navigates to a new page while recording is active
if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (!recording || !currentSessionId) return;
        if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://")) {
            try {
                if (chrome.scripting && chrome.scripting.executeScript) {
                    await chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ["content.js"]
                    });
                }
                chrome.tabs.sendMessage(tabId, {
                    type: "RECORDING_STATE_CHANGED",
                    recording: true,
                    paused: false
                }).catch(() => {});
            } catch (e) {
                console.debug("[ProcSnap] Auto-injection on tab update deferred:", e);
            }
        }
    });
}


/* =========================================================
   🖥️ DETECT WHEN USER CLICKS OUTSIDE BROWSER
========================================================= */

let desktopPromptShownForSession = false;

if (typeof chrome !== "undefined" && chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
        const stored = await chrome.storage.local.get(["recording", "sessionId", "desktopAutoCaptureEnabled"]);
        if (!stored.recording || !stored.sessionId) {
            desktopPromptShownForSession = false;
            return;
        }

        // windowId === chrome.windows.WINDOW_ID_NONE indicates focus left Chrome to an external desktop app
        if (windowId === chrome.windows.WINDOW_ID_NONE) {
            console.log("[ProcSnap] Focus moved outside Chrome to external desktop application.");
            const backendUrl = await getBackendUrl();

            if (stored.desktopAutoCaptureEnabled) {
                try {
                    await fetch(`${backendUrl}/desktop-recorder/start`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: "Desktop Interaction" })
                    });
                } catch (_) {}
                return;
            }

            if (!desktopPromptShownForSession) {
                desktopPromptShownForSession = true;
                try {
                    const tabs = await chrome.tabs.query({ active: true });
                    for (const tab of tabs) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: "ASK_DESKTOP_CAPTURE",
                            sessionId: stored.sessionId
                        }).catch(() => {});
                    }
                } catch (_) {}
            }
        }
    });
}

// Background message routing for desktop capture commands
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ENABLE_DESKTOP_CAPTURE") {
        chrome.storage.local.set({ desktopAutoCaptureEnabled: true });
        getBackendUrl().then(backendUrl => {
            fetch(`${backendUrl}/desktop-recorder/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Desktop Application" })
            }).catch(() => {});
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.type === "CAPTURE_DESKTOP_POPUP") {
        const sid = message.sessionId || currentSessionId;
        if (sid) {
            getBackendUrl().then(backendUrl => {
                fetch(`${backendUrl}/sessions/${sid}/capture-desktop-popup`, { method: "POST" })
                    .then(res => res.json())
                    .then(data => sendResponse({ success: true, data }))
                    .catch(err => sendResponse({ success: false, error: err.message }));
            });
            return true;
        }
    }

    if (message.type === "BROWSER_WINDOW_BLURRED") {
        chrome.storage.local.get(["recording", "sessionId", "desktopAutoCaptureEnabled"]).then(stored => {
            if (stored.recording && stored.sessionId && !stored.desktopAutoCaptureEnabled && !desktopPromptShownForSession) {
                desktopPromptShownForSession = true;
                if (sender?.tab?.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: "ASK_DESKTOP_CAPTURE",
                        sessionId: stored.sessionId
                    }).catch(() => {});
                }
            }
        });
        sendResponse({ success: true });
        return true;
    }
});

/* =========================================================
   STARTUP & KEYBOARD SHORTCUTS
========================================================= */

loadState();

if (typeof chrome !== "undefined" && chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
        if (command === "toggle-recording") {
            if (recording) {
                console.log("[ProcSnap] Keyboard shortcut triggered: Stopping recording...");
                await stopRecording();
            } else {
                console.log("[ProcSnap] Keyboard shortcut triggered: Starting recording...");
                await startRecording("Browser Workflow");
            }
        }
    });
}