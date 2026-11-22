import type { Metadata } from "next";
import Link from "next/link";
import { Camera, ScanSearch, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LiveDetection } from "@/components/live/live-detection";
import { VIDEO } from "@/lib/showcase";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  { icon: Camera, title: "A tower camera takes a photo", body: "Cameras on hilltops photograph the landscape about every 30 seconds." },
  { icon: ScanSearch, title: "The model checks it for smoke", body: "Every part of the photo is checked and given a smoke score." },
  { icon: BellRing, title: "The fire team is alerted", body: "If smoke shows in 2 of the last 3 photos, an alert goes out." },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Spot wildfire smoke within minutes</h1>
        <p className="text-muted-foreground">
          EmberWatch watches camera towers and tells the fire team as soon as smoke appears, before a 911 call would.
        </p>
      </header>

      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title}>
            <Card className="h-full">
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                  <Icon className="size-4" aria-hidden />
                </div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <section aria-labelledby="demo-title" className="space-y-4">
        <div className="space-y-1">
          <h2 id="demo-title" className="text-xl font-semibold">See it on real footage</h2>
          <p className="text-sm text-muted-foreground">
            A real tower camera ({VIDEO.camera}) watching the town and countryside. The model never saw this camera
            while training. Press play: smoke appears, the model spots it, and the alert goes out.
          </p>
        </div>
        <LiveDetection />
      </section>

      <div className="flex flex-wrap gap-2 border-t pt-6">
        <Button nativeButton={false} render={<Link href="/cameras" />}>Open the camera wall</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/results" />}>See how accurate it is</Button>
      </div>
    </div>
  );
}
