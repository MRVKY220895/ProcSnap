import base64
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4
import subprocess
import sys
import threading
import edge_tts
import asyncio
import os
import shutil
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


# =========================================================
# APPLICATION
# =========================================================

app = FastAPI(title="ProcSnap API", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parent
MEDIA_DIR = BASE_DIR / "media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

# Serve dashboard static files
app.mount(
    "/dashboard",
    StaticFiles(directory=BASE_DIR.parent / "dashboard"),
    name="dashboard",
)
app.mount(
    "/media",
    StaticFiles(directory=MEDIA_DIR),
    name="media",
)



# =========================================================
# CORS
# =========================================================

@app.middleware("http")
async def add_cors_pna_headers(request, call_next):
    if request.method == "OPTIONS":
        from fastapi.responses import Response
        response = Response(status_code=204)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# DATABASE / FILE STORAGE
# =========================================================

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "procsnap.db"
SCREENSHOTS_DIR = BASE_DIR / "screenshots"

SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(
        DATABASE_PATH,
        check_same_thread=False,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            application TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS workflow_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            action TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            url TEXT,
            title TEXT,
            value TEXT,
            selected_text TEXT,
            previous_url TEXT,
            checked INTEGER,
            element_json TEXT,
            screenshot_path TEXT,
            FOREIGN KEY (workflow_id)
                REFERENCES workflows(id)
                ON DELETE CASCADE
        )
        """
    )

    columns = {
        row["name"]
        for row in cursor.execute(
            "PRAGMA table_info(workflow_steps)"
        ).fetchall()
    }

    if "screenshot_path" not in columns:
        cursor.execute(
            """
            ALTER TABLE workflow_steps
            ADD COLUMN screenshot_path TEXT
            """
        )

    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS
        idx_workflow_steps_workflow_id
        ON workflow_steps(workflow_id)
        """
    )

    cursor.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
        idx_workflow_steps_workflow_sequence
        ON workflow_steps(workflow_id, sequence)
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS step_annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_id INTEGER NOT NULL UNIQUE,
            workflow_id TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS step_edits (
            step_id INTEGER PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            title TEXT,
            description TEXT,
            note TEXT,
            expected TEXT,
            voiceover TEXT,
            hidden INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        )
        """
    )

    try:
        cursor.execute("ALTER TABLE step_edits ADD COLUMN voiceover TEXT")
    except Exception:
        pass

    connection.commit()
    connection.close()


initialize_database()

def perform_auto_backup():
    try:
        if not DATABASE_PATH.exists():
            return
        backup_dir = BASE_DIR / "storage" / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        backups = sorted(list(backup_dir.glob("procsnap_backup_*.db")))
        while len(backups) >= 5:
            try:
                backups.pop(0).unlink()
            except Exception as e:
                print("Error removing oldest backup:", e)
                break
                
        import shutil
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = backup_dir / f"procsnap_backup_{timestamp}.db"
        shutil.copy2(DATABASE_PATH, backup_file)
        print(f"Auto-backup created successfully: {backup_file.name}")
    except Exception as e:
        print("Auto-backup failed:", e)

# Perform startup backup
perform_auto_backup()


# =========================================================
# MODELS
# =========================================================

# ElementInfo intentionally permits additional screen metadata through the
# existing JSON storage path. The extension sends:
# element.screen = {
#   x, y, width, height,
#   viewportWidth, viewportHeight,
#   devicePixelRatio
# }
# No database migration is required because element_json is stored as JSON text.
#
class ElementInfo(BaseModel):
    tagName: Optional[str] = None
    id: Optional[str] = None
    className: Optional[str] = None
    text: Optional[str] = None
    name: Optional[str] = None
    placeholder: Optional[str] = None
    type: Optional[str] = None
    ariaLabel: Optional[str] = None
    role: Optional[str] = None
    title: Optional[str] = None
    dataTestId: Optional[str] = None
    cssSelector: Optional[str] = None
    screen: Optional[dict] = None
    xpath: Optional[str] = None


class WorkflowStep(BaseModel):
    action: str
    timestamp: str
    url: str
    title: Optional[str] = None
    value: Optional[str] = None
    selectedText: Optional[str] = None
    previousUrl: Optional[str] = None
    checked: Optional[bool] = None
    element: Optional[ElementInfo] = None


class StartSessionRequest(BaseModel):
    name: Optional[str] = None
    application: Optional[str] = None


class UpdateWorkflowRequest(BaseModel):
    name: str


class ScreenshotRequest(BaseModel):
    sessionId: str
    image: str
    stepId: Optional[int] = None


class StepAnnotationRequest(BaseModel):
    data: str  # JSON array of annotation objects


class StepEditRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    note: Optional[str] = None
    expected: Optional[str] = None
    voiceover: Optional[str] = None
    hidden: Optional[bool] = None
    checked: Optional[bool] = None


# =========================================================
# UTILITY
# =========================================================

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_step_count_with_connection(
    cursor: sqlite3.Cursor,
    workflow_id: str,
) -> int:
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM workflow_steps
        WHERE workflow_id = ?
        """,
        (workflow_id,),
    )
    return int(cursor.fetchone()["count"])


def get_step_count(workflow_id: str) -> int:
    connection = get_connection()
    try:
        return get_step_count_with_connection(
            connection.cursor(),
            workflow_id,
        )
    finally:
        connection.close()


# =========================================================
# SERIALIZATION
# =========================================================

def row_to_workflow(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "application": row["application"],
        "status": row["status"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "stepCount": get_step_count(row["id"]),
    }


def step_to_response(row: sqlite3.Row) -> dict:
    element = None

    if row["element_json"]:
        try:
            element = json.loads(row["element_json"])
        except (json.JSONDecodeError, TypeError):
            element = None

    screenshot_path = row["screenshot_path"]

    screenshot_url = None
    if screenshot_path:
        screenshot_url = (
            f"/screenshots/{row['workflow_id']}/"
            f"{Path(screenshot_path).name}"
        )

    return {
        "id": row["id"],
        "sequence": row["sequence"],
        "action": row["action"],
        "timestamp": row["timestamp"],
        "url": row["url"],
        "title": row["title"],
        "value": row["value"],
        "selectedText": row["selected_text"],
        "previousUrl": row["previous_url"],
        "checked": (
            bool(row["checked"])
            if row["checked"] is not None
            else None
        ),
        "element": element,
        "screenshotPath": screenshot_path,
        "screenshotUrl": screenshot_url,
    }


# =========================================================
# ROOT
# =========================================================

@app.get("/")
def root():
    return {
        "application": "ProcSnap",
        "status": "running",
        "database": str(DATABASE_PATH),
        "screenshots": str(SCREENSHOTS_DIR),
        "timestamp": utc_now(),
    }


# =========================================================
# HEALTH
# =========================================================

@app.get("/health")
def health():
    connection = get_connection()
    try:
        connection.execute("SELECT 1").fetchone()
    finally:
        connection.close()

    return {
        "status": "healthy",
        "database": "connected",
    }


# =========================================================
# CREATE WORKFLOW / START RECORDING
# =========================================================

@app.post("/sessions")
def start_session(request: StartSessionRequest):
    workflow_id = str(uuid4())
    now = utc_now()

    name = request.name or "Untitled Workflow"
    application = request.application or "Chrome"

    connection = get_connection()

    try:
        connection.execute(
            """
            INSERT INTO workflows (
                id,
                name,
                application,
                status,
                started_at,
                ended_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workflow_id,
                name,
                application,
                "recording",
                now,
                None,
                now,
                now,
            ),
        )
        connection.commit()
    finally:
        connection.close()

    print()
    print("======================================")
    print("NEW RECORDING SESSION")
    print("======================================")
    print("Session ID:", workflow_id)
    print("Name:", name)
    print("Application:", application)
    print("Database:", DATABASE_PATH)
    print("======================================")
    print()

    return {
        "success": True,
        "session": {
            "id": workflow_id,
            "name": name,
            "application": application,
            "status": "recording",
            "startedAt": now,
            "endedAt": None,
            "stepCount": 0,
            "steps": [],
        },
    }


# =========================================================
# STOP WORKFLOW
# =========================================================

@app.post("/sessions/{session_id}/stop")
def stop_session(session_id: str):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT *
            FROM workflows
            WHERE id = ?
            """,
            (session_id,),
        )

        workflow = cursor.fetchone()

        if not workflow:
            raise HTTPException(
                status_code=404,
                detail="Recording session not found",
            )

        ended_at = utc_now()

        cursor.execute(
            """
            UPDATE workflows
            SET
                status = ?,
                ended_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                "completed",
                ended_at,
                ended_at,
                session_id,
            ),
        )

        step_count = get_step_count_with_connection(
            cursor,
            session_id,
        )

        connection.commit()

    finally:
        connection.close()

    print()
    print("======================================")
    print("RECORDING SESSION COMPLETED")
    print("======================================")
    print("Session ID:", session_id)
    print("Steps:", step_count)
    print("======================================")
    print()

    return {
        "success": True,
        "session": {
            "id": workflow["id"],
            "name": workflow["name"],
            "application": workflow["application"],
            "status": "completed",
            "startedAt": workflow["started_at"],
            "endedAt": ended_at,
            "stepCount": step_count,
            "steps": [],
        },
    }


# =========================================================
# GET ALL WORKFLOWS
# =========================================================

@app.get("/sessions")
def get_sessions():
    connection = get_connection()

    try:
        rows = connection.execute(
            """
            SELECT w.id, w.name, w.application, w.status, w.started_at, w.ended_at,
                   COUNT(s.id) AS step_count
            FROM workflows w
            LEFT JOIN workflow_steps s ON w.id = s.workflow_id
            GROUP BY w.id
            ORDER BY w.created_at DESC
            """
        ).fetchall()

        result = [
            {
                "id": row["id"],
                "name": row["name"],
                "application": row["application"],
                "status": row["status"],
                "startedAt": row["started_at"],
                "endedAt": row["ended_at"],
                "stepCount": row["step_count"],
            }
            for row in rows
        ]

    finally:
        connection.close()

    return {
        "count": len(result),
        "sessions": result,
    }


# =========================================================
# GET SINGLE WORKFLOW
# =========================================================

@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT *
            FROM workflows
            WHERE id = ?
            """,
            (session_id,),
        )

        workflow = cursor.fetchone()

        if not workflow:
            raise HTTPException(
                status_code=404,
                detail="Recording session not found",
            )

        step_rows = cursor.execute(
            """
            SELECT *
            FROM workflow_steps
            WHERE workflow_id = ?
            ORDER BY sequence ASC
            """,
            (session_id,),
        ).fetchall()

        # Fetch all annotations for this workflow
        annotations_rows = cursor.execute(
            """
            SELECT step_id, data
            FROM step_annotations
            WHERE workflow_id = ?
            """,
            (session_id,),
        ).fetchall()
        annotations_map = {row["step_id"]: row["data"] for row in annotations_rows}

        # Fetch all edits for this workflow
        edits_rows = cursor.execute(
            """
            SELECT step_id, title, description, note, expected, hidden
            FROM step_edits
            WHERE workflow_id = ?
            """,
            (session_id,),
        ).fetchall()
        edits_map = {row["step_id"]: row for row in edits_rows}

        steps = []
        for row in step_rows:
            step_dict = step_to_response(row)
            step_id = step_dict["id"]
            
            # Merge annotations
            step_dict["annotations"] = json.loads(annotations_map.get(step_id, "[]"))
            
            # Merge edits
            if step_id in edits_map:
                edit = edits_map[step_id]
                step_dict["title"] = edit["title"] if edit["title"] is not None else step_dict["title"]
                step_dict["description"] = edit["description"] if edit["description"] is not None else step_dict["description"]
                step_dict["note"] = edit["note"] or ""
                step_dict["expected"] = edit["expected"] or ""
                step_dict["hidden"] = bool(edit["hidden"])
            else:
                step_dict["note"] = ""
                step_dict["expected"] = ""
                step_dict["hidden"] = False
                
            steps.append(step_dict)

        return {
            "id": workflow["id"],
            "name": workflow["name"],
            "application": workflow["application"],
            "status": workflow["status"],
            "startedAt": workflow["started_at"],
            "endedAt": workflow["ended_at"],
            "stepCount": len(steps),
            "steps": steps,
        }

    finally:
        connection.close()


# =========================================================
# ADD STEP
# =========================================================

@app.post("/sessions/{session_id}/steps")
def add_step(
    session_id: str,
    step: WorkflowStep,
):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT status
            FROM workflows
            WHERE id = ?
            """,
            (session_id,),
        )

        workflow = cursor.fetchone()

        if not workflow:
            raise HTTPException(
                status_code=404,
                detail="Recording session not found",
            )

        if workflow["status"] != "recording":
            raise HTTPException(
                status_code=400,
                detail="Recording session is not active",
            )

        cursor.execute(
            """
            SELECT COALESCE(MAX(sequence), 0) + 1
            AS next_sequence
            FROM workflow_steps
            WHERE workflow_id = ?
            """,
            (session_id,),
        )

        sequence = int(
            cursor.fetchone()["next_sequence"]
        )

        element_json = None

        if step.element is not None:
            element_json = json.dumps(
                step.element.model_dump()
            )

        checked_value = None

        if step.checked is not None:
            checked_value = (
                1 if step.checked else 0
            )

        cursor.execute(
            """
            INSERT INTO workflow_steps (
                workflow_id,
                sequence,
                action,
                timestamp,
                url,
                title,
                value,
                selected_text,
                previous_url,
                checked,
                element_json,
                screenshot_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                sequence,
                step.action,
                step.timestamp,
                step.url,
                step.title,
                step.value,
                step.selectedText,
                step.previousUrl,
                checked_value,
                element_json,
                None,
            ),
        )

        step_id = cursor.lastrowid

        cursor.execute(
            """
            UPDATE workflows
            SET updated_at = ?
            WHERE id = ?
            """,
            (
                utc_now(),
                session_id,
            ),
        )

        connection.commit()

    finally:
        connection.close()

    print(
        f"Session {session_id} | "
        f"Step {sequence} | "
        f"Action: {step.action}"
    )

    return {
        "success": True,
        "sessionId": session_id,
        "step": {
            "id": step_id,
            "sequence": sequence,
            **step.model_dump(),
        },
    }


# =========================================================
# SAVE SCREENSHOT
# =========================================================

@app.post("/screenshots")
def save_screenshot(request: ScreenshotRequest):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT id
            FROM workflows
            WHERE id = ?
            """,
            (request.sessionId,),
        )

        workflow = cursor.fetchone()

        if not workflow:
            raise HTTPException(
                status_code=404,
                detail="Workflow not found",
            )

        match = re.fullmatch(
            r"data:image/png;base64,(.+)",
            request.image,
            flags=re.DOTALL,
        )

        if not match:
            raise HTTPException(
                status_code=400,
                detail="Invalid PNG data URL",
            )

        try:
            image_bytes = base64.b64decode(
                match.group(1),
                validate=True,
            )
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="Invalid base64 image data",
            )

        if not image_bytes:
            raise HTTPException(
                status_code=400,
                detail="Screenshot is empty",
            )

        if request.stepId is not None:
            cursor.execute(
                """
                SELECT *
                FROM workflow_steps
                WHERE id = ?
                  AND workflow_id = ?
                """,
                (
                    request.stepId,
                    request.sessionId,
                ),
            )
        else:
            cursor.execute(
                """
                SELECT *
                FROM workflow_steps
                WHERE workflow_id = ?
                ORDER BY sequence DESC
                LIMIT 1
                """,
                (request.sessionId,),
            )

        step_row = cursor.fetchone()

        if not step_row:
            raise HTTPException(
                status_code=404,
                detail="No workflow step found for screenshot",
            )

        sequence = int(step_row["sequence"])

        screenshot_dir = (
            SCREENSHOTS_DIR /
            request.sessionId
        )

        screenshot_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        filename = f"step-{sequence:03d}.png"
        filepath = screenshot_dir / filename

        filepath.write_bytes(image_bytes)

        relative_path = str(
            Path("screenshots") /
            request.sessionId /
            filename
        )

        cursor.execute(
            """
            UPDATE workflow_steps
            SET screenshot_path = ?
            WHERE id = ?
              AND workflow_id = ?
            """,
            (
                relative_path,
                step_row["id"],
                request.sessionId,
            ),
        )

        cursor.execute(
            """
            UPDATE workflows
            SET updated_at = ?
            WHERE id = ?
            """,
            (
                utc_now(),
                request.sessionId,
            ),
        )

        connection.commit()

    finally:
        connection.close()

    print("Screenshot saved:", filepath)

    return {
        "success": True,
        "sessionId": request.sessionId,
        "stepId": step_row["id"],
        "sequence": sequence,
        "filename": filename,
        "path": relative_path,
        "url": (
            f"/screenshots/"
            f"{request.sessionId}/"
            f"{filename}"
        ),
        "size": len(image_bytes),
    }


# =========================================================
# GET SCREENSHOT FILE
# =========================================================

@app.get("/screenshots/{session_id}/{filename}")
def get_screenshot(
    session_id: str,
    filename: str,
):
    safe_filename = Path(filename).name

    if safe_filename != filename:
        raise HTTPException(
            status_code=400,
            detail="Invalid screenshot filename",
        )

    filepath = (
        SCREENSHOTS_DIR /
        session_id /
        safe_filename
    )

    if not filepath.is_file():
        raise HTTPException(
            status_code=404,
            detail="Screenshot not found",
        )

    return FileResponse(
        path=filepath,
        media_type="image/png",
        filename=safe_filename,
    )


# =========================================================
# RENAME WORKFLOW
# =========================================================

@app.patch("/sessions/{session_id}")
def rename_session(
    session_id: str,
    request: UpdateWorkflowRequest,
):
    name = request.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Workflow name cannot be empty",
        )

    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            UPDATE workflows
            SET
                name = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                name,
                utc_now(),
                session_id,
            ),
        )

        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Workflow not found",
            )

        connection.commit()

    finally:
        connection.close()

    return {
        "success": True,
        "message": "Workflow renamed",
    }


# =========================================================
# DELETE WORKFLOW
# =========================================================

@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT id
            FROM workflows
            WHERE id = ?
            """,
            (session_id,),
        )

        workflow = cursor.fetchone()

        if not workflow:
            raise HTTPException(
                status_code=404,
                detail="Workflow not found",
            )

        cursor.execute(
            """
            DELETE FROM workflow_steps
            WHERE workflow_id = ?
            """,
            (session_id,),
        )

        cursor.execute(
            """
            DELETE FROM workflows
            WHERE id = ?
            """,
            (session_id,),
        )

        connection.commit()

    finally:
        connection.close()

    screenshot_dir = (
        SCREENSHOTS_DIR /
        session_id
    )

    if screenshot_dir.exists():
        for file in screenshot_dir.glob("*"):
            if file.is_file():
                try:
                    file.unlink()
                except OSError:
                    pass

        try:
            screenshot_dir.rmdir()
        except OSError:
            pass

    return {
        "success": True,
        "message": "Workflow deleted",
    }


# =========================================================
# ANNOTATIONS CRUD
# =========================================================

@app.get("/sessions/{session_id}/steps/{step_id}/annotations")
def get_step_annotations(session_id: str, step_id: int):
    connection = get_connection()
    try:
        cursor = connection.cursor()
        row = cursor.execute(
            """
            SELECT data FROM step_annotations
            WHERE step_id = ? AND workflow_id = ?
            """,
            (step_id, session_id)
        ).fetchone()
        
        if not row:
            return {"data": "[]"}
        return {"data": row["data"]}
    finally:
        connection.close()


@app.put("/sessions/{session_id}/steps/{step_id}/annotations")
def save_step_annotations(session_id: str, step_id: int, request: StepAnnotationRequest):
    connection = get_connection()
    now = utc_now()
    try:
        cursor = connection.cursor()
        # Verify step exists
        step = cursor.execute(
            "SELECT id FROM workflow_steps WHERE id = ? AND workflow_id = ?",
            (step_id, session_id)
        ).fetchone()
        if not step:
            raise HTTPException(status_code=404, detail="Step not found")
            
        cursor.execute(
            """
            INSERT INTO step_annotations (step_id, workflow_id, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(step_id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
            """,
            (step_id, session_id, request.data, now, now)
        )
        connection.commit()
        perform_auto_backup()
    finally:
        connection.close()
    return {"success": True, "message": "Annotations saved"}


@app.delete("/sessions/{session_id}/steps/{step_id}/annotations")
def delete_step_annotations(session_id: str, step_id: int):
    connection = get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            "DELETE FROM step_annotations WHERE step_id = ? AND workflow_id = ?",
            (step_id, session_id)
        )
        connection.commit()
    finally:
        connection.close()
    return {"success": True, "message": "Annotations deleted"}


# =========================================================
# STEP EDITS PERSISTENCE
# =========================================================

@app.patch("/sessions/{session_id}/steps/{step_id}/edits")
def edit_step(session_id: str, step_id: int, request: StepEditRequest):
    connection = get_connection()
    now = utc_now()
    try:
        cursor = connection.cursor()
        # Verify step exists
        step = cursor.execute(
            "SELECT id FROM workflow_steps WHERE id = ? AND workflow_id = ?",
            (step_id, session_id)
        ).fetchone()
        if not step:
            raise HTTPException(status_code=404, detail="Step not found")
            
        # Get existing edit or insert new
        existing = cursor.execute(
            "SELECT title, description, note, expected, voiceover, hidden FROM step_edits WHERE step_id = ?",
            (step_id,)
        ).fetchone()
        
        if existing:
            title = request.title if request.title is not None else existing["title"]
            description = request.description if request.description is not None else existing["description"]
            note = request.note if request.note is not None else existing["note"]
            expected = request.expected if request.expected is not None else existing["expected"]
            voiceover = request.voiceover if request.voiceover is not None else existing["voiceover"]
            hidden = int(request.hidden) if request.hidden is not None else existing["hidden"]
        else:
            orig_step = cursor.execute(
                "SELECT title, action, value FROM workflow_steps WHERE id = ?",
                (step_id,)
            ).fetchone()
            
            title = request.title if request.title is not None else (orig_step["title"] or "")
            description = request.description if request.description is not None else ""
            note = request.note if request.note is not None else ""
            expected = request.expected if request.expected is not None else ""
            voiceover = request.voiceover if request.voiceover is not None else ""
            hidden = int(request.hidden) if request.hidden is not None else 0
            
        cursor.execute(
            """
            INSERT INTO step_edits (step_id, workflow_id, title, description, note, expected, voiceover, hidden, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                note = excluded.note,
                expected = excluded.expected,
                voiceover = excluded.voiceover,
                hidden = excluded.hidden,
                updated_at = excluded.updated_at
            """,
            (step_id, session_id, title, description, note, expected, voiceover, hidden, now)
        )
        if request.checked is not None:
            cursor.execute(
                "UPDATE workflow_steps SET checked = ? WHERE id = ?",
                (1 if request.checked else 0, step_id)
            )
        connection.commit()
        perform_auto_backup()
    finally:
        connection.close()
    return {"success": True, "message": "Step edits saved"}


# =========================================================
# OFFLINE AI ENHANCEMENTS (Ollama)
# =========================================================
import urllib.request

def call_ollama_sync(endpoint: str, payload: dict, timeout=60) -> dict:
    url = f"http://127.0.0.1:11434{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Ollama connection error: {e}")
    return None

def get_installed_models() -> list:
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=2) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                return [m["name"] for m in data.get("models", [])]
    except Exception:
        pass
    return []

def get_ollama_heartbeat() -> bool:
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/", method="GET")
        with urllib.request.urlopen(req, timeout=1) as response:
            return response.status == 200
    except Exception:
        return False

@app.get("/ai/status")
def get_ai_status():
    heartbeat = get_ollama_heartbeat()
    installed = get_installed_models() if heartbeat else []
    ollama_running = heartbeat or len(installed) > 0
    
    # Check if moondream and qwen2.5 are pulled
    installed_names = [m.split(":")[0] for m in installed]
    has_moondream = "moondream" in installed_names
    has_qwen = "qwen2.5" in installed_names
    
    # Find Ollama executable
    ollama_path = shutil.which("ollama")
    if not ollama_path:
        possible_paths = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
            Path(os.environ.get("ProgramFiles", "")) / "Ollama" / "ollama.exe",
            Path(os.environ.get("ProgramFiles(x86)", "")) / "Ollama" / "ollama.exe",
        ]
        for p in possible_paths:
            if p.exists():
                ollama_path = str(p)
                break

    diagnostic_msg = ""
    if not ollama_running:
        if not ollama_path:
            diagnostic_msg = "Ollama is not installed on this PC. Click 'Start Ollama' to auto-install via winget."
        else:
            diagnostic_msg = f"Ollama executable found at {ollama_path}, but service is stopped. Click 'Start Ollama' to launch it."
    elif not (has_moondream and has_qwen):
        missing = []
        if not has_moondream: missing.append("moondream (vision)")
        if not has_qwen: missing.append("qwen2.5 (text)")
        diagnostic_msg = f"Ollama running, but missing models: {', '.join(missing)}. Click 'Start Ollama' to pull them."
    else:
        diagnostic_msg = "AI engine active with all models loaded."

    return {
        "running": ollama_running,
        "models": installed,
        "required_models_present": has_moondream and has_qwen,
        "ollama_installed": bool(ollama_path),
        "diagnostic_message": diagnostic_msg
    }

@app.post("/ai/start-ollama")
def start_ollama():
    try:
        if get_ollama_heartbeat():
            return {"success": True, "message": "Ollama is already running"}
            
        ollama_path = shutil.which("ollama")
        if not ollama_path:
            possible_paths = [
                Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
                Path(os.environ.get("ProgramFiles", "")) / "Ollama" / "ollama.exe",
                Path(os.environ.get("ProgramFiles(x86)", "")) / "Ollama" / "ollama.exe",
            ]
            for p in possible_paths:
                if p.exists():
                    ollama_path = str(p)
                    break

        if ollama_path:
            def run_ollama():
                subprocess.Popen([ollama_path, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            t = threading.Thread(target=run_ollama)
            t.start()
            return {"success": True, "message": "Ollama start command issued"}
        else:
            def install_ollama():
                subprocess.run(["winget", "install", "Ollama.Ollama", "--accept-source-agreements", "--accept-package-agreements", "--silent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            t = threading.Thread(target=install_ollama)
            t.start()
            return {"success": True, "message": "Ollama not installed. Installing via winget in background... Please wait 1-2 mins."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class TTSRequest(BaseModel):
    text: Optional[str] = None
    voice: str = "en-US-AriaNeural"

@app.post("/sessions/{session_id}/steps/{step_id}/tts")
async def generate_tts(session_id: str, step_id: int, request: TTSRequest):
    try:
        speech_text = request.text
        if not speech_text:
            connection = get_connection()
            try:
                cursor = connection.cursor()
                row = cursor.execute(
                    """
                    SELECT se.voiceover, se.description, ws.title, ws.action, ws.value
                    FROM workflow_steps ws
                    LEFT JOIN step_edits se ON ws.id = se.step_id
                    WHERE ws.id = ? AND ws.workflow_id = ?
                    """,
                    (step_id, session_id)
                ).fetchone()
                if row:
                    speech_text = row["voiceover"] or row["description"] or row["title"] or f"{row['action']} {row['value'] or ''}"
            finally:
                connection.close()
                
        if not speech_text or not speech_text.strip():
            speech_text = "No text available for voiceover."

        audio_filename = f"tts_{session_id}_{step_id}.mp3"
        audio_path = MEDIA_DIR / audio_filename

        communicate = edge_tts.Communicate(speech_text, request.voice)
        await communicate.save(str(audio_path))

        return {"success": True, "audioUrl": f"/media/{audio_filename}"}
    except Exception as e:
        print("TTS Error:", e)
        raise HTTPException(status_code=500, detail=str(e))

class AIDescribeRequest(BaseModel):
    step_id: int
    session_id: str

@app.post("/ai/describe-step")
def ai_describe_step(request: AIDescribeRequest):
    connection = get_database_connection()
    try:
        cursor = connection.cursor()
        step = cursor.execute(
            "SELECT action, value, selected_text, url, title, element_json, screenshot_path FROM workflow_steps WHERE id = ? AND workflow_id = ?",
            (request.step_id, request.session_id)
        ).fetchone()
        if not step:
            raise HTTPException(status_code=404, detail="Step not found")
        
        # 1. Vision Analysis using moondream (if screenshot exists)
        vision_description = ""
        screenshot_path = step["screenshot_path"]
        if screenshot_path and Path(screenshot_path).exists():
            try:
                with open(screenshot_path, "rb") as image_file:
                    base64_image = base64.b64encode(image_file.read()).decode("utf-8")
                
                prompt = (
                    f"This is a screenshot of a user interacting with a web page. "
                    f"The user performed a '{step['action']}' action. "
                    f"Describe in one concise, professional sentence what exact button, input field, or element the user clicked or interacted with."
                )
                
                payload = {
                    "model": "moondream",
                    "prompt": prompt,
                    "images": [base64_image],
                    "stream": False
                }
                
                response_data = call_ollama_sync("/api/generate", payload, timeout=60)
                if response_data and "response" in response_data:
                    vision_description = response_data["response"].strip()
            except Exception as e:
                print(f"Vision analysis failed: {e}")
                
        # 2. Text Polishing using qwen2.5:0.5b
        element_info = ""
        if step["element_json"]:
            try:
                el = json.loads(step["element_json"])
                element_info = (
                    f"Element Tag: {el.get('tagName', '')}\n"
                    f"Element Text: {el.get('text', '')}\n"
                    f"Element Name/ID: {el.get('name', '') or el.get('id', '')}\n"
                    f"CSS Selector: {el.get('cssSelector', '')}\n"
                )
            except Exception:
                element_info = f"Element JSON: {step['element_json']}\n"
                
        prompt_text = (
            f"You are ProcSnap AI, an expert at writing standard operating procedures (SOPs).\n"
            f"Based on the following user action details, generate a clean title, a step-by-step instruction description, and an expected result.\n\n"
            f"--- ACTION DETAILS ---\n"
            f"Action Type: {step['action']}\n"
            f"Value Inputted/Selected: {step['value'] or 'None'}\n"
            f"Selected Text: {step['selected_text'] or 'None'}\n"
            f"Page URL: {step['url']}\n"
            f"Page Title: {step['title']}\n"
            f"UI Element Details:\n{element_info}\n"
        )
        
        if vision_description:
            prompt_text += f"Screenshot visual analysis description: {vision_description}\n"
            
        prompt_text += (
            f"\nRespond ONLY with a JSON object in this exact format (no markdown code blocks, just raw JSON):\n"
            f'{{\n  "title": "Concise active voice step title (e.g., Click standard button)",\n  "description": "Clear step-by-step description of what to do (e.g., click on the search bar and type ...)",\n  "expected": "What is the expected result or next screen state?"\n}}'
        )
        
        payload_text = {
            "model": "qwen2.5:0.5b",
            "prompt": prompt_text,
            "format": "json",
            "stream": False
        }
        
        response_text = call_ollama_sync("/api/generate", payload_text, timeout=30)
        
        title = ""
        description = ""
        expected = ""
        
        if response_text and "response" in response_text:
            try:
                parsed = json.loads(response_text["response"])
                title = parsed.get("title", "").strip()
                description = parsed.get("description", "").strip()
                expected = parsed.get("expected", "").strip()
            except Exception:
                print("Failed parsing JSON response from text model. Raw:", response_text["response"])
        
        if not title:
            title = f"Perform {step['action']} on element"
        if not description:
            description = f"Go to {step['url']} and execute {step['action']} action."
        if not expected:
            expected = "The application responds to the action."
            
        now = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            """
            INSERT INTO step_edits (step_id, workflow_id, title, description, note, expected, hidden, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(step_id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                expected = excluded.expected,
                updated_at = excluded.updated_at
            """,
            (request.step_id, request.session_id, title, description, expected, now)
        )
        connection.commit()
        
        return {
            "success": True,
            "title": title,
            "description": description,
            "expected": expected
        }
    finally:
        connection.close()

class AIPolishRequest(BaseModel):
    session_id: str

@app.post("/ai/polish-sop")
def ai_polish_sop(request: AIPolishRequest):
    connection = get_database_connection()
    try:
        cursor = connection.cursor()
        steps = cursor.execute(
            """
            SELECT ws.id, ws.action, ws.value, se.title, se.description, se.expected
            FROM workflow_steps ws
            LEFT JOIN step_edits se ON ws.id = se.step_id
            WHERE ws.workflow_id = ?
            ORDER BY ws.sequence ASC
            """,
            (request.session_id,)
        ).fetchall()
        
        if not steps:
            raise HTTPException(status_code=404, detail="No steps found for this session")
            
        sop_summary = []
        for i, step in enumerate(steps):
            title = step["title"] or f"Step {i+1}"
            desc = step["description"] or f"Perform {step['action']} action."
            sop_summary.append({
                "id": step["id"],
                "title": title,
                "description": desc
            })
            
        prompt = (
            f"You are a professional technical writer polishing a Standard Operating Procedure (SOP).\n"
            f"Review the following sequence of steps and rewrite their descriptions to be formal, clear, consistent, and written in a professional instruction manual voice.\n"
            f"Do not change the meaning of the steps, only improve their writing quality.\n\n"
            f"Steps to polish:\n{json.dumps(sop_summary, indent=2)}\n\n"
            f"Respond ONLY with a JSON array containing the polished steps, in this exact format:\n"
            f"[\n"
            f"  {{\n"
            f"    \"id\": step_id_number,\n"
            f"    \"title\": \"Polished concise title\",\n"
            f"    \"description\": \"Polished formal instruction description\"\n"
            f"  }}\n"
            f"]"
        )
        
        payload = {
            "model": "qwen2.5:0.5b",
            "prompt": prompt,
            "format": "json",
            "stream": False
        }
        
        response_text = call_ollama_sync("/api/generate", payload, timeout=60)
        if response_text and "response" in response_text:
            try:
                polished_list = json.loads(response_text["response"])
                now = datetime.now(timezone.utc).isoformat()
                
                for item in polished_list:
                    step_id = item.get("id")
                    p_title = item.get("title", "").strip()
                    p_desc = item.get("description", "").strip()
                    
                    if not step_id or (not p_title and not p_desc):
                        continue
                        
                    existing = cursor.execute(
                        "SELECT expected, note, hidden FROM step_edits WHERE step_id = ?",
                        (step_id,)
                    ).fetchone()
                    
                    expected = existing["expected"] if existing else ""
                    note = existing["note"] if existing else ""
                    hidden = existing["hidden"] if existing else 0
                    
                    cursor.execute(
                        """
                        INSERT INTO step_edits (step_id, workflow_id, title, description, note, expected, hidden, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(step_id) DO UPDATE SET
                            title = excluded.title,
                            description = excluded.description,
                            updated_at = excluded.updated_at
                        """,
                        (step_id, request.session_id, p_title, p_desc, note, expected, hidden, now)
                    )
                connection.commit()
                return {"success": True, "message": "All steps polished successfully"}
            except Exception as e:
                print("Failed parsing polished list JSON. Error:", e)
                raise HTTPException(status_code=500, detail="Failed to parse AI response")
                
        raise HTTPException(status_code=500, detail="No response from Ollama")
    finally:
        connection.close()

class AIDetectRedactRequest(BaseModel):
    step_id: int
    session_id: str

@app.post("/ai/detect-redact")
def ai_detect_redact(request: AIDetectRedactRequest):
    connection = get_database_connection()
    try:
        cursor = connection.cursor()
        step = cursor.execute(
            "SELECT element_json, screenshot_path FROM workflow_steps WHERE id = ? AND workflow_id = ?",
            (request.step_id, request.session_id)
        ).fetchone()
        if not step:
            raise HTTPException(status_code=404, detail="Step not found")
        
        redact_regions = []
        
        # Heuristic 1: Check if input was a password field or input element matching password regexes
        element_json = step["element_json"]
        if element_json:
            try:
                el = json.loads(element_json)
                is_sensitive = False
                if el.get("type") == "password":
                    is_sensitive = True
                else:
                    name = (el.get("name") or "").lower()
                    placeholder = (el.get("placeholder") or "").lower()
                    id_attr = (el.get("id") or "").lower()
                    for keyword in ["password", "pass", "pwd", "ssn", "socialsecurity", "cardnumber", "cvv", "creditcard", "secret", "token", "apikey"]:
                        if keyword in name or keyword in placeholder or keyword in id_attr:
                            is_sensitive = True
                            break
                
                if is_sensitive and el.get("screen"):
                    screen = el["screen"]
                    width = screen["width"]
                    height = screen["height"]
                    x = screen["x"]
                    y = screen["y"]
                    
                    redact_regions.append({
                        "id": "ai-auto-" + uuid4().hex[:6],
                        "type": "blur",
                        "x": x,
                        "y": y,
                        "w": width,
                        "h": height,
                        "color": "#ef4444"
                    })
            except Exception as e:
                print("Element-based redact check failed:", e)

        # Heuristic 2: If we have vision model moondream, we can also ask it to look for credentials or credit cards
        screenshot_path = step["screenshot_path"]
        if not redact_regions and screenshot_path and Path(screenshot_path).exists():
            try:
                with open(screenshot_path, "rb") as image_file:
                    base64_image = base64.b64encode(image_file.read()).decode("utf-8")
                
                prompt = (
                    "Locate any visible email addresses, credit cards, password values, or names in this image. "
                    "Respond ONLY with a JSON list of bounding boxes: [[x, y, width, height]] in percent coordinates (0 to 100). "
                    "Do not include any text besides raw JSON."
                )
                
                payload = {
                    "model": "moondream",
                    "prompt": prompt,
                    "format": "json",
                    "stream": False
                }
                
                response_data = call_ollama_sync("/api/generate", payload, timeout=60)
                if response_data and "response" in response_data:
                    boxes = json.loads(response_data["response"])
                    from PIL import Image
                    with Image.open(screenshot_path) as img:
                        img_w, img_h = img.size
                    
                    for box in boxes:
                        if len(box) == 4:
                            x_pct, y_pct, w_pct, h_pct = box
                            x = (x_pct / 100.0) * img_w
                            y = (y_pct / 100.0) * img_h
                            w = (w_pct / 100.0) * img_w
                            h = (h_pct / 100.0) * img_h
                            
                            redact_regions.append({
                                "id": "ai-vision-" + uuid4().hex[:6],
                                "type": "blur",
                                "x": x,
                                "y": y,
                                "w": w,
                                "h": h,
                                "color": "#ef4444"
                            })
            except Exception as e:
                print("Vision-based redact detection failed:", e)
                
        return {"success": True, "regions": redact_regions}
    finally:
        connection.close()


class ReplaceScreenshotRequest(BaseModel):
    image: str

@app.post("/sessions/{session_id}/steps/{step_id}/screenshot")
def replace_step_screenshot(session_id: str, step_id: int, request: ReplaceScreenshotRequest):
    connection = get_connection()
    try:
        cursor = connection.cursor()
        step = cursor.execute(
            "SELECT id FROM workflow_steps WHERE id = ? AND workflow_id = ?",
            (step_id, session_id)
        ).fetchone()
        if not step:
            raise HTTPException(status_code=404, detail="Step not found")
            
        match = re.fullmatch(
            r"data:image/[^;]+;base64,(.+)",
            request.image,
            flags=re.DOTALL,
        )
        if not match:
            raise HTTPException(status_code=400, detail="Invalid data URL format")
            
        image_data = base64.b64decode(match.group(1))
        
        # Save to file
        import uuid
        filename = f"replace_{uuid.uuid4().hex}.png"
        folder = Path("storage/screenshots") / session_id
        folder.mkdir(parents=True, exist_ok=True)
        file_path = folder / filename
        
        with open(file_path, "wb") as f:
            f.write(image_data)
            
        # Update database path
        db_path = f"storage/screenshots/{session_id}/{filename}"
        cursor.execute(
            "UPDATE workflow_steps SET screenshot_path = ? WHERE id = ?",
            (db_path, step_id)
        )
        connection.commit()
        return {"success": True, "screenshotUrl": f"storage/screenshots/{session_id}/{filename}"}
    finally:
        connection.close()


class CropScreenshotRequest(BaseModel):
    x: float
    y: float
    w: float
    h: float

@app.post("/sessions/{session_id}/steps/{step_id}/screenshot/crop")
def crop_step_screenshot(session_id: str, step_id: int, request: CropScreenshotRequest):
    connection = get_connection()
    try:
        cursor = connection.cursor()
        step = cursor.execute(
            "SELECT screenshot_path FROM workflow_steps WHERE id = ? AND workflow_id = ?",
            (step_id, session_id)
        ).fetchone()
        if not step or not step["screenshot_path"]:
            raise HTTPException(status_code=404, detail="Screenshot not found")
            
        full_path = Path(step["screenshot_path"])
        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
            
        # Coordinates logic
        x1 = min(request.x, request.x + request.w)
        y1 = min(request.y, request.y + request.h)
        x2 = max(request.x, request.x + request.w)
        y2 = max(request.y, request.y + request.h)
        
        # Guard minimum dimensions
        if (x2 - x1) < 10 or (y2 - y1) < 10:
            raise HTTPException(status_code=400, detail="Crop region too small")
            
        # Crop using PIL
        from PIL import Image
        with Image.open(full_path) as img:
            cropped = img.crop((int(x1), int(y1), int(x2), int(y2)))
            import uuid
            filename = f"crop_{uuid.uuid4().hex}.png"
            folder = Path("storage/screenshots") / session_id
            folder.mkdir(parents=True, exist_ok=True)
            file_path = folder / filename
            cropped.save(file_path)
            
        # Shift annotations
        annot_row = cursor.execute(
            "SELECT data FROM step_annotations WHERE step_id = ?",
            (step_id,)
        ).fetchone()
        
        if annot_row:
            try:
                annots = json.loads(annot_row["data"])
                for a in annots:
                    a["x"] = a["x"] - x1
                    a["y"] = a["y"] - y1
                cursor.execute(
                    "UPDATE step_annotations SET data = ?, updated_at = ? WHERE step_id = ?",
                    (json.dumps(annots), utc_now(), step_id)
                )
            except Exception as e:
                print("Failed shifting annotations:", e)
                
        # Update database screenshot path
        db_path = f"storage/screenshots/{session_id}/{filename}"
        cursor.execute(
            "UPDATE workflow_steps SET screenshot_path = ? WHERE id = ?",
            (db_path, step_id)
        )
        connection.commit()
        return {"success": True, "screenshotUrl": f"storage/screenshots/{session_id}/{filename}"}
    finally:
        connection.close()


class DesktopCaptureRequest(BaseModel):
    session_id: Optional[str] = None
    monitor_index: Optional[int] = 1   # 1 = primary, 2 = secondary, 0 = all monitors combined
    title: Optional[str] = None


def _ensure_desktop_session(cursor, connection, session_id: Optional[str]) -> str:
    """Create or validate a workflow session for desktop captures."""
    import uuid, datetime
    if session_id:
        wf = cursor.execute("SELECT id FROM workflows WHERE id = ?", (session_id,)).fetchone()
        if wf:
            return session_id
    session_id = f"wf_{uuid.uuid4().hex[:8]}"
    now_str = datetime.datetime.now().strftime("%b %d, %Y %I:%M %p")
    cursor.execute(
        """
        INSERT INTO workflows (id, name, application, status, started_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (session_id, f"Desktop SOP — {now_str}", "Windows Desktop", "completed", utc_now(), utc_now(), utc_now())
    )
    connection.commit()
    return session_id


def _insert_desktop_step(cursor, connection, session_id: str, filename: str, title: str) -> dict:
    """Insert a workflow_step row for a desktop screenshot and return URL info."""
    file_path = SCREENSHOTS_DIR / session_id / filename
    db_path = str(Path("screenshots") / session_id / filename)

    last_step = cursor.execute(
        "SELECT sequence FROM workflow_steps WHERE workflow_id = ? ORDER BY sequence DESC LIMIT 1",
        (session_id,)
    ).fetchone()
    next_seq = (last_step["sequence"] + 1) if last_step else 1

    step_title = title or f"Desktop Screen Capture {next_seq}"

    cursor.execute(
        """
        INSERT INTO workflow_steps (
            workflow_id, sequence, action, timestamp, title, screenshot_path
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (session_id, next_seq, "desktop_capture", utc_now(), step_title, db_path)
    )
    connection.commit()
    return {
        "success": True,
        "sessionId": session_id,
        "screenshotUrl": f"/screenshots/{session_id}/{filename}",
        "sequence": next_seq,
        "title": step_title,
    }


@app.get("/desktop/monitors")
def list_desktop_monitors():
    """
    Returns a list of available desktop monitors with index, resolution and position.
    Uses mss for cross-monitor enumeration.
    """
    try:
        import mss
        with mss.mss() as sct:
            monitors = []
            for i, m in enumerate(sct.monitors):
                if i == 0:
                    label = f"All Monitors Combined ({m['width']}x{m['height']})"
                else:
                    label = f"Monitor {i} - {m['width']}x{m['height']} at ({m['left']},{m['top']})"
                monitors.append({
                    "index": i,
                    "label": label,
                    "width": m["width"],
                    "height": m["height"],
                    "left": m["left"],
                    "top": m["top"],
                    "isPrimary": i == 1,
                })
        return {"success": True, "monitors": monitors}
    except Exception as e:
        return {"success": False, "monitors": [{"index": 1, "label": "Primary Monitor", "width": 1920, "height": 1080, "left": 0, "top": 0, "isPrimary": True}], "error": str(e)}


@app.post("/desktop/capture")
def capture_desktop_screen(request: Optional[DesktopCaptureRequest] = None):
    """
    Captures the Windows Desktop screen natively.
    Tries 4 methods in order:
      1. mss.MSS (fast, multi-monitor)
      2. PIL ImageGrab
      3. PowerShell CopyFromScreen (most compatible in user sessions)
      4. capture_screen.py via subprocess
    Auto-creates a workflow session if none provided.
    """
    import uuid
    try:
        session_id = (request.session_id if request else None) or None
        monitor_index = int((request.monitor_index if request else None) or 1)
        step_title = (request.title if request else None) or None

        connection = get_connection()
        try:
            cursor = connection.cursor()
            session_id = _ensure_desktop_session(cursor, connection, session_id)

            filename = f"desktop_{uuid.uuid4().hex[:10]}.png"
            folder = SCREENSHOTS_DIR / session_id
            folder.mkdir(parents=True, exist_ok=True)
            file_path = folder / filename
            file_path_str = str(file_path)

            captured = False
            errors = []

            # ── Method 1: mss.MSS ──────────────────────────────────────────────
            try:
                import mss
                import mss.tools
                with mss.MSS() as sct:
                    monitors = sct.monitors
                    mon = monitors[monitor_index] if monitor_index < len(monitors) else monitors[1]
                    screenshot = sct.grab(mon)
                    mss.tools.to_png(screenshot.rgb, screenshot.size, output=file_path_str)
                captured = True
            except Exception as e:
                errors.append(f"mss: {e}")

            # ── Method 2: PIL ImageGrab ──────────────────────────────────────────
            if not captured:
                try:
                    from PIL import ImageGrab
                    all_screens = (monitor_index == 0)
                    img = ImageGrab.grab(include_layered_windows=True, all_screens=all_screens)
                    img.save(file_path_str, format="PNG")
                    captured = True
                except Exception as e:
                    errors.append(f"PIL: {e}")

            # ── Method 3: PowerShell CopyFromScreen ─────────────────────────────
            if not captured:
                try:
                    ps_script = BASE_DIR / "capture.ps1"
                    if not ps_script.exists():
                        # Write the PowerShell capture helper if missing
                        ps_script.write_text(
                            r"""
param([string]$outPath, [int]$monIdx = 0)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$screen = if ($monIdx -lt $screens.Length) { $screens[$monIdx] } else { $screens[0] }
$bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bmp.Size)
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "OK:$outPath"
""".strip(), encoding="utf-8")

                    ps_mon_idx = max(0, monitor_index - 1)  # PS uses 0-based AllScreens
                    result = subprocess.run(
                        ["powershell", "-ExecutionPolicy", "Bypass", "-NonInteractive",
                         "-File", str(ps_script), file_path_str, str(ps_mon_idx)],
                        capture_output=True, text=True, timeout=20
                    )
                    if result.returncode == 0 and file_path.exists() and file_path.stat().st_size > 1000:
                        captured = True
                    else:
                        errors.append(f"PowerShell: rc={result.returncode} {result.stderr.strip()}")
                except Exception as e:
                    errors.append(f"PowerShell: {e}")

            # ── Method 4: capture_screen.py subprocess ───────────────────────────
            if not captured:
                try:
                    helper = BASE_DIR / "capture_screen.py"
                    result = subprocess.run(
                        [sys.executable, str(helper), file_path_str, str(monitor_index)],
                        capture_output=True, text=True, timeout=20
                    )
                    if result.returncode == 0 and file_path.exists() and file_path.stat().st_size > 1000:
                        captured = True
                    else:
                        errors.append(f"capture_screen.py: rc={result.returncode} {result.stderr.strip()}")
                except Exception as e:
                    errors.append(f"capture_screen.py: {e}")

            if not captured:
                raise RuntimeError(f"All capture methods failed: {'; '.join(errors)}")

            result = _insert_desktop_step(cursor, connection, session_id, filename, step_title)
            return result
        finally:
            connection.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Desktop capture failed: {str(e)}")


class DesktopBase64CaptureRequest(BaseModel):
    session_id: Optional[str] = None
    image: str
    title: Optional[str] = None


@app.post("/desktop/capture-base64")
def capture_desktop_base64(request: DesktopBase64CaptureRequest):
    """
    Accepts a base64 data-URL desktop screenshot (from browser getDisplayMedia)
    and saves it as a new workflow step.
    """
    import uuid
    try:
        match = re.fullmatch(r"data:image/[^;]+;base64,(.+)", request.image, flags=re.DOTALL)
        if not match:
            raise HTTPException(status_code=400, detail="Invalid data URL format")

        image_data = base64.b64decode(match.group(1))
        if len(image_data) < 1000:
            raise HTTPException(status_code=400, detail="Captured image appears to be blank or empty")

        connection = get_connection()
        try:
            cursor = connection.cursor()
            session_id = _ensure_desktop_session(cursor, connection, request.session_id)

            filename = f"desktop_{uuid.uuid4().hex[:10]}.png"
            folder = SCREENSHOTS_DIR / session_id
            folder.mkdir(parents=True, exist_ok=True)
            file_path = folder / filename

            with open(file_path, "wb") as f:
                f.write(image_data)

            result = _insert_desktop_step(cursor, connection, session_id, filename, request.title)
            return result
        finally:
            connection.close()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Desktop base64 capture failed: {str(e)}")

