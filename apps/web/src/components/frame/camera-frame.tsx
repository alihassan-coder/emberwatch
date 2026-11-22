/*
  A stand-in camera frame: a ridge-line landscape drawn from a seed.

  Real HPWREN imagery can't be redistributed in a public repo, so the demo
  draws its own scenes. When the replay service runs (Phase 2) this is
  swapped for real frames served by the API; the overlays stay the same.
*/

import { cn } from "cn";

type Tile = { y: number; x: number; size: number; probability: number };

type Props = {
  scene: number;
  plume?: { x: number; y: number; size: number };
  plumeGrowth?: number; // 0 = not yet visible, 1 = full size (for filmstrips)
  tiles?: Tile[];       // model tile scores in the frame's own pixel space
  frameWidth?: number;
  frameHeight?: number;
  showTiles?: boolean;
  className?: string;
  label?: string;       // accessible description
};

const W = 1280;
const H = 720;

/** A ridge line as an SVG path, from layered sine waves (deterministic per seed). */
function ridge(seed: number, baseY: number, roughness: number) {
  const points: string[] = [];
  for (let x = 0; x <= W; x += 16) {
    const y =
      baseY +
      Math.sin(x / (170 + seed * 7) + seed) * roughness +
      Math.sin(x / (61 + seed * 3) + seed * 1.7) * roughness * 0.45 +
      Math.sin(x / (23 + seed) + seed * 2.3) * roughness * 0.12;
    points.push(`${x},${y.toFixed(1)}`);
  }
  return `M0,${H} L${points.join(" L")} L${W},${H} Z`;
}

/** Ember ramp for tile probabilities: transparent below 0.3, amber to red above. */
function tileFill(p: number) {
  if (p < 0.3) return "transparent";
  if (p < 0.6) return `rgb(240 166 58 / ${(0.12 + (p - 0.3) * 0.6).toFixed(2)})`;
  return `rgb(229 83 61 / ${(0.25 + (p - 0.6) * 0.8).toFixed(2)})`;
}

export function CameraFrame({
  scene,
  plume,
  plumeGrowth = 1,
  tiles,
  frameWidth = W,
  frameHeight = H,
  showTiles = false,
  className,
  label = "Camera frame",
}: Props) {
  const id = `s${scene}`;
  const dusk = scene % 3 === 0; // some cameras face into evening light
  const growth = Math.max(0, Math.min(1, plumeGrowth));
  const px = plume ? plume.x * W : 0;
  const py = plume ? plume.y * H : 0;
  const r = plume ? plume.size * W * (0.35 + growth * 0.65) : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className={cn("block h-auto w-full bg-ridge", className)}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dusk ? "#3b4a5a" : "#6f8796"} />
          <stop offset="0.7" stopColor={dusk ? "#b98a6a" : "#b9c3c0"} />
          <stop offset="1" stopColor={dusk ? "#d9a679" : "#d6d6cc"} />
        </linearGradient>
        <filter id={`${id}-smoke`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      <rect width={W} height={H} fill={`url(#${id}-sky)`} />
      <path d={ridge(scene % 7 + 1, H * 0.52, 34)} fill={dusk ? "#6c6a73" : "#8a9a96"} opacity="0.85" />

      {plume && growth > 0 && (
        <g filter={`url(#${id}-smoke)`} opacity={0.35 + growth * 0.5}>
          {/* a plume rises from the ridge and leans with the wind */}
          <ellipse cx={px} cy={py + r * 0.6} rx={r * 0.35} ry={r * 0.55} fill="#d8d2c6" />
          <ellipse cx={px + r * 0.35} cy={py - r * 0.1} rx={r * 0.55} ry={r * 0.45} fill="#cfc8bb" />
          <ellipse cx={px + r * 0.9} cy={py - r * 0.45} rx={r * 0.75} ry={r * 0.35} fill="#c4bdb0" />
        </g>
      )}

      <path d={ridge((scene % 5) + 3, H * 0.64, 42)} fill={dusk ? "#4a4650" : "#5d6f68"} />
      <path d={ridge((scene % 4) + 6, H * 0.8, 30)} fill={dusk ? "#2b2a31" : "#33443f"} />

      {showTiles &&
        tiles?.map((t, i) => {
          const sx = W / frameWidth;
          const sy = H / frameHeight;
          return (
            <rect
              key={i}
              x={t.x * sx}
              y={t.y * sy}
              width={t.size * sx}
              height={t.size * sy}
              fill={tileFill(t.probability)}
              stroke="rgb(233 228 214 / 0.18)"
              strokeWidth="1.5"
            />
          );
        })}
    </svg>
  );
}

/** Tile probabilities for a drawn scene: high around the plume, low elsewhere (6x4 grid, like the model). */
export function demoTiles(plume: Props["plume"], strength: number): Tile[] {
  const rows = [0, 165, 331, 496];
  const cols = [0, 211, 422, 634, 845, 1056];
  return rows.flatMap((y) =>
    cols.map((x) => {
      if (!plume) return { y, x, size: 224, probability: 0.04 };
      const dx = x + 112 - plume.x * W;
      const dy = y + 112 - plume.y * H;
      const d = Math.sqrt(dx * dx + dy * dy) / 260;
      return { y, x, size: 224, probability: Math.max(0.03, strength * Math.exp(-d * d)) };
    }),
  );
}
