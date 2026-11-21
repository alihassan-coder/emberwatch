# 05: Risks and failure modes

Research date: 2026-11-21. ML risks first, then data, licence and engineering risks.

## 1. Known false-positive sources

| Confuser | Evidence | Why it fools models | Mitigations |
|---|---|---|---|
| **Low-altitude clouds** | SmokeyNet's main systematic FP. Fixing them would raise accuracy 83.5 → 85.8% and precision → 94.8% ([arXiv 2112.08598](https://arxiv.org/abs/2112.08598)) | Same colour and texture, often on ridgelines | Temporal cues (clouds fluctuate and translate; smoke grows from a fixed base); EARL's "monotonic opacity growth" cue ([Sensors 2026](https://doi.org/10.3390/s26196020)); max box width ≤ 0.4 of the image, as Pyronear does ([pyro-detector-baseline](https://github.com/pyronear/vision-rd/tree/main/experiments/temporal-models/pyro-detector-baseline)); a sky mask (smoke must touch or originate below the skyline) |
| **Haze / fog / marine layer** | SmokeyNet Fig. 1(b) "misleading haze"; AI For Mankind published a 181-image **Fog** FP test set where their model raised 72 FPs, and a **Sunrise** set with 2 ([AI For Mankind research repo](https://github.com/aiformankind/wildfire-smoke-detection-research)) | Large, low-contrast, diffuse | Box-area filter; a global-haze score per frame (e.g. dark-channel statistic) fed to the temporal head; per-camera adaptive thresholds by time of day |
| **Sun glare / sunrise / sunset** | SmokeyNet Fig. 1(a) "strong glare"; AI For Mankind Sunrise set | Bright, low-saturation blobs near the horizon | Use the solar azimuth/elevation per camera (computable from lat/lon/time) as a feature; suppress boxes within ±10° of the sun's position (my heuristic, untested) |
| **Dust (vehicles, agriculture), industrial smoke, geyser plumes** | Pano's analysts pre-screen "industrial smoke, geyser plumes, dust clouds" ([EPRI pilot report](https://restservice.epri.com/publicdownload/000000003002023034/0/Product)) | It *is* real particulate | Per-camera **persistent-source masks**, e.g. Pyronear's `bbox_mask_url` occlusion masks per camera pose ([pyro-engine](https://github.com/pyronear/pyro-engine)); a recurring-object ledger (Pyronear keeps "recurring objects" so the same artefact lands in one split; [pyro-dataset](https://github.com/pyronear/pyro-dataset)); human review |
| **Static structures** (towers, roads, quarries, buildings) | SmokeyNet missed a fire hidden behind a transmission tower; static FPs motivate Pyronear's MTB frame-differencing experiment ([leaderboard](https://github.com/pyronear/vision-rd/tree/main/experiments/temporal-models/temporal-model-leaderboard)) | Persistent texture | Frame differencing / background EMA residual; static objects show no change |
| **Night** | SmokeyNet removed 19 night fires; FIgLib has monochrome imagers ([FIgLib](https://www.hpwren.ucsd.edu/FIgLib/)) | Smoke is invisible; lights and headlights look like fire | **Out of scope for v1.** Detect night (mean luminance + solar elevation < −6°), switch to an `abstain` state, and show "night: detection paused" in the UI. Optional later: a flame/glow detector on the monochrome imager. |
| **Camera artefacts** (rain/dirt on lens, exposure jumps, compression, PTZ moves) | EARL's confuser list includes rain on the lens and headlights ([Sensors 2026](https://doi.org/10.3390/s26196020)) | Global frame changes | Frame-quality gate: global SSIM vs the previous frame; reject frames with a large global change (exposure step or camera move) |

## 2. Class imbalance

- **In operation:** fires are extremely rare per camera-hour. At 1 frame/min, a camera produces 1,440 frames/day. A per-frame FPR of 0.1% therefore still gives ~1.4 false frames per camera per day, which is why the temporal persistence stage and FA/cam-day matter (02 §6).
- **In data:** Pyro-SDIS v2.0 is *positive-heavy*: 10,744 smoke images vs 1,634 empty ones ([HF card](https://huggingface.co/datasets/pyronear/pyro-sdis)). FIgLib is ~50/50 per sequence (40 min before / 40 min after). SmokeyNet weights positive tiles ×40 for the tile-level imbalance ([arXiv 2112.08598](https://arxiv.org/abs/2112.08598)).
- **Mitigations:**
  - Add negatives from FIgLib pre-ignition frames, D-Fire "none" images (9,838, CC0; [D-Fire](https://github.com/gaia-solutions-on-demand/DFireDataset)), and archived fire-free HPWREN days (> 24 h old).
  - Focal loss is already in RetinaNet and D-FINE.
  - Tile-level positive weighting.
  - Calibrate the final probability (temperature scaling / logistic, as Pyronear does with a logistic calibrator; [temporal-model](https://huggingface.co/pyronear/temporal-model)).
  - **Choose thresholds on a validation set that has a realistic negative rate**, not on the balanced one.

## 3. Domain shift: Pyro-SDIS (France) vs HPWREN (California)

| Axis | Pyro-SDIS | HPWREN / FIgLib | Consequence |
|---|---|---|---|
| Geography and vegetation | French départements (SDIS 07/12/77, Force 06), plus partners `adf`, `biobio`, `engie` seen in the viewer (`biobio` suggests Chile; UNVERIFIED) | SoCal chaparral, desert, ocean marine layer | Different backgrounds and haze regimes |
| Camera | Pyronear stations (Reolink etc.), PTZ poses, 30 s cadence ([vision-rd](https://github.com/pyronear/vision-rd)) | Fixed quad cameras, 90° or 60° HFOV, 1536×2048 / 2048×3072, ~60 s cadence | Different resolution, compression, colour |
| Box size | Pyronear: early detection, small boxes (PyroNear avg 1.3–2.0% of image area) | FIgLib: distant plumes on 6 MP frames, often tiny | Need high input resolution or tiling |
| Labels | Boxes, ≤ 10 images per sequence (v2.0) | Mostly sequence-level (plume-onset offset in file names); boxes for only a few fires | Different supervision granularity |

Measured evidence that shift is large:
- PYRONEAR-2025 cross-dataset table: e.g. a model trained on Nemo gets F1 0.868 on Nemo but 0.238 on Fuego and 0.482 on PyroNear ([arXiv 2402.05349v3](https://arxiv.org/html/2402.05349v3)).
- EARL Table 5: training on FIgLib and testing on PyroNear-2025 costs about 2 min of TTD and about 15–20 points of recall for every method ([Sensors 2026](https://doi.org/10.3390/s26196020)).

**Mitigations:**
1. Train on both sources (mixed batches, roughly balanced by source).
2. Evaluate **per source** and on **held-out cameras**.
3. Resolution/tiling to handle small boxes.
4. Photometric augmentation (JPEG quality, colour jitter, haze synthesis, blur).
5. Pseudo-label FIgLib positive frames with the SDIS-trained detector, then human-verify a subset in our own review UI (dogfooding the active-learning loop).
6. Per-camera threshold calibration on fire-free archive days (label-free recalibration also helped EARL cross-domain).
7. Drift monitor on input statistics (brightness, contrast, haze score, colour histograms) and on score distributions per camera.

## 4. Data and labelling risks

| Risk | Detail | Mitigation |
|---|---|---|
| **Leakage via near-duplicate frames** | Consecutive frames 30–60 s apart are almost identical. The Govil et al. FIgLib result was inflated by train/test frames from the same fires 10 min apart (discussed in the SmokeyNet paper) | Split by fire event (FIgLib) and by camera (SDIS); perceptual-hash dedup across splits (PYRONEAR-2025 used imgdupes + Hamming distance) |
| **Same fire seen by several cameras** | FIgLib folder = fire × camera; e.g. Border Fire 2020 from `om`, `sm`, `lp` | Group by `date + firename` before splitting |
| **Weak FIgLib labels** | Frames right after `+00000` are labelled smoke but may be invisible; SmokeyNet also dropped 16 "questionable" fires | Evaluate TTD and penalised TTD rather than only frame recall; optionally ignore offsets 0 to +2 min in the frame-F1 loss |
| **Few HPWREN boxes** | The HPWREN-BB CSV listing has only ~9 sequences ([CSV index](https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data/Miscellaneous/Labels/HPWREN-BB/CSV/index.html)); SmokeyNet's 144 annotated fires are not on the HPWREN CDN (UNVERIFIED whether public elsewhere) | Use tile/image-level supervision for FIgLib; pseudo-boxes + human review |
| **Pyro-SDIS version drift** | `main` changed from 33,636 images (v1.0) to 12,378 (v2.0) and the class id changed 1 → 0 | Pin `revision="v2.0"` (tag exists); record the commit hash in the data manifest |
| **FIgLib size** | Over 100 GB as of Nov 2026; ~97 MB per sequence tgz; 528 sequences listed | Never mirror it locally (33 GB disk). Download in Kaggle sessions, resize to ≤ 1536 px, keep a **private** Kaggle dataset (no redistribution), and keep only a ~40-sequence test subset locally |

## 5. Licence risks

| Item | Licence | Risk |
|---|---|---|
| Pyro-SDIS | Apache-2.0 ([HF](https://huggingface.co/datasets/pyronear/pyro-sdis)) | Low |
| FIgLib / archived HPWREN | CC BY-NC 4.0, plus no-fee Commercial Use Permission with conditions ([cc.html](https://www.hpwren.ucsd.edu/cc.html)) | Medium: must register, credit, write the share-back article within 12 months, never redistribute, and include the publication disclaimer |
| **Live HPWREN** | Licence from UCSD OIC required for automated retrieval or model use, even non-commercially ([cc.html](https://www.hpwren.ucsd.edu/cc.html)) | **High: blocks the "live wall" as originally planned** (see 04 §0) |
| ALERTCalifornia | CC BY-NC-ND 4.0; commercial use requires a paid licence ([terms](https://alertcalifornia.org/terms/)) | High: do not use |
| AI For Mankind HPWREN boxes | CC BY-NC-SA 4.0 per the dataset page as reported in search results (UNVERIFIED directly; the repo shows MIT for the code) | Medium: ShareAlike + NC; evaluation only |
| D-Fire | CC0 for the collection, but "PublicDataset"-prefixed images "remain subject to the terms of their original providers" ([D-Fire](https://github.com/gaia-solutions-on-demand/DFireDataset)) | Low if those files are excluded |
| Pyronear YOLO weights | AGPL-3.0 ([model card](https://huggingface.co/pyronear/yolo11s_rapid-raccoon_v8.1.0)) | High if shipped: use only for offline comparison |
| DINOv3 presets in KerasHub | DINOv3 licence (not Apache; UNVERIFIED terms) | Medium: prefer DINOv2 (Apache-2.0) or CNNs |

## 6. Engineering risks

| Risk | Evidence | Mitigation |
|---|---|---|
| D-FINE trains very slowly in KerasHub | [#2686](https://github.com/keras-team/keras-hub/issues/2686) closed without a fix | E0 spike gate; RetinaNet / tile classifier fallback |
| Detector export (LiteRT) silently wrong | [#2495](https://github.com/keras-team/keras-hub/issues/2495) | ONNX + parity gate; LiteRT optional |
| RNN ONNX export fails (cuDNN ops) | [keras #21799](https://github.com/keras-team/keras/issues/21799) | JAX export or `use_cudnn=False`; or use a conv/attention temporal head |
| Free GPU quota is unpredictable | Kaggle ~30 h/week, may queue; Colab limits unpublished ([Colab FAQ](https://research.google.com/colaboratory/faq.html)) | `BackupAndRestore`; small experiments first; precompute embeddings once |
| Local machine 7 GB RAM / 4 cores | — | Stream images from disk; ONNX Runtime with `intra_op_num_threads=3`; int8 quantisation; ≤ 8 replay cameras at 1 frame/min |
| HPWREN CDN load / politeness | HPWREN asks users to be careful about load ([usage conditions](https://www.hpwren.ucsd.edu/usageconditions.html)) | Cache archive frames; rate-limit to the native cadence; set a descriptive User-Agent with contact details only once the user agrees |

## Decisions this implies for EmberWatch

1. **The temporal stage is the primary FP defence** (clouds, fog, dust, structures). Add cheap filters first: box-width cap, sky/skyline check, per-camera persistent-source masks, sun-position suppression, and a frame-quality gate.
2. **Night = abstain in v1**, with an explicit UI state and a metric for "hours abstained".
3. **Thresholds are chosen on realistic-prevalence validation sets and tracked as FA/cam-day.** Probabilities are calibrated before the review queue.
4. **Every metric is reported per source (SDIS vs FIgLib) and on held-out cameras.** A domain-shift slice is mandatory in the eval report.
5. **Drift monitoring** on per-camera brightness/contrast/haze statistics and score distributions, with a "simulate drift" button that replays foggy/hazy archive days.
6. **The licence register is a first-class artefact** (`docs/licences.md`), and the HPWREN credit line + disclaimer appear in the UI and the model card.
7. **No AGPL weights, no ALERTCalifornia imagery, no NC-SA labels in the shipped model.** NC data (FIgLib) is used under the registered Commercial Use Permission.
