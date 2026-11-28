# EmberWatch web

The operator console: Next.js 16 (App Router, Cache Components), Tailwind 4 and shadcn/ui (Base UI), in the plain shadcn neutral theme.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

It talks to the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). The sidebar shows whether the model is online.

## Pages

| Route | What it's for |
|---|---|
| `/` How it works | The idea in three steps, then real tower footage to play: smoke behind a town, a fire on a forest ridge, and a faint plume the model misses |
| `/cameras` | Six real towers replaying one day, each with its smoke score, plus the alerts that need review |
| `/alerts` | Review an alert: each camera's view, every photo so far, the fire finder map where bearings cross, confirm or dismiss with a reason |
| `/results` | Measured accuracy against targets, and "Try to fool it": clouds and fog it ignores, smoke it catches, smoke it misses |
| `/analyze` Check a photo | Upload any photo (or pick a sample); the real API scores it and the page shows the per-tile smoke scores |

## How the demos work

- **How it works** plays short videos built by `ml/src/data/showcase.py` from Pyro-SDIS footage, scored by the real model. Each video's photo-by-photo scores are in `src/data/demo/scenarios/<id>.json`, and the page syncs them to playback.
- **Cameras** and **Alerts** run a replay in the browser (`src/lib/replay/`), so the demo works without the API. A pure `snapshotAt(timeline, step, reviews)` function decides what each camera shows and which alerts exist, so the same moment always looks the same. Its alert rules are a port of the API's (`apps/api/src/services/alerts.py`), and a contract test pins both to `src/data/demo/expected_alerts.json`, so the browser and the backend always raise the same alerts.
- **Check a photo** is the one page that calls the API.

## Tests

```bash
pnpm test        # Vitest: replay engine, event log, geometry, demo scenarios, contract with the API
```

## Images

Camera photos are from [Pyro-SDIS](https://huggingface.co/datasets/pyronear/pyro-sdis) (Pyronear and the French SDIS fire services, Apache-2.0), resized for the web. See `public/demo/*/ATTRIBUTION.md`.
