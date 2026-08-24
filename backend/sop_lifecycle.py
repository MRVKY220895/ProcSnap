"""
ProcSnap SOP Lifecycle & Version Management Engine - Phase 8
Manages versions (v1.0 -> v2.0), status lifecycle (Draft -> Published -> Archived),
snapshot comparisons, and review cadences.
"""

import json
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone


LIFECYCLE_STATUSES = [
    {"id": "draft", "name": "Draft", "icon": "📝", "color": "#94a3b8", "description": "Work in progress, not ready for team execution."},
    {"id": "under_review", "name": "Under Review", "icon": "👀", "color": "#f59e0b", "description": "Submitted for technical or compliance sign-off."},
    {"id": "approved", "name": "Approved", "icon": "✅", "color": "#10b981", "description": "Signed off and verified by process owner."},
    {"id": "published", "name": "Published", "icon": "🚀", "color": "#6366f1", "description": "Live official procedure in production knowledge base."},
    {"id": "review_due", "name": "Review Due", "icon": "⏰", "color": "#ec4899", "description": "Scheduled review date has elapsed; requires recertification."},
    {"id": "archived", "name": "Archived", "icon": "📦", "color": "#64748b", "description": "Deprecated or superseded by a newer procedure."}
]


class VersionDiffEngine:
    """
    Compares two JSON workflow snapshots and produces a human-readable diff.
    """

    @classmethod
    def compare_snapshots(cls, v1_data: Dict[str, Any], v2_data: Dict[str, Any]) -> Dict[str, Any]:
        v1_steps = v1_data.get("steps", [])
        v2_steps = v2_data.get("steps", [])

        v1_map = {s.get("sequence", idx + 1): s for idx, s in enumerate(v1_steps)}
        v2_map = {s.get("sequence", idx + 1): s for idx, s in enumerate(v2_steps)}

        added_steps = []
        removed_steps = []
        modified_steps = []
        unchanged_steps = []

        all_seqs = sorted(list(set(v1_map.keys()).union(set(v2_map.keys()))))

        for seq in all_seqs:
            s1 = v1_map.get(seq)
            s2 = v2_map.get(seq)

            if s1 and not s2:
                removed_steps.append({
                    "sequence": seq,
                    "title": s1.get("title") or s1.get("edited_title") or f"Step {seq}",
                    "action": s1.get("action")
                })
            elif not s1 and s2:
                added_steps.append({
                    "sequence": seq,
                    "title": s2.get("title") or s2.get("edited_title") or f"Step {seq}",
                    "action": s2.get("action")
                })
            else:
                # Compare title and description
                t1 = (s1.get("title") or s1.get("edited_title") or "").strip()
                t2 = (s2.get("title") or s2.get("edited_title") or "").strip()
                d1 = (s1.get("description") or s1.get("edited_description") or "").strip()
                d2 = (s2.get("description") or s2.get("edited_description") or "").strip()

                if t1 != t2 or d1 != d2:
                    modified_steps.append({
                        "sequence": seq,
                        "old_title": t1,
                        "new_title": t2,
                        "old_description": d1,
                        "new_description": d2
                    })
                else:
                    unchanged_steps.append(seq)

        total_changes = len(added_steps) + len(removed_steps) + len(modified_steps)
        total_steps = max(len(v1_steps), len(v2_steps), 1)
        similarity_score = max(0, int(100 - (total_changes / total_steps * 100)))

        return {
            "similarity_score": similarity_score,
            "added_count": len(added_steps),
            "removed_count": len(removed_steps),
            "modified_count": len(modified_steps),
            "unchanged_count": len(unchanged_steps),
            "added_steps": added_steps,
            "removed_steps": removed_steps,
            "modified_steps": modified_steps,
            "v1_version": v1_data.get("version", "v1.0"),
            "v2_version": v2_data.get("version", "v2.0")
        }
