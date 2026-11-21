# Which datasets may train a shipped model, and which may only evaluate one

Datasets are sorted by licence:

- **Pyro-SDIS** (Apache-2.0, pinned to tag `v2.0`) is the only smoke-box dataset we found that is fully clear for commercial use. It trains the detector.
- **FIgLib and archived HPWREN imagery** (CC BY-NC, with a no-fee permission for commercial use) are used for temporal training and for measuring time to detect. They stay in private storage, are credited, and are never redistributed. Commercial use requires registering with HPWREN first.
- **PYRONEAR-2025, AI For Mankind, Nemo and Fuego** have non-commercial, share-alike or unclear licences. They are used **only** for evaluation. Weights trained on them are never shipped.

See `docs/research/01-datasets.md`.
