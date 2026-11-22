"""Export a Keras model to ONNX and prove the export gives the same answers.

The API serves ONNX files with ONNX Runtime and never loads Keras
(docs/decisions/0003). So every export must pass a parity check: run the
same inputs through Keras and through ONNX Runtime and compare outputs.
We also time ONNX Runtime on CPU with 4 threads, like the dev laptop.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np

PARITY_TOLERANCE = 1e-3  # max absolute difference allowed between Keras and ONNX outputs


def _to_numpy_list(outputs) -> list[np.ndarray]:
    import keras
    return [np.asarray(keras.ops.convert_to_numpy(t)) for t in keras.tree.flatten(outputs)]


def export_and_check(model, sample: np.ndarray, path: Path, latency_runs: int = 15) -> dict:
    """Export `model` to `path` (.onnx), then compare Keras vs ONNX on `sample`.

    Returns a dict with export time, file size, input/output signature,
    per-output max abs difference, parity_ok, and CPU latency (batch 1).
    """
    import onnxruntime as ort

    # Keras only exports a model that has been called directly (fit/predict
    # don't count), and we need its outputs for the parity check anyway.
    batch = sample[:2].astype(np.float32)
    keras_outputs = _to_numpy_list(model(batch, training=False))

    started = time.time()
    model.export(str(path), format="onnx")
    report = {"export_s": round(time.time() - started, 1), "onnx_mb": round(path.stat().st_size / 1e6, 1)}

    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
    onnx_input = session.get_inputs()[0]
    report["onnx_input"] = {"name": onnx_input.name, "shape": [str(d) for d in onnx_input.shape]}
    report["onnx_outputs"] = [{"name": o.name, "shape": [str(d) for d in o.shape]} for o in session.get_outputs()]

    onnx_outputs = list(session.run(None, {onnx_input.name: batch}))
    # Output order can differ between Keras and ONNX, so pair them up by shape.
    diffs = []
    for k in keras_outputs:
        match = next((i for i, o in enumerate(onnx_outputs) if o.shape == k.shape), None)
        if match is None:
            diffs.append(None)
            continue
        o = onnx_outputs.pop(match)
        diffs.append(float(np.max(np.abs(o.astype(np.float64) - k.astype(np.float64)))))
    report["parity_max_abs_diff"] = diffs
    report["parity_ok"] = bool(diffs) and all(d is not None and d < PARITY_TOLERANCE for d in diffs)

    one = batch[:1]
    for _ in range(3):  # warm-up
        session.run(None, {onnx_input.name: one})
    times = []
    for _ in range(latency_runs):
        t0 = time.perf_counter()
        session.run(None, {onnx_input.name: one})
        times.append((time.perf_counter() - t0) * 1000)
    report["cpu_ms_batch1_p50"] = round(float(np.median(times)), 1)
    report["cpu_ms_batch1_p90"] = round(float(np.percentile(times, 90)), 1)
    return report
