"""
ProcSnap SOP Quality Validator & Health Scoring Engine - Phase 6
Calculates a comprehensive 100-point Health Score across Completeness,
Visual Quality, Language Clarity, Process Logic, and Governance Metadata.
"""

import json
import re
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field

try:
    from .decision_validator import DecisionValidator
except ImportError:
    from decision_validator import DecisionValidator


VERBS_REGEX = re.compile(r'\b(click|press|select|choose|enter|type|fill|submit|save|navigate|open|launch|check|verify|review|approve|reject|delete|drag|scroll|wait)\b', re.I)


class SopQualityValidator:
    """
    Evaluates an entire SOP workflow and returns a categorized audit report with health score.
    """

    @classmethod
    def evaluate(cls, workflow: Dict[str, Any], steps: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not steps:
            return {
                "overall_score": 0,
                "grade": "F",
                "categories": {
                    "completeness": {"score": 0, "weight": 30, "status": "fail"},
                    "visual_quality": {"score": 0, "weight": 25, "status": "fail"},
                    "language_clarity": {"score": 0, "weight": 20, "status": "fail"},
                    "process_logic": {"score": 0, "weight": 15, "status": "fail"},
                    "governance_metadata": {"score": 0, "weight": 10, "status": "fail"},
                },
                "issues": [{
                    "category": "completeness",
                    "severity": "error",
                    "message": "Workflow contains no recorded steps.",
                    "fix_action": "Record or insert steps into the workflow."
                }],
                "strengths": [],
                "fixable_count": 0
            }

        total_steps = len(steps)
        issues: List[Dict[str, Any]] = []
        strengths: List[str] = []

        # =====================================================================
        # 1. COMPLETENESS CHECK (30 points)
        # =====================================================================
        comp_points = 30.0
        steps_with_title = 0
        steps_with_desc = 0
        steps_with_screenshot = 0

        for s in steps:
            seq = s.get("sequence", 0)
            title = (s.get("edited_title") or s.get("title") or "").strip()
            desc = (s.get("edited_description") or s.get("description") or "").strip()
            screenshot = s.get("screenshot_path") or s.get("screenshotUrl") or ""

            if title and not title.lower().startswith("perform action"):
                steps_with_title += 1
            else:
                issues.append({
                    "category": "completeness",
                    "step_sequence": seq,
                    "step_id": s.get("id"),
                    "severity": "warning",
                    "message": f"Step {seq} has a generic or missing title.",
                    "fix_action": "auto_title",
                    "suggested_fix": "Use Auto-Titles (Phase 3) or enter a concise title."
                })

            if desc and len(desc) >= 10:
                steps_with_desc += 1
            else:
                issues.append({
                    "category": "completeness",
                    "step_sequence": seq,
                    "step_id": s.get("id"),
                    "severity": "info",
                    "message": f"Step {seq} description is brief or missing.",
                    "fix_action": "auto_desc",
                    "suggested_fix": "Add detailed step instructions or use AI Polish."
                })

            if screenshot:
                steps_with_screenshot += 1
            else:
                issues.append({
                    "category": "completeness",
                    "step_sequence": seq,
                    "step_id": s.get("id"),
                    "severity": "error",
                    "message": f"Step {seq} has no screenshot attached.",
                    "fix_action": "recapture",
                    "suggested_fix": "Capture or upload a screenshot for this step."
                })

        title_ratio = steps_with_title / total_steps
        desc_ratio = steps_with_desc / total_steps
        img_ratio = steps_with_screenshot / total_steps
        completeness_score = round(30.0 * ((title_ratio * 0.4) + (desc_ratio * 0.3) + (img_ratio * 0.3)), 1)
        if completeness_score >= 27.0:
            strengths.append(f"High completeness: {steps_with_title}/{total_steps} steps have full titles & screenshots.")

        # =====================================================================
        # 2. VISUAL QUALITY CHECK (25 points)
        # =====================================================================
        visual_points = 25.0
        recapture_needed = 0
        low_quality_count = 0
        total_quality_sum = 0

        for s in steps:
            seq = s.get("sequence", 0)
            q = s.get("screenshot_quality")
            if q is None:
                q = 85  # Default estimated quality
            total_quality_sum += q

            if s.get("recapture_suggested") or q < 65:
                recapture_needed += 1
                issues.append({
                    "category": "visual_quality",
                    "step_sequence": seq,
                    "step_id": s.get("id"),
                    "severity": "warning",
                    "message": f"Step {seq} screenshot stability was low ({q}% quality).",
                    "fix_action": "recapture",
                    "suggested_fix": "Re-capture screenshot or crop to focus area."
                })

        avg_visual_quality = total_quality_sum / total_steps
        visual_ratio = max(0.0, min(1.0, (avg_visual_quality / 100.0) - (recapture_needed * 0.05)))
        visual_score = round(25.0 * visual_ratio, 1)
        if visual_score >= 22.0:
            strengths.append(f"Clean visuals: Average screenshot stability is {int(avg_visual_quality)}%.")

        # =====================================================================
        # 3. LANGUAGE CLARITY & ACTION VERBS (20 points)
        # =====================================================================
        active_verb_steps = 0
        for s in steps:
            seq = s.get("sequence", 0)
            title = (s.get("edited_title") or s.get("title") or "").strip()
            if VERBS_REGEX.search(title):
                active_verb_steps += 1
            else:
                issues.append({
                    "category": "language_clarity",
                    "step_sequence": seq,
                    "step_id": s.get("id"),
                    "severity": "info",
                    "message": f"Step {seq} title does not start with a clear action verb (e.g. 'Click', 'Select').",
                    "fix_action": "auto_title",
                    "suggested_fix": "Prefix title with the user action (e.g. 'Click Submit Button')."
                })

        clarity_ratio = active_verb_steps / total_steps
        clarity_score = round(20.0 * clarity_ratio, 1)
        if clarity_score >= 17.0:
            strengths.append(f"Clear terminology: {active_verb_steps}/{total_steps} steps begin with standard action verbs.")

        # =====================================================================
        # 4. PROCESS LOGIC & DECISION INTEGRITY (15 points)
        # =====================================================================
        decision_eval = DecisionValidator.validate(steps)
        decision_ratio = decision_eval.get("score", 100) / 100.0
        logic_score = round(15.0 * decision_ratio, 1)

        for d_issue in decision_eval.get("issues", []):
            issues.append({
                "category": "process_logic",
                "step_sequence": d_issue.get("step_sequence"),
                "step_id": d_issue.get("step_id"),
                "severity": d_issue.get("severity", "warning"),
                "message": d_issue.get("message"),
                "fix_action": "fix_branch",
                "suggested_fix": d_issue.get("suggested_fix")
            })

        if logic_score >= 14.0:
            strengths.append("Robust branching: Decision logic and step sequences are complete with no broken links.")

        # =====================================================================
        # 5. GOVERNANCE & METADATA (10 points)
        # =====================================================================
        meta_score = 0.0
        wf_name = (workflow.get("name") or "").strip()
        wf_tags = (workflow.get("tags") or "").strip()
        wf_app = (workflow.get("application") or "").strip()

        if wf_name and not wf_name.lower().startswith("desktop workflow") and not wf_name.lower().startswith("untitled"):
            meta_score += 4.0
        else:
            issues.append({
                "category": "governance_metadata",
                "severity": "warning",
                "message": "Workflow has a default generic title.",
                "fix_action": "edit_name",
                "suggested_fix": "Give this SOP a descriptive, business-relevant title."
            })

        if wf_tags:
            meta_score += 3.0
        else:
            issues.append({
                "category": "governance_metadata",
                "severity": "info",
                "message": "No categories/tags assigned to this SOP.",
                "fix_action": "add_tags",
                "suggested_fix": "Add tags (e.g., 'Finance', 'Onboarding') to organize library."
            })

        if wf_app:
            meta_score += 3.0

        meta_score = round(meta_score, 1)
        if meta_score >= 8.0:
            strengths.append("Proper governance: Document name, tags, and system classifications are well documented.")

        # =====================================================================
        # TOTAL HEALTH SCORE & GRADE
        # =====================================================================
        overall = round(completeness_score + visual_score + clarity_score + logic_score + meta_score, 1)
        overall = max(0, min(100, int(round(overall))))

        if overall >= 95:
            grade = "A+"
            status_text = "Exceptional — Ready for Enterprise Publication"
        elif overall >= 85:
            grade = "A"
            status_text = "High Quality — Fully Approved"
        elif overall >= 75:
            grade = "B"
            status_text = "Good — Minor Improvements Recommended"
        elif overall >= 60:
            grade = "C"
            status_text = "Needs Polish Before Sharing"
        else:
            grade = "D"
            status_text = "Draft Incomplete — Needs Review"

        fixable_count = sum(1 for i in issues if i.get("fix_action") in ["auto_title", "auto_desc", "add_tags"])

        return {
            "overall_score": overall,
            "grade": grade,
            "status_text": status_text,
            "total_steps": total_steps,
            "categories": {
                "completeness": {
                    "score": completeness_score,
                    "max": 30,
                    "percentage": int((completeness_score / 30.0) * 100),
                    "label": "Completeness",
                    "status": "pass" if completeness_score >= 24 else "warning"
                },
                "visual_quality": {
                    "score": visual_score,
                    "max": 25,
                    "percentage": int((visual_score / 25.0) * 100),
                    "label": "Visual Stability",
                    "status": "pass" if visual_score >= 20 else "warning"
                },
                "language_clarity": {
                    "score": clarity_score,
                    "max": 20,
                    "percentage": int((clarity_score / 20.0) * 100),
                    "label": "Action Verb Clarity",
                    "status": "pass" if clarity_score >= 15 else "warning"
                },
                "process_logic": {
                    "score": logic_score,
                    "max": 15,
                    "percentage": int((logic_score / 15.0) * 100),
                    "label": "Decision & Logic Paths",
                    "status": "pass" if logic_score >= 12 else "warning"
                },
                "governance_metadata": {
                    "score": meta_score,
                    "max": 10,
                    "percentage": int((meta_score / 10.0) * 100),
                    "label": "Metadata & Tags",
                    "status": "pass" if meta_score >= 7 else "warning"
                }
            },
            "issues": issues,
            "strengths": strengths,
            "fixable_count": fixable_count
        }
