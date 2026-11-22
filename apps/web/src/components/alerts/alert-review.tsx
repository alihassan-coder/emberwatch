"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CameraFrame, demoTiles } from "@/components/frame/camera-frame";
import { FireFinder } from "@/components/watch/fire-finder";
import { DEMO_ALERTS, DEMO_CAMERAS, cameraById } from "@/lib/demo-data";
import { ago, compass, coords, pct } from "@/lib/format";
import type { Alert, AlertStatus, Camera } from "@/lib/types";

const REASONS = ["Low cloud", "Fog", "Dust", "Sun glare", "Something else"];

const STATUS_LABEL: Record<AlertStatus, string> = {
  needs_review: "Needs review",
  confirmed: "Confirmed fire",
  dismissed: "Not a fire",
};

type Decision = { status: AlertStatus; reason?: string };

function AlertListItem({ alert, status, active, onOpen }: { alert: Alert; status: AlertStatus; active: boolean; onOpen: () => void }) {
  const stations = alert.cameraIds.map((id) => cameraById(id)?.station ?? id).join(", ");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-suspect",
        active ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-paper">{alert.id}</span>
        <span
          className={cn(
            "text-xs",
            status === "needs_review" && "text-suspect",
            status === "confirmed" && "text-fire",
            status === "dismissed" && "text-contour",
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-contour">
        {stations}, {ago(alert.firstAlertMinAgo)}
      </p>
    </button>
  );
}

function Filmstrip({ alert, lead, minute, onPick }: { alert: Alert; lead: Camera; minute: number; onPick: (m: number) => void }) {
  return (
    <div className="overflow-x-auto pb-2">
      <ol className="grid grid-cols-11 gap-1.5" aria-label="Frames around the first alert, every 2 minutes">
        {alert.timeline.filter((t) => t.minute % 2 === 0).map(({ minute: m, score }) => (
          <li key={m}>
            <button
              type="button"
              onClick={() => onPick(m)}
              aria-pressed={m === minute}
              aria-label={`${m === 0 ? "First alert" : `${m > 0 ? "+" : ""}${m} min`}, score ${pct(score)}`}
              className={cn(
                "block w-full rounded-sm text-left outline-none ring-1 focus-visible:ring-2 focus-visible:ring-suspect",
                m === minute ? "ring-paper" : "ring-transparent hover:ring-border",
              )}
            >
              <CameraFrame scene={lead.scene} plume={lead.plume} plumeGrowth={Math.max(0, (score - 0.3) / 0.6)} label="" />
              <div className="flex h-8 items-end px-1 pt-1">
                <div
                  className={cn("w-full rounded-t-[2px]", score >= 0.85 ? "bg-fire" : score >= 0.55 ? "bg-suspect" : "bg-clear/60")}
                  style={{ height: `${Math.max(8, score * 100)}%` }}
                />
              </div>
              <span className={cn("block px-1 pb-1 text-center text-xs", m === 0 ? "font-semibold text-suspect" : "text-contour")}>
                {m === 0 ? "Alert" : `${m > 0 ? "+" : ""}${m}`}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DecisionPanel({ alert, decision, onDecide }: { alert: Alert; decision: Decision; onDecide: (d: Decision) => void }) {
  const [choosingReason, setChoosingReason] = useState(false);

  if (decision.status === "confirmed") {
    return (
      <div className="rounded-xl bg-fire/10 p-4 ring-1 ring-fire/40">
        <p className="font-heading text-2xl font-semibold text-fire">Confirmed fire</p>
        <p className="mt-1 text-sm text-paper">
          {alert.location
            ? `Location estimate ${coords(alert.location.lat, alert.location.lon)} is ready to send to dispatch.`
            : "Only one camera sees it, so there is no location estimate yet."}
        </p>
        <Button variant="ghost" className="mt-3" onClick={() => onDecide({ status: "needs_review" })}>
          Undo
        </Button>
      </div>
    );
  }
  if (decision.status === "dismissed") {
    return (
      <div className="rounded-xl bg-secondary p-4 ring-1 ring-border">
        <p className="font-heading text-2xl font-semibold text-paper">Not a fire{decision.reason ? `: ${decision.reason.toLowerCase()}` : ""}</p>
        <p className="mt-1 text-sm text-contour">
          These frames go into the next training round as examples of what smoke is not.
        </p>
        <Button variant="ghost" className="mt-3" onClick={() => onDecide({ status: "needs_review" })}>
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
          <Button className="bg-fire text-paper hover:bg-fire/85" onClick={() => onDecide({ status: "confirmed" })}>
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
              <Button
                key={reason}
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  onDecide({ status: "dismissed", reason });
                  setChoosingReason(false);
                }}
              >
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

export function AlertReview() {
  const params = useSearchParams();
  const initial = DEMO_ALERTS.find((a) => a.id === params.get("id")) ?? DEMO_ALERTS[0];
  const [openId, setOpenId] = useState(initial.id);
  const [minute, setMinute] = useState(0);
  const [showTiles, setShowTiles] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(DEMO_ALERTS.map((a) => [a.id, { status: a.status, reason: a.dismissReason }])),
  );

  const alert = DEMO_ALERTS.find((a) => a.id === openId) ?? DEMO_ALERTS[0];
  const cams = alert.cameraIds.map(cameraById).filter(Boolean) as Camera[];
  const lead = cams[0];
  const atMinute = alert.timeline.find((t) => t.minute === minute) ?? alert.timeline[10];
  const growth = Math.max(0, (atMinute.score - 0.3) / 0.6);
  const sorted = [...DEMO_ALERTS].sort(
    (a, b) => Number(decisions[b.id].status === "needs_review") - Number(decisions[a.id].status === "needs_review"),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Alerts" className="space-y-1">
        {sorted.map((a) => (
          <AlertListItem
            key={a.id}
            alert={a}
            status={decisions[a.id].status}
            active={a.id === alert.id}
            onOpen={() => {
              setOpenId(a.id);
              setMinute(0);
            }}
          />
        ))}
      </nav>

      <article className="min-w-0 space-y-6">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">
              {alert.cameraIds.length > 1 ? `Smoke seen by ${alert.cameraIds.length} cameras` : "Possible smoke on one camera"}
            </h1>
            <p className="mt-1 text-contour">
              Alert {alert.id}, first raised {ago(alert.firstAlertMinAgo)}. Peak score {pct(alert.peakScore)}.
            </p>
          </div>
          {lead && (
            <Button variant="outline" onClick={() => setShowTiles((s) => !s)} aria-pressed={showTiles}>
              {showTiles ? "Hide model tiles" : "Show model tiles"}
            </Button>
          )}
        </header>

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <div className={cn("grid gap-3", cams.length > 1 && "md:grid-cols-2")}>
              {cams.map((cam) => (
                <figure key={cam.id} className="overflow-hidden rounded-sm bg-card ring-1 ring-border">
                  <CameraFrame
                    scene={cam.scene}
                    plume={cam.plume}
                    plumeGrowth={growth}
                    showTiles={showTiles}
                    tiles={demoTiles(cam.plume, atMinute.score)}
                    label={`${cam.name} at ${minute === 0 ? "the first alert" : `${minute} minutes from the first alert`}`}
                  />
                  <figcaption className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-paper">{cam.name}</span>
                    <span className="text-contour">Bearing {compass(alert.bearings[cam.id])}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            {lead && (
              <section aria-labelledby="film-title">
                <h2 id="film-title" className="mb-2 text-sm text-contour">
                  {lead.name}, a frame every 2 minutes around the first alert. Pick one to compare.
                </h2>
                <Filmstrip alert={alert} lead={lead} minute={minute} onPick={setMinute} />
              </section>
            )}
            <section aria-labelledby="map-title" className="rounded-xl bg-card bg-contours p-5 ring-1 ring-border">
              <h2 id="map-title" className="font-heading text-2xl font-semibold text-paper">
                Fire finder
              </h2>
              <FireFinder cameras={DEMO_CAMERAS} alert={alert} focus />
              <p className="text-sm text-contour">
                {alert.location
                  ? `Bearings cross at ${coords(alert.location.lat, alert.location.lon)}.`
                  : "A second camera is needed to place this plume on the map."}
              </p>
            </section>
          </div>

          <div className="space-y-4">
            <DecisionPanel
              alert={alert}
              decision={decisions[alert.id]}
              onDecide={(d) => setDecisions((all) => ({ ...all, [alert.id]: d }))}
            />
            <dl className="space-y-3 rounded-xl bg-card p-4 text-sm ring-1 ring-border">
              <div className="flex justify-between gap-4">
                <dt className="text-contour">Peak score</dt>
                <dd className="font-heading text-lg font-semibold text-suspect">{pct(alert.peakScore)}</dd>
              </div>
              {cams.map((cam) => (
                <div key={cam.id} className="flex justify-between gap-4">
                  <dt className="text-contour">{cam.name}</dt>
                  <dd className="text-paper">Bearing {compass(alert.bearings[cam.id])}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt className="text-contour">Location</dt>
                <dd className="text-right text-paper">
                  {alert.location ? coords(alert.location.lat, alert.location.lon) : "Needs a second camera"}
                </dd>
              </div>
            </dl>

          </div>
        </div>
      </article>
    </div>
  );
}
