"""
Inference wrapper used by the FastAPI service.

Decision policy (thresholds come from models/model_metadata.json, tuned on the
validation split by ai/train.py):

    score >= blocked                         -> BLOCKED       (riskLevel HIGH)
    score >= needs_review  OR rule escalates -> NEEDS_REVIEW  (riskLevel MEDIUM)
    otherwise                                -> APPROVED

"Rule escalates" = keyword/budget rule score >= hybrid_rule_score. If the model
file is missing or fails to load, the rule-based baseline is used alone
(Project B plan: rule-based baselines remain as fallbacks).
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path

import joblib
import pandas as pd

from .baseline import keyword_rule_score
from .features import explain, model_frame

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models" / "fraud_task_model.joblib"
META_PATH = ROOT / "models" / "model_metadata.json"
log = logging.getLogger("fraud-task-ai")

FALLBACK_THRESHOLDS = {"needs_review": 0.5, "classification": 0.5, "blocked": 1.0, "hybrid_rule_score": 1.0}


@dataclass
class Assessment:
    fraudScore: float
    ruleScore: float
    decision: str
    isSuspicious: bool
    riskLevel: str | None
    suspiciousReason: str | None
    reasons: list[str] = field(default_factory=list)
    engine: str = "ml+rules"
    modelVersion: str | None = None

    def dict(self) -> dict:
        return asdict(self)


class FraudPredictor:
    def __init__(self, model_path: Path = MODEL_PATH, meta_path: Path = META_PATH):
        self.model = None
        self.metadata: dict = {}
        self.thresholds = dict(FALLBACK_THRESHOLDS)
        try:
            self.model = joblib.load(model_path)
            self.metadata = json.loads(meta_path.read_text(encoding="utf-8"))
            self.thresholds.update(self.metadata.get("thresholds", {}))
            log.info("Loaded model %s (%s)", self.metadata.get("model_name"), self.metadata.get("version"))
        except Exception as exc:  # noqa: BLE001 - any load failure must fall back, not crash the API
            log.warning("Model unavailable (%s); using rule-based fallback", exc)

    @property
    def engine(self) -> str:
        return "ml+rules" if self.model is not None else "rules-fallback"

    def assess(self, task: dict) -> Assessment:
        """task keys: title, description, category, budget_vnd, max_bids, deadline_hours, urgency, image_count."""
        rule = keyword_rule_score(task["title"], task["description"], task["category"], task["budget_vnd"])
        if self.model is not None:
            frame = model_frame(pd.DataFrame([task]))
            score = float(self.model.predict_proba(frame)[0, 1])
        else:
            score = rule
        t = self.thresholds
        if self.model is not None and score >= t["blocked"]:
            decision, level = "BLOCKED", "HIGH"
        elif score >= t["needs_review"] or rule >= t["hybrid_rule_score"]:
            decision, level = "NEEDS_REVIEW", "MEDIUM"
        else:
            decision, level = "APPROVED", None

        reasons = explain(task["title"], task["description"], task["category"], task["budget_vnd"])
        if decision != "APPROVED" and not reasons:
            reasons = ["Wording and task details resemble known scam posts (AI text model)"]
        return Assessment(
            fraudScore=round(score, 4),
            ruleScore=round(rule, 2),
            decision=decision,
            isSuspicious=decision != "APPROVED",
            riskLevel=level,
            suspiciousReason=reasons[0] if decision != "APPROVED" else None,
            reasons=reasons,
            engine=self.engine,
            modelVersion=self.metadata.get("version"),
        )
