"""
Rule-based baselines the ML model must beat (Project B Definition of Done:
"AI features ... outperform their rule-based baseline"). They also act as the
fallback in the API when no trained model is available.

1. BudgetRuleBaseline  - a port of src/modules/tasks/riskEvaluator.js, the rule
                         currently running in the ConnectMyTask backend.
2. KeywordRuleBaseline - budget rule + red-flag keyword lexicon, i.e. what a
                         moderator checklist would do without ML.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .features import CATEGORY_MIN_BUDGET_VND, RED_FLAGS, red_flag_hits

KEYWORD_BUDGET_MODIFIERS = [
    (["deep clean", "deep cleaning", "full apartment", "whole house"], 1.6),
    (["fragile", "glass", "heavy", "stairs", "multiple floors"], 1.25),
    (["urgent", "asap", "today", "tonight", "immediately"], 1.2),
    (["install", "replacement parts", "materials included"], 1.3),
]


def budget_rule_score(title: str, description: str, category: str, budget: float) -> float:
    """0 = fine, 0.5 = MEDIUM, 1.0 = HIGH (same thresholds as riskEvaluator.js)."""
    text = f"{title} {description}".lower()
    threshold = CATEGORY_MIN_BUDGET_VND.get(str(category).upper(), CATEGORY_MIN_BUDGET_VND["OTHER"])
    for keywords, mult in KEYWORD_BUDGET_MODIFIERS:
        if any(k in text for k in keywords):
            threshold = round(threshold * mult)
    if not budget or budget >= threshold:
        return 0.0
    return 1.0 if budget / threshold < 0.5 else 0.5


def keyword_rule_score(title: str, description: str, category: str, budget: float) -> float:
    hits = red_flag_hits(f"{title} {description}")
    score = min(len(hits) / 2.0, 1.0)  # two distinct red-flag families -> max score
    return max(score, budget_rule_score(title, description, category, budget))


class _RuleModel:
    name = "rule"
    fn = staticmethod(budget_rule_score)

    def fit(self, X: pd.DataFrame, y=None):
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        scores = np.array([self.fn(r.title, r.description, r.category, r.budget_vnd)
                           for r in X[["title", "description", "category", "budget_vnd"]].itertuples(index=False)])
        return np.column_stack([1 - scores, scores])


class BudgetRuleBaseline(_RuleModel):
    name = "Baseline A - budget rule (riskEvaluator.js)"
    fn = staticmethod(budget_rule_score)


class KeywordRuleBaseline(_RuleModel):
    name = "Baseline B - budget + red-flag keywords"
    fn = staticmethod(keyword_rule_score)


__all__ = ["BudgetRuleBaseline", "KeywordRuleBaseline", "budget_rule_score", "keyword_rule_score", "RED_FLAGS"]
