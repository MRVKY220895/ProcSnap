"""
ProcSnap Smart Screenshot Timing Engine - Phase 1
"""
import math, time, hashlib
from typing import Optional, Tuple, List
from dataclasses import dataclass, field

import mss
from PIL import Image, ImageStat


@dataclass
class CaptureResult:
    image: object
    confidence: int
    waited_ms: int
    was_loading: bool
    recapture_suggested: bool
    warnings: List[str] = field(default_factory=list)


class LoadingDetector:
    def is_loading(self, img) -> Tuple[bool, str]:
        w, h = img.size
        if w == 0 or h == 0:
            return True, "blank_image"
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        stat = ImageStat.Stat(img)
        ch = min(3, len(stat.mean))
        mean_b = sum(stat.mean[:ch]) / ch
        stddev = sum(stat.stddev[:ch]) / ch
        if stddev < 8 and (mean_b > 240 or mean_b < 12):
            return True, "blank_screen"
        if stddev < 10:
            return True, "low_variance_overlay"
        cx, cy = w // 2, h // 2
        margin = max(40, min(100, w // 10, h // 10))
        centre = img.crop((cx - margin, cy - margin, cx + margin, cy + margin))
        c_stat = ImageStat.Stat(centre)
        c_mean = sum(c_stat.mean[:ch]) / ch
        c_std = sum(c_stat.stddev[:ch]) / ch
        if stddev < 20 and c_std < 15 and abs(c_mean - mean_b) < 10:
            return True, "uniform_overlay"
        return False, ""

    def has_spinner_pattern(self, img) -> bool:
        w, h = img.size
        if w < 100 or h < 100:
            return False
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        cx, cy = w // 2, h // 2
        radius = max(20, min(50, w // 12, h // 12))
        ring_values = []
        for deg in range(0, 360, 15):
            rad = math.radians(deg)
            px = max(0, min(w - 1, int(cx + radius * math.cos(rad))))
            py = max(0, min(h - 1, int(cy + radius * math.sin(rad))))
            pixel = img.getpixel((px, py))
            if isinstance(pixel, (tuple, list)) and len(pixel) >= 3:
                ring_values.append(sum(pixel[:3]) / 3.0)
            elif isinstance(pixel, int):
                ring_values.append(float(pixel))
        if len(ring_values) < 8:
            return False
        transitions = sum(1 for i in range(len(ring_values) - 1) if abs(ring_values[i] - ring_values[i + 1]) > 55)
        return transitions >= 5


class ScreenStabilityService:
    def __init__(self, monitor_index: int = 1):
        self.monitor_index = monitor_index

    def _grab(self, sct):
        monitors = sct.monitors
        if not monitors:
            return Image.new("RGB", (1920, 1080))
        idx = self.monitor_index if self.monitor_index < len(monitors) else 0
        m = monitors[idx]
        raw = sct.grab(m)
        return Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")

    def _phash(self, img) -> str:
        thumb = img.resize((64, 36), Image.LANCZOS).convert("L")
        return hashlib.md5(thumb.tobytes()).hexdigest()

    def wait_for_stability(self, max_wait_sec=2.5, stable_duration_sec=0.10, poll_interval_sec=0.07):
        start = time.perf_counter()
        prev_hash = None
        stable_since = None
        last_img = None
        with mss.mss() as sct:
            while True:
                elapsed = time.perf_counter() - start
                if elapsed >= max_wait_sec:
                    break
                frame = self._grab(sct)
                h = self._phash(frame)
                if h == prev_hash:
                    if stable_since is None:
                        stable_since = time.perf_counter()
                    elif (time.perf_counter() - stable_since) >= stable_duration_sec:
                        last_img = frame
                        break
                else:
                    stable_since = None
                prev_hash = h
                last_img = frame
                time.sleep(poll_interval_sec)
        elapsed = time.perf_counter() - start
        confidence = max(60.0, min(100.0, 100.0 - elapsed * 12.0)) if stable_since else max(25.0, 60.0 - elapsed * 10.0)
        if last_img is None:
            last_img = Image.new("RGB", (1920, 1080))
        return last_img, confidence, elapsed


class SmartCaptureScheduler:
    def __init__(self, initial_delay_sec=0.35, loading_timeout_sec=3.0, stability_timeout_sec=2.0, monitor_index=1):
        self.initial_delay_sec = initial_delay_sec
        self.loading_timeout_sec = loading_timeout_sec
        self.stability_timeout_sec = stability_timeout_sec
        self._loader = LoadingDetector()
        self._stability = ScreenStabilityService(monitor_index=monitor_index)

    def _quick_grab(self):
        try:
            with mss.mss() as sct:
                monitors = sct.monitors
                idx = 1 if len(monitors) > 1 else 0
                m = monitors[idx]
                raw = sct.grab(m)
                return Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        except Exception:
            return Image.new("RGB", (1920, 1080))

    def capture_when_stable(self, save_path=None) -> CaptureResult:
        warnings = []
        wall_start = time.perf_counter()
        time.sleep(self.initial_delay_sec)
        initial_img = self._quick_grab()
        was_loading, load_reason = self._loader.is_loading(initial_img)
        if was_loading:
            warnings.append(f"Loading screen detected ({load_reason})")
            load_start = time.perf_counter()
            while (time.perf_counter() - load_start) < self.loading_timeout_sec:
                time.sleep(0.22)
                check = self._quick_grab()
                still_loading, _ = self._loader.is_loading(check)
                if not still_loading:
                    break
        stable_img, confidence, wait_elapsed = self._stability.wait_for_stability(max_wait_sec=self.stability_timeout_sec)
        final_loading, final_reason = self._loader.is_loading(stable_img)
        if final_loading:
            warnings.append(f"Possible loading overlay on final capture ({final_reason})")
            confidence = max(25.0, confidence - 22.0)
        if self._loader.has_spinner_pattern(stable_img):
            warnings.append("Spinner pattern detected")
            confidence = max(25.0, confidence - 12.0)
        stat = ImageStat.Stat(stable_img)
        ch = min(3, len(stat.mean))
        mean_b = sum(stat.mean[:ch]) / ch
        if mean_b > 249 or mean_b < 5:
            warnings.append("Screenshot appears blank or empty")
            confidence = max(10.0, confidence - 30.0)
        recapture = confidence < 65.0 or len(warnings) >= 2
        if save_path:
            try:
                stable_img.save(save_path, "PNG", optimize=True)
            except Exception as e:
                warnings.append(f"Save failed: {e}")
        total_ms = int((time.perf_counter() - wall_start) * 1000)
        return CaptureResult(image=stable_img, confidence=int(confidence), waited_ms=total_ms,
                             was_loading=was_loading, recapture_suggested=recapture, warnings=warnings)


_scheduler = SmartCaptureScheduler()

def smart_capture(save_path=None) -> CaptureResult:
    """Convenience wrapper around SmartCaptureScheduler."""
    return _scheduler.capture_when_stable(save_path=save_path)
