"""API tests: valid, invalid and out-of-order requests (Project B Definition of Done)."""
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

os.environ["FRAUD_AI_DB"] = str(Path(tempfile.mkdtemp()) / "test_tasks.db")

from fastapi.testclient import TestClient  # noqa: E402

from ai.predictor import FraudPredictor  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
FUTURE = (datetime.now() + timedelta(days=3)).isoformat()

LEGIT = {
    "title": "Fix leaking kitchen sink", "category": "HOME_REPAIR", "district": "Ben Thanh", "streetName": "35 Bach Dang",
    "description": "The sink has been leaking under the cabinet for two days. Please bring your own tools. "
                   "Payment through ConnectMyTask escrow after completion.",
    "budget": 450000, "maxBids": 30, "deadline": FUTURE, "urgency": "NORMAL", "imageCount": 2,
}
SCAM = {
    **LEGIT, "title": "EASY PART-TIME DELIVERY JOB, HIGH PAY", "category": "DELIVERY", "urgency": "URGENT", "imageCount": 0,
    "description": "Provider must pay a 300,000 VND registration fee before starting. Contact me on Zalo 0912345678 "
                   "for details, do not use app chat. Limited slots!!!",
    "budget": 3000000,
}


def test_health_and_model():
    assert client.get("/health").json()["status"] == "ok"
    info = client.get("/api/model").json()
    assert info["engine"] == "ml+rules"
    assert 0 < info["thresholds"]["needs_review"] <= info["thresholds"]["blocked"]


def test_legit_task_is_published():
    r = client.post("/api/tasks", json=LEGIT)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["assessment"]["decision"] == "APPROVED"
    assert body["status"] == "OPEN"
    assert any(t["id"] == body["id"] for t in client.get("/api/tasks").json())


def test_scam_task_is_not_published():
    r = client.post("/api/tasks", json=SCAM)
    assert r.status_code == 201
    body = r.json()
    assert body["assessment"]["isSuspicious"] is True
    assert body["status"] in ("BLOCKED", "PENDING_REVIEW")
    assert body["assessment"]["reasons"]
    assert all(t["id"] != body["id"] for t in client.get("/api/tasks?status=OPEN").json())


def test_validate_does_not_store():
    before = len(client.get("/api/tasks?status=ALL").json())
    r = client.post("/api/validate", json=SCAM)
    assert r.status_code == 200 and r.json()["fraudScore"] > 0.5
    assert len(client.get("/api/tasks?status=ALL").json()) == before


def test_invalid_inputs_rejected():
    bad = [
        {**LEGIT, "budget": 0},
        {**LEGIT, "budget": -5},
        {**LEGIT, "category": "GAMBLING"},
        {**LEGIT, "district": "Hanoi"},
        {**LEGIT, "title": "Hi"},
        {**LEGIT, "imageCount": 4},
        {**LEGIT, "maxBids": 99},
        {**LEGIT, "urgency": "SUPER"},
        {**LEGIT, "deadline": (datetime.now() - timedelta(days=1)).isoformat()},
        {k: v for k, v in LEGIT.items() if k != "description"},
    ]
    for payload in bad:
        assert client.post("/api/tasks", json=payload).status_code == 422, payload


def test_admin_review_flow_and_out_of_order():
    scam_id = client.post("/api/tasks", json=SCAM).json()["id"]
    r = client.post(f"/api/tasks/{scam_id}/review", json={"action": "reject"})
    assert r.status_code == 200 and r.json()["status"] == "REJECTED"
    # reviewing again (out of order) is refused
    assert client.post(f"/api/tasks/{scam_id}/review", json={"action": "approve"}).status_code == 409
    # an already-open task cannot be "reviewed"
    legit_id = client.post("/api/tasks", json=LEGIT).json()["id"]
    assert client.post(f"/api/tasks/{legit_id}/review", json={"action": "reject"}).status_code == 409
    assert client.post("/api/tasks/999999/review", json={"action": "approve"}).status_code == 404
    assert client.post(f"/api/tasks/{legit_id}/review", json={"action": "delete"}).status_code == 422


def test_rule_fallback_when_model_missing(tmp_path):
    p = FraudPredictor(model_path=tmp_path / "missing.joblib", meta_path=tmp_path / "missing.json")
    assert p.engine == "rules-fallback"
    task = {"title": SCAM["title"], "description": SCAM["description"], "category": "DELIVERY", "budget_vnd": 3000000,
            "max_bids": 30, "deadline_hours": 3, "urgency": "URGENT", "image_count": 0}
    assert p.assess(task).decision == "NEEDS_REVIEW"
