/* =========================================================
   PROCSNAP - CONTENT SCRIPT
========================================================= */

let recording = false;
let paused = false;

const inputTimers = new WeakMap();
const lastInputValues = new WeakMap();

// Deduplication and capture state
let lastClickTime = 0;
let lastClickElement = null;
let lastScrollTime = 0;
let scrollTimeout = null;
let lastScrollX = window.scrollX;
let lastScrollY = window.scrollY;
let lastKeyPressed = null;

console.log(
    "PROCSNAP CONTENT SCRIPT LOADED",
    window.location.href
);


/* =========================================================
   RECORDING STATE
========================================================= */

function setRecordingState(value, isPaused = false) {
    recording = value === true;
    paused = isPaused === true;

    console.log(
        "PROCSNAP RECORDING STATE:",
        { recording, paused }
    );

    if (recording) {
        createRecordingIndicator();
    } else {
        removeRecordingIndicator();
    }
}


/* =========================================================
   INITIAL STATE
========================================================= */

chrome.storage.local.get(
    ["recording", "sessionId", "paused"],
    (result) => {
        console.log(
            "PROCSNAP INITIAL STATE:",
            result
        );

        setRecordingState(
            result.recording === true && !!result.sessionId,
            result.paused === true
        );
    }
);


/* =========================================================
   STORAGE STATE CHANGE
========================================================= */

chrome.storage.onChanged.addListener(
    (changes) => {
        chrome.storage.local.get(["recording", "sessionId", "stepCount", "paused"], (res) => {
            const active = res.recording === true && !!res.sessionId;
            const isPaused = res.paused === true;
            const steps = res.stepCount || 0;

            if (changes.recording || changes.paused) {
                setRecordingState(active, isPaused);
            } else if (changes.stepCount && recording) {
                updateIndicatorStyle(steps, isPaused);
            }
        });
    }
);


/* =========================================================
   BACKGROUND STATE CHANGE
========================================================= */

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
        if (
            message.type ===
            "RECORDING_STATE_CHANGED"
        ) {
            setRecordingState(
                message.recording === true,
                message.paused === true
            );
            if (typeof sendResponse === "function") {
                sendResponse({ success: true });
            }
            return false;
        }
        if (typeof sendResponse === "function") {
            sendResponse({ success: true });
        }
        return false;
    }
);


/* =========================================================
   RECORDING INDICATOR
========================================================= */

function createRecordingIndicator() {
    if (
        document.getElementById(
            "procsnap-recording-indicator"
        )
    ) {
        // Just update style if it already exists
        chrome.storage.local.get(["stepCount", "paused"], (res) => {
            updateIndicatorStyle(res.stepCount || 0, res.paused === true);
        });
        return;
    }

    chrome.storage.local.get(["stepCount", "paused"], (res) => {
        const steps = res.stepCount || 0;
        const isPaused = res.paused === true;
        paused = isPaused;

        const container = document.createElement("div");
        container.id = "procsnap-recording-indicator";
        container.style.position = "fixed";
        container.style.bottom = "16px";
        container.style.left = "50%";
        container.style.transform = "translateX(-50%)";
        container.style.zIndex = "2147483647";
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.gap = "6px";
        container.style.padding = "5px 10px";
        container.style.borderRadius = "20px";
        container.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif";
        container.style.fontSize = "11px";
        container.style.fontWeight = "600";
        container.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";
        container.style.border = "1px solid rgba(255,255,255,0.08)";
        container.style.pointerEvents = "none";
        container.style.opacity = "0.75";
        container.style.transition = "opacity 0.2s, background 0.2s";

        // Fade out after 3s of no interaction, restore on hover
        container.addEventListener("mouseenter", () => container.style.opacity = "1");
        container.addEventListener("mouseleave", () => container.style.opacity = "0.75");

        const dot = document.createElement("div");
        dot.id = "procsnap-indicator-dot";
        dot.style.width = "7px";
        dot.style.height = "7px";
        dot.style.borderRadius = "50%";
        dot.style.flexShrink = "0";

        const text = document.createElement("span");
        text.id = "procsnap-indicator-text";

        container.appendChild(dot);
        container.appendChild(text);
        document.documentElement.appendChild(container);

        updateIndicatorStyle(steps, isPaused);
    });
}

function updateIndicatorStyle(steps, isPaused) {
    const container = document.getElementById("procsnap-recording-indicator");
    const dot = document.getElementById("procsnap-indicator-dot");
    const text = document.getElementById("procsnap-indicator-text");

    if (!container || !dot || !text) return;

    if (isPaused) {
        container.style.background = "#151821";
        container.style.color = "#9ca3af";
        dot.style.background = "#eab308"; // yellow
        dot.style.boxShadow = "none";
        text.textContent = `Paused — ${steps} step${steps === 1 ? "" : "s"}`;
        
        // Remove animation
        dot.getAnimations().forEach(a => a.cancel());
    } else {
        container.style.background = "#0f111a";
        container.style.color = "#ffffff";
        dot.style.background = "#ef4444"; // red
        dot.style.boxShadow = "0 0 0 3px rgba(239, 68, 68, 0.3)";
        text.textContent = `Capturing — ${steps} step${steps === 1 ? "" : "s"}`;
        
        // Add pulsing animation
        dot.animate([
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(1.3)', opacity: 0.5 },
            { transform: 'scale(1)', opacity: 1 }
        ], {
            duration: 1500,
            iterations: Infinity
        });
    }
}

function removeRecordingIndicator() {
    const indicator =
        document.getElementById(
            "procsnap-recording-indicator"
        );

    if (indicator) {
        indicator.remove();
    }
}


/* =========================================================
   ACTIONABLE ELEMENT
========================================================= */

function getActionableElement(element) {
    if (!element) {
        return null;
    }

    if (
        element instanceof SVGElement
    ) {
        const parent =
            element.closest(
                "button, a, input, textarea, select, [role='button'], [role='link']"
            );

        if (parent) {
            return parent;
        }
    }

    return element;
}


/* =========================================================
   CSS SELECTOR
========================================================= */

function getCssSelector(element) {
    if (!element) {
        return null;
    }

    if (element.id) {
        return `#${CSS.escape(element.id)}`;
    }

    const testId =
        element.getAttribute("data-testid");

    if (testId) {
        return `[data-testid="${CSS.escape(testId)}"]`;
    }

    const name =
        element.getAttribute("name");

    if (name) {
        return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    }

    const ariaLabel =
        element.getAttribute("aria-label");

    if (ariaLabel) {
        return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
    }

    let current = element;
    const path = [];

    while (
        current &&
        current !== document.body &&
        current.nodeType === Node.ELEMENT_NODE
    ) {
        let selector =
            current.tagName.toLowerCase();

        const classes =
            Array.from(current.classList || [])
                .filter(Boolean)
                .slice(0, 2);

        if (classes.length) {
            selector +=
                "." +
                classes
                    .map(c => CSS.escape(c))
                    .join(".");
        }

        const parent =
            current.parentElement;

        if (parent) {
            const siblings =
                Array.from(parent.children)
                    .filter(
                        child =>
                            child.tagName ===
                            current.tagName
                    );

            if (siblings.length > 1) {
                selector +=
                    `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
        }

        path.unshift(selector);
        current =
            current.parentElement;
    }

    return path.join(" > ");
}


/* =========================================================
   XPATH
========================================================= */

function getXPath(element) {
    if (!element) {
        return null;
    }

    if (element.id) {
        return `//*[@id="${element.id}"]`;
    }

    const parts = [];
    let current = element;

    while (
        current &&
        current.nodeType === Node.ELEMENT_NODE
    ) {
        let index = 1;
        let sibling =
            current.previousElementSibling;

        while (sibling) {
            if (
                sibling.tagName ===
                current.tagName
            ) {
                index++;
            }

            sibling =
                sibling.previousElementSibling;
        }

        parts.unshift(
            `${current.tagName.toLowerCase()}[${index}]`
        );

        current =
            current.parentElement;
    }

    return "/" + parts.join("/");
}


/* =========================================================
   ELEMENT INFORMATION
========================================================= */

function getElementInfo(element) {
    if (!element) return null;
    
    return {
        tagName:
            element.tagName || null,

        id:
            element.id || null,

        className:
            typeof element.className === "string"
                ? element.className
                : null,

        text:
            element.innerText
                ? element.innerText
                    .trim()
                    .substring(0, 300)
                : null,

        name:
            element.getAttribute("name") || null,

        placeholder:
            element.getAttribute("placeholder") || null,

        type:
            element.getAttribute("type") || null,

        ariaLabel:
            element.getAttribute("aria-label") || null,

        role:
            element.getAttribute("role") || null,

        title:
            element.getAttribute("title") || null,

        dataTestId:
            element.getAttribute("data-testid") || null,

        cssSelector:
            getCssSelector(element),
        xpath:
            getXPath(element),

        screen: (() => {
            try {
                const rect = element.getBoundingClientRect();
                return {
                    x: Number(rect.left.toFixed(2)),
                    y: Number(rect.top.toFixed(2)),
                    width: Number(rect.width.toFixed(2)),
                    height: Number(rect.height.toFixed(2)),
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio || 1
                };
            } catch {
                return null;
            }
        })()
    };
}


/* =========================================================
   SEND STEP
========================================================= */

function sendStep(step) {
    if (!recording || paused) {
        console.log(
            "PROCSNAP: STEP IGNORED - NOT RECORDING OR PAUSED"
        );
        return;
    }

    console.log(
        "PROCSNAP: CAPTURING STEP",
        step
    );

    chrome.runtime.sendMessage(
        {
            type: "CAPTURE_STEP",
            data: step
        },
        (response) => {
            if (chrome.runtime.lastError) {
                console.error(
                    "PROCSNAP SEND STEP ERROR:",
                    chrome.runtime.lastError.message
                );
                return;
            }

            console.log(
                "PROCSNAP STEP RESPONSE:",
                response
            );
        }
    );
}


/* =========================================================
   PRE-CLICK SCREENSHOT
   Captures the exact page before navigation/default click handling.
========================================================= */

document.addEventListener(
    "mousedown",
    (event) => {
        if (!recording || paused || event.button !== 0) {
            return;
        }

        const element = getActionableElement(event.target);
        if (!element) {
            return;
        }

        const indicator = document.getElementById(
            "procsnap-recording-indicator"
        );

        if (indicator) {
            indicator.style.visibility = "hidden";
            indicator.style.opacity = "0";
        }

        chrome.runtime.sendMessage(
            { type: "PREPARE_CLICK_SCREENSHOT" },
            () => {
                if (chrome.runtime.lastError) {
                    console.warn(
                        "PROCSNAP PRE-CLICK SCREENSHOT:",
                        chrome.runtime.lastError.message
                    );
                }

                if (indicator && document.contains(indicator)) {
                    indicator.style.visibility = "visible";
                    indicator.style.opacity = "1";
                }
            }
        );
    },
    true
);


/* =========================================================
   CLICK
========================================================= */

document.addEventListener(
    "click",
    (event) => {
        if (!recording || paused) {
            return;
        }

        const element = getActionableElement(event.target);
        if (!element) {
            return;
        }

        // Deduplication logic
        const clickTime = Date.now();
        if (lastClickElement === element && (clickTime - lastClickTime) < 400) {
            console.log("PROCSNAP: Click ignored (deduplicated)");
            return;
        }
        lastClickTime = clickTime;
        lastClickElement = element;

        const step = {
            action: "click",
            timestamp: new Date().toISOString(),
            url: window.location.href,
            title: document.title,
            value: null,
            clickPoint: {
                x: Number(event.clientX.toFixed(2)),
                y: Number(event.clientY.toFixed(2))
            },
            element: getElementInfo(element),
            _screenshotMode: "before-click"
        };

        sendStep(step);
    },
    true
);


/* =========================================================
   INPUT
========================================================= */

document.addEventListener(
    "input",
    (event) => {
        if (!recording || paused) {
            return;
        }

        const element = event.target;

        if (
            !(element instanceof HTMLInputElement) &&
            !(element instanceof HTMLTextAreaElement)
        ) {
            return;
        }

        if (inputTimers.has(element)) {
            clearTimeout(inputTimers.get(element));
        }

        const timer = setTimeout(
            () => {
                saveInput(element);
                inputTimers.delete(element);
            },
            600
        );

        inputTimers.set(element, timer);
    },
    true
);


/* =========================================================
   SAVE INPUT
========================================================= */

function saveInput(element) {
    if (!recording || paused) {
        return;
    }

    let value = element.value || "";

    if (
        element instanceof HTMLInputElement &&
        element.type === "password"
    ) {
        value = "[REDACTED]";
    }

    if (
        lastInputValues.has(element) &&
        lastInputValues.get(element) === value
    ) {
        return;
    }

    lastInputValues.set(element, value);

    const step = {
        action: "input",
        timestamp: new Date().toISOString(),
        url: window.location.href,
        title: document.title,
        value: value,
        element: getElementInfo(element)
    };

    sendStep(step);
}


/* =========================================================
   KEYBOARD & KEYBOARD SHORTCUTS
========================================================= */

document.addEventListener(
    "keydown",
    (event) => {
        // Track last key pressed for focus context
        if (event.key === "Tab") {
            lastKeyPressed = "Tab";
        } else {
            lastKeyPressed = null;
        }

        if (!recording || paused) {
            return;
        }

        const element = event.target;

        // Enter key input save trigger
        if (event.key === "Enter") {
            if (
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement
            ) {
                if (inputTimers.has(element)) {
                    clearTimeout(inputTimers.get(element));
                    inputTimers.delete(element);
                }
                saveInput(element);
            }
        }

        // Capture keyboard shortcuts (Modifier key combos or function keys)
        const isModifier = event.ctrlKey || event.altKey || event.metaKey;
        const isSpecialKey = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Escape", "Tab"].includes(event.key);

        if (isModifier || isSpecialKey) {
            if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;

            const keys = [];
            if (event.ctrlKey) keys.push("Ctrl");
            if (event.altKey) keys.push("Alt");
            if (event.shiftKey) keys.push("Shift");
            if (event.metaKey) keys.push("Meta");
            keys.push(event.key);

            const combo = keys.join("+");

            sendStep({
                action: "keyboard_shortcut",
                timestamp: new Date().toISOString(),
                url: window.location.href,
                title: document.title,
                value: combo,
                element: getElementInfo(getActionableElement(element))
            });
        }
    },
    true
);


/* =========================================================
   BLUR
========================================================= */

document.addEventListener(
    "blur",
    (event) => {
        if (!recording || paused) {
            return;
        }

        const element = event.target;

        if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
        ) {
            if (inputTimers.has(element)) {
                clearTimeout(inputTimers.get(element));
                inputTimers.delete(element);
            }
            saveInput(element);
        }
    },
    true
);


/* =========================================================
   SELECT / CHECKBOX / RADIO
========================================================= */

document.addEventListener(
    "change",
    (event) => {
        if (!recording || paused) {
            return;
        }

        const element = event.target;

        if (element instanceof HTMLSelectElement) {
            const option = element.options[element.selectedIndex];

            sendStep({
                action: "select",
                timestamp: new Date().toISOString(),
                url: window.location.href,
                title: document.title,
                value: element.value,
                selectedText: option ? option.text : null,
                element: getElementInfo(element)
            });
            return;
        }

        if (
            element instanceof HTMLInputElement &&
            (element.type === "checkbox" || element.type === "radio")
        ) {
            sendStep({
                action: element.type === "checkbox" ? "checkbox" : "radio",
                timestamp: new Date().toISOString(),
                url: window.location.href,
                title: document.title,
                value: element.value,
                checked: element.checked,
                element: getElementInfo(element)
            });
        }
    },
    true
);


/* =========================================================
   RIGHT CLICK / CONTEXT MENU
========================================================= */

document.addEventListener(
    "contextmenu",
    (event) => {
        if (!recording || paused) {
            return;
        }

        const element = getActionableElement(event.target);
        if (!element) {
            return;
        }

        sendStep({
            action: "right_click",
            timestamp: new Date().toISOString(),
            url: window.location.href,
            title: document.title,
            value: null,
            element: getElementInfo(element)
        });
    },
    true
);


/* =========================================================
   FOCUS
========================================================= */

document.addEventListener(
    "focus",
    (event) => {
        if (!recording || paused) {
            return;
        }

        const element = event.target;
        if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLButtonElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement ||
            element.getAttribute("role") === "button"
        ) {
            // Only log focus if triggered by keyboard Tab navigation
            if (lastKeyPressed === "Tab") {
                sendStep({
                    action: "focus",
                    timestamp: new Date().toISOString(),
                    url: window.location.href,
                    title: document.title,
                    value: null,
                    element: getElementInfo(element)
                });
                lastKeyPressed = null;
            }
        }
    },
    true
);


/* =========================================================
   SCROLL (Debounced)
========================================================= */

window.addEventListener(
    "scroll",
    () => {
        if (!recording || paused) {
            return;
        }

        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        scrollTimeout = setTimeout(() => {
            const dx = window.scrollX - lastScrollX;
            const dy = window.scrollY - lastScrollY;

            // Only log substantial scrolls (> 100px)
            if (Math.abs(dx) > 100 || Math.abs(dy) > 100) {
                let direction = "down";
                if (Math.abs(dy) > Math.abs(dx)) {
                    direction = dy > 0 ? "down" : "up";
                } else {
                    direction = dx > 0 ? "right" : "left";
                }

                sendStep({
                    action: "scroll",
                    timestamp: new Date().toISOString(),
                    url: window.location.href,
                    title: document.title,
                    value: `Scrolled ${direction}`,
                    element: null
                });
            }

            lastScrollX = window.scrollX;
            lastScrollY = window.scrollY;
        }, 1500);
    },
    true
);


/* =========================================================
   NAVIGATION
========================================================= */

let lastUrl = window.location.href;
let lastNavTime = 0;

function checkNavigation() {
    if (!recording || paused) {
        return;
    }

    const currentUrl = window.location.href;

    if (currentUrl !== lastUrl) {
        const now = Date.now();
        // Deduplicate rapid navigation triggers (within 200ms)
        if (now - lastNavTime < 200) {
            lastUrl = currentUrl;
            return;
        }
        lastNavTime = now;

        const previousUrl = lastUrl;
        lastUrl = currentUrl;

        sendStep({
            action: "navigation",
            timestamp: new Date().toISOString(),
            previousUrl: previousUrl,
            url: currentUrl,
            title: document.title,
            _screenshotMode: "after-navigation"
        });
    }
}

const originalPushState = history.pushState;
history.pushState = function () {
    const result = originalPushState.apply(this, arguments);
    setTimeout(checkNavigation, 50);
    return result;
};

const originalReplaceState = history.replaceState;
history.replaceState = function () {
    const result = originalReplaceState.apply(this, arguments);
    setTimeout(checkNavigation, 50);
    return result;
};

window.addEventListener(
    "popstate",
    () => {
        setTimeout(checkNavigation, 50);
    }
);

setInterval(checkNavigation, 500);


/* =========================================================
   TANGO-STYLE "GUIDE ME" LIVE IN-BROWSER OVERLAY ENGINE
========================================================= */

let guideMeActive = false;
let guideMeWorkflow = null;
let guideMeStepIndex = 0;
let currentTargetEl = null;

// Listen for window messages (from dashboard) or runtime messages (from background)
window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "START_GUIDE_ME") {
        initGuideMe(event.data.workflow, 0);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "START_GUIDE_ME") {
        initGuideMe(message.workflow, message.startStepIndex || 0);
        if (typeof sendResponse === "function") sendResponse({ success: true });
        return false;
    } else if (message.type === "GUIDE_ME_NEXT") {
        advanceGuideMeStep(1);
        if (typeof sendResponse === "function") sendResponse({ success: true });
        return false;
    } else if (message.type === "GUIDE_ME_PREV") {
        advanceGuideMeStep(-1);
        if (typeof sendResponse === "function") sendResponse({ success: true });
        return false;
    } else if (message.type === "GUIDE_ME_STOP") {
        teardownGuideMe();
        if (typeof sendResponse === "function") sendResponse({ success: true });
        return false;
    }
});

// Restore Guide Me state if persisted across navigations
chrome.storage.local.get(["ps_guide_me_active", "ps_guide_me_workflow", "ps_guide_me_index"], (res) => {
    if (res.ps_guide_me_active && res.ps_guide_me_workflow) {
        initGuideMe(res.ps_guide_me_workflow, res.ps_guide_me_index || 0, false);
    }
});

function initGuideMe(wf, stepIdx = 0, shouldSaveStorage = true) {
    if (!wf || !wf.steps || wf.steps.length === 0) return;
    guideMeActive = true;
    guideMeWorkflow = wf;
    guideMeStepIndex = Math.max(0, Math.min(wf.steps.length - 1, stepIdx));

    if (shouldSaveStorage) {
        chrome.storage.local.set({
            ps_guide_me_active: true,
            ps_guide_me_workflow: wf,
            ps_guide_me_index: guideMeStepIndex
        });
    }

    renderGuideMeBar();
    renderGuideMeSpotlight();
}

function advanceGuideMeStep(delta = 1) {
    if (!guideMeActive || !guideMeWorkflow) return;
    const newIdx = guideMeStepIndex + delta;
    if (newIdx >= 0 && newIdx < guideMeWorkflow.steps.length) {
        guideMeStepIndex = newIdx;
        chrome.storage.local.set({ ps_guide_me_index: guideMeStepIndex });
        renderGuideMeBar();
        renderGuideMeSpotlight();
    } else if (newIdx >= guideMeWorkflow.steps.length) {
        showGuideMeCelebration();
    }
}

function teardownGuideMe() {
    guideMeActive = false;
    guideMeWorkflow = null;
    chrome.storage.local.remove(["ps_guide_me_active", "ps_guide_me_workflow", "ps_guide_me_index"]);

    const bar = document.getElementById("procsnap-guide-bar");
    if (bar) bar.remove();

    const spotlight = document.getElementById("procsnap-guide-spotlight");
    if (spotlight) spotlight.remove();

    const beacon = document.getElementById("procsnap-guide-beacon");
    if (beacon) beacon.remove();
}

function renderGuideMeBar() {
    let bar = document.getElementById("procsnap-guide-bar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "procsnap-guide-bar";
        bar.style.cssText = `
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            background: rgba(15, 23, 42, 0.94);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(99, 102, 241, 0.4);
            border-radius: 14px;
            box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6), 0 0 20px rgba(99, 102, 241, 0.25);
            padding: 14px 18px;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            width: min(520px, 92vw);
            box-sizing: border-box;
            user-select: none;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        `;
        document.body.appendChild(bar);
    }

    const steps = guideMeWorkflow.steps;
    const step = steps[guideMeStepIndex];
    const total = steps.length;
    const isFirst = guideMeStepIndex === 0;
    const isLast = guideMeStepIndex === total - 1;

    bar.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; font-weight: 800; font-size: 11px; padding: 2px 8px; border-radius: 12px;">
                    STEP ${guideMeStepIndex + 1} OF ${total}
                </span>
                <span style="font-size: 12px; color: #94a3b8; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px;">
                    ${escapeHtml(guideMeWorkflow.name || "Live Guide")}
                </span>
            </div>
            <button id="ps-gm-close" style="background: rgba(255,255,255,0.08); border: none; color: #94a3b8; width: 22px; height: 22px; border-radius: 50%; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; line-height: 1;" title="Exit Guide Me">✕</button>
        </div>
        <div style="font-size: 14px; font-weight: 700; color: #ffffff; margin-bottom: 4px; line-height: 1.3;">
            ${escapeHtml(step.title || `Action ${guideMeStepIndex + 1}`)}
        </div>
        ${step.description && step.description !== step.title ? `
            <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.4;">
                ${escapeHtml(step.description)}
            </div>
        ` : '<div style="height: 8px;"></div>'}
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <button id="ps-gm-pulse" style="background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                🎯 Spotlight
            </button>
            <div style="display: flex; gap: 6px;">
                <button id="ps-gm-prev" ${isFirst ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : 'style="cursor: pointer;"'} style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 600;">
                    ← Prev
                </button>
                <button id="ps-gm-next" style="background: #6366f1; border: none; color: #fff; border-radius: 6px; padding: 4px 14px; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);">
                    ${isLast ? "Finish ✓" : "Next →"}
                </button>
            </div>
        </div>
    `;

    document.getElementById("ps-gm-close").onclick = teardownGuideMe;
    document.getElementById("ps-gm-prev").onclick = () => advanceGuideMeStep(-1);
    document.getElementById("ps-gm-next").onclick = () => advanceGuideMeStep(1);
    document.getElementById("ps-gm-pulse").onclick = renderGuideMeSpotlight;
}

function findTargetElement(step) {
    if (!step) return null;
    
    // 1. Try CSS selector if present
    if (step.element && step.element.cssSelector) {
        try {
            const el = document.querySelector(step.element.cssSelector);
            if (el && el.offsetParent !== null) return el;
        } catch (_) {}
    }

    // 2. Try XPath if present
    if (step.element && step.element.xpath) {
        try {
            const result = document.evaluate(
                step.element.xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            if (result && result.singleNodeValue && result.singleNodeValue.offsetParent !== null) {
                return result.singleNodeValue;
            }
        } catch (_) {}
    }

    // 3. Fallback: match by inner text or button value
    if (step.title) {
        const words = step.title.replace(/^(Click|Type|Press|Select)\s+/i, "").trim();
        if (words.length > 2) {
            const allClickables = document.querySelectorAll("button, a, input, [role='button']");
            for (const el of allClickables) {
                if (el.textContent && el.textContent.trim().toLowerCase().includes(words.toLowerCase())) {
                    return el;
                }
            }
        }
    }

    return null;
}

function renderGuideMeSpotlight() {
    const step = guideMeWorkflow.steps[guideMeStepIndex];
    currentTargetEl = findTargetElement(step);

    let spotlight = document.getElementById("procsnap-guide-spotlight");
    if (spotlight) spotlight.remove();

    let beacon = document.getElementById("procsnap-guide-beacon");
    if (beacon) beacon.remove();

    if (!currentTargetEl) return;

    // Scroll element smoothly to center of viewport
    try {
        currentTargetEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    } catch (_) {}

    const updatePosition = () => {
        if (!currentTargetEl || !guideMeActive) return;
        const rect = currentTargetEl.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        let s = document.getElementById("procsnap-guide-spotlight");
        if (!s) {
            s = document.createElement("div");
            s.id = "procsnap-guide-spotlight";
            s.style.cssText = `
                position: fixed;
                z-index: 2147483640;
                pointer-events: none;
                border-radius: 8px;
                border: 3px solid #6366f1;
                box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45), 0 0 25px #6366f1;
                transition: all 0.25s ease-out;
            `;
            document.body.appendChild(s);
        }

        s.style.top = `${Math.max(0, rect.top - 4)}px`;
        s.style.left = `${Math.max(0, rect.left - 4)}px`;
        s.style.width = `${rect.width + 8}px`;
        s.style.height = `${rect.height + 8}px`;

        // Add floating pulsating beacon pointer
        let b = document.getElementById("procsnap-guide-beacon");
        if (!b) {
            b = document.createElement("div");
            b.id = "procsnap-guide-beacon";
            b.style.cssText = `
                position: fixed;
                z-index: 2147483645;
                pointer-events: none;
                width: 20px;
                height: 20px;
                background: #6366f1;
                border: 2px solid #ffffff;
                border-radius: 50%;
                box-shadow: 0 0 16px rgba(99, 102, 241, 0.8);
                transform: translate(-50%, -50%);
                animation: psBeaconPulse 1.2s infinite;
            `;
            document.body.appendChild(b);
        }

        b.style.top = `${rect.top + rect.height / 2}px`;
        b.style.left = `${rect.left + rect.width / 2}px`;
    };

    setTimeout(updatePosition, 250);
    window.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition, { passive: true });

    // Auto-advance on click
    const clickHandler = () => {
        advanceGuideMeStep(1);
        currentTargetEl.removeEventListener("click", clickHandler);
    };
    currentTargetEl.addEventListener("click", clickHandler, { once: true });
}

function showGuideMeCelebration() {
    let bar = document.getElementById("procsnap-guide-bar");
    if (bar) {
        bar.innerHTML = `
            <div style="text-align: center; padding: 8px;">
                <div style="font-size: 28px; margin-bottom: 4px;">🎉</div>
                <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 4px;">
                    Workflow Completed!
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">
                    You successfully completed all steps in <strong>${escapeHtml(guideMeWorkflow.name || "this guide")}</strong>.
                </div>
                <button id="ps-gm-finish" style="background: #10b981; border: none; color: #fff; border-radius: 8px; padding: 6px 20px; font-size: 13px; font-weight: 700; cursor: pointer;">
                    Done
                </button>
            </div>
        `;
        document.getElementById("ps-gm-finish").onclick = teardownGuideMe;
    }
    const spotlight = document.getElementById("procsnap-guide-spotlight");
    if (spotlight) spotlight.remove();
    const beacon = document.getElementById("procsnap-guide-beacon");
    if (beacon) beacon.remove();
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, (m) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[m]));
}