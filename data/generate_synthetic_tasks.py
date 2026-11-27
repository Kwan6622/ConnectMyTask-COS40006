"""
Synthetic task-posting generator for the ConnectMyTask Fraud Task Detection AI.

Every row is one task as a requester would submit it through the ConnectMyTask
"Post a Task" form (frontend-web/src/pages/TaskPostPage.tsx):

    title, description, category, district (ward), street_name,
    budget_vnd, max_bids, deadline, urgency, image_count

plus metadata that is NOT used as model input:

    task_id, old_district, posted_at, group_id, is_fraud, fraud_type

`group_id` is the requester (legit) or scam campaign (fraud) that produced the
post. Posts in one group share wording, so train/test splits are made by group
to avoid near-duplicate leakage (Project B plan: "check for data leakage").

Usage:
    python data/generate_synthetic_tasks.py            # 8000 rows, seed 42
    python data/generate_synthetic_tasks.py --rows 12000 --seed 7
"""
from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent

# Mirrors src/modules/tasks/riskEvaluator.js (CATEGORY_MIN_BUDGET_VND)
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
CATEGORY_WEIGHTS = [0.17, 0.17, 0.16, 0.10, 0.12, 0.08, 0.12, 0.08]

STREETS = [
    "Bach Dang", "Le Loi", "Nguyen Hue", "Hai Ba Trung", "Dien Bien Phu", "Cach Mang Thang Tam",
    "Nguyen Thi Minh Khai", "Vo Van Tan", "Pasteur", "Ly Tu Trong", "Tran Hung Dao", "Nguyen Trai",
    "Phan Xich Long", "Hoang Van Thu", "Cong Hoa", "Truong Chinh", "Quang Trung", "Phan Van Tri",
    "Nguyen Van Linh", "Huynh Tan Phat", "Le Van Viet", "Vo Van Ngan", "Kha Van Can", "Xo Viet Nghe Tinh",
    "Nguyen Oanh", "Le Duc Tho", "Au Co", "Luy Ban Bich", "Tan Ky Tan Quy", "Kinh Duong Vuong",
]

# --------------------------------------------------------------------------
# Legitimate task content
# --------------------------------------------------------------------------
LEGIT = {
    "CLEANING": {
        "titles": ["Clean {size} apartment in {ward}", "Weekly house cleaning needed", "Deep cleaning after renovation",
                   "Clean kitchen and two bathrooms", "Office cleaning on {day}", "Move-out cleaning for {size} flat",
                   "Sofa and carpet cleaning", "Window cleaning for townhouse"],
        "details": ["The apartment is {size} with {rooms} bedrooms.", "Please bring your own vacuum and mop if possible.",
                    "Cleaning supplies are available at the house.", "Focus on kitchen grease and bathroom tiles.",
                    "There is a cat at home, please keep the door closed.", "Need the floor mopped and dust removed from shelves.",
                    "It is a deep clean after painting, there is a lot of dust.", "Estimated about {hours} hours of work."],
    },
    "HOME_REPAIR": {
        "titles": ["Fix leaking kitchen sink", "Repair air conditioner not cooling", "Install ceiling fan in bedroom",
                   "Fix broken door lock", "Replace bathroom tap", "Repair water heater", "Fix electrical socket sparking",
                   "Patch and repaint wall crack"],
        "details": ["The sink has been leaking under the cabinet for two days.", "The AC is a {brand} 1.5HP unit, it runs but does not cool.",
                    "I already bought the fan, just need installation.", "Please bring your own tools.",
                    "Replacement parts can be bought nearby, I will pay for materials separately with receipt.",
                    "The house is on the third floor, no elevator.", "Please send a photo of the work after finishing.",
                    "Estimated about {hours} hours of work."],
    },
    "DELIVERY": {
        "titles": ["Deliver documents to {ward}", "Pick up food order and deliver", "Send a small parcel across town",
                   "Deliver birthday cake before {time}", "Pick up laptop from repair shop", "Deliver flowers to office",
                   "Return package to shop in {ward}"],
        "details": ["The parcel is small, about {kg} kg.", "Distance is around {km} km.", "Please handle with care, it is fragile glass.",
                    "Receiver will sign on the app when the item arrives.", "Pickup is at the front desk of the building.",
                    "Needs to arrive before {time} today.", "Motorbike is fine for this delivery."],
    },
    "MOVING": {
        "titles": ["Help move {size} apartment", "Move furniture to new house in {ward}", "Need truck and 2 helpers for moving",
                   "Move a fridge and washing machine", "Office relocation small team", "Move boxes from storage room"],
        "details": ["Around {boxes} boxes plus a bed, wardrobe and desk.", "Old place is on the 4th floor with stairs.",
                    "New place is about {km} km away.", "Some items are heavy, please bring a trolley.",
                    "I need a small truck, helpers should be able to lift heavy items.", "Please wrap the TV and mirror carefully."],
    },
    "IT_SUPPORT": {
        "titles": ["Set up home WiFi router", "Fix slow laptop", "Install Windows and Office", "Recover files from USB",
                   "Set up printer for small office", "Configure security camera app", "Remove virus from computer"],
        "details": ["The laptop is a {brand} and takes 5 minutes to boot.", "I have the original license key.",
                    "Need help setting up 3 computers to share one printer.", "Please back up my data before reinstalling.",
                    "You can come to my home or office in {ward}.", "Estimated about {hours} hours of work."],
    },
    "PERSONAL_ASSISTANT": {
        "titles": ["Queue at hospital for appointment", "Help with grocery shopping", "Pick up kids from school",
                   "Accompany elderly parent to clinic", "Help organise a small birthday party", "Buy and wrap gifts"],
        "details": ["I will send the shopping list in the app chat.", "Receipt is required, I will reimburse through the app.",
                    "The clinic is in {ward}, appointment at {time}.", "Should take around {hours} hours.",
                    "Please be patient, my mother walks slowly."],
    },
    "TUTORING": {
        "titles": ["English tutor for grade {grade} student", "Math tutoring twice a week", "IELTS speaking practice",
                   "Piano lessons for beginner", "Help with university programming assignment concepts", "Vietnamese lessons for foreigner"],
        "details": ["Sessions are {hours} hours each, at my home.", "Student is preparing for the end-of-term exam.",
                    "Tutor should have experience with children.", "Online sessions via the app video call are fine.",
                    "Please share your teaching experience in your bid."],
    },
    "OTHER": {
        "titles": ["Take photos at small event", "Assemble IKEA-style furniture", "Water plants while I travel",
                   "Walk my dog for one week", "Help set up stall at weekend market", "Translate a short document"],
        "details": ["The event is about {hours} hours.", "Instructions are included in the box.",
                    "I will leave the key with the building security.", "The dog is friendly and medium size.",
                    "Document is 3 pages, English to Vietnamese."],
    },
}
LEGIT_OPENERS = ["Hi, ", "Hello, ", "", "", "Need help: ", "Looking for a reliable provider. "]
LEGIT_CLOSERS = ["Payment through ConnectMyTask escrow after completion.", "Thanks!", "Please bid with your earliest time.",
                 "Address will be shared with the assigned provider.", "Rating will be given after the job.", "",
                 "Deposit is held in the app escrow, released when done.", "Message me in the app chat if you have questions."]

# --------------------------------------------------------------------------
# Fraud patterns (fraud_type -> generator)
# --------------------------------------------------------------------------
FRAUD_TYPE_WEIGHTS = {
    "upfront_fee": 0.18,
    "off_platform_payment": 0.20,
    "personal_data_harvesting": 0.14,
    "unrealistic_pay": 0.14,
    "money_mule_reshipping": 0.10,
    "fake_engagement": 0.10,
    "underpay_exploitation": 0.14,
}


def phone(rng: random.Random, obfuscate: bool) -> str:
    digits = "09" + "".join(str(rng.randint(0, 9)) for _ in range(8))
    if not obfuscate:
        return digits
    style = rng.choice(["spaced", "dots", "words"])
    if style == "spaced":
        return " ".join(digits[i:i + 2] for i in range(0, 10, 2))
    if style == "dots":
        return ".".join(digits)
    words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    return " ".join(words[int(d)] for d in digits[:4]) + " " + digits[4:]


FRAUD_TEXT = {
    "upfront_fee": {
        "titles": ["Easy part-time {cat_word} job, high pay", "Hiring {cat_word} staff immediately", "{cat_word} job - start today, paid daily",
                   "Urgent recruit {cat_word} helpers", "Flexible {cat_word} work, good income"],
        "body": ["Provider must pay a {fee} VND registration fee before starting.",
                 "A refundable deposit of {fee} VND for uniform and tools is required first.",
                 "Transfer {fee} VND training fee to confirm your slot, refunded after first job.",
                 "To receive the job you need to buy the starter kit for {fee} VND.",
                 "Pay a small insurance fee of {fee} VND to activate your account with us."],
    },
    "off_platform_payment": {
        "titles": ["{cat_title}", "{cat_title} - contact directly", "{cat_title}, better price outside app", "{cat_title} cash only"],
        "body": ["Contact me on Zalo {phone} for details, do not use app chat.",
                 "Pay me directly by bank transfer, we skip the app fee.",
                 "Add Telegram @{handle} to discuss, I will pay cash.",
                 "Message my WhatsApp {phone}, cancel the app booking after we agree.",
                 "Call {phone}. I pay outside the platform to save the commission.",
                 "Inbox z.a.l.o {phone} for faster reply, payment via MoMo personal."],
    },
    "personal_data_harvesting": {
        "titles": ["Simple data entry job", "Verify accounts, easy money", "{cat_word} job, verification needed",
                   "Online assistant, work from home", "Quick survey job"],
        "body": ["Send a photo of both sides of your CCCD and a selfie to apply.",
                 "Provide your bank account number and the OTP code to receive salary.",
                 "We need your ID card, bank login and phone number before assigning the task.",
                 "Fill in this form with your full name, date of birth, CCCD and bank card at {link}.",
                 "Send the 6-digit code you receive by SMS so we can verify you."],
    },
    "unrealistic_pay": {
        "titles": ["Earn {big} per day from home", "Like posts and earn {big}", "Simple task, {big} per hour",
                   "No experience, earn {big} daily", "Watch videos and get paid {big}"],
        "body": ["Just like and share posts on your phone, 15 minutes a day.", "No skill needed, work anytime, guaranteed income.",
                 "Pay is {big} for less than one hour of easy work.", "Everyone can do it, 100% guaranteed profit!!!",
                 "Invite friends to earn more commission, no limit on income."],
    },
    "money_mule_reshipping": {
        "titles": ["Receive packages at home and reship", "Package forwarding assistant", "Receive money and transfer, commission paid",
                   "Delivery partner needed - no questions", "Hold parcels for a few days"],
        "body": ["Receive parcels at your address, repack them and send to a new address I give you.",
                 "Money will be sent to your bank account, keep 10% and transfer the rest to my partner.",
                 "Do not open the packages and do not ask about the contents.",
                 "Use your own name on the shipping label, I will pay extra.",
                 "Pick up packages from different people and hand to my driver at night."],
    },
    "fake_engagement": {
        "titles": ["Write 5-star reviews for my shop", "Create accounts and leave reviews", "Click ads for payment",
                   "Post positive comments on competitor pages", "Boost ratings on map listings"],
        "body": ["Write 20 five-star Google reviews using different accounts.", "Create new accounts with different phone numbers and rate my shop.",
                 "Leave 1-star reviews on my competitor store.", "Click on our ads 100 times a day from different devices.",
                 "Rate my provider profile 5 stars from several accounts."],
    },
}
# Benign sentences that contain scam-like words (hard negatives for keyword rules)
LEGIT_CONFUSERS = [
    "Call me when you arrive, my number is in the app profile.", "I will reimburse the parking fee.",
    "The deposit for the building key card is paid by me, not you.", "Do a good job and earn a 5-star rating and repeat work.",
    "Please do not open the packages, they are sealed gifts.", "Also help me reply to customer reviews on my shop page.",
    "Please forward any mail you find to my new address.", "Guaranteed tip if done well!!!",
    "Limited parking, use the side entrance.", "Payment by bank transfer through the app wallet.",
    "Click a few photos of the finished work for me.", "Contact the security guard directly at the gate.",
    "Bring your ID card to register at the building reception.", "Cash for materials will be reimbursed with the receipt.",
    "My old accounts on the laptop need to be cleaned up.", "No experience needed, I will show you what to do.",
]
# Weak-cue scam lines: no obvious keyword, posted with normal-looking budgets/titles
SUBTLE_FRAUD = {
    "upfront_fee": ["A small admin cost applies before you start.", "You must buy the materials from our supplier first, paid back later."],
    "off_platform_payment": ["Text me for details, I reply faster that way: {phone}.", "I prefer to settle payment privately after the job.",
                             "Message me on my personal number {phone}."],
    "personal_data_harvesting": ["Please send your full name and ID number in chat for verification.",
                                 "Send me the code you get on your phone so I can add you to the team."],
    "unrealistic_pay": ["Easy work, very good pay for the right person.", "Simple phone tasks, paid well every evening."],
    "money_mule_reshipping": ["Pick up a few parcels from different shops and drop them at one address, paid per parcel.",
                              "Receive a transfer for me and withdraw it, small reward."],
    "fake_engagement": ["Help promote my shop online, simple tasks on your phone.", "Leave some nice comments on my shop listing."],
}
CAT_WORD = {"CLEANING": "cleaning", "HOME_REPAIR": "repair", "DELIVERY": "delivery", "MOVING": "moving", "IT_SUPPORT": "IT",
            "PERSONAL_ASSISTANT": "assistant", "TUTORING": "tutor", "OTHER": "freelance"}
SCAM_CLOSERS = ["Limited slots!!!", "Reply fast, first come first served.", "100% legit, trust me.", "Hurry, only today.",
                "Serious people only.", "", "", "Act now!"]


def fill(rng: random.Random, text: str, **extra) -> str:
    values = {
        "size": rng.choice(["studio", "1-bedroom", "2-bedroom", "3-bedroom", "small", "70m2", "100m2"]),
        "rooms": rng.randint(1, 4),
        "hours": rng.choice([1, 2, 2, 3, 3, 4, 5, 6]),
        "day": rng.choice(["Saturday", "Sunday", "Monday morning", "Friday evening"]),
        "brand": rng.choice(["Daikin", "Panasonic", "LG", "Samsung", "Dell", "HP", "Asus", "Lenovo"]),
        "time": rng.choice(["10am", "noon", "3pm", "5pm", "7pm"]),
        "kg": rng.choice([0.5, 1, 2, 3, 5]),
        "km": rng.randint(2, 18),
        "boxes": rng.randint(5, 40),
        "grade": rng.randint(1, 12),
        "ward": extra.get("ward", "the area"),
        "fee": f"{rng.choice([150, 200, 250, 300, 350, 500, 700, 1000]) * 1000:,}",
        "phone": phone(rng, obfuscate=rng.random() < 0.35),
        "handle": rng.choice(["fastjob", "easywork", "hcmjob", "taskpro", "vieclam"]) + str(rng.randint(10, 999)),
        "link": rng.choice(["bit.ly/job-form", "tinyurl.com/cmt-verify", "forms-job.top/apply", "cmt-bonus.xyz"]),
        "big": rng.choice(["2 million", "3,000,000 VND", "5 million", "1.5 million", "10 million VND"]),
    }
    values.update(extra)
    return text.format(**values)


def legit_budget(rng: np.random.Generator, category: str, hard_negative: bool) -> int:
    base = CATEGORY_MIN_BUDGET_VND[category]
    if hard_negative:  # legitimately small tasks (short delivery, 1h help) priced below the rule threshold
        value = base * rng.uniform(0.35, 0.95)
    else:
        value = base * rng.lognormal(mean=0.55, sigma=0.45)
    return int(round(value / 10_000) * 10_000) or 50_000


def make_legit_post(rng: random.Random, nrng: np.random.Generator, category: str, style: dict, ward: str) -> dict:
    pool = LEGIT[category]
    title = fill(rng, rng.choice(pool["titles"]), ward=ward)
    details = rng.sample(pool["details"], k=min(len(pool["details"]), rng.randint(1, 3)))
    body = style["opener"] + " ".join(fill(rng, d, ward=ward) for d in details)
    if style["closer"]:
        body += " " + style["closer"]
    if rng.random() < 0.15:
        body += " " + rng.choice(LEGIT_CONFUSERS)
    if rng.random() < 0.10:  # benign urgency wording
        body += " " + rng.choice(["Need it today if possible.", "Urgent, ASAP please.", "Tonight would be great."])
    hard_negative = rng.random() < 0.08
    urgency = "URGENT" if rng.random() < (0.22 if "ASAP" in body or "today" in body else 0.12) else "NORMAL"
    return {
        "title": title,
        "description": body.strip(),
        "category": category,
        "budget_vnd": legit_budget(nrng, category, hard_negative),
        "max_bids": int(rng.choice([30, 30, 30, 20, 15, 10, 5])),
        "deadline_hours": float(rng.choice([6, 12, 24, 48, 72, 96, 168, 336])) * rng.uniform(0.9, 1.1),
        "urgency": urgency,
        "image_count": int(rng.choices([0, 1, 2, 3], weights=[0.30, 0.35, 0.20, 0.15])[0]),
    }


def make_campaign_template(rng: random.Random, fraud_type: str, category: str) -> dict:
    """A scam campaign reuses one core message with small mutations across posts."""
    if fraud_type == "underpay_exploitation":
        return {"type": fraud_type, "category": category}
    spec = FRAUD_TEXT[fraud_type]
    cat_title = rng.choice(LEGIT[category]["titles"])
    return {
        "type": fraud_type,
        "category": category,
        "title": rng.choice(spec["titles"]),
        "cat_title": cat_title,
        "body": rng.sample(spec["body"], k=min(len(spec["body"]), rng.randint(1, 2))),
        "closer": rng.choice(SCAM_CLOSERS),
        "camouflage": rng.random() < 0.40,  # wraps the scam inside a normal-looking task description
        "subtle": rng.random() < 0.30,      # weak cues only, normal-looking post
    }


def make_fraud_post(rng: random.Random, nrng: np.random.Generator, tpl: dict, ward: str) -> dict:
    category = tpl["category"]
    ftype = tpl["type"]
    base = CATEGORY_MIN_BUDGET_VND[category]

    if ftype == "underpay_exploitation":
        # Looks like a real, big job but pays a fraction of the fair price.
        pool = LEGIT[category]
        title = fill(rng, rng.choice(pool["titles"]), ward=ward)
        details = rng.sample(pool["details"], k=min(len(pool["details"]), rng.randint(2, 3)))
        extra = rng.choice(["Must finish everything in one visit.", "Whole house, all rooms.", "Includes heavy items and stairs.",
                            "Bring your own materials.", "Provider pays for transport.", "Must also do extra tasks on site if asked."])
        body = " ".join(fill(rng, d, ward=ward) for d in details) + " " + extra
        budget = base * nrng.uniform(0.15, 0.70)
        urgency = "URGENT" if rng.random() < 0.35 else "NORMAL"
        image_count = int(rng.choices([0, 1, 2], weights=[0.55, 0.30, 0.15])[0])
    elif tpl["subtle"]:
        pool = LEGIT[category]
        title = fill(rng, tpl["cat_title"], ward=ward)
        normal = fill(rng, rng.choice(pool["details"]), ward=ward)
        body = normal + " " + fill(rng, rng.choice(SUBTLE_FRAUD[ftype]), ward=ward)
        budget = base * nrng.lognormal(mean=0.55, sigma=0.5)
        urgency = "URGENT" if rng.random() < 0.25 else "NORMAL"
        image_count = int(rng.choices([0, 1, 2, 3], weights=[0.45, 0.35, 0.15, 0.05])[0])
    else:
        cat_word = CAT_WORD[category]
        title = fill(rng, tpl["title"], cat_word=cat_word, cat_title=fill(rng, tpl["cat_title"], ward=ward), ward=ward)
        scam_lines = [fill(rng, b, ward=ward) for b in tpl["body"]]
        if tpl["camouflage"]:
            normal = fill(rng, rng.choice(LEGIT[category]["details"]), ward=ward)
            body = normal + " " + " ".join(scam_lines)
        else:
            body = " ".join(scam_lines)
        if tpl["closer"]:
            body += " " + tpl["closer"]
        if rng.random() < 0.25:
            title = title.upper()
        if ftype == "unrealistic_pay":
            budget = base * nrng.uniform(4, 25)
        elif ftype == "upfront_fee":
            budget = base * nrng.uniform(1.5, 6)
        elif ftype == "off_platform_payment":
            budget = base * nrng.lognormal(0.3, 0.5)  # often a "cheap" listed price, real deal happens outside
        else:
            budget = base * nrng.lognormal(0.7, 0.6)
        urgency = "URGENT" if rng.random() < 0.55 else "NORMAL"
        image_count = int(rng.choices([0, 1, 2, 3], weights=[0.70, 0.20, 0.07, 0.03])[0])

    return {
        "title": title,
        "description": body.strip(),
        "category": category,
        "budget_vnd": int(round(budget / 10_000) * 10_000) or 10_000,
        "max_bids": int(rng.choice([30, 30, 30, 30, 25, 20, 10])),
        "deadline_hours": float(rng.choice([6, 12, 24, 48, 72, 96, 168] if tpl.get("subtle")
                                           else [1, 2, 3, 6, 12, 24, 48])) * rng.uniform(0.9, 1.1),
        "urgency": urgency,
        "image_count": image_count,
    }


def add_typos(rng: random.Random, text: str, rate: float = 0.04) -> str:
    """Real users make typos; swap adjacent letters in a few words."""
    words = text.split(" ")
    for i, w in enumerate(words):
        if len(w) > 3 and w.isalpha() and rng.random() < rate:
            j = rng.randint(0, len(w) - 2)
            words[i] = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    return " ".join(words)


def generate(rows: int, fraud_rate: float, seed: int) -> pd.DataFrame:
    rng = random.Random(seed)
    nrng = np.random.default_rng(seed)
    ward_groups = json.loads((DATA_DIR / "hcmc_wards.json").read_text(encoding="utf-8"))
    wards = [(g["oldDistrict"], w) for g in ward_groups for w in g["wards"]]

    records: list[dict] = []
    n_fraud_target = int(rows * fraud_rate)
    n_legit_target = rows - n_fraud_target
    start = datetime(2026, 6, 1, 7, 0)

    # Legit requesters: 1-8 posts each, consistent writing style and home ward
    gid = 0
    while sum(1 for r in records if r["is_fraud"] == 0) < n_legit_target:
        gid += 1
        old_district, ward = rng.choice(wards)
        street = rng.choice(STREETS)
        style = {"opener": rng.choice(LEGIT_OPENERS), "closer": rng.choice(LEGIT_CLOSERS)}
        fav_cats = rng.sample(CATEGORIES, k=2)
        for _ in range(rng.choice([1, 1, 2, 2, 3, 4, 5, 8])):
            category = rng.choice(fav_cats) if rng.random() < 0.7 else rng.choices(CATEGORIES, CATEGORY_WEIGHTS)[0]
            post = make_legit_post(rng, nrng, category, style, ward)
            post.update(old_district=old_district, district=ward, street_name=f"{rng.randint(1, 450)} {street}",
                        group_id=f"R{gid:05d}", is_fraud=0, fraud_type="none")
            records.append(post)

    # Scam campaigns: 2-15 near-duplicate posts each, wards spread across the city
    gid = 0
    types, weights = zip(*FRAUD_TYPE_WEIGHTS.items())
    while sum(1 for r in records if r["is_fraud"] == 1) < n_fraud_target:
        gid += 1
        ftype = rng.choices(types, weights)[0]
        tpl = make_campaign_template(rng, ftype, rng.choices(CATEGORIES, CATEGORY_WEIGHTS)[0])
        for _ in range(rng.randint(2, 15)):
            old_district, ward = rng.choice(wards)
            post = make_fraud_post(rng, nrng, tpl, ward)
            post.update(old_district=old_district, district=ward,
                        street_name=f"{rng.randint(1, 450)} {rng.choice(STREETS)}",
                        group_id=f"C{gid:05d}", is_fraud=1, fraud_type=ftype)
            records.append(post)

    for r in records:
        if rng.random() < 0.25:
            r["description"] = add_typos(rng, r["description"])
    df = pd.DataFrame(records)
    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)

    # Timestamps: posted_at over ~5 months, deadline = posted_at + deadline_hours
    offsets = nrng.uniform(0, 150 * 24, size=len(df))
    df["posted_at"] = [start + timedelta(hours=float(h)) for h in offsets]
    df["deadline"] = [p + timedelta(hours=float(h)) for p, h in zip(df["posted_at"], df["deadline_hours"])]
    df["posted_at"] = pd.to_datetime(df["posted_at"]).dt.strftime("%Y-%m-%dT%H:%M:%S")
    df["deadline"] = pd.to_datetime(df["deadline"]).dt.strftime("%Y-%m-%dT%H:%M:%S")
    df = df.drop(columns=["deadline_hours"])

    # 1.5% label noise: real-world labels from moderators are imperfect
    noise_idx = nrng.choice(len(df), size=int(0.015 * len(df)), replace=False)
    df.loc[noise_idx, "is_fraud"] = 1 - df.loc[noise_idx, "is_fraud"]
    df.loc[noise_idx, "fraud_type"] = "label_noise"

    df.insert(0, "task_id", [f"T{i:06d}" for i in range(1, len(df) + 1)])
    columns = ["task_id", "title", "description", "category", "district", "old_district", "street_name",
               "budget_vnd", "max_bids", "posted_at", "deadline", "urgency", "image_count",
               "group_id", "is_fraud", "fraud_type"]
    return df[columns]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rows", type=int, default=8000)
    parser.add_argument("--fraud-rate", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=DATA_DIR / "synthetic_tasks.csv")
    args = parser.parse_args()

    df = generate(args.rows, args.fraud_rate, args.seed)
    df.to_csv(args.out, index=False, encoding="utf-8")
    print(f"Wrote {len(df):,} rows -> {args.out}")
    print(df["is_fraud"].value_counts().rename({0: "legit", 1: "fraud"}).to_string())
    print(df["fraud_type"].value_counts().to_string())
    print(f"groups: {df['group_id'].nunique():,}")


if __name__ == "__main__":
    main()
