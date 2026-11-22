import { cn } from "cn";

/** Smoke score over the last minutes, with the alert threshold drawn as a faint line. */
export function ScoreSpark({
  values,
  threshold = 0.55,
  className,
}: {
  values: number[];
  threshold?: number;
  className?: string;
}) {
  const w = 120;
  const h = 28;
  const step = w / Math.max(1, values.length - 1);
  const y = (v: number) => h - 2 - v * (h - 4);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1] ?? 0;
  const color = last >= 0.85 ? "var(--fire)" : last >= threshold ? "var(--suspect)" : "var(--clear)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-7 w-[120px]", className)} aria-hidden preserveAspectRatio="none">
      <line x1="0" x2={w} y1={y(threshold)} y2={y(threshold)} stroke="var(--contour)" strokeOpacity="0.35" strokeDasharray="2 3" />
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} fillOpacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
