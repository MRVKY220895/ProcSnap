"""
ProcSnap Portable Package Manager
Exports and imports complete, self-contained .procsnap.zip packages.
"""

import os
import io
import json
import zipfile
import shutil
import sqlite3
from typing import Dict, Any, Tuple, Optional


class PackageManager:
    def __init__(self, db_path: str = "backend/procsnap.db", screenshots_dir: str = "backend/screenshots"):
        self.db_path = db_path
        self.screenshots_dir = screenshots_dir

    def export_package(self, workflow_id: str) -> Tuple[io.BytesIO, str]:
        """
        Bundles workflow JSON, step edits, and all screenshots into a .procsnap.zip buffer.
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        wf = cur.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
        if not wf:
            conn.close()
            raise ValueError(f"Workflow {workflow_id} not found")

        wf_dict = dict(wf)

        steps = [dict(r) for r in cur.execute(
            "SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY sequence ASC", (workflow_id,)
        ).fetchall()]

        edits = {str(r["step_id"]): dict(r) for r in cur.execute(
            "SELECT * FROM step_edits WHERE workflow_id = ?", (workflow_id,)
        ).fetchall()}

        annotations = {str(r["step_id"]): dict(r) for r in cur.execute(
            "SELECT * FROM step_annotations WHERE workflow_id = ?", (workflow_id,)
        ).fetchall()}

        versions = [dict(r) for r in cur.execute(
            "SELECT * FROM workflow_versions WHERE workflow_id = ?", (workflow_id,)
        ).fetchall()]

        conn.close()

        manifest = {
            "format": "procsnap_portable_package",
            "version": "2.0",
            "exported_at": wf_dict.get("updated_at") or wf_dict.get("created_at"),
            "workflow_id": workflow_id,
            "name": wf_dict.get("name", "Untitled Workflow"),
            "step_count": len(steps)
        }

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
            zf.writestr("workflow.json", json.dumps(wf_dict, indent=2))
            zf.writestr("steps.json", json.dumps(steps, indent=2))
            zf.writestr("edits.json", json.dumps(edits, indent=2))
            zf.writestr("annotations.json", json.dumps(annotations, indent=2))
            zf.writestr("versions.json", json.dumps(versions, indent=2))

            for s in steps:
                scr_path = s.get("screenshot_path")
                if scr_path and os.path.exists(scr_path):
                    arcname = f"screenshots/{os.path.basename(scr_path)}"
                    zf.write(scr_path, arcname=arcname)
                elif scr_path:
                    # check relative
                    rel = os.path.join(self.screenshots_dir, os.path.basename(scr_path))
                    if os.path.exists(rel):
                        zf.write(rel, arcname=f"screenshots/{os.path.basename(scr_path)}")

        zip_buffer.seek(0)
        safe_name = "".join(c for c in wf_dict.get("name", "workflow") if c.isalnum() or c in (" ", "_", "-")).strip()
        filename = f"{safe_name or 'workflow'}.procsnap.zip"
        return zip_buffer, filename

    def import_package(self, zip_bytes: bytes) -> Dict[str, Any]:
        """
        Extracts .procsnap.zip and imports workflow, steps, annotations, and screenshots.
        """
        zip_buffer = io.BytesIO(zip_bytes)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            namelist = zf.namelist()
            if "manifest.json" not in namelist or "workflow.json" not in namelist:
                raise ValueError("Invalid .procsnap.zip package: manifest.json or workflow.json missing")

            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            wf = json.loads(zf.read("workflow.json").decode("utf-8"))
            steps = json.loads(zf.read("steps.json").decode("utf-8")) if "steps.json" in namelist else []
            edits = json.loads(zf.read("edits.json").decode("utf-8")) if "edits.json" in namelist else {}
            annotations = json.loads(zf.read("annotations.json").decode("utf-8")) if "annotations.json" in namelist else {}
            versions = json.loads(zf.read("versions.json").decode("utf-8")) if "versions.json" in namelist else []

            os.makedirs(self.screenshots_dir, exist_ok=True)

            # Unpack screenshots
            for name in namelist:
                if name.startswith("screenshots/") and not name.endswith("/"):
                    target_file = os.path.join(self.screenshots_dir, os.path.basename(name))
                    with open(target_file, "wb") as out_f:
                        out_f.write(zf.read(name))

        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()

        # Insert or replace workflow
        cur.execute(
            """
            INSERT OR REPLACE INTO workflows (
                id, name, application, status, started_at, ended_at, created_at, updated_at,
                tags, current_version, lifecycle_status, review_due_date, department, owner,
                reviewer, approver, effective_date, review_frequency_days, preconditions_json, postconditions_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                wf.get("id"), wf.get("name"), wf.get("application", "Desktop"), wf.get("status", "completed"),
                wf.get("started_at"), wf.get("ended_at"), wf.get("created_at"), wf.get("updated_at"),
                wf.get("tags", ""), wf.get("current_version", "1.0"), wf.get("lifecycle_status", "draft"),
                wf.get("review_due_date"), wf.get("department", ""), wf.get("owner", ""),
                wf.get("reviewer", ""), wf.get("approver", ""), wf.get("effective_date", ""),
                wf.get("review_frequency_days", 90), wf.get("preconditions_json", "[]"), wf.get("postconditions_json", "[]")
            )
        )

        # Delete existing steps for clean replace
        cur.execute("DELETE FROM workflow_steps WHERE workflow_id = ?", (wf["id"],))
        cur.execute("DELETE FROM step_edits WHERE workflow_id = ?", (wf["id"],))
        cur.execute("DELETE FROM step_annotations WHERE workflow_id = ?", (wf["id"],))

        old_to_new_step_id = {}

        for s in steps:
            old_id = s.get("id")
            scr_path = s.get("screenshot_path", "")
            if scr_path:
                scr_path = f"backend/screenshots/{os.path.basename(scr_path)}"

            cur.execute(
                """
                INSERT INTO workflow_steps (
                    workflow_id, sequence, action, timestamp, url, title, value,
                    selected_text, previous_url, checked, element_json, screenshot_path,
                    expected_result, phase_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    wf["id"], s.get("sequence", 1), s.get("action", "click"), s.get("timestamp", ""),
                    s.get("url", ""), s.get("title", ""), s.get("value", ""), s.get("selected_text", ""),
                    s.get("previous_url", ""), s.get("checked", 0), s.get("element_json", "{}"), scr_path,
                    s.get("expected_result", ""), s.get("phase_name", "Execution")
                )
            )
            new_id = cur.lastrowid
            if old_id:
                old_to_new_step_id[str(old_id)] = new_id

        # Insert edits
        for old_id_str, e in edits.items():
            new_id = old_to_new_step_id.get(old_id_str)
            if new_id:
                cur.execute(
                    """
                    INSERT OR REPLACE INTO step_edits (
                        step_id, workflow_id, title, description, note, expected, voiceover,
                        hidden, updated_at, expected_result, phase_name, business_intent
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id, wf["id"], e.get("title"), e.get("description"), e.get("note"),
                        e.get("expected"), e.get("voiceover"), e.get("hidden", 0), e.get("updated_at", ""),
                        e.get("expected_result", ""), e.get("phase_name", "Execution"), e.get("business_intent", "")
                    )
                )

        conn.commit()
        conn.close()

        return {
            "success": True,
            "workflow_id": wf["id"],
            "name": wf.get("name"),
            "steps_imported": len(steps)
        }


package_manager = PackageManager()