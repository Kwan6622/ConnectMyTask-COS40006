# ConnectMyTask – Fraud Task Detection AI

Fraud AI (Trust & Safety) for ConnectMyTask. A requester posts a task on the website, the FastAPI service scores
it with a trained ML model plus a rule-based fallback, and the task is then **published**, **held for admin review** or
**blocked**. The model is trained on synthetic task postings whose columns match the ConnectMyTask *Post a Task* form.

Built to the Project B plan for Fraud AI (P0, milestone M2):

- the final model is chosen by comparing candidates;
- it is evaluated on a held-out test set;
- data-leakage checks are run;
- it must beat the rule-based baseline;
- metrics are documented;
- the prediction API is integrated into the task flow;
- rule-based baselines remain as fallbacks.

```
Fraud-Task-Detect-AI/
├── data/
│   ├── generate_synthetic_tasks.py   # synthetic data generator (form columns + labels)
│   ├── synthetic_tasks.csv           # generated dataset (8,007 tasks)
│   └── hcmc_wards.json               # HCMC ward list copied from frontend-web/src/constants/hoChiMinhWards.ts
├── ai/
│   ├── features.py                   # feature engineering shared by training and the API
│   ├── baseline.py                   # rule baselines (port of riskEvaluator.js + red-flag keywords)
│   ├── train.py                      # model comparison, held-out evaluation, leakage checks, report
│   └── predictor.py                  # inference + decision policy + fallback
├── app/
│   ├── main.py                       # FastAPI service
│   └── static/                       # website (index.html, app.js, style.css)
├── models/                           # fraud_task_model.joblib + model_metadata.json
├── reports/                          # model_evaluation_report.md, CSVs, metrics.json, figures/
└── tests/test_api.py                 # API tests (valid, invalid, out-of-order requests)
```

## Quick start (Windows / PowerShell)

```powershell
cd "Functions\Fraud-Task-Detect-AI"
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python data\generate_synthetic_tasks.py     # 1. generate synthetic data
.venv\Scripts\python -m ai.train                          # 2. train, compare, evaluate, write report (~1 min)
.venv\Scripts\python -m pytest -q tests                   # 3. API tests
.venv\Scripts\python -m uvicorn app.main:app --port 8000  # 4. run website + API
```

Once the server is running:

- Website: <http://localhost:8000>
- Swagger docs: <http://localhost:8000/docs>
- Report: [`reports/model_evaluation_report.md`](reports/model_evaluation_report.md)

The generator takes `--rows`, `--fraud-rate` and `--seed`. `ai.train --data other.csv` retrains on any CSV with the
same columns, for example moderator-labelled tasks exported from the ConnectMyTask DB.

## Website

| Tab | What it does |
|---|---|
| **Post a task** | Same fields as ConnectMyTask: title, description, up to 3 images, category, HCMC district/ward, street, budget (VND), max bids, deadline, urgency. **Check with AI** only scores the task. **Post task** scores it and saves it. The sample buttons fill in legit, scam, subtle-scam and underpaid examples. |
| **Task feed** | Shows only tasks that are `OPEN` (approved by the AI or cleared by an admin). |
| **Admin review** | Queue of `PENDING_REVIEW` and `BLOCKED` tasks with the AI's reasons. Approving publishes the task, rejecting removes it. These decisions can be used as future training labels. |
| **Model report** | Headline held-out metrics, the comparison with the rule baselines, and the evaluation figures. |

## Synthetic data columns

| Column | Source in ConnectMyTask | Model input? |
|---|---|---|
| `title`, `description` | Post-task form | yes (text) |
| `category` | DELIVERY, HOME_REPAIR, CLEANING, IT_SUPPORT, PERSONAL_ASSISTANT, MOVING, TUTORING, OTHER | yes |
| `budget_vnd` | Budget (VND) | yes |
| `max_bids` | Max bids (1-30) | yes |
| `posted_at`, `deadline` | Deadline. The model uses hours until the deadline | yes (derived) |
| `urgency` | `TaskUrgency` NORMAL / URGENT | yes |
| `image_count` | Task images (max 3) | yes |
| `district`, `old_district`, `street_name` | Ward picker + street | **no** (fairness and address privacy) |
| `task_id`, `group_id` | Row id; requester or scam-campaign id used for grouped splits | no |
| `is_fraud`, `fraud_type` | Labels | target |

Fraud types in the data:

- `upfront_fee`
- `off_platform_payment`
- `personal_data_harvesting`
- `unrealistic_pay`
- `money_mule_reshipping`
- `fake_engagement`
- `underpay_exploitation`
- 1.5% label noise

The data also contains hard cases on both sides:

- legit posts that use scam-like words, e.g. "bring your ID card to building reception";
- subtle scams that look like normal tasks;
- obfuscated phone numbers;
- typos.

## API contract

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/health` | – | `{status, engine, modelVersion}` |
| GET | `/api/model` | – | Selected model, thresholds, test metrics, baseline metrics |
| GET | `/api/options` | – | Categories, category minimum budgets, HCMC ward groups |
| POST | `/api/validate` | `TaskIn` | `Assessment` (nothing is saved) |
| POST | `/api/tasks` | `TaskIn` | `201 TaskOut` with status `OPEN` / `PENDING_REVIEW` / `BLOCKED` |
| GET | `/api/tasks?status=OPEN` | `OPEN`, `PENDING_REVIEW`, `BLOCKED`, `REJECTED`, `ALL` | `TaskOut[]` |
| GET | `/api/tasks/{id}` | – | `TaskOut` or 404 |
| POST | `/api/tasks/{id}/review` | `{action: "approve" \| "reject", note?}` | `TaskOut`. Returns 409 if the task is not awaiting review |

`TaskIn` takes these fields. Invalid input returns **422**.

- `title` (5–120 characters)
- `description` (10–2000 characters)
- `category`
- `district` (must be a known HCMC ward)
- `streetName`
- `budget` (VND, > 0)
- `maxBids` (1–30)
- `deadline` (must be in the future)
- `urgency`
- `imageCount` (0–3)

`Assessment` uses the same names as the backend `Task` model, so it can be written straight into
`Task.isSuspicious`, `Task.riskLevel`, `Task.suspiciousReason` and `Task.riskAssessment`:

```json
{
  "fraudScore": 0.9943, "ruleScore": 1.0, "decision": "BLOCKED", "isSuspicious": true, "riskLevel": "HIGH",
  "suspiciousReason": "Asks to move contact or payment off ConnectMyTask (bypasses escrow)",
  "reasons": ["...", "..."], "engine": "ml+rules", "modelVersion": "20261124-014730"
}
```

### Decision policy

The thresholds are tuned on the validation split and stored in `models/model_metadata.json`.

- **BLOCKED** (`riskLevel` HIGH): the ML score is ≥ `blocked`. This threshold is set so validation precision is ≥ 99%.
- **NEEDS_REVIEW** (`riskLevel` MEDIUM): the ML score is ≥ `needs_review` (set so ≤ 3% of legit validation tasks land here), **or**
  the keyword/budget rule scores ≥ 1.0. The rule check gives a safety net for scam types the model has never seen.
- **APPROVED**: everything else.

If the model file is missing or fails to load, the API uses the rule baseline alone (`engine: "rules-fallback"`).

## Integrating with the ConnectMyTask backend

In `src/modules/tasks/service.js`, call `POST http://<fraud-ai>/api/validate` when a task is created. Store
`isSuspicious`, `riskLevel` and `suspiciousReason` on the task, and put the full response in `riskAssessment`. If the
decision is not `APPROVED`, keep the task out of the provider feed until an admin sets `reviewedByAdminAt`. If the call
times out, keep using the existing `evaluateTaskRisk()`.
