"""E1: tile classifier, the baseline smoke model.

What it learns: "is there smoke in this 224x224 tile?" Frames are cut into 24
tiles (src/data/tiles.py) and a frame's smoke score is its best tile score.

Steps:
  1. build tile lists from the frozen Pyro-SDIS splits
  2. fine-tune a pretrained KerasHub backbone (EfficientNet-B0 by default)
  3. score every val/test frame, pick the threshold on val, apply it to test
  4. export to ONNX, check Keras vs ONNX parity, write a model spec for the API

Run on Kaggle (needs the emberwatch-data output attached):
    scripts/kaggle_run.sh run emberwatch-e1-tiles "src.train.tile_classifier" \\
        --gpu --extras train --source emberwatch-data
Quick local smoke test (CPU, tiny):
    python -m src.train.tile_classifier --quick
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
from src.common.shards import unpack  # noqa: E402
from src.data.tiles import TileLayout, cut, tile_labels  # noqa: E402
from src.evaluate.metrics import best_f1_threshold, frame_scores  # noqa: E402

LAYOUT = TileLayout()


@dataclass
class Settings:
    preset: str = "efficientnet_b0_ra_imagenet"
    epochs: int = 8
    batch: int = 64
    learning_rate: float = 3e-4
    negatives_per_positive: int = 3  # clear tiles sampled per smoke tile, each epoch
    hard_negative_share: float = 0.5  # of those, the share taken from no-smoke images (past false alarms)
    seed: int = 42
    quick: bool = False


# ── Which tiles to train on ───────────────────────────────────────────────

def load_frames() -> tuple[pd.DataFrame, Path]:
    """The frozen Pyro-SDIS annotations, plus a folder holding the unpacked images."""
    ann_path = find_input("pyro_sdis_v2/annotations.parquet")
    images_dir = unpack(ann_path.parent, data_dir() / "pyro_sdis_images", "images-*.tar")
    df = pd.read_parquet(ann_path)
    df = df[df["split"].isin(["train", "val", "test"])].reset_index(drop=True)
    df["tile_labels"] = [tile_labels(np.array(list(b)), LAYOUT) for b in df["boxes_yxyx_abs"]]
    return df, images_dir


def tile_table(frames: pd.DataFrame) -> pd.DataFrame:
    """One row per (frame, tile) with its label and whether the frame has any smoke."""
    rows = [
        {"image_name": f.image_name, "tile": t, "label": int(lbl), "frame_has_smoke": bool(f.has_smoke)}
        for f in frames.itertuples() for t, lbl in enumerate(f.tile_labels)
    ]
    return pd.DataFrame(rows)


def sample_epoch(tiles: pd.DataFrame, s: Settings, rng: np.random.Generator) -> pd.DataFrame:
    """All smoke tiles + a fresh sample of clear tiles, half of them hard negatives."""
    positives = tiles[tiles["label"] == 1]
    n_neg = len(positives) * s.negatives_per_positive
    hard_pool = tiles[(tiles["label"] == 0) & ~tiles["frame_has_smoke"]]   # tiles from past false alarms
    easy_pool = tiles[(tiles["label"] == 0) & tiles["frame_has_smoke"]]    # clear tiles beside real smoke
    n_hard = min(int(n_neg * s.hard_negative_share), len(hard_pool))
    hard = hard_pool.sample(n_hard, random_state=int(rng.integers(1 << 31)))
    easy = easy_pool.sample(min(n_neg - n_hard, len(easy_pool)), random_state=int(rng.integers(1 << 31)))
    return pd.concat([positives, hard, easy]).sample(frac=1.0, random_state=int(rng.integers(1 << 31)))


# ── Feeding tiles to Keras ────────────────────────────────────────────────

def read_tile(images_dir: Path, image_name: str, tile: int) -> np.ndarray:
    y, x = LAYOUT.origins()[tile]
    with Image.open(images_dir / image_name) as img:
        crop = img.convert("RGB").crop((x, y, x + LAYOUT.tile, y + LAYOUT.tile))
        return np.asarray(crop, dtype=np.float32)


def make_dataset(tiles: pd.DataFrame, images_dir: Path, s: Settings, train: bool, seed: int):
    """Batches of (tiles, labels) read from disk.

    For training, the clear tiles are re-sampled at the end of every epoch,
    so the model sees many different negatives while each epoch stays the
    same length. Threads (not processes) load the tiles: Pillow releases the
    GIL while decoding JPEGs, and threads share the re-sampled table.
    """
    import keras

    class TileBatches(keras.utils.PyDataset):
        def __init__(self):
            super().__init__(workers=8, use_multiprocessing=False, max_queue_size=16)
            self.rng = np.random.default_rng(seed)
            self.epoch = 0
            self.rows = sample_epoch(tiles, s, self.rng) if train else tiles.reset_index(drop=True)

        def __len__(self):
            return int(np.ceil(len(self.rows) / s.batch))

        def on_epoch_end(self):
            if train:
                self.epoch += 1
                self.rows = sample_epoch(tiles, s, self.rng)

        def __getitem__(self, i):
            part = self.rows.iloc[i * s.batch:(i + 1) * s.batch]
            x = np.stack([read_tile(images_dir, r.image_name, r.tile) for r in part.itertuples()])
            if train:
                rng = np.random.default_rng([seed, self.epoch, i])  # different augmentation every epoch
                flip = rng.random(len(x)) < 0.5
                x[flip] = x[flip, :, ::-1]  # mirror: smoke looks the same either way
                # small brightness/contrast changes, like different times of day
                gain = rng.uniform(0.8, 1.2, (len(x), 1, 1, 1))
                bias = rng.uniform(-15, 15, (len(x), 1, 1, 1))
                x = np.clip(x * gain + bias, 0, 255)
            return x.astype(np.float32), part["label"].to_numpy(np.float32)

    return TileBatches()


# ── The model ─────────────────────────────────────────────────────────────

def build_model(preset: str):
    """Raw RGB tile (0-255) -> one smoke logit.

    The backbone's input normalisation is built into the model, so the
    exported ONNX file takes plain pixels and the API cannot get the
    preprocessing wrong.
    """
    import keras
    import keras_hub

    converter = keras_hub.layers.ImageConverter.from_preset(preset)
    backbone = keras_hub.models.Backbone.from_preset(preset)

    tiles = keras.Input((LAYOUT.tile, LAYOUT.tile, 3), name="tiles")
    scale = 1.0 if converter.scale is None else converter.scale
    offset = 0.0 if converter.offset is None else converter.offset
    x = keras.layers.Rescaling(scale=scale, offset=offset, name="normalise")(tiles)
    x = backbone(x)
    x = keras.layers.GlobalAveragePooling2D(name="pool")(x)
    x = keras.layers.Dropout(0.2, name="dropout")(x)
    logit = keras.layers.Dense(1, dtype="float32", name="smoke_logit")(x)
    return keras.Model(tiles, logit, name="ember_tile_classifier")


# ── Frame-level evaluation ────────────────────────────────────────────────

def score_frames(model, frames: pd.DataFrame, images_dir: Path, batch_frames: int = 16) -> np.ndarray:
    """Smoke score per frame = highest tile probability (all 24 tiles)."""
    scores = []
    for start in range(0, len(frames), batch_frames):
        part = frames.iloc[start:start + batch_frames]
        tiles = []
        for name in part["image_name"]:
            with Image.open(images_dir / name) as img:
                tiles.append(cut(np.asarray(img.convert("RGB"), dtype=np.float32), LAYOUT))
        logits = model.predict(np.concatenate(tiles), verbose=0).reshape(len(part), LAYOUT.n_tiles)
        scores.append((1 / (1 + np.exp(-logits))).max(axis=1))
    return np.concatenate(scores)


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="E1 tile classifier")
    ap.add_argument("--preset", default=Settings.preset)
    ap.add_argument("--epochs", type=int, default=Settings.epochs)
    ap.add_argument("--batch", type=int, default=Settings.batch)
    ap.add_argument("--quick", action="store_true", help="tiny run to check the code end to end")
    args = ap.parse_args()
    s = Settings(preset=args.preset, epochs=args.epochs, batch=args.batch, quick=args.quick)

    import jax
    import keras

    on_gpu = any(d.platform == "gpu" for d in jax.devices())
    if on_gpu:
        keras.mixed_precision.set_global_policy("mixed_float16")  # ~2x faster on a T4
    keras.utils.set_random_seed(s.seed)
    out = output_dir() / "e1_tile_classifier"
    out.mkdir(parents=True, exist_ok=True)

    frames, images_dir = load_frames()
    if s.quick:
        frames = frames.groupby(["split", "has_smoke"], group_keys=False).head(12)
        s.epochs = 1
    train_frames = frames[frames["split"] == "train"]
    val_frames, test_frames = frames[frames["split"] == "val"], frames[frames["split"] == "test"]
    train_tiles = tile_table(train_frames)
    val_tiles = sample_epoch(tile_table(val_frames), s, np.random.default_rng(0))  # fixed val sample
    print(f"[data] frames train/val/test: {len(train_frames)}/{len(val_frames)}/{len(test_frames)} | "
          f"smoke tiles in train: {int(train_tiles['label'].sum())}", flush=True)

    model = build_model(s.preset)
    train_data = make_dataset(train_tiles, images_dir, s, train=True, seed=s.seed)
    val_data = make_dataset(val_tiles, images_dir, s, train=False, seed=s.seed)
    schedule = keras.optimizers.schedules.CosineDecay(s.learning_rate, decay_steps=len(train_data) * s.epochs, alpha=0.05)
    model.compile(
        optimizer=keras.optimizers.AdamW(schedule, weight_decay=1e-4),
        loss=keras.losses.BinaryCrossentropy(from_logits=True),
        metrics=[keras.metrics.AUC(from_logits=True, name="auc"),
                 keras.metrics.Precision(thresholds=0.0, name="precision"),  # logit 0 = probability 0.5
                 keras.metrics.Recall(thresholds=0.0, name="recall")],
    )
    callbacks = [
        keras.callbacks.BackupAndRestore(str(data_dir() / "e1_backup")),  # resume if the session dies
        keras.callbacks.ModelCheckpoint(str(out / "best.weights.h5"), monitor="val_auc", mode="max",
                                        save_best_only=True, save_weights_only=True),
        keras.callbacks.CSVLogger(str(out / "history.csv")),
    ]
    started = time.time()
    model.fit(train_data, validation_data=val_data, epochs=s.epochs, callbacks=callbacks, verbose=2)
    train_minutes = (time.time() - started) / 60

    # Evaluate the best checkpoint at frame level, in float32 so it matches the export.
    keras.mixed_precision.set_global_policy("float32")
    best = build_model(s.preset)
    best.load_weights(str(out / "best.weights.h5"))
    best.save(str(out / "model.keras"))  # float32 copy of the best model
    val_scores = score_frames(best, val_frames, images_dir)
    chosen = best_f1_threshold(val_frames["has_smoke"].to_numpy(), val_scores)  # threshold chosen on val only
    test_scores = score_frames(best, test_frames, images_dir)
    test = frame_scores(test_frames["has_smoke"].to_numpy(), test_scores, chosen.threshold)

    from src.export.onnx_check import export_and_check
    sample = np.stack([read_tile(images_dir, r.image_name, r.tile) for r in val_tiles.head(4).itertuples()])
    export = export_and_check(best, sample, out / "model.onnx")

    metrics = {
        "experiment": "E1 tile classifier", "git_sha": git_sha(), "settings": s.__dict__,
        "train_minutes": round(train_minutes, 1), "params_m": round(best.count_params() / 1e6, 2),
        "threshold": chosen.threshold,
        "val_frame": chosen.__dict__, "test_frame_heldout_sites": test.__dict__,
        "export": export,
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2, default=float))
    (out / "model_spec.json").write_text(json.dumps({
        "name": "ember_tile_classifier", "version": git_sha()[:7], "file": "model.onnx",
        "input": {"name": export["onnx_input"]["name"], "layout": "NHWC", "dtype": "float32",
                  "pixels": "RGB 0-255, no normalisation (done inside the model)"},
        "output": "one logit per tile; probability = sigmoid(logit)",
        "tiling": LAYOUT.as_dict(),
        "frame_score": "max tile probability",
        "threshold": chosen.threshold,
    }, indent=2))
    report = [
        "# E1 tile classifier", "",
        f"Backbone `{s.preset}`, {metrics['params_m']}M params, {s.epochs} epochs, {metrics['train_minutes']} min.",
        f"Code commit `{git_sha()}`.", "",
        "| Frames | Precision | Recall | F1 | Threshold |", "|---|---|---|---|---|",
        f"| val (in-distribution) | {chosen.precision:.3f} | {chosen.recall:.3f} | {chosen.f1:.3f} | {chosen.threshold:.3f} |",
        f"| **test (held-out sites)** | **{test.precision:.3f}** | **{test.recall:.3f}** | **{test.f1:.3f}** | same |", "",
        f"Target from the research: frame F1 ≥ 0.82 (SmokeyNet 82.6).", "",
        f"ONNX: {export['onnx_mb']} MB, parity ok: {export['parity_ok']} "
        f"(max diff {export['parity_max_abs_diff']}), CPU {export['cpu_ms_batch1_p50']} ms per tile "
        f"(≈ {export['cpu_ms_batch1_p50'] * LAYOUT.n_tiles:.0f} ms per frame at batch 1).",
    ]
    (out / "report.md").write_text("\n".join(report) + "\n")
    print("\n".join(report), flush=True)


if __name__ == "__main__":
    main()
