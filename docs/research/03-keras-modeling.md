# 03: Keras modelling plan

Research date: 2026-11-21. Fixed stack: Keras 3.15.1, KerasHub 0.33.0 (latest on PyPI, released 2026-11-03, [PyPI](https://pypi.org/project/keras-hub/)), ONNX Runtime for serving. Training happens on free Kaggle/Colab GPUs. Local work is CPU-only (4 cores, 7 GB RAM, ~33 GB disk).

## 1. What KerasHub 0.33.0 actually offers for detection

I listed the source tree at tag `v0.33.0` ([GitHub tree](https://github.com/keras-team/keras-hub/tree/v0.33.0/keras_hub/src/models)). It contains **only two object-detection task classes**: `DFineObjectDetector` and `RetinaNetObjectDetector`. There is **no YOLO** in KerasHub (a YOLOX request, [#2797](https://github.com/keras-team/keras-hub/issues/2797), was closed without a model being added). `vit_det` is a backbone (used by SAM), not a detector task.

### D-FINE presets ([d_fine_presets.py](https://github.com/keras-team/keras-hub/blob/v0.33.0/keras_hub/src/models/d_fine/d_fine_presets.py))

| Preset | Params | Pretraining |
|---|---|---|
| `dfine_nano_coco` | 3.79 M | COCO |
| `dfine_small_coco` / `dfine_small_obj365` / `dfine_small_obj2coco` | 10.3 / 10.6 / 10.3 M | COCO / Objects365 / O365→COCO |
| `dfine_medium_coco` / `_obj365` / `_obj2coco` | 19.6 / 20.0 / 19.6 M | same |
| `dfine_large_coco` / `_obj365` / `_obj2coco_e25` | 31.3 / 31.9 / 31.3 M | same |
| `dfine_xlarge_coco` / `_obj365` / `_obj2coco` | 62.8 / 63.3 / 62.8 M | same |

- Backbone: HGNetV2. The default image converter is 640×640 (seen in the model summary in [#2686](https://github.com/keras-team/keras-hub/issues/2686)).
- Default `bounding_box_format="yxyx"`. Labels are a dict `{"boxes": [...], "labels": [...]}` with variable-length lists per image ([d_fine_object_detector.py docstring](https://github.com/keras-team/keras-hub/blob/v0.33.0/keras_hub/src/models/d_fine/d_fine_object_detector.py)).
- Training uses `detector.compile(optimizer=..., loss=detector.compute_loss)` (Hungarian matcher + VFL + box + CIoU + FGL + DDF losses).

### RetinaNet presets ([retinanet_presets.py](https://github.com/keras-team/keras-hub/blob/v0.33.0/keras_hub/src/models/retinanet/retinanet_presets.py))

| Preset | Params | Notes |
|---|---|---|
| `retinanet_resnet50_fpn_coco` | 34.1 M | "fine-tuned on COCO in 800x800 resolution" |
| `retinanet_resnet50_fpn_v2_coco` | 31.6 M | FPN features from P5 |

The official fine-tuning guide ([keras.io: Object Detection with KerasHub](https://keras.io/keras_hub/guides/object_detection_retinanet/)) does the following:
- Backend: JAX (TF is still needed for `tf.data`).
- Boxes in `yxyx`, labels 0-based with no background class.
- `keras.layers.Resizing(800, 800, pad_to_aspect_ratio=True, bounding_box_format=...)`, then `keras.layers.MaxNumBoundingBoxes(max_number=100)`.
- `Backbone.from_preset("retinanet_resnet50_fpn_coco")` → `RetinaNetObjectDetector(backbone, num_classes, bounding_box_format, preprocessor)`, then `compile(box_loss=keras.losses.MeanAbsoluteError(reduction="sum"))`.
- Batch 4, 5 epochs.
- It only monitors val loss (no mAP), so **we must write our own mAP/F1 evaluator.**

### Bounding-box formats
Keras 3 has `keras.utils.bounding_boxes.convert_format` (used inside RetinaNet). Pyro-SDIS ships YOLO `cx cy w h` normalised (in Keras terms, `rel_center_xywh`). Convert once in the data pipeline to absolute `yxyx` (or pass `bounding_box_format="rel_..."` only if the layer supports it; **verify in a spike**). The HPWREN CSV labels are absolute `MinX,MinY,MaxX,MaxY` (= `xyxy`).

## 2. Known KerasHub detector problems (GitHub issues)

| Issue | Status | Impact |
|---|---|---|
| [#2654](https://github.com/keras-team/keras-hub/issues/2654): `DFineObjectDetector.from_preset(..., num_classes=5)` crashed with an 80-vs-5 shape mismatch, because the number of classes is baked into `DFineBackbone` | Fixed by [PR #2670](https://github.com/keras-team/keras-hub/pull/2670), merged 2026-04-13 (included in 0.33.0) | Use `DFineObjectDetector.from_preset("dfine_small_obj2coco", num_classes=1, bounding_box_format="yxyx")`. Verify that the class head is re-initialised. |
| [#2686](https://github.com/keras-team/keras-hub/issues/2686): "D-Fine object detector is very slow in training and unusable" (dfine_nano, RTX 4080, batch 2). The maintainer reply blames XLA compile and cuDNN kernel fallbacks | Closed as stale, **no fix** | **Big risk on a free T4.** Time 50 steps on each backend before committing GPU hours. |
| D-FINE **contrastive denoising needs ground-truth labels at backbone construction time** (`DFineBackbone(labels=...)`, "Required when num_denoising > 0") ([d_fine_backbone.py](https://github.com/keras-team/keras-hub/blob/v0.33.0/keras_hub/src/models/d_fine/d_fine_backbone.py)) | By design | The denoising queries are built from a fixed label set, not per batch. Plan to fine-tune with `num_denoising=0` (slower convergence, UNVERIFIED by how much), or study how the preset handles this. |
| [#2495](https://github.com/keras-team/keras-hub/issues/2495): LiteRT conversion of D-FINE and RetinaNet "500% difference" hidden by loose test thresholds | Closed. The v0.33.0 tests still use `max: 5.0` thresholds for D-FINE ([test file](https://github.com/keras-team/keras-hub/blob/v0.33.0/keras_hub/src/models/d_fine/d_fine_object_detector_test.py)) | **Do not trust LiteRT detector output without our own parity check.** D-FINE LiteRT export is `xfail` on the torch backend. |
| No ONNX export test exists for either detector in v0.33.0 (only `test_litert_export`) | — | ONNX export of KerasHub detectors is **UNVERIFIED**. Make it a day-1 spike. |

### How `model.export(format="onnx")` works in Keras 3.15.1 ([keras/src/export/onnx.py](https://github.com/keras-team/keras/blob/v3.15.1/keras/src/export/onnx.py))
- **TensorFlow backend:** `tf2onnx.convert.from_function` (with a numpy-2 patch).
- **JAX backend:** `jax2onnx` since [PR #22443](https://github.com/keras-team/keras/pull/22443) (merged 2026-03-25). The old jax2tf path broke on JAX ≥ 0.4.36. Bidirectional (reverse-scan) LSTMs are not supported yet.
- **Torch backend:** `torch.onnx.export` (dynamo). Dynamic shapes are **not** supported, so pass a fully specified `input_signature`.
- The dtype policy must be float32 at export time.
- `export()` exports `call()` only, i.e. **raw head outputs**. RetinaNet decodes and runs NMS in `predict_step → decode_predictions` ([retinanet_object_detector.py](https://github.com/keras-team/keras-hub/blob/v0.33.0/keras_hub/src/models/retinanet/retinanet_object_detector.py)), and D-FINE applies `prediction_decoder` (NonMaxSuppression) after the backbone. **So expect to reimplement box decoding + NMS in numpy in the FastAPI service.** This is UNVERIFIED for D-FINE's exact graph boundary; check the exported output names.
- Known RNN gotcha: the TF backend + `tf2onnx` fails on cuDNN LSTM/GRU kernels (`CudnnRNNV3` unsupported) ([keras #21799](https://github.com/keras-team/keras/issues/21799), open). The workaround is `use_cudnn=False` at export (rebuild the layer and load the weights), or export from the JAX backend.

### Backend recommendation
- **JAX for training.** It is the backend in the official KerasHub detection guide, and the jax2onnx path is the newest maintained ONNX route. Fall back to TF if JAX D-FINE compile time is prohibitive. Both are installable on Kaggle.
- **Export on the same backend you trained on** (weights are portable via `.keras`, so you can re-export from another backend if one path fails). Every export must pass an **ONNX-vs-Keras parity gate** on ~50 golden images (max abs diff on logits < 1e-3, identical top-k boxes after NMS).

## 3. Three modelling routes for the per-frame stage

| Route | Keras pieces | Pros | Cons |
|---|---|---|---|
| **A. Tile classifier (SmokeyNet-style)**: tile 1 frame into 224×224 tiles, binary smoke/no-smoke per tile, optional cross-tile attention | `keras_hub.models.ImageClassifier.from_preset("efficientnet_b0_ra_imagenet" / "mobilenet_v3_large_100_imagenet")` or a backbone + small head | Simplest; robust ONNX export (plain CNN); a good fit for FIgLib, where most sequences only have image-level labels; edge-friendly | Coarse localisation (tile-level); bearing from the tile centre is ±~3° for a 90° FOV with 14 tile columns |
| **B. RetinaNet ResNet50-FPN** | `RetinaNetObjectDetector` | Mature in KerasHub; official guide; single-stage, easy to decode | 34 M params; ResNet50 is heavier on CPU; anchors not tuned for tiny boxes |
| **C. D-FINE (small/nano, obj2coco)** | `DFineObjectDetector` | Modern; strong small-object AP upstream; HGNetV2 is edge-friendly | Training-speed issue #2686, the denoising quirk, unverified ONNX → **highest risk** |

Backbone presets available for route A (checked in v0.33.0 preset files):
- `mobilenet_v3_small_050_imagenet` (0.28 M), `mobilenet_v3_large_100_imagenet` (3.0 M)
- `efficientnet_b0_ra_imagenet` (5.3 M), `efficientnet_lite0_ra_imagenet` (4.7 M)
- `hgnetv2_b4_ssld_stage2_ft_in1k` (13.6 M)
- `dinov2_small` / `dinov2_with_registers_small` (22.6 M), and `dinov3_vit_small_lvd1689m` (21.6 M; check the DINOv3 licence before shipping)

Correction to earlier notes: **`mobilenetv5_300m_enc_gemma3n` is a ~294 M-param Gemma 3n vision encoder**, not an edge model. Drop "MobileNetV5" from the EmberWatch edge plan.

**Small-object reality:** Pyronear's own detector runs at **1024 px** ([model card](https://huggingface.co/pyronear/yolo11s_rapid-raccoon_v8.1.0)). PyroNear-2025 average box area is ~1.3–2.0% of the image ([arXiv 2402.05349v3 Table 1](https://arxiv.org/html/2402.05349v3)). At 640 px a fresh plume can be under 10 px. Train at 640 first (cheap), then test either 1024 or **2×2 or 3×2 tiling at 640 per tile**. Tiling is usually the best CPU trade-off.

## 4. Fine-tuning recipe sketch (route B/C)

```python
import os; os.environ["KERAS_BACKEND"] = "jax"
import keras, keras_hub
det = keras_hub.models.DFineObjectDetector.from_preset(
    "dfine_small_obj2coco", num_classes=1, bounding_box_format="yxyx")   # or RetinaNet
# data: images float32 (H,W,3); y = {"boxes": ragged/padded [N,4] yxyx abs px, "labels": [N] int (0=smoke)}
# negatives: empty boxes; pad with -1 via keras.layers.MaxNumBoundingBoxes(max_number=8)
aug = [keras.layers.RandomFlip("horizontal", bounding_box_format="yxyx"),
       keras.layers.Resizing(640, 640, pad_to_aspect_ratio=True, bounding_box_format="yxyx")]
det.compile(optimizer=keras.optimizers.AdamW(1e-4, weight_decay=1e-4), loss=det.compute_loss)
det.fit(train_ds, validation_data=val_ds, epochs=E, callbacks=[BackupAndRestore(...), ModelCheckpoint(...)])
det.save("det.keras"); det.export("det.onnx", format="onnx")   # then parity-check
```
Notes:
- Kaggle sessions die at 12 h and Colab sooner, so **`BackupAndRestore` to `/kaggle/working` is mandatory.**
- Empty-annotation images (Pyro-SDIS has 1,634 FP images in v2.0) must flow through the pipeline. Test that both losses handle zero boxes; the RetinaNet label encoder should, D-FINE is UNVERIFIED.
- Use mixed precision for training only (`keras.mixed_precision.set_global_policy("mixed_float16")` on T4), and switch back to float32 before export (Keras ONNX export requires float32).

## 5. Temporal confirmation model options

None of these exist in KerasHub; they are custom Keras code (as `00-final-three-projects.md` already notes).

| Option | Input | Model | Evidence | Export risk |
|---|---|---|---|---|
| T0. Rules | per-frame detections | persistence: N of last K frames with IoU-linked boxes; max box width; growth check | Pyronear FSM baseline F1 0.951 ([leaderboard](https://github.com/pyronear/vision-rd/tree/main/experiments/temporal-models/temporal-model-leaderboard)) | none (numpy) |
| T1. **Tube GRU (recommended first)** | K=6–8 crops (224²) around a linked box tube → frozen CNN embeddings (EfficientNet-B0 / MobileNetV3 / DINOv2-S) | `TimeDistributed`-free: precompute embeddings, then `GRU(128)` + Dense, with masking for short tubes | Pyronear GRU-ConvNeXt F1 0.93–0.96 ([comparison.md](https://github.com/pyronear/vision-rd/blob/main/experiments/temporal-models/bbox-tube-temporal/data/08_reporting/comparison.md)) | Low if the GRU is exported from JAX, or from TF with `use_cudnn=False` |
| T2. Temporal-conv / small transformer head | same embeddings | 1D conv or 2-layer self-attention over time | Pyronear's best is a ViT + transformer head (F1 0.967) | Lowest (no RNN ops) |
| T3. SmokeyNet-lite | 2 consecutive full frames, tiled | per-tile CNN → LSTM over 2 steps → cross-tile attention | SmokeyNet 83.5% acc on FIgLib ([arXiv 2112.08598](https://arxiv.org/abs/2112.08598)) | Medium |
| T4. Hand-crafted motion features + GBM | frame differences inside the box: residual vs a background EMA, opacity trend, flow coherence, persistence | logistic regression / LightGBM | EARL "emergence field" cues ([Sensors 2026](https://doi.org/10.3390/s26196020)); MOG2 added ~2 points to SmokeyNet | none |
| T5. ConvLSTM2D on crop stacks | K×H×W×3 | `keras.layers.ConvLSTM2D` | none found for smoke in this survey | **UNVERIFIED ONNX path**; avoid unless the others fail |

Recommendation: **T0 → T1 (+T4 features concatenated) → T2.** Precompute embeddings once on GPU, then train temporal heads on CPU locally. They are tiny (~100k–500k params) and the embeddings fit in RAM: 25k frames × several tubes × 1280 floats ≈ hundreds of MB. Use float16 storage.

**Labels for the temporal model:**
- FIgLib file names carry the offset from plume appearance, so frames with offset ≥ 0 are positive and < 0 negative ([FIgLib page](https://www.hpwren.ucsd.edu/FIgLib/)).
- Pre-ignition frames of every sequence are natural same-scene negatives.
- Pyro-SDIS FP images grouped by `camera` + `date` give more negatives (see 01-datasets.md).

## 6. Free GPU budget (checked 2026-11-21)

- **Kaggle:** "30 hours or sometimes higher depending on demand and resources" per week. Sessions run up to 12 h on CPU/GPU. Hardware is T4 ×2 (16 GB each). One 2026 guide says the P100 was retired on 2026-09-15, but Kaggle's own docs still listed it (UNVERIFIED). There is ~20 GB of persistent `/kaggle/working` and ~29–30 GB RAM, and you may be queued at busy times. Sources: Kaggle GPU tips page as quoted by [fastero.com (updated 2026-11-20)](https://fastero.com/blog/kaggle-notebooks); the Kaggle pages themselves are JS-rendered and could not be fetched. **Check the exact quota in account settings.**
- **Colab free:** "Colab does not publish these limits"; notebooks run "at most 12 hours, depending on availability"; GPU access is "heavily restricted"; free T4 when available ([Colab FAQ](https://research.google.com/colaboratory/faq.html)). Plan on Colab as opportunistic overflow only.

**Plan for ~60 GPU-hours over 2–3 weeks (2 Kaggle weeks), keeping ~25% slack for failed runs.** The hour estimates below are my estimates, not measurements. Measure throughput in E0 and rescale.

## 7. Experiment matrix

| ID | Goal | Data | Model | Res | GPU-h (est.) | Where | Exit criterion |
|---|---|---|---|---|---|---|---|
| E0 | Spikes: load, 50 train steps, export ONNX, parity, CPU latency | 200 images | RetinaNet, D-FINE nano/small, EfficientNet-B0 classifier | 640 | 1.5 | Kaggle + local CPU | Each model gets a go/no-go on: trains at > X img/s on a T4, exports, parity < 1e-3, CPU ms/frame |
| E1 | Tile classifier baseline | Pyro-SDIS v2 boxes → tile labels; FIgLib positive frames (tiles inside HPWREN-BB boxes where available) + pre-ignition tiles | EfficientNet-B0 / MobileNetV3-L | 224 tiles | 3 | Kaggle | Tile AUC; image F1 on FIgLib val (floor 0.79) |
| E2 | Detector A | Pyro-SDIS v2 train (camera-grouped) | RetinaNet R50-FPN | 640 | 6 | Kaggle | mAP@0.5 / image-level F1 on held-out cameras |
| E3 | Detector B (only if E0 shows acceptable speed) | same | D-FINE small obj2coco (`num_denoising=0`) | 640 | 8 | Kaggle | Beats E2 on held-out cameras at ≤ 1.5× CPU latency |
| E4 | Small-object resolution | same | winner of E2/E3 | 1024 vs 2×2 tiles of 640 | 6 | Kaggle | Recall on boxes < 1% image area |
| E5 | Domain mix | + FIgLib frames with HPWREN-BB/auto-boxes, + D-Fire smoke/none (CC0) negatives | winner | best | 6 | Kaggle | FIgLib frame F1 ≥ 0.82 without losing SDIS mAP > 2 pts |
| E6 | Embedding extraction for tubes | FIgLib (all eligible sequences) + SDIS sequences | frozen backbone(s) | 224 crops | 3 | Kaggle | Embeddings saved (fp16) |
| E7 | Temporal heads | E6 embeddings + T4 features | T0 / T1 GRU / T2 conv-attn | — | 0 (CPU) | local | Seq recall ≥ 0.90, mean TTD ≤ 3 min, FPR halves vs T0 |
| E8 | Hard-negative round | detector FPs on archived fire-free HPWREN days (> 24 h old) + SDIS FPs | winner retrain | best | 6 | Kaggle | FA/cam-day ≤ 0.5 |
| E9 | Quantise + soak | — | ONNX int8 (dynamic/static QDQ) | — | 0 | local | ≤ 1-pt F1 drop; latency + memory curves for a 12 h soak |
| — | Slack / reruns | | | | ~15 | | |

Total is about 55–60 GPU-h, which fits two Kaggle weeks. Order: E0 → E1 → E2 → (E3) → E6 → E7 → E5 → E4 → E8 → E9. E1 + E7 alone already give a demo-able system if every detector route stalls.

## Decisions this implies for EmberWatch

1. **Choose between RetinaNet and D-FINE only after a 1.5 GPU-h spike** (E0) that measures training throughput, ONNX export success and ONNX-vs-Keras parity. D-FINE has an open-in-practice speed problem (#2686) and a denoising-labels quirk.
2. **Keep a tile-classifier route (EfficientNet-B0/MobileNetV3) as the guaranteed fallback.** It exports cleanly and matches SmokeyNet's single-frame baseline design.
3. **Box decoding + NMS live in numpy inside the FastAPI service.** The ONNX graph only carries raw head outputs, so write this once and test it against `model.predict`.
4. **Every exported artefact passes a parity gate** (50 golden images) before promotion. LiteRT export for detectors is not trusted (#2495); ONNX Runtime is the serving target, and LiteRT is optional.
5. **The temporal model is a small Keras head over precomputed embeddings,** trainable on the local CPU. Avoid cuDNN RNN kernels at export (use JAX export or `use_cudnn=False`).
6. **Train with JAX, use `BackupAndRestore` on every Kaggle run, and budget ~60 GPU-h** with E1+E7 as the minimum viable model set.
7. **Drop MobileNetV5 from the plan** (it is a 294 M-param encoder); use HGNetV2-B4 / EfficientNet / MobileNetV3 as edge backbones.
