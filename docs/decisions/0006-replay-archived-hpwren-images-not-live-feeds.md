# Replay archived HPWREN images instead of watching live feeds

HPWREN's terms (fetched 2026-11-21) require a licence from UC San Diego to fetch images less than 24 hours old automatically, or to run models on live feeds. This applies to non-commercial users too.

So the demo uses replay:
- archived frames that are at least 24 hours old (the archive keeps about 90 days);
- FIgLib fire sequences.

The pipeline is built so that a licensed live source can be plugged in later, as one more camera source.

See `docs/research/04-live-cameras-and-geometry.md`.
