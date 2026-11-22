"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellRing, Clapperboard, Cpu, ScanSearch, ShieldCheck, TowerControl } from "lucide-react";
import { cn } from "cn";
import { getHealth, type Health } from "@/lib/api";
import { px } from "@/lib/geo";
import { ReplayControls } from "@/components/replay/replay-controls";
import { useReplay } from "@/lib/replay/store";

const NAV = [
  { href: "/", label: "Watch", icon: TowerControl },
  { href: "/live", label: "Live detection", icon: Clapperboard },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/proof", label: "Try to fool it", icon: ShieldCheck },
  { href: "/analyze", label: "Analyze a frame", icon: ScanSearch },
  { href: "/model", label: "Model", icon: Cpu },
];

/** The EmberWatch mark: a sighting ring with one bearing, as on a lookout's fire finder. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <circle cx="16" cy="16" r="12" fill="none" stroke="var(--contour)" strokeWidth="1.5" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        return (
          <line key={i} x1={px(16 + Math.sin(a) * 9.5)} y1={px(16 - Math.cos(a) * 9.5)} x2={px(16 + Math.sin(a) * 12)} y2={px(16 - Math.cos(a) * 12)} stroke="var(--contour)" strokeWidth="1" />
        );
      })}
      <line x1="16" y1="16" x2="25" y2="9" stroke="var(--suspect)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2" fill="var(--suspect)" />
    </svg>
  );
}

function ApiStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () =>
      getHealth()
        .then((h) => alive && (setHealth(h), setDown(false)))
        .catch(() => alive && setDown(true));
    check();
    const timer = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <span className="flex items-center gap-2 whitespace-nowrap text-sm text-contour">
      <span className={cn("size-2 rounded-full", down ? "bg-fire" : health ? "bg-clear" : "bg-contour/50")} aria-hidden />
      <span className="sr-only sm:not-sr-only">
        {down ? "API offline" : health ? `Model ${health.model_version}` : "Connecting to API"}
      </span>
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const open = useReplay().needsReview;

  return (
    <div className="flex min-h-dvh">
      <nav aria-label="Main" className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-4 lg:w-56 lg:items-stretch lg:px-3">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-1 lg:px-2" aria-label="EmberWatch home">
          <Mark />
          <span className="hidden font-heading text-2xl font-semibold tracking-tight text-paper lg:inline">EmberWatch</span>
        </Link>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-suspect",
                active ? "bg-sidebar-accent text-paper" : "text-contour hover:bg-sidebar-accent/60 hover:text-paper",
              )}
            >
              {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-suspect" aria-hidden />}
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="hidden lg:inline">{label}</span>
              {href === "/alerts" && open > 0 && (
                <span className="ml-auto hidden rounded-full bg-suspect px-1.5 text-xs font-semibold text-ridge lg:inline">{open}</span>
              )}
              <span className="sr-only lg:hidden">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-background/90 px-4 backdrop-blur sm:gap-6 sm:px-6">
          <ReplayControls />
          <span className="hidden whitespace-nowrap rounded-full border border-suspect/40 px-2.5 py-0.5 text-xs text-suspect xl:inline">
            Replay of real frames
          </span>
          <div className="ml-auto flex items-center gap-4 sm:gap-6">
            <ApiStatus />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
