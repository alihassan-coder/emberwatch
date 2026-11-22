"""Real footage for the web showcase: a fire-start video and a "try to fool it" gallery.

All images: Pyro-SDIS (Apache-2.0, Pyronear with French fire services), from
camera sites the model never trained on (the held-out test sites), scored by
the attached E1 model exactly as the API scores frames.

1. Video. Pyro-SDIS v2.0 keeps at most 10 frames per smoke sequence; v1.0
   keeps every frame (~30 s apart). The longest v1.0 sequence from a test
   site is encoded as an MP4 time-lapse, with every frame's score, tiles
   and smoke boxes in video.json so the page can sync overlays to playback.
   It opens with a few smoke-free frames of the same camera so viewers see
   the moment smoke appears.

2. Gallery (v2.0, test sites):
   - ignored: smoke-free frames (real past false alarms) the model scores low
   - caught:  the smallest smoke boxes that the model still flags
   - missed:  smoke frames the model scores lowest (shown honestly)

Run on Kaggle (CPU):
    scripts/kaggle_run.sh run emberwatch-showcase "src.data.showcase" \\
        --extras eval --source emberwatch-data --source emberwatch-e1-tiles

Output (<output_dir>/showcase/):
    video.mp4, video.json, gallery/<kind>/<NN>.jpg, gallery.json, ATTRIBUTION.md
"""

from __future__ import annotations

import io
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from PIL import Image

from src.common.env import data_dir, find_input, git_sha, output_dir
from src.common.shards import unpack
from src.data.demo_frames import ATTRIBUTION, load_scorer, score
from src.data.pyro_sdis import REPO, parse_yolo, to_yxyx

OUT_W, OUT_H = 960, 540
SCALE = OUT_W / 1280
VIDEO_FPS = 4            # each frame is ~30 s of real time, so 1 s of video ~ 2 min
CLEAR_LEAD_IN = 4        # smoke-free frames before the smoke sequence
MAX_VIDEO_FRAMES = 90
GALLERY_EACH = 8


def jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS).save(buf, "JPEG", quality=82, optimize=True)
    return buf.getvalue()


# ── Video from v1.0 ─────────────────────────────────────────────────────────

def v1_frames(test_cameras: set[str]) -> pd.DataFrame:
    """Metadata of every v1.0 frame from test-site cameras (images loaded later, per shard)."""
    from huggingface_hub import snapshot_download

    root = Path(snapshot_download(REPO, repo_type="dataset", revision="v1.0", allow_patterns=["data/*.parquet"],
                                  local_dir=data_dir() / "pyro-sdis-v1.0"))
    rows = []
    for shard in sorted(root.glob("data/*.parquet")):
        names = set(pq.ParquetFile(shard).schema_arrow.names)
        cols = [c for c in ["image_name", "camera", "date", "annotations"] if c in names]
        meta = pq.read_table(shard, columns=cols).to_pandas()
        # v1.0's columns aren't documented the same way as v2.0's: derive what's missing
        # from the file name, e.g. "adf_avinyonet-999_2023-05-23T17-21-00.jpg".
        if "camera" not in meta:
            meta["camera"] = meta["image_name"].str.split("_").str[1]
        if "date" not in meta:
            meta["date"] = meta["image_name"].str.rsplit("_", n=1).str[-1].str.removesuffix(".jpg")
        meta = meta[meta["camera"].isin(test_cameras)]
        meta["shard"] = str(shard)
        rows.append(meta)
        print(f"[v1] {shard.name}: {len(meta)} test-site frames", flush=True)
    return pd.concat(rows, ignore_index=True)


def longest_sequence(v1: pd.DataFrame) -> pd.DataFrame:
    """The longest run of frames from one camera with no gap over 3 minutes."""
    v1 = v1.assign(t=pd.to_datetime(v1["date"], format="%Y-%m-%dT%H-%M-%S")).sort_values(["camera", "t"])
    best = None
    for cam, g in v1.groupby("camera"):
        run_id = (g["t"].diff() > pd.Timedelta(minutes=3)).cumsum()
        for _, run in g.groupby(run_id):
            if best is None or len(run) > len(best):
                best = run
    print(f"[video] longest run: {best['camera'].iloc[0]}, {len(best)} frames, "
          f"{best['t'].iloc[0]} to {best['t'].iloc[-1]}", flush=True)
    return best.head(MAX_VIDEO_FRAMES)


def load_v1_images(rows: pd.DataFrame) -> dict[str, bytes]:
    wanted = set(rows["image_name"])
    found: dict[str, bytes] = {}
    for shard in rows["shard"].unique():
        pf = pq.ParquetFile(shard)
        for batch in pf.iter_batches(batch_size=256, columns=["image", "image_name"]):
            for rec in batch.to_pylist():
                if rec["image_name"] in wanted:
                    found[rec["image_name"]] = rec["image"]["bytes"]
    return found


def build_video(out: Path, scorer, v2: pd.DataFrame, v2_images: Path, camera: str | None = None, lead_in: int = CLEAR_LEAD_IN) -> dict:
    # Only cameras with smoke-free frames qualify: the video must open before
    # the smoke, so viewers see the moment it appears (cabanelle-327, the
    # first pick, has none and the video started mid-fire).
    test = v2[v2["split"] == "test"]
    clear_counts = test[~test["has_smoke"]].groupby("camera").size()
    test_cams = {camera} if camera else set(clear_counts[clear_counts >= lead_in].index)
    seq = longest_sequence(v1_frames(test_cams))
    cam = seq["camera"].iloc[0]
    images = load_v1_images(seq)

    # Lead-in: smoke-free frames of the same camera, from v2.0's false-alarm set.
    lead = v2[(v2["camera"] == cam) & ~v2["has_smoke"]].sort_values("date").tail(lead_in)
    frames_dir = data_dir() / "video_frames"
    shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir(parents=True)

    timeline = []
    sources = [("lead", r.image_name, (v2_images / r.image_name).read_bytes(), "") for r in lead.itertuples()]
    sources += [("smoke", r.image_name, images[r.image_name], r.annotations) for r in seq.itertuples() if r.image_name in images]
    for i, (phase, name, raw, ann) in enumerate(sources):
        full = Image.open(io.BytesIO(raw)).convert("RGB")
        (frames_dir / f"{i:04d}.jpg").write_bytes(jpeg(full))
        boxes = []
        if ann:
            # v1.0 labels smoke as class 1 (v2.0 uses 0): normalise before parsing.
            fixed = "\n".join("0 " + " ".join(line.split()[1:]) for line in ann.strip().splitlines() if line.split())
            norm, _ = parse_yolo(fixed)
            boxes = [[round(v * SCALE, 1) for v in to_yxyx(b, *full.size)] for b in norm]
        entry = {"i": i, "taken": name.rsplit("_", 1)[-1].removesuffix(".jpg"), "phase": phase, "smoke": bool(boxes), "boxes": boxes}
        if scorer:
            entry["score"], entry["tiles"] = score(np.asarray(full), *scorer)
        timeline.append(entry)

    if not shutil.which("ffmpeg"):
        # No encoder: ship the frames; the page plays them as a flipbook.
        shutil.copytree(frames_dir, out / "video_frames", dirs_exist_ok=True)
        print("[video] ffmpeg not found: wrote frames instead of an MP4", flush=True)
    else:
        subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(VIDEO_FPS), "-i", str(frames_dir / "%04d.jpg"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", str(out / "video.mp4")],
        check=True,
        )
    meta = {"camera": cam, "site": cam.rsplit("-", 1)[0], "heading": int(cam.rsplit("-", 1)[1]), "fps": VIDEO_FPS,
            "seconds_per_frame_real": 30, "frame_size": [OUT_W, OUT_H], "frames": timeline}
    (out / "video.json").write_text(json.dumps(meta, indent=1))
    size = (out / "video.mp4").stat().st_size / 1e6 if (out / "video.mp4").exists() else 0
    print(f"[video] {len(timeline)} frames, video {size:.1f} MB", flush=True)
    return meta


# ── Gallery from v2.0 test sites ────────────────────────────────────────────

def build_gallery(out: Path, scorer, v2: pd.DataFrame, images: Path) -> dict:
    test = v2[v2["split"] == "test"].copy()
    test["area"] = [min((b[2] * b[3] for b in bs), default=1.0) for bs in test["boxes_cxcywh_norm"]]

    def scored(rows: pd.DataFrame) -> pd.DataFrame:
        s = []
        for r in rows.itertuples():
            full = Image.open(images / r.image_name).convert("RGB")
            sc, tiles = score(np.asarray(full), *scorer)
            s.append((sc, tiles))
        return rows.assign(score=[x[0] for x in s], tiles=[x[1] for x in s])

    negatives = scored(test[~test["has_smoke"]].sample(min(120, int((~test["has_smoke"]).sum())), random_state=7))
    smallest = scored(test[test["has_smoke"]].nsmallest(160, "area"))
    picks = {
        # one per camera where possible, so the gallery shows many different scenes
        "ignored": negatives.sort_values("score").drop_duplicates("camera").head(GALLERY_EACH),
        "caught": smallest[smallest["score"] >= 0.5].drop_duplicates("camera").head(GALLERY_EACH),
        "missed": smallest.sort_values("score").drop_duplicates("camera").head(GALLERY_EACH // 2),
    }
    gallery = {}
    for kind, rows in picks.items():
        items = []
        for i, r in enumerate(rows.itertuples()):
            rel = f"gallery/{kind}/{i:02d}.jpg"
            (out / rel).parent.mkdir(parents=True, exist_ok=True)
            (out / rel).write_bytes(jpeg(Image.open(images / r.image_name).convert("RGB")))
            items.append({
                "file": rel, "camera": r.camera, "taken": r.date, "score": r.score, "tiles": r.tiles,
                "boxes": [[round(v * SCALE, 1) for v in b] for b in r.boxes_yxyx_abs],
                "smoke_area_pct": round(float(r.area) * 100, 3) if r.has_smoke else None,
            })
        gallery[kind] = items
        print(f"[gallery] {kind}: {len(items)}", flush=True)
    (out / "gallery.json").write_text(json.dumps(gallery, indent=1))
    return gallery


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", help="build the video from this camera (default: longest test-site sequence)")
    ap.add_argument("--lead-in", type=int, default=CLEAR_LEAD_IN, help="smoke-free frames before the smoke")
    ap.add_argument("--video-only", action="store_true")
    args = ap.parse_args()
    scorer = load_scorer()
    if scorer is None:
        raise SystemExit("attach a trained model run (e.g. --source emberwatch-e1-tiles)")
    ann_path = find_input("pyro_sdis_v2/annotations.parquet")
    images = unpack(ann_path.parent, data_dir() / "pyro_sdis_images", "images-*.tar")
    v2 = pd.read_parquet(ann_path)
    v2 = v2[v2["split"].isin(["train", "val", "test"])]

    out = output_dir() / "showcase"
    out.mkdir(parents=True, exist_ok=True)
    if not args.video_only:
        build_gallery(out, scorer, v2, images)   # cheap first
    build_video(out, scorer, v2, images, args.camera, args.lead_in)  # needs the 3.3 GB v1.0 download
    (out / "ATTRIBUTION.md").write_text(ATTRIBUTION.replace("v2.0 (", "v1.0 and v2.0 ("))
    (out / "meta.json").write_text(json.dumps({"git_sha": git_sha(), "model": scorer[0]["version"]}, indent=1))


if __name__ == "__main__":
    main()
