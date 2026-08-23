"""
capture_screen.py - Run as a subprocess from FastAPI backend.
Usage: python capture_screen.py <output_path> [monitor_index]
"""
import sys

output_path = sys.argv[1] if len(sys.argv) > 1 else "capture_out.png"
monitor_index = int(sys.argv[2]) if len(sys.argv) > 2 else 1
captured = False

# Method 1: mss
try:
    import mss
    import mss.tools
    with mss.MSS() as sct:
        monitors = sct.monitors
        monitor = monitors[monitor_index] if monitor_index < len(monitors) else monitors[1]
        screenshot = sct.grab(monitor)
        mss.tools.to_png(screenshot.rgb, screenshot.size, output=output_path)
        captured = True
except Exception as e:
    print(f"mss failed: {e}", file=sys.stderr)

# Method 2: PIL ImageGrab
if not captured:
    try:
        from PIL import ImageGrab
        img = ImageGrab.grab(include_layered_windows=True, all_screens=(monitor_index == 0))
        img.save(output_path, format="PNG")
        captured = True
    except Exception as e:
        print(f"PIL failed: {e}", file=sys.stderr)

if captured:
    print(f"OK:{output_path}")
    sys.exit(0)
else:
    print("All capture methods failed", file=sys.stderr)
    sys.exit(1)
