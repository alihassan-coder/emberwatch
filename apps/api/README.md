# EmberWatch API

FastAPI service. It scores tower-camera photos with the ONNX model, stores them, runs the alert rule, records operator reviews and sends notifications. No login (demo).

## Run

```bash
uv sync
uv run alembic upgrade head        # create or update the database
uv run python -m src.seed          # optional: load the real demo day (8 Jan 2024)
uv run fastapi dev src/main.py     # http://localhost:8000/docs
```

## Layout

```
apps/api/
├── src/
│   ├── main.py            app, startup checks, /health, /v1/models, /v1/frames/score
│   ├── config.py          settings from environment variables
│   ├── model_registry.py  local, versioned model store
│   ├── smoke_model.py     ONNX scoring (tiling matches ml/src/data/tiles.py)
│   ├── schemas.py         request/response shapes (OpenAPI)
│   ├── seed.py            loads the demo day through the real pipeline
│   ├── db/                SQLAlchemy 2.0: base (naming rules, UTC type), models, session
│   ├── services/          alert rule, geometry, reviews, notification outbox
│   └── routers/           cameras (+ photo ingestion), alerts, notifications
├── migrations/            Alembic: one file per schema version
├── models/                (git-ignored) versions/<version>/ + active.txt
├── data/                  (git-ignored) emberwatch.db + stored photos
└── seed/demo_manifest.json
```

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Model version, database and schema version |
| GET | `/v1/models` | Model versions in the local store; which one is active |
| POST | `/v1/frames/score` | Score any photo without storing it |
| GET | `/v1/cameras` | Cameras and their sites |
| POST | `/v1/cameras/{key}/frames` | A camera photo arrives: score, store, run the alert rule |
| GET | `/v1/cameras/{key}/frames` | A camera's latest scored photos |
| GET | `/v1/alerts?status=` | Alerts, newest first |
| GET | `/v1/alerts/{code}` | One alert with its cameras, bearings, location and review history |
| POST | `/v1/alerts/{code}/review` | `confirmed`, `dismissed` (needs a reason) or `reopened` (undo) |
| GET | `/v1/notifications?alert=` | The notification outbox |

## Database

- **SQLAlchemy 2.0** typed models in `src/db/models.py`, named after `GLOSSARY.md`.
- **Alembic** keeps one migration per change in `migrations/versions/`:
  - `uv run alembic revision --autogenerate -m "what changed"` after editing the models;
  - `uv run alembic upgrade head` to apply;
  - `uv run alembic downgrade -1` to step back.
- **SQLite locally.** To move to PostgreSQL, set `EMBERWATCH_DATABASE_URL=postgresql+psycopg://...`, add the driver, and run `alembic upgrade head`. These make that a configuration change rather than a rewrite:
  - every constraint and index has a fixed name;
  - enums are portable;
  - timestamps are UTC;
  - migrations run in batch mode on SQLite.
- **Reviews** are append-only history; undo adds a `reopened` row.
- **Notifications** go through an outbox table:
  - **Webhooks** are really sent when `EMBERWATCH_ALERT_WEBHOOK_URL` is set.
  - **SMS and email** are recorded as `simulated` until a provider is added.

## Models

Models live in `models/versions/<version>/` with `model.onnx`, `model_spec.json` and `model.onnx.sha256`. `models/active.txt` names the version to serve, and `EMBERWATCH_MODEL_VERSION` overrides it.

The API refuses to start if the file doesn't match its checksum. Each scored frame records the model version that scored it.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `EMBERWATCH_DATABASE_URL` | `sqlite:///data/emberwatch.db` | Any SQLAlchemy URL |
| `EMBERWATCH_MODELS_DIR` | `models` | Local model store |
| `EMBERWATCH_MODEL_VERSION` | (from `active.txt`) | Serve a specific version |
| `EMBERWATCH_ALERT_THRESHOLD` / `_K` / `_N` | `0.5` / `2` / `3` | Alert when the score passes the threshold in K of the last N photos (within 15 minutes) |
| `EMBERWATCH_ALERT_WEBHOOK_URL` | (empty) | Where confirmed-fire notifications are POSTed |
| `EMBERWATCH_CORS_ORIGINS` | `http://localhost:3000` | Browser origins allowed to call the API |
| `EMBERWATCH_ONNX_THREADS` | `4` | CPU threads per photo |
