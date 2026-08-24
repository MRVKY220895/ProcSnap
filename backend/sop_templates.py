"""
ProcSnap SOP Templates & Variable Substitution Engine - Phase 4
Standard SOP, Work Instruction, Compliance SOP templates and variable manager
"""

import json
import re
from typing import Dict, Any, List, Optional

SOP_TEMPLATE_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "standard": {
        "id": "standard",
        "name": "Standard Operating Procedure (SOP)",
        "icon": "📋",
        "description": "Comprehensive enterprise SOP covering purpose, scope, roles, step-by-step procedure, decisions, and revision history.",
        "sections": [
            {"id": "purpose", "title": "1. Purpose & Objectives", "required": True, "placeholder": "Describe why this procedure exists and what business outcome it delivers."},
            {"id": "scope", "title": "2. Scope & Applicability", "required": True, "placeholder": "Specify the departments, systems, and roles to which this procedure applies."},
            {"id": "prerequisites", "title": "3. Prerequisites & Access", "required": False, "placeholder": "List required accounts, tools, VPN access, or permissions."},
            {"id": "roles", "title": "4. Roles & Responsibilities", "required": True, "placeholder": "Define who performs, reviews, and approves this procedure."},
            {"id": "procedure", "title": "5. Step-by-Step Procedure", "required": True, "placeholder": "The captured workflow steps and screenshots."},
            {"id": "decisions", "title": "6. Decision Points & Branches", "required": False, "placeholder": "Logic branches and criteria for different outcomes."},
            {"id": "exceptions", "title": "7. Exception Handling & Troubleshooting", "required": False, "placeholder": "What to do if errors, edge cases, or escalations occur."},
            {"id": "revision_history", "title": "8. Revision History & Approvals", "required": True, "placeholder": "Version history, author, reviewer, and approval dates."}
        ],
        "default_variables": {
            "COMPANY_NAME": "Acme Corp",
            "SYSTEM_ENV": "Production",
            "ROLE_PRIMARY": "Process Operator"
        }
    },
    "work_instruction": {
        "id": "work_instruction",
        "name": "Work Instruction (Task Level)",
        "icon": "⚡",
        "description": "Concise, step-heavy tactical instruction focused on execution with minimal governance overhead.",
        "sections": [
            {"id": "task_overview", "title": "Task Overview", "required": True, "placeholder": "Brief description of the exact task to perform."},
            {"id": "before_you_begin", "title": "Before You Begin", "required": True, "placeholder": "Input data needed and prerequisite window to open."},
            {"id": "steps", "title": "Execution Steps", "required": True, "placeholder": "Actionable steps with screenshots."},
            {"id": "expected_result", "title": "Expected Final Output", "required": True, "placeholder": "What the completed screen/data looks like."},
            {"id": "quick_troubleshooting", "title": "Quick Troubleshooting", "required": False, "placeholder": "Common mistakes and how to undo/fix."}
        ],
        "default_variables": {
            "USER_ROLE": "Technician",
            "TARGET_APPLICATION": "Web App"
        }
    },
    "compliance": {
        "id": "compliance",
        "name": "Regulatory & Compliance SOP (SOX / ISO / GxP)",
        "icon": "🛡️",
        "description": "Audit-ready compliant procedure with control IDs, risk classifications, mandatory approval gates, and evidence capture.",
        "sections": [
            {"id": "control_objective", "title": "1. Control Objective & Standard", "required": True, "placeholder": "e.g., SOX Control ITGC-04 / ISO 27001 A.9 / GxP Data Integrity."},
            {"id": "scope_and_risk", "title": "2. Risk Level & Scope", "required": True, "placeholder": "Risk classification (High/Medium/Low) and impacted regulated systems."},
            {"id": "roles_segregation", "title": "3. Segregation of Duties & Roles", "required": True, "placeholder": "Maker/Checker roles and required certifications."},
            {"id": "audit_procedure", "title": "4. Compliant Procedure Steps", "required": True, "placeholder": "Step execution with highlighted mandatory control gates."},
            {"id": "evidence_retention", "title": "5. Evidence Capture & Retention", "required": True, "placeholder": "What logs, screenshots, or receipts must be archived and where."},
            {"id": "exception_escalation", "title": "6. Incident & Exception Escalation Path", "required": True, "placeholder": "Mandatory breach reporting within specified SLA."},
            {"id": "governance_signoff", "title": "7. Compliance Sign-off & Audit Trail", "required": True, "placeholder": "Sign-off signatures and retention schedule."}
        ],
        "default_variables": {
            "CONTROL_ID": "CTL-2026-001",
            "RISK_RATING": "HIGH",
            "COMPLIANCE_FRAMEWORK": "ISO 9001 / SOX",
            "REVIEW_CADENCE": "Annual"
        }
    }
}


class VariableEngine:
    """
    Substitutes {{VARIABLE_NAME}} tokens in text with values defined in the workflow's variable dictionary.
    """

    @staticmethod
    def extract_variables(text: str) -> List[str]:
        if not text:
            return []
        matches = re.findall(r'\{\{([A-Za-z0-9_]+)\}\}', text)
        return sorted(list(set(matches)))

    @staticmethod
    def replace_variables(text: str, variables: Dict[str, str]) -> str:
        if not text or not variables:
            return text or ""
        
        def repl(match):
            var_name = match.group(1)
            return str(variables.get(var_name, match.group(0)))

        return re.sub(r'\{\{([A-Za-z0-9_]+)\}\}', repl, text)

    @classmethod
    def apply_variables_to_workflow(cls, workflow_dict: Dict[str, Any], variables: Dict[str, str]) -> Dict[str, Any]:
        """
        Recursively applies variable substitution to workflow name, steps, titles, descriptions, and notes.
        """
        if not variables:
            return workflow_dict

        result = dict(workflow_dict)
        if "name" in result:
            result["name"] = cls.replace_variables(result["name"], variables)
        if "description" in result:
            result["description"] = cls.replace_variables(result["description"], variables)

        if "steps" in result and isinstance(result["steps"], list):
            new_steps = []
            for s in result["steps"]:
                s_copy = dict(s)
                for field in ["title", "description", "note", "expected", "value"]:
                    if field in s_copy and isinstance(s_copy[field], str):
                        s_copy[field] = cls.replace_variables(s_copy[field], variables)
                new_steps.append(s_copy)
            result["steps"] = new_steps

        return result
