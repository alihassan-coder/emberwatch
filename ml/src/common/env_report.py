"""Record the machine and library versions a run used (written to env.json).

Run: python -m src.common.env_report
"""

from __future__ import annotations

import importlib
import json
import platform
import shutil
import subprocess
import sys

from src.common.env import ON_KAGGLE, git_sha, output_dir

LIBS = ["numpy", "pandas", "pyarrow", "PIL", "jax", "jaxlib", "tensorflow",
        "torch", "keras", "keras_hub", "onnx", "onnxruntime", "tf2onnx", "jax2onnx"]


def _version(name: str) -> str | None:
    try:
        return getattr(importlib.import_module(name), "__version__", "?")
    except Exception:  # not installed, or broken install
        return None


def _gpus() -> list[str]:
    if not shutil.which("nvidia-smi"):
        return []
    out = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
        capture_output=True, text=True, check=False,
    )
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def _cuda_version() -> str | None:
    if not shutil.which("nvcc"):
        return None
    out = subprocess.run(["nvcc", "--version"], capture_output=True, text=True, check=False)
    return out.stdout.strip().splitlines()[-1] if out.stdout else None


def collect() -> dict:
    return {
        "git_sha": git_sha(),
        "on_kaggle": ON_KAGGLE,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpu_count": __import__("os").cpu_count(),
        "gpus": _gpus(),
        "cuda": _cuda_version(),
        "libs": {name: _version(name) for name in LIBS},
    }


def main() -> None:
    report = collect()
    (output_dir() / "env.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
