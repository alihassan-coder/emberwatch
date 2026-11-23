"""The local, versioned model store."""

import hashlib
import json

import pytest

from src import config as config_module
from src import model_registry
from src.model_registry import ModelStoreError


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("EMBERWATCH_MODELS_DIR", str(tmp_path))
    monkeypatch.delenv("EMBERWATCH_MODEL_VERSION", raising=False)
    config_module.load_settings.cache_clear()

    def add(version: str, content: bytes = b"onnx-bytes", checksum: str | None = None):
        d = tmp_path / "versions" / version
        d.mkdir(parents=True)
        (d / "model.onnx").write_bytes(content)
        (d / "model_spec.json").write_text(json.dumps({"name": "m", "threshold": 0.5, "file": "model.onnx"}))
        digest = checksum or hashlib.sha256(content).hexdigest()
        (d / "model.onnx.sha256").write_text(f"{digest}  model.onnx\n")

    yield tmp_path, add
    config_module.load_settings.cache_clear()


def test_loads_the_active_version(store):
    root, add = store
    add("v1")
    add("v2")
    (root / "active.txt").write_text("v2\n")
    assert model_registry.active_version() == "v2"
    assert model_registry.load("v2").version == "v2"
    assert [m.version for m in model_registry.list_versions()] == ["v1", "v2"]


def test_env_var_overrides_active_txt(store, monkeypatch):
    root, add = store
    add("v1")
    (root / "active.txt").write_text("v1")
    monkeypatch.setenv("EMBERWATCH_MODEL_VERSION", "v9")
    config_module.load_settings.cache_clear()
    assert model_registry.active_version() == "v9"


def test_refuses_a_damaged_model(store):
    _, add = store
    add("v1", checksum="0" * 64)
    with pytest.raises(ModelStoreError, match="checksum"):
        model_registry.load("v1")


def test_clear_error_when_active_txt_is_missing(store):
    with pytest.raises(ModelStoreError, match="active.txt"):
        model_registry.active_version()


def test_clear_error_for_an_unknown_version(store):
    with pytest.raises(ModelStoreError, match="not found"):
        model_registry.load("nope")
