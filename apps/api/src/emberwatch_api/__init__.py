def main() -> None:
    """`uv run emberwatch-api`: start the server on http://localhost:8000."""
    import uvicorn

    uvicorn.run("emberwatch_api.main:app", host="0.0.0.0", port=8000)
