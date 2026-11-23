"use client";

/*
  Replay store: the thin React adapter around the pure engine.

  One store per browser tab, living outside React, so the replay keeps its
  place when you move between Watch and Alerts. Components read it with
  useReplay(); the timer only runs while playing.
*/

import { useSyncExternalStore } from "react";
import { DEMO_MANIFEST } from "./demo";
import { buildTimeline, snapshotAt, type Reviews, type Snapshot, type Verdict } from "./engine";

const timeline = buildTimeline(DEMO_MANIFEST);
/** The fixed demo timeline, for views that need every step (heat strip, event log). */
export const TIMELINE = timeline;
const BASE_MS = 2500; // one frame every 2.5 s at 1x

type State = { step: number; playing: boolean; speed: 1 | 2 | 4; reviews: Reviews };

let state: State = { step: 0, playing: true, speed: 1, reviews: {} };
let snapshot: Snapshot = snapshotAt(timeline, 0, {});
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  snapshot = snapshotAt(timeline, state.step, state.reviews);
  syncTimer();
  listeners.forEach((l) => l());
}

function tick() {
  // Loop back to the start after the last frame, so a demo can run unattended.
  set({ step: state.step >= timeline.steps - 1 ? 0 : state.step + 1 });
}

function syncTimer() {
  const shouldRun = state.playing && listeners.size > 0;
  if (timer && !shouldRun) {
    clearInterval(timer);
    timer = null;
  } else if (shouldRun) {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, BASE_MS / state.speed);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) syncTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) syncTimer();
  };
}

/** First replay step at which any alert exists. */
const firstAlertStep = (() => {
  for (let s = 0; s < timeline.steps; s++) if (snapshotAt(timeline, s, {}).alerts.length) return s;
  return 0;
})();

// The server and the first client render show the opening frame, paused in time.
const serverSnapshot = snapshotAt(timeline, 0, {});

export const replay = {
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set({ playing: !state.playing }),
  setSpeed: (speed: State["speed"]) => set({ speed }),
  seek: (step: number) => set({ step, playing: false }),
  /** For pages that are empty without an alert: move the replay to the first one. */
  showFirstAlert: () => {
    if (snapshot.alerts.length === 0) set({ step: firstAlertStep, playing: true });
  },
  restart: () => set({ step: 0, reviews: {}, playing: true }),
  review: (alertId: string, verdict: Verdict | null) => {
    const reviews = { ...state.reviews };
    if (verdict) reviews[alertId] = verdict;
    else delete reviews[alertId];
    set({ reviews });
  },
};

export function useReplay() {
  const snap = useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
  const controls = useSyncExternalStore(subscribe, () => state, () => state);
  return {
    ...snap,
    playing: controls.playing,
    speed: controls.speed,
    reviews: controls.reviews,
    model: timeline.manifest.model,
    threshold: timeline.threshold,
    day: timeline.manifest.day,
  };
}
