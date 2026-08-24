"""
ProcSnap Native Desktop Recorder Engine
Captures OS-level global mouse clicks and application interactions outside the browser.
"""

import os
import sys
import time
import json
import uuid
import ctypes
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List

import mss
from PIL import Image
from pynput import mouse, keyboard

BASE_DIR = Path(__file__).resolve().parent.parent
SCREENSHOTS_DIR = BASE_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

# Win32 APIs for active window information
user32 = ctypes.windll.user32 if sys.platform == "win32" else None

def get_active_window_title() -> str:
    """Returns the title of the currently focused desktop window on Windows."""
    if not user32:
        return "Desktop Application"
    try:
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return "Desktop"
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return "Active Desktop App"
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        return buff.value or "Desktop Application"
    except Exception:
        return "Desktop Application"


class DesktopRecorder:
    def __init__(self):
        self.is_recording = False
        self.session_id: Optional[str] = None
        self.session_title: str = "Desktop Workflow"
        self.session_dir: Optional[Path] = None
        self.step_sequence = 0
        self.mouse_listener: Optional[mouse.Listener] = None
        self.kb_listener: Optional[keyboard.Listener] = None
        self.last_click_time = 0.0
        self.db_callback = None
        self._lock = threading.Lock()

    def start(self, title: str = "Desktop App Workflow", db_callback=None) -> str:
        with self._lock:
            if self.is_recording:
                return self.session_id

            self.session_id = str(uuid.uuid4())
            self.session_title = title
            self.session_dir = SCREENSHOTS_DIR / self.session_id
            self.session_dir.mkdir(parents=True, exist_ok=True)
            self.step_sequence = 0
            self.db_callback = db_callback
            self.is_recording = True
            self.last_click_time = 0.0

            # Start global listeners
            self.mouse_listener = mouse.Listener(on_click=self._on_click)
            self.mouse_listener.daemon = True
            self.mouse_listener.start()

            try:
                self.kb_listener = keyboard.GlobalHotKeys({
                    '<ctrl>+<shift>+q': self.stop_from_hotkey,
                    '<ctrl>+<alt>+s': self.stop_from_hotkey
                })
                self.kb_listener.daemon = True
                self.kb_listener.start()
            except Exception as e:
                print(f"[DesktopRecorder] Hotkey listener notice: {e}")

            print(f"[DesktopRecorder] Started native desktop recording session: {self.session_id}")
            return self.session_id

    def _on_click(self, x: int, y: int, button, pressed: bool):
        if not self.is_recording or not pressed:
            return
        
        # Debounce rapid clicks (400ms)
        now = time.time()
        if now - self.last_click_time < 0.4:
            return
        self.last_click_time = now

        try:
            self._capture_step(x, y, button_name=getattr(button, 'name', 'left'))
        except Exception as e:
            print(f"[DesktopRecorder] Error capturing desktop click step: {e}", file=sys.stderr)

    def _capture_step(self, click_x: int, click_y: int, button_name: str = "left"):
        with self._lock:
            if not self.is_recording:
                return

            self.step_sequence += 1
            seq = self.step_sequence
            timestamp = datetime.utcnow().isoformat()
            window_title = get_active_window_title()

            # Smart capture: wait for screen stability + detect loading screens
            filename = f"step-{seq:03d}.png"
            filepath = self.session_dir / filename
            rel_path = f"screenshots/{self.session_id}/{filename}"

            screen_w, screen_h = 1920, 1080
            norm_x, norm_y = 0.5, 0.5
            screenshot_quality = 100
            recapture_suggested = False

            try:
                from .screen_stability import SmartCaptureScheduler
                scheduler = SmartCaptureScheduler(initial_delay_sec=0.35)
                result = scheduler.capture_when_stable(save_path=str(filepath))
                img = result.image
                screenshot_quality = result.confidence
                recapture_suggested = result.recapture_suggested
                screen_w, screen_h = img.size
                if result.warnings:
                    print(f"[DesktopRecorder] Step {seq} quality warnings: {result.warnings}")
            except Exception as e:
                # Fallback to instant grab if smart capture fails
                print(f"[DesktopRecorder] Smart capture unavailable ({e}), using instant grab")
                with mss.mss() as sct:
                    monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
                    screen_w = monitor["width"]
                    screen_h = monitor["height"]
                    sct_img = sct.grab(monitor)
                    img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    img.save(filepath, "PNG", optimize=True)

            if screen_w > 0 and screen_h > 0:
                norm_x = max(0.0, min(1.0, click_x / screen_w))
                norm_y = max(0.0, min(1.0, click_y / screen_h))

            # Action title
            action_desc = f"Click in {window_title}"
            element_info = {
                "x": norm_x,
                "y": norm_y,
                "clientX": click_x,
                "clientY": click_y,
                "screenW": screen_w,
                "screenH": screen_h,
                "window": window_title,
                "button": button_name
            }

            if self.db_callback:
                self.db_callback(
                    session_id=self.session_id,
                    sequence=seq,
                    action=f"desktop_{button_name}_click",
                    timestamp=timestamp,
                    url=f"desktop://{window_title}",
                    title=action_desc,
                    element_json=json.dumps(element_info),
                    screenshot_path=rel_path
                )

            print(f"[DesktopRecorder] Step {seq} captured: {action_desc} at ({click_x}, {click_y})")

    def stop_from_hotkey(self):
        print("[DesktopRecorder] Stop hotkey triggered.")
        self.stop()

    def stop(self) -> Optional[str]:
        with self._lock:
            if not self.is_recording:
                return self.session_id

            self.is_recording = False
            if self.mouse_listener:
                try:
                    self.mouse_listener.stop()
                except Exception:
                    pass
                self.mouse_listener = None

            if self.kb_listener:
                try:
                    self.kb_listener.stop()
                except Exception:
                    pass
                self.kb_listener = None

            s_id = self.session_id
            print(f"[DesktopRecorder] Native desktop recording stopped. Session: {s_id}")
            return s_id

    def get_status(self) -> Dict[str, Any]:
        return {
            "isRecording": self.is_recording,
            "sessionId": self.session_id,
            "sessionTitle": self.session_title,
            "stepCount": self.step_sequence
        }


# Global singleton instance
desktop_recorder = DesktopRecorder()
