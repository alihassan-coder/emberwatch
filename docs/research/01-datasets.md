# 01: Datasets

Research date: 2026-11-21. Builds on `research/03-problems-and-datasets.md` #7. **Two corrections to that file:**
1. Pyro-SDIS `main` is now **v2.0 with 12,378 images**, not 33,636. 33,636 is v1.0, still available by tag.
2. The HPWREN **real-time** terms changed; see §2.4 and 04-live-cameras-and-geometry.md §0.

## 1. Pyro-SDIS (Pyronear + French fire services): primary training set

Source: [huggingface.co/datasets/pyronear/pyro-sdis](https://huggingface.co/datasets/pyronear/pyro-sdis), README at `main` and at tag `v1.0`, plus the HF API file listing (fetched 2026-11-21).

### 1.1 Versions

| | v2.0 (`main`, tag `v2.0`) | v1.0 (tag `v1.0`) |
|---|---|---|
| Images | **12,378** (train 11,249 / val 1,129) | 33,636 (train 29,537 / val 4,099) |
| With smoke | 10,744 | 28,103 |
| Smoke boxes | 12,137 | 31,975 |
| Without smoke | **1,634**, "false positives of the Pyronear system", empty annotation | not stated (≈ 5,533 by subtraction; UNVERIFIED) |
| Years | 2023–2025 | — |
| Class id | `0` | `1` |
| Sampling | "At most 10 images per smoke sequence, so consecutive near duplicate frames are no longer all kept" | all frames |
| Parquet download size | 1,318,526,032 B (≈ 1.32 GB): `data/train-0000{0,1,2}-of-00003.parquet` (366 MB, 349 MB, 481 MB) + `data/val-00000-of-00001.parquet` (122 MB) | 3,284,043,758 B (≈ 3.28 GB): 6 train shards of ~480 MB + val 390 MB |
| In-memory dataset size | 1.40 GB | 3.33 GB |

Tags in the repo: `v1.0` (commit `dd86e151…`), `v2.0` (commit `49a95449…`); `main` is at `ebfc02d0…` (HF refs API).

### 1.2 Format
- Columns: `image` (Image), `annotations` (string), `image_name` (string, e.g. `adf_avinyonet-999_2023-05-23T17-21-00.jpg`), `partner` (string), `camera` (string), `date` (string `YYYY-MM-DDTHH-MM-SS`).
- **Labels:** YOLO format, one line per box, `class_id x_center y_center width height`, normalised to [0, 1]. Empty string = no smoke. `data.yaml`: `nc: 1`, `names: ['smoke']`.
- Partner/camera values visible in the viewer preview include partners `adf`, `biobio`, `engie` and cameras `avinyonet-999`, `florida-180`, `salaunes-1-0`. The camera ids appear to encode a site + azimuth/pose (UNVERIFIED). The thanked partners are Force 06, SDIS 07, SDIS 12, SDIS 77.
- **Image size: not stated on the card.** Pyronear's own detectors are trained at 1024 px ([model card](https://huggingface.co/pyronear/yolo11s_rapid-raccoon_v8.1.0)). Read the actual sizes during the first data-validation step (Pandera check on width/height). UNVERIFIED.
- **Licence: Apache-2.0** (card metadata and text). This is the only fully commercial-clean smoke-box dataset we found.
- The HF dataset viewer currently fails ("Could not read the parquet files: timed out"), so inspect locally.

### 1.3 Download
```python
# whole dataset (~1.3 GB), pinned
from datasets import load_dataset
ds = load_dataset("pyronear/pyro-sdis", revision="v2.0")      # splits: "train", "val"
# metadata only, without decoding images:
ds = load_dataset("pyronear/pyro-sdis", revision="v2.0").remove_columns("image")
# raw parquet shards (better on a 7 GB-RAM laptop: stream one shard at a time)
from huggingface_hub import snapshot_download
p = snapshot_download("pyronear/pyro-sdis", repo_type="dataset", revision="v2.0",
                      allow_patterns=["data/val-*", "data.yaml", "README.md"])
```
The card notes the viewer's split dropdown shows "trainval" while the card describes "train" and "val", so check `ds.keys()`. The config in the README YAML defines `train` (`data/train-*`) and `val` (`data/val-*`).

During this research, downloads from HF to the dev machine ran very slowly (~20–30 KB/s, after HTTP/2 stream errors). **Do the full download inside Kaggle**, and locally pull only the 122 MB val shard (`curl --http1.1 -C -` resumes).

### 1.4 How the official split was made (and why we re-split)
- Pyronear's dataset builder "assigns stable train/val/test splits (80/10/10 per camera)" and keeps "recurring objects" in one split ([pyro-dataset README](https://github.com/pyronear/pyro-dataset)). That is **stratified per camera**, so the same camera (same background) appears in both train and val. Pyro-SDIS on HF is probably built the same way (UNVERIFIED).
- **Our re-split:** keep their `val` as an in-distribution check. Also carve a **camera-disjoint test set**: hold out ~15% of `camera` ids, stratified by `partner`, and take all of their images from both splits into `test_heldout_cameras`. Inside train, group by `(camera, date[:10])` so each fire day stays together.

## 2. FIgLib / HPWREN: temporal training and evaluation

Sources: [FIgLib page](https://www.hpwren.ucsd.edu/FIgLib/), [CDN index](https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data/index.html), [SmokeyNet paper](https://arxiv.org/abs/2112.08598).

### 2.1 Contents now (Nov 2026)
- The CDN index lists **528 image sequences** (the Tar directory says 529), from 2016-06-04 to 2026-11-09. By year: 2016: 14, 2017: 41, 2018: 66, 2019: 91, 2020: 92, 2021: 13, 2022: 23, 2023: 36, 2024: 69, 2025: 50, 2026: 33 (my count from the index).
- By imager suffix: 483 colour (`-c`), 26 monochrome (`-m`), the rest `iqeye`/other.
- ~342 unique `date_firename` prefixes. Many are generic `FIRE`, so one prefix can hide two fires on the same day, and one fire can span several folders/cameras (e.g. `20191006_FIRE` has 9 folders).
- The FIgLib page says "more than 500 sequences" and that the full archive is "more than 100 GB" as of November 2026.
- The 2022 paper version had 315 fires, 101 cameras, 30 stations, 24,800 images at **1536×2048 or 2048×3072**. Frames are "spaced approximately 60 s apart", **81 frames per sequence** (−40 to +40 min), and 114 fires are missing ~6.6 frames each.
- Top stations by sequence count: `om` 51, `rm` 45, `lp` 43, `hp` 32, `pi` 26, `wc` 24, `smer` 23, `sm` 23, `bh` 20, `bm` 16, `mg` 14.

### 2.2 Folder and file structure
- Sequence folder: `YYYYMMDD_FireName_camera`, e.g. `20170708_Whittier_syp-n-mobo-c` (Santa Ynez Peak, north-facing, colour).
- Browse: `https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data/{seq}/index.html`. Each folder holds an MP4 summary (e.g. "MP4 summary for 81 images") plus JPEGs.
- **File name = `{unix_epoch}_{offset_seconds_from_visible_plume:+06d}.jpg`**, e.g. `1499543863_-02400.jpg`, ..., `+00000` = first visible plume. This is the label: offset ≥ 0 means smoke present (per the human annotator who had full temporal context).
- Per-sequence archives: `https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data/Tar/{seq}.tgz`. Example: `20170708_Whittier_syp-n-mobo-c.tgz` is **97,335,553 bytes** (HTTP HEAD, served from S3). So budget ~100 MB per sequence and ~50 GB for all 528 (FIgLib page: >100 GB including extras).
- Extras:
  - Long-duration sequences: `Miscellaneous/HPWREN-FIgLib-LongDurations.tar`. These files are named by epoch only, so they are useful for fire-free negatives and FA/cam-day.
  - Motion vectors: `Miscellaneous/HPWREN-FIgLib-Motionvectors.tar`.

### 2.3 Labels
- **Sequence level:** the onset offset in every file name, which gives per-frame binary labels.
- **Bounding boxes:** "only a few fires" labelled with Jim Davidson's `labelem.py`, in CSV (`MinX,MinY,MaxX,MaxY,Filename`, absolute pixels) and VOC XML: [CSV index](https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data/Miscellaneous/Labels/HPWREN-BB/CSV/index.html), [VOC index](https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data/Miscellaneous/Labels/HPWREN-BB/VOC/index.html). The CSV index currently lists **9 sequences** (2016–2017), e.g. `20160604_FIRE_smer-tcs3-mobo-c.csv`, with the first row `1522,590,2190,906,../HPWREN-FIgLib/20160604_FIRE_smer-tcs3-mobo-c/1465068068_+02400.jpg`. Boxes are often copied backwards frame to frame by the tool, so they are coarse.
- SmokeyNet's **144 fires with boxes + contour masks** are not on the HPWREN CDN. They may live in the SmokeyNet GitLab (`gitlab.nrp-nautilus.io/anshumand/...`); not checked, UNVERIFIED.

### 2.4 Usage conditions (verbatim, [hpwren.ucsd.edu/cc.html](https://www.hpwren.ucsd.edu/cc.html), fetched 2026-11-21)

> **License**
> Archived HPWREN data (more than 24 hours old) is licensed under the Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) license. HPWREN data includes camera imagery, the Fire Ignition images Library (FIgLib), and meteorological and other sensor data. It is copyright © The Regents of the University of California.
> For non-commercial purposes, you may copy, redistribute and adapt the data, provided you credit HPWREN as described under Attribution. Non-commercial purposes include research, teaching, and training or evaluating machine-learning models.
>
> **Real-time data**
> Real-time data is HPWREN data less than 24 hours old. It includes live camera images, live sensor streams, and new data as it is collected. Data more than 24 hours old is archived data.
> Anyone may view real-time data on the HPWREN website. A license from the UC San Diego Office of Innovation and Commercialization is required to:
> - retrieve real-time data automatically, for example with scripts, scrapers, scheduled downloads of image or data URLs, or stream capture;
> - redistribute or rebroadcast real-time data, including embedding live images or streams in another website, app, or service;
> - use real-time data in a product or service, including running detection or analysis models on live feeds.
>
> This requirement applies to commercial and non-commercial users alike. HPWREN may waive it for academic research and teaching; to request a waiver, email feedback.
> Public-safety agencies may use real-time data for incident response and situational awareness without a license. Organizations that support HPWREN under an existing agreement use real-time data as that agreement provides.
> News organizations may show individual real-time images in coverage of a current event, with the credit line described under Attribution.
> The CC BY-NC license and the no-fee Commercial Use Permission below cover archived data only, including FIgLib.
>
> **Commercial Use**
> HPWREN wants its data to help detect and respond to wildfires, including through products built by companies. Instead of requiring a paid license up front, UC San Diego grants a no-fee Commercial Use Permission to organizations that agree to the following conditions.
> - Register. Before use, email fback@hpwren.ucsd.edu with: your organization's name and a contact person; a short description of the product; the HPWREN datasets you intend to use
> - Attribute. Credit HPWREN as described under Attribution. This applies to product documentation, publications, and any marketing that describes capabilities developed with HPWREN data.
> - Share back. Within 12 months of first use, or at product launch if that comes sooner, send HPWREN a short article (about 500–1,500 words). It should describe how you used HPWREN data and what you learned, and HPWREN may publish it on its website. Sharing evaluation results is welcome but not required.
> - Do not redistribute the data. The permission covers your own use of the data, including training, evaluating and validating models. You may not resell, sublicense or redistribute HPWREN data, or substantial portions of it, as a dataset; direct others to HPWREN instead. Models you train are yours. You may show a small number of example images in publications and documentation, with credit.
> - No endorsement. Do not state or imply that HPWREN or UC San Diego endorses your product.
> - Revisit at scale. You agree to contact the UC San Diego Office of Innovation and Commercialization to discuss in good faith a license that reflects that success if either of these happens: annual revenue from a product incorporating models or methods developed with HPWREN data exceeds $100,000; your organization is acquired
>
> This permission is non-exclusive and non-transferable. It may be withdrawn if these conditions are not met. Organizations that need a formal signed license may contact OIC directly.
>
> **Publishing results**
> Anyone, commercial or non-commercial, may publish results obtained with HPWREN data without prior approval. This includes benchmarks, detection latency, false-alarm rates and papers. Publications must credit HPWREN and include this statement: "HPWREN data are not intended to be used as a decision-making tool, or as a replacement for such tools." We appreciate receiving a copy or link.
>
> **Attribution**
> Minimum credit line: "Data courtesy of HPWREN, University of California San Diego (https://www.hpwren.ucsd.edu/)."
> If you use FIgLib, please also cite: Dewangan, A., et al. (2022). FIgLib & SmokeyNet: Dataset and Deep Learning Model for Real-Time Wildland Fire Smoke Detection. Remote Sensing, 14(4), 1007.
>
> **No warranty**
> HPWREN data is provided "as is" as a public service, without support or warranty.

The FIgLib page adds: "This data is provided as-is, no guarantees for anything is included", and asks users to report their use via the HPWREN feedback form.

### 2.5 Download strategy under our constraints
- **Local (33 GB free):** download only a **fixed evaluation subset** (~40 sequences ≈ 4 GB) with a resumable script (`curl -C -` per tgz). Optionally resize to 1536 px long side after extraction to cut size by ~4×.
- **Kaggle:** a notebook pulls the tgz files, resizes, and writes a **private** Kaggle dataset (never public, because of the no-redistribution condition). The license treats this as our own use, but "private" must stay private. Train there.
- Exclude by default: monochrome (`-m`) and `iqeye` sequences, night fires, and sequences whose onset frame is missing. Keep them as separate slices.

## 3. Other smoke datasets

| Dataset | Size and labels | Licence | Use for EmberWatch |
|---|---|---|---|
| **D-Fire** ([GitHub](https://github.com/gaia-solutions-on-demand/DFireDataset)) | 21,527 images: only fire 1,164 / only smoke 5,867 / fire+smoke 4,658 / **none 9,838**; 14,692 fire + 11,865 smoke boxes; YOLO format; pre-split train/val/test (OneDrive links + a [Kaggle mirror](https://www.kaggle.com/datasets/sayedgamal99/smoke-fire-detection-yolo)) | LICENSE file: collection released under **CC0 1.0**, but "Images whose filenames start with the prefix `PublicDataset`" (from HPWREN, FESB Croatia, FireNet) "remain subject to the terms of their original providers" | Negatives + extra smoke variety (mostly near-field CCTV, not long-range towers). **Drop `PublicDataset*` files** from anything shipped. |
| **pyronear/openfire** ([HF](https://huggingface.co/datasets/pyronear/openfire)) | 1K–10K web-scraped images, image classification (wildfire yes/no) | Apache-2.0 | Weak; maybe classifier pretraining. Low priority. |
| **PYRONEAR-2025** ([arXiv 2402.05349v3](https://arxiv.org/abs/2402.05349), [code](https://github.com/joseg20/wildfires2025), [Google Drive](https://drive.google.com/drive/folders/1-6NR3M9qBi7FTpEt0rhRQeEWD_33mBGH)) | ~150k annotations / 50k images / 640 fires (FR, ES, CL, US); image part 4,228 images (4,041 with fire), avg box 1.98% of the image; video part 80,727 frames (55,088 positive), 1,049 sequences, avg box 1.29%; sources include HPWREN + ALERTWildfire scrapes + synthetic | **No licence stated** for the data (the repo has no licence; the paper is CC BY 4.0). Built partly from HPWREN (CC BY-NC) and ALERTWildfire (CC BY-NC-ND) | **Evaluation only, non-commercial.** Best public cross-domain *video* benchmark. Licence UNVERIFIED, so ask the authors before any product use. |
| **Pyronear pyro-dataset** ([GitHub](https://github.com/pyronear/pyro-dataset)) | Sequential wildfire + FP sets (v4.x); test FP pinned to a private remote | Code repo has no licence; data behind DVC remotes that "need access" | Not available. Request access from Pyronear if useful. |
| **AI For Mankind HPWREN boxes** ([repo](https://github.com/aiformankind/wildfire-smoke-detection-camera), [research repo](https://github.com/aiformankind/wildfire-smoke-detection-research)) | v1.0: 744 HPWREN images (Pascal VOC, class "Smoke"); v2.0: 2,192 images (per search results); plus FP test sets **Fog** (181 images) and **Sunrise** (181 images) on Dropbox | Repo code MIT; the dataset is **CC BY-NC-SA 4.0** with credit to AI For Mankind and HPWREN, per the dataset page and the Roboflow mirror as reported by search (UNVERIFIED directly) | **Evaluation and hard-negative tests only** (Fog/Sunrise sets are ideal FP probes). ShareAlike makes training a shipped model on it risky. |
| **Nemo** ([GitHub](https://github.com/SayBender/Nemo), [paper](https://doi.org/10.3390/rs14163979)) | ALERTWildfire PTZ frames, COCO format; PYRONEAR-2025 counted 2,859 images, avg box 7.3% (zoomed PTZ) | Code Apache-2.0; the README still says "[ADD A URL ONCE DATASET IS PUBLIC]", so data availability is UNVERIFIED; underlying ALERTWildfire imagery is not commercially licensed | Skip: zoomed, large boxes, licence unclear. |
| **Fuego** (HPWREN-derived, 1,661 public of 8,500) | via the Nemo README Google Drive link | Unknown; HPWREN-derived (CC BY-NC) | Evaluation only. |
| **SKLFS-WildFire test** ([CCPE repo](https://github.com/WCUSTC/CCPE)) | "largest real-world test set" per the Pyronear survey | UNVERIFIED | Optional cross-domain test. |

## 4. Negative data for false-alarm metrics
1. FIgLib pre-ignition frames (`offset < 0`): same scenes, ~40 frames/sequence.
2. FIgLib **LongDurations** set (epoch-named; content not inspected): candidate fire-free hours.
3. **Archived HPWREN MTA frames > 24 h old** from fire-free days, chosen for weather variety (marine layer, Santa Ana dust, low cloud). Up to 90 days are retrievable from the viewer archive (04 §1). Needs the Commercial Use Permission for commercial use.
4. Pyro-SDIS v2.0's 1,634 empty images (real Pyronear false positives = hard negatives).
5. D-Fire "none" images (CC0, excluding `PublicDataset*`).
6. AI For Mankind Fog/Sunrise sets (evaluation only).

## 5. Leakage-free split recommendation

**Principle:** split by *physical event* and *camera view*, never by image. Consecutive frames are 30–60 s apart and nearly identical. The Govil et al. FIgLib result (acc 0.91) had test frames 10 min away from training frames of the same fire, versus 0.83 for SmokeyNet's event split ([arXiv 2112.08598](https://arxiv.org/abs/2112.08598), §7.3).

### FIgLib
1. Build `event_id`: parse `date` + `firename`. For generic `FIRE` names, group folders with the same date whose stations are within ~50 km of each other (station lat/lon from `sites.js`), and treat each group as one event.
2. Split **events** into train/val/test ≈ 60/15/25 (EARL used ~50/25/25 by event *and* camera). Stratify by year bucket (2016–19 / 2020–22 / 2023–26) and by station.
3. **Station holdout:** additionally reserve 2–3 entire stations (e.g. `syp`, `wilson`) for test only, so we can measure generalisation to unseen viewpoints.
4. All cameras of one event go to the same split. Monochrome and night sequences form a separate "hard slice", not train.
5. If we want to compare with SmokeyNet: also evaluate on its published test fire list (GitLab snippet 63) where those fires still exist in the CDN.

### Pyro-SDIS
1. `test_heldout_cameras`: ~15% of `camera` ids, stratified by `partner`, taken from train+val (all their images).
2. `val`: the official `val` minus the held-out cameras (in-distribution check).
3. `train`: the rest. Group by `(camera, date[:10])` for any internal CV folds.
4. Run a perceptual-hash (pHash, Hamming ≤ 6) dedup across splits (PYRONEAR-2025 did the same with imgdupes).

### Temporal (sequence) evaluation set
- Positive sequences: FIgLib test events (−40..+40 min) plus Pyro-SDIS held-out-camera smoke images grouped by camera + date (≤ 10 frames each; v2.0 subsampled them, so cadence is irregular).
- Negative sequences: FIgLib test pre-ignition windows, held-out-camera SDIS FP groups, and archived fire-free HPWREN days on test stations.
- Freeze the list in a lockfile (`splits/v1.json` with hashes), as Pyronear does with `sequential_test_lock.json` ([pyro-dataset](https://github.com/pyronear/pyro-dataset)).

### Metadata stats still to compute (first data task)
Per-camera image counts, positive/negative counts, box-size distribution and image resolution for Pyro-SDIS v2.0. A remote metadata read was started during this research but HF throughput was too slow to finish; the script is trivial: read the non-image parquet columns with `pyarrow` + `HfFileSystem`.

## Decisions this implies for EmberWatch

1. **Train the detector on Pyro-SDIS v2.0 pinned by tag `v2.0`** (Apache-2.0, 12,378 images, YOLO labels). Convert YOLO `cx,cy,w,h` (normalised) to absolute `yxyx` in the loader. Consider v1.0's extra 21k images only after dedup, since many are near-duplicates.
2. **FIgLib is the temporal and evaluation backbone** (528 sequences, per-frame onset labels in file names). Register for the HPWREN no-fee Commercial Use Permission **before** using it beyond research, keep it in private storage only, credit it, and plan the 500–1,500-word share-back article.
3. **Splits are event- and camera-grouped with a station/camera holdout,** frozen in a lockfile with a pHash dedup gate. This is a pipeline gate, not a one-off script.
4. **Negatives come from** FIgLib pre-ignition frames, archived fire-free HPWREN days, SDIS FP images, and D-Fire "none" (minus `PublicDataset*`).
5. **PYRONEAR-2025, AI For Mankind, Nemo and Fuego are evaluation-only** (licences NC/ND/unclear). Never ship weights trained on them unless the licence is clarified.
6. **Disk plan:** locally keep Pyro-SDIS val (122 MB) + a ~4 GB FIgLib test subset + negatives. Everything else lives in private Kaggle datasets.
