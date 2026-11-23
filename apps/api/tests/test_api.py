"""HTTP endpoints, end to end (with a fake model)."""


def _upload(client, camera, jpeg, taken_at, content=None):
    return client.post(f"/v1/cameras/{camera}/frames",
                       files={"image": ("frame.jpg", content if content is not None else jpeg, "image/jpeg")},
                       data={"taken_at": taken_at})


def test_health_reports_model_database_and_schema(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["model_version"] == "fake-1"
    assert body["database"] == "sqlite"
    assert body["schema_version"]              # migrated


def test_models_lists_the_active_version(client):
    assert client.get("/v1/models").json() == [
        {"version": "fake-1", "name": "fake-model", "threshold": 0.5, "sha256": None, "active": True}
    ]


def test_cameras_are_listed_with_their_sites(client):
    keys = {c["key"]: c["site"]["name"] for c in client.get("/v1/cameras").json()}
    assert keys == {"east-120": "East tower", "east-300": "East tower", "west-60": "West tower"}


def test_second_smoke_photo_raises_an_alert(client, fake_model, jpeg_bytes):
    fake_model.scores = [0.95, 0.92]
    first = _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:00:00Z")
    assert first.status_code == 201
    assert first.json()["alert"] is None

    second = _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:01:00Z").json()
    assert second["frame"]["score"] == 0.92
    assert second["alert"]["status"] == "needs_review"
    assert second["alert"]["cameras"][0]["camera"] == "west-60"

    recent = client.get("/v1/cameras/west-60/frames").json()
    assert [f["score"] for f in recent] == [0.92, 0.95]       # newest first


def test_ingest_rejects_bad_input(client, jpeg_bytes):
    assert _upload(client, "nope", jpeg_bytes, "2026-01-08T12:00:00Z").status_code == 404
    assert _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:00:00").status_code == 422   # no timezone
    assert _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:00:00Z", content=b"not an image").status_code == 415
    assert _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:00:00Z").status_code == 201
    assert _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:00:00Z").status_code == 409   # same photo twice


def test_review_flow_over_http(client, fake_model, jpeg_bytes):
    fake_model.scores = [0.9, 0.9]
    _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:00:00Z")
    code = _upload(client, "west-60", jpeg_bytes, "2026-01-08T12:01:00Z").json()["alert"]["code"]

    assert [a["code"] for a in client.get("/v1/alerts?status=needs_review").json()] == [code]

    no_reason = client.post(f"/v1/alerts/{code}/review", json={"verdict": "dismissed"})
    assert no_reason.status_code == 409

    confirmed = client.post(f"/v1/alerts/{code}/review", json={"verdict": "confirmed", "reviewer": "duty"}).json()
    assert confirmed["status"] == "confirmed"
    assert client.post(f"/v1/alerts/{code}/review", json={"verdict": "confirmed"}).status_code == 409

    undone = client.post(f"/v1/alerts/{code}/review", json={"verdict": "reopened"}).json()
    assert undone["status"] == "needs_review"
    assert [r["verdict"] for r in undone["reviews"]] == ["confirmed", "reopened"]

    sent = client.get(f"/v1/notifications?alert={code}").json()
    assert {(n["channel"], n["status"]) for n in sent} == {("sms", "simulated"), ("email", "simulated"), ("webhook", "simulated")}

    assert client.get("/v1/alerts/A-9999").status_code == 404


def test_score_endpoint_does_not_store_anything(client, fake_model, jpeg_bytes):
    fake_model.scores = [0.8]
    body = client.post("/v1/frames/score", files={"image": ("f.jpg", jpeg_bytes, "image/jpeg")}).json()
    assert body["smoke"] is True and body["score"] == 0.8
    assert client.get("/v1/cameras/west-60/frames").json() == []
