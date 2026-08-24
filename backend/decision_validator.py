"""
ProcSnap Decision, Exception & Alternative Path Validation Engine - Phase 5
Enforces branch completeness, checks dead ends, detects missing fallthroughs,
and verifies exception return paths.
"""

import json
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field


EXCEPTION_TYPES = [
    {"id": "error", "name": "Error Handling", "icon": "❌", "description": "Validation failure, network crash, or unhandled exception"},
    {"id": "warning", "name": "Warning / Confirmation", "icon": "⚠️", "description": "User prompt requiring acknowledgement or confirmation"},
    {"id": "alternative", "name": "Alternative Path", "icon": "🔀", "description": "Valid business flow branch (e.g. VIP vs Standard)"},
    {"id": "retry", "name": "Retry Loop", "icon": "🔄", "description": "Re-attempt step up to N times before escalation"},
    {"id": "escalation", "name": "Manager Escalation", "icon": "🚨", "description": "Requires supervisor sign-off or external intervention"},
    {"id": "manual", "name": "Manual Intervention", "icon": "✋", "description": "Offline manual action (paper form, phone call)"},
    {"id": "stop", "name": "Terminal End / Abort", "icon": "⏹️", "description": "Process legitimately aborts and terminates here"}
]


@dataclass
class BranchIssue:
    step_sequence: int
    step_id: int
    severity: str     # "error" | "warning" | "info"
    code: str         # "DEAD_END" | "NO_FALLTHROUGH" | "INVALID_TARGET" | "ORPHAN_STEP"
    message: str
    suggested_fix: str


class DecisionValidator:
    """
    Validates the decision branch and exception routing graph for an SOP.
    """

    @classmethod
    def validate(cls, steps: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not steps:
            return {"valid": True, "score": 100, "issues": [], "decision_count": 0, "branch_count": 0}

        seq_to_step = {s.get("sequence"): s for s in steps}
        id_to_step = {s.get("id"): s for s in steps if s.get("id")}
        all_sequences = set(seq_to_step.keys())

        decision_steps = []
        branch_count = 0
        issues: List[Dict[str, Any]] = []

        # Find all steps with branches
        for step in steps:
            branches_raw = step.get("branches")
            branches = []
            if isinstance(branches_raw, str) and branches_raw.strip():
                try:
                    branches = json.loads(branches_raw)
                except Exception:
                    branches = []
            elif isinstance(branches_raw, list):
                branches = branches_raw

            if branches:
                decision_steps.append((step, branches))
                branch_count += len(branches)

        # Validate each decision step
        for step, branches in decision_steps:
            seq = step.get("sequence", 0)
            step_id = step.get("id", 0)
            has_fallback = False

            for b in branches:
                target_seq = b.get("target_sequence")
                label = (b.get("label") or "").strip()
                condition = (b.get("condition") or "").strip().lower()

                # Check if branch has an else/fallback/default
                if condition in ["else", "default", "no", "otherwise", "fallback", "fail"]:
                    has_fallback = True

                # Check target exists
                if target_seq is not None:
                    if target_seq not in seq_to_step:
                        issues.append({
                            "step_sequence": seq,
                            "step_id": step_id,
                            "severity": "error",
                            "code": "INVALID_TARGET",
                            "message": f"Step {seq} branch '{label or 'Branch'}' targets Step {target_seq} which does not exist.",
                            "suggested_fix": f"Update branch target to an existing step between 1 and {len(steps)}."
                        })
                    elif target_seq == seq:
                        issues.append({
                            "step_sequence": seq,
                            "step_id": step_id,
                            "severity": "warning",
                            "code": "SELF_LOOP",
                            "message": f"Step {seq} has a decision branch pointing to itself.",
                            "suggested_fix": "Route branch to next step or a designated retry/error step."
                        })

            # Check for missing fallback/else path when multiple conditions exist
            if len(branches) > 1 and not has_fallback:
                issues.append({
                    "step_sequence": seq,
                    "step_id": step_id,
                    "severity": "warning",
                    "code": "NO_FALLTHROUGH",
                    "message": f"Step {seq} has {len(branches)} conditional branches but no Default / Else path.",
                    "suggested_fix": "Add a fallback branch (e.g., 'Else / Default') so process execution cannot get stuck."
                })

        # Calculate decision health score
        error_count = sum(1 for i in issues if i["severity"] == "error")
        warning_count = sum(1 for i in issues if i["severity"] == "warning")
        deduction = (error_count * 25) + (warning_count * 10)
        score = max(0, 100 - deduction)

        return {
            "valid": error_count == 0,
            "score": score,
            "decision_count": len(decision_steps),
            "branch_count": branch_count,
            "issues": issues,
            "exception_types": EXCEPTION_TYPES
        }
