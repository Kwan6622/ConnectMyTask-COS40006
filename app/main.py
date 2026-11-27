"""
FastAPI service + demo website for the ConnectMyTask Fraud Task Detection AI.

Run:
    .venv\\Scripts\\python -m uvicorn app.main:app --reload --port 8000
    open http://localhost:8000          (website)
    open http://localhost:8000/docs     (OpenAPI / Swagger)
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from ai.features import CATEGORY_MIN_BUDGET_VND
from ai.predictor import FraudPredictor

ROOT = Path(__file__).resolve().parents[1]
STATIC = Path(__file__).resolve().parent / "static"
DB_PATH = Path(os.environ.get("FRAUD_AI_DB", ROOT / "app" / "tasks.db"))
WARD_GROUPS = json.loads((ROOT / "data" / "hcmc_wards.json").read_text(encoding="utf-8"))
VALID_WARDS = {w: g["oldDistrict"] for g in WARD_GROUPS for w in g["wards"]}

logging.basicConfig(level=logging.INFO)
predictor = FraudPredictor()
app = FastAPI(
    title="ConnectMyTask Fraud Task Detection AI",
    version="1.0.0",
    description="Validates task postings with an ML model + rule-based fallback before they go live.",
)


# --------------------------------------------------------------------------
# Schemas (mirror the ConnectMyTask "Post a Task" form)
# --------------------------------------------------------------------------
class Category(str, Enum):
    DELIVERY = "DELIVERY"
    HOME_REPAIR = "HOME_REPAIR"
    CLEANING = "CLEANING"
    IT_SUPPORT = "IT_SUPPORT"
    PERSONAL_ASSISTANT = "PERSONAL_ASSISTANT"
    MOVING = "MOVING"
    TUTORING = "TUTORING"
    OTHER = "OTHER"


class TaskIn(BaseModel):
    title: str = Field(..., min_length=5, max_length=120, examples=["Fix leaking kitchen sink"])
    description: str = Field(..., min_length=10, max_length=2000)
    category: Category
    district: str = Field(..., description="HCMC ward, as in the ConnectMyTask district picker", examples=["Ben Thanh"])
    streetName: str = Field(..., min_length=3, max_length=120, examples=["35 Bach Dang"])
    budget: int = Field(..., gt=0, le=1_000_000_000, description="Budget in VND")
    maxBids: int = Field(30, ge=1, le=30)
    deadline: datetime | None = Field(None, description="ISO date-time; must be in the future")
    urgency: Literal["NORMAL", "URGENT"] = "NORMAL"
    imageCount: int = Field(0, ge=0, le=3, description="Number of task images attached (max 3)")

    @field_validator("district")
    @classmethod
    def known_ward(cls, v: str) -> str:
        if v not in VALID_WARDS:
            raise ValueError("district must be a Ho Chi Minh City ward from /api/options")
        return v

    @field_validator("deadline")
    @classmethod
    def future_deadline(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return v
        now = datetime.now(v.tzinfo) if v.tzinfo else datetime.now()
        if v <= now:
            raise ValueError("deadline must be in the future")
        return v

    def model_input(self) -> dict:
        if self.deadline is None:
            hours = 72.0
        else:
            now = datetime.now(self.deadline.tzinfo) if self.deadline.tzinfo else datetime.now()
            hours = max((self.deadline - now).total_seconds() / 3600.0, 0.0)
        return {
            "title": self.title.strip(),
            "description": self.description.strip(),
            "category": self.category.value,
            "budget_vnd": self.budget,
            "max_bids": self.maxBids,
            "deadline_hours": hours,
            "urgency": self.urgency,
            "image_count": self.imageCount,
        }


class Assessment(BaseModel):
    fraudScore: float = Field(..., description="Model probability that the task is fraudulent (0-1)")
    ruleScore: float = Field(..., description="Rule-based baseline score (0, 0.5, 1)")
    decision: Literal["APPROVED", "NEEDS_REVIEW", "BLOCKED"]
    isSuspicious: bool
    riskLevel: Literal["MEDIUM", "HIGH"] | None
    suspiciousReason: str | None
    reasons: list[str]
    engine: str
    modelVersion: str | None


class TaskOut(BaseModel):
    id: int
    status: Literal["OPEN", "PENDING_REVIEW", "BLOCKED", "REJECTED"]
    createdAt: str
    task: dict
    assessment: Assessment
    reviewedAt: str | None = None
    reviewAction: str | None = None


class ReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(None, max_length=500)


STATUS_BY_DECISION = {"APPROVED": "OPEN", "NEEDS_REVIEW": "PENDING_REVIEW", "BLOCKED": "BLOCKED"}


# --------------------------------------------------------------------------
# Storage (SQLite, demo only)
# --------------------------------------------------------------------------
@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            task_json TEXT NOT NULL,
            assessment_json TEXT NOT NULL,
            reviewed_at TEXT,
            review_action TEXT,
            review_note TEXT)""")


init_db()


def row_to_out(r: sqlite3.Row) -> TaskOut:
    return TaskOut(id=r["id"], status=r["status"], createdAt=r["created_at"], task=json.loads(r["task_json"]),
                   assessment=Assessment(**json.loads(r["assessment_json"])), reviewedAt=r["reviewed_at"],
                   reviewAction=r["review_action"])


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "engine": predictor.engine, "modelVersion": predictor.metadata.get("version")}


@app.get("/api/model", tags=["meta"])
def model_info() -> dict:
    """Selected model, thresholds and held-out test metrics (from ai/train.py)."""
    return {"engine": predictor.engine, **predictor.metadata}


@app.get("/api/options", tags=["meta"])
def options() -> dict:
    """Categories, minimum budgets and HCMC wards used by the posting form."""
    return {"categories": [c.value for c in Category], "categoryMinBudgetVnd": CATEGORY_MIN_BUDGET_VND,
            "wardGroups": WARD_GROUPS}


@app.post("/api/validate", response_model=Assessment, tags=["fraud"])
def validate_task(task: TaskIn) -> Assessment:
    """Score a task without saving it (e.g. live check before the requester presses Post)."""
    return Assessment(**predictor.assess(task.model_input()).dict())


@app.post("/api/tasks", response_model=TaskOut, status_code=201, tags=["tasks"])
def create_task(task: TaskIn) -> TaskOut:
    """Post a task. The AI decides whether it goes live (OPEN), waits for admin review, or is blocked."""
    assessment = predictor.assess(task.model_input())
    status = STATUS_BY_DECISION[assessment.decision]
    payload = task.model_dump(mode="json")
    payload["oldDistrict"] = VALID_WARDS[task.district]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with db() as conn:
        cur = conn.execute("INSERT INTO tasks (status, created_at, task_json, assessment_json) VALUES (?, ?, ?, ?)",
                           (status, now, json.dumps(payload), json.dumps(assessment.dict())))
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_out(row)


@app.get("/api/tasks", response_model=list[TaskOut], tags=["tasks"])
def list_tasks(status: Literal["OPEN", "PENDING_REVIEW", "BLOCKED", "REJECTED", "ALL"] = Query("OPEN")) -> list[TaskOut]:
    """Public feed shows OPEN tasks; admins can ask for PENDING_REVIEW, BLOCKED, REJECTED or ALL."""
    with db() as conn:
        if status == "ALL":
            rows = conn.execute("SELECT * FROM tasks ORDER BY id DESC").fetchall()
        else:
            rows = conn.execute("SELECT * FROM tasks WHERE status = ? ORDER BY id DESC", (status,)).fetchall()
    return [row_to_out(r) for r in rows]


@app.get("/api/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def get_task(task_id: int) -> TaskOut:
    with db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Task not found")
    return row_to_out(row)


@app.post("/api/tasks/{task_id}/review", response_model=TaskOut, tags=["admin"])
def review_task(task_id: int, review: ReviewIn) -> TaskOut:
    """Admin decision for a PENDING_REVIEW or BLOCKED task. Decisions are kept as future training labels."""
    with db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Task not found")
        if row["status"] not in ("PENDING_REVIEW", "BLOCKED"):
            raise HTTPException(409, f"Task is {row['status']}; only PENDING_REVIEW or BLOCKED tasks can be reviewed")
        new_status = "OPEN" if review.action == "approve" else "REJECTED"
        conn.execute("UPDATE tasks SET status = ?, reviewed_at = ?, review_action = ?, review_note = ? WHERE id = ?",
                     (new_status, datetime.now(timezone.utc).isoformat(timespec="seconds"), review.action, review.note, task_id))
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return row_to_out(row)


# --------------------------------------------------------------------------
# Website + report files
# --------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/reports", StaticFiles(directory=ROOT / "reports", check_dir=False), name="reports")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")
