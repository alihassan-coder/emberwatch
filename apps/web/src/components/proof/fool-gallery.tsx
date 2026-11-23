"use client";

import { useState } from "react";
import { cn } from "cn";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RealFrame } from "@/components/frame/real-frame";
import { ALERT_THRESHOLD } from "@/lib/replay/engine";
import { GALLERY, type GalleryItem } from "@/lib/showcase";
import { CAPTIONS } from "@/lib/showcase-captions";
import { pct } from "@/lib/format";

type Kind = keyof typeof GALLERY;

const COPY: Record<Kind, { tab: string; title: string; body: string }> = {
  ignored: {
    tab: "It ignores these",
    title: "No smoke, no alarm",
    body: "Each of these fooled an earlier detection system in the field. EmberWatch scores them below the alert line.",
  },
  caught: {
    tab: "It catches these",
    title: "The smallest plumes in the test set",
    body: "Smoke that covers a tiny part of the picture, often many kilometres away. The outline shows where the model found it.",
  },
  missed: {
    tab: "Where it misses",
    title: "Honest misses",
    body: "The faintest plumes it scored lowest. Two smoke photos in a row are usually needed for an alert, so a single miss rarely loses a fire, but these show where the next model has to improve.",
  },
};

function Card({ item, kind }: { item: GalleryItem; kind: Kind }) {
  const raised = item.score >= ALERT_THRESHOLD;
  const caption = CAPTIONS[item.file];
  return (
    <figure className="overflow-hidden rounded-sm bg-card ring-1 ring-border">
      <RealFrame
        frame={item}
        base="/demo/showcase/"
        showTiles={kind !== "ignored"}
        subtle
        showBoxes={kind === "missed"}
        threshold={ALERT_THRESHOLD}
        alt={caption ?? `Frame from ${item.camera}`}
      />
      <figcaption className="space-y-1 px-3 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-paper">{caption ?? item.camera}</span>
          <span className={cn("font-heading text-2xl font-semibold", raised ? (kind === "ignored" ? "text-fire" : "text-suspect") : kind === "ignored" ? "text-clear" : "text-contour")}>
            {pct(item.score)}
          </span>
        </div>
        <p className="text-xs text-contour">
          {item.camera}
          {item.smoke_area_pct !== null && `, smoke covers ${item.smoke_area_pct < 0.1 ? "under 0.1" : item.smoke_area_pct.toFixed(1)}% of the picture`}
          {kind === "ignored" ? (raised ? ", would alert" : ", no alert") : raised ? ", caught" : ", missed"}
        </p>
      </figcaption>
    </figure>
  );
}

export function FoolGallery() {
  const [kind, setKind] = useState<Kind>("ignored");
  const items = GALLERY[kind];
  const tally = (k: Kind) =>
    k === "ignored" ? GALLERY[k].filter((i) => i.score < ALERT_THRESHOLD).length : GALLERY[k].filter((i) => i.score >= ALERT_THRESHOLD).length;

  return (
    <div className="space-y-6">
      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList>
          {(Object.keys(COPY) as Kind[]).map((k) => (
            <TabsTrigger key={k} value={k}>
              {COPY[k].tab}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="max-w-3xl">
        <h2 className="font-heading text-2xl font-semibold text-paper">{COPY[kind].title}</h2>
        <p className="mt-1 text-contour">
          {COPY[kind].body}{" "}
          {kind !== "missed" && `${tally(kind)} of ${items.length} ${kind === "ignored" ? "stayed quiet" : "were caught"}.`}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {items.map((item) => (
          <Card key={item.file} item={item} kind={kind} />
        ))}
      </div>
    </div>
  );
}
