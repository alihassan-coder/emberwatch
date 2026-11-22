import { cn } from "cn";
import { STATE_LABEL, STATE_TONE } from "@/lib/format";
import type { CameraState } from "@/lib/types";

export function StateChip({ state, className }: { state: CameraState; className?: string }) {
  const tone = STATE_TONE[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-ridge/70 px-2 py-0.5 text-xs font-medium",
        tone.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
      {STATE_LABEL[state]}
    </span>
  );
}
