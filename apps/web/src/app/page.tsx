import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, Camera, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScenarioPlayer } from "@/components/live/scenario-player";
import { MODEL_REPORT } from "@/lib/model-report";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  { icon: Camera, title: "A tower camera takes a photo", body: "Cameras on hilltops photograph the landscape about every 30 seconds." },
  { icon: ScanSearch, title: "The model checks it for smoke", body: "The photo is cut into tiles and each one gets a smoke score." },
  { icon: BellRing, title: "The fire team is alerted", body: "Smoke in 2 of the last 3 photos raises an alert for a person to confirm." },
];

const STACK = [
  { part: "Model", what: "Keras 3 EfficientNet-B0, trained on Kaggle GPUs, served as ONNX" },
  { part: "API", what: "FastAPI, SQLAlchemy with Alembic migrations, 34 tests" },
  { part: "Console", what: "Next.js 16 and shadcn/ui" },
];

export default function HowItWorksPage() {
  const metric = (unit: string) => MODEL_REPORT.metrics.find((m) => m.unit === unit)?.value ?? 0;
  const facts = [
    { value: pctOf(metric("%")), label: "of photos judged correctly, on cameras it never trained on" },
    { value: `${Math.round(metric("ms"))} ms`, label: "to check one photo on a laptop CPU" },
    { value: "2 of 3", label: "photos must show smoke before anyone is woken up" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-12">
      <header className="space-y-5">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Spot wildfire smoke within minutes</h1>
          <p className="text-muted-foreground">
            EmberWatch watches fire-watch tower cameras and tells the fire team as soon as smoke appears, often before
            the first 911 call.
          </p>
        </div>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label} className="flex items-baseline gap-2 sm:block">
              <dt className="sr-only">{f.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{f.value}</dd>
              <dd className="text-sm text-muted-foreground">{f.label}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section aria-labelledby="demo-title" className="space-y-4">
        <div className="space-y-1">
          <h2 id="demo-title" className="text-xl font-semibold">Watch it on real footage</h2>
          <p className="text-sm text-muted-foreground">Three recordings from French fire-watch towers. Pick one and press play.</p>
        </div>
        <ScenarioPlayer />
      </section>

      <section aria-labelledby="steps-title" className="space-y-4 border-t pt-8">
        <h2 id="steps-title" className="text-xl font-semibold">How it works</h2>
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums">{i + 1}</span>
              <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium">
                  {title}
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                </p>
                <p className="text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="stack-title" className="grid gap-6 border-t pt-8 md:grid-cols-[1fr_2fr]">
        <div className="space-y-3">
          <h2 id="stack-title" className="text-xl font-semibold">Under the hood</h2>
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link href="/cameras" />}>Open the camera wall</Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/results" />}>See how accurate it is</Button>
          </div>
        </div>
        <dl className="divide-y text-sm">
          {STACK.map((s) => (
            <div key={s.part} className="grid grid-cols-[6rem_1fr] gap-4 py-2.5 first:pt-0">
              <dt className="text-muted-foreground">{s.part}</dt>
              <dd>{s.what}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function pctOf(x: number) {
  return `${Math.round(x * 100)}%`;
}
