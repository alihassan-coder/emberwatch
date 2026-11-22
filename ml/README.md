# EmberWatch ML

This folder is where the smoke models are trained, measured and exported. The **same code runs on your laptop (CPU) and on Kaggle (GPU)**; only the paths change.

## The big picture

```
 1. DATA            2. TRAIN              3. MEASURE              4. EXPORT
 download, check,   fit a Keras model     score it on frames      save .onnx for
 split, pack        on Kaggle's GPU       it has never seen       the API to load
 src/data/          src/models/           src/evaluate/           src/export/
                    src/train/
```

## Folder by folder

| Folder | What lives there | Start reading at |
|---|---|---|
| `src/common/` | Small helpers every step uses | `env.py`: "where am I running, where do files go?" |
| `src/data/` | One file per dataset. Each one downloads, checks, splits and packs its data | `pyro_sdis.py` (training data), `figlib.py` (real fire sequences) |
| `src/models/` | Model definitions and experiments | `spike_e0.py`: tries 5 candidate models and compares them |
| `src/train/` | Training loops *(next)* | — |
| `src/evaluate/` | How we score a model | `metrics.py`: accuracy, minutes to detect, false alarms |
| `src/export/` | Keras → ONNX, plus the "do they agree?" check *(next)* | — |
| `configs/` | One settings file per experiment *(next)* | — |
| `artifacts/` | Downloaded results (git-ignored) | `runs/<job>/` |

## Running things

On your laptop, from `ml/`:

```bash
uv sync                                     # install (once)
uv run python -m src.common.env_report      # what machine/libraries am I using?
uv run python -m src.data.pyro_sdis --limit 50   # small test run of the data step
```

On Kaggle, from the repo root (the job runs the code as it is in your last commit):

```bash
scripts/kaggle_run.sh run emberwatch-data "src.data.pyro_sdis"        # CPU job
scripts/kaggle_run.sh run emberwatch-e0-spike "src.models.spike_e0" \
    --gpu --extras train --source emberwatch-data                     # GPU job
scripts/kaggle_run.sh status emberwatch-e0-spike
scripts/kaggle_run.sh fetch  emberwatch-e0-spike     # results -> ml/artifacts/runs/
```

Kaggle jobs keep running if your laptop sleeps. Run `fetch` later to collect the results.

## Rules the code follows (and why)

- **Splits never leak.** Test frames come from whole camera sites (Pyro-SDIS) or whole fire events and stations (FIgLib) that training never sees, and near-identical frames are removed across splits. A model that has seen the same view during training looks better than it really is. See `docs/decisions/0005`.
- **Save first, report second.** Every data job writes its results before it computes statistics, so a bug in a report can never throw away an hour of downloading.
- **Few big files, not many small ones.** Images are packed into ~1 GB `.tar` shards (`src/common/shards.py`). Kaggle slows down and rate-limits downloads of runs that have thousands of files.
- **Every run says what it ran on.** `env.json` records the git commit, GPU and library versions.
- **Licences decide what can be trained on.** Only commercially clean data trains a model we would ship. See `docs/decisions/0004`.

Words like *onset*, *site*, *plume track* and *time to detect* have exact meanings, defined in [`../GLOSSARY.md`](../GLOSSARY.md).
