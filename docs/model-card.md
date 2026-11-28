# Model card: EmberWatch smoke classifier

## What it is

A Keras 3 EfficientNet-B0 image classifier (4 million parameters) that answers one question for a 224×224 view of a photo: *is there smoke or fire here?* A camera photo is cut into overlapping tiles at full resolution and every tile is scored. From E2 on, the whole photo squeezed to 224×224 is scored too. The photo's score is the highest of these.

It is served as a 16 MB ONNX file by the API (ONNX Runtime, CPU). Each version lives in `apps/api/models/versions/<version>/` with a SHA-256 checksum that is checked at start-up.

| Version | Experiment | Trained on | Status |
|---|---|---|---|
| `e1-18c4671` | E1 | Pyro-SDIS v2.0 tower-camera photos | Active |
| E2 | E2 | Pyro-SDIS + D-Fire, starting from E1 | Training |

## Intended use

- **For:** helping a person watch many fire-lookout cameras. The model flags photos and the alert rule (smoke in 2 of the last 3 photos) decides when to tell the duty officer. **A person confirms every alert** before the fire service is called.
- **Not for:** deciding on its own to dispatch firefighters, or as the only way a fire is reported. It is a portfolio project and has not been validated in the field.

## Data

| Dataset | Used for | Licence |
|---|---|---|
| [Pyro-SDIS v2.0](https://huggingface.co/datasets/pyronear/pyro-sdis) (Pyronear and the French SDIS fire services) | Training and testing | Apache-2.0 |
| [D-Fire](https://github.com/gaiasd/DFireDataset) (Gaia, solutions on demand) | E2 training and testing | CC0 1.0 |
| [FIgLib](https://www.hpwren.ucsd.edu/FIgLib/) (HPWREN, UC San Diego) | Evaluation only: time to detect on real Californian fires | Non-commercial; not redistributed |

Test sets are never seen in training. Pyro-SDIS holds out 7 whole camera sites (56 cameras) and removes 663 near-duplicate photos across splits, so a camera's view can't leak from training into testing.

## How well it works (E1)

| Test | Result | Target |
|---|---|---|
| Photos judged correctly, 7 unseen French sites (2,070 photos) | F1 0.932 (precision 0.952, recall 0.913) | ≥ 0.82 |
| Real Californian fires caught within 10 minutes (89 fires) | 37% (62% caught at all) | ≥ 90% |
| Mean time to detect, from first visible smoke | 10.7 min (median 8) | ≤ 3 min |
| False alarms per camera per day | 0.73 | ≤ 0.5 |
| Time per 1280×720 photo, 4 CPU threads | 262 ms | ≤ 1 s |

## Known weaknesses

- **New landscapes and cameras.** Trained in France, it is much weaker on Californian cameras (above).
- **Smoke that fills the picture.** E1 scored a close-up forest-fire photo at 0.1%: it only learned distant plumes. E2 targets this.
- **Faint, distant plumes a few pixels wide.** Shown honestly on the home page ("Faint, far-away smoke").
- **Night.** Many tower cameras see almost nothing after dark.
- **Look-alikes.** Low cloud, fog, dust and sun glare. E1 ignored all 8 look-alikes in the "Try to fool it" gallery, but that is a small sample.
- **Thresholds.** The photo threshold that maximises F1 (23%) raises too many alerts, so alerts use 50% plus the 2-of-3 rule.

## Ethics and safety

- Missing a fire is worse than a false alarm, but too many false alarms train people to ignore alerts. Both are measured and reported.
- Camera photos can show people and property. The demo uses public research datasets only.
