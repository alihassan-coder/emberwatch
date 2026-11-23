"use client";

import { useState } from "react";
import { cn } from "cn";
import { LiveDetection } from "@/components/live/live-detection";
import { SCENARIOS, type Scenario } from "@/lib/showcase";

/** A row of real-footage scenarios to pick from, and the player for the chosen one. */
export function ScenarioPlayer() {
  const [id, setId] = useState<Scenario["id"]>(SCENARIOS[0].id);
  const scenario = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Choose footage" className="grid gap-2 sm:grid-cols-3">
        {SCENARIOS.map((s) => {
          const selected = s.id === id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setId(s.id)}
              className={cn(
                "rounded-lg border px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-foreground bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="block text-sm font-medium">{s.title}</span>
              <span className={cn("block text-xs", s.id === "faint" ? "text-suspect" : "text-muted-foreground")}>{s.hint}</span>
            </button>
          );
        })}
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {scenario.story} Camera <span className="text-foreground">{scenario.video.camera}</span>, which the model never saw while training.
      </p>
      {/* key: a new scenario starts from its first photo with a fresh player */}
      <LiveDetection key={scenario.id} scenario={scenario} />
    </div>
  );
}
