"""Local model store with versions.

Layout (git-ignored; models stay on this machine):

    models/
    ├── active.txt                 one line: the version to serve, e.g. "e1-18c4671"
    └── versions/
        └── e1-18c4671/
            ├── model.onnx
            ├── model_spec.json    written by the ML export (input name, tiling, threshold...)
            └── model.onnx.sha256  checksum; the API refuses a model that doesn't match

To add a version: create versions/<name>/ with those files. To switch or roll
back: edit active.txt (or set EMBERWATCH_MODEL_VERSION) and restart the API.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from src.config import load_settings


class ModelStoreError(RuntimeError):
    """The model store is missing a file or a checksum doesn't match."""


@dataclass(frozen=True)
class StoredModel:
    version: str
    path: Path
    spec: dict
    sha256: str | None

    @property
    def onnx(self) -> Path:
        return self.path / self.spec.get("file", "model.onnx")


def _versions_dir() -> Path:
    return load_settings().models_dir / "versions"


def active_version() -> str:
    s = load_settings()
    if s.model_version:
        return s.model_version
    active = s.models_dir / "active.txt"
    if not active.exists():
        raise ModelStoreError(f"No {active}. Write the version to serve into it, e.g. 'e1-18c4671'.")
    return active.read_text().strip()


def load(version: str, verify: bool = True) -> StoredModel:
    path = _versions_dir() / version
    spec_file = path / "model_spec.json"
    if not spec_file.exists():
        raise ModelStoreError(f"Model version '{version}' not found: expected {spec_file}")
    spec = json.loads(spec_file.read_text())
    checksum_file = path / "model.onnx.sha256"
    expected = checksum_file.read_text().split()[0] if checksum_file.exists() else None
    model = StoredModel(version=version, path=path, spec=spec, sha256=expected)
    if not model.onnx.exists():
        raise ModelStoreError(f"Model version '{version}' has no {model.onnx.name}")
    if verify and expected:
        actual = hashlib.sha256(model.onnx.read_bytes()).hexdigest()
        if actual != expected:
            raise ModelStoreError(f"{model.onnx} does not match its checksum: the file is damaged or incomplete")
    return model


def list_versions() -> list[StoredModel]:
    root = _versions_dir()
    if not root.exists():
        return []
    return [load(p.name, verify=False) for p in sorted(root.iterdir()) if (p / "model_spec.json").exists()]
