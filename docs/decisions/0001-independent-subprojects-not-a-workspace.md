# Independent sub-projects, not a uv workspace

`ml/` and `apps/api/` are separate uv projects, each with its own `pyproject.toml`, `uv.lock` and `.venv`. There is no shared root workspace.

Training needs Keras, JAX and TensorFlow (gigabytes). The API needs only FastAPI and ONNX Runtime. A shared workspace would put both into one environment and make the API's Docker image heavy.

The projects talk to each other only through files and HTTP:
- `ml/` hands the API an exported `.onnx` model plus a JSON file that describes its outputs.
- The web app generates its TypeScript types from the API's OpenAPI schema.

No code is shared between them.
