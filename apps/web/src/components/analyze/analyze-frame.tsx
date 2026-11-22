"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageUp, LoaderCircle } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { ApiError, scoreFrame, type FrameScore } from "@/lib/api";
import { pct } from "@/lib/format";

type Status = { kind: "idle" } | { kind: "scoring" } | { kind: "done"; result: FrameScore } | { kind: "error"; message: string };

/** Ember ramp shared with the camera frames: nothing below 30%, amber then red above. */
function tileFill(p: number) {
  if (p < 0.3) return "transparent";
  if (p < 0.6) return `rgb(240 166 58 / ${(0.15 + (p - 0.3) * 0.7).toFixed(2)})`;
  return `rgb(229 83 61 / ${(0.3 + (p - 0.6) * 0.8).toFixed(2)})`;
}

function TileOverlay({ result }: { result: FrameScore }) {
  const strongest = result.tiles.reduce((a, b) => (b.probability > a.probability ? b : a), result.tiles[0]);
  return (
    <svg
      viewBox={`0 0 ${result.width} ${result.height}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      {result.tiles.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width={t.size} height={t.size} fill={tileFill(t.probability)} stroke="rgb(233 228 214 / 0.22)" strokeWidth={Math.max(1, result.width / 640)} />
      ))}
      {strongest && strongest.probability >= result.threshold && (
        <rect
          x={strongest.x}
          y={strongest.y}
          width={strongest.size}
          height={strongest.size}
          fill="none"
          stroke="var(--paper)"
          strokeWidth={Math.max(2, result.width / 320)}
        />
      )}
    </svg>
  );
}

function Readout({ result }: { result: FrameScore }) {
  const hot = result.tiles.filter((t) => t.probability >= result.threshold).length;
  return (
    <div className="space-y-6">
      <div>
        <p className={cn("font-heading text-3xl font-semibold", result.smoke ? "text-suspect" : "text-clear")}>
          {result.smoke ? "Smoke likely in this frame" : "No smoke found"}
        </p>
        <p className="mt-1 text-sm text-contour">
          {result.smoke
            ? `${hot} of ${result.tiles.length} tiles pass the alert threshold. The outlined tile scored highest.`
            : `All ${result.tiles.length} tiles stayed below the alert threshold.`}
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-contour">Frame score</span>
          <span className="font-heading text-5xl font-semibold text-paper">{pct(result.score)}</span>
        </div>
        <div className="relative mt-3 h-2 rounded-full bg-muted" role="img" aria-label={`Score ${pct(result.score)}, threshold ${pct(result.threshold)}`}>
          <div className={cn("h-full rounded-full", result.smoke ? "bg-suspect" : "bg-clear")} style={{ width: pct(result.score) }} />
          <div className="absolute -top-1 h-4 w-0.5 bg-paper" style={{ left: pct(result.threshold) }} />
        </div>
        <p className="mt-2 text-xs text-contour">The white mark is the alert threshold ({pct(result.threshold)}).</p>
      </div>

      <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-contour">Model</dt>
          <dd className="text-paper">{result.model_version}</dd>
        </div>
        <div>
          <dt className="text-contour">Model time</dt>
          <dd className="text-paper">{Math.round(result.latency_ms)} ms</dd>
        </div>
        <div>
          <dt className="text-contour">Frame size</dt>
          <dd className="text-paper">
            {result.width} × {result.height}
          </dd>
        </div>
        <div>
          <dt className="text-contour">Tiles checked</dt>
          <dd className="text-paper">{result.tiles.length}</dd>
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
      setStatus({ kind: "error", message: "That file isn't an image. Choose a JPEG or PNG camera frame." });
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStatus({ kind: "scoring" });
    try {
      setStatus({ kind: "done", result: await scoreFrame(f) });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof ApiError ? e.message : "Scoring failed. Try the frame again." });
    }
  }, []);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="Frame">
        {preview ? (
          <div className="relative overflow-hidden rounded-sm ring-1 ring-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a remote image */}
            <img src={preview} alt={file?.name ?? "Uploaded frame"} className="block h-auto w-full" />
            {status.kind === "done" && showTiles && <TileOverlay result={status.result} />}
            {status.kind === "scoring" && (
              <div className="absolute inset-0 grid place-items-center bg-ridge/50">
                <span className="flex items-center gap-2 rounded-full bg-ridge px-4 py-2 text-sm text-paper">
                  <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  Checking every tile for smoke
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
            <ImageUp className="size-10 text-contour" aria-hidden />
            <span className="font-heading text-2xl font-semibold text-paper">Drop a camera frame here</span>
            <span className="max-w-sm text-sm text-contour">
              Or click to choose one. JPEG or PNG, any size up to 15 MB. The frame is checked tile by tile, the
              same way the live cameras are.
            </span>
          </label>
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
          <p className="text-contour">
            Results appear here: whether the frame shows smoke, how sure the model is, and which part of the image
            it looked at.
          </p>
        )}
        {status.kind === "scoring" && <p className="text-contour">Scoring {file?.name}…</p>}
        {status.kind === "error" && (
          <div>
            <p className="font-heading text-2xl font-semibold text-fire">Couldn&apos;t score this frame</p>
            <p className="mt-2 text-sm text-paper">{status.message}</p>
          </div>
        )}
        {status.kind === "done" && <Readout result={status.result} />}

        {preview && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => input.current?.click()}>
              Analyze another frame
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
