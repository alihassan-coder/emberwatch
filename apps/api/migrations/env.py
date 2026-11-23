"""Alembic migration environment.

Commands (from apps/api):
    uv run alembic upgrade head                          # bring the database up to date
    uv run alembic revision --autogenerate -m "message"  # after changing src/db/models.py
    uv run alembic downgrade -1                          # step one migration back
    uv run alembic history                               # list all versions

The database URL comes from EMBERWATCH_DATABASE_URL (default: local SQLite),
so the same migrations run on PostgreSQL later.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context

from src.config import load_settings
from src.db import Base, get_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _options(dialect_name: str) -> dict:
    return {
        "target_metadata": target_metadata,
        "compare_type": True,                       # detect column type changes
        # SQLite can't ALTER most things in place; batch mode rebuilds the table.
        "render_as_batch": dialect_name == "sqlite",
    }


def run_migrations_offline() -> None:
    """Write the SQL to stdout instead of running it (alembic upgrade head --sql)."""
    url = load_settings().database_url
    context.configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"},
                      **_options(url.split(":", 1)[0].split("+", 1)[0]))
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = get_engine()
    with engine.connect() as connection:
        context.configure(connection=connection, **_options(engine.dialect.name))
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
