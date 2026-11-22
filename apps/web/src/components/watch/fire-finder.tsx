/*
  Fire Finder map.

  Named after the Osborne Fire Finder, the sighting instrument in fire
  lookout towers: a map with a ring marked in compass degrees. Each camera
  gets a degree ring and its viewing cone; cameras that see a plume shoot a
  bearing line, and where two lines cross is the location estimate.
*/

import { cn } from "cn";
import { travel, type LatLon } from "@/lib/geo";
import { compass, coords } from "@/lib/format";
import type { Alert, Camera } from "@/lib/types";

const W = 900;
const H = 520;
const PAD = 60;
const CONE_KM = 38;

type Props = {
  cameras: Camera[];
  alert?: Alert;
  /** Zoom to the alert: its cameras and the location estimate fill the map. */
  focus?: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
};

function makeProjection(points: LatLon[]) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const minX = Math.min(...lons) * kx, maxX = Math.max(...lons) * kx;
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  const scale = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
  const offX = (W - (maxX - minX) * scale) / 2;
  const offY = (H - (maxY - minY) * scale) / 2;
  const project = (p: LatLon) => ({
    x: offX + (p.lon * kx - minX) * scale,
    y: H - (offY + (p.lat - minY) * scale),
  });
  const pxPerKm = scale / 111.32;
  return { project, pxPerKm };
}

/** Wedge path for a camera's field of view. */
function cone(project: (p: LatLon) => { x: number; y: number }, cam: Camera) {
  const c = project(cam.position);
  const pts = [];
  for (let a = cam.azimuth - cam.fov / 2; a <= cam.azimuth + cam.fov / 2; a += 5) {
    pts.push(project(travel(cam.position, a, CONE_KM)));
  }
  return `M${c.x},${c.y} ${pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} Z`;
}

function DegreeRing({ x, y, r, strong }: { x: number; y: number; r: number; strong: boolean }) {
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <g aria-hidden opacity={strong ? 1 : 0.55}>
      <circle cx={x} cy={y} r={r} fill="none" stroke="var(--contour)" strokeOpacity="0.5" />
      {ticks.map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        const long = deg % 30 === 0;
        const r1 = r - (long ? 7 : 4);
        return (
          <line
            key={deg}
            x1={x + Math.cos(rad) * r1}
            y1={y + Math.sin(rad) * r1}
            x2={x + Math.cos(rad) * r}
            y2={y + Math.sin(rad) * r}
            stroke="var(--contour)"
            strokeOpacity={long ? 0.8 : 0.45}
          />
        );
      })}
      {strong &&
        [0].map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          return (
            <text
              key={deg}
              x={x + Math.cos(rad) * (r + 12)}
              y={y + Math.sin(rad) * (r + 12) + 4}
              textAnchor="middle"
              className="fill-contour text-[15px]"
            >
              {deg === 0 ? "N" : deg}
            </text>
          );
        })}
    </g>
  );
}

export function FireFinder({ cameras, alert, focus = false, selectedId, onSelect, className }: Props) {
  const focusCams = focus && alert ? cameras.filter((c) => alert.cameraIds.includes(c.id)) : [];
  const zoomed = focusCams.length > 0;
  const points = zoomed
    ? [
        ...focusCams.map((c) => c.position),
        // a little room around the fire so the estimate isn't on the edge
        ...(alert?.location ? [0, 90, 180, 270].map((b) => travel(alert.location!, b, 8)) : []),
        ...focusCams.map((c) => travel(c.position, alert!.bearings[c.id] + 180, 6)),
      ]
    : [...cameras.map((c) => c.position), ...(alert?.location ? [alert.location] : [])];
  const { project, pxPerKm } = makeProjection(points);
  const seeing = new Set(alert?.cameraIds ?? []);
  const fix = alert?.location ? project(alert.location) : null;
  const scaleKm = 20;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label={
        alert?.location
          ? `Map: ${alert.cameraIds.length} cameras' bearings cross at ${coords(alert.location.lat, alert.location.lon)}`
          : "Map of camera positions and viewing directions"
      }
    >
      <defs>
        <clipPath id="finder-clip">
          <rect width={W} height={H} rx="8" />
        </clipPath>
      </defs>
      <g clipPath="url(#finder-clip)">
      {/* viewing cones */}
      {cameras.map((cam) => (
        <path
          key={`cone-${cam.id}`}
          d={cone(project, cam)}
          fill={seeing.has(cam.id) ? "var(--suspect)" : "var(--contour)"}
          fillOpacity={zoomed ? 0.035 : seeing.has(cam.id) ? 0.1 : cam.id === selectedId ? 0.1 : 0.04}
          stroke={seeing.has(cam.id) ? "var(--suspect)" : "var(--contour)"}
          strokeOpacity={zoomed ? 0.12 : 0.25}
        />
      ))}

      {/* bearing lines from every camera that sees the plume */}
      {alert &&
        alert.cameraIds.map((id) => {
          const cam = cameras.find((c) => c.id === id);
          if (!cam) return null;
          const from = project(cam.position);
          const to = project(travel(cam.position, alert.bearings[id], CONE_KM * 1.6));
          return (
            <g key={`bearing-${id}`}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--suspect)" strokeWidth="1.75" strokeDasharray="6 5" />
              <text paintOrder="stroke" stroke="var(--ridge)" strokeWidth={4} strokeLinejoin="round" x={to.x} y={to.y - 8} textAnchor="middle" className="fill-suspect text-[16px]">
                {compass(alert.bearings[id])}
              </text>
            </g>
          );
        })}

      {/* cameras */}
      {cameras.map((cam) => {
        const p = project(cam.position);
        const strong = cam.id === selectedId || seeing.has(cam.id);
        const fill = cam.state === "fire" ? "var(--fire)" : cam.state === "suspect" ? "var(--suspect)" : "var(--clear)";
        return (
          <g
            key={cam.id}
            className={onSelect ? "cursor-pointer" : undefined}
            onClick={onSelect ? () => onSelect(cam.id) : undefined}
          >
            <title>{`${cam.name}, facing ${compass(cam.azimuth)}`}</title>
            <DegreeRing x={p.x} y={p.y} r={strong ? 30 : 18} strong={strong} />
            <circle cx={p.x} cy={p.y} r="5" fill={fill} stroke="var(--ridge)" strokeWidth="2" />
            <text paintOrder="stroke" stroke="var(--ridge)" strokeWidth={4} strokeLinejoin="round" x={p.x} y={p.y + (strong ? 50 : 34)} textAnchor="middle" className="fill-paper text-[17px] font-medium">
              {cam.station}
            </text>
          </g>
        );
      })}

      </g>

      {/* location estimate */}
      {fix && alert?.location && (
        <g>
          <circle cx={fix.x} cy={fix.y} r="16" fill="var(--fire)" fillOpacity="0.15" stroke="var(--fire)" strokeOpacity="0.6" />
          <circle cx={fix.x} cy={fix.y} r="5" fill="var(--fire)" />
          <text paintOrder="stroke" stroke="var(--ridge)" strokeWidth={4} strokeLinejoin="round" x={fix.x + (fix.x > W * 0.62 ? -24 : 24)} y={fix.y - 26} textAnchor={fix.x > W * 0.62 ? "end" : "start"} className="fill-paper text-[20px] font-semibold">
            Location estimate
          </text>
          <text paintOrder="stroke" stroke="var(--ridge)" strokeWidth={4} strokeLinejoin="round" x={fix.x + (fix.x > W * 0.62 ? -24 : 24)} y={fix.y - 8} textAnchor={fix.x > W * 0.62 ? "end" : "start"} className="fill-contour text-[17px]">
            {coords(alert.location.lat, alert.location.lon)}
          </text>
        </g>
      )}

      {/* scale bar */}
      <g transform={`translate(${PAD - 30}, ${H - 26})`} aria-hidden>
        <line x1="0" y1="0" x2={scaleKm * pxPerKm} y2="0" stroke="var(--contour)" strokeWidth="2" />
        <line x1="0" y1="-5" x2="0" y2="5" stroke="var(--contour)" />
        <line x1={scaleKm * pxPerKm} y1="-5" x2={scaleKm * pxPerKm} y2="5" stroke="var(--contour)" />
        <text paintOrder="stroke" stroke="var(--ridge)" strokeWidth={4} strokeLinejoin="round" x={scaleKm * pxPerKm + 8} y="4" className="fill-contour text-[16px]">
          {scaleKm} km
        </text>
      </g>
    </svg>
  );
}
