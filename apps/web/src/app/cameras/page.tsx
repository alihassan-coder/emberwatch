import type { Metadata } from "next";
import { AlertAnnouncer } from "@/components/replay/alert-announcer";
import { WatchConsole } from "@/components/watch/watch-console";

export const metadata: Metadata = { title: "Cameras" };

export default function CamerasPage() {
  return (
    <>
      <WatchConsole />
      <AlertAnnouncer />
    </>
  );
}
