import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/shell/app-shell";
import { AlertAnnouncer } from "@/components/replay/alert-announcer";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Barlow: modelled on road signage. Compact, legible numbers for live readouts.
const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "EmberWatch", template: "%s | EmberWatch" },
  description: "Wildfire smoke early warning from tower cameras.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) add attributes to <body> before React loads */}
      <body className="min-h-full" suppressHydrationWarning>
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <AlertAnnouncer />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
