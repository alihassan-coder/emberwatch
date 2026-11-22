import type { Metadata } from "next";
import { LiveDetection } from "@/components/live/live-detection";

export const metadata: Metadata = { title: "Live detection" };

export default function LivePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">From first smoke to alert</h1>
        <p className="mt-1 max-w-3xl text-contour">
          Real tower-camera footage of a fire starting, played back as a time-lapse. Every frame is scored by the
          model as it plays; the alert goes out the moment the rule passes.
        </p>
      </header>
      <LiveDetection />
    </div>
  );
}
