from fastapi.testclient import TestClient
from pricing import app  # Change to `from pricing_updated import app` if needed


def get_price(data: dict) -> float:
    return float(data.get("suggestedPrice") or data.get("recommended_price") or 0)


def get_distance(data: dict) -> float | None:
    factors = data.get("factorsUsed") or data.get("factors") or {}
    for key in ("distance_km", "distanceKm", "distance"):
        if key in factors and factors[key] is not None:
            return float(factors[key])
    return None


def test_01_health_endpoint(client: TestClient):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "model_mode" in body


def test_02_lsa_semantic_understanding(client: TestClient):
    payload = {
        "category": "CLEANING",
        "title": "Make the place spotless after the builders left",
        "description": "There is drywall dust everywhere and paint drops on the floor. Need a massive, thorough scrub.",
        "location": "district 2",
        "budget": 0,
    }
    res = client.post("/predict-price", json=payload)
    assert res.status_code == 200
    body = res.json()
    price = get_price(body)
    assert price > 0
    if "minPrice" in body and "maxPrice" in body:
        assert body["minPrice"] <= price <= body["maxPrice"]


def test_03_missing_complexity_inferred_from_text(client: TestClient):
    # Omits complexity and urgency entirely, matching the real frontend form
    payload = {
        "category": "HOME_REPAIR",
        "title": "Sink pipe burst",
        "description": "Water is leaking under the kitchen sink and wiring nearby is exposed.",
        "location": "district 1",
    }
    res = client.post("/predict-price", json=payload)
    assert res.status_code == 200
    assert get_price(res.json()) > 0


def test_04_urgency_extracted_from_description(client: TestClient):
    base_payload = {
        "category": "HOME_REPAIR",
        "title": "Fix kitchen sink leak",
        "description": "The pipe under the kitchen sink is leaking slowly.",
        "location": "district 1",
    }
    urgent_payload = {
        "category": "HOME_REPAIR",
        "title": "Fix kitchen sink leak",
        "description": "The pipe under the kitchen sink is leaking everywhere. Please fix it tonight!",
        "location": "district 1",
    }
    normal_res = client.post("/predict-price", json=base_payload)
    urgent_res = client.post("/predict-price", json=urgent_payload)

    assert normal_res.status_code == 200
    assert urgent_res.status_code == 200
    assert get_price(urgent_res.json()) >= get_price(normal_res.json())


def test_05_haversine_gps_distance_scaling(client: TestClient):
    center_payload = {
        "category": "CLEANING",
        "title": "Standard apartment cleaning",
        "description": "Clean a 2-bedroom apartment.",
        "location": "district 1",
        "task_lat": 10.7769,
        "task_lon": 106.7009,
    }
    remote_payload = {
        "category": "CLEANING",
        "title": "Standard apartment cleaning",
        "description": "Clean a 2-bedroom apartment.",
        "location": "thu duc",
        "task_lat": 10.8494,
        "task_lon": 106.7717,
    }
    center_res = client.post("/predict-price", json=center_payload)
    remote_res = client.post("/predict-price", json=remote_payload)

    assert center_res.status_code == 200
    assert remote_res.status_code == 200

    d_center = get_distance(center_res.json())
    d_remote = get_distance(remote_res.json())
    if d_center is not None and d_remote is not None:
        assert d_remote > d_center


def test_06_defensive_gps_null_fallback(client: TestClient):
    payload = {
        "category": "IT_SUPPORT",
        "title": "Laptop blue screen",
        "description": "Windows PC keeps crashing and overheating.",
        "location": "district 7",
        "task_lat": None,
        "task_lon": None,
    }
    res = client.post("/predict-price", json=payload)
    assert res.status_code == 200
    assert get_price(res.json()) > 0


def test_07_dual_region_singapore_support(client: TestClient):
    payload = {
        "category": "CLEANING",
        "title": "Move-out flat cleaning",
        "description": "Full flat clean before handing over keys.",
        "location": "tampines, singapore",
    }
    res = client.post("/predict-price", json=payload)
    assert res.status_code == 200
    assert get_price(res.json()) > 0


def test_08_recommend_endpoint_with_gps(client: TestClient):
    payload = {
        "category": "DELIVERY",
        "title": "Deliver fragile monitor",
        "description": "Pick up a boxed monitor and deliver it safely today.",
        "location": "binh thanh",
        "task_lat": 10.8106,
        "task_lon": 106.7091,
    }
    res = client.post("/recommend", json=payload)
    assert res.status_code == 200
    assert get_price(res.json()) > 0


# Allows running directly with `python test_pricing.py` (no pytest install required)
if __name__ == "__main__":
    tests = [
        test_01_health_endpoint,
        test_02_lsa_semantic_understanding,
        test_03_missing_complexity_inferred_from_text,
        test_04_urgency_extracted_from_description,
        test_05_haversine_gps_distance_scaling,
        test_06_defensive_gps_null_fallback,
        test_07_dual_region_singapore_support,
        test_08_recommend_endpoint_with_gps,
    ]
    passed = 0
    failed = 0

    with TestClient(app) as client:
        print(f"Running {len(tests)} Pricing AI tests...\n")
        for fn in tests:
            try:
                fn(client)
                print(f"  [PASS] {fn.__name__}")
                passed += 1
            except Exception as exc:
                print(f"  [FAIL] {fn.__name__} -> {exc}")
                failed += 1

    print(f"\nResult: {passed} passed, {failed} failed")