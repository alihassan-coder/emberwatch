import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { STATE_LABEL, STATE_TONE, type CameraState } from "@/lib/format";

export function StateChip({ state, className }: { state: CameraState; className?: string }) {
  const tone = STATE_TONE[state];
  return (
    <Badge variant="secondary" className={cn("gap-1.5 bg-ridge/75 backdrop-blur-sm", tone.text, className)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
      {STATE_LABEL[state]}
    </Badge>
  );
}
