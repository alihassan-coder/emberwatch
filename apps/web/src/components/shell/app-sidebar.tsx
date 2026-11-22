"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, BellRing, Camera, ImageUp, PlayCircle } from "lucide-react";
import { cn } from "cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { getHealth } from "@/lib/api";
import { px } from "@/lib/geo";

/** Pages in the order a first-time visitor needs them. */
export const PAGES = [
  { href: "/", label: "How it works", icon: PlayCircle },
  { href: "/cameras", label: "Cameras", icon: Camera },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/results", label: "Results", icon: BarChart3 },
];
export const TOOLS = [{ href: "/analyze", label: "Check a photo", icon: ImageUp }];

/** The EmberWatch mark: a sighting ring with one bearing, as on a lookout's fire finder. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-6 shrink-0" aria-hidden>
      <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        return (
          <line key={i} x1={px(16 + Math.sin(a) * 9.5)} y1={px(16 - Math.cos(a) * 9.5)} x2={px(16 + Math.sin(a) * 12)} y2={px(16 - Math.cos(a) * 12)}
            stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
        );
      })}
      <line x1="16" y1="16" x2="25" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

function ApiStatus() {
  const [state, setState] = useState<"checking" | "up" | "down">("checking");
  useEffect(() => {
    let alive = true;
    const check = () =>
      getHealth()
        .then(() => alive && setState("up"))
        .catch(() => alive && setState("down"));
    check();
    const timer = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const label = state === "up" ? "Model online" : state === "down" ? "Model offline" : "Checking model";
  return (
    <SidebarMenuButton size="sm" tooltip={label} className="pointer-events-none text-muted-foreground">
      <span className={cn("ml-1 size-2 shrink-0 rounded-full", state === "up" ? "bg-clear" : state === "down" ? "bg-fire" : "bg-muted-foreground/40")} />
      <span>{label}</span>
    </SidebarMenuButton>
  );
}

function NavGroup({ label, items }: { label: string; items: typeof PAGES }) {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ href, label: name, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton isActive={active} tooltip={name} render={<Link href={href} />}>
                  <Icon />
                  <span>{name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="EmberWatch" render={<Link href="/" />}>
              <Mark />
              <span className="font-semibold">EmberWatch</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Demo" items={PAGES} />
        <NavGroup label="Tools" items={TOOLS} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ApiStatus />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
