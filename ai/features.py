"""
Feature engineering shared by training (ai/train.py) and serving (app/main.py).

Only fields a requester types into the ConnectMyTask "Post a Task" form are used.
Location (district/street) is deliberately NOT a model feature: flagging a task
because of where the requester lives would be unfair, and the plan asks for
privacy-aware handling of addresses.
"""
from __future__ import annotations

import math
import re
from datetime import datetime

import numpy as np
import pandas as pd

# Same table as src/modules/tasks/riskEvaluator.js
CATEGORY_MIN_BUDGET_VND = {
    "CLEANING": 250_000,
    "HOME_REPAIR": 350_000,
    "DELIVERY": 100_000,
    "MOVING": 700_000,
    "IT_SUPPORT": 300_000,
    "PERSONAL_ASSISTANT": 250_000,
    "TUTORING": 200_000,
    "OTHER": 200_000,
}
CATEGORIES = list(CATEGORY_MIN_BUDGET_VND)

# Columns the model is allowed to see (raw form inputs)
INPUT_COLUMNS = ["title", "description", "category", "budget_vnd", "max_bids", "deadline_hours", "urgency", "image_count"]
# Columns that must never reach the model (labels, identifiers, split keys)
FORBIDDEN_COLUMNS = ["is_fraud", "fraud_type", "group_id", "task_id", "posted_at", "deadline", "district",
                     "old_district", "street_name"]

PHONE_RE = re.compile(r"(?:\b0\d(?:[\s.\-]?\d){8}\b)|(?:\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b(?:\s+\w+){3})", re.I)
URL_RE = re.compile(r"(https?://|www\.|\b[\w-]+\.(?:ly|top|xyz|com|vn|net|link|click)\b)", re.I)
HANDLE_RE = re.compile(r"@\w{3,}")

# Red-flag lexicons. Each maps to a human-readable reason returned by the API.
RED_FLAGS: dict[str, tuple[list[str], str]] = {
    "off_platform": (["zalo", "z.a.l.o", "telegram", "whatsapp", "outside", "directly", "cash", "momo", "bank transfer"],
                     "Asks to move contact or payment off ConnectMyTask (bypasses escrow)"),
    "upfront_fee": (["fee", "deposit", "starter kit", "refund"],
                    "Asks the provider to pay money before working"),
    "personal_data": (["cccd", "id card", "otp", "bank login", "bank account", "bank card", "selfie", "date of birth", "code you receive"],
                      "Requests identity documents, bank details or OTP codes"),
    "unrealistic_pay": (["earn", "guaranteed", "no experience", "no skill", "commission", "income", "profit"],
                        "Promises unrealistic or guaranteed income"),
    "money_mule": (["reship", "repack", "forward", "transfer the rest", "packages", "no questions", "your own name"],
                   "Looks like parcel reshipping or money-mule activity"),
    "fake_engagement": (["review", "5-star", "five-star", "stars", "accounts", "click", "competitor"],
                        "Requests fake reviews, ratings or ad clicks (violates platform rules)"),
    "pressure": (["!!!", "limited", "hurry", "only today", "act now", "trust me", "legit", "first come"],
                 "Uses high-pressure or 'trust me' language"),
}
TRUST_SIGNALS = ["escrow", "through the app", "in the app", "app chat", "receipt", "after completion", "rating will be given"]


def hours_until(deadline: str | datetime | None, posted_at: datetime | None = None) -> float:
    if deadline in (None, ""):
        return 72.0
    if isinstance(deadline, str):
        deadline = datetime.fromisoformat(deadline.replace("Z", ""))
    now = posted_at or datetime.now()
    return max((deadline - now).total_seconds() / 3600.0, 0.0)


def prepare_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Turn the stored dataset (posted_at/deadline timestamps) into model input columns."""
    out = df.copy()
    if "deadline_hours" not in out:
        posted = pd.to_datetime(out["posted_at"])
        deadline = pd.to_datetime(out["deadline"])
        out["deadline_hours"] = ((deadline - posted).dt.total_seconds() / 3600.0).clip(lower=0)
    return out


def red_flag_hits(text: str) -> dict[str, list[str]]:
    low = text.lower()
    hits = {}
    for name, (words, _) in RED_FLAGS.items():
        found = [w for w in words if w in low]
        if found:
            hits[name] = found
    return hits


def engineered_row(title: str, description: str, category: str, budget: float, max_bids: float,
                   deadline_hours: float, urgency: str, image_count: float) -> dict[str, float]:
    text = f"{title} {description}"
    low = text.lower()
    letters = [c for c in text if c.isalpha()]
    category = (category or "OTHER").upper()
    min_budget = CATEGORY_MIN_BUDGET_VND.get(category, CATEGORY_MIN_BUDGET_VND["OTHER"])
    budget = float(budget or 0)
    ratio = budget / min_budget if min_budget else 0.0
    feats = {
        "log_budget": math.log1p(budget),
        "budget_ratio_log": math.log(max(ratio, 1e-3)),
        "budget_below_min": float(0 < budget < min_budget),
        "budget_far_below_min": float(0 < budget < 0.5 * min_budget),
        "budget_far_above_min": float(budget > 8 * min_budget),
        "log_deadline_hours": math.log1p(max(float(deadline_hours or 0), 0.0)),
        "is_urgent": float(str(urgency).upper() == "URGENT"),
        "max_bids": float(max_bids or 30),
        "image_count": float(image_count or 0),
        "title_len": float(len(title)),
        "desc_len_log": math.log1p(len(description)),
        "desc_word_count": float(len(description.split())),
        "upper_ratio": sum(c.isupper() for c in letters) / max(len(letters), 1),
        "title_all_caps": float(title.isupper() and len(title) > 5),
        "exclaim_count": float(text.count("!")),
        "digit_ratio": sum(c.isdigit() for c in text) / max(len(text), 1),
        "has_phone": float(bool(PHONE_RE.search(text))),
        "has_url": float(bool(URL_RE.search(text))),
        "has_handle": float(bool(HANDLE_RE.search(text))),
        "money_mentions": float(len(re.findall(r"\b\d{1,3}(?:[,.]\d{3})+\b|\bmillion\b|\bvnd\b", low))),
        "trust_signals": float(sum(s in low for s in TRUST_SIGNALS)),
    }
    for name, (words, _) in RED_FLAGS.items():
        feats[f"flag_{name}"] = float(sum(w in low for w in words))
    return feats


def engineered_frame(df: pd.DataFrame) -> pd.DataFrame:
    rows = [
        engineered_row(r.title, r.description, r.category, r.budget_vnd, r.max_bids, r.deadline_hours, r.urgency, r.image_count)
        for r in df[INPUT_COLUMNS].itertuples(index=False)
    ]
    return pd.DataFrame(rows, index=df.index)


ENGINEERED_COLUMNS = list(engineered_row("t", "d", "OTHER", 1, 30, 24, "NORMAL", 0).keys())


def model_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Final model input: combined text + category + engineered numeric features."""
    leaked = [c for c in FORBIDDEN_COLUMNS if c in INPUT_COLUMNS]
    assert not leaked, f"Forbidden columns used as input: {leaked}"
    base = df[INPUT_COLUMNS].copy()
    out = pd.DataFrame(index=df.index)
    out["text"] = (base["title"].fillna("") + " . " + base["description"].fillna("")).str.lower()
    out["category"] = base["category"].fillna("OTHER").str.upper()
    return pd.concat([out, engineered_frame(base)], axis=1)


def explain(title: str, description: str, category: str, budget: float) -> list[str]:
    """Human-readable reasons, aligned with the platform's suspiciousReason field."""
    reasons = [RED_FLAGS[name][1] for name in red_flag_hits(f"{title} {description}")]
    category = (category or "OTHER").upper()
    min_budget = CATEGORY_MIN_BUDGET_VND.get(category, CATEGORY_MIN_BUDGET_VND["OTHER"])
    if budget and budget < 0.5 * min_budget:
        reasons.append(f"Budget is far below the usual minimum for {category} ({min_budget:,.0f} VND)")
    elif budget and budget > 8 * min_budget:
        reasons.append(f"Budget is unusually high for {category} work - possible bait")
    text = f"{title} {description}"
    if PHONE_RE.search(text):
        reasons.append("Contains a phone number in the post")
    if URL_RE.search(text):
        reasons.append("Contains an external link")
    return list(dict.fromkeys(reasons))

