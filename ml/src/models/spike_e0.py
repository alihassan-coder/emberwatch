"""E0 spike: which model routes are viable on our stack?

For each candidate (docs/research/03-keras-modeling.md §7, E0) this measures:
  1. build from preset with 1 smoke class
  2. train speed on a GPU (images/s over 40 steps, after warm-up/compile)
  3. ONNX export via keras `model.export(format="onnx")`
  4. parity: max |keras - onnxruntime| on the same inputs
  5. ONNX Runtime CPU latency at batch 1, 4 threads (= the dev laptop)

Every candidate runs inside its own try/except: one failure is recorded with
its traceback and the others still run. Results go to spike_e0.json and a
markdown table in spike_e0.md.

Run (from ml/, needs the `train` extra and the emberwatch-data output):
    python -m src.models.spike_e0 [--images 200] [--steps 40]
"""

from __future__ import annotations

import os

os.environ.setdefault("KERAS_BACKEND", "jax")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_FORCE_GPU_ALLOW_GROWTH", "true")

import argparse  # noqa: E402
import json  # noqa: E402
import time  # noqa: E402
import traceback  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from PIL import Image  # noqa: E402

from src.common.env import data_dir, find_input, output_dir  # noqa: E402
from src.common.shards import unpack  # noqa: E402
from src.export.onnx_check import export_and_check  # noqa: E402

# Pyro-SDIS frames are 1280x720 and the median smoke box is ~17 px wide at
# 640 px, so detectors are tested near native resolution. 736 = 720 padded
# to a multiple of 32 (FPN strides). --size 640 gives the square baseline.
DET_H, DET_W = 736, 1280
TILE_SIZE = 224
MAX_BOXES = 8
BATCH = 4


# ── Data: a small sample from the frozen train split ───────────────────────

def letterbox(img: Image.Image, out_h: int, out_w: int) -> tuple[np.ndarray, float, int, int]:
    """Resize to fit (out_h, out_w) keeping aspect ratio, pad the rest. Returns array, scale, pad_y, pad_x."""
    w, h = img.size
    scale = min(out_w / w, out_h / h)
    nw, nh = round(w * scale), round(h * scale)
    canvas = np.full((out_h, out_w, 3), 114, dtype=np.uint8)
    pad_y, pad_x = (out_h - nh) // 2, (out_w - nw) // 2
    canvas[pad_y:pad_y + nh, pad_x:pad_x + nw] = np.asarray(img.convert("RGB").resize((nw, nh), Image.Resampling.BILINEAR))
    return canvas, scale, pad_y, pad_x


def load_detection_sample(n: int) -> tuple[np.ndarray, dict, list[np.ndarray]]:
    ann_path = find_input("pyro_sdis_v2/annotations.parquet")
    # Images arrive as tar shards next to the annotations; unpack once to scratch disk.
    images_dir = unpack(ann_path.parent, data_dir() / "pyro_sdis_images", "images-*.tar")
    df = pd.read_parquet(ann_path)
    train = df[df["split"] == "train"]
    pos = train[train["has_smoke"]].sample(min(int(n * 0.85), int(train["has_smoke"].sum())), random_state=0)
    neg = train[~train["has_smoke"]].sample(min(n - len(pos), int((~train["has_smoke"]).sum())), random_state=0)
    rows = pd.concat([pos, neg]).sample(frac=1.0, random_state=0)

    images, boxes, labels, crops = [], [], [], []
    for _, r in rows.iterrows():
        with Image.open(images_dir / r["image_name"]) as img:
            arr, scale, py, px = letterbox(img, DET_H, DET_W)
            b = np.full((MAX_BOXES, 4), -1.0, dtype=np.float32)
            lab = np.full((MAX_BOXES,), -1, dtype=np.int32)
            for i, (y1, x1, y2, x2) in enumerate(list(r["boxes_yxyx_abs"])[:MAX_BOXES]):
                b[i] = [y1 * scale + py, x1 * scale + px, y2 * scale + py, x2 * scale + px]
                lab[i] = 0
            images.append(arr); boxes.append(b); labels.append(lab)
            crops.append(arr)
    x = np.stack(images).astype(np.float32)
    y = {"boxes": np.stack(boxes), "labels": np.stack(labels)}
    return x, y, crops


def tiles_from(x: np.ndarray, y: dict) -> tuple[np.ndarray, np.ndarray]:
    """224 crops: centred on a smoke box (label 1) or random (label 0) for classifier spikes."""
    rng = np.random.default_rng(0)
    tiles, labels = [], []
    for img, bxs in zip(x, y["boxes"]):
        valid = bxs[bxs[:, 0] >= 0]
        if len(valid):
            y1, x1, y2, x2 = valid[0]
            cy, cx = int((y1 + y2) / 2), int((x1 + x2) / 2)
            label = 1
        else:
            cy = rng.integers(TILE_SIZE // 2, img.shape[0] - TILE_SIZE // 2)
            cx = rng.integers(TILE_SIZE // 2, img.shape[1] - TILE_SIZE // 2)
            label = 0
        top = int(np.clip(cy - TILE_SIZE // 2, 0, img.shape[0] - TILE_SIZE))
        left = int(np.clip(cx - TILE_SIZE // 2, 0, img.shape[1] - TILE_SIZE))
        tiles.append(img[top:top + TILE_SIZE, left:left + TILE_SIZE]); labels.append(label)
    return np.stack(tiles).astype(np.float32), np.array(labels, dtype=np.int32)


# ── Candidates ─────────────────────────────────────────────────────────────

def build_retinanet():
    import keras
    import keras_hub
    backbone = keras_hub.models.Backbone.from_preset("retinanet_resnet50_fpn_coco")
    preprocessor = keras_hub.models.RetinaNetObjectDetectorPreprocessor.from_preset("retinanet_resnet50_fpn_coco")
    model = keras_hub.models.RetinaNetObjectDetector(
        backbone=backbone, num_classes=1, bounding_box_format="yxyx", preprocessor=preprocessor,
    )
    model.compile(
        optimizer=keras.optimizers.SGD(learning_rate=1e-3, momentum=0.9, global_clipnorm=10.0),
        box_loss=keras.losses.MeanAbsoluteError(reduction="sum"),
    )
    return model


def build_dfine(preset: str):
    def _build():
        import keras
        import keras_hub
        model = keras_hub.models.DFineObjectDetector.from_preset(
            preset, num_classes=1, bounding_box_format="yxyx",
        )
        model.compile(optimizer=keras.optimizers.AdamW(learning_rate=1e-4, weight_decay=1e-4))
        return model
    return _build


def build_classifier(preset: str):
    def _build():
        import keras
        import keras_hub
        model = keras_hub.models.ImageClassifier.from_preset(preset, num_classes=2)
        model.compile(
            optimizer=keras.optimizers.AdamW(learning_rate=1e-4),
            loss=keras.losses.SparseCategoricalCrossentropy(from_logits=True),
            metrics=["accuracy"],
        )
        return model
    return _build


CANDIDATES = [
    # name, builder, kind
    ("tile_efficientnet_b0", build_classifier("efficientnet_b0_ra_imagenet"), "classifier"),
    ("tile_mobilenet_v3_large", build_classifier("mobilenet_v3_large_100_imagenet"), "classifier"),
    ("retinanet_resnet50_fpn", build_retinanet, "detector"),
    ("dfine_nano_coco", build_dfine("dfine_nano_coco"), "detector"),
    ("dfine_small_obj2coco", build_dfine("dfine_small_obj2coco"), "detector"),
]


# ── Measurements ───────────────────────────────────────────────────────────

def train_speed(model, x, y, steps: int) -> dict:
    n = len(x)
    reps = int(np.ceil(steps * BATCH / n)) + 1
    xs = np.concatenate([x] * reps)[: steps * BATCH + 2 * BATCH]
    ys = {k: np.concatenate([v] * reps)[: len(xs)] for k, v in y.items()} if isinstance(y, dict) \
        else np.concatenate([y] * reps)[: len(xs)]

    t0 = time.time()
    model.fit(xs[: 2 * BATCH], {k: v[: 2 * BATCH] for k, v in ys.items()} if isinstance(ys, dict) else ys[: 2 * BATCH],
              batch_size=BATCH, epochs=1, verbose=0)
    warmup = time.time() - t0

    rest_x = xs[2 * BATCH:]
    rest_y = {k: v[2 * BATCH:] for k, v in ys.items()} if isinstance(ys, dict) else ys[2 * BATCH:]
    t0 = time.time()
    hist = model.fit(rest_x, rest_y, batch_size=BATCH, epochs=1, verbose=0)
    elapsed = time.time() - t0
    return {
        "warmup_compile_s": round(warmup, 1),
        "train_images_per_s": round(len(rest_x) / elapsed, 2),
        "train_steps": len(rest_x) // BATCH,
        "final_loss": float(hist.history["loss"][-1]),
    }


def run_candidate(name, builder, kind, det_x, det_y, tile_x, tile_y, steps, out: Path) -> dict:
    import keras
    rec: dict = {"name": name, "kind": kind}
    stage = "build"
    try:
        keras.backend.clear_session()
        t0 = time.time()
        model = builder()
        rec["build_s"] = round(time.time() - t0, 1)
        rec["params_m"] = round(model.count_params() / 1e6, 2)

        stage = "train"
        x, y = (det_x, det_y) if kind == "detector" else (tile_x, tile_y)
        rec.update(train_speed(model, x, y, steps))

        stage = "export"
        rec.update(export_and_check(model, x, out / f"{name}.onnx"))
        rec["status"] = "ok" if rec.get("parity_ok") else "parity_failed"
    except Exception as exc:  # record and move on to the next candidate
        rec["status"] = f"failed_at_{stage}"
        rec["error"] = f"{type(exc).__name__}: {exc}"[:2000]
        rec["traceback"] = traceback.format_exc()[-6000:]
    print(json.dumps({k: v for k, v in rec.items() if k != "traceback"}, indent=1), flush=True)
    return rec


def write_markdown(results: list[dict], env: dict, path: Path) -> None:
    lines = [
        "# E0 spike: model routes",
        "",
        f"GPU: {env.get('gpus')}, backend: {env.get('backend')}, keras {env.get('keras')}, "
        f"keras_hub {env.get('keras_hub')}, jax {env.get('jax')}, detector input {env.get('det_input')}",
        "",
        "| Model | Status | Params (M) | Compile (s) | Train img/s | ONNX MB | Parity max diff | CPU ms (p50) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        diff = r.get("parity_max_abs_diff")
        diff_s = "–" if diff is None else ", ".join("n/a" if d is None else f"{d:.1e}" for d in diff)
        lines.append(
            f"| {r['name']} | {r['status']} | {r.get('params_m', '–')} | {r.get('warmup_compile_s', '–')} | "
            f"{r.get('train_images_per_s', '–')} | {r.get('onnx_mb', '–')} | {diff_s} | {r.get('cpu_ms_batch1_p50', '–')} |"
        )
    failures = [r for r in results if "error" in r]
    if failures:
        lines += ["", "## Failures", ""]
        for r in failures:
            lines += [f"### {r['name']} ({r['status']})", "", "```", r["error"], "```", ""]
    path.write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", type=int, default=200)
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--only", nargs="*", help="run only these candidate names")
    ap.add_argument("--size", choices=["native", "640"], default="native",
                    help="detector input: native 1280x736 or square 640")
    args = ap.parse_args()
    global DET_H, DET_W
    if args.size == "640":
        DET_H, DET_W = 640, 640

    import jax
    import keras
    import keras_hub

    out = output_dir() / "spike_e0"
    out.mkdir(parents=True, exist_ok=True)
    env = {"det_input": f"{DET_W}x{DET_H}", "backend": keras.backend.backend(), "keras": keras.__version__, "keras_hub": keras_hub.__version__,
           "jax": jax.__version__, "gpus": [str(d) for d in jax.devices()]}
    print("env:", env, flush=True)

    det_x, det_y, _ = load_detection_sample(args.images)
    tile_x, tile_y = tiles_from(det_x, det_y)
    print(f"data: detection {det_x.shape}, tiles {tile_x.shape} ({int(tile_y.sum())} smoke)", flush=True)

    results = []
    for name, builder, kind in CANDIDATES:
        if args.only and name not in args.only:
            continue
        results.append(run_candidate(name, builder, kind, det_x, det_y, tile_x, tile_y, args.steps, out))
        (out / "spike_e0.json").write_text(json.dumps({"env": env, "results": results}, indent=1))
        write_markdown(results, env, out / "spike_e0.md")
    print((out / "spike_e0.md").read_text())


if __name__ == "__main__":
    main()
