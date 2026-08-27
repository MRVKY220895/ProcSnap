"""
ProcSnap Local Privacy & PII Scanner Engine
100% Offline Pattern Detection & Auto-Redaction for enterprise compliance.
"""

import re
from typing import List, Dict, Any, Tuple


# Regex patterns for sensitive entity detection
PATTERNS = {
    "email": re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
    "credit_card": re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'),
    "phone": re.compile(r'\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'),
    "ssn": re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
    "api_key": re.compile(r'\b(?:sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-\.]{20,}|ghp_[a-zA-Z0-9]{36}|AIza[0-9A-Za-z-_]{35})\b'),
    "ipv4": re.compile(r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b'),
    "jwt": re.compile(r'\beyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\b'),
    "password_hint": re.compile(r'(?:password|pwd|secret|token|api_key|auth)[\s:=]+([^\s,;&]+)', re.I)
}


class LocalPrivacyScanner:
    """
    Scans step text, parameters, element values, and URL query strings for sensitive data.
    """

    def scan_text(self, text: str) -> List[Dict[str, Any]]:
        if not text:
            return []
        
        findings = []
        for pii_type, pattern in PATTERNS.items():
            for match in pattern.finditer(text):
                val = match.group(0)
                if pii_type == "phone" and len(val.replace("-", "").replace(" ", "").replace(".", "")) < 10:
                    continue
                findings.append({
                    "type": pii_type,
                    "matched_text": val,
                    "start": match.start(),
                    "end": match.end(),
                    "confidence": 95 if pii_type in ("email", "credit_card", "api_key") else 80
                })
        return findings

    def scan_step(self, step: Dict[str, Any]) -> List[Dict[str, Any]]:
        findings = []
        fields_to_check = [
            ("title", step.get("title") or ""),
            ("edited_title", step.get("edited_title") or ""),
            ("description", step.get("description") or ""),
            ("edited_description", step.get("edited_description") or ""),
            ("value", step.get("value") or ""),
            ("url", step.get("url") or ""),
            ("expected_result", step.get("expected_result") or "")
        ]

        for field_name, val in fields_to_check:
            sub_findings = self.scan_text(val)
            for f in sub_findings:
                f["field"] = field_name
                f["step_id"] = step.get("id")
                findings.append(f)

        return findings

    def scan_workflow(self, steps: List[Dict[str, Any]]) -> Dict[str, Any]:
        all_findings = []
        steps_with_pii = set()
        pii_counts: Dict[str, int] = {}

        for s in steps:
            f = self.scan_step(s)
            if f:
                steps_with_pii.add(s.get("id"))
                for item in f:
                    all_findings.append(item)
                    t = item["type"]
                    pii_counts[t] = pii_counts.get(t, 0) + 1

        return {
            "total_findings": len(all_findings),
            "affected_steps_count": len(steps_with_pii),
            "findings_by_type": pii_counts,
            "findings": all_findings,
            "is_clean": len(all_findings) == 0
        }

    def redact_text(self, text: str) -> Tuple[str, int]:
        if not text:
            return text, 0
        
        redacted = text
        count = 0
        for pii_type, pattern in PATTERNS.items():
            def _repl(m):
                nonlocal count
                count += 1
                return f"[REDACTED_{pii_type.upper()}]"
            redacted = pattern.sub(_repl, redacted)
            
        return redacted, count


privacy_scanner = LocalPrivacyScanner()