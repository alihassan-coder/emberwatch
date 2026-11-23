"""Database versions: every migration must go up and come back down cleanly."""

from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect

from tests.conftest import alembic_config

TABLES = {"sites", "cameras", "model_versions", "frames", "alerts", "alert_cameras", "reviews", "notifications"}


def _tables(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names()) - {"alembic_version"}
    finally:
        engine.dispose()


def test_upgrade_creates_every_table(db_url):
    command.upgrade(alembic_config(), "head")
    assert _tables(db_url) == TABLES


def test_downgrade_to_empty_then_upgrade_again(db_url):
    cfg = alembic_config()
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    assert _tables(db_url) == set()
    command.upgrade(cfg, "head")
    assert _tables(db_url) == TABLES


def test_each_migration_steps_down_and_up(db_url):
    cfg = alembic_config()
    revisions = list(ScriptDirectory.from_config(cfg).walk_revisions("base", "heads"))
    assert len(revisions) >= 2
    command.upgrade(cfg, "head")
    for _ in revisions:                     # step down one version at a time...
        command.downgrade(cfg, "-1")
    for _ in revisions:                     # ...and back up one at a time
        command.upgrade(cfg, "+1")
    assert _tables(db_url) == TABLES


def test_constraints_have_predictable_names(migrated):
    engine = create_engine(migrated)
    try:
        insp = inspect(engine)
        assert insp.get_pk_constraint("alerts")["name"] == "pk_alerts"
        assert "uq_alerts_code" in {u["name"] for u in insp.get_unique_constraints("alerts")}
        assert "ck_alerts_alert_status" in {c["name"] for c in insp.get_check_constraints("alerts")}
        assert "ix_alerts_last_seen_at" in {i["name"] for i in insp.get_indexes("alerts")}
    finally:
        engine.dispose()
