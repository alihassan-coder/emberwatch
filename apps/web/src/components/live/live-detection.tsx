"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Mail, MessageSquareText, Pause, Play, RotateCcw, Webhook } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateChip } from "@/components/watch/state-chip";
import { ALERT_THRESHOLD } from "@/lib/replay/engine";
import { VIDEO, clockOf, videoMoments } from "@/lib/showcase";
import { STATE_TONE, compass, pct } from "@/lib/format";

const [W, H] = VIDEO.frame_size;
const moments = videoMoments(ALERT_THRESHOLD);

/** The overlays drawn on top of the playing video: hot-tile outlines and the person's smoke box. */
function Overlay({ index, showBox }: { index: number; showBox: boolean }) {
  const f = VIDEO.frames[index];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
      {f.tiles
        .filter((t) => t.p >= ALERT_THRESHOLD)
        .map((t, i) => (
          <rect key={i} x={t.x + 3} y={t.y + 3} width={t.size - 6} height={t.size - 6} rx="4"
            fill={t.p >= 0.85 ? "rgb(229 83 61 / 0.12)" : "rgb(240 166 58 / 0.1)"} stroke={t.p >= 0.85 ? "var(--fire)" : "var(--suspect)"} strokeWidth="3" />
        ))}
      {showBox &&
        f.boxes.map(([y1, x1, y2, x2], i) => (
          <rect key={`b${i}`} x={x1 - 5} y={y1 - 5} width={x2 - x1 + 10} height={y2 - y1 + 10} fill="none" stroke="var(--paper)" strokeWidth="2" strokeDasharray="5 4" />
        ))}
    </svg>
  );
}

/** Score of every frame as a bar chart, with the threshold, the two key moments and the playhead. */
function ScoreTimeline({ index, onSeek }: { index: number; onSeek: (i: number) => void }) {
  const n = VIDEO.frames.length;
  const x = (i: number) => (i / (n - 1)) * 100;
  return (
    <div className="space-y-2">
      <div className="relative h-24 rounded-sm bg-card ring-1 ring-border">
        <div className="absolute inset-x-0 border-t border-dashed border-contour/40" style={{ bottom: `${ALERT_THRESHOLD * 100}%` }} aria-hidden />
        <div className="absolute inset-0 flex items-end gap-px px-px">
          {VIDEO.frames.map((f) => (
            <button
              key={f.i}
              type="button"
              onClick={() => onSeek(f.i)}
              aria-label={`${clockOf(f.taken)}, score ${pct(f.score)}`}
              className="group relative h-full flex-1 outline-none focus-visible:ring-2 focus-visible:ring-suspect"
            >
              <span
                className={cn(
                  "absolute inset-x-0 bottom-0 rounded-t-[1px] transition-opacity",
                  f.score >= 0.85 ? "bg-fire" : f.score >= ALERT_THRESHOLD ? "bg-suspect" : "bg-clear/50",
                  f.i > index && "opacity-35",
                )}
                style={{ height: `${Math.max(3, f.score * 100)}%` }}
              />
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-paper" style={{ left: `${x(index)}%` }} aria-hidden />
      </div>
      <div className="relative h-10 text-xs">
        {moments.firstSmoke >= 0 && (
          <span className="absolute whitespace-nowrap text-paper" style={{ left: `${x(moments.firstSmoke)}%`, transform: `translateX(-${Math.min(50, x(moments.firstSmoke))}%)` }}>
            <span className="mx-auto mb-0.5 block h-2 w-px bg-paper" />
            Smoke first visible
          </span>
        )}
        {moments.alertAt >= 0 && (
          <span className="absolute translate-y-4 whitespace-nowrap font-medium text-suspect" style={{ left: `${x(moments.alertAt)}%` }}>
            <span className="mb-0.5 block h-2 w-px bg-suspect" />
            Alert raised
          </span>
        )}
      </div>
    </div>
  );
}

const DISPATCH = [
  { icon: MessageSquareText, who: "Duty officer", how: "SMS", delay: 2 },
  { icon: Mail, who: "Fire station 06", how: "Email with frames and map", delay: 4 },
  { icon: Webhook, who: "Dispatch system", how: "Webhook (JSON)", delay: 3 },
];

function AlertPipeline({ index }: { index: number }) {
  const raised = moments.alertAt >= 0 && index >= moments.alertAt;
  const f = VIDEO.frames[index];
  const alertClock = moments.alertAt >= 0 ? clockOf(VIDEO.frames[moments.alertAt].taken) : null;
  const steps = [
    { label: "Frame scored", done: true, detail: `${pct(f.score)} smoke, ${f.tiles.length} tiles checked` },
    { label: `Score above ${pct(ALERT_THRESHOLD)} in 2 of 3 frames`, done: raised, detail: raised ? "Rule passed" : "Waiting" },
    { label: "Alert raised", done: raised, detail: raised ? `At ${alertClock}` : "Not yet" },
  ];
  return (
    <div className="space-y-5">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.label} className="flex gap-3">
            <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", s.done ? "bg-primary text-primary-foreground" : "bg-muted text-contour")}>
              {i + 1}
            </span>
            <div>
              <p className={cn("text-sm", s.done ? "text-paper" : "text-contour")}>{s.label}</p>
              <p className="text-xs text-contour">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className={cn("rounded-xl p-4 ring-1 transition-colors", raised ? "bg-suspect/10 ring-suspect/50" : "bg-card ring-border")}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-heading text-xl font-semibold text-paper">
            <BellRing className={cn("size-5", raised ? "text-suspect" : "text-contour")} aria-hidden />
            {raised ? "Alert sent" : "No alert yet"}
          </p>
          <Badge variant="outline" className="text-contour">Simulated</Badge>
        </div>
        <ul className="mt-3 space-y-2">
          {DISPATCH.map(({ icon: Icon, who, how, delay }) => (
            <li key={who} className={cn("flex items-center gap-3 text-sm transition-opacity", raised ? "opacity-100" : "opacity-40")}>
              <Icon className="size-4 shrink-0 text-contour" aria-hidden />
              <span className="flex-1 text-paper">
                {who} <span className="text-contour">by {how.toLowerCase()}</span>
              </span>
              <span className="text-xs text-contour">{raised ? `+${delay} s` : "Queued"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function LiveDetection() {
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showBox, setShowBox] = useState(false);
  const f = VIDEO.frames[index];
  const state = f.score >= 0.85 ? "fire" : f.score >= ALERT_THRESHOLD ? "suspect" : "clear";

  // While playing, follow the video's clock frame by frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const follow = () => {
      const v = video.current;
      if (v) setIndex(Math.min(VIDEO.frames.length - 1, Math.floor(v.currentTime * VIDEO.fps)));
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (i: number) => {
    const v = video.current;
    if (v) v.currentTime = (i + 0.5) / VIDEO.fps;
    setIndex(i);
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <div className="relative overflow-hidden rounded-sm bg-ridge ring-1 ring-border">
          <video
            ref={video}
            src="/demo/showcase/video.mp4"
            muted
            playsInline
            preload="auto"
            className="block aspect-video w-full"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            aria-label={`Time-lapse from camera ${VIDEO.camera}`}
          />
          <Overlay index={index} showBox={showBox} />
          <StateChip state={state} className="absolute left-3 top-3" />
          <span className="absolute right-3 top-3 rounded-full bg-ridge/75 px-2.5 py-0.5 text-sm text-paper backdrop-blur-sm tabular-nums">
            {clockOf(f.taken)}
          </span>
          <span className={cn("absolute bottom-3 left-3 rounded-lg bg-ridge/75 px-3 py-1 font-heading text-3xl font-semibold backdrop-blur-sm", STATE_TONE[state].text)}>
            {pct(f.score)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={toggle}>
            {playing ? <Pause /> : <Play />}
            {playing ? "Pause" : index === 0 ? "Play the footage" : "Resume"}
          </Button>
          <Button variant="ghost" onClick={() => seek(0)}>
            <RotateCcw />
            Start over
          </Button>
          <Button variant="outline" onClick={() => setShowBox((s) => !s)} aria-pressed={showBox}>
            {showBox ? "Hide the person's smoke box" : "Show the person's smoke box"}
          </Button>
          <span className="ml-auto text-sm text-contour">
            1 second of video is about {Math.round((VIDEO.fps * VIDEO.seconds_per_frame_real) / 60)} minutes of real time
          </span>
        </div>

        <ScoreTimeline index={index} onSeek={seek} />
      </div>

      <aside className="space-y-6">
        <div>
          <p className="text-sm text-contour">Detected</p>
          <p className="font-heading text-6xl font-semibold leading-none text-paper">
            {moments.detectMinutes === null ? "n/a" : moments.detectMinutes < 1 ? "<1" : moments.detectMinutes.toFixed(0)}
            <span className="ml-2 text-2xl text-contour">min</span>
          </p>
          <p className="mt-2 text-sm text-contour">
            after smoke first became visible on {VIDEO.camera} ({VIDEO.site}, facing {compass(VIDEO.heading)}). A
            camera site the model never saw while training.
          </p>
        </div>
        <AlertPipeline index={index} />
      </aside>
    </div>
  );
}
