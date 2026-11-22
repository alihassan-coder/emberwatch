import type { Metadata } from "next";
import { Accuracy } from "@/components/results/accuracy";
import { ResultsTabs } from "@/components/results/results-tabs";
import { FoolGallery } from "@/components/proof/fool-gallery";

export const metadata: Metadata = { title: "Results" };

export default function ResultsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Results</h1>
        <p className="text-muted-foreground">
          How well the model works, measured on cameras it never saw while training.
        </p>
      </header>
      <ResultsTabs accuracy={<Accuracy />} examples={<FoolGallery />} />
    </div>
  );
}
