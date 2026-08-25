"""
ProcSnap Annotation Compositor Engine - Phase 6/Export Suite
Renders canvas annotation shapes (rectangles, circles, arrows, callout text,
blur masks, numbered badges, hotspots, and focus crops) directly onto screenshot images.
Used for pixel-perfect export rendering in DOCX, PPTX, PDF, HTML, and SCORM.
"""

import json
import math
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


class AnnotationRenderer:
    """
    Composites vector and raster annotations on top of screenshot image files.
    """

    @classmethod
    def composite_image(
        cls,
        image_path: str,
        annotations: Optional[List[Dict[str, Any]]] = None,
        focus_crop: Optional[Dict[str, float]] = None,
        output_format: str = "PNG"
    ) -> Optional[Image.Image]:
        path = Path(image_path)
        if not path.exists():
            return None

        try:
            with Image.open(path) as raw_img:
                img = raw_img.convert("RGBA")
                w, h = img.size

                # 1. Apply Focus Crop if enabled
                if focus_crop and isinstance(focus_crop, dict):
                    fx = int(focus_crop.get("x", 0) * w)
                    fy = int(focus_crop.get("y", 0) * h)
                    fw = int(focus_crop.get("width", 1.0) * w)
                    fh = int(focus_crop.get("height", 1.0) * h)
                    if fw > 50 and fh > 50 and (fw < w or fh < h):
                        crop_box = (max(0, fx), max(0, fy), min(w, fx + fw), min(h, fy + fh))
                        img = img.crop(crop_box)
                        w, h = img.size

                if not annotations:
                    return img.convert("RGB")

                # Create overlay surface
                overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
                draw = ImageDraw.Draw(overlay)

                # Try loading standard font
                try:
                    font_large = ImageFont.truetype("arial.ttf", max(14, int(h * 0.028)))
                    font_medium = ImageFont.truetype("arial.ttf", max(12, int(h * 0.022)))
                    font_small = ImageFont.truetype("arial.ttf", max(10, int(h * 0.018)))
                except Exception:
                    font_large = ImageFont.load_default()
                    font_medium = font_large
                    font_small = font_large

                for shape in annotations:
                    if not isinstance(shape, dict):
                        continue

                    stype = shape.get("type", "").lower()
                    color_hex = shape.get("color", "#ef4444")
                    rgba_color = cls._hex_to_rgba(color_hex, shape.get("opacity", 1.0))
                    fill_rgba = cls._hex_to_rgba(shape.get("fillColor", color_hex), shape.get("fillOpacity", 0.15))
                    line_width = max(2, int(shape.get("lineWidth", 3) * (h / 720.0)))

                    # Coordinates: can be relative (0.0-1.0) or absolute pixels
                    x = shape.get("x", 0)
                    y = shape.get("y", 0)
                    sw = shape.get("width", 0)
                    sh = shape.get("height", 0)

                    # Normalize if passed as ratio
                    if isinstance(x, float) and x <= 1.0:
                        x = int(x * w)
                    if isinstance(y, float) and y <= 1.0:
                        y = int(y * h)
                    if isinstance(sw, float) and sw <= 1.0:
                        sw = int(sw * w)
                    if isinstance(sh, float) and sh <= 1.0:
                        sh = int(sh * h)

                    # -------------------------------------------------------------
                    # SHAPE: RECTANGLE / BOX / HIGHLIGHT
                    # -------------------------------------------------------------
                    if stype in ["rect", "rectangle", "box", "highlight"]:
                        x2 = x + (sw if sw > 0 else 100)
                        y2 = y + (sh if sh > 0 else 60)
                        # Draw filled background
                        if shape.get("fill") or shape.get("fillColor") or stype == "highlight":
                            draw.rectangle([x, y, x2, y2], fill=fill_rgba)
                        # Draw outline
                        draw.rectangle([x, y, x2, y2], outline=rgba_color, width=line_width)

                    # -------------------------------------------------------------
                    # SHAPE: NUMBERED CIRCLE / BADGE / STEP MARKER
                    # -------------------------------------------------------------
                    elif stype in ["circle", "ellipse", "badge", "numbered_step", "step_number"]:
                        radius = max(13, min(24, sw // 2 if sw > 0 else 14))
                        cx = x + radius
                        cy = y + radius
                        bbox = [cx - radius, cy - radius, cx + radius, cy + radius]
                        
                        # Solid colored circle
                        draw.ellipse(bbox, fill=rgba_color, outline=(255, 255, 255, 240), width=max(2, line_width // 2))
                        
                        # Step number or label centered inside
                        badge_text = str(shape.get("label") or shape.get("text") or shape.get("number") or "1")
                        draw.text((cx, cy), badge_text, fill=(255, 255, 255, 255), font=font_large, anchor="mm")

                    # -------------------------------------------------------------
                    # SHAPE: ARROW
                    # -------------------------------------------------------------
                    elif stype == "arrow":
                        x2 = shape.get("x2", x + (sw if sw > 0 else 80))
                        y2 = shape.get("y2", y + (sh if sh > 0 else 80))
                        if isinstance(x2, float) and x2 <= 1.0:
                            x2 = int(x2 * w)
                        if isinstance(y2, float) and y2 <= 1.0:
                            y2 = int(y2 * h)

                        # Draw main shaft
                        draw.line([x, y, x2, y2], fill=rgba_color, width=line_width)

                        # Draw arrowhead
                        angle = math.atan2(y2 - y, x2 - x)
                        head_len = max(14, int(line_width * 3.5))
                        head_angle = math.pi / 6  # 30 deg

                        p1 = (
                            x2 - head_len * math.cos(angle - head_angle),
                            y2 - head_len * math.sin(angle - head_angle)
                        )
                        p2 = (
                            x2 - head_len * math.cos(angle + head_angle),
                            y2 - head_len * math.sin(angle + head_angle)
                        )
                        draw.polygon([p1, (x2, y2), p2], fill=rgba_color)

                    # -------------------------------------------------------------
                    # SHAPE: TEXT CALLOUT / LABEL
                    # -------------------------------------------------------------
                    elif stype in ["text", "callout", "note"]:
                        text_str = str(shape.get("text", "")).strip()
                        if text_str:
                            pad = 8
                            bbox = draw.textbbox((x, y), text_str, font=font_medium)
                            bg_box = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]
                            # Rounded dark backdrop
                            draw.rectangle(bg_box, fill=(15, 23, 42, 225), outline=rgba_color, width=2)
                            draw.text((x, y), text_str, fill=(255, 255, 255, 255), font=font_medium)

                    # -------------------------------------------------------------
                    # SHAPE: BLUR MASK / PRIVACY REDACTION
                    # -------------------------------------------------------------
                    elif stype in ["blur", "redact", "redaction"]:
                        x2 = min(w, x + (sw if sw > 0 else 100))
                        y2 = min(h, y + (sh if sh > 0 else 50))
                        if x2 > x and y2 > y:
                            crop_box = (max(0, x), max(0, y), x2, y2)
                            blurred_slice = img.crop(crop_box).filter(ImageFilter.GaussianBlur(radius=18))
                            img.paste(blurred_slice, crop_box)

                # Composite vector overlay over image
                final_composite = Image.alpha_composite(img, overlay)
                return final_composite.convert("RGB")

        except Exception as e:
            print(f"[AnnotationRenderer] Error compositing annotations: {e}")
            try:
                with Image.open(path) as raw:
                    return raw.convert("RGB")
            except Exception:
                return None

    @staticmethod
    def _hex_to_rgba(hex_code: str, opacity: float = 1.0) -> Tuple[int, int, int, int]:
        hex_code = (hex_code or "#ef4444").lstrip("#")
        alpha = max(0, min(255, int(opacity * 255)))
        if len(hex_code) == 3:
            hex_code = "".join([c * 2 for c in hex_code])
        try:
            r = int(hex_code[0:2], 16)
            g = int(hex_code[2:4], 16)
            b = int(hex_code[4:6], 16)
            return (r, g, b, alpha)
        except Exception:
            return (239, 68, 68, alpha)
