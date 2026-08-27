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
from PIL import Image, ImageDraw, ImageGrab
from pynput import keyboard

BASE_DIR = Path(__file__).resolve().parent
SCREENSHOTS_DIR = BASE_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

# Win32 APIs for active window information & low-level mouse hooking
user32 = ctypes.windll.user32 if sys.platform == "win32" else None
kernel32 = ctypes.windll.kernel32 if sys.platform == "win32" else None

if sys.platform == "win32" and user32:
    from ctypes import wintypes
    HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_longlong, ctypes.c_int, wintypes.WPARAM, ctypes.c_void_p)
    try:
        user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
        user32.SetWindowsHookExW.restype = ctypes.c_void_p
        user32.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, wintypes.WPARAM, ctypes.c_void_p]
        user32.CallNextHookEx.restype = ctypes.c_longlong
        user32.UnhookWindowsHookEx.argtypes = [ctypes.c_void_p]
        user32.UnhookWindowsHookEx.restype = wintypes.BOOL
    except Exception as e:
        print(f"[DesktopRecorder] Hook ctypes init notice: {e}")

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


# Enable Windows DPI Awareness for exact pixel coordinates
if sys.platform == "win32":
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


# Win32 Interactive Desktop Station Attacher
def _attach_thread_to_user_desktop():
    """Attaches calling thread to the interactive user desktop station (WinSta0\\Default)."""
    if sys.platform == "win32" and user32:
        try:
            hwinsta = user32.OpenWindowStationW("WinSta0", False, 0x37F)
            if hwinsta:
                user32.SetProcessWindowStation(hwinsta)
            hdesk = user32.OpenDesktopW("Default", 0, False, 0x1FF)
            if hdesk:
                user32.SetThreadDesktop(hdesk)
        except Exception as e:
            print(f"[DesktopRecorder] Desktop station attach notice: {e}")


def get_connected_monitors() -> List[Dict[str, Any]]:
    """Returns metadata for all connected physical/virtual displays on Windows."""
    monitors = []
    if sys.platform == "win32" and user32:
        try:
            from ctypes import wintypes
            class MONITORINFO(ctypes.Structure):
                _fields_ = [
                    ('cbSize', wintypes.DWORD),
                    ('rcMonitor', wintypes.RECT),
                    ('rcWork', wintypes.RECT),
                    ('dwFlags', wintypes.DWORD)
                ]
            def _monitor_enum_proc(hMonitor, hdcMonitor, lprcMonitor, dwData):
                r = lprcMonitor.contents
                mi = MONITORINFO()
                mi.cbSize = ctypes.sizeof(MONITORINFO)
                user32.GetMonitorInfoW(hMonitor, ctypes.byref(mi))
                is_primary = bool(mi.dwFlags & 1)
                idx = len(monitors) + 1
                w = r.right - r.left
                h = r.bottom - r.top
                monitors.append({
                    'index': idx,
                    'left': r.left,
                    'top': r.top,
                    'right': r.right,
                    'bottom': r.bottom,
                    'width': w,
                    'height': h,
                    'is_primary': is_primary,
                    'name': f"Screen {idx} ({w}x{h}{' - Primary' if is_primary else ''})"
                })
                return True
            MONITORENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
            user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(_monitor_enum_proc), 0)
        except Exception as e:
            print(f"[DesktopRecorder] Monitor enum notice: {e}")
            
    if not monitors:
        w = user32.GetSystemMetrics(0) if user32 else 1920
        h = user32.GetSystemMetrics(1) if user32 else 1080
        monitors = [{
            'index': 1, 'left': 0, 'top': 0, 'right': w, 'bottom': h,
            'width': w, 'height': h, 'is_primary': True, 'name': f"Primary Screen ({w}x{h})"
        }]
    return monitors


def _capture_screen_robust(filepath: Path, click_x: int = 0, click_y: int = 0, window_title: str = "Desktop", target_monitor: str = "auto") -> tuple[int, int, int, float, float]:
    """
    Captures desktop screenshot for the chosen or auto-detected monitor.
    Returns (width, height, confidence, norm_x, norm_y).
    Guaranteed to always create a valid PNG at filepath.
    """
    filepath.parent.mkdir(parents=True, exist_ok=True)
    monitors = get_connected_monitors()
    
    # Determine target bounding box
    sel_mon = None
    if target_monitor == "all":
        # Full virtual desktop spanning all monitors
        SM_XVIRTUALSCREEN = 76
        SM_YVIRTUALSCREEN = 77
        SM_CXVIRTUALSCREEN = 78
        SM_CYVIRTUALSCREEN = 79
        x = user32.GetSystemMetrics(SM_XVIRTUALSCREEN) if user32 else 0
        y = user32.GetSystemMetrics(SM_YVIRTUALSCREEN) if user32 else 0
        w = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN) if user32 else 1920
        h = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN) if user32 else 1080
    elif str(target_monitor).isdigit() and 1 <= int(target_monitor) <= len(monitors):
        sel_mon = monitors[int(target_monitor) - 1]
        x, y, w, h = sel_mon['left'], sel_mon['top'], sel_mon['width'], sel_mon['height']
    else:
        # Default: "auto" -> Detect monitor containing cursor position (click_x, click_y)
        for m in monitors:
            if m['left'] <= click_x < m['right'] and m['top'] <= click_y < m['bottom']:
                sel_mon = m
                break
        if not sel_mon:
            sel_mon = next((m for m in monitors if m['is_primary']), monitors[0])
        x, y, w, h = sel_mon['left'], sel_mon['top'], sel_mon['width'], sel_mon['height']

    if w <= 0: w = 1920
    if h <= 0: h = 1080

    norm_x = max(0.0, min(1.0, (click_x - x) / w)) if w > 0 else 0.5
    norm_y = max(0.0, min(1.0, (click_y - y) / h)) if h > 0 else 0.5

    # Strategy 1: Interactive WinSta0\\Default GDI Memory Grab
    if sys.platform == "win32" and user32:
        try:
            _attach_thread_to_user_desktop()
            from ctypes import wintypes
            gdi32 = ctypes.windll.gdi32

            hdc_screen = user32.GetDC(0)
            hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
            hbm = gdi32.CreateCompatibleBitmap(hdc_screen, w, h)
            h_old = gdi32.SelectObject(hdc_mem, hbm)

            # Copy targeted screen rect surface via BitBlt
            res = gdi32.BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, x, y, 0x00CC0020 | 0x40000000)

            class BITMAPINFOHEADER(ctypes.Structure):
                _fields_ = [
                    ('biSize', wintypes.DWORD),
                    ('biWidth', wintypes.LONG),
                    ('biHeight', wintypes.LONG),
                    ('biPlanes', wintypes.WORD),
                    ('biBitCount', wintypes.WORD),
                    ('biCompression', wintypes.DWORD),
                    ('biSizeImage', wintypes.DWORD),
                    ('biXPelsPerMeter', wintypes.LONG),
                    ('biYPelsPerMeter', wintypes.LONG),
                    ('biClrUsed', wintypes.DWORD),
                    ('biClrImportant', wintypes.DWORD)
                ]

            bih = BITMAPINFOHEADER()
            bih.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bih.biWidth = w
            bih.biHeight = -h
            bih.biPlanes = 1
            bih.biBitCount = 32
            bih.biCompression = 0

            buf = ctypes.create_string_buffer(w * h * 4)
            gdi32.GetDIBits(hdc_mem, hbm, 0, h, buf, ctypes.byref(bih), 0)

            # Cleanup GDI handles
            gdi32.SelectObject(hdc_mem, h_old)
            gdi32.DeleteObject(hbm)
            gdi32.DeleteDC(hdc_mem)
            user32.ReleaseDC(0, hdc_screen)

            img = Image.frombuffer('RGBA', (w, h), buf, 'raw', 'BGRA', 0, 1).convert('RGB')
            img.save(str(filepath), "PNG")
            if filepath.exists() and filepath.stat().st_size > 5000:
                return w, h, 100, norm_x, norm_y
        except Exception as e:
            print(f"[DesktopRecorder] Win32 GDI grab notice: {e}")

    # Strategy 2: PIL ImageGrab fallback
    try:
        img = ImageGrab.grab(all_screens=False)
        img.save(str(filepath), "PNG")
        if filepath.exists() and filepath.stat().st_size > 5000:
            return img.size[0], img.size[1], 95, norm_x, norm_y
    except Exception as e:
        print(f"[DesktopRecorder] ImageGrab notice: {e}")

    # Strategy 3: Guaranteed diagnostic canvas fallback
    try:
        fallback_img = Image.new("RGB", (w, h), color=(15, 23, 42))
        draw = ImageDraw.Draw(fallback_img)
        draw.rectangle([0, 0, w, 60], fill=(30, 41, 59))
        draw.text((40, 20), f"ProcSnap Desktop: {window_title}", fill=(255, 255, 255))
        draw.text((40, 80), f"Click coordinates: X={click_x}, Y={click_y}", fill=(148, 163, 184))
        cx = max(50, min(w - 50, int(norm_x * w)))
        cy = max(100, min(h - 50, int(norm_y * h)))
        draw.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], outline=(239, 68, 68), width=4)
        draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=(239, 68, 68))
        fallback_img.save(str(filepath), "PNG")
        return w, h, 70, norm_x, norm_y
    except Exception:
        return 1920, 1080, 50, 0.5, 0.5


import queue

class DesktopRecorder:
    def __init__(self):
        self.is_recording = False
        self.session_id: Optional[str] = None
        self.session_title: str = "Desktop Workflow"
        self.target_monitor: str = "auto"
        self.auto_click_capture: bool = True
        self.mode: str = "desktop" # "desktop" or "hybrid"
        self.session_dir: Optional[Path] = None
        self.step_sequence = 0
        self.mouse_listener: Optional[mouse.Listener] = None
        self.kb_listener: Optional[keyboard.Listener] = None
        self.hook_thread: Optional[threading.Thread] = None
        self.poll_thread: Optional[threading.Thread] = None
        self.worker_thread: Optional[threading.Thread] = None
        self.event_queue: queue.Queue = queue.Queue()
        self.last_click_time = 0.0
        self.db_callback = None
        self._hook_handle = None
        self._hook_thread_id = None
        self._hook_proc_ref = None
        self._lock = threading.Lock()

    def start(self, title: str = "Desktop App Workflow", target_monitor: str = "auto", auto_click_capture: bool = True, session_id: Optional[str] = None, mode: str = "desktop", db_callback=None) -> str:
        with self._lock:
            if self.is_recording:
                return self.session_id

            self.session_id = session_id or str(uuid.uuid4())
            self.session_title = title
            self.target_monitor = target_monitor or "auto"
            self.auto_click_capture = auto_click_capture
            self.mode = mode or "desktop"
            self.session_dir = SCREENSHOTS_DIR / self.session_id
            self.session_dir.mkdir(parents=True, exist_ok=True)
            self.step_sequence = 0
            self.db_callback = db_callback
            self.is_recording = True
            self.last_click_time = 0.0
            self.event_queue = queue.Queue()

            # 1. Start background asynchronous capture worker thread
            self.worker_thread = threading.Thread(target=self._capture_worker_loop, daemon=True)
            self.worker_thread.start()

            # 2. Start Primary Native Windows Low-Level Hook (WH_MOUSE_LL)
            if self.auto_click_capture and sys.platform == "win32" and user32:
                try:
                    self.hook_thread = threading.Thread(target=self._native_mouse_hook_loop, daemon=True)
                    self.hook_thread.start()
                    print(f"[DesktopRecorder] Native Win32 WH_MOUSE_LL Hook active (Mode: {self.mode}, Target Monitor: {self.target_monitor}).")
                except Exception as he:
                    print(f"[DesktopRecorder] Native Hook start error: {he}")

            # 3. Start Win32 kernel-level GetAsyncKeyState polling worker as secondary listener
            if self.auto_click_capture and sys.platform == "win32" and user32:
                try:
                    user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
                    user32.GetAsyncKeyState.restype = ctypes.c_short
                    self.poll_thread = threading.Thread(target=self._poll_clicks_loop, daemon=True)
                    self.poll_thread.start()
                except Exception as pe:
                    print(f"[DesktopRecorder] Click poll start warning: {pe}")

            # 4. Global Hotkeys always available
            try:
                self.kb_listener = keyboard.GlobalHotKeys({
                    '<ctrl>+<shift>+q': self.stop_from_hotkey,
                    '<ctrl>+<alt>+s': self.stop_from_hotkey,
                    '<ctrl>+<shift>+d': self.instant_capture_hotkey
                })
                self.kb_listener.daemon = True
                self.kb_listener.start()
            except Exception as e:
                print(f"[DesktopRecorder] Hotkey listener notice: {e}")

            print(f"[DesktopRecorder] Started native desktop recording session: {self.session_id} (Mode: {self.mode})")
            return self.session_id

    def _native_mouse_hook_loop(self):
        """Native Windows WH_MOUSE_LL low-level hook with hMod=None and Windows message pump."""
        _attach_thread_to_user_desktop()
        from ctypes import wintypes
        kernel32 = ctypes.windll.kernel32
        self._hook_thread_id = kernel32.GetCurrentThreadId()

        WH_MOUSE_LL = 14
        WM_LBUTTONDOWN = 0x0201
        WM_RBUTTONDOWN = 0x0204

        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        class MSLLHOOKSTRUCT(ctypes.Structure):
            _fields_ = [
                ("pt", POINT),
                ("mouseData", wintypes.DWORD),
                ("flags", wintypes.DWORD),
                ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.c_ulonglong)
            ]

        def _hook_proc(nCode, wParam, lParam):
            if nCode >= 0 and self.is_recording:
                if wParam in (WM_LBUTTONDOWN, WM_RBUTTONDOWN):
                    try:
                        window_title = get_active_window_title()
                        wt_lower = window_title.lower()

                        # In hybrid mode, ignore standard web page clicks in Chrome/Edge (handled by extension DOM)
                        # BUT capture if it is a native file picker or OS dialog ("Open", "Save", "Select", "File Explorer", etc.)
                        if self.mode == "hybrid":
                            is_browser_web = any(b in wt_lower for b in ["google chrome", "microsoft edge", "brave", "mozilla firefox"])
                            is_native_dialog = any(d in wt_lower for d in ["open", "save as", "select a file", "browse", "upload", "file explorer", "choose file", "import"])
                            if is_browser_web and not is_native_dialog:
                                return user32.CallNextHookEx(self._hook_handle, nCode, wParam, lParam)

                        info = MSLLHOOKSTRUCT.from_address(lParam)
                        btn = "left" if wParam == WM_LBUTTONDOWN else "right"
                        now = time.time()
                        if now - self.last_click_time > 0.25:
                            self.last_click_time = now
                            self.event_queue.put({
                                "x": info.pt.x,
                                "y": info.pt.y,
                                "button": btn,
                                "window": window_title,
                                "time": now
                            })
                            print(f"[DesktopRecorder] WH_MOUSE_LL Hook Click: {btn} at ({info.pt.x}, {info.pt.y}) in '{window_title}'")
                    except Exception as ex:
                        print(f"[DesktopRecorder] Hook proc notice: {ex}")
            return user32.CallNextHookEx(self._hook_handle, nCode, wParam, lParam)

        self._hook_proc_ref = HOOKPROC(_hook_proc)
        # hMod MUST be None/0 for low-level global hooks on Windows
        self._hook_handle = user32.SetWindowsHookExW(WH_MOUSE_LL, self._hook_proc_ref, None, 0)
        print(f"[DesktopRecorder] SetWindowsHookExW active! Handle={self._hook_handle}, Thread={self._hook_thread_id}")

        msg = wintypes.MSG()
        while self.is_recording and user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

        if self._hook_handle:
            user32.UnhookWindowsHookEx(self._hook_handle)
            self._hook_handle = None

    def _poll_clicks_loop(self):
        """Continuous kernel-level mouse state scanner using GetAsyncKeyState (high bit + low bit)."""
        _attach_thread_to_user_desktop()
        was_down = False
        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        while self.is_recording:
            try:
                if user32:
                    state = user32.GetAsyncKeyState(0x01) # VK_LBUTTON
                    is_down = (state & 0x8000) != 0
                    was_clicked_since_last = (state & 0x0001) != 0

                    if (is_down and not was_down) or was_clicked_since_last:
                        now = time.time()
                        if now - self.last_click_time > 0.3:
                            self.last_click_time = now
                            pt = POINT()
                            user32.GetCursorPos(ctypes.byref(pt))
                            window_title = get_active_window_title()
                            self.event_queue.put({
                                "x": pt.x,
                                "y": pt.y,
                                "button": "left",
                                "window": window_title,
                                "time": now
                            })
                    was_down = is_down
            except Exception as e:
                print(f"[DesktopRecorder] Poller tick notice: {e}")
            time.sleep(0.015)

    def _on_click(self, x: int, y: int, button, pressed: bool):
        if not self.is_recording or not pressed:
            return

        now = time.time()
        if now - self.last_click_time < 0.35:
            return
        self.last_click_time = now

        try:
            window_title = get_active_window_title()
            self.event_queue.put({
                "x": x,
                "y": y,
                "button": getattr(button, 'name', 'left'),
                "window": window_title,
                "time": now
            })
        except Exception as e:
            print(f"[DesktopRecorder] Error enqueuing click: {e}")

    def instant_capture_hotkey(self):
        print("[DesktopRecorder] Instant capture triggered!")
        try:
            pt_x, pt_y = 960, 540
            if user32:
                class POINT(ctypes.Structure):
                    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
                pt = POINT()
                user32.GetCursorPos(ctypes.byref(pt))
                pt_x, pt_y = pt.x, pt.y
            window_title = get_active_window_title()
            self.event_queue.put({
                "x": pt_x,
                "y": pt_y,
                "button": "manual_hotkey",
                "window": window_title,
                "time": time.time()
            })
        except Exception as e:
            print(f"[DesktopRecorder] Manual hotkey error: {e}")

    def _capture_worker_loop(self):
        """Asynchronously processes click events and grabs screenshots without blocking listeners."""
        while self.is_recording:
            try:
                event = self.event_queue.get(timeout=0.2)
            except queue.Empty:
                continue

            if event is None or not self.is_recording:
                break

            try:
                self._process_capture_event(event)
            except Exception as ex:
                print(f"[DesktopRecorder] Step processing error: {ex}")
            finally:
                self.event_queue.task_done()

    def _process_capture_event(self, event: dict):
        click_x = event.get("x", 0)
        click_y = event.get("y", 0)
        button_name = event.get("button", "left")
        window_title = event.get("window", "Desktop Application")

        self.step_sequence += 1
        seq = self.step_sequence
        timestamp = datetime.utcnow().isoformat()

        filename = f"step-{seq:03d}.png"
        filepath = self.session_dir / filename
        rel_path = f"screenshots/{self.session_id}/{filename}"

        screen_w, screen_h, confidence, norm_x, norm_y = _capture_screen_robust(
            filepath=filepath,
            click_x=click_x,
            click_y=click_y,
            window_title=window_title,
            target_monitor=self.target_monitor
        )

        action_desc = f"Click in {window_title}" if button_name != "manual_hotkey" else f"Capture {window_title}"
        element_info = {
            "x": norm_x,
            "y": norm_y,
            "clientX": click_x,
            "clientY": click_y,
            "screenW": screen_w,
            "screenH": screen_h,
            "window": window_title,
            "button": button_name,
            "monitor": self.target_monitor
        }

        if self.db_callback:
            try:
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
            except Exception as db_err:
                print(f"[DesktopRecorder] DB callback error: {db_err}")

        print(f"[DesktopRecorder] Step {seq} captured: {action_desc} at ({click_x}, {click_y}) on {self.target_monitor}")

    def stop_from_hotkey(self):
        print("[DesktopRecorder] Stop hotkey triggered.")
        self.stop()

    def stop(self) -> Optional[str]:
        with self._lock:
            if not self.is_recording:
                return self.session_id

            self.is_recording = False

            # Unhook native Windows hook
            if self._hook_thread_id and user32:
                try:
                    user32.PostThreadMessageW(self._hook_thread_id, 0x0012, 0, 0) # WM_QUIT
                except Exception:
                    pass

            if self._hook_handle and user32:
                try:
                    user32.UnhookWindowsHookEx(self._hook_handle)
                except Exception:
                    pass
                self._hook_handle = None

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

            # Finish remaining queued click events
            if self.event_queue:
                self.event_queue.put(None)
                if self.worker_thread and self.worker_thread.is_alive():
                    self.worker_thread.join(timeout=2.0)

            s_id = self.session_id
            print(f"[DesktopRecorder] Native desktop recording stopped. Session: {s_id}, Total steps: {self.step_sequence}")
            return s_id

    def get_status(self) -> Dict[str, Any]:
        return {
            "isRecording": self.is_recording,
            "sessionId": self.session_id,
            "sessionTitle": self.session_title,
            "targetMonitor": self.target_monitor,
            "autoClickCapture": self.auto_click_capture,
            "stepCount": self.step_sequence
        }


# Global singleton instance
desktop_recorder = DesktopRecorder()
