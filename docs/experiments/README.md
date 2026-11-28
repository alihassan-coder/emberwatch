# Experiments

One row per experiment. Each was run on Kaggle from a git commit (docs/decisions/0002), so the code that produced a number can always be checked out again. Full reports are written by the run itself (`report.md`, `metrics.json` in the Kaggle output).

All test numbers are on data the model never trained on: whole camera sites are held out, and near-duplicate photos are removed across splits (docs/decisions/0005).

## Results

| | Question | Data | Result | Decision |
|---|---|---|---|---|
| **E0** spike | Which model family can find smoke a few pixels wide, run on a CPU, and export to ONNX? | Pyro-SDIS v2.0 | KerasHub detectors and tile classifiers (EfficientNet-B0, MobileNetV3) built, trained briefly and exported. Detectors at 640 px lose most plumes (96% of boxes are under 1% of the image) | Tile classifier at full resolution: simpler, exports cleanly, fast on CPU |
| **E1** tile classifier | How good is a plain tile classifier? | Pyro-SDIS v2.0, 8,741 train photos, 7 held-out sites | Held-out sites: **F1 0.932** (P 0.952, R 0.913). ONNX 16.4 MB, 262 ms per 1280×720 photo on CPU | Ship as the first model (`e1-18c4671`) |
| **E1 time to detect** | Does it catch real fires quickly, somewhere new? | FIgLib, 89 Californian fires (evaluation only, non-commercial) | 62% caught, **37% within 10 min**, mean 10.7 min, **0.73 false alarms per camera-day** | Fails the targets: the model doesn't transfer to new landscapes and cameras |
| **E2** varied smoke | Can one model handle tower cameras *and* close-up, aerial and CCTV fire photos? | Pyro-SDIS + D-Fire (CC0, 21.5k photos incl. 9.8k fire-free look-alikes), starts from E1 | Running | Make active only if tower-camera F1 stays close to E1 |

## What we learned

- **E1 only knows distant plumes.** A close-up forest-fire photo with smoke filling half the picture scored 0.1%. Tiles at full resolution find small plumes but miss smoke that fills the frame, which motivated E2's whole-photo view and D-Fire data.
- **The frame threshold that maximises F1 (23%) is too trigger-happy for alerts.** Alerts use 50% and the 2-of-3 rule; the threshold for alerts should be tuned on time to detect, not frame F1.
- **Time to detect is the number that matters, and it's the weakest.** The next big step is a model that compares consecutive photos (smoke drifts and grows, clouds and fog behave differently).

## Next

- E3: temporal model over consecutive photos (targets: 90% of fires within 10 min, at most 0.5 false alarms per camera-day)
- Train with Californian sequences, so time to detect is no longer measured on a landscape the model has never seen
