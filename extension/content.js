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
        if (!message || !message.type) {
            if (typeof sendResponse === "function") sendResponse({ success: false });
            return false;
        }

        if (message.type === "RECORDING_STATE_CHANGED") {
            setRecordingState(
                message.recording === true,
                message.paused === true
            );
            if (typeof sendResponse === "function") sendResponse({ success: true });
            return false;
        } else if (message.type === "START_GUIDE_ME") {
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

        if (typeof sendResponse === "function") sendResponse({ success: true });
        return false;
    }
);


/* =========================================================
   🎈 IN-PAGE FLOATING RECORDING HUD (Tango/Scribe Standard)
========================================================= */

function createRecordingIndicator() {
    if (document.getElementById("procsnap-recording-indicator")) {
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
        container.style.bottom = "24px";
        container.style.left = "24px";
        container.style.zIndex = "2147483647";
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.gap = "8px";
        container.style.padding = "6px 12px";
        container.style.borderRadius = "999px";
        container.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        container.style.fontSize = "12px";
        container.style.fontWeight = "700";
        container.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.15)";
        container.style.background = "rgba(15, 23, 42, 0.94)";
        container.style.backdropFilter = "blur(12px)";
        container.style.webkitBackdropFilter = "blur(12px)";
        container.style.pointerEvents = "auto";
        container.style.userSelect = "none";
        container.style.transition = "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)";

        // Live dot
        const dot = document.createElement("div");
        dot.id = "procsnap-indicator-dot";
        dot.style.width = "8px";
        dot.style.height = "8px";
        dot.style.borderRadius = "50%";
        dot.style.flexShrink = "0";

        // Step count text
        const text = document.createElement("span");
        text.id = "procsnap-indicator-text";
        text.style.color = "#ffffff";
        text.style.marginRight = "4px";

        // Divider
        const divider = document.createElement("div");
        divider.style.width = "1px";
        divider.style.height = "16px";
        divider.style.background = "rgba(255,255,255,0.2)";

        // Button style helper
        const makeBtn = (label, title, bg, color) => {
            const b = document.createElement("button");
            b.innerHTML = label;
            b.title = title;
            b.style.border = "none";
            b.style.background = bg;
            b.style.color = color;
            b.style.fontSize = "11px";
            b.style.fontWeight = "700";
            b.style.padding = "4px 8px";
            b.style.borderRadius = "6px";
            b.style.cursor = "pointer";
            b.style.display = "inline-flex";
            b.style.alignItems = "center";
            b.style.gap = "4px";
            b.style.transition = "transform 0.1s, opacity 0.15s";
            b.onmouseenter = () => b.style.opacity = "0.85";
            b.onmouseleave = () => b.style.opacity = "1";
            b.onmousedown = () => b.style.transform = "scale(0.94)";
            b.onmouseup = () => b.style.transform = "scale(1)";
            return b;
        };

        // Undo last step button
        const undoBtn = makeBtn("↶ Undo", "Undo last captured click", "rgba(255,255,255,0.12)", "#f8fafc");
        undoBtn.id = "procsnap-hud-undo-btn";
        undoBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: "UNDO_LAST_STEP" }, (res) => {
                if (res && res.success) {
                    text.textContent = `${res.remainingSteps} step${res.remainingSteps === 1 ? '' : 's'}`;
                }
            });
        };

        // Pause/Resume button
        const pauseBtn = makeBtn("⏸ Pause", "Pause or resume recording", "rgba(255,255,255,0.12)", "#f8fafc");
        pauseBtn.id = "procsnap-hud-pause-btn";
        pauseBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.storage.local.get(["paused"], (res) => {
                const nextPaused = !res.paused;
                chrome.storage.local.set({ paused: nextPaused }, () => {
                    chrome.runtime.sendMessage({ type: "PAUSE_STATE_CHANGED" });
                });
            });
        };

        // Finish button
        const finishBtn = makeBtn("✓ Complete", "Finish SOP and open Studio editor", "linear-gradient(135deg, #10b981, #059669)", "#ffffff");
        finishBtn.id = "procsnap-hud-finish-btn";
        finishBtn.style.padding = "4px 10px";
        finishBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            finishBtn.textContent = "Finishing...";
            chrome.runtime.sendMessage({ type: "FINISH_RECORDING" });
        };

        container.appendChild(dot);
        container.appendChild(text);
        container.appendChild(divider);
        container.appendChild(undoBtn);
        container.appendChild(pauseBtn);
        container.appendChild(finishBtn);

        document.documentElement.appendChild(container);
        updateIndicatorStyle(steps, isPaused);
    });
}

function updateIndicatorStyle(steps, isPaused) {
    const container = document.getElementById("procsnap-recording-indicator");
    const dot = document.getElementById("procsnap-indicator-dot");
    const text = document.getElementById("procsnap-indicator-text");
    const pauseBtn = document.getElementById("procsnap-hud-pause-btn");

    if (!container || !dot || !text) return;

    if (isPaused) {
        dot.style.background = "#eab308";
        dot.style.boxShadow = "none";
        text.textContent = `Paused (${steps})`;
        if (pauseBtn) pauseBtn.innerHTML = "▶ Resume";
        dot.getAnimations().forEach(a => a.cancel());
    } else {
        dot.style.background = "#ef4444";
        dot.style.boxShadow = "0 0 0 3px rgba(239, 68, 68, 0.35)";
        text.textContent = `${steps} step${steps === 1 ? "" : "s"}`;
        if (pauseBtn) pauseBtn.innerHTML = "⏸ Pause";
        
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
    const indicator = document.getElementById("procsnap-recording-indicator");
    if (indicator) indicator.remove();
}


/* =========================================================
   ACTIONABLE ELEMENT
========================================================= */

function getActionableElement(element) {
    if (!element) return null;

    // NEVER capture clicks or interactions on the ProcSnap recording widget or HUD controls
    if (
        element.id === "procsnap-recording-indicator" ||
        element.closest("#procsnap-recording-indicator") ||
        element.closest(".procsnap-hud-btn") ||
        element.classList?.contains("procsnap-hud-btn")
    ) {
        return null;
    }

    // Check if clicked element or any parent is an anchor, button, input, etc.
    const actionable = element.closest(
        "a[href], button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [role='menuitem'], summary, [contenteditable='true']"
    );
    if (actionable) {
        return actionable;
    }

    if (element instanceof SVGElement) {
        const svgParent = element.closest("svg")?.parentElement;
        if (svgParent) return svgParent;
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
    
    // Extract nearest human label (for non-technical users)
    let cleanLabel = null;
    if (element.id) {
        const associatedLabel = document.querySelector(`label[for="${element.id}"]`);
        if (associatedLabel && associatedLabel.innerText) cleanLabel = associatedLabel.innerText.trim();
    }
    if (!cleanLabel) {
        const parentLabel = element.closest("label");
        if (parentLabel && parentLabel.innerText) cleanLabel = parentLabel.innerText.trim();
    }
    if (!cleanLabel && element.getAttribute("aria-label")) {
        cleanLabel = element.getAttribute("aria-label").trim();
    }
    if (!cleanLabel && element.getAttribute("placeholder")) {
        cleanLabel = element.getAttribute("placeholder").trim();
    }
    if (!cleanLabel && element.getAttribute("title")) {
        cleanLabel = element.getAttribute("title").trim();
    }
    if (!cleanLabel && element.innerText && element.innerText.length < 60) {
        cleanLabel = element.innerText.trim();
    }
    if (!cleanLabel && element.value && typeof element.value === "string" && element.value.length < 40) {
        cleanLabel = element.value.trim();
    }

    const isPasswordOrSensitive = element.getAttribute("type") === "password" ||
        element.getAttribute("autocomplete") === "cc-number" ||
        element.getAttribute("data-private") === "true";

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

        cleanLabel: cleanLabel || null,
        isSensitive: isPasswordOrSensitive,

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

        const elemInfo = getElementInfo(element);
        let smartTitle = "";

        // Smart Identification for Links, Buttons, and Inputs
        const isAnchor = element.tagName === "A" || element.closest("a");
        const anchorEl = element.tagName === "A" ? element : element.closest("a");

        if (isAnchor && anchorEl) {
            const href = anchorEl.getAttribute("href") || anchorEl.href;
            const linkText = (anchorEl.innerText || anchorEl.textContent || "").trim();
            if (linkText && linkText.length < 60) {
                smartTitle = `Click link "${linkText}"`;
            } else if (href) {
                try {
                    const parsed = new URL(href, window.location.href);
                    smartTitle = `Navigate to ${parsed.hostname}${parsed.pathname !== '/' ? parsed.pathname : ''}`;
                } catch {
                    smartTitle = `Click link "${href}"`;
                }
            } else {
                smartTitle = `Click link`;
            }
        } else {
            const targetName = elemInfo?.cleanLabel || elemInfo?.ariaLabel || (elemInfo?.text && elemInfo.text.length < 50 ? elemInfo.text : null) || elemInfo?.placeholder || elemInfo?.tagName?.toLowerCase() || "item";
            smartTitle = `Click on "${targetName}"`;
        }

        const step = {
            action: "click",
            timestamp: new Date().toISOString(),
            url: window.location.href,
            title: smartTitle,
            value: null,
            clickPoint: {
                x: Number(event.clientX.toFixed(2)),
                y: Number(event.clientY.toFixed(2))
            },
            element: elemInfo,
            _screenshotMode: "before-click"
        };

        sendStep(step);
    },
    true
);


/* =========================================================
   INPUT (SMART DEBOUNCED TYPING)
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
            !(element instanceof HTMLTextAreaElement) &&
            !element.isContentEditable
        ) {
            return;
        }

        if (inputTimers.has(element)) {
            clearTimeout(inputTimers.get(element));
        }

        // Wait 1.5s after user stops typing to commit the full string
        const timer = setTimeout(
            () => {
                saveInput(element);
                inputTimers.delete(element);
            },
            1500
        );

        inputTimers.set(element, timer);
    },
    true
);


/* =========================================================
   SAVE INPUT
========================================================= */

function saveInput(element) {
    if (!recording || paused || !element) {
        return;
    }

    let value = element.isContentEditable ? (element.innerText || "") : (element.value || "");
    value = value.trim();

    if (!value) {
        return;
    }

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

    const elemInfo = getElementInfo(element);
    const label = elemInfo?.cleanLabel || elemInfo?.placeholder || elemInfo?.name || "the field";
    const valDisplay = elemInfo?.isSensitive ? "••••••••" : value;
    const smartTitle = `Type "${valDisplay}" into ${label}`;

    const step = {
        action: "input",
        timestamp: new Date().toISOString(),
        url: window.location.href,
        title: smartTitle,
        value: value,
        element: elemInfo
    };

    sendStep(step);
}


/* =========================================================
   KEYBOARD & ENTER KEY CAPTURE
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

        // Enter key input save & explicit submit action
        if (event.key === "Enter") {
            if (
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                element.isContentEditable
            ) {
                // 1. Immediately flush typed text
                if (inputTimers.has(element)) {
                    clearTimeout(inputTimers.get(element));
                    inputTimers.delete(element);
                }
                saveInput(element);

                // 2. Capture the Enter key action
                const elemInfo = getElementInfo(element);
                const label = elemInfo?.cleanLabel || elemInfo?.placeholder || elemInfo?.name || "field";
                
                setTimeout(() => {
                    sendStep({
                        action: "keypress_enter",
                        timestamp: new Date().toISOString(),
                        url: window.location.href,
                        title: `Press Enter in ${label}`,
                        value: "Enter",
                        element: elemInfo
                    });
                }, 150);
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
                title: `Press ${combo}`,
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

/* =========================================================
   🖥️ AUTO-DETECT & ASK WHEN CLICKING OUTSIDE BROWSER
========================================================= */

let desktopPromptActive = false;

function showDesktopCapturePrompt(sessionId) {
    if (desktopPromptActive || document.getElementById("procsnap-desktop-prompt")) return;
    desktopPromptActive = true;

    const promptEl = document.createElement("div");
    promptEl.id = "procsnap-desktop-prompt";
    promptEl.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: #182234;
        border: 1.5px solid #38bdf8;
        border-radius: 14px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.75);
        padding: 16px 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff;
        max-width: 390px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: procsnapFadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    promptEl.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 12px;">
            <div style="font-size: 26px; line-height: 1;">🖥️</div>
            <div style="flex: 1;">
                <div style="font-size: 13.5px; font-weight: 800; color: #38bdf8; margin-bottom: 3px;">Clicked Outside Browser?</div>
                <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.45;">
                    You interacted with an external desktop application (Excel, SAP, File Explorer). Would you like to capture your desktop actions in this SOP?
                </div>
            </div>
        </div>
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px;">
            <button id="ps-btn-dismiss-desktop" style="background: transparent; color: #94a3b8; border: none; padding: 5px 8px; font-size: 11.5px; cursor: pointer; border-radius: 6px;">✕ Dismiss</button>
            <button id="ps-btn-snap-once" style="background: rgba(255,255,255,0.08); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.2); padding: 5px 10px; border-radius: 6px; font-weight: 600; font-size: 11.5px; cursor: pointer;">📸 Grab This Step</button>
            <button id="ps-btn-enable-desktop" style="background: linear-gradient(135deg, #0284c7, #38bdf8); color: #fff; border: none; padding: 6px 13px; border-radius: 6px; font-weight: 700; font-size: 11.5px; cursor: pointer; box-shadow: 0 4px 12px rgba(56,189,248,0.35);">✓ Auto-Capture Desktop</button>
        </div>
    `;

    document.body.appendChild(promptEl);

    document.getElementById("ps-btn-enable-desktop")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "ENABLE_DESKTOP_CAPTURE", sessionId });
        promptEl.remove();
        desktopPromptActive = false;
        showToastNotification("✓ Desktop auto-capture enabled! Clicks outside Chrome are now recorded.");
    });

    document.getElementById("ps-btn-snap-once")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "CAPTURE_DESKTOP_POPUP", sessionId });
        promptEl.remove();
        desktopPromptActive = false;
        showToastNotification("📸 Desktop screenshot captured as next step!");
    });

    document.getElementById("ps-btn-dismiss-desktop")?.addEventListener("click", () => {
        promptEl.remove();
        desktopPromptActive = false;
    });
}

function showToastNotification(text) {
    const toast = document.createElement("div");
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: #0f172a;
        color: #38bdf8;
        border: 1px solid rgba(56,189,248,0.4);
        padding: 8px 18px;
        border-radius: 999px;
        font-family: sans-serif;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    `;
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Window blur listener to detect focus loss to outside applications
window.addEventListener("blur", () => {
    if (!recording || paused) return;
    chrome.runtime.sendMessage({ type: "BROWSER_WINDOW_BLURRED" }).catch(() => {});
});

// Runtime message listener for desktop prompt
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "ASK_DESKTOP_CAPTURE") {
        showDesktopCapturePrompt(msg.sessionId);
        sendResponse({ success: true });
        return true;
    } else if (msg?.type === "PROCBOT_EXECUTE_STEP") {
        executeProcBotInPageStep(msg.step, msg.value, msg.options)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    } else if (msg?.type === "PROCBOT_RESUME_MANUAL") {
        removeProcBotManualHUD();
        sendResponse({ success: true });
        return true;
    }
});

/* =========================================================
   🤖 PROCBOT IN-PAGE RPA AUTOMATION ENGINE
========================================================= */

let procBotManualResolve = null;

async function executeProcBotInPageStep(step, dynamicValue, options = {}) {
    if (!step) return { success: false, error: "No step provided" };

    const act = (step.action || "").toLowerCase();
    const title = step.edited_title || step.title || "Step";
    const val = dynamicValue !== undefined ? dynamicValue : (step.value || "");
    const isManualPause = step.manual_pause || step._manualPause || act === "manual_pause" || act === "manual_task";
    const retryCount = parseInt(step.retry_count || options.retry_count || 1, 10);
    const onFail = step.on_failure || options.on_failure || "abort";

    // 1. Handle Manual Stop / Action Prompt
    if (isManualPause) {
        return new Promise(resolve => {
            procBotManualResolve = resolve;
            showProcBotManualHUD(title, step.manual_instructions || step.note || "Please complete this action manually on the page, then click Continue.");
        });
    }

    // 2. Navigation Step
    if (act.includes("navigate") || act.includes("page_load")) {
        const targetUrl = step.url || "";
        if (targetUrl && !window.location.href.includes(targetUrl)) {
            window.location.href = targetUrl;
            return { success: true, action: "navigate", url: targetUrl };
        }
        return { success: true, action: "navigate_noop" };
    }

    // 3. URL Assertion Step
    if (act === "assert_url" || (act.startsWith("assert") && step.assert_type === "url")) {
        const expectedUrl = val || step.expected || "";
        const currentUrl = window.location.href;
        const passed = currentUrl.toLowerCase().includes(expectedUrl.toLowerCase());
        if (!passed && onFail === "abort") {
            return { success: false, assertion_passed: false, error: `URL assertion failed: Expected URL to contain "${expectedUrl}", but got "${currentUrl}"` };
        }
        return { success: true, assertion_passed: passed, expected: expectedUrl, actual: currentUrl };
    }

    // 4. Retry Loop for Element Actions
    let lastError = null;
    for (let attempt = 1; attempt <= Math.max(1, retryCount); attempt++) {
        try {
            // Find Target Element using multi-tier strategy + AI Self-Healing
            let targetEl = findTargetElement(step);
            let healedInfo = null;

            if (!targetEl) {
                // Trigger AI Self-Healing Fallback
                try {
                    const interactiveSnippet = Array.from(document.querySelectorAll("button, input, select, textarea, a, [role='button'], h1, h2, h3, .btn"))
                        .slice(0, 35)
                        .map(el => el.outerHTML.slice(0, 220))
                        .join("\n");
                    
                    const healRes = await fetch("http://127.0.0.1:8000/procbot/heal-selector", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            step_title: title,
                            action: act,
                            failed_selector: step.custom_selector || (step.element && step.element.cssSelector),
                            original_text: (step.element && (step.element.text || step.element.ariaLabel)) || title,
                            dom_snippet: interactiveSnippet
                        })
                    }).catch(() => null);

                    if (healRes && healRes.ok) {
                        const healData = await healRes.json();
                        if (healData.status === "healed" && healData.healed_selector) {
                            try {
                                if (healData.strategy === "xpath") {
                                    const xr = document.evaluate(healData.healed_selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                                    if (xr && xr.singleNodeValue) targetEl = xr.singleNodeValue;
                                } else {
                                    targetEl = document.querySelector(healData.healed_selector);
                                }
                                if (targetEl) {
                                    healedInfo = healData;
                                    console.log(`[ProcBot AI Self-Healing] Successfully healed selector for "${title}" -> ${healData.healed_selector} (${healData.engine})`);
                                }
                            } catch (_) {}
                        }
                    }
                } catch (_) {}
            }

            // Assertion: Hidden Check
            if (act === "assert_hidden" || (act.startsWith("assert") && step.assert_type === "hidden")) {
                const isHidden = !targetEl || targetEl.offsetParent === null;
                if (!isHidden && onFail === "abort") {
                    return { success: false, assertion_passed: false, error: `Element expected to be hidden, but is still visible: ${title}` };
                }
                return { success: true, assertion_passed: isHidden };
            }

            if (!targetEl) {
                if (attempt < retryCount) {
                    await new Promise(r => setTimeout(r, 800));
                    continue;
                }
                if (options.ignoreNotFound || onFail === "skip") {
                    return { success: true, skipped: true, warning: `Element not found (skipped): ${title}` };
                }
                return { success: false, error: `Element not found: ${title}` };
            }

            // Scroll into view smoothly & highlight
            try {
                targetEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
            } catch (_) {}

            highlightProcBotElement(targetEl);
            await new Promise(r => setTimeout(r, 200));

            // Assertion: Visible Check
            if (act === "assert_visible" || (act.startsWith("assert") && step.assert_type === "visible")) {
                const isVisible = targetEl && targetEl.offsetParent !== null;
                return { success: true, assertion_passed: isVisible };
            }

            // Assertion: Text or Value Check
            if (act.startsWith("assert") || act === "verify" || act === "check") {
                const assertType = step.assert_type || (act.includes("value") ? "value" : "text");
                const expected = (val || step.expected || "").trim().toLowerCase();
                const actual = (assertType === "value" ? (targetEl.value || "") : (targetEl.textContent || targetEl.innerText || "")).trim();
                const passed = actual.toLowerCase().includes(expected);
                if (!passed && onFail === "abort") {
                    return { success: false, assertion_passed: false, error: `Assertion failed: Expected "${expected}", but got "${actual}"` };
                }
                return { success: true, assertion_passed: passed, expected, actual, healed: healedInfo };
            }

            // Data Extraction Action
            if (act === "extract") {
                const extractAttr = step.extract_attr || "text";
                const extractVar = step.extract_var || `var_${title.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 24)}`;
                let extractedVal = "";
                if (extractAttr === "text") {
                    extractedVal = (targetEl.textContent || targetEl.innerText || "").trim();
                } else if (extractAttr === "value") {
                    extractedVal = (targetEl.value || "").trim();
                } else {
                    extractedVal = (targetEl.getAttribute(extractAttr) || "").trim();
                }
                return {
                    success: true,
                    action: "extract",
                    extracted_key: extractVar,
                    extracted_value: extractedVal,
                    healed: healedInfo
                };
            }

            // Standard DOM Actions (Select, Input, Click, DblClick, Enter)
            if (act in { select: 1, dropdown: 1 } || targetEl.tagName === "SELECT") {
                if (targetEl.tagName === "SELECT") {
                    let matched = false;
                    for (let i = 0; i < targetEl.options.length; i++) {
                        const opt = targetEl.options[i];
                        if (opt.text.trim().toLowerCase() === val.toLowerCase() || opt.value.toLowerCase() === val.toLowerCase()) {
                            targetEl.selectedIndex = i;
                            matched = true;
                            break;
                        }
                    }
                    if (!matched && targetEl.options.length > 0) {
                        const num = parseInt(val, 10);
                        if (!isNaN(num) && num < targetEl.options.length) {
                            targetEl.selectedIndex = num;
                        }
                    }
                    targetEl.dispatchEvent(new Event("change", { bubbles: true }));
                    targetEl.dispatchEvent(new Event("input", { bubbles: true }));
                } else {
                    targetEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                    await new Promise(r => setTimeout(r, 250));
                    const options = Array.from(document.querySelectorAll("[role='option'], li, .dropdown-item, .select-option, option"));
                    const targetOpt = options.find(o => o.textContent && o.textContent.trim().toLowerCase().includes(val.toLowerCase()));
                    if (targetOpt) {
                        targetOpt.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                    }
                }
            } else if (["input", "change", "textarea_input", "type"].includes(act) || targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable) {
                targetEl.focus();
                if (targetEl.isContentEditable) {
                    targetEl.innerText = val;
                } else {
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        "value"
                    )?.set || Object.getOwnPropertyDescriptor(
                        window.HTMLTextAreaElement.prototype,
                        "value"
                    )?.set;

                    if (nativeInputValueSetter) {
                        nativeInputValueSetter.call(targetEl, val);
                    } else {
                        targetEl.value = val;
                    }
                }
                targetEl.dispatchEvent(new Event("input", { bubbles: true }));
                targetEl.dispatchEvent(new Event("change", { bubbles: true }));
                targetEl.dispatchEvent(new Event("blur", { bubbles: true }));
            } else if (act === "dblclick" || act === "double_click") {
                targetEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
            } else if (act === "keypress_enter" || act === "enter") {
                targetEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
                targetEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
            } else {
                targetEl.focus();
                targetEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
                targetEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            }

            return { success: true, action: act, title, healed: healedInfo };
        } catch (e) {
            lastError = e;
            if (attempt < retryCount) {
                await new Promise(r => setTimeout(r, 800));
            }
        }
    }

    if (onFail === "skip") {
        return { success: true, skipped: true, warning: `Failed after retries (skipped): ${lastError?.message}` };
    }
    return { success: false, error: lastError ? lastError.message : "Step execution failed" };
}

function highlightProcBotElement(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let ring = document.getElementById("procbot-action-ring");
    if (!ring) {
        ring = document.createElement("div");
        ring.id = "procbot-action-ring";
        ring.style.cssText = `
            position: fixed;
            z-index: 2147483640;
            pointer-events: none;
            border-radius: 8px;
            border: 3px solid #10b981;
            box-shadow: 0 0 25px rgba(16, 185, 129, 0.8), inset 0 0 10px rgba(16, 185, 129, 0.4);
            transition: all 0.2s ease-out;
        `;
        document.body.appendChild(ring);
    }
    ring.style.top = `${Math.max(0, rect.top - 4)}px`;
    ring.style.left = `${Math.max(0, rect.left - 4)}px`;
    ring.style.width = `${rect.width + 8}px`;
    ring.style.height = `${rect.height + 8}px`;

    setTimeout(() => {
        if (ring) ring.remove();
    }, 1200);
}

function showProcBotManualHUD(title, instructions) {
    removeProcBotManualHUD();

    const hud = document.createElement("div");
    hud.id = "procbot-manual-hud";
    hud.style.cssText = `
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 2147483647;
        background: #182234;
        border: 2px solid #fbbf24;
        border-radius: 14px;
        padding: 16px 20px;
        box-shadow: 0 25px 60px rgba(0,0,0,0.85);
        color: #fff;
        max-width: 420px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: procsnapFadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    hud.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">✋</span>
                <strong style="font-size: 13.5px; color: #fbbf24; font-weight: 800;">ProcBot: Manual Action Required</strong>
            </div>
            <span style="font-size: 10px; background: rgba(251,191,36,0.2); color: #fbbf24; padding: 2px 6px; border-radius: 4px; font-weight: 700;">PAUSED</span>
        </div>
        <div style="font-size: 12px; font-weight: 600; color: #e2e8f0;">${title}</div>
        <div style="font-size: 11.5px; color: #94a3b8; line-height: 1.45; background: rgba(0,0,0,0.25); padding: 8px 10px; border-radius: 6px; border-left: 3px solid #fbbf24;">
            ${instructions}
        </div>
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px;">
            <button id="procbot-btn-resume-inpage" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; padding: 7px 16px; border-radius: 8px; font-weight: 800; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 15px rgba(16,185,129,0.35);">
                ▶️ Done, Continue Bot
            </button>
        </div>
    `;

    document.body.appendChild(hud);

    document.getElementById("procbot-btn-resume-inpage")?.addEventListener("click", () => {
        removeProcBotManualHUD();
        if (procBotManualResolve) {
            procBotManualResolve({ success: true, manualCompleted: true });
            procBotManualResolve = null;
        }
    });
}

function removeProcBotManualHUD() {
    const existing = document.getElementById("procbot-manual-hud");
    if (existing) existing.remove();
}

// ── ProcBot Live Point-and-Click Selector Inspector ──────────────────────────
let procBotPickerActive = false;
let procBotPickerStepIdx = null;
let procBotPickerOverlay = null;
let procBotPickerTooltip = null;
let procBotPickerBar = null;

function computeOptimalSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    
    // Check ID
    if (el.id && !/^[0-9]/.test(el.id) && !el.id.includes(":") && !el.id.includes(".")) {
        return `#${el.id}`;
    }
    // Check unique data attributes
    const testAttrs = ["data-testid", "data-test", "data-qa", "name", "aria-label", "placeholder"];
    for (const attr of testAttrs) {
        const val = el.getAttribute(attr);
        if (val) {
            const sel = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
            try {
                if (document.querySelectorAll(sel).length === 1) return sel;
            } catch (_) {}
        }
    }
    // Check button or link with text
    const text = (el.innerText || el.textContent || "").trim();
    if (["button", "a"].includes(el.tagName.toLowerCase()) && text && text.length < 30) {
        return `${el.tagName.toLowerCase()}:has-text("${text.replace(/"/g, '\\"')}")`;
    }
    // Check unique classes
    if (el.className && typeof el.className === "string") {
        const classes = el.className.split(/\s+/).filter(c => c && !c.includes(":") && !c.startsWith("procbot") && !c.startsWith("procsnap"));
        if (classes.length > 0) {
            const sel = `${el.tagName.toLowerCase()}.${classes.slice(0, 2).map(c => CSS.escape(c)).join(".")}`;
            try {
                if (document.querySelectorAll(sel).length === 1) return sel;
            } catch (_) {}
        }
    }
    // Structural nth-of-type path fallback
    let path = [];
    let curr = el;
    while (curr && curr.nodeType === Node.ELEMENT_NODE && curr.tagName.toLowerCase() !== "html") {
        let tag = curr.tagName.toLowerCase();
        if (curr.id && !/^[0-9]/.test(curr.id)) {
            path.unshift(`#${curr.id}`);
            break;
        }
        let sibling = curr;
        let nth = 1;
        while ((sibling = sibling.previousElementSibling)) {
            if (sibling.tagName.toLowerCase() === tag) nth++;
        }
        path.unshift(`${tag}:nth-of-type(${nth})`);
        curr = curr.parentElement;
        if (path.length >= 4) break;
    }
    return path.join(" > ");
}

function startProcBotSelectorPicker(stepIdx) {
    if (procBotPickerActive) stopProcBotSelectorPicker();
    procBotPickerActive = true;
    procBotPickerStepIdx = stepIdx;

    // Top instruction bar
    procBotPickerBar = document.createElement("div");
    procBotPickerBar.id = "procbot-picker-bar";
    procBotPickerBar.style.cssText = `
        position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
        background: linear-gradient(135deg, #0f172a, #1e293b); color: #38bdf8;
        border: 2px solid #38bdf8; border-radius: 30px; padding: 8px 22px;
        font-family: system-ui, sans-serif; font-size: 13px; font-weight: 800;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(56,189,248,0.4);
        z-index: 2147483647; display: flex; align-items: center; gap: 12px;
        pointer-events: auto; cursor: default; user-select: none;
    `;
    procBotPickerBar.innerHTML = `
        <span>🎯 <strong>ProcBot Inspector:</strong> Hover &amp; Click any element to capture selector</span>
        <button id="btn-cancel-procbot-picker" style="background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 700; cursor: pointer;">✕ Cancel (ESC)</button>
    `;
    document.body.appendChild(procBotPickerBar);

    document.getElementById("btn-cancel-procbot-picker")?.addEventListener("click", stopProcBotSelectorPicker);

    // Hover Highlight Box
    procBotPickerOverlay = document.createElement("div");
    procBotPickerOverlay.id = "procbot-picker-overlay";
    procBotPickerOverlay.style.cssText = `
        position: fixed; pointer-events: none; border: 2px solid #38bdf8;
        background: rgba(56,189,248,0.18); border-radius: 4px; z-index: 2147483646;
        transition: all 0.06s ease; display: none; box-shadow: 0 0 15px rgba(56,189,248,0.5);
    `;
    document.body.appendChild(procBotPickerOverlay);

    // Tooltip
    procBotPickerTooltip = document.createElement("div");
    procBotPickerTooltip.id = "procbot-picker-tooltip";
    procBotPickerTooltip.style.cssText = `
        position: fixed; pointer-events: none; background: #0b0f19; color: #fff;
        border: 1px solid rgba(56,189,248,0.5); border-radius: 6px; padding: 4px 8px;
        font-family: monospace; font-size: 11px; font-weight: 700; z-index: 2147483647;
        display: none; box-shadow: 0 4px 15px rgba(0,0,0,0.6);
    `;
    document.body.appendChild(procBotPickerTooltip);

    document.addEventListener("mousemove", onProcBotPickerMouseMove, true);
    document.addEventListener("click", onProcBotPickerClick, true);
    document.addEventListener("keydown", onProcBotPickerKeyDown, true);
}

function stopProcBotSelectorPicker() {
    procBotPickerActive = false;
    procBotPickerStepIdx = null;
    if (procBotPickerBar) procBotPickerBar.remove();
    if (procBotPickerOverlay) procBotPickerOverlay.remove();
    if (procBotPickerTooltip) procBotPickerTooltip.remove();
    document.removeEventListener("mousemove", onProcBotPickerMouseMove, true);
    document.removeEventListener("click", onProcBotPickerClick, true);
    document.removeEventListener("keydown", onProcBotPickerKeyDown, true);
}

function onProcBotPickerMouseMove(e) {
    if (!procBotPickerActive) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === procBotPickerBar || procBotPickerBar?.contains(target) || target === procBotPickerOverlay || target === procBotPickerTooltip) return;

    const rect = target.getBoundingClientRect();
    if (procBotPickerOverlay) {
        procBotPickerOverlay.style.display = "block";
        procBotPickerOverlay.style.top = `${rect.top}px`;
        procBotPickerOverlay.style.left = `${rect.left}px`;
        procBotPickerOverlay.style.width = `${rect.width}px`;
        procBotPickerOverlay.style.height = `${rect.height}px`;
    }

    if (procBotPickerTooltip) {
        const sel = computeOptimalSelector(target);
        const text = (target.innerText || target.textContent || "").trim().slice(0, 25);
        procBotPickerTooltip.style.display = "block";
        procBotPickerTooltip.style.top = `${Math.max(10, rect.top - 28)}px`;
        procBotPickerTooltip.style.left = `${rect.left}px`;
        procBotPickerTooltip.textContent = `${target.tagName.toLowerCase()}${sel ? ` | ${sel}` : ''}${text ? ` "${text}"` : ''}`;
    }
}

function onProcBotPickerClick(e) {
    if (!procBotPickerActive) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === procBotPickerBar || procBotPickerBar?.contains(target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const selector = computeOptimalSelector(target);
    const text = (target.innerText || target.textContent || "").trim().slice(0, 50);
    const tag = target.tagName.toLowerCase();

    // Success flash
    if (procBotPickerOverlay) {
        procBotPickerOverlay.style.borderColor = "#10b981";
        procBotPickerOverlay.style.background = "rgba(16,185,129,0.3)";
    }

    const payload = {
        type: "PROCSNAP_SELECTOR_PICKED",
        stepIndex: procBotPickerStepIdx,
        selector: selector,
        tag: tag,
        text: text
    };

    try {
        chrome.runtime.sendMessage(payload);
    } catch (_) {}
    window.postMessage(payload, "*");

    setTimeout(() => {
        stopProcBotSelectorPicker();
    }, 250);
}

function onProcBotPickerKeyDown(e) {
    if (e.key === "Escape") {
        stopProcBotSelectorPicker();
    }
}

// Runtime message receiver in Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "PROCSNAP_START_SELECTOR_PICKER") {
        startProcBotSelectorPicker(message.stepIndex);
        sendResponse({ success: true });
        return true;
    }
    if (message.type === "PROCSNAP_STOP_SELECTOR_PICKER") {
        stopProcBotSelectorPicker();
        sendResponse({ success: true });
        return true;
    }
});

// Window message bridge for Dashboard / Webpage communication
window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === "PROCSNAP_PROCBOT_EXECUTE_STEP") {
        try {
            chrome.runtime.sendMessage({
                type: "PROCBOT_EXECUTE_STEP",
                step: event.data.step,
                value: event.data.value,
                options: event.data.options
            }, (res) => {
                window.postMessage({
                    type: "PROCSNAP_PROCBOT_EXECUTE_STEP_RESPONSE",
                    correlationId: event.data.correlationId,
                    response: res || { success: true }
                }, "*");
            });
        } catch (_) {}
    } else if (event.data.type === "PROCSNAP_START_SELECTOR_PICKER") {
        startProcBotSelectorPicker(event.data.stepIndex);
    }
});