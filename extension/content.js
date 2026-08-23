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
    (message) => {
        console.log(
            "PROCSNAP CONTENT MESSAGE:",
            message
        );

        if (
            message.type ===
            "RECORDING_STATE_CHANGED"
        ) {
            setRecordingState(
                message.recording === true,
                message.paused === true
            );
        }
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