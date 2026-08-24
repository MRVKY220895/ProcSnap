"""
ProcSnap Privacy & Smart Redaction Engine - Phase 7
100% local sensitive data detection, password-safe masking,
reusable redaction profiles, and screenshot image blurring.
"""

import re
import io
import json
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw


# Standard PII & Secret Detection Patterns
SENSITIVE_PATTERNS: Dict[str, Tuple[re.Pattern, str]] = {
    "password": (
        re.compile(r'(?:password|passwd|pwd|secret|auth[_-]?token|bearer)\s*[:=]\s*["\']?([^"\'\s]{3,})', re.I),
        "Password / Secret Token"
    ),
    "api_key": (
        re.compile(r'\b(?:ghp_[A-Za-z0-9]{36}|sk_live_[0-9a-zA-Z]{24}|AIza[0-9A-Za-z-_]{35}|[A-Za-z0-9]{32,45})\b'),
        "API Key / Private Token"
    ),
    "credit_card": (
        re.compile(r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b'),
        "Credit / Debit Card Number"
    ),
    "email": (
        re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
        "Email Address"
    ),
    "phone": (
        re.compile(r'\b(?:\+?[0-9]{1,3}[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b'),
        "Phone Number"
    ),
    "ssn_national_id": (
        re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
        "Social Security / National ID"
    ),
    "ip_address": (
        re.compile(r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b'),
        "IP Address"
    ),
    "account_number": (
        re.compile(r'\b(?:ACC|IBAN|ACCT)[-_]?[0-9A-Z]{8,24}\b', re.I),
        "Bank / Account Number"
    )
}

DEFAULT_PROFILES = [
    {
        "id": "general_pii",
        "name": "Standard PII Protection",
        "description": "Masks emails, phone numbers, SSNs, credit cards, and passwords.",
        "rules": ["password", "api_key", "credit_card", "email", "phone", "ssn_national_id"]
    },
    {
        "id": "financial_banking",
        "name": "Financial & Banking Profile",
        "description": "Strict redaction for credit cards, bank accounts, SSN, and auth tokens.",
        "rules": ["password", "api_key", "credit_card", "account_number", "ssn_national_id", "email"]
    },
    {
        "id": "dev_ops_tokens",
        "name": "DevOps & Infrastructure",
        "description": "Protects API keys, bearer tokens, IP addresses, and database passwords.",
        "rules": ["password", "api_key", "ip_address"]
    }
]


class SensitiveDataDetector:
    """
    Scans step text, values, URLs, and element metadata for sensitive data patterns.
    """

    @classmethod
    def scan_step(cls, step: Dict[str, Any], enabled_rules: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        findings: List[Dict[str, Any]] = []
        rules_to_check = enabled_rules or list(SENSITIVE_PATTERNS.keys())

        # Collect all text fields in step
        fields_to_check = {
            "title": step.get("edited_title") or step.get("title") or "",
            "description": step.get("edited_description") or step.get("description") or "",
            "value": step.get("value") or "",
            "note": step.get("note") or "",
            "url": step.get("url") or ""
        }

        # Check element properties if present
        element = step.get("element")
        if isinstance(element, dict):
            fields_to_check["element_text"] = element.get("text") or ""
            fields_to_check["element_placeholder"] = element.get("placeholder") or ""
            fields_to_check["element_name"] = element.get("name") or ""

            # Check if input type is password
            if str(element.get("type", "")).lower() == "password":
                findings.append({
                    "type": "password_input_field",
                    "label": "Password Input Field",
                    "field": "element.type",
                    "match": "type=password",
                    "severity": "high",
                    "recommendation": "Mask input value with [PASSWORD REDACTED]"
                })

        for field_name, text_val in fields_to_check.items():
            if not text_val or not isinstance(text_val, str):
                continue

            for rule_id in rules_to_check:
                if rule_id not in SENSITIVE_PATTERNS:
                    continue

                pattern, label = SENSITIVE_PATTERNS[rule_id]
                for match in pattern.finditer(text_val):
                    matched_str = match.group(0)
                    # Skip common false positives
                    if rule_id == "ip_address" and matched_str.startswith("127.0.0.1"):
                        continue
                    if rule_id == "email" and "example.com" in matched_str:
                        continue

                    # Mask sample for safe display
                    if len(matched_str) > 6:
                        masked_sample = matched_str[:2] + ("*" * (len(matched_str) - 4)) + matched_str[-2:]
                    else:
                        masked_sample = "***"

                    findings.append({
                        "type": rule_id,
                        "label": label,
                        "field": field_name,
                        "match_raw": matched_str,
                        "masked_sample": masked_sample,
                        "start": match.start(),
                        "end": match.end(),
                        "severity": "high" if rule_id in ["password", "api_key", "credit_card", "ssn_national_id"] else "medium",
                        "recommendation": f"Redact {label} in {field_name}"
                    })

        return findings

    @classmethod
    def scan_workflow(cls, workflow: Dict[str, Any], steps: List[Dict[str, Any]], rules: Optional[List[str]] = None) -> Dict[str, Any]:
        all_findings = []
        steps_with_findings = 0

        for s in steps:
            step_findings = cls.scan_step(s, enabled_rules=rules)
            if step_findings:
                steps_with_findings += 1
                for f in step_findings:
                    f["step_id"] = s.get("id")
                    f["step_sequence"] = s.get("sequence")
                    all_findings.append(f)

        return {
            "total_findings": len(all_findings),
            "affected_steps_count": steps_with_findings,
            "total_steps": len(steps),
            "findings": all_findings,
            "has_high_risk": any(f["severity"] == "high" for f in all_findings)
        }


class RedactionEngine:
    """
    Applies text masking and image blurring to steps and screenshots.
    """

    @staticmethod
    def mask_text(text: str, rules: Optional[List[str]] = None) -> str:
        if not text:
            return ""

        result = text
        rules_to_apply = rules or list(SENSITIVE_PATTERNS.keys())

        for r in rules_to_apply:
            if r in SENSITIVE_PATTERNS:
                pattern, label = SENSITIVE_PATTERNS[r]
                # Replace with [REDACTED LABEL] or ***
                result = pattern.sub(f"[{label.upper()} REDACTED]", result)

        return result

    @staticmethod
    def blur_image_region(image_path: str, bounds: Dict[str, float], blur_radius: int = 15) -> bool:
        """
        Blurs a normalized rectangular region (x, y, width, height: 0.0 to 1.0) on a screenshot file.
        """
        path = Path(image_path)
        if not path.exists():
            return False

        try:
            with Image.open(path) as img:
                img = img.convert("RGB")
                w, h = img.size

                x1 = int(bounds.get("x", 0.0) * w)
                y1 = int(bounds.get("y", 0.0) * h)
                bw = int(bounds.get("width", 0.1) * w)
                bh = int(bounds.get("height", 0.05) * h)
                x2 = min(w, x1 + bw)
                y2 = min(h, y1 + bh)

                if x2 <= x1 or y2 <= y1:
                    return False

                # Crop region, blur it heavily, paste back
                crop_box = (x1, y1, x2, y2)
                region = img.crop(crop_box)
                blurred_region = region.filter(ImageFilter.GaussianBlur(radius=blur_radius))
                img.paste(blurred_region, crop_box)

                img.save(path, "PNG", optimize=True)
                return True
        except Exception as e:
            print(f"[RedactionEngine] Error blurring image region: {e}")
            return False
