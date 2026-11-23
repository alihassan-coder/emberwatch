"use client";

/*
  The Cameras page as a control room:
    spotlight  - one camera large, following the action unless you pin one
    strip      - all towers at a glance; click to pin
    heat strip - every camera x every photo, so you can watch smoke spread
    map        - view cones, bearings to the smoke, where they cross
    events     - what happened, newest first
*/

import Link from "next/link";
import { useMemo, useState } from "react";
import { BellRing, Crosshair, EyeOff, MapPin, MessageSquareText, Pin, PinOff, ScanSearch, Sun } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RealFrame } from "@/components/frame/real-frame";
import { FireFinder, type FinderCamera } from "./fire-finder";
import { ScoreSpark } from "./score-spark";
import { StateChip } from "./state-chip";
import { CAMERA_FOV, type CameraView, type PlumeAlert } from "@/lib/replay/engine";
import { eventsUntil, type ReplayEvent } from "@/lib/replay/events";
import { TIMELINE, replay, useReplay } from "@/lib/replay/store";
import { ReplayControls } from "@/components/replay/replay-controls";
import { STATE_TONE, compass, coords, pct, takenAt } from "@/lib/format";

export const toFinder = (cams: CameraView[]): FinderCamera[] =>
  cams.map((c) => ({ id: c.id, site: c.siteName, position: c.position, heading: c.heading, fov: CAMERA_FOV, state: c.state }));

/**
 * Who the spotlight follows: the smokiest camera right now, preferring
 * cameras in an open alert. Ties go to the camera that joined most recently,
 * so the view moves along with the plume instead of flickering.
 */
function followed(cameras: CameraView[], alerts: PlumeAlert[], threshold: number): CameraView {
  const inAlert = alerts.filter((a) => !a.verdict).flatMap((a) => a.cameraIds);
  const rank = (c: CameraView) =>
    Math.round(c.score * 50) / 50 + (inAlert.includes(c.id) ? 1 : 0) + inAlert.lastIndexOf(c.id) * 1e-3;
  const best = cameras.reduce((a, b) => (rank(b) > rank(a) ? b : a), cameras[0]);
  return best.score >= threshold || inAlert.length ? best : cameras[0];
}

function Spotlight({ cam, pinned, onUnpin, threshold }: { cam: CameraView; pinned: boolean; onUnpin: () => void; threshold: number }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="relative">
        <RealFrame frame={cam.frame} showTiles={cam.state !== "clear"} subtle threshold={threshold} priority
          alt={`${cam.id} at ${takenAt(cam.frame.taken)}`} />
        {/* One sweep per new photo: the model checking every tile. Keyed on the photo so it replays. */}
        <span key={cam.frame.file} className="animate-scan pointer-events-none absolute inset-y-0 w-1/4" aria-hidden />
        <StateChip state={cam.state} className="absolute left-3 top-3" />
        <span className="absolute right-3 top-3 rounded-md bg-background/80 px-2 py-0.5 text-sm tabular-nums backdrop-blur-sm">
          {takenAt(cam.frame.taken)}
        </span>
        {cam.alerting && (
          <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-fire px-2 py-1 text-xs font-medium text-white">
            <BellRing className="size-3.5" aria-hidden /> In an alert
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">
            {cam.id}
            {cam.unseenSite && (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex text-muted-foreground" />}>
                  <EyeOff className="size-3.5" aria-label="Site the model never trained on" />
                </TooltipTrigger>
                <TooltipContent>The model never saw this site while training</TooltipContent>
              </Tooltip>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {cam.siteName}, facing {compass(cam.heading)}.{" "}
            {pinned ? (
              <button type="button" onClick={onUnpin} className="inline-flex items-center gap-1 text-foreground underline underline-offset-4">
                <PinOff className="size-3.5" aria-hidden /> Follow the action
              </button>
            ) : (
              <span className="inline-flex items-center gap-1"><Crosshair className="size-3.5" aria-hidden /> Following the action</span>
            )}
          </p>
        </div>
        <ScoreSpark values={cam.history} threshold={threshold} className="h-10 w-40" />
        <div className="text-right">
          <p className={cn("text-4xl font-semibold tabular-nums", STATE_TONE[cam.state].text)}>{pct(cam.score)}</p>
          <p className="text-xs text-muted-foreground">smoke score</p>
        </div>
      </div>
    </Card>
  );
}

function CameraStrip({ cameras, shownId, pinnedId, onPick, threshold }: {
  cameras: CameraView[]; shownId: string; pinnedId: string | null; onPick: (id: string) => void; threshold: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="All cameras">
      {cameras.map((cam) => (
        <li key={cam.id}>
          <button type="button" onClick={() => onPick(cam.id)} aria-pressed={cam.id === shownId}
            className={cn("w-full overflow-hidden rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              cam.id === shownId ? "border-foreground" : cam.state !== "clear" ? "border-fire/50" : "hover:bg-accent")}>
            <div className="relative">
              <RealFrame frame={cam.frame} showTiles={cam.state !== "clear"} subtle threshold={threshold} alt="" />
              {cam.id === pinnedId && <Pin className="absolute right-1.5 top-1.5 size-3.5 text-white drop-shadow" aria-label="Pinned" />}
            </div>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className={cn("size-1.5 shrink-0 rounded-full", STATE_TONE[cam.state].dot)} aria-hidden />
                <span className="truncate">{cam.id}</span>
              </span>
              <span className={cn("text-xs font-semibold tabular-nums", STATE_TONE[cam.state].text)}>{pct(cam.score)}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Every camera x every photo. The cursor is "now"; anything right of it hasn't happened yet. */
function HeatStrip({ step, threshold }: { step: number; threshold: number }) {
  const cams = TIMELINE.manifest.cameras;
  const color = (p: number) =>
    p >= 0.85 ? "bg-fire" : p >= threshold ? "bg-suspect" : p >= 0.25 ? "bg-clear/40" : "bg-muted";
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">Smoke across all cameras</CardTitle>
        <p className="text-xs text-muted-foreground">Each square is one photo. Watch the smoke spread from tower to tower. Click to jump there.</p>
      </CardHeader>
      <CardContent className="px-4">
        <div className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-1">
          {cams.map((cam) => (
            <div key={cam.id} className="contents">
              <span className="truncate text-xs text-muted-foreground">{cam.id}</span>
              <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${TIMELINE.steps}, minmax(0, 1fr))` }}>
                {cam.frames.map((f, i) => {
                  const p = f.score ?? 0;
                  return (
                    <button key={i} type="button" onClick={() => replay.seek(i)}
                      aria-label={`${cam.id}, photo ${i + 1}: ${pct(p)}`}
                      className={cn("h-4 rounded-[3px] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring",
                        color(p), i > step && "opacity-20", i === step && "ring-2 ring-foreground")} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-muted" />Clear</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-suspect" />Possible smoke</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-fire" />Smoke</span>
        </div>
      </CardContent>
    </Card>
  );
}

const EVENT_ICON: Record<ReplayEvent["kind"], typeof BellRing> = {
  smoke: ScanSearch, alert: BellRing, join: Crosshair, located: MapPin, notify: MessageSquareText, clear: Sun,
};

function EventLog({ events, onCamera }: { events: ReplayEvent[]; onCamera: (id: string) => void }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">What happened</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {events.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">All quiet. Events show up here as the cameras report.</p>
        ) : (
          <ScrollArea className="h-72 px-4">
            <ol className="space-y-3" aria-live="polite">
              {events.map((e, i) => {
                const Icon = EVENT_ICON[e.kind];
                const loud = e.kind === "alert" || e.kind === "located";
                return (
                  <li key={e.key} className={cn("flex gap-3 text-sm", i === 0 && "animate-in fade-in slide-in-from-top-1")}>
                    <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
                      loud ? "border-fire/40 bg-fire/10 text-fire" : "text-muted-foreground")}>
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn(loud && "font-medium")}>
                        {e.cameraId && e.kind !== "alert" ? (
                          <button type="button" onClick={() => onCamera(e.cameraId!)} className="text-left hover:underline">{e.text}</button>
                        ) : e.text}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Photo {e.step + 1}, {e.time}
                        {e.alertId && e.kind === "alert" && (
                          <> · <Link href={`/alerts?id=${e.alertId}`} className="text-foreground underline underline-offset-4">Review</Link></>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function OpenAlerts({ alerts }: { alerts: PlumeAlert[] }) {
  const open = alerts.filter((a) => !a.verdict);
  if (open.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Alerts that need review">
      {open.map((a) => (
        <li key={a.id} className="animate-alert flex items-center gap-3 rounded-lg border border-fire/40 bg-fire/5 p-3">
          <BellRing className="size-4 shrink-0 text-fire" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {a.id}: {a.cameraIds.length > 1 ? `seen by ${a.cameraIds.length} cameras` : `seen by ${a.cameraIds[0]}`}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {a.location ? coords(a.location.lat, a.location.lon) : "Needs a second tower to locate"}
            </p>
          </div>
          <Button size="sm" nativeButton={false} render={<Link href={`/alerts?id=${a.id}`} />}>Review</Button>
        </li>
      ))}
    </ul>
  );
}

export function WatchConsole() {
  const r = useReplay();
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const events = useMemo(() => eventsUntil(TIMELINE, r.step, r.reviews), [r.step, r.reviews]);

  const shown = r.cameras.find((c) => c.id === pinnedId) ?? followed(r.cameras, r.alerts, r.threshold);
  const located = r.alerts.find((a) => a.location) ?? r.alerts[0];
  const smokeNow = r.cameras.filter((c) => c.state !== "clear").length;
  const open = r.alerts.filter((a) => !a.verdict).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Cameras</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>Six real towers in the Alpes-Maritimes, 8 January 2024</span>
            <Badge variant="outline" className={cn(smokeNow > 0 && "border-fire/40 text-fire")}>
              {smokeNow === 0 ? "No smoke in view" : `Smoke on ${smokeNow} of ${r.cameras.length}`}
            </Badge>
            {open > 0 && <Badge className="bg-fire text-white">{open} to review</Badge>}
          </p>
        </div>
        <ReplayControls />
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Spotlight cam={shown} pinned={pinnedId !== null} onUnpin={() => setPinnedId(null)} threshold={r.threshold} />
          <CameraStrip cameras={r.cameras} shownId={shown.id} pinnedId={pinnedId} threshold={r.threshold}
            onPick={(id) => setPinnedId((p) => (p === id ? null : id))} />
          <HeatStrip step={r.step} threshold={r.threshold} />
        </div>

        <aside className="space-y-4">
          <OpenAlerts alerts={r.alerts} />
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">Fire finder</CardTitle>
              <p className="text-xs text-muted-foreground">
                {located?.location
                  ? `Bearings from ${located.cameraIds.length} cameras cross at ${coords(located.location.lat, located.location.lon)}.`
                  : located
                    ? "One tower sees the plume. A second tower is needed to place it."
                    : "Each tower's view. Bearings appear when a camera sees smoke."}
              </p>
            </CardHeader>
            <CardContent className="px-2">
              <FireFinder cameras={toFinder(r.cameras)} alert={located} focus={!!located?.location}
                selectedId={shown.id} onSelect={(id) => setPinnedId(id)} />
            </CardContent>
          </Card>
          <EventLog events={events} onCamera={(id) => setPinnedId(id)} />
          {r.alerts.length === 0 && (
            <Button variant="outline" className="w-full" onClick={replay.showFirstAlert}>Skip ahead to the first alert</Button>
          )}
        </aside>
      </div>
    </div>
  );
}
