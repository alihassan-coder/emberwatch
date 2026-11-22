"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CameraFrame } from "@/components/frame/camera-frame";
import { FireFinder } from "./fire-finder";
import { ScoreSpark } from "./score-spark";
import { StateChip } from "./state-chip";
import { DEMO_ALERTS, DEMO_CAMERAS, cameraById } from "@/lib/demo-data";
import { STATE_TONE, ago, compass, coords, pct } from "@/lib/format";
import type { Alert, Camera } from "@/lib/types";

function CameraTile({ cam, selected, onSelect }: { cam: Camera; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group text-left outline-none focus-visible:ring-2 focus-visible:ring-suspect",
        "overflow-hidden rounded-sm bg-card ring-1 transition-[box-shadow]",
        selected ? "ring-paper/70" : cam.state === "clear" ? "ring-border" : STATE_TONE[cam.state].ring,
      )}
    >
      <div className="relative">
        <CameraFrame scene={cam.scene} plume={cam.plume} label={`${cam.name} camera frame`} />
        <StateChip state={cam.state} className="absolute left-2 top-2" />
        <span className="absolute right-2 top-2 rounded-full bg-ridge/70 px-2 py-0.5 text-xs text-contour">
          {cam.frameAgeSec} s
        </span>
      </div>
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-paper">{cam.name}</p>
          <p className="text-xs text-contour">Facing {compass(cam.azimuth)}</p>
        </div>
        <ScoreSpark values={cam.scoreHistory} className="hidden sm:block" />
        <span className={cn("w-10 text-right font-heading text-xl font-semibold", STATE_TONE[cam.state].text)}>
          {pct(cam.score)}
        </span>
      </div>
    </button>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const cams = alert.cameraIds.map(cameraById).filter(Boolean) as Camera[];
  const lead = cams[0];
  return (
    <article className="animate-alert rounded-xl bg-card p-4 ring-1 ring-suspect/40">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-xl font-semibold text-paper">
          {alert.cameraIds.length > 1 ? `Smoke seen by ${alert.cameraIds.length} cameras` : "Possible smoke"}
        </h3>
        <span className="text-xs text-contour">{ago(alert.firstAlertMinAgo)}</span>
      </div>
      {lead && (
        <div className="mt-3 overflow-hidden rounded-sm">
          <CameraFrame scene={lead.scene} plume={lead.plume} label={`${lead.name} at the time of the alert`} />
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-contour">Peak score</dt>
          <dd className="font-heading text-lg font-semibold text-suspect">{pct(alert.peakScore)}</dd>
        </div>
        <div>
          <dt className="text-contour">Cameras</dt>
          <dd className="text-paper">{cams.map((c) => c.station).join(", ")}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-contour">Location</dt>
          <dd className="text-paper">
            {alert.location ? coords(alert.location.lat, alert.location.lon) : "Needs a second camera to locate"}
          </dd>
        </div>
      </dl>
      <Button className="mt-4 w-full bg-suspect text-ridge hover:bg-suspect/85" render={<Link href={`/alerts?id=${alert.id}`} />}>
        Review alert
      </Button>
    </article>
  );
}

export function WatchConsole() {
  const [selectedId, setSelectedId] = useState(DEMO_CAMERAS[0].id);
  const [zoomToAlert, setZoomToAlert] = useState(true);
  const open = DEMO_ALERTS.filter((a) => a.status === "needs_review");
  const located = open.find((a) => a.location);
  const selected = DEMO_CAMERAS.find((c) => c.id === selectedId);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <header>
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">
            Watching {DEMO_CAMERAS.length} cameras
          </h1>
          <p className="mt-1 text-contour">
            {open.length === 0
              ? "No smoke in view. Frames arrive about once a minute."
              : `${open.length} ${open.length === 1 ? "alert needs" : "alerts need"} review. Frames arrive about once a minute.`}
          </p>
        </header>

        <section aria-label="Camera wall" className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {DEMO_CAMERAS.map((cam) => (
            <CameraTile key={cam.id} cam={cam} selected={cam.id === selectedId} onSelect={() => setSelectedId(cam.id)} />
          ))}
        </section>

        <section aria-labelledby="finder-title" className="rounded-xl bg-card bg-contours p-5 ring-1 ring-border">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="finder-title" className="font-heading text-2xl font-semibold text-paper">
              Fire finder
            </h2>
            {located && (
              <Button variant="outline" size="sm" onClick={() => setZoomToAlert((z) => !z)} aria-pressed={!zoomToAlert}>
                {zoomToAlert ? "Show all cameras" : `Zoom to alert ${located.id}`}
              </Button>
            )}
          </div>
          <p className="mt-1 text-sm text-contour">
            {located?.location
              ? `Bearings from ${located.cameraIds.length} cameras cross at ${coords(located.location.lat, located.location.lon)}.`
              : "Bearings appear when a camera sees smoke."}
          </p>
          <FireFinder
            cameras={DEMO_CAMERAS}
            alert={located}
            focus={zoomToAlert}
            selectedId={selectedId}
            onSelect={setSelectedId}
            className="mt-2"
          />
          {selected && (
            <p className="text-sm text-contour">
              Selected: <span className="text-paper">{selected.name}</span>, facing {compass(selected.azimuth)} with a{" "}
              {selected.fov}° view.
            </p>
          )}
        </section>
      </div>

      <aside aria-labelledby="queue-title" className="space-y-4">
        <h2 id="queue-title" className="font-heading text-2xl font-semibold text-paper">
          Needs review
        </h2>
        {open.length === 0 ? (
          <p className="rounded-xl bg-card p-4 text-sm text-contour ring-1 ring-border">
            Nothing to review. New alerts appear here first.
          </p>
        ) : (
          open.map((a) => <AlertCard key={a.id} alert={a} />)
        )}
      </aside>
    </div>
  );
}
