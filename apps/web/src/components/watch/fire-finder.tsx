/*
  Fire finder map.

  Named after the Osborne Fire Finder, the sighting instrument in fire
  lookout towers: a map with a ring marked in compass degrees. Each tower
  gets a degree ring, each camera its viewing cone; cameras that see a plume
  shoot a bearing line, and where two lines cross is the location estimate.
*/

import { cn } from "cn";
import { travel, type LatLon } from "@/lib/geo";
import { compass, coords } from "@/lib/format";

export type FinderCamera = {
  id: string;
  site: string;          // tower name, shared by its cameras
  position: LatLon;
  heading: number;
  fov: number;
  state: "clear" | "suspect" | "fire";
};

export type FinderAlert = {
  cameraIds: string[];
  bearings: Record<string, number>;
  location: LatLon | null;
};

type Props = {
  cameras: FinderCamera[];
  alert?: FinderAlert;
  focus?: boolean;       // zoom to the alert's cameras and location
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
};

const W = 900;
const H = 520;
const PAD = 70;
const CONE_KM = 22;

// Dark outline behind map labels, like a printed topographic map.
const halo = { paintOrder: "stroke" as const, stroke: "var(--ridge)", strokeWidth: 4, strokeLinejoin: "round" as const };

function makeProjection(points: LatLon[]) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const minX = Math.min(...lons) * kx, maxX = Math.max(...lons) * kx;
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  const spanX = Math.max(maxX - minX, 0.02), spanY = Math.max(maxY - minY, 0.02);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  const project = (p: LatLon) => ({ x: offX + (p.lon * kx - minX) * scale, y: H - (offY + (p.lat - minY) * scale) });
  return { project, pxPerKm: scale / 111.32 };
}

function DegreeRing({ x, y, r, strong }: { x: number; y: number; r: number; strong: boolean }) {
  return (
    <g aria-hidden opacity={strong ? 1 : 0.6}>
      <circle cx={x} cy={y} r={r} fill="none" stroke="var(--contour)" strokeOpacity="0.5" />
      {Array.from({ length: 36 }, (_, i) => i * 10).map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        const long = deg % 30 === 0;
        const r1 = r - (long ? 7 : 4);
        return (
          <line key={deg} x1={x + Math.cos(rad) * r1} y1={y + Math.sin(rad) * r1} x2={x + Math.cos(rad) * r} y2={y + Math.sin(rad) * r}
            stroke="var(--contour)" strokeOpacity={long ? 0.8 : 0.45} />
        );
      })}
      {strong && (
        <text x={x} y={y - r - 6} textAnchor="middle" className="fill-contour text-[15px]" {...halo}>
          N
        </text>
      )}
    </g>
  );
}

export function FireFinder({ cameras, alert, focus = false, selectedId, onSelect, className }: Props) {
  const seeing = new Set(alert?.cameraIds ?? []);
  const focusCams = focus && alert ? cameras.filter((c) => seeing.has(c.id)) : [];
  const zoomed = focusCams.length > 0;
  const points = zoomed
    ? [
        ...focusCams.map((c) => c.position),
        ...(alert?.location ? [0, 90, 180, 270].map((b) => travel(alert.location!, b, 5)) : []),
        ...focusCams.map((c) => travel(c.position, alert!.bearings[c.id], 12)),
      ]
    : [...cameras.map((c) => c.position), ...(alert?.location ? [alert.location] : [])];
  const { project, pxPerKm } = makeProjection(points);
  const fix = alert?.location ? project(alert.location) : null;
  const sites = [...new Map(cameras.map((c) => [c.site, c])).values()];
  const scaleKm = pxPerKm * 10 > 260 ? 2 : pxPerKm * 10 > 120 ? 5 : 10;
  const flip = fix ? fix.x > W * 0.62 : false;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-auto w-full", className)} role="img"
      aria-label={alert?.location ? `Map: bearings cross at ${coords(alert.location.lat, alert.location.lon)}` : "Map of tower cameras and their viewing directions"}>
      <defs>
        <clipPath id="finder-clip">
          <rect width={W} height={H} rx="8" />
        </clipPath>
      </defs>
      <g clipPath="url(#finder-clip)">
        {cameras.map((cam) => {
          const c = project(cam.position);
          const pts = [];
          for (let a = cam.heading - cam.fov / 2; a <= cam.heading + cam.fov / 2; a += 5) pts.push(project(travel(cam.position, a, CONE_KM)));
          const on = seeing.has(cam.id);
          return (
            <path key={`cone-${cam.id}`} d={`M${c.x},${c.y} ${pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} Z`}
              fill={on ? "var(--suspect)" : "var(--contour)"}
              fillOpacity={zoomed ? 0.04 : on ? 0.1 : cam.id === selectedId ? 0.12 : 0.035}
              stroke={on ? "var(--suspect)" : "var(--contour)"} strokeOpacity={zoomed ? 0.12 : 0.22}
              className={onSelect ? "cursor-pointer" : undefined} onClick={onSelect ? () => onSelect(cam.id) : undefined}>
              <title>{`${cam.id}, facing ${compass(cam.heading)}`}</title>
            </path>
          );
        })}

        {alert?.cameraIds.map((id) => {
          const cam = cameras.find((c) => c.id === id);
          if (!cam) return null;
          const from = project(cam.position);
          const to = project(travel(cam.position, alert.bearings[id], CONE_KM * 1.4));
          return (
            <g key={`bearing-${id}`}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--suspect)" strokeWidth="2" strokeDasharray="7 5" />
              <text x={to.x} y={to.y - 8} textAnchor="middle" className="fill-suspect text-[16px]" {...halo}>
                {compass(alert.bearings[id])}
              </text>
            </g>
          );
        })}

        {sites.map((s) => {
          const p = project(s.position);
          const camsHere = cameras.filter((c) => c.site === s.site);
          const strong = camsHere.some((c) => c.id === selectedId || seeing.has(c.id));
          const worst = camsHere.some((c) => c.state === "fire") ? "var(--fire)" : camsHere.some((c) => c.state === "suspect") ? "var(--suspect)" : "var(--clear)";
          return (
            <g key={s.site}>
              <DegreeRing x={p.x} y={p.y} r={strong ? 30 : 20} strong={strong} />
              <circle cx={p.x} cy={p.y} r="5.5" fill={worst} stroke="var(--ridge)" strokeWidth="2" />
              <text x={p.x} y={p.y + (strong ? 52 : 40)} textAnchor="middle" className="fill-paper text-[17px] font-medium" {...halo}>
                {s.site}
              </text>
            </g>
          );
        })}
      </g>

      {fix && alert?.location && (
        <g>
          <circle cx={fix.x} cy={fix.y} r="18" fill="var(--fire)" fillOpacity="0.15" stroke="var(--fire)" strokeOpacity="0.6" />
          <circle cx={fix.x} cy={fix.y} r="5.5" fill="var(--fire)" />
          <text x={fix.x + (flip ? -26 : 26)} y={fix.y - 26} textAnchor={flip ? "end" : "start"}
            className="fill-paper text-[20px] font-semibold" {...halo}>Location estimate</text>
          <text x={fix.x + (flip ? -26 : 26)} y={fix.y - 6} textAnchor={flip ? "end" : "start"}
            className="fill-contour text-[16px]" {...halo}>{coords(alert.location.lat, alert.location.lon)}</text>
        </g>
      )}

      <g transform={`translate(28, ${H - 24})`} aria-hidden>
        <line x1="0" y1="0" x2={scaleKm * pxPerKm} y2="0" stroke="var(--contour)" strokeWidth="2" />
        <line x1="0" y1="-5" x2="0" y2="5" stroke="var(--contour)" />
        <line x1={scaleKm * pxPerKm} y1="-5" x2={scaleKm * pxPerKm} y2="5" stroke="var(--contour)" />
        <text x={scaleKm * pxPerKm + 8} y="5" className="fill-contour text-[15px]" {...halo}>{scaleKm} km</text>
      </g>
      <text x={W - 16} y={H - 18} textAnchor="end" className="fill-contour text-[13px]" {...halo}>
        Tower positions are approximate
      </text>
    </svg>
  );
}
