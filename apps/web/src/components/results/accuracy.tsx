import { cn } from "cn";
import { MODEL_REPORT, type Metric } from "@/lib/model-report";

function show(value: number, unit: Metric["unit"]) {
  if (unit === "%") return `${Math.round(value * 100)}%`;
  if (unit === "min") return `${value.toFixed(1)} min`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  return `${value.toFixed(2)} / day`;
}

/** A bullet bar: the track, the target mark, and the measured value once there is one. */
function MetricRow({ m }: { m: Metric }) {
  const max = m.unit === "%" ? 1 : m.target * 2;
  const meets = m.value === null ? null : m.better === "higher" ? m.value >= m.target : m.value <= m.target;
  const at = (v: number) => `${Math.min(100, (v / max) * 100)}%`;

  return (
    <li className="grid gap-x-8 gap-y-3 border-t border-border py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <h3 className="text-lg font-medium text-paper">{m.name}</h3>
        <p className="mt-1 text-sm text-contour">{m.explain}</p>
      </div>
      <div className="self-center">
        <div className="flex items-baseline justify-between gap-4">
          <span
            className={cn(
              "font-heading font-semibold",
              meets === null ? "text-xl text-contour" : meets ? "text-4xl text-clear" : "text-4xl text-suspect",
            )}
          >
            {m.value === null ? "Being measured" : show(m.value, m.unit)}
          </span>
          <span className="text-right text-sm text-contour">
            Target {m.better === "higher" ? "at least" : "at most"} {show(m.target, m.unit)}
            {m.reference && (
              <>
                <br />
                {m.reference}
              </>
            )}
          </span>
        </div>
        <div className="relative mt-3 h-2 rounded-full bg-muted" aria-hidden>
          {m.value !== null && (
            <div className={cn("h-full rounded-full", meets ? "bg-clear" : "bg-suspect")} style={{ width: at(m.value) }} />
          )}
          <div className="absolute -top-1 h-4 w-0.5 bg-paper" style={{ left: at(m.target) }} />
        </div>
      </div>
    </li>
  );
}

export function Accuracy() {
  const r = MODEL_REPORT;
  return (
    <div className="max-w-5xl space-y-10">
      <header>
        <p className="text-muted-foreground">
          {r.model}. {r.status}. Every number here is measured on cameras and fires the model never saw while
          training.
        </p>
      </header>

      <section aria-labelledby="results-title">
        <h2 id="results-title" className="font-heading text-2xl font-semibold text-paper">
          Results against targets
        </h2>
        <ul className="mt-2">
          {r.metrics.map((m) => (
            <MetricRow key={m.name} m={m} />
          ))}
        </ul>
      </section>

      <div className="grid gap-10 md:grid-cols-2">
        <section aria-labelledby="data-title">
          <h2 id="data-title" className="font-heading text-2xl font-semibold text-paper">
            What it learned from
          </h2>
          <dl className="mt-4 space-y-4">
            {r.data.map((d) => (
              <div key={d.label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
                <dt className="font-heading text-3xl font-semibold text-paper">{d.value}</dt>
                <dd>
                  <span className="text-paper">{d.label}</span>
                  <span className="block text-sm text-contour">{d.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="limits-title">
          <h2 id="limits-title" className="font-heading text-2xl font-semibold text-paper">
            Where it may struggle
          </h2>
          <ul className="mt-4 space-y-3">
            {r.limits.map((l) => (
              <li key={l} className="border-l-2 border-suspect/50 pl-4 text-paper">
                {l}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-contour">
            Data courtesy of HPWREN, University of California San Diego, and Pyronear with French fire services.
          </p>
        </section>
      </div>
    </div>
  );
}
