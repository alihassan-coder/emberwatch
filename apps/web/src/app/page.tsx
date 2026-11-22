import type { Metadata } from "next";
import { WatchConsole } from "@/components/watch/watch-console";

export const metadata: Metadata = { title: "Watch" };

export default function WatchPage() {
  return <WatchConsole />;
}
