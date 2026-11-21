# EmberWatch

Spots wildfire smoke on live tower cameras within minutes of ignition. Detections are confirmed over time to cut false alarms, sent to a human review queue, and the reviews are used to improve the model.

> Status: Phase 1 (ML) — in progress.

## Structure

```
emberwatch/
├── docs/
│   ├── research/      background research (datasets, prior work, models, cameras, risks)
│   ├── experiments/   one report per experiment (E0–E5) + results table
│   └── decisions/     short "why we chose X" notes
├── ml/                Phase 1: Keras training, evaluation, export (uv project)
│   ├── configs/       one YAML per experiment
│   ├── data/          raw/ + processed/ (git-ignored)
│   ├── notebooks/     thin Kaggle/Colab runners (GPU training)
│   ├── src/
│   │   ├── data/      download, clean, split by camera/fire
│   │   ├── models/    smoke detector + temporal confirmer
│   │   ├── train/     training loops
│   │   ├── evaluate/  mAP, time-to-detect, false alarms per camera-day
│   │   └── export/    ONNX / LiteRT export, int8, parity check
│   └── artifacts/     exported models + model card (git-ignored)
├── apps/
│   ├── api/           Phase 2: uv + FastAPI (ONNX serving, camera ingestion loop, alerts, reviews)
│   └── web/           Phase 3: Next.js + shadcn/ui
└── README.md
```

One git repo, three independent projects:

| Folder | Tooling | Has its own |
|---|---|---|
| `ml/` | uv + Keras 3 | `pyproject.toml`, `uv.lock`, `.venv` |
| `apps/api/` | uv + FastAPI + ONNX Runtime | `pyproject.toml`, `uv.lock`, `.venv` |
| `apps/web/` | pnpm + Next.js + shadcn/ui | `package.json`, lockfile, `node_modules` |

They connect through files and HTTP, not shared code: `ml` exports a `.onnx` model + output spec to the API; the web app generates TypeScript types from the API's OpenAPI schema.

## Where things run

| Task | Where |
|---|---|
| Training (GPU) | Kaggle Notebooks (main), Google Colab (backup) |
| Data prep, evaluation, ONNX inference | Local CPU |
| Backend + frontend | Local / Docker |

Camera ingestion runs as a background loop inside the API (no separate worker until scale needs one).

## Running ML code

From `ml/`:

```bash
uv run python -m src.<module>.<script>
```
