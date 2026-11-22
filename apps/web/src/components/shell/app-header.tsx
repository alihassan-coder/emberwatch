"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PAGES, TOOLS } from "./app-sidebar";

/** Slim header: the sidebar toggle (also Ctrl/Cmd+B) and the current page's name. */
export function AppHeader() {
  const pathname = usePathname();
  const page = [...PAGES, ...TOOLS].find((p) => (p.href === "/" ? pathname === "/" : pathname.startsWith(p.href)));
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <span className="text-sm font-medium">{page?.label ?? "EmberWatch"}</span>
    </header>
  );
}
