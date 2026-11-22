"""Split an exported model into small parts for unreliable connections.

Large single-file downloads from Kaggle get cut off on slow links (the E1
model arrived as 8, 6 and 4 MiB of 16.4 MB). Small parts can each be
retried, then reassembled and checked against the SHA-256 written here.

Run on Kaggle (CPU):
    scripts/kaggle_run.sh run emberwatch-model-pack "src.export.pack_model --model-run e1_tile_classifier" \\
        --source emberwatch-e1-tiles
Reassemble locally:
    cat model.onnx.part-* > model.onnx && sha256sum -c model.onnx.sha256
"""

from __future__ import annotations

import argparse
import hashlib
import shutil

from src.common.env import find_input, output_dir

PART_BYTES = 2 * 1024 * 1024


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-run", default="e1_tile_classifier")
    args = ap.parse_args()

    spec_path = find_input(f"{args.model_run}/model_spec.json")
    model = spec_path.parent / "model.onnx"
    out = output_dir() / "packed" / args.model_run
    out.mkdir(parents=True, exist_ok=True)

    data = model.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    parts = [data[i:i + PART_BYTES] for i in range(0, len(data), PART_BYTES)]
    for n, chunk in enumerate(parts):
        (out / f"model.onnx.part-{n:03d}").write_bytes(chunk)
    (out / "model.onnx.sha256").write_text(f"{digest}  model.onnx\n")
    shutil.copy(spec_path, out / "model_spec.json")
    print(f"[pack] {model.stat().st_size / 1e6:.1f} MB -> {len(parts)} parts, sha256 {digest[:16]}…", flush=True)


if __name__ == "__main__":
    main()
