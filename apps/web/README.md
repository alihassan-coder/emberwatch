# EmberWatch web

The operator console: Next.js 16 (App Router, Cache Components), Tailwind 4 and shadcn/ui (Base UI).

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

It talks to the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).

## Pages

| Route | What it's for |
|---|---|
| `/` Watch | Camera wall, Fire finder map (bearings cross at the location estimate), alerts needing review |
| `/alerts` | Review one alert: each camera's view, a filmstrip around the first alert, confirm fire or "not a fire" with a reason |
| `/analyze` | Upload any frame; the real API scores it and the page shows the per-tile smoke heatmap |
| `/model` | Results against targets, training data, known limits. A result shows as "training" until a run produces it |

Watch and Alerts run on a fixed demo scenario (`src/lib/demo-data.ts`) until the replay service exists; the header labels it "Replay demo". Frames are drawn ridge-line scenes, because HPWREN imagery can't be redistributed.

## Design

- **Palette "Spruce dusk":** a coloured night-ridge base for 24/7 watch shifts.
- **Colours mean states:** sage is clear, amber is possible smoke, red is confirmed fire.
- **Type:** Barlow, modelled on California road signs.
- **Signature element:** the Fire finder, named after the lookout tower's Osborne Fire Finder.
