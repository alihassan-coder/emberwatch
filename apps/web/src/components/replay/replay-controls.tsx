"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { replay, useReplay } from "@/lib/replay/store";

const SPEEDS = [1, 2, 4] as const;

/** Header controls for the replay: play/pause, speed, restart, and a scrubber over the frames. */
export function ReplayControls() {
  const r = useReplay();
  // A fixed date string, so this is the same on the server and in the browser.
  const day = new Date(`${r.day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="icon-sm" variant="outline" onClick={replay.toggle} aria-label={r.playing ? "Pause replay" : "Play replay"} />
          }
        >
          {r.playing ? <Pause /> : <Play />}
        </TooltipTrigger>
        <TooltipContent>{r.playing ? "Pause replay" : "Play replay"}</TooltipContent>
      </Tooltip>

      <div className="hidden items-center rounded-lg bg-muted p-0.5 sm:flex" role="group" aria-label="Replay speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => replay.setSpeed(s)}
            aria-pressed={r.speed === s}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-suspect",
              r.speed === s ? "bg-secondary text-paper" : "text-contour hover:text-paper",
            )}
          >
            {s}×
          </button>
        ))}
      </div>

      <input
        type="range"
        min={0}
        max={r.steps - 1}
        value={r.step}
        onChange={(e) => replay.seek(Number(e.target.value))}
        aria-label="Replay position"
        aria-valuetext={`Photo ${r.step + 1} of ${r.steps}`}
        className="hidden w-28 accent-[var(--suspect)] md:block lg:w-40"
      />

      <span className="whitespace-nowrap text-sm text-paper tabular-nums">
        {/* Each camera's tile shows its own real photo time; the replay itself only has a position. */}
        Photo {r.step + 1} of {r.steps}
        <span className="ml-2 hidden text-muted-foreground lg:inline">{day}</span>
      </span>

      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" onClick={replay.restart} aria-label="Restart replay" />}>
          <RotateCcw />
        </TooltipTrigger>
        <TooltipContent>Start over from the first photo and clear reviews</TooltipContent>
      </Tooltip>
    </div>
  );
}
