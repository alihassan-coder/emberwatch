import type { Metadata } from "next";
import { AnalyzeFrame } from "@/components/analyze/analyze-frame";

export const metadata: Metadata = { title: "Analyze a frame" };

export default function AnalyzePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">Analyze a frame</h1>
        <p className="mt-1 max-w-2xl text-contour">
          Check any camera image for smoke with the current model. Useful for a second look at an old frame, or for
          showing how detection works.
        </p>
      </header>
      <AnalyzeFrame />
    </div>
  );
}
