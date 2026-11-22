import type { Metadata } from "next";
import { FoolGallery } from "@/components/proof/fool-gallery";

export const metadata: Metadata = { title: "Try to fool it" };

export default function ProofPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-paper">Try to fool it</h1>
        <p className="mt-1 max-w-3xl text-contour">
          Fog, low cloud, sunsets and glare are why most smoke detectors cry wolf. Every frame here is real, from
          camera sites the model never saw while training, with the score it actually gave.
        </p>
      </header>
      <FoolGallery />
    </div>
  );
}
