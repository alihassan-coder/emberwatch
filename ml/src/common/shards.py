"""Pack many small image files into a few tar shards, and unpack them again.

Kaggle lists every output file one API page at a time, so a run that writes
40k loose frames gets rate limited (HTTP 429) whenever results are fetched.
Datasets are therefore stored as ~1 GB uncompressed tar shards (JPEGs do not
compress further), WebDataset style. Consumers unpack them to local disk.
"""

from __future__ import annotations

import tarfile
from pathlib import Path

SHARD_BYTES = 1_000_000_000


def pack(src_dir: Path, out_dir: Path, prefix: str, shard_bytes: int = SHARD_BYTES) -> dict[str, str]:
    """Pack every file under src_dir into out_dir/{prefix}-NNN.tar.

    Returns {relative member path: shard file name}. Files are added in
    sorted order so shard contents are deterministic.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in src_dir.rglob("*") if p.is_file())
    index: dict[str, str] = {}
    shard_no, size, tar = 0, 0, None
    try:
        for path in files:
            n = path.stat().st_size
            if tar is None or size + n > shard_bytes:
                if tar is not None:
                    tar.close()
                    shard_no += 1
                name = f"{prefix}-{shard_no:03d}.tar"
                tar = tarfile.open(out_dir / name, "w")  # noqa: SIM115 - stays open across files, closed above and at the end
                size = 0
            rel = path.relative_to(src_dir).as_posix()
            tar.add(path, arcname=rel)
            index[rel] = name
            size += n
    finally:
        if tar is not None:
            tar.close()
    return index


def unpack(shard_dir: Path, dest: Path, pattern: str = "*.tar") -> Path:
    """Extract all shards in shard_dir into dest (skips if already done)."""
    marker = dest / ".unpacked"
    if marker.exists():
        return dest
    dest.mkdir(parents=True, exist_ok=True)
    shards = sorted(shard_dir.glob(pattern))
    if not shards:
        raise FileNotFoundError(f"no {pattern} shards in {shard_dir}")
    for shard in shards:
        with tarfile.open(shard) as tar:
            tar.extractall(dest, filter="data")
    marker.write_text("\n".join(s.name for s in shards))
    return dest
