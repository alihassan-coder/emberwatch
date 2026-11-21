"""FIgLib (HPWREN Fire Ignition images Library): sequences for temporal
training and time-to-detect evaluation.

Licence: archived HPWREN data, CC BY-NC 4.0, plus a no-fee Commercial Use
Permission that requires registering with HPWREN first (ADR 0004). Outputs
stay private on Kaggle and are never redistributed.
Credit: "Data courtesy of HPWREN, University of California San Diego
(https://www.hpwren.ucsd.edu/)." Dewangan et al. (2022), Remote Sensing 14(4).

Each sequence is ~81 frames, ~60 s apart, from 40 min before to 40 min after
onset (the first frame with visible smoke). The file name carries the label:
    {unix_epoch}_{offset_seconds_from_onset:+06d}.jpg   (offset >= 0 = smoke visible)

Run (from ml/):
    python -m src.data.figlib                    # all sequences (Kaggle, ~1-2 h)
    python -m src.data.figlib --max-seqs 6       # quick run

Outputs, under <output_dir>/figlib/:
    frames/<sequence>/<epoch>_<offset>.jpg   resized so the long side is 1280 px
    sequences.parquet                        one row per sequence (+ split)
    frames.parquet                           one row per frame (+ label)
    splits_v1.json, stats.json, data_report.md
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import tarfile
import time
import urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from src.common.env import git_sha, output_dir

BASE_URL = "https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data"
LONG_SIDE = 1280  # fits 2x2 tiles of 640 for small-plume experiments
JPEG_QUALITY = 90
SEED = 42
SPLIT_FRACTIONS = {"train": 0.60, "val": 0.15, "test": 0.25}
HELDOUT_STATIONS = 2  # whole stations reserved for test only
USER_AGENT = "emberwatch-research/0.1 (+https://github.com/alihassan-coder/emberwatch)"

SEQ_RE = re.compile(r"(\d{8})(?:\.\d{6})?[-_](.+)$")
FRAME_RE = re.compile(r"(\d{9,11})_([+-]\d+)\.jpe?g$", re.IGNORECASE)


# ── Index ──────────────────────────────────────────────────────────────────

def _get(url: str, timeout: int = 120) -> urllib.request.addinfourl:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=timeout)


def list_sequences() -> list[str]:
    html = _get(f"{BASE_URL}/index.html").read().decode("utf-8", "replace")
    names = re.findall(r"<a href=([^/>\s]+)/index\.html>", html)
    return sorted({n for n in names if n != "Tar" and SEQ_RE.match(n)})


def parse_sequence_name(name: str) -> dict:
    """Split a sequence name into date, fire name and camera.

    Both separators occur in the index:
        20170708_Whittier_syp-n-mobo-c
        20220302-Jimfire-0921-stgo-e-mobo-c
        20230718.131911-FIRE-bh-w-mobo-c      (date.time)
    Cameras end in station-direction-mobo-{c,m} (4 parts) or
    station-direction-{mobo,iqeye} (3 parts).
    """
    m = SEQ_RE.match(name)
    if not m:
        raise ValueError(f"unrecognised sequence name: {name}")
    date, rest = m.group(1), m.group(2)
    tokens = re.split(r"[-_]", rest)
    cam_parts = 4 if len(tokens) >= 4 and tokens[-2] == "mobo" and tokens[-1] in ("c", "m") else 3
    camera = "-".join(tokens[-cam_parts:])
    fire_tokens = tokens[:-cam_parts]
    fire = "_".join(fire_tokens) or "FIRE"
    # One fire event per date + fire name, ignoring number-only parts
    # ("Jimfire-0921" and "Jimfire-1101" are the same fire at two times).
    # Generic "FIRE" names merge every same-date sequence: stricter, never leakier.
    event_key = "_".join(t.lower() for t in fire_tokens if not t.isdigit()) or "fire"
    return {
        "sequence": name, "date": date, "year": int(date[:4]), "fire_name": fire,
        "camera": camera, "station": tokens[-cam_parts],
        "imager": "monochrome" if camera.endswith("-m") else ("iqeye" if "iqeye" in camera else "colour"),
        "fire_event": f"{date}_{event_key}",
    }


# ── Splits (by fire event, with whole stations held out) ──────────────────

def assign_splits(seqs: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    rng = np.random.default_rng(SEED)
    seqs = seqs.copy()

    # Hard slice: monochrome and iqeye imagers are evaluated separately, never trained on.
    hard = seqs["imager"] != "colour"

    # Held-out stations: pick from mid-sized stations so the test slice is meaningful
    # without removing a large share of training data.
    counts = seqs.loc[~hard, "station"].value_counts()
    mid = counts[(counts >= 8) & (counts <= 30)].index.tolist()
    heldout = sorted(rng.choice(sorted(mid), size=min(HELDOUT_STATIONS, len(mid)), replace=False).tolist())

    # Any fire event touching a held-out station goes entirely to test.
    heldout_events = set(seqs.loc[seqs["station"].isin(heldout), "fire_event"])

    # Remaining events: split by event, stratified by year bucket.
    seqs["year_bucket"] = pd.cut(seqs["year"], [2000, 2019, 2022, 2100], labels=["2016-19", "2020-22", "2023+"])
    event_split: dict[str, str] = {e: "test" for e in heldout_events}
    free = seqs.loc[~seqs["fire_event"].isin(heldout_events)].groupby("fire_event")["year_bucket"].first()
    for _, events in free.groupby(free, observed=True):
        names = sorted(events.index)
        rng.shuffle(names)
        n_val = int(round(len(names) * SPLIT_FRACTIONS["val"]))
        n_test = int(round(len(names) * SPLIT_FRACTIONS["test"]))
        for i, e in enumerate(names):
            event_split[e] = "val" if i < n_val else ("test" if i < n_val + n_test else "train")

    seqs["split"] = seqs["fire_event"].map(event_split)
    seqs.loc[hard, "split"] = "hard_slice"
    seqs["heldout_station"] = seqs["station"].isin(heldout)
    return seqs.drop(columns=["year_bucket"]), heldout


# ── Download + resize (streamed: the ~100 MB archives never touch disk) ────

def _resize_jpeg(raw: bytes) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(raw)) as img:
        w, h = img.size
        scale = LONG_SIDE / max(w, h)
        if scale < 1:
            img.draft("RGB", (int(w * scale) + 1, int(h * scale) + 1))  # fast JPEG downscale
            img = img.convert("RGB").resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
        else:
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue(), w, h


def fetch_sequence(name: str, frames_root: str, retries: int = 3) -> dict:
    """Download one sequence archive, resize its frames, return per-frame rows."""
    out_dir = Path(frames_root) / name
    out_dir.mkdir(parents=True, exist_ok=True)
    last_error = ""
    for attempt in range(1, retries + 1):
        rows = []
        try:
            with _get(f"{BASE_URL}/Tar/{name}.tgz", timeout=300) as resp, \
                    tarfile.open(fileobj=resp, mode="r|gz") as tar:
                for member in tar:
                    m = FRAME_RE.search(member.name)
                    if not member.isfile() or not m:
                        continue
                    raw = tar.extractfile(member).read()
                    small, w, h = _resize_jpeg(raw)
                    fname = f"{m.group(1)}_{m.group(2)}.jpg"
                    (out_dir / fname).write_bytes(small)
                    rows.append({
                        "sequence": name, "file": f"{name}/{fname}",
                        "epoch": int(m.group(1)), "offset_s": int(m.group(2)),
                        "orig_width": w, "orig_height": h, "bytes": len(small),
                    })
            if not rows:
                raise RuntimeError("archive contained no frames")
            return {"sequence": name, "ok": True, "rows": rows}
        except Exception as exc:  # network hiccup or bad archive: retry, then give up
            last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(5 * attempt)
    return {"sequence": name, "ok": False, "rows": [], "error": last_error}


# ── Reporting ──────────────────────────────────────────────────────────────

def compute_stats(seqs: pd.DataFrame, frames: pd.DataFrame, heldout: list[str], failed: list[dict]) -> dict:
    per_split = {}
    for split, g in seqs.groupby("split"):
        f = frames[frames["sequence"].isin(g["sequence"])]
        per_split[split] = {
            "sequences": len(g), "fire_events": g["fire_event"].nunique(), "stations": g["station"].nunique(),
            "frames": len(f), "smoke_frames": int((f["offset_s"] >= 0).sum()),
        }
    per_seq = frames.groupby("sequence").agg(n=("file", "size"), has_onset=("offset_s", lambda s: bool((s == 0).any())))
    return {
        "source": BASE_URL, "git_sha": git_sha(), "long_side": LONG_SIDE,
        "sequences": len(seqs), "fire_events": int(seqs["fire_event"].nunique()),
        "stations": int(seqs["station"].nunique()), "frames": len(frames),
        "smoke_frames": int((frames["offset_s"] >= 0).sum()),
        "frames_per_sequence": {"min": int(per_seq["n"].min()), "median": float(per_seq["n"].median()),
                                "max": int(per_seq["n"].max())},
        "sequences_missing_onset_frame": int((~per_seq["has_onset"]).sum()),
        "imagers": seqs["imager"].value_counts().to_dict(),
        "years": seqs["year"].value_counts().sort_index().to_dict(),
        "orig_resolutions_top": frames.groupby(["orig_width", "orig_height"]).size()
        .sort_values(ascending=False).head(5).rename(lambda t: f"{t[0]}x{t[1]}").to_dict(),
        "stored_gb": round(frames["bytes"].sum() / 1e9, 2),
        "heldout_stations": heldout,
        "failed_sequences": failed,
        "splits": per_split,
    }


def write_report(stats: dict, path: Path) -> None:
    s = stats
    lines = [
        "# FIgLib: data report", "",
        f"Source: {s['source']} (HPWREN, CC BY-NC 4.0; see ADR 0004). Code commit `{s['git_sha']}`.", "",
        "Data courtesy of HPWREN, University of California San Diego (https://www.hpwren.ucsd.edu/).", "",
        "## Totals", "",
        f"- Sequences: **{s['sequences']}** from {s['fire_events']} fire events at {s['stations']} stations",
        f"- Frames: **{s['frames']}** ({s['smoke_frames']} with visible smoke), stored at {s['long_side']} px "
        f"long side: {s['stored_gb']} GB",
        f"- Frames per sequence: {s['frames_per_sequence']}; sequences without an onset frame: "
        f"{s['sequences_missing_onset_frame']}",
        f"- Imagers: {s['imagers']}",
        f"- Original resolutions (top): {s['orig_resolutions_top']}",
        f"- Years: {s['years']}", "",
        "## Splits (by fire event; whole stations held out for test)", "",
        "| Split | Sequences | Fire events | Stations | Frames | Smoke frames |", "|---|---|---|---|---|---|",
    ]
    for name, v in s["splits"].items():
        lines.append(f"| {name} | {v['sequences']} | {v['fire_events']} | {v['stations']} | {v['frames']} | {v['smoke_frames']} |")
    lines += ["", f"Held-out stations: {', '.join(s['heldout_stations'])}",
              f"Failed downloads: {len(s['failed_sequences'])}", ""]
    path.write_text("\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--max-seqs", type=int, default=None, help="limit number of sequences (quick run)")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    out = output_dir() / "figlib"
    frames_root = out / "frames"
    frames_root.mkdir(parents=True, exist_ok=True)

    names = list_sequences()
    print(f"[index] {len(names)} sequences listed", flush=True)
    seqs = pd.DataFrame([parse_sequence_name(n) for n in names])
    seqs, heldout = assign_splits(seqs)
    if args.max_seqs:
        # quick run: a few sequences from each split
        seqs = seqs.groupby("split", group_keys=False).head(max(1, args.max_seqs // seqs["split"].nunique()))

    started, rows, failed = time.time(), [], []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_sequence, n, str(frames_root)): n for n in seqs["sequence"]}
        for i, fut in enumerate(as_completed(futures), 1):
            res = fut.result()
            rows += res["rows"]
            if not res["ok"]:
                failed.append({"sequence": res["sequence"], "error": res["error"]})
            if i % 10 == 0 or i == len(futures):
                print(f"[download] {i}/{len(futures)} sequences, {len(rows)} frames, "
                      f"{len(failed)} failed, {(time.time() - started) / 60:.1f} min", flush=True)

    frames = pd.DataFrame(rows)
    frames["smoke_visible"] = frames["offset_s"] >= 0
    seqs = seqs[~seqs["sequence"].isin({f["sequence"] for f in failed})]
    frames = frames.merge(seqs[["sequence", "fire_event", "station", "split"]], on="sequence", how="left")

    stats = compute_stats(seqs, frames, heldout, failed)
    seqs.to_parquet(out / "sequences.parquet", index=False)
    frames.to_parquet(out / "frames.parquet", index=False)
    splits = {s: sorted(g["sequence"]) for s, g in seqs.groupby("split")}
    (out / "splits_v1.json").write_text(json.dumps({
        "source": BASE_URL, "seed": SEED, "fractions": SPLIT_FRACTIONS, "heldout_stations": heldout,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "git_sha": git_sha(),
        "sha256": {k: hashlib.sha256("\n".join(v).encode()).hexdigest() for k, v in splits.items()},
        "splits": splits,
    }, indent=1))
    (out / "stats.json").write_text(json.dumps(stats, indent=2, default=str))
    write_report(stats, out / "data_report.md")
    print((out / "data_report.md").read_text())


if __name__ == "__main__":
    main()
