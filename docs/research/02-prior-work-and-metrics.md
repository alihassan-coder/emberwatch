# 02: Prior work and metrics

Research date: 2026-11-21. Builds on `research/03-problems-and-datasets.md` #7 (SmokeyNet "rivals human performance", Pano AI funding). Every number below has a source link. "UNVERIFIED" means I could not confirm it from a primary source.

## 1. The metric zoo: what the literature reports

Papers and vendors use different units, so numbers can't be compared directly. Five families exist:

| Metric family | Unit | Who uses it | Caveat |
|---|---|---|---|
| Frame-level classification | accuracy / P / R / F1 per image | SmokeyNet, FIgLib papers | Frames just after ignition are labelled positive even when the plume is invisible, so frame recall is capped. EARL paper notes this explicitly ([Sensors 2026](https://doi.org/10.3390/s26196020)). |
| Object detection | mAP@0.5, AP_small | Detector papers (RT-DETR-Smoke, YOLO variants) | Pyronear's PYRONEAR-2025 paper refuses to use mAP: "the goal is about correctly classifying areas in an image as indicating the presence or not" of smoke ([arXiv 2402.05349v3](https://arxiv.org/html/2402.05349v3)). |
| Sequence-level classification | P / R / F1 / FPR per *sequence* | Pyronear vision-rd leaderboard | Closest to the alert decision. |
| Time to detect (TTD) | minutes (or frames) after first visible smoke | SmokeyNet, Pyronear, EARL, Pano | Averaging only detected fires flatters a model. EARL proposes a penalised TTD (misses charged the full horizon) plus "detection rate within H minutes" ([Sensors 2026](https://doi.org/10.3390/s26196020)). |
| False alarms per camera per day | FA / cam-day | EARL paper; operational systems | Needs long fire-free footage, which most public datasets lack. |

**For EmberWatch we report all of: frame F1, sequence P/R, mean + penalised TTD, DR@5/10 min, FA/cam-day, and box mAP@0.5 (detector only).** That covers every comparison point below.

## 2. SmokeyNet and FIgLib (UCSD / HPWREN)

Source: Dewangan et al., "FIgLib & SmokeyNet", *Remote Sensing* 14(4):1007, 2022 ([arXiv 2112.08598](https://arxiv.org/abs/2112.08598), [DOI](https://doi.org/10.3390/rs14041007)).

**Data used (as of Dec 2021):** 315 fires, 101 cameras, 30 stations, June 2016 to July 2021; ~81 frames/fire at ~60 s spacing; 24,800 images at 1536×2048 or 2048×3072. Removed: 10 black-and-white, 19 night, 16 questionable fires (45 fires / 3.7k images). Of the rest, 144 fires had bounding boxes + contour masks and were all used for training (11.3k images); validation 64 fires (4.9k), test 62 fires (4.9k). The exact split list is at `https://gitlab.nrp-nautilus.io/-/snippets/63` (not fetched; UNVERIFIED that it is still online).

**Architecture:** image tiled into 45 overlapping 224×224 tiles (20 px overlap); per-tile CNN (ResNet34) on the current and previous frame → LSTM per tile → ViT across tiles; "tile heads" give intermediate supervision; positive-tile weight 40 (ratio of negative to positive tiles). A tile is positive if it contains more than a smoke-pixel threshold (they tuned {0, 10, 100, 250} px). Code: `https://gitlab.nrp-nautilus.io/anshumand/pytorch-lightning-smoke-detection` (not fetched).

**Results (test set, average of 5 runs; Table 2 of the paper):**

| Model | Params (M) | ms/img | Acc | F1 | P | R | TTD (min) |
|---|---|---|---|---|---|---|---|
| ResNet34 + LSTM + ViT (SmokeyNet) | 56.9 | 51.6 | 83.49 | 82.59 | 89.84 | 76.45 | 3.12 |
| same, 3 frames | 56.9 | 80.3 | 83.62 | 82.83 | 90.85 | 76.11 | 2.94 |
| MobileNet + LSTM + ViT | 36.6 | 28.3 | 81.79 | 80.71 | 88.34 | 74.31 | 3.92 |
| EfficientNetB0 + LSTM + ViT | 52.3 | 67.9 | 82.55 | 81.68 | 88.45 | 75.89 | 3.56 |
| ResNet34 (1 frame, tiled) | 22.3 | 29.7 | 79.40 | 78.90 | 81.62 | 76.58 | 2.81 |
| ResNet34 + ViT (1 frame) | 40.3 | 30.8 | 82.53 | 81.30 | 88.58 | 75.19 | 2.95 |
| MobileNet + LSTM + ViT + MOG2 background subtraction | 57.3 | 55.5 | 83.12 | 82.65 | 88.79 | 77.43 | 3.72 |
| ResNet50 (1 frame, whole image) | 26.1 | 50.4 | 68.51 | 74.30 | 63.35 | 89.89 | 1.01 |
| Faster R-CNN (1 frame) | 41.3 | 55.6 | 71.56 | 66.92 | 81.34 | 56.88 | 5.01 |
| Mask R-CNN (1 frame) | 43.9 | 56.9 | 73.24 | 69.94 | 81.08 | 61.51 | 4.18 |

Takeaways:
- **Tiling plus a cross-tile ViT does most of the work.** Single-frame ResNet34+ViT (82.5% acc) is within 1 point of full SmokeyNet; the LSTM adds about 1 point.
- **Plain detectors did badly on FIgLib** (Faster R-CNN F1 66.9). But these were 2021-era detectors trained on only 144 fires.
- **Humans** (3 lab members, one image + previous frame from each of 62 test fires): accuracy 78.5%, F1 82.8%, precision 93.5%, recall 74.4%.
- **Main residual error: low-altitude clouds.** Correcting them would raise SmokeyNet to 85.8% accuracy and 94.8% precision. One fire was missed because smoke was behind a transmission tower.
- An earlier FIgLib paper (Govil et al.) reported 0.91 acc / 0.89 F1, but its 250-image test set came from the same fire sequences as training, 10 min apart. **That is the leakage pattern to avoid** (see 01-datasets.md §6).

Follow-ups mentioned by UCSD: "SmokeyNet Ensemble" and "Multimodal SmokeyNet" (adds weather data) ([UCSD news](https://today.ucsd.edu/story/firing-up-fire-detection-efforts-with-deep-learning-models2)). I did not fetch those papers, so their numbers are UNVERIFIED.

## 3. Later FIgLib-based work: EARL (Sensors, Oct 2026)

Muksimova & Umirzakova, "Detecting Wildfire Smoke Onset from Fixed View Camera Networks", *Sensors* 2026, [doi:10.3390/s26196020](https://doi.org/10.3390/s26196020) ([PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC13667166)). It is the most recent paper with a latency-first protocol and an FA/cam-day metric. The FIgLib split is **by fire event and camera, ~50/25/25**.

In-domain on FIgLib (Table 3):

| Method | TTD (min) | F1 (%) | FA/cam-day | mAP (%) |
|---|---|---|---|---|
| SmokeyNet | 3.1 | 82.5 | 0.61 | 80.9 |
| SKLFS two-stage | 2.3 | 83.9 | 0.44 | 85.9 |
| PyroNear sequential model | 2.0 | 84.1 | 0.39 | 86.4 |
| EARL | 1.5 | 84.8 | 0.21 | 88.3 |

Cross-domain, trained on FIgLib and tested on PyroNear-2025 with no retraining (Table 5): SmokeyNet 5.80 min / 61.3% recall / 1.21 FA/cam-day; YOLO11 5.24 / 63.8 / 1.12; RT-DETR 5.03 / 64.7 / 1.07; YOLO26 4.67 / 66.5 / 0.96; EARL 3.61 / 69.7 / 0.73.

Caveat: these are one group's re-implementations. The SmokeyNet row (F1 82.5, TTD 3.1) matches the original, but FA/cam-day and mAP for SmokeyNet are not in the original paper. Treat the baseline rows as indicative only. **Useful bit: the domain-shift penalty FIgLib → PyroNear is roughly +2 min TTD and −15 to −20 points of recall for every method.**

EARL's ideas worth copying cheaply: four "emergence" cues, namely residual vs scene baseline, monotonic opacity growth, motion coherence, and temporal persistence. Clouds fluctuate instead of growing monotonically, and foliage and shake are incoherent. These are hand-computable features for our temporal model (03-keras-modeling.md §5).

## 4. Pyronear (France): the closest open-source reference system

### 4.1 Deployed architecture (2026)
- Fixed 360° camera stations on towers, an image every **30 s**. On each **Raspberry Pi** a YOLO model proposes smoke boxes, and full frames + boxes go to a server where a **second-stage temporal model** verifies them ([vision-rd README](https://github.com/pyronear/vision-rd)).
- **pyro-engine** (Apache-2.0): the edge engine plus `pyro_camera_api`, with camera adapters for Reolink, Hikvision, Linovision, CTronics, RTSP, HTTP snapshot URL, and mock. It is uv-managed, ships as Docker images, and supports per-pose occlusion masks (`bbox_mask_url`) and `azimuth_offset_deg` per camera ([pyro-engine](https://github.com/pyronear/pyro-engine)).
- **Production alert logic:** detector conf threshold 0.05 → per-camera sliding window → alert when aggregated confidence > `conf_thresh`. Production uses `conf_thresh=0.35, nb_consecutive_frames=7`, and boxes wider than 40% of the image are dropped (`max_bbox_size=0.4`, which filters clouds) ([pyro-detector-baseline](https://github.com/pyronear/vision-rd/tree/main/experiments/temporal-models/pyro-detector-baseline)).
- **Optional temporal validation:** with `COMPOSE_PROFILES=temporal`, the engine sends the last frames + boxes of an ongoing alert to `pyro_temporal_api`, and boxes scoring ≤ 0.2 are dropped ([pyro-engine README](https://github.com/pyronear/pyro-engine)).
- **pyro-api** (Apache-2.0, FastAPI + PostgreSQL): users, organisations, cameras with tokens, detections grouped into **sequences**, webhooks ([pyro-api](https://github.com/pyronear/pyro-api)). It is a good reference data model for our alert inbox.
- **pyro-vision** (last push 2024-04) is the legacy classification library (RexNet/MobileNet classifiers at 448 px). It has been superseded by YOLO + temporal ([pyro-vision](https://github.com/pyronear/pyro-vision)).

### 4.2 Models on Hugging Face
- Detectors: `pyronear/yolo11s_*` (e.g. `yolo11s_rapid-raccoon_v8.1.0`, `yolo11s_sensitive-detector` v1.1.0). These are YOLO11s at **imgsz 1024**, 50 epochs, AdamW, shipped as `.pt`, ONNX (CPU) and **NCNN** (for the Pi). **Licence AGPL-3.0**, because they were trained from Ultralytics weights ([model card](https://huggingface.co/pyronear/yolo11s_rapid-raccoon_v8.1.0)). → Usable as an internal *evaluation reference* only. Do not ship it in EmberWatch.
- Temporal: `pyronear/temporal-model` v0.6.1, **Apache-2.0**. YOLO proposes boxes, boxes are linked by IoU into "tubes" (≤20 frames), 224×224 patches go to a DINOv2 ViT-S/14 + transformer head, and a logistic calibrator outputs a probability. The ONNX package takes `patches[N,20,3,224,224] + mask[N,20] → logit[N]` and runs on numpy + onnxruntime "for edge devices such as a Raspberry Pi". It can cache per-frame embeddings across calls ([model card](https://huggingface.co/pyronear/temporal-model), [repo](https://github.com/pyronear/temporal-model)).

### 4.3 Pyronear's numbers

**Sequence-level leaderboard** on pyro-dataset v3.0.0 test: 151 wildfire + 151 FP sequences, up to ~40 frames, nominal 30 s cadence ([leaderboard](https://github.com/pyronear/vision-rd/tree/main/experiments/temporal-models/temporal-model-leaderboard), updated 2026-04-20):

| Model | P | R | F1 | FPR | Mean TTD (frames) |
|---|---|---|---|---|---|
| Bbox-tube temporal (ViT-DINOv2) | 0.961 | 0.974 | 0.967 | 0.040 | 3.4 |
| FSM tracking (YOLO + 5 consecutive frames) | 0.947 | 0.954 | 0.951 | 0.053 | 4.6 |
| Bbox-tube temporal (GRU-ConvNeXt) | 0.927 | 0.927 | 0.927 | 0.073 | 2.0 |
| Production detector + sliding window | 0.858 | 0.960 | 0.906 | 0.159 | 1.3 |
| YOLO + frame-differencing (MTB) | 0.712 | 0.934 | 0.808 | 0.378 | 3.0 |

On pyro-dataset v2.2.0 val, single-frame YOLO alone scored P 0.828 / R 0.987 / **FPR 0.205**. The sliding window cut FPR to 0.120 (F1 0.911). Production params scored F1 0.825 ([pyro-detector-baseline](https://github.com/pyronear/vision-rd/tree/main/experiments/temporal-models/pyro-detector-baseline)).

Temporal-head ablation ([comparison.md](https://github.com/pyronear/vision-rd/blob/main/experiments/temporal-models/bbox-tube-temporal/data/08_reporting/comparison.md)):

| Variant | F1@0.5 | PR-AUC | FP @ recall 0.95 |
|---|---|---|---|
| GRU (small CNN) | 0.930 | 0.978 | 14 |
| GRU + ConvNeXt (fine-tuned) | 0.963 | 0.993 | 4 |
| ViT DINOv2 frozen | 0.960 | 0.993 | 6 |
| ViT DINOv2 fine-tuned | 0.971 | 0.991 | 5 |

→ **A GRU over pretrained-CNN crop features gets you most of the way.** This is exactly the Keras-friendly design (03-keras-modeling.md).

**PYRONEAR-2025 paper** ([arXiv 2402.05349v3](https://arxiv.org/html/2402.05349v3), Oct 2025):
- A YOLOv8-class single-frame detector trained on PyroNear gets F1 0.683 on its own test set.
- Trained on all datasets combined, it gets F1 0.789 on PyroNear and 0.852 overall.
- On PyroNear video, a YOLOv8 + CNN-LSTM sequential model raises F1 from 0.790 to 0.822, and time-to-detect falls from 1.76 to 1.17 min.
- Cross-dataset F1 collapses (e.g. Nemo-trained → Fuego F1 0.238). The domain shift is real.

## 5. Commercial systems (public information only)

**Pano AI.** EPRI Incubatenergy Labs 2021 pilot report with PG&E and Portland General Electric ([EPRI PDF](https://restservice.epri.com/publicdownload/000000003002023034/0/Product)):
- Cameras rotate 360° every minute, so the fastest confirmed detection is about 2 rotations.
- Station spacing of about 10 miles is recommended for triangulation; visibility reaches about 25 miles on clear days.
- On a control group of test vegetation fires, it detected **60% within 4 min** of smoke becoming visible and **85% within 10 min**.
- False-positive rate fell from **~1.6% (late July) to 0.37% (early Oct)**. The denominator is not stated, so treat it as UNVERIFIED in meaning.
- Alerting accuracy was >90% across >50 alerts.
- Human analysts at the "Pano Intelligence Center" pre-screen false positives (industrial smoke, geyser plumes, dust).
- 2025: alerts for 735 vegetation fires, first known alert in more than half of them (Fast Company 2026, via search snippet; page returned 403, so UNVERIFIED in detail).

**ALERTCalifornia (UCSD) + CAL FIRE.** The camera network supports an AI program, but I found no public, peer-reviewed accuracy or TTD numbers in this session (UNVERIFIED / not found). Its data licence is in 04-live-cameras-and-geometry.md.

**Implication:** the commercial bar is **human-in-the-loop confirmation**, a TTD of minutes (not seconds), and a false-positive rate per image in the 0.1–1% range. Our review queue matches this design.

## 6. Realistic targets for EmberWatch

These are grounded in the numbers above, assuming our free-GPU training budget and Keras models, not a SOTA claim:

| Metric | Where measured | Floor (must beat) | Target | Stretch |
|---|---|---|---|---|
| Frame F1 (tiled classifier or detector→image) | FIgLib test, event+camera split | 0.79 (SmokeyNet single-frame ResNet34) | 0.82 | 0.84 |
| Box mAP@0.5 | Pyro-SDIS held-out cameras | establish baseline (Pyronear publishes none for SDIS) | — | — |
| Sequence recall | FIgLib test fires | 0.85 | 0.90 | 0.95 |
| Mean TTD after first visible plume | FIgLib test | ≤ 4 min | ≤ 3 min | ≤ 2 min |
| DR@10 min | FIgLib test | 0.85 (Pano 2021) | 0.90 | 0.95 |
| Sequence FPR | Pyro-SDIS FP images grouped by camera-day + FIgLib pre-ignition | 0.16 (Pyronear single-model) | 0.08 | 0.04 |
| FA / camera-day | ≥ 7 archived fire-free HPWREN days × ≥ 8 cameras | ≤ 1.0 | ≤ 0.5 | ≤ 0.25 |
| CPU latency per 1 frame (ONNX, 4 cores) | dev laptop | ≤ 2 s at 1 frame/min/camera is enough for 8 cameras | ≤ 500 ms | ≤ 200 ms |

Note the cadence: HPWREN frames are ~60 s apart, so "TTD 3 min" means about 3 frames. A temporal model with K=4–6 frames already spends 4–6 min of context. Use a causal sliding window that can fire from frame 2 onward.

## Decisions this implies for EmberWatch

1. **Primary KPIs are TTD (mean and penalised), DR@10 min, and FA/camera-day.** Frame F1 and mAP are secondary diagnostics. Show all of them on the Model Ops page.
2. **Two-stage design like Pyronear:** a low-threshold per-frame detector proposes boxes, and a temporal verifier over box tubes decides. A GRU over pretrained-CNN crop features is the Keras-friendly first choice, since it got 0.93–0.96 F1 at Pyronear.
3. **Rule-based fallbacks first:** a sliding-window persistence rule (N of last K frames), a max-box-width filter (≤ 0.4 of image width) and occlusion masks per camera. They are cheap and proven (FSM baseline F1 0.95).
4. **Do not use Pyronear's YOLO weights in the product** (AGPL-3.0). Use them only as an offline comparison point. Their temporal model (Apache-2.0) is allowed as a reference, but we build our own in Keras.
5. **Report the leakage-free split explicitly**, since the Govil-style same-sequence split inflates accuracy by ~8 points.
6. **Pursue a calibrated probability + review queue rather than full automation**, mirroring Pano's human confirmation layer.
