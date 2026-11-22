"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeOff } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RealFrame } from "@/components/frame/real-frame";
import { FireFinder, type FinderCamera } from "./fire-finder";
import { ScoreSpark } from "./score-spark";
import { StateChip } from "./state-chip";
import { CAMERA_FOV, type CameraView, type PlumeAlert } from "@/lib/replay/engine";
import { replay, useReplay } from "@/lib/replay/store";
import { STATE_TONE, compass, coords, pct, takenAt } from "@/lib/format";

export const toFinder = (cams: CameraView[]): FinderCamera[] =>
  cams.map((c) => ({ id: c.id, site: c.siteName, position: c.position, heading: c.heading, fov: CAMERA_FOV, state: c.state }));

function CameraTile({ cam, selected, onSelect, threshold }: { cam: CameraView; selected: boolean; onSelect: () => void; threshold: number }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group overflow-hidden rounded-sm bg-card text-left outline-none ring-1 transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-suspect",
        selected ? "ring-paper/70" : cam.state === "clear" ? "ring-border" : STATE_TONE[cam.state].ring,
      )}
    >
      <div className="relative">
        <RealFrame frame={cam.frame} showTiles={cam.state !== "clear"} subtle threshold={threshold} alt={`${cam.id} at ${takenAt(cam.frame.taken)}`} />
        <StateChip state={cam.state} className="absolute left-2 top-2" />
        <span className="absolute right-2 top-2 rounded-full bg-ridge/75 px-2 py-0.5 text-xs text-paper backdrop-blur-sm">
          {takenAt(cam.frame.taken)}
        </span>
        {cam.alerting && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-suspect" aria-hidden />}
      </div>
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-paper">
            {cam.id}
            {cam.unseenSite && (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex text-contour" />}>
                  <EyeOff className="size-3.5" aria-label="Site the model never trained on" />
                </TooltipTrigger>
                <TooltipContent>The model never saw this site while training</TooltipContent>
              </Tooltip>
            )}
          </p>
          <p className="truncate text-xs text-contour">
            {cam.siteName}, facing {compass(cam.heading)}
          </p>
        </div>
        <ScoreSpark values={cam.history} threshold={threshold} className="hidden sm:block" />
        <span className={cn("w-11 text-right font-heading text-xl font-semibold", STATE_TONE[cam.state].text)}>{pct(cam.score)}</span>
      </div>
    </button>
  );
}

function AlertCard({ alert, cameras }: { alert: PlumeAlert; cameras: CameraView[] }) {
  const lead = cameras.find((c) => c.id === alert.cameraIds[0]);
  const reviewed = alert.verdict !== null;
  return (
    <Card className={cn("gap-3 py-4", !reviewed && "animate-alert ring-suspect/40")}>
      <CardHeader className="px-4">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="font-heading text-xl font-semibold text-paper">
            {alert.cameraIds.length > 1 ? `Smoke seen by ${alert.cameraIds.length} cameras` : "Possible smoke"}
          </CardTitle>
          <span className="text-xs text-contour">{alert.id}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {lead && <RealFrame frame={lead.frame} showTiles subtle alt={`${lead.id} now`} className="rounded-sm" />}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-contour">Peak score</dt>
            <dd className="font-heading text-lg font-semibold text-suspect">{pct(alert.peakScore)}</dd>
          </div>
          <div>
            <dt className="text-contour">Cameras</dt>
            <dd className="text-paper">{alert.cameraIds.join(", ")}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-contour">Location</dt>
            <dd className="text-paper">{alert.location ? coords(alert.location.lat, alert.location.lon) : "Needs a second tower to locate"}</dd>
          </div>
        </dl>
        {reviewed ? (
          <Badge variant="secondary" className={alert.verdict?.status === "confirmed" ? "text-fire" : "text-contour"}>
            {alert.verdict?.status === "confirmed" ? "Confirmed fire" : `Not a fire${alert.verdict?.reason ? `: ${alert.verdict.reason.toLowerCase()}` : ""}`}
          </Badge>
        ) : (
          <Button className="w-full" nativeButton={false} render={<Link href={`/alerts?id=${alert.id}`} />}>
            Review alert
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function WatchConsole() {
  const r = useReplay();
  const [selectedId, setSelectedId] = useState(r.cameras[0]?.id);
  const [zoomToAlert, setZoomToAlert] = useState(true);
  const located = r.alerts.find((a) => a.location) ?? r.alerts[0];
  const smokeNow = r.cameras.filter((c) => c.state !== "clear").length;
  const selected = r.cameras.find((c) => c.id === selectedId);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <header>
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">Watching {r.cameras.length} cameras</h1>
          <p className="mt-1 text-contour">
            {smokeNow === 0 ? "No smoke in view." : `Smoke in view on ${smokeNow} ${smokeNow === 1 ? "camera" : "cameras"}.`}{" "}
            Alpes-Maritimes towers, real frames from 8 January 2024.
          </p>
        </header>

        <section aria-label="Camera wall" className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {r.cameras.map((cam) => (
            <CameraTile key={cam.id} cam={cam} selected={cam.id === selectedId} onSelect={() => setSelectedId(cam.id)} threshold={r.threshold} />
          ))}
        </section>

        <section aria-labelledby="finder-title" className="rounded-xl bg-card bg-contours p-5 ring-1 ring-border">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="finder-title" className="font-heading text-2xl font-semibold text-paper">Fire finder</h2>
            {located && (
              <Button variant="outline" size="sm" onClick={() => setZoomToAlert((z) => !z)} aria-pressed={!zoomToAlert}>
                {zoomToAlert ? "Show all towers" : `Zoom to ${located.id}`}
              </Button>
            )}
          </div>
          <p className="mt-1 text-sm text-contour">
            {located?.location
              ? `Bearings from ${located.cameraIds.length} cameras cross at ${coords(located.location.lat, located.location.lon)}.`
              : located
                ? "One tower sees this plume. A second tower is needed to place it."
                : "Bearings appear when a camera sees smoke."}
          </p>
          <FireFinder cameras={toFinder(r.cameras)} alert={located} focus={zoomToAlert} selectedId={selectedId} onSelect={setSelectedId} className="mt-2" />
          {selected && (
            <p className="text-sm text-contour">
              Selected: <span className="text-paper">{selected.id}</span> on {selected.siteName}, facing {compass(selected.heading)}.
            </p>
          )}
        </section>
      </div>

      <aside aria-labelledby="queue-title" className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 id="queue-title" className="font-heading text-2xl font-semibold text-paper">Needs review</h2>
          {r.needsReview > 0 && <Badge>{r.needsReview}</Badge>}
        </div>
        {r.alerts.length === 0 ? (
          <Card className="bg-contours py-5">
            <CardContent className="space-y-3 px-4">
              <p className="text-paper">No alerts yet.</p>
              <p className="text-sm text-contour">
                An alert is raised when a camera&apos;s smoke score passes {pct(r.threshold)} in 2 of 3 frames in a row.
              </p>
              <Button variant="outline" size="sm" onClick={() => replay.seek(3)}>
                Jump to the first alert
              </Button>
            </CardContent>
          </Card>
        ) : (
          r.alerts.map((a) => <AlertCard key={a.id} alert={a} cameras={r.cameras} />)
        )}
      </aside>
    </div>
  );
}
