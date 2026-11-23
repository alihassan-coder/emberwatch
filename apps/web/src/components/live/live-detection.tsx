"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Mail, MessageSquareText, Pause, Play, RotateCcw, Webhook } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StateChip } from "@/components/watch/state-chip";
import { ALERT_THRESHOLD } from "@/lib/replay/engine";
import { clockOf, videoMoments, type Scenario, type ShowcaseVideo } from "@/lib/showcase";
import { STATE_TONE, pct } from "@/lib/format";

/**
 * Red outlines on the parts of the photo where the model sees smoke. With
 * `marked`, also a dashed ring around the smoke a person drew, so a viewer can
 * find smoke the model missed.
 */
function Overlay({ video, index, marked }: { video: ShowcaseVideo; index: number; marked: boolean }) {
  const [W, H] = video.frame_size;
  const f = video.frames[index];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
      {f.tiles
        .filter((t) => t.p >= ALERT_THRESHOLD)
        .map((t, i) => (
          <rect key={i} x={t.x + 3} y={t.y + 3} width={t.size - 6} height={t.size - 6} rx="4"
            fill="color-mix(in oklch, var(--fire) 10%, transparent)" stroke="var(--fire)" strokeWidth="3" />
        ))}
      {marked &&
        f.boxes.map(([y1, x1, y2, x2], i) => (
          <rect key={`m${i}`} x={x1 - 14} y={y1 - 14} width={x2 - x1 + 28} height={y2 - y1 + 28} rx="6"
            fill="none" stroke="white" strokeWidth="2.5" strokeDasharray="7 5" />
        ))}
    </svg>
  );
}

/** One bar per photo: taller means the model is more sure there is smoke. */
function Timeline({ video, alertAt, index, onSeek }: { video: ShowcaseVideo; alertAt: number; index: number; onSeek: (i: number) => void }) {
  const n = video.frames.length;
  const left = (i: number) => `${(i / (n - 1)) * 100}%`;
  return (
    <div>
      <div className="relative h-16">
        <div className="absolute inset-x-0 border-t border-dashed border-muted-foreground/40" style={{ bottom: `${ALERT_THRESHOLD * 100}%` }} aria-hidden />
        <div className="absolute inset-0 flex items-end gap-px">
          {video.frames.map((f) => (
            <button key={f.i} type="button" onClick={() => onSeek(f.i)} aria-label={`${f.phase === "lead" ? "Earlier photo" : `Photo at ${clockOf(f.taken)}`}: ${pct(f.score)} smoke`}
              className="relative h-full flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className={cn("absolute inset-x-0 bottom-0 rounded-t-[1px]", f.score >= ALERT_THRESHOLD ? "bg-fire" : "bg-clear/60", f.i > index && "opacity-30")}
                style={{ height: `${Math.max(4, f.score * 100)}%` }} />
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground" style={{ left: left(index) }} aria-hidden />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Each bar is one photo. Taller means more likely smoke. Click a bar to jump there.</span>
        {alertAt >= 0 ? (
          <span className="shrink-0 text-foreground">Alert at {clockOf(video.frames[alertAt].taken)}</span>
        ) : (
          <span className="shrink-0 text-foreground">No alert</span>
        )}
      </div>
    </div>
  );
}

const NOTIFY = [
  { icon: MessageSquareText, who: "Duty officer", how: "text message" },
  { icon: Mail, who: "Fire station", how: "email with photos and map" },
  { icon: Webhook, who: "Dispatch system", how: "automatic message" },
];

/** Plays one scenario. Give it a `key` per scenario so switching starts fresh. */
export function LiveDetection({ scenario }: { scenario: Scenario }) {
  const VIDEO = scenario.video;
  const moments = videoMoments(VIDEO, ALERT_THRESHOLD);
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const f = VIDEO.frames[index];
  const state = f.score >= 0.85 ? "fire" : f.score >= ALERT_THRESHOLD ? "suspect" : "clear";
  const alerted = moments.alertAt >= 0 && index >= moments.alertAt;
  // Reached the end with smoke on screen and no alert: the model missed it.
  const missed = moments.alertAt < 0 && moments.firstSmoke >= 0 && index === VIDEO.frames.length - 1;

  // While playing, follow the video's clock photo by photo.
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
  }, [playing, VIDEO]);

  const seek = (i: number) => {
    if (video.current) video.current.currentTime = (i + 0.5) / VIDEO.fps;
    setIndex(i);
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        <div className="relative overflow-hidden rounded-lg border bg-muted">
          <video ref={video} src={scenario.src} muted playsInline preload="auto" className="block aspect-video w-full"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            aria-label={`Time-lapse from tower camera ${VIDEO.camera}`} />
          <Overlay video={VIDEO} index={index} marked={moments.alertAt < 0} />
          <StateChip state={state} className="absolute left-3 top-3" />
          <span className="absolute right-3 top-3 rounded-md bg-background/80 px-2 py-0.5 text-sm tabular-nums backdrop-blur-sm">
            {/* lead-in photos are from other days: a clock time would jump backwards */}
            {f.phase === "lead" ? "Earlier photo" : clockOf(f.taken)}
          </span>
          {!playing && index === 0 && (
            <button type="button" onClick={toggle} className="absolute inset-0 grid place-items-center bg-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Play the footage">
              <span className="flex items-center gap-2 rounded-full bg-background px-5 py-3 text-sm font-medium shadow-sm">
                <Play className="size-4" /> Play the footage
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggle}>
            {playing ? <Pause /> : <Play />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => seek(0)}>
            <RotateCcw />
            Start over
          </Button>
        </div>
        <Timeline video={VIDEO} alertAt={moments.alertAt} index={index} onSeek={seek} />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Right now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className={cn("text-5xl font-semibold tabular-nums", STATE_TONE[state].text)}>{pct(f.score)}</p>
            <p className="text-sm text-muted-foreground">
              <Tooltip>
                <TooltipTrigger render={<span className="cursor-help underline decoration-dotted underline-offset-4" />}>
                  Smoke score
                </TooltipTrigger>
                <TooltipContent>How sure the model is that this photo shows smoke. Above 50% counts.</TooltipContent>
              </Tooltip>{" "}
              for this photo
            </p>
          </CardContent>
        </Card>

        <Card className={cn("transition-colors", alerted && "border-fire/50 bg-fire/5", missed && "border-dashed")}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BellRing className={cn("size-4", alerted ? "text-fire" : "text-muted-foreground")} />
              {alerted ? "Alert sent" : missed ? "Missed" : "No alert yet"}
            </CardTitle>
            <Badge variant="outline" className="text-muted-foreground">Demo</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {alerted
                ? `Smoke showed in 2 of the last 3 photos, ${moments.detectMinutes !== null && moments.detectMinutes < 1 ? "less than a minute" : `${moments.detectMinutes?.toFixed(0)} minutes`} after it first appeared.`
                : missed
                  ? "Smoke was there, but the model never scored it above 50% twice in a row, so no alert went out."
                  : "An alert goes out when smoke shows in 2 of the last 3 photos."}
            </p>
            <ul className="space-y-2">
              {NOTIFY.map(({ icon: Icon, who, how }) => (
                <li key={who} className={cn("flex items-center gap-3 text-sm transition-opacity", alerted ? "opacity-100" : "opacity-40")}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {who} <span className="text-muted-foreground">by {how}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
