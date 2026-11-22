"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RealFrame } from "@/components/frame/real-frame";
import { FireFinder } from "@/components/watch/fire-finder";
import { toFinder } from "@/components/watch/watch-console";
import type { CameraView, PlumeAlert, Verdict } from "@/lib/replay/engine";
import { replay, useReplay } from "@/lib/replay/store";
import { compass, coords, pct, takenAt } from "@/lib/format";
import { framesOf } from "@/lib/replay/demo";

const REASONS = ["Low cloud", "Fog", "Dust", "Sun glare", "Something else"];

function verdictLabel(v: Verdict) {
  return v.status === "confirmed" ? "Confirmed fire" : `Not a fire${v.reason ? `: ${v.reason.toLowerCase()}` : ""}`;
}

function Filmstrip({ cameraId, upTo, picked, onPick, threshold }: { cameraId: string; upTo: number; picked: number; onPick: (i: number) => void; threshold: number }) {
  const frames = framesOf(cameraId).slice(0, upTo + 1);
  return (
    <ol className="grid grid-cols-6 gap-1.5 lg:grid-cols-12" aria-label={`${cameraId} frames so far`}>
      {frames.map((f, i) => {
        const s = f.score ?? 0;
        return (
          <li key={f.file}>
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-pressed={i === picked}
              aria-label={`${takenAt(f.taken)}, score ${pct(s)}`}
              className={cn("block w-full rounded-sm text-left outline-none ring-1 focus-visible:ring-2 focus-visible:ring-suspect", i === picked ? "ring-paper" : "ring-transparent hover:ring-border")}
            >
              <RealFrame frame={f} alt="" className="rounded-t-sm" />
              <div className="flex h-8 items-end px-1 pt-1">
                <div className={cn("w-full rounded-t-[2px]", s >= 0.85 ? "bg-fire" : s >= threshold ? "bg-suspect" : "bg-clear/60")} style={{ height: `${Math.max(8, s * 100)}%` }} />
              </div>
              <span className="block px-1 pb-1 text-center text-xs text-contour">
                {f.phase === "before" ? "Earlier" : takenAt(f.taken)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function DecisionPanel({ alert }: { alert: PlumeAlert }) {
  const [choosingReason, setChoosingReason] = useState(false);
  const decide = (v: Verdict | null) => {
    replay.review(alert.id, v);
    setChoosingReason(false);
    if (v) {
      toast.success(`${alert.id}: ${verdictLabel(v)}`, {
        description:
          v.status === "confirmed"
            ? alert.location
              ? `Location ${coords(alert.location.lat, alert.location.lon)} is ready for dispatch.`
              : "No location yet: only one tower sees it."
            : "These frames go into the next training round as examples of what smoke is not.",
        action: { label: "Undo", onClick: () => replay.review(alert.id, null) },
      });
    }
  };

  if (alert.verdict) {
    const fire = alert.verdict.status === "confirmed";
    return (
      <div className={cn("rounded-xl p-4 ring-1", fire ? "bg-fire/10 ring-fire/40" : "bg-secondary ring-border")}>
        <p className={cn("font-heading text-2xl font-semibold", fire ? "text-fire" : "text-paper")}>{verdictLabel(alert.verdict)}</p>
        <Button variant="ghost" className="mt-3" onClick={() => decide(null)}>
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-suspect/40">
      <p className="font-heading text-2xl font-semibold text-paper">Is this a fire?</p>
      {!choosingReason ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="bg-fire text-paper hover:bg-fire/85" onClick={() => decide({ status: "confirmed" })}>
            Confirm fire
          </Button>
          <Button variant="outline" onClick={() => setChoosingReason(true)}>
            Not a fire
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-contour">What did the camera see instead?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {REASONS.map((reason) => (
              <Button key={reason} variant="outline" size="sm" className="rounded-full" onClick={() => decide({ status: "dismissed", reason })}>
                {reason}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setChoosingReason(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertDetail({ alert, cameras, step, threshold }: { alert: PlumeAlert; cameras: CameraView[]; step: number; threshold: number }) {
  const cams = alert.cameraIds.map((id) => cameras.find((c) => c.id === id)).filter((c): c is CameraView => !!c);
  const lead = cams[0];
  const [picked, setPicked] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<"tiles" | "boxes" | "none">("tiles");
  const index = picked ?? step;

  return (
    <article className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">
            {cams.length > 1 ? `Smoke seen by ${cams.length} cameras` : "Possible smoke on one camera"}
          </h1>
          <p className="mt-1 text-contour">
            Alert {alert.id}, raised at frame {alert.raisedAtStep + 1}. Peak score {pct(alert.peakScore)}.
          </p>
        </div>
        <Tabs value={overlay} onValueChange={(v) => setOverlay(v as typeof overlay)}>
          <TabsList>
            <TabsTrigger value="tiles">Model tiles</TabsTrigger>
            <TabsTrigger value="boxes">Person&apos;s box</TabsTrigger>
            <TabsTrigger value="none">Clean</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div className={cn("grid gap-3", cams.length > 1 && "md:grid-cols-2")}>
            {cams.map((cam) => {
              const frames = framesOf(cam.id);
              const f = frames[Math.min(index, frames.length - 1)];
              return (
                <figure key={cam.id} className="overflow-hidden rounded-sm bg-card ring-1 ring-border">
                  <RealFrame frame={f} showTiles={overlay === "tiles"} showBoxes={overlay === "boxes"} alt={`${cam.id} at ${takenAt(f.taken)}`} priority />
                  <figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="truncate text-paper">
                      {cam.id}{" "}
                      <span className="text-contour">{f.phase === "before" ? `earlier, ${f.taken.slice(0, 10)}` : takenAt(f.taken)}</span>
                    </span>
                    <span className="whitespace-nowrap text-contour">
                      {pct(f.score ?? 0)}, bearing {compass(alert.bearings[cam.id])}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </div>

          {lead && (
            <section aria-labelledby="film-title">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 id="film-title" className="text-sm text-contour">
                  {lead.id}, every frame so far. Pick one to compare.
                </h2>
                {picked !== null && (
                  <Button variant="ghost" size="xs" onClick={() => setPicked(null)}>
                    Follow the replay
                  </Button>
                )}
              </div>
              <Filmstrip cameraId={lead.id} upTo={step} picked={index} onPick={setPicked} threshold={threshold} />
            </section>
          )}

          <section aria-labelledby="map-title" className="rounded-xl bg-card bg-contours p-5 ring-1 ring-border">
            <h2 id="map-title" className="font-heading text-2xl font-semibold text-paper">Fire finder</h2>
            <FireFinder cameras={toFinder(cameras)} alert={alert} focus />
          </section>
        </div>

        <div className="space-y-4">
          <DecisionPanel alert={alert} />
          <dl className="space-y-3 rounded-xl bg-card p-4 text-sm ring-1 ring-border">
            {cams.map((cam) => (
              <div key={cam.id} className="flex justify-between gap-4">
                <dt className="text-contour">{cam.id}</dt>
                <dd className="text-paper">Bearing {compass(alert.bearings[cam.id])}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-contour">Location</dt>
              <dd className="text-right text-paper">{alert.location ? coords(alert.location.lat, alert.location.lon) : "Needs a second tower"}</dd>
            </div>
          </dl>
          <Alert>
            <Info aria-hidden />
            <AlertTitle>How the location is found</AlertTitle>
            <AlertDescription>
              Each camera&apos;s bearing is its heading plus where the smoke sits in the frame. Tower positions are
              approximate, so treat the estimate as a search area, not a point.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </article>
  );
}

export function AlertReview() {
  const r = useReplay();
  const params = useSearchParams();
  const [tab, setTab] = useState<"open" | "reviewed">("open");
  const [openId, setOpenId] = useState<string | null>(params.get("id"));

  const list = r.alerts.filter((a) => (tab === "open" ? !a.verdict : a.verdict));
  const alert = r.alerts.find((a) => a.id === openId) ?? list[0] ?? r.alerts[0];

  if (r.alerts.length === 0) {
    return (
      <div className="max-w-xl space-y-4 rounded-xl bg-card bg-contours p-6 ring-1 ring-border">
        <h1 className="font-heading text-3xl font-semibold text-paper">No alerts yet</h1>
        <p className="text-contour">
          The replay is at {r.clock}. Alerts appear here as soon as a camera sees smoke in 2 of 3 frames.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => replay.seek(3)} className="bg-suspect text-ridge hover:bg-suspect/85">
            Jump to the first alert
          </Button>
          <Button variant="outline" render={<Link href="/" />}>
            Back to Watch
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Alerts" className="space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="open">
              Needs review <Badge variant="secondary" className="ml-1">{r.needsReview}</Badge>
            </TabsTrigger>
            <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
          </TabsList>
        </Tabs>
        {list.length === 0 && (
          <p className="px-3 text-sm text-contour">{tab === "open" ? "Everything is reviewed." : "Nothing reviewed yet."}</p>
        )}
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpenId(a.id)}
            aria-current={a.id === alert?.id ? "true" : undefined}
            className={cn("w-full rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-suspect", a.id === alert?.id ? "bg-secondary" : "hover:bg-secondary/60")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-paper">{a.id}</span>
              <span className={cn("text-xs", !a.verdict ? "text-suspect" : a.verdict.status === "confirmed" ? "text-fire" : "text-contour")}>
                {a.verdict ? verdictLabel(a.verdict) : "Needs review"}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-contour">
              {a.cameraIds.length} {a.cameraIds.length === 1 ? "camera" : "cameras"}, peak {pct(a.peakScore)}
            </p>
          </button>
        ))}
      </nav>
      {alert && <AlertDetail key={alert.id} alert={alert} cameras={r.cameras} step={r.step} threshold={r.threshold} />}
    </div>
  );
}
