import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertReview } from "@/components/alerts/alert-review";
import { AlertAnnouncer } from "@/components/replay/alert-announcer";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  // AlertReview reads ?id= from the URL, which is only known at request time.
  return (
    <Suspense fallback={<p className="text-contour">Loading alerts…</p>}>
      <AlertReview />
      <AlertAnnouncer />
    </Suspense>
  );
}
