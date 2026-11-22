/*
  What the Model page shows. Numbers come from the ML runs' report files
  (ml/artifacts/runs/*). A result stays `null` until a run has produced it;
  the page then says so instead of showing a made-up number.
*/

export type Metric = {
  name: string;
  explain: string;
  target: number;
  better: "higher" | "lower";
  unit: "%" | "min" | "per day" | "ms";
  value: number | null;
  reference?: string; // published result to compare with
};

export const MODEL_REPORT = {
  model: "E1 tile classifier (EfficientNet-B0), version 18c4671",
  status: "Trained for 29 minutes on a Kaggle T4 GPU",
  metrics: [
    {
      name: "Frames judged correctly",
      explain:
        "F1 on 2,070 frames from 7 camera sites the model never trained on. Precision 95%: of the frames it flags, 95% really show smoke. Recall 91%: it flags 91% of smoke frames.",
      target: 0.82,
      better: "higher",
      unit: "%",
      value: 0.932,
      reference: "SmokeyNet 82.6%",
    },
    {
      name: "Fires caught within 10 minutes",
      explain: "Share of 89 real test fires alerted within 10 minutes of the first visible smoke.",
      target: 0.9,
      better: "higher",
      unit: "%",
      value: null,
      reference: "Pano AI pilot 85%",
    },
    {
      name: "Average time to detect",
      explain: "Minutes from the first frame with visible smoke to the alert.",
      target: 3,
      better: "lower",
      unit: "min",
      value: null,
      reference: "SmokeyNet 3.1 min",
    },
    {
      name: "False alarms per camera",
      explain: "Alerts with no fire behind them, per camera per day of watching.",
      target: 0.5,
      better: "lower",
      unit: "per day",
      value: null,
    },
    {
      name: "Time per frame",
      explain: "Model time for one 1280×720 frame (24 tiles) on 4 CPU threads, with no GPU.",
      target: 1000,
      better: "lower",
      unit: "ms",
      value: 262,
    },
  ] satisfies Metric[],
  data: [
    { label: "Training frames", value: "8,741", detail: "Pyro-SDIS v2.0, Apache-2.0, 19 camera sites in France and Chile" },
    { label: "Held-out test frames", value: "2,070", detail: "7 whole camera sites (56 cameras) kept out of training" },
    { label: "Near-duplicates removed", value: "663", detail: "Frames too similar to a test frame, so scores aren't inflated" },
    { label: "Real fire sequences", value: "525", detail: "FIgLib, HPWREN cameras in Southern California, 2016–2026" },
    { label: "Test fires", value: "89", detail: "Split by fire event, plus 2 whole stations held out" },
  ],
  limits: [
    "Night frames: many tower cameras show almost nothing after dark.",
    "Monochrome and older cameras are tested separately and are not trained on yet.",
    "Very distant plumes: 5% of smoke boxes are under 6 pixels wide at 640 px.",
    "Trained on French and Chilean cameras; the California fire test measures how well that carries over.",
    "The frame threshold picked for the best F1 (23%) is trigger-happy for alerts, so alerts use a separate 50% threshold.",
  ],
};
