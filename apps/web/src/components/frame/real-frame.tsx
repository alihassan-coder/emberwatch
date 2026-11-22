/*
  A real tower-camera frame (Pyro-SDIS, Apache-2.0) with optional overlays:
  - the model's tile scores, tinted on the ember ramp
  - the smoke box a person drew (dashed), for comparison with the model
*/

import { cn } from "cn";
import type { ManifestFrame } from "@/lib/replay/manifest";

const W = 960;
const H = 540;

function heat(p: number) {
  if (p < 0.3) return "transparent";
  if (p < 0.6) return `rgb(240 166 58 / ${(0.14 + (p - 0.3) * 0.6).toFixed(2)})`;
  return `rgb(229 83 61 / ${(0.26 + (p - 0.6) * 0.75).toFixed(2)})`;
}

export function RealFrame({
  frame,
  showTiles = false,
  subtle = false,
  showBoxes = false,
  className,
  alt,
  priority = false,
  threshold = 0.5,
}: {
  frame: ManifestFrame;
  showTiles?: boolean;
  /** Outline the tiles that pass `threshold` instead of filling every tile (for small views). */
  subtle?: boolean;
  threshold?: number;
  showBoxes?: boolean;
  className?: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("relative aspect-video overflow-hidden bg-ridge", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static demo frames, already sized for the wall */}
      <img
        src={`/demo/${frame.file}`}
        alt={alt}
        width={W}
        height={H}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {(showTiles || showBoxes) && (
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
          {showTiles &&
            !subtle &&
            frame.tiles?.map((t, i) => (
              <rect key={i} x={t.x} y={t.y} width={t.size} height={t.size} fill={heat(t.p)} stroke="rgb(233 228 214 / 0.14)" strokeWidth="1" />
            ))}
          {showTiles &&
            subtle &&
            frame.tiles
              ?.filter((t) => t.p >= threshold)
              .map((t, i) => (
                <rect key={i} x={t.x + 3} y={t.y + 3} width={t.size - 6} height={t.size - 6} rx="4"
                  fill={t.p >= 0.85 ? "rgb(229 83 61 / 0.12)" : "rgb(240 166 58 / 0.1)"}
                  stroke={t.p >= 0.85 ? "var(--fire)" : "var(--suspect)"} strokeWidth="3" />
              ))}
          {showBoxes &&
            frame.boxes.map(([y1, x1, y2, x2], i) => (
              <rect key={`b${i}`} x={x1 - 4} y={y1 - 4} width={x2 - x1 + 8} height={y2 - y1 + 8} fill="none"
                stroke="var(--paper)" strokeWidth="2" strokeDasharray="5 4" />
            ))}
        </svg>
      )}
    </div>
  );
}
