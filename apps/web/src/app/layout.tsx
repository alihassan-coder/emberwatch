import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/shell/app-shell";
import { AlertAnnouncer } from "@/components/replay/alert-announcer";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "EmberWatch", template: "%s | EmberWatch" },
  description: "Wildfire smoke early warning from tower cameras.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
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
