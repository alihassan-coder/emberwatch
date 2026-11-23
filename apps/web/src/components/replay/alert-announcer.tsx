"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useReplay } from "@/lib/replay/store";

/**
 * Pops a toast when the replay raises a new alert. A toast is an external
 * system, so announcing from an effect is the right tool here.
 */
export function AlertAnnouncer() {
  const { alerts } = useReplay();
  const router = useRouter();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Forget alerts that no longer exist (the replay restarted or was rewound).
    const ids = new Set(alerts.map((a) => a.id));
    seen.current.forEach((id) => !ids.has(id) && seen.current.delete(id));

    for (const a of alerts) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (a.verdict) continue;
      const n = a.cameraIds.length;
      toast.warning(`New alert ${a.id}`, {
        description: n > 1 ? `Smoke seen by ${n} cameras.` : `Smoke seen by ${a.cameraIds[0]}.`,
        action: { label: "Review", onClick: () => router.push(`/alerts?id=${a.id}`) },
      });
    }
  }, [alerts, router]);

  return null;
}
