# EmberWatch API

FastAPI service that scores camera frames for smoke with the exported ONNX model. It uses ONNX Runtime only, never Keras (see `docs/decisions/0003`).

## Run

```bash
uv sync
EMBERWATCH_MODEL_DIR=path/to/model uv run emberwatch-api   # folder with model.onnx + model_spec.json
```

Then open http://localhost:8000/docs.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Model name, version and decision threshold |
| POST | `/v1/frames/score` | Upload a JPEG/PNG frame and get its smoke score plus every tile's probability |

## Code

| File | Job |
|---|---|
| `config.py` | Settings from environment variables |
| `smoke_model.py` | Loads `model.onnx` + `model_spec.json`, cuts frames into tiles, scores them. The tiling rule matches `ml/src/data/tiles.py`, and the match was checked on 4 frame sizes |
| `schemas.py` | Request/response shapes, used for the docs and the web app's TypeScript types |
| `main.py` | Routes |

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `EMBERWATCH_MODEL_DIR` | `models/current` | Folder holding `model.onnx` + `model_spec.json` |
| `EMBERWATCH_ONNX_THREADS` | `4` | CPU threads per request |
| `EMBERWATCH_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed to call the API |
