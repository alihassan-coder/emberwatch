"""E0 data pipeline for Pyro-SDIS (Pyronear + French fire services, Apache-2.0).

Downloads the dataset pinned to tag v2.0, validates every image and label,
builds a leakage-free split, removes near-duplicates across splits, and
freezes the result in a lockfile.

Run (from ml/):
    python -m src.data.pyro_sdis                 # full dataset (Kaggle)
    python -m src.data.pyro_sdis --limit 50      # quick dry run

Outputs, under <output_dir>/pyro_sdis_v2/:
    images/<image_name>       original JPEG bytes, untouched
    annotations.parquet       one row per image: metadata, boxes, split
    splits_v2.json            frozen split lockfile (image lists + sha256)
    stats.json                dataset statistics
    data_report.md            human-readable summary of the above

Split design (see docs/research/01-datasets.md §5):
    test  = every image from whole camera sites, chosen until ~15% of
            images are held out, round-robin across partners. Cameras on one tower share background,
            so holding out whole sites is stricter than holding out ids.
    val   = official val minus held-out sites (in-distribution check)
    train = everything else, minus near-duplicates of any val/test image
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from PIL import Image

from src.common.env import data_dir, git_sha, output_dir

REPO = "pyronear/pyro-sdis"
REVISION = "v2.0"  # pinned tag; main may move
SEED = 42
HELDOUT_IMAGE_FRACTION = 0.15  # aim: share of images in held-out sites
HELDOUT_IMAGE_CAP = 0.20       # never hold out more than this
PHASH_MAX_DISTANCE = 6  # Hamming distance (of 64 bits) counted as near-duplicate
SMOKE_CLASS_ID = 0  # v2.0 uses class 0 (v1.0 used 1)


# ── Download ────────────────────────────────────────────────────────────────

def download(quick: bool) -> list[Path]:
    from huggingface_hub import snapshot_download

    patterns = ["data.yaml", "README.md"]
    patterns += ["data/val-*"] if quick else ["data/*.parquet"]
    root = snapshot_download(
        REPO, repo_type="dataset", revision=REVISION,
        allow_patterns=patterns, local_dir=data_dir() / f"pyro-sdis-{REVISION}",
    )
    shards = sorted(Path(root).glob("data/*.parquet"))
    size_mb = sum(p.stat().st_size for p in shards) / 1e6
    print(f"[download] {len(shards)} shard(s), {size_mb:.0f} MB from {REPO}@{REVISION}")
    return shards


# ── Per-image processing ───────────────────────────────────────────────────

_DCT = None


def _dct_matrix(n: int = 32) -> np.ndarray:
    k = np.arange(n)
    mat = np.cos(np.pi * (2 * k[None, :] + 1) * k[:, None] / (2 * n))
    mat[0] *= 1 / math.sqrt(2)
    return mat * math.sqrt(2 / n)


def phash(img: Image.Image) -> int:
    """Perceptual hash (same algorithm as imagehash.phash), stored as int64."""
    global _DCT
    if _DCT is None:
        _DCT = _dct_matrix(32)
    small = np.asarray(img.convert("L").resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float64)
    low = (_DCT @ small @ _DCT.T)[:8, :8]
    bits = (low > np.median(low)).flatten()
    return int(np.packbits(bits).view(">i8")[0])


def parse_yolo(text: str | None) -> tuple[list[list[float]], int]:
    """YOLO lines -> normalised [cx, cy, w, h] boxes, plus count of bad lines."""
    boxes, bad = [], 0
    for line in (text or "").strip().splitlines():
        parts = line.split()
        if len(parts) != 5:
            bad += 1
            continue
        cls, cx, cy, w, h = int(float(parts[0])), *map(float, parts[1:])
        ok = cls == SMOKE_CLASS_ID and 0 < w <= 1 and 0 < h <= 1 and 0 <= cx <= 1 and 0 <= cy <= 1
        if ok:
            boxes.append([cx, cy, w, h])
        else:
            bad += 1
    return boxes, bad


def to_yxyx(box: list[float], width: int, height: int) -> list[float]:
    cx, cy, w, h = box
    return [
        max(0.0, (cy - h / 2) * height), max(0.0, (cx - w / 2) * width),
        min(float(height), (cy + h / 2) * height), min(float(width), (cx + w / 2) * width),
    ]


def process_shards(shards: list[Path], images_dir: Path | None, limit: int | None) -> pd.DataFrame:
    rows: list[dict] = []
    started = time.time()
    for shard in shards:
        orig_split = "val" if Path(shard).name.startswith("val") else "train"
        taken = 0
        pf = pq.ParquetFile(shard)
        for batch in pf.iter_batches(batch_size=128):
            for rec in batch.to_pylist():
                if limit is not None and taken >= limit:
                    break
                taken += 1
                raw = rec["image"]["bytes"]
                name = rec["image_name"]
                with Image.open(io.BytesIO(raw)) as img:
                    width, height = img.size
                    fmt = img.format
                    img.draft("L", (64, 64))  # fast reduced-size JPEG decode for hashing
                    ph = phash(img)
                boxes, bad = parse_yolo(rec["annotations"])
                if images_dir is not None:
                    (images_dir / name).write_bytes(raw)
                rows.append({
                    "image_name": name,
                    "partner": rec["partner"],
                    "camera": rec["camera"],
                    "site": str(rec["camera"]).split("-")[0],
                    "date": rec["date"],
                    "orig_split": orig_split,
                    "width": width,
                    "height": height,
                    "format": fmt,
                    "bytes": len(raw),
                    "phash": ph,
                    "n_boxes": len(boxes),
                    "bad_label_lines": bad,
                    "boxes_cxcywh_norm": boxes,
                    "boxes_yxyx_abs": [to_yxyx(b, width, height) for b in boxes],
                })
            if limit is not None and taken >= limit:
                break
        print(f"[process] {shard.name}: {taken} images ({time.time() - started:.0f}s elapsed)")
    df = pd.DataFrame(rows)
    df["has_smoke"] = df["n_boxes"] > 0
    return df


# ── Splitting + dedup ──────────────────────────────────────────────────────

def choose_heldout_sites(df: pd.DataFrame) -> list[str]:
    """Hold out whole sites until ~15% of *images* are held out.

    Site sizes are very uneven (one site can hold 10% of the data), so
    choosing a share of sites overshoots badly; v1 of this split held out 29%
    of images. Sites are drawn round-robin across partners that have at
    least 3 sites (so each keeps training data), skipping any site that
    would push the total past the cap or take over 40% of its partner.
    """
    rng = np.random.default_rng(SEED)
    total = len(df)
    target, cap = HELDOUT_IMAGE_FRACTION * total, HELDOUT_IMAGE_CAP * total
    site_n = df.groupby("site").size()
    partner_n = df.groupby("partner").size()
    site_partner = df.groupby("site")["partner"].agg(lambda s: s.mode().iloc[0])

    queues = {}
    for partner, sites in site_partner.groupby(site_partner).groups.items():
        if len(sites) >= 3:
            order = sorted(sites)
            rng.shuffle(order)
            queues[partner] = order
    heldout, held, partner_held = [], 0, {p: 0 for p in queues}
    while held < target and any(queues.values()):
        for partner in sorted(queues, key=lambda p: -partner_n[p]):
            while queues[partner]:
                site = queues[partner].pop(0)
                n = int(site_n[site])
                if held + n <= cap and partner_held[partner] + n <= 0.4 * partner_n[partner]:
                    heldout.append(site)
                    held += n
                    partner_held[partner] += n
                    break
            if held >= target:
                break
    return sorted(heldout)


_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def near_duplicates(query: np.ndarray, reference: np.ndarray) -> np.ndarray:
    """Boolean mask over `query`: True where some reference hash is within distance."""
    if len(query) == 0 or len(reference) == 0:
        return np.zeros(len(query), dtype=bool)
    hit = np.zeros(len(query), dtype=bool)
    ref = reference.astype(np.uint64)
    for start in range(0, len(query), 512):
        q = query[start:start + 512].astype(np.uint64)
        xor = (q[:, None] ^ ref[None, :]).view(np.uint8).reshape(len(q), len(ref), 8)
        dist = _POPCOUNT[xor].sum(axis=2, dtype=np.uint16)
        hit[start:start + 512] = (dist <= PHASH_MAX_DISTANCE).any(axis=1)
    return hit


def assign_splits(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str], dict]:
    heldout = choose_heldout_sites(df)
    df = df.copy()
    df["split"] = np.where(df["site"].isin(heldout), "test",
                           np.where(df["orig_split"] == "val", "val", "train"))
    hashes = df["phash"].to_numpy(dtype=np.int64).astype(np.uint64)
    is_test, is_val, is_train = (df["split"] == s for s in ("test", "val", "train"))

    # Drop val images that near-duplicate test, then train images that
    # near-duplicate val or test. Evaluation sets stay intact.
    val_leak = is_val.to_numpy() & near_duplicates(hashes, hashes[is_test.to_numpy()])
    eval_mask = (is_test | is_val).to_numpy() & ~val_leak
    train_leak = is_train.to_numpy() & near_duplicates(hashes, hashes[eval_mask])
    df.loc[val_leak | train_leak, "split"] = "dropped_duplicate"
    dedup = {"val_dropped_near_test": int(val_leak.sum()),
             "train_dropped_near_eval": int(train_leak.sum())}
    return df, heldout, dedup


# ── Reporting ──────────────────────────────────────────────────────────────

def compute_stats(df: pd.DataFrame, heldout: list[str], dedup: dict) -> dict:
    boxes = [(b, w, h) for bs, w, h in zip(df["boxes_cxcywh_norm"], df["width"], df["height"]) for b in bs]
    area = np.array([b[2] * b[3] for b, _, _ in boxes]) if boxes else np.array([0.0])
    width_px_640 = np.array([b[2] * 640 * min(1.0, w / max(w, h)) for b, w, h in boxes]) if boxes else np.array([0.0])
    pct = lambda a: {f"p{p}": round(float(np.percentile(a, p)), 5) for p in (5, 25, 50, 75, 95)}  # noqa: E731

    per_split = {}
    for split, g in df.groupby("split"):
        per_split[split] = {
            "images": len(g), "with_smoke": int(g["has_smoke"].sum()),
            "without_smoke": int((~g["has_smoke"]).sum()), "boxes": int(g["n_boxes"].sum()),
            "sites": g["site"].nunique(), "cameras": g["camera"].nunique(),
        }
    return {
        "dataset": REPO, "revision": REVISION, "git_sha": git_sha(),
        "images": len(df), "boxes": int(df["n_boxes"].sum()),
        "with_smoke": int(df["has_smoke"].sum()), "without_smoke": int((~df["has_smoke"]).sum()),
        "bad_label_lines": int(df["bad_label_lines"].sum()),
        "partners": df["partner"].value_counts().to_dict(),
        "sites": int(df["site"].nunique()), "cameras": int(df["camera"].nunique()),
        "image_sizes_top": {f"{w}x{h}": int(n) for (w, h), n in
                            df.groupby(["width", "height"]).size().sort_values(ascending=False).head(8).items()},
        "formats": df["format"].value_counts().to_dict(),
        "boxes_per_image_max": int(df["n_boxes"].max()),
        "box_area_fraction": pct(area),
        "boxes_under_1pct_area": round(float((area < 0.01).mean()), 4),
        "box_width_px_at_640_long_side": pct(width_px_640),
        "heldout_sites": heldout,
        "dedup": dedup,
        "splits": per_split,
    }


def write_report(stats: dict, path: Path) -> None:
    s = stats
    lines = [
        f"# Pyro-SDIS {s['revision']}: data report",
        "",
        f"Source `{s['dataset']}@{s['revision']}` (Apache-2.0). Code commit `{s['git_sha']}`.",
        "",
        "## Totals",
        "",
        f"- Images: **{s['images']}** ({s['with_smoke']} with smoke, {s['without_smoke']} without)",
        f"- Smoke boxes: **{s['boxes']}**, max {s['boxes_per_image_max']} per image, "
        f"{s['bad_label_lines']} invalid label lines",
        f"- Partners: {s['partners']}",
        f"- Sites: {s['sites']}, cameras: {s['cameras']}",
        f"- Image sizes (top): {s['image_sizes_top']}",
        "",
        "## Box sizes",
        "",
        f"- Box area as fraction of image: {s['box_area_fraction']}",
        f"- Boxes under 1% of image area: **{s['boxes_under_1pct_area']:.1%}**",
        f"- Box width in pixels if the long side is resized to 640: {s['box_width_px_at_640_long_side']}",
        "",
        "## Splits",
        "",
        "| Split | Images | With smoke | Without | Boxes | Sites | Cameras |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, v in s["splits"].items():
        lines.append(f"| {name} | {v['images']} | {v['with_smoke']} | {v['without_smoke']} | "
                     f"{v['boxes']} | {v['sites']} | {v['cameras']} |")
    lines += [
        "",
        f"Held-out test sites ({len(s['heldout_sites'])}): {', '.join(s['heldout_sites'])}",
        "",
        f"Near-duplicate removal (pHash, Hamming ≤ {PHASH_MAX_DISTANCE}): {s['dedup']}",
        "",
    ]
    path.write_text("\n".join(lines))


def write_lockfile(df: pd.DataFrame, heldout: list[str], path: Path) -> None:
    splits = {name: sorted(g["image_name"]) for name, g in df.groupby("split")}
    digest = {name: hashlib.sha256("\n".join(names).encode()).hexdigest() for name, names in splits.items()}
    path.write_text(json.dumps({
        "dataset": REPO, "revision": REVISION, "seed": SEED,
        "heldout_image_fraction": HELDOUT_IMAGE_FRACTION,
        "phash_max_distance": PHASH_MAX_DISTANCE,
        "heldout_sites": heldout,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_sha": git_sha(),
        "sha256": digest,
        "splits": splits,
    }, indent=1))


# ── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--limit", type=int, default=None, help="max images per shard (quick run)")
    ap.add_argument("--no-images", action="store_true", help="skip writing image files")
    ap.add_argument("--shards", nargs="*", type=Path, help="use local parquet files instead of downloading")
    args = ap.parse_args()

    out = output_dir() / "pyro_sdis_v2"
    images_dir = None if args.no_images else out / "images"
    if images_dir:
        images_dir.mkdir(parents=True, exist_ok=True)

    shards = args.shards or download(quick=args.limit is not None)
    df = process_shards(shards, images_dir, args.limit)
    df, heldout, dedup = assign_splits(df)
    stats = compute_stats(df, heldout, dedup)

    df.to_parquet(out / "annotations.parquet", index=False)
    write_lockfile(df, heldout, out / "splits_v2.json")
    (out / "stats.json").write_text(json.dumps(stats, indent=2))
    write_report(stats, out / "data_report.md")
    print((out / "data_report.md").read_text())


if __name__ == "__main__":
    main()
