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
import { LogoMark } from "@/components/brand/logo";

/** Pages in the order a first-time visitor needs them. */
export const PAGES = [
  { href: "/", label: "How it works", icon: PlayCircle },
  { href: "/cameras", label: "Cameras", icon: Camera },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/results", label: "Results", icon: BarChart3 },
];
export const TOOLS = [{ href: "/analyze", label: "Check a photo", icon: ImageUp }];

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
              <LogoMark className="size-7 shrink-0" />
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
