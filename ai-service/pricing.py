from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import random
import re
from typing import Any
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.feature_extraction.text import TfidfVectorizer


app = FastAPI(
    title="ConnectMyTask Budget AI",
    description="Title-first, subtype-aware AI budget suggestion service for ConnectMyTask.",
)

# Add this block to allow the frontend to communicate with the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (good for local testing)
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (POST, GET, etc.)
    allow_headers=["*"],
)


class TaskInput(BaseModel):
    # Legacy payload support
    Category: str | None = None
    Distance_km: float | None = None
    Duration_hours: float | None = None
    Is_Urgent: int | None = None
    # Extended payload support
    category: str | None = None
    title: str | None = ""
    description: str | None = ""
    location: str | None = ""
    budget: float | None = None
    complexity: str | None = None
    urgency: str | None = None


class RecommendInput(BaseModel):
    title: str | None = ""
    category: str
    description: str | None = ""
    location: str | None = ""
    urgency: str | None = ""
    budget: float | None = None


@dataclass
class ParsedContext:
    category: str
    subtype: str
    title: str
    description: str
    location: str
    urgency_score: float
    complexity_score: float
    quantity_score: float
    scope_score: float
    location_score: float
    distance_km: float
    duration_hours: float
    is_urgent_flag: int
    title_priority_reason: str


MODEL_BUNDLE: dict[str, Any] | None = None

DISTRICT_NAMES = [
    "district 1", "district 2", "district 3", "district 4", "district 5", "district 6",
    "district 7", "district 8", "district 9", "district 10", "district 11", "district 12",
    "thu duc", "binh thanh", "phu nhuan", "tan binh", "tan phu", "go vap",
    "binh chanh", "nha be", "hoc mon", "cu chi",
]

CATEGORY_TO_DEFAULT_SUBTYPE: dict[str, str] = {
    "HOME_REPAIR": "GENERAL_REPAIR",
    "CLEANING": "BASIC_CLEANING",
    "DELIVERY": "PARCEL_DELIVERY",
    "MOVING": "SMALL_MOVING",
    "IT_SUPPORT": "SOFTWARE_SUPPORT",
    "TECH_SUPPORT": "SOFTWARE_SUPPORT",
    "PERSONAL_ASSISTANT": "ERRANDS",
    "TUTORING": "TUTORING_GENERAL",
    "ELECTRICAL": "ELECTRICAL_REPAIR",
    "OTHER": "GENERAL_HELP",
}

# subtype: top-level category + weighted keyword sets (title hit weighted higher)
SUBTYPE_DEFINITIONS: dict[str, dict[str, Any]] = {
    # CLEANING
    "DEEP_CLEANING": {"category": "CLEANING", "keywords": ["deep clean", "deep cleaning", "intensive", "post renovation", "after renovation", "move-out", "move out"]},
    "APARTMENT_CLEANING": {"category": "CLEANING", "keywords": ["apartment", "condo", "flat", "bedroom", "living room"]},
    "HOUSE_CLEANING": {"category": "CLEANING", "keywords": ["house", "villa", "townhouse"]},
    "OFFICE_CLEANING": {"category": "CLEANING", "keywords": ["office", "workspace", "company", "meeting room"]},
    "KITCHEN_BATHROOM_CLEANING": {"category": "CLEANING", "keywords": ["kitchen", "bathroom", "toilet", "grease", "mold"]},
    "SOFA_MATTRESS_CLEANING": {"category": "CLEANING", "keywords": ["sofa", "mattress", "carpet", "upholstery"]},
    "BASIC_CLEANING": {"category": "CLEANING", "keywords": ["clean room", "basic cleaning", "regular cleaning", "one-time cleaning"]},

    # DELIVERY
    "URGENT_DOCUMENT_DELIVERY": {"category": "DELIVERY", "keywords": ["urgent", "asap", "same-day", "same day", "document", "legal", "contract"]},
    "DOCUMENT_DELIVERY": {"category": "DELIVERY", "keywords": ["document", "paper", "legal", "contract", "certificate"]},
    "PARCEL_DELIVERY": {"category": "DELIVERY", "keywords": ["parcel", "package", "pickup", "drop-off", "box"]},
    "HEAVY_FRAGILE_DELIVERY": {"category": "DELIVERY", "keywords": ["heavy", "fragile", "bulky", "large item"]},

    # HOME_REPAIR / ELECTRICAL
    "PLUMBING_REPAIR": {"category": "HOME_REPAIR", "keywords": ["leak", "leaking", "pipe", "sink", "toilet", "drain", "faucet", "water"]},
    "ELECTRICAL_REPAIR": {"category": "HOME_REPAIR", "keywords": ["switch", "outlet", "socket", "wiring", "fan", "light", "circuit", "power"]},
    "INSTALLATION_WORK": {"category": "HOME_REPAIR", "keywords": ["install", "installation", "mount", "assemble", "set up", "setup"]},
    "FURNITURE_REPAIR": {"category": "HOME_REPAIR", "keywords": ["cabinet", "shelf", "wardrobe", "table", "door", "hinge"]},
    "GENERAL_REPAIR": {"category": "HOME_REPAIR", "keywords": ["repair", "fix", "broken", "damage", "issue"]},

    # IT SUPPORT
    "WIFI_NETWORK_SETUP": {"category": "IT_SUPPORT", "keywords": ["wifi", "wi-fi", "router", "network", "internet"]},
    "LAPTOP_DESKTOP_REPAIR": {"category": "IT_SUPPORT", "keywords": ["laptop", "desktop", "pc", "hardware", "overheat", "screen"]},
    "SOFTWARE_TROUBLESHOOTING": {"category": "IT_SUPPORT", "keywords": ["software", "app", "error", "bug", "virus", "windows", "macos"]},
    "PRINTER_DEVICE_SETUP": {"category": "IT_SUPPORT", "keywords": ["printer", "scanner", "driver", "device setup"]},

    # MOVING
    "HEAVY_FURNITURE_MOVING": {"category": "MOVING", "keywords": ["wardrobe", "bed", "fridge", "sofa", "piano", "furniture", "heavy"]},
    "FRAGILE_MOVING": {"category": "MOVING", "keywords": ["fragile", "glass", "tv", "monitor"]},
    "BOX_TRANSPORT": {"category": "MOVING", "keywords": ["box", "boxes", "carton"]},
    "SMALL_MOVING": {"category": "MOVING", "keywords": ["small move", "few items", "carry items"]},

    # PERSONAL ASSISTANT
    "ERRANDS": {"category": "PERSONAL_ASSISTANT", "keywords": ["errand", "buy", "pickup", "drop", "shopping", "queue", "wait"]},
    "HOUSEHOLD_HELP": {"category": "PERSONAL_ASSISTANT", "keywords": ["household", "home help", "organize", "assistant"]},

    # TUTORING
    "EXAM_PREP_TUTORING": {"category": "TUTORING", "keywords": ["exam", "ielts", "toeic", "sat", "prep"]},
    "LANGUAGE_TUTORING": {"category": "TUTORING", "keywords": ["english", "language", "speaking", "grammar"]},
    "SUBJECT_TUTORING": {"category": "TUTORING", "keywords": ["math", "physics", "chemistry", "assignment", "homework"]},
    "TUTORING_GENERAL": {"category": "TUTORING", "keywords": ["tutor", "teaching", "lesson"]},

    # OTHER
    "GENERAL_HELP": {"category": "OTHER", "keywords": ["help", "support", "assistant", "service"]},
}

# base market ranges (SGD) by subtype
SUBTYPE_BASE_SGD: dict[str, tuple[int, int]] = {
    "DEEP_CLEANING": (45, 150),
    "APARTMENT_CLEANING": (28, 90),
    "HOUSE_CLEANING": (35, 120),
    "OFFICE_CLEANING": (50, 160),
    "KITCHEN_BATHROOM_CLEANING": (30, 95),
    "SOFA_MATTRESS_CLEANING": (25, 90),
    "BASIC_CLEANING": (18, 65),
    "URGENT_DOCUMENT_DELIVERY": (18, 55),
    "DOCUMENT_DELIVERY": (9, 28),
    "PARCEL_DELIVERY": (12, 42),
    "HEAVY_FRAGILE_DELIVERY": (25, 95),
    "PLUMBING_REPAIR": (25, 85),
    "ELECTRICAL_REPAIR": (30, 100),
    "INSTALLATION_WORK": (26, 90),
    "FURNITURE_REPAIR": (25, 80),
    "GENERAL_REPAIR": (22, 70),
    "WIFI_NETWORK_SETUP": (25, 90),
    "LAPTOP_DESKTOP_REPAIR": (30, 110),
    "SOFTWARE_TROUBLESHOOTING": (18, 70),
    "PRINTER_DEVICE_SETUP": (22, 85),
    "HEAVY_FURNITURE_MOVING": (90, 280),
    "FRAGILE_MOVING": (70, 220),
    "BOX_TRANSPORT": (40, 150),
    "SMALL_MOVING": (35, 120),
    "ERRANDS": (15, 55),
    "HOUSEHOLD_HELP": (18, 65),
    "EXAM_PREP_TUTORING": (25, 90),
    "LANGUAGE_TUTORING": (22, 80),
    "SUBJECT_TUTORING": (25, 100),
    "TUTORING_GENERAL": (22, 75),
    "GENERAL_HELP": (18, 70),
}


def normalize_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def to_sgd_round(value: float) -> int:
    # Round to nearest SGD dollar
    return int(round(value))


def safe_first_number(text: str) -> int | None:
    m = re.search(r"\b(\d{1,3})\b", text)
    return int(m.group(1)) if m else None


def infer_location_score(location: str, merged_text: str) -> float:
    text = f"{location} {merged_text}"
    district_hits = [d for d in DISTRICT_NAMES if d in text]
    if len(district_hits) >= 2:
        return 0.85
    if len(district_hits) == 1:
        return 0.65
    return 0.45


def detect_distance_km(location: str, merged_text: str) -> float:
    km_match = re.search(r"(\d{1,2})\s?(km|kilometer|kilometre)", merged_text)
    if km_match:
        return float(max(1, min(40, int(km_match.group(1)))))
    district_hits = [d for d in DISTRICT_NAMES if d in f"{location} {merged_text}"]
    if len(district_hits) >= 2:
        return 12.0
    if len(district_hits) == 1:
        return 6.0
    return 7.0


def detect_urgency_score(merged_text: str, urgency_field: str = "") -> float:
    text = f"{merged_text} {normalize_text(urgency_field)}"
    high = ["urgent", "asap", "immediately", "same-day", "same day", "right now", "rush", "tonight"]
    medium = ["today", "soon", "weekend"]
    if any(k in text for k in high):
        return 1.0
    if any(k in text for k in medium):
        return 0.7
    return 0.25


def detect_quantity_score(merged_text: str) -> float:
    n = safe_first_number(merged_text)
    if n is None:
        return 0.4
    if n >= 12:
        return 1.0
    if n >= 6:
        return 0.85
    if n >= 3:
        return 0.7
    if n >= 2:
        return 0.58
    return 0.45


def detect_scope_score(merged_text: str) -> float:
    high = ["whole", "entire", "full apartment", "full house", "all rooms", "multiple", "several"]
    medium = ["kitchen and bathroom", "living room", "apartment", "office", "furniture"]
    if any(k in merged_text for k in high):
        return 0.9
    if any(k in merged_text for k in medium):
        return 0.65
    return 0.4


def detect_complexity_score(merged_text: str) -> float:
    high = ["deep", "complex", "install and repair", "wiring", "leak", "fragile", "heavy", "post renovation"]
    medium = ["repair", "fix", "setup", "install", "network", "moving"]
    if any(k in merged_text for k in high):
        return 0.9
    if any(k in merged_text for k in medium):
        return 0.65
    return 0.38


def infer_subtype(category: str, title: str, description: str) -> tuple[str, str]:
    title_text = normalize_text(title)
    desc_text = normalize_text(description)
    default_sub = CATEGORY_TO_DEFAULT_SUBTYPE.get(category, "GENERAL_HELP")
    merged = f"{title_text} {desc_text}"

    # Hard overrides for common high-signal intents.
    if category == "CLEANING" and any(k in merged for k in ["deep clean", "deep cleaning", "post renovation", "move-out", "move out"]):
        return "DEEP_CLEANING", "Title/description explicitly indicates deep cleaning scope"
    if category in {"HOME_REPAIR", "ELECTRICAL"}:
        if any(k in merged for k in ["leak", "leaking", "pipe", "sink", "toilet", "drain", "faucet", "water"]):
            return "PLUMBING_REPAIR", "Title/description indicates plumbing-related issue"
        if any(k in merged for k in ["switch", "outlet", "socket", "wiring", "fan", "light", "circuit", "power"]):
            return "ELECTRICAL_REPAIR", "Title/description indicates electrical-related issue"
        if any(k in merged for k in ["install", "installation", "mount", "assemble", "set up", "setup"]):
            return "INSTALLATION_WORK", "Title/description indicates installation work"

    best_sub = default_sub
    best_score = -1
    best_reason = ""

    for subtype, definition in SUBTYPE_DEFINITIONS.items():
        target_category = definition["category"]
        keywords: list[str] = definition["keywords"]

        category_bonus = 0
        if target_category == category:
            category_bonus = 2
        elif category == "OTHER":
            category_bonus = 1

        title_hits = sum(3 for kw in keywords if kw in title_text)
        desc_hits = sum(1 for kw in keywords if kw in desc_text)
        score = category_bonus + title_hits + desc_hits

        if score > best_score:
            best_score = score
            best_sub = subtype
            if title_hits > 0:
                best_reason = f"Title keywords strongly match {subtype.lower().replace('_', ' ')}"
            elif desc_hits > 0:
                best_reason = f"Description details match {subtype.lower().replace('_', ' ')}"
            else:
                best_reason = f"Using category default mapping for {category.lower()}"

    return best_sub, best_reason


def infer_duration_hours(subtype: str, complexity: float, quantity: float, scope: float) -> float:
    base = {
        "DEEP_CLEANING": 4.5,
        "APARTMENT_CLEANING": 3.0,
        "HOUSE_CLEANING": 3.8,
        "OFFICE_CLEANING": 4.2,
        "KITCHEN_BATHROOM_CLEANING": 2.8,
        "SOFA_MATTRESS_CLEANING": 2.4,
        "BASIC_CLEANING": 2.0,
        "URGENT_DOCUMENT_DELIVERY": 1.2,
        "DOCUMENT_DELIVERY": 0.9,
        "PARCEL_DELIVERY": 1.2,
        "HEAVY_FRAGILE_DELIVERY": 2.2,
        "PLUMBING_REPAIR": 2.0,
        "ELECTRICAL_REPAIR": 2.4,
        "INSTALLATION_WORK": 2.0,
        "FURNITURE_REPAIR": 2.0,
        "GENERAL_REPAIR": 1.9,
        "WIFI_NETWORK_SETUP": 2.0,
        "LAPTOP_DESKTOP_REPAIR": 2.4,
        "SOFTWARE_TROUBLESHOOTING": 1.8,
        "PRINTER_DEVICE_SETUP": 1.8,
        "HEAVY_FURNITURE_MOVING": 5.0,
        "FRAGILE_MOVING": 4.2,
        "BOX_TRANSPORT": 3.2,
        "SMALL_MOVING": 2.6,
        "ERRANDS": 1.6,
        "HOUSEHOLD_HELP": 2.0,
        "EXAM_PREP_TUTORING": 2.2,
        "LANGUAGE_TUTORING": 1.8,
        "SUBJECT_TUTORING": 2.0,
        "TUTORING_GENERAL": 1.8,
        "GENERAL_HELP": 2.0,
    }.get(subtype, 2.0)
    hours = base * (0.75 + complexity * 0.30 + quantity * 0.18 + scope * 0.20)
    return float(max(0.5, round(hours, 1)))


def parse_task_context(
    *,
    category: str,
    title: str,
    description: str,
    location: str,
    urgency: str = "",
    distance_km_legacy: float | None = None,
    duration_hours_legacy: float | None = None,
    is_urgent_legacy: int | None = None,
) -> ParsedContext:
    normalized_category = (category or "OTHER").strip().upper()
    title_text = normalize_text(title)
    desc_text = normalize_text(description)
    merged_text = f"{title_text} {desc_text}".strip()

    subtype, subtype_reason = infer_subtype(normalized_category, title_text, desc_text)
    urgency_score = detect_urgency_score(merged_text, urgency)
    complexity_score = detect_complexity_score(merged_text)
    quantity_score = detect_quantity_score(merged_text)
    scope_score = detect_scope_score(merged_text)
    location_score = infer_location_score(normalize_text(location), merged_text)

    distance_km = float(distance_km_legacy) if distance_km_legacy is not None else detect_distance_km(normalize_text(location), merged_text)
    is_urgent_flag = int(is_urgent_legacy) if is_urgent_legacy is not None else int(urgency_score >= 0.8)
    duration_hours = float(duration_hours_legacy) if duration_hours_legacy is not None else infer_duration_hours(subtype, complexity_score, quantity_score, scope_score)

    return ParsedContext(
        category=normalized_category,
        subtype=subtype,
        title=title or "",
        description=description or "",
        location=location or "",
        urgency_score=urgency_score,
        complexity_score=complexity_score,
        quantity_score=quantity_score,
        scope_score=scope_score,
        location_score=location_score,
        distance_km=max(1.0, distance_km),
        duration_hours=max(0.5, duration_hours),
        is_urgent_flag=is_urgent_flag,
        title_priority_reason=subtype_reason,
    )


def rule_based_sgd(context: ParsedContext) -> float:
    base_min, base_max = SUBTYPE_BASE_SGD.get(context.subtype, (22, 70))
    midpoint = (base_min + base_max) / 2

    multiplier = (
        0.72
        + context.complexity_score * 0.25
        + context.quantity_score * 0.15
        + context.scope_score * 0.14
        + context.location_score * 0.08
        + min(context.distance_km, 30.0) / 150.0
        + (0.14 if context.is_urgent_flag else 0.0)
    )
    return max(12.0, midpoint * multiplier)


def text_feature(context: ParsedContext) -> str:
    return (
        f"title {normalize_text(context.title)} "
        f"description {normalize_text(context.description)} "
        f"subtype {context.subtype.lower()} "
        f"category {context.category.lower()}"
    )


def numerical_features(context: ParsedContext) -> np.ndarray:
    return np.array([
        context.distance_km,
        context.duration_hours,
        float(context.is_urgent_flag),
        context.urgency_score,
        context.complexity_score,
        context.quantity_score,
        context.scope_score,
        context.location_score,
    ], dtype=float)


def create_synthetic_training_data(size: int = 1200) -> tuple[list[str], np.ndarray, np.ndarray]:
    random.seed(2026)
    texts: list[str] = []
    nums: list[np.ndarray] = []
    targets: list[float] = []

    subtype_list = list(SUBTYPE_BASE_SGD.keys())
    category_list = list(CATEGORY_TO_DEFAULT_SUBTYPE.keys())

    for _ in range(size):
        subtype = random.choice(subtype_list)
        category = random.choice(category_list)
        urgency_score = random.choice([0.2, 0.25, 0.3, 0.7, 1.0])
        complexity_score = random.uniform(0.35, 0.98)
        quantity_score = random.uniform(0.35, 0.98)
        scope_score = random.uniform(0.35, 0.98)
        location_score = random.uniform(0.4, 0.9)
        distance = random.uniform(2.0, 20.0)
        duration = infer_duration_hours(subtype, complexity_score, quantity_score, scope_score)
        urgent_flag = int(urgency_score >= 0.8)

        synthetic_context = ParsedContext(
            category=category,
            subtype=subtype,
            title=f"{subtype.lower().replace('_', ' ')} service",
            description=f"sample {subtype.lower().replace('_', ' ')} task with practical scope",
            location="district 1",
            urgency_score=urgency_score,
            complexity_score=complexity_score,
            quantity_score=quantity_score,
            scope_score=scope_score,
            location_score=location_score,
            distance_km=distance,
            duration_hours=duration,
            is_urgent_flag=urgent_flag,
            title_priority_reason="synthetic training sample",
        )

        base = rule_based_sgd(synthetic_context)
        target = base * random.uniform(0.9, 1.12)

        texts.append(text_feature(synthetic_context))
        nums.append(numerical_features(synthetic_context))
        targets.append(target)

    return texts, np.vstack(nums), np.array(targets, dtype=float)


def train_fallback_model() -> dict[str, Any]:
    texts, nums, targets = create_synthetic_training_data()

    vectorizer = TfidfVectorizer(max_features=320, ngram_range=(1, 2))
    x_text = vectorizer.fit_transform(texts).toarray()
    x_all = np.hstack([x_text, nums])

    # Explainable practical ensemble for capstone: GBR + RF average
    gbr = GradientBoostingRegressor(random_state=2026, n_estimators=260, max_depth=3)
    rf = RandomForestRegressor(random_state=2026, n_estimators=220, max_depth=12, n_jobs=1)
    gbr.fit(x_all, targets)
    rf.fit(x_all, targets)

    return {
        "vectorizer": vectorizer,
        "gbr": gbr,
        "rf": rf,
        "mode": "trained_fallback_ensemble",
        "model_name": "GradientBoosting + RandomForest",
    }


def load_model_bundle() -> dict[str, Any]:
    model_dir = Path(__file__).resolve().parent / "models"
    bundle_path = model_dir / "pricing_bundle.pkl"
    if bundle_path.exists():
        try:
            bundle = joblib.load(bundle_path)
            if isinstance(bundle, dict) and "vectorizer" in bundle:
                if "gbr" in bundle and "rf" in bundle:
                    bundle["mode"] = "pretrained_ensemble"
                    bundle.setdefault("model_name", "GradientBoosting + RandomForest")
                    return bundle
                if "regressor" in bundle:
                    bundle["mode"] = "pretrained_single"
                    bundle.setdefault("model_name", type(bundle["regressor"]).__name__)
                    return bundle
        except Exception:
            pass
    return train_fallback_model()


@app.on_event("startup")
def startup() -> None:
    global MODEL_BUNDLE
    MODEL_BUNDLE = load_model_bundle()
    print(f"AI model initialized in mode: {MODEL_BUNDLE.get('mode', 'unknown')}, model={MODEL_BUNDLE.get('model_name', 'unknown')}")


def ml_predict_sgd(context: ParsedContext) -> float:
    if not MODEL_BUNDLE:
        return rule_based_sgd(context)

    vectorizer: TfidfVectorizer = MODEL_BUNDLE["vectorizer"]
    x_text = vectorizer.transform([text_feature(context)]).toarray()
    x_num = numerical_features(context).reshape(1, -1)
    x_all = np.hstack([x_text, x_num])

    if "gbr" in MODEL_BUNDLE and "rf" in MODEL_BUNDLE:
        gbr_val = float(MODEL_BUNDLE["gbr"].predict(x_all)[0])
        rf_val = float(MODEL_BUNDLE["rf"].predict(x_all)[0])
        value = gbr_val * 0.55 + rf_val * 0.45
    else:
        reg = MODEL_BUNDLE.get("regressor")
        value = float(reg.predict(x_all)[0]) if reg is not None else rule_based_sgd(context)

    return max(12.0, value)


def confidence_score(context: ParsedContext, rule_value: float, ml_value: float) -> float:
    deviation = abs(ml_value - rule_value) / max(rule_value, 1.0)
    base = 0.93 - min(0.35, deviation)

    # Lower confidence when title is vague or category OTHER.
    vague_penalty = 0.0
    if "default mapping" in context.title_priority_reason.lower():
        vague_penalty += 0.10
    if context.category == "OTHER":
        vague_penalty += 0.08

    conf = base - vague_penalty
    return float(max(0.52, min(0.98, conf)))


def build_explanation(context: ParsedContext, min_sgd: int, max_sgd: int) -> str:
    subtype = context.subtype.lower().replace("_", " ")
    complexity_label = "high" if context.complexity_score >= 0.8 else "moderate" if context.complexity_score >= 0.55 else "light"
    urgency_label = "urgent" if context.is_urgent_flag else "normal urgency"
    return (
        f"Suggested based on {subtype} inferred from the title/description, "
        f"{complexity_label} complexity, {urgency_label}, and scope/location signals. "
        f"Estimated range {min_sgd} - {max_sgd} SGD."
    )


def predict_budget(context: ParsedContext) -> dict[str, Any]:
    rule_sgd = rule_based_sgd(context)
    ml_sgd = ml_predict_sgd(context)

    # ML is primary; rule gives stability and explainability.
    blended = rule_sgd * 0.30 + ml_sgd * 0.70

    conf = confidence_score(context, rule_sgd, ml_sgd)
    # high confidence => narrower range, low confidence => wider range
    spread_ratio = 0.30 - (conf - 0.5) * 0.22
    spread_ratio = max(0.12, min(0.34, spread_ratio))

    min_sgd = to_sgd_round(blended * (1.0 - spread_ratio))
    max_sgd = to_sgd_round(blended * (1.0 + spread_ratio))
    suggested = to_sgd_round((min_sgd + max_sgd) / 2)

    explanation = build_explanation(context, min_sgd, max_sgd)

    factors = {
        "top_level_category": context.category,
        "inferred_subtype": context.subtype,
        "distance_km": round(context.distance_km, 1),
        "duration_hours": round(context.duration_hours, 1),
        "urgency_score": round(context.urgency_score, 2),
        "complexity_score": round(context.complexity_score, 2),
        "quantity_score": round(context.quantity_score, 2),
        "scope_score": round(context.scope_score, 2),
        "location_score": round(context.location_score, 2),
        "title_analysis": context.title_priority_reason,
    }

    return {
        "suggestedPrice": int(suggested),
        "minPrice": int(min_sgd),
        "maxPrice": int(max_sgd),
        "currency": "SGD",
        "confidenceScore": round(conf, 2),
        "explanation": explanation,
        "detectedSubtype": context.subtype,
        "factorsUsed": factors,
        # Backward-compatible aliases used by current web/backend
        "ai_suggested_price": int(suggested),
        "price_band_min": int(min_sgd),
        "price_band_max": int(max_sgd),
        "rationale": explanation,
        "detected_subtype": context.subtype,
        "factors_used": factors,
        "rule_based_price": int(to_sgd_round(rule_sgd)),
        "model_mode": MODEL_BUNDLE.get("mode") if MODEL_BUNDLE else "rule_only",
        "model_name": MODEL_BUNDLE.get("model_name") if MODEL_BUNDLE else "rule_only",
    }


def resolve_payload(task: TaskInput) -> ParsedContext:
    category = task.category or task.Category or "OTHER"
    title = task.title or ""
    description = task.description or ""
    location = task.location or ""

    if not title and not description:
        title = f"{category} task"
        description = f"{category} service request"

    return parse_task_context(
        category=category,
        title=title,
        description=description,
        location=location,
        urgency=task.urgency or "",
        distance_km_legacy=task.Distance_km,
        duration_hours_legacy=task.Duration_hours,
        is_urgent_legacy=task.Is_Urgent,
    )


@app.post("/predict-price")
def predict_price(task: TaskInput) -> dict[str, Any]:
    try:
        context = resolve_payload(task)
        return predict_budget(context)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {error}") from error


@app.post("/recommend")
def recommend(task: RecommendInput) -> dict[str, Any]:
    try:
        context = parse_task_context(
            category=task.category,
            title=task.title or "",
            description=task.description or "",
            location=task.location or "",
            urgency=task.urgency or "",
        )
        pred = predict_budget(context)

        # New top-level format
        response = {
            "suggestedPrice": pred["suggestedPrice"],
            "minPrice": pred["minPrice"],
            "maxPrice": pred["maxPrice"],
            "currency": pred["currency"],
            "confidenceScore": pred["confidenceScore"],
            "explanation": pred["explanation"],
            "detectedSubtype": pred["detectedSubtype"],
            "factorsUsed": pred["factorsUsed"],
            "recommendedProviders": [],
            # Backward-compatible meta block
            "meta": {
                "mappedCategory": context.category,
                "detectedSubtype": pred["detectedSubtype"],
                "distanceKm": pred["factorsUsed"]["distance_km"],
                "durationHours": pred["factorsUsed"]["duration_hours"],
                "isUrgent": context.is_urgent_flag,
                "priceBandMin": pred["minPrice"],
                "priceBandMax": pred["maxPrice"],
                "currency": pred["currency"],
                "explanation": pred["explanation"],
                "factorsUsed": pred["factorsUsed"],
            },
        }
        return response
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Recommendation failed: {error}") from error
