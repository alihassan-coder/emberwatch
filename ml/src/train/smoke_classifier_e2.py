"""E2: one smoke model for tower cameras AND everyday fire photos.

What changed from E1, and why:
  - E1 scored a close-up forest-fire photo at 0.1%: it had only seen distant
    plumes from French tower cameras. E2 also trains on D-Fire (src/data/dfire.py):
    close-up, aerial, CCTV and wildfire photos, plus fog/cloud/sunset photos
    with no fire.
  - Each D-Fire photo is shown, each epoch, either whole or as a random
    zoomed-in square crop, so the model meets smoke at every scale.
  - A photo is scored on its tiles AND on the whole photo squeezed to 224x224
    (src/data/views.py), so smoke that fills the picture still counts.
  - Visible flames count as positive too: a fire is a fire.
  - Training starts from E1's weights when they are attached, so E2 keeps
    what E1 learned about distant plumes.

The model itself is unchanged (224x224 RGB in, one logit out), so the API
keeps working; only the views it feeds the model change.

Evaluation, all on photos the model never trained on:
  - Pyro-SDIS held-out tower sites (E1 scored F1 0.932 here: must not drop much)
  - D-Fire test split, E1 vs E2 side by side
Threshold picked on the two validation sets together.

Run on Kaggle:
    scripts/kaggle_run.sh run emberwatch-e2 "src.train.smoke_classifier_e2" --gpu --extras train \\
        --source emberwatch-data --source emberwatch-e1-tiles \\
        --dataset sayedgamal99/smoke-fire-detection-yolo --model <efficientnet handle>
"""

from __future__ import annotations

import os

os.environ.setdefault("KERAS_BACKEND", "jax")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import argparse  # noqa: E402
import json  # noqa: E402
import time  # noqa: E402
from dataclasses import dataclass  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from PIL import Image  # noqa: E402

from src.common.env import data_dir, find_input, git_sha, output_dir  # noqa: E402
from src.data import dfire  # noqa: E402
from src.data.views import SPEC as VIEW_SPEC  # noqa: E402
from src.data.views import TILE, photo_views, whole_view
from src.evaluate.metrics import best_f1_threshold, frame_scores  # noqa: E402
from src.train.tile_classifier import LAYOUT, build_model, load_frames, read_tile, sample_epoch, tile_table  # noqa: E402

RUN = "e2_smoke_classifier"


@dataclass
class Settings:
    preset: str = "efficientnet_b0_ra_imagenet"
    epochs: int = 8
    batch: int = 64
    learning_rate: float = 2e-4          # lower than E1: we start from E1's weights
    negatives_per_positive: int = 3      # Pyro-SDIS clear tiles per smoke tile
    hard_negative_share: float = 0.5
    pyro_whole_share: float = 0.1        # Pyro-SDIS whole-photo views, as a share of Pyro tiles
    dfire_whole_share: float = 0.4       # D-Fire photos shown whole (the rest as random crops)
    big_plume_share: float = 0.02        # a Pyro whole view counts as smoke only if a box covers 2% of the frame
    seed: int = 42
    quick: bool = False


# ── One epoch's worth of views ────────────────────────────────────────────

def pyro_whole_rows(frames: pd.DataFrame, s: Settings) -> pd.DataFrame:
    """Whole-frame views of tower photos. Tiny distant plumes vanish when a
    1280x720 frame is squeezed to 224, so only big plumes count as smoke;
    small-plume frames are left out rather than taught as 'clear'."""
    area = LAYOUT.frame_h * LAYOUT.frame_w
    biggest = np.array([
        max(((b[2] - b[0]) * (b[3] - b[1]) for b in np.array(list(boxes)).reshape(-1, 4)), default=0.0) / area
        for boxes in frames["boxes_yxyx_abs"]
    ])
    keep = ~frames["has_smoke"].to_numpy() | (biggest >= s.big_plume_share)
    f = frames[keep]
    return pd.DataFrame({"kind": "pyro_whole", "image_name": f["image_name"].to_numpy(),
                         "label": (f["has_smoke"].to_numpy() & (biggest[keep] >= s.big_plume_share)).astype(int)})


def epoch_rows(pyro_tiles: pd.DataFrame, pyro_whole: pd.DataFrame, dfire_train: pd.DataFrame,
               s: Settings, rng: np.random.Generator) -> pd.DataFrame:
    tiles = sample_epoch(pyro_tiles, s, rng).assign(kind="pyro_tile")
    whole = pyro_whole.sample(min(len(pyro_whole), int(len(tiles) * s.pyro_whole_share)),
                              random_state=int(rng.integers(1 << 31)))
    photos = dfire_train.assign(kind="dfire", label=-1)  # label decided when the crop is drawn
    rows = pd.concat([tiles, whole, photos], ignore_index=True)
    return rows.sample(frac=1.0, random_state=int(rng.integers(1 << 31))).reset_index(drop=True)


def dfire_view(row, rng: np.random.Generator, s: Settings) -> tuple[np.ndarray, int]:
    """The whole photo, or a random square crop (35-100% of the short side)."""
    with Image.open(row.path) as raw:
        img = raw.convert("RGB")
    if rng.random() < s.dfire_whole_share:
        return whole_view(img), int(row.positive)
    side = rng.uniform(0.35, 1.0) * min(img.size)
    x = rng.uniform(0, img.width - side)
    y = rng.uniform(0, img.height - side)
    crop = img.resize((TILE, TILE), Image.Resampling.BILINEAR, box=(x, y, x + side, y + side))
    return np.asarray(crop, dtype=np.float32), dfire.crop_label(row.boxes, y, x, side, side)


def make_dataset(build_rows, images_dir: Path, s: Settings, train: bool, seed: int):
    import keras

    class Views(keras.utils.PyDataset):
        def __init__(self):
            super().__init__(workers=8, use_multiprocessing=False, max_queue_size=16)
            self.rng = np.random.default_rng(seed)
            self.epoch = 0
            self.rows = build_rows(self.rng)

        def __len__(self):
            return int(np.ceil(len(self.rows) / s.batch))

        def on_epoch_end(self):
            if train:
                self.epoch += 1
                self.rows = build_rows(self.rng)

        def __getitem__(self, i):
            part = self.rows.iloc[i * s.batch:(i + 1) * s.batch]
            # Validation draws the same crops every time; training draws new ones each epoch.
            rng = np.random.default_rng([seed, self.epoch if train else 0, i])
            xs, ys = [], []
            for r in part.itertuples():
                if r.kind == "pyro_tile":
                    x, y = read_tile(images_dir, r.image_name, int(r.tile)), int(r.label)
                elif r.kind == "pyro_whole":
                    with Image.open(images_dir / r.image_name) as img:
                        x, y = whole_view(img.convert("RGB")), int(r.label)
                else:
                    x, y = dfire_view(r, rng, s)
                xs.append(x)
                ys.append(y)
            x = np.stack(xs)
            if train:
                flip = rng.random(len(x)) < 0.5
                x[flip] = x[flip, :, ::-1]
                gain = rng.uniform(0.8, 1.2, (len(x), 1, 1, 1))
                bias = rng.uniform(-15, 15, (len(x), 1, 1, 1))
                x = np.clip(x * gain + bias, 0, 255)
            return x.astype(np.float32), np.array(ys, dtype=np.float32)

    return Views()


# ── Scoring whole photos ──────────────────────────────────────────────────

def score_photos(model, paths: list[Path], whole: bool = True, batch_photos: int = 16) -> np.ndarray:
    """Photo score = highest probability over its views (tiles, plus the whole photo if `whole`)."""
    scores = []
    for start in range(0, len(paths), batch_photos):
        views, owners = [], []
        for k, path in enumerate(paths[start:start + batch_photos]):
            with Image.open(path) as img:
                v = photo_views(img)
            if not whole:
                v = v[:-1]
            views.append(v)
            owners += [k] * len(v)
        logits = model.predict(np.concatenate(views), verbose=0, batch_size=128).reshape(-1)
        probs = 1 / (1 + np.exp(-logits))
        owners = np.array(owners)
        scores += [float(probs[owners == k].max()) for k in range(len(views))]
    return np.array(scores)


def load_e1():
    """E1's model, to start from its weights and to compare against it."""
    try:
        import keras
        return keras.saving.load_model(str(find_input("e1_tile_classifier/model.keras")), compile=False)
    except Exception as e:  # noqa: BLE001 - E1 is optional: train from ImageNet without it
        print(f"[e1] not available ({e}); starting from ImageNet weights", flush=True)
        return None


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="E2 smoke classifier")
    ap.add_argument("--epochs", type=int, default=Settings.epochs)
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    s = Settings(epochs=args.epochs, quick=args.quick)

    import jax
    import keras

    if any(d.platform == "gpu" for d in jax.devices()):
        keras.mixed_precision.set_global_policy("mixed_float16")
    keras.utils.set_random_seed(s.seed)
    out = output_dir() / RUN
    out.mkdir(parents=True, exist_ok=True)

    # Data
    frames, images_dir = load_frames()
    photos = dfire.load_index(limit_per_split=40 if s.quick else None)
    if s.quick:
        frames = frames.groupby(["split", "has_smoke"], group_keys=False).head(12)
        s.epochs = 1
    pyro = {k: frames[frames["split"] == k] for k in ("train", "val", "test")}
    dfp = {k: photos[photos["split"] == k] for k in ("train", "val", "test")}
    pyro_tiles = tile_table(pyro["train"])
    pyro_whole = pyro_whole_rows(pyro["train"], s)
    print(f"[data] pyro frames train/val/test {len(pyro['train'])}/{len(pyro['val'])}/{len(pyro['test'])} | "
          f"d-fire photos {len(dfp['train'])}/{len(dfp['val'])}/{len(dfp['test'])} "
          f"(positive in train: {int(dfp['train']['positive'].sum())})", flush=True)

    val_pyro_tiles = sample_epoch(tile_table(pyro["val"]), s, np.random.default_rng(0)).assign(kind="pyro_tile")
    val_rows = pd.concat([val_pyro_tiles, dfp["val"].assign(kind="dfire", label=-1)], ignore_index=True)

    # Model: E1's weights if attached, so E2 keeps what E1 knew about distant plumes
    model = build_model(s.preset)
    e1 = load_e1()
    if e1 is not None:
        model.set_weights(e1.get_weights())
        print("[e1] starting from E1 weights", flush=True)

    train_data = make_dataset(lambda rng: epoch_rows(pyro_tiles, pyro_whole, dfp["train"], s, rng),
                              images_dir, s, train=True, seed=s.seed)
    val_data = make_dataset(lambda rng: val_rows, images_dir, s, train=False, seed=s.seed + 1)
    schedule = keras.optimizers.schedules.CosineDecay(s.learning_rate, decay_steps=len(train_data) * s.epochs, alpha=0.05)
    model.compile(
        optimizer=keras.optimizers.AdamW(schedule, weight_decay=1e-4),
        loss=keras.losses.BinaryCrossentropy(from_logits=True),
        metrics=[keras.metrics.AUC(from_logits=True, name="auc"),
                 keras.metrics.Precision(thresholds=0.0, name="precision"),
                 keras.metrics.Recall(thresholds=0.0, name="recall")],
    )
    callbacks = [
        keras.callbacks.BackupAndRestore(str(data_dir() / "e2_backup")),
        keras.callbacks.ModelCheckpoint(str(out / "best.weights.h5"), monitor="val_auc", mode="max",
                                        save_best_only=True, save_weights_only=True),
        keras.callbacks.CSVLogger(str(out / "history.csv")),
    ]
    started = time.time()
    model.fit(train_data, validation_data=val_data, epochs=s.epochs, callbacks=callbacks, verbose=2)
    train_minutes = (time.time() - started) / 60

    # Evaluate the best checkpoint in float32 (matches the export)
    keras.mixed_precision.set_global_policy("float32")
    best = build_model(s.preset)
    best.load_weights(str(out / "best.weights.h5"))
    best.save(str(out / "model.keras"))

    paths = {
        "pyro": {k: [images_dir / n for n in pyro[k]["image_name"]] for k in ("val", "test")},
        "dfire": {k: [Path(p) for p in dfp[k]["path"]] for k in ("val", "test")},
    }
    truth = {
        "pyro": {k: pyro[k]["has_smoke"].to_numpy() for k in ("val", "test")},
        "dfire": {k: dfp[k]["positive"].to_numpy() for k in ("val", "test")},
    }
    e2 = {src: {k: score_photos(best, paths[src][k]) for k in ("val", "test")} for src in paths}
    chosen = best_f1_threshold(np.concatenate([truth["pyro"]["val"], truth["dfire"]["val"]]),
                               np.concatenate([e2["pyro"]["val"], e2["dfire"]["val"]]))
    results = {src: frame_scores(truth[src]["test"], e2[src]["test"], chosen.threshold).__dict__ for src in paths}

    # E1 on the same test photos, the way the E1 API scored them (tiles only, its own threshold)
    baseline = {}
    if e1 is not None:
        e1_threshold = json.loads(find_input("e1_tile_classifier/model_spec.json").read_text())["threshold"]
        for src in paths:
            e1_scores = score_photos(e1, paths[src]["test"], whole=False)
            baseline[src] = frame_scores(truth[src]["test"], e1_scores, e1_threshold).__dict__
            baseline[src]["at_0.5"] = frame_scores(truth[src]["test"], e1_scores, 0.5).__dict__
    at_half = {src: frame_scores(truth[src]["test"], e2[src]["test"], 0.5).__dict__ for src in paths}

    # Export
    from src.export.onnx_check import export_and_check
    with Image.open(paths["dfire"]["val"][0]) as img:
        sample = photo_views(img)[:4]
    export = export_and_check(best, sample, out / "model.onnx")

    metrics = {
        "experiment": "E2 smoke classifier", "git_sha": git_sha(), "settings": s.__dict__,
        "started_from": "E1 weights" if e1 is not None else "ImageNet",
        "train_minutes": round(train_minutes, 1), "threshold": chosen.threshold, "val": chosen.__dict__,
        "test": results, "test_at_0.5": at_half, "e1_baseline_test": baseline, "export": export,
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2, default=float))
    (out / "model_spec.json").write_text(json.dumps({
        "name": "ember_smoke_classifier", "version": git_sha()[:7], "file": "model.onnx",
        "input": {"name": export["onnx_input"]["name"], "layout": "NHWC", "dtype": "float32",
                  "pixels": "RGB 0-255, no normalisation (done inside the model)"},
        "output": "one logit per view; probability = sigmoid(logit)",
        "tiling": LAYOUT.as_dict(),
        "views": VIEW_SPEC,
        "frame_score": VIEW_SPEC["frame_score"],
        "threshold": chosen.threshold,
    }, indent=2))

    def row(name, r):
        return f"| {name} | {r['precision']:.3f} | {r['recall']:.3f} | {r['f1']:.3f} |"
    report = [
        "# E2 smoke classifier", "",
        f"Started from {metrics['started_from']}, {s.epochs} epochs, {metrics['train_minutes']} min. "
        f"Code commit `{git_sha()}`. Threshold {chosen.threshold:.3f} (picked on both validation sets).", "",
        "| Test photos | Precision | Recall | F1 |", "|---|---|---|---|",
        row("Tower cameras, held-out sites: **E2**", results["pyro"]),
        *( [row("Tower cameras, held-out sites: E1", baseline["pyro"])] if baseline else []),
        row("D-Fire everyday fire photos: **E2**", results["dfire"]),
        *( [row("D-Fire everyday fire photos: E1", baseline["dfire"])] if baseline else []), "",
        f"ONNX {export['onnx_mb']} MB, parity ok: {export['parity_ok']}, {export['cpu_ms_batch1_p50']} ms per view on CPU.",
    ]
    (out / "report.md").write_text("\n".join(report) + "\n")
    print("\n".join(report), flush=True)


if __name__ == "__main__":
    main()
