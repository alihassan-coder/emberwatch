import type { Metadata } from "next";
import { AnalyzeFrame } from "@/components/analyze/analyze-frame";

export const metadata: Metadata = { title: "Check a photo" };

export default function AnalyzePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">Check a photo</h1>
        <p className="mt-1 max-w-2xl text-contour">
          Run any camera photo through the live model and see which parts of it look like smoke.
        </p>
      </header>
      <AnalyzeFrame />
    </div>
  );
}
