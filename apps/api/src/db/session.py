"""Engine and sessions. One engine per process; one session per request."""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from src.config import load_settings


@lru_cache
def get_engine() -> Engine:
    url = load_settings().database_url
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        # FastAPI may use a session on a different thread than the one that opened it.
        kwargs["connect_args"] = {"check_same_thread": False}
        db_file = url.removeprefix("sqlite:///")
        if db_file and db_file != ":memory:":
            Path(db_file).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, **kwargs)

    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")   # SQLite ignores foreign keys unless asked
            cur.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
            cur.close()

    return engine


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def new_session() -> Session:
    return _session_factory()()


def get_session() -> Iterator[Session]:
    """FastAPI dependency: a session that commits on success and rolls back on error."""
    session = new_session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
