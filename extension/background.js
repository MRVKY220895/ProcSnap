let recording = false;
let currentSessionId = null;
let currentWorkflowName = "";
let currentStepCount = 0;

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

    const response = await fetch(
        "http://127.0.0.1:8000/sessions",
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
            "sessionId"
        ]);

    const sessionId =
        stored.sessionId ||
        currentSessionId;

    console.log(
        "Stopping recording. Session:",
        sessionId
    );

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
        `http://127.0.0.1:8000/sessions/${sessionId}/stop`,
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

    const response = await fetch(
        `http://127.0.0.1:8000/sessions/${sessionId}/steps`,
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

    if (!image && senderWindowId !== null) {
        try {
            image = await chrome.tabs.captureVisibleTab(
                senderWindowId,
                { format: "png" }
            );
        } catch (error) {
            console.warn(
                "ProcSnap: VISIBLE TAB SCREENSHOT FAILED",
                error
            );
        }
    }

    if (image && stepId) {
        try {
            const screenshotResponse = await fetch(
                "http://127.0.0.1:8000/screenshots",
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
            notifyTabs(); // Broad cast pause state change
            return false;
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

    }
);


/* =========================================================
   STARTUP
========================================================= */

loadState();