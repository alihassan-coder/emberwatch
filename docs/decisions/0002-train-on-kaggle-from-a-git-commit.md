# Train on Kaggle, from an exact git commit

The development laptop has no GPU, 7 GB of RAM, and a connection that downloads very slowly from PyPI and Hugging Face. So all heavy work runs as Kaggle jobs: dataset downloads, training, and embedding extraction.

`scripts/kaggle_run.sh` pushes the current commit to GitHub. The Kaggle job then:
1. clones that exact commit;
2. installs the dependencies listed in `ml/pyproject.toml`;
3. writes `env.json`;
4. runs one module.

The same code also runs locally, where only the paths differ (`src/common/env.py`).

We chose this over writing code inside notebooks because it keeps the code reviewable in the repo, and because every result can be traced back to a commit.
