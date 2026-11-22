"""Cut a small set of real tower-camera frames for the web demo.

Source: Pyro-SDIS v2.0 (Apache-2.0, Pyronear with French fire services),
which may be redistributed with credit. The demo replays 8 January 2024 in
the Alpes-Maritimes, when cameras at four tower sites (Ferion, Cabanelle,
Courmettes, Valbonne) recorded smoke between about 12:00 and 13:10.

Camera ids carry their compass heading: "ferion-142" faces 142 degrees.

Each smoke camera starts with a few of its own smoke-free frames (real past
false alarms: cloud, haze, glare), then plays its real smoke sequence.
Clear cameras show only smoke-free frames.

If a trained model is attached, every frame also gets the model's real tile
scores, computed at full resolution exactly as the API does.

Run on Kaggle (CPU):
    scripts/kaggle_run.sh run emberwatch-demo-frames "src.data.demo_frames" \\
        --extras eval --source emberwatch-data --source emberwatch-e1-tiles

Output (<output_dir>/demo/):
    frames/<camera>/<NN>.jpg   960x540 JPEGs
    manifest.json              cameras, frames, smoke boxes, model scores
    ATTRIBUTION.md             licence and credit
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from src.common.env import data_dir, find_input, git_sha, output_dir
from src.common.shards import unpack
from src.data.tiles import TileLayout, cut

DAY = "2024-01-08"
WINDOW = ("11:50", "13:15")
SMOKE_CAMERAS = ["ferion-142", "cabanelle-244", "courmettes-212", "valbonne-349"]
CLEAR_CAMERAS = ["ferion-60", "cabanelle-46"]
FRAMES_PER_CAMERA = 12
FRAMES_BEFORE_SMOKE = 3
OUT_W, OUT_H = 960, 540
SCALE = OUT_W / 1280

ATTRIBUTION = """# Demo frames: attribution

These images come from **Pyro-SDIS v2.0** (https://huggingface.co/datasets/pyronear/pyro-sdis),
published by Pyronear with the French fire services (SDIS) under the **Apache License 2.0**.
They were resized to 960x540 for this demo; no other changes were made.

The model scores in manifest.json were produced by EmberWatch, not by Pyronear.
"""


def evenly(rows: pd.DataFrame, n: int) -> pd.DataFrame:
    if len(rows) <= n:
        return rows
    idx = np.linspace(0, len(rows) - 1, n).round().astype(int)
    return rows.iloc[idx]


def pick_frames(df: pd.DataFrame) -> pd.DataFrame:
    df = df.assign(day=df["date"].str[:10], time=df["date"].str[11:16].str.replace("-", ":"))
    picks = []
    for cam in SMOKE_CAMERAS:
        own = df[df["camera"] == cam].sort_values("date")
        before = evenly(own[~own["has_smoke"]], FRAMES_BEFORE_SMOKE).assign(phase="before")
        smoke = own[(own["day"] == DAY) & own["time"].between(*WINDOW) & own["has_smoke"]]
        picks += [before, evenly(smoke, FRAMES_PER_CAMERA - len(before)).assign(phase="smoke")]
    for cam in CLEAR_CAMERAS:
        own = df[(df["camera"] == cam) & ~df["has_smoke"]].sort_values("date")
        picks.append(evenly(own, FRAMES_PER_CAMERA).assign(phase="clear"))
    return pd.concat(picks).reset_index(drop=True)


def load_scorer():
    """The trained model, if its run is attached; otherwise None (frames ship without scores)."""
    try:
        model_dir = find_input("e1_tile_classifier/model_spec.json").parent
    except FileNotFoundError:
        return None
    import onnxruntime as ort

    spec = json.loads((model_dir / "model_spec.json").read_text())
    session = ort.InferenceSession(str(model_dir / spec["file"]), providers=["CPUExecutionProvider"])
    return spec, session


def score(frame: np.ndarray, spec: dict, session) -> tuple[float, list[dict]]:
    layout = TileLayout.for_frame(frame.shape[0], frame.shape[1], int(spec["tiling"]["tile"]))
    logits = session.run(None, {spec["input"]["name"]: cut(frame.astype(np.float32), layout)})[0].reshape(-1)
    probs = 1 / (1 + np.exp(-logits))
    tiles = [
        {"x": round(x * SCALE), "y": round(y * SCALE), "size": round(layout.tile * SCALE), "p": round(float(p), 4)}
        for (y, x), p in zip(layout.origins(), probs)
    ]
    return round(float(probs.max()), 4), tiles


def main() -> None:
    argparse.ArgumentParser(description=__doc__.split("\n")[0]).parse_args()
    ann_path = find_input("pyro_sdis_v2/annotations.parquet")
    images_dir = unpack(ann_path.parent, data_dir() / "pyro_sdis_images", "images-*.tar")
    df = pd.read_parquet(ann_path)
    df = df[df["partner"] == "force-06"]

    picks = pick_frames(df)
    scorer = load_scorer()
    out = output_dir() / "demo"
    (out / "frames").mkdir(parents=True, exist_ok=True)

    cameras = []
    for cam, rows in picks.groupby("camera", sort=False):
        site, heading = cam.rsplit("-", 1)
        frames = []
        for i, r in enumerate(rows.itertuples()):
            with Image.open(images_dir / r.image_name) as img:
                full = img.convert("RGB")
            rel = f"frames/{cam}/{i:02d}.jpg"
            buf = io.BytesIO()
            full.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS).save(buf, "JPEG", quality=80, optimize=True)
            (out / rel).parent.mkdir(parents=True, exist_ok=True)
            (out / rel).write_bytes(buf.getvalue())
            frame = {
                "file": rel, "taken": r.date, "phase": r.phase, "smoke": bool(r.has_smoke),
                "boxes": [[round(v * SCALE, 1) for v in box] for box in r.boxes_yxyx_abs],
            }
            if scorer:
                frame["score"], frame["tiles"] = score(np.asarray(full), *scorer)
            frames.append(frame)
        cameras.append({
            "id": cam, "site": site, "heading": int(heading),
            "split": rows["split"].iloc[0],  # "test" = a site the model never trained on
            "role": "smoke" if cam in SMOKE_CAMERAS else "clear",
            "frames": frames,
        })
        print(f"[demo] {cam}: {len(frames)} frames", flush=True)

    manifest = {
        "source": "pyronear/pyro-sdis@v2.0 (Apache-2.0)", "day": DAY, "window": WINDOW,
        "frame_size": [OUT_W, OUT_H], "git_sha": git_sha(),
        "model": None if not scorer else {"name": scorer[0]["name"], "version": scorer[0]["version"],
                                          "threshold": scorer[0]["threshold"]},
        "cameras": cameras,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    (out / "ATTRIBUTION.md").write_text(ATTRIBUTION)
    total = sum(p.stat().st_size for p in (out / "frames").rglob("*.jpg"))
    print(f"[demo] {sum(len(c['frames']) for c in cameras)} frames, {total / 1e6:.1f} MB, "
          f"model scores: {'yes' if scorer else 'no'}", flush=True)


if __name__ == "__main__":
    main()
