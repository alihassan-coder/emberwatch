"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageUp, LoaderCircle } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { ApiError, scoreFrame, type FrameScore } from "@/lib/api";
import { pct } from "@/lib/format";
import { ALERT_THRESHOLD } from "@/lib/replay/engine";

/** Real frames from cameras the model never trained on, so a visitor can try it in one click. */
const SAMPLES = [
  { file: "gallery/caught/04.jpg", label: "Smoke beyond a town" },
  { file: "gallery/ignored/06.jpg", label: "A cloud that looks like smoke" },
  { file: "gallery/ignored/04.jpg", label: "Fog in the trees" },
];

type Status = { kind: "idle" } | { kind: "scoring" } | { kind: "done"; result: FrameScore } | { kind: "error"; message: string };

/** Same look as the live footage: a faint grid of tiles, red outlines where the model sees smoke. */
function TileOverlay({ result }: { result: FrameScore }) {
  const line = Math.max(2, result.width / 320);
  return (
    <svg viewBox={`0 0 ${result.width} ${result.height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
      {result.tiles.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width={t.size} height={t.size} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth={line / 2} />
      ))}
      {result.tiles
        .filter((t) => t.probability >= ALERT_THRESHOLD)
        .map((t, i) => (
          <rect key={`hot${i}`} x={t.x + line} y={t.y + line} width={t.size - 2 * line} height={t.size - 2 * line} rx={line * 2}
            fill="color-mix(in oklch, var(--fire) 12%, transparent)" stroke="var(--fire)" strokeWidth={line * 1.5} />
        ))}
    </svg>
  );
}

const VERDICT = {
  fire: { title: "Smoke in this photo", tone: "text-fire", bar: "bg-fire" },
  suspect: { title: "Possible smoke", tone: "text-suspect", bar: "bg-suspect" },
  clear: { title: "No smoke found", tone: "text-clear", bar: "bg-clear" },
} as const;

function Readout({ result }: { result: FrameScore }) {
  const hot = result.tiles.filter((t) => t.probability >= ALERT_THRESHOLD).length;
  const state = result.score >= 0.85 ? "fire" : result.score >= ALERT_THRESHOLD ? "suspect" : "clear";
  const v = VERDICT[state];
  return (
    <div className="space-y-6">
      <div>
        <p className={cn("text-2xl font-semibold tracking-tight", v.tone)}>{v.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hot > 0
            ? `${hot} of ${result.tiles.length} parts of the photo look like smoke. They are outlined in red.`
            : `All ${result.tiles.length} parts of the photo stayed below the 50% line.`}
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Smoke score</span>
          <span className={cn("text-5xl font-semibold tabular-nums", v.tone)}>{pct(result.score)}</span>
        </div>
        <div className="relative mt-3 h-2 rounded-full bg-muted" role="img" aria-label={`Score ${pct(result.score)}, alert line 50%`}>
          <div className={cn("h-full rounded-full", v.bar)} style={{ width: pct(result.score) }} />
          <div className="absolute -top-1 h-4 w-0.5 bg-foreground" style={{ left: pct(ALERT_THRESHOLD) }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The mark is the 50% line. On a live camera, 2 of 3 photos above it raise an alert.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="text-foreground">{result.model_version}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Model time</dt>
          <dd className="text-foreground">{Math.round(result.latency_ms)} ms</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Photo size</dt>
          <dd className="text-foreground">
            {result.width} × {result.height}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tiles checked</dt>
          <dd className="text-foreground">{result.tiles.length}</dd>
        </div>
      </dl>
    </div>
  );
}

export function AnalyzeFrame() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showTiles, setShowTiles] = useState(true);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Revoke the old preview URL whenever it changes (and when leaving the page).
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const analyze = useCallback(async (f: File) => {
    if (!f.type.startsWith("image/")) {
      setStatus({ kind: "error", message: "That file isn't an image. Choose a JPEG or PNG camera photo." });
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStatus({ kind: "scoring" });
    try {
      setStatus({ kind: "done", result: await scoreFrame(f) });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof ApiError ? e.message : "Scoring failed. Try the photo again." });
    }
  }, []);

  const trySample = async (sample: (typeof SAMPLES)[number]) => {
    const blob = await fetch(`/demo/showcase/${sample.file}`).then((r) => r.blob());
    analyze(new File([blob], sample.label + ".jpg", { type: "image/jpeg" }));
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="Photo">
        {preview ? (
          <div className="relative overflow-hidden rounded-sm ring-1 ring-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a remote image */}
            <img src={preview} alt={file?.name ?? "Uploaded frame"} className="block h-auto w-full" />
            {status.kind === "done" && showTiles && <TileOverlay result={status.result} />}
            {status.kind === "scoring" && (
              <div className="absolute inset-0 grid place-items-center bg-ridge/50">
                <span className="flex items-center gap-2 rounded-full bg-ridge px-4 py-2 text-sm text-foreground">
                  <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  Checking every part of the photo
                </span>
              </div>
            )}
          </div>
        ) : (
          <label
            htmlFor="frame-input"
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) analyze(f);
            }}
            className={cn(
              "flex aspect-video cursor-pointer flex-col items-center justify-center gap-3 rounded-sm border-2 border-dashed bg-card bg-contours text-center transition-colors",
              dragging ? "border-suspect" : "border-border hover:border-contour",
            )}
          >
            <ImageUp className="size-10 text-muted-foreground" aria-hidden />
            <span className="font-heading text-2xl font-semibold text-foreground">Drop a camera photo here</span>
            <span className="max-w-sm text-sm text-muted-foreground">
              Or click to choose one. JPEG or PNG, any size up to 15 MB. The photo is checked tile by tile, the
              same way the live cameras are.
            </span>
          </label>
        )}
        {!preview && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-muted-foreground">No photo to hand? Try a real one:</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {SAMPLES.map((s) => (
                <button key={s.file} type="button" onClick={() => trySample(s)}
                  className="group overflow-hidden rounded-lg border text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                  {/* eslint-disable-next-line @next/next/no-img-element -- small static demo thumbnail */}
                  <img src={`/demo/showcase/${s.file}`} alt="" className="aspect-video w-full object-cover" />
                  <span className="block px-3 py-2 text-sm">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <input
          ref={input}
          id="frame-input"
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) analyze(f);
            e.target.value = "";
          }}
        />
      </section>

      <aside className="space-y-6 rounded-xl bg-card p-5 ring-1 ring-border" aria-live="polite">
        {status.kind === "idle" && (
          <p className="text-muted-foreground">
            Results appear here: whether the frame shows smoke, how sure the model is, and which part of the image
            it looked at.
          </p>
        )}
        {status.kind === "scoring" && <p className="text-muted-foreground">Scoring {file?.name}…</p>}
        {status.kind === "error" && (
          <div>
            <p className="font-heading text-2xl font-semibold text-fire">Couldn&apos;t score this frame</p>
            <p className="mt-2 text-sm text-foreground">{status.message}</p>
          </div>
        )}
        {status.kind === "done" && <Readout result={status.result} />}

        {preview && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => input.current?.click()}>
              Check another photo
            </Button>
            {status.kind === "done" && (
              <Button variant="ghost" onClick={() => setShowTiles((s) => !s)} aria-pressed={showTiles}>
                {showTiles ? "Hide tiles" : "Show tiles"}
              </Button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
