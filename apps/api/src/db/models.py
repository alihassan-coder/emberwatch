"""Database models. Names follow GLOSSARY.md (site, camera, frame, alert, review).

Enums are stored as plain text with a CHECK constraint (native_enum=False), so
they work the same on SQLite and PostgreSQL and adding a value is an ordinary
migration.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, Enum, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base, UTCDateTime, utcnow


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, native_enum=False, create_constraint=True, length=20,
                values_callable=lambda e: [m.value for m in e])


class AlertStatus(str, enum.Enum):
    NEEDS_REVIEW = "needs_review"
    CONFIRMED = "confirmed"
    DISMISSED = "dismissed"


class Verdict(str, enum.Enum):
    CONFIRMED = "confirmed"   # an operator says it's a fire
    DISMISSED = "dismissed"   # an operator says it isn't (with a reason)
    REOPENED = "reopened"     # an earlier decision was undone


class Channel(str, enum.Enum):
    SMS = "sms"
    EMAIL = "email"
    WEBHOOK = "webhook"


class DeliveryStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    SIMULATED = "simulated"   # recorded but not sent (no real channel configured)
    FAILED = "failed"


class Site(Base):
    """A physical location (tower, peak) where one or more cameras are mounted."""

    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    position_approximate: Mapped[bool] = mapped_column(Boolean, default=True)

    cameras: Mapped[list[Camera]] = relationship(back_populates="site")


class Camera(Base):
    """One fixed imager at a site, pointing in one direction."""

    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)  # e.g. "ferion-142"
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="RESTRICT"), index=True)
    heading: Mapped[float] = mapped_column(Float)              # compass degrees it faces
    fov: Mapped[float] = mapped_column(Float, default=87.0)    # horizontal field of view
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    site: Mapped[Site] = relationship(back_populates="cameras")


class ModelVersion(Base):
    """An exported model that scored frames; kept so every score is traceable."""

    __tablename__ = "model_versions"
    __table_args__ = (UniqueConstraint("name", "version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    version: Mapped[str] = mapped_column(String(40))
    sha256: Mapped[str | None] = mapped_column(String(64))
    threshold: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Frame(Base):
    """One scored photo from one camera."""

    __tablename__ = "frames"
    __table_args__ = (
        UniqueConstraint("camera_id", "taken_at"),           # the same photo can't be stored twice
        Index("ix_frames_camera_id_taken_at", "camera_id", "taken_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"))
    taken_at: Mapped[datetime] = mapped_column(UTCDateTime)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    image_path: Mapped[str | None] = mapped_column(String(300))
    score: Mapped[float] = mapped_column(Float)              # highest tile probability
    tiles: Mapped[list | None] = mapped_column(JSON)          # [{x, y, size, p}, ...]
    model_version_id: Mapped[int | None] = mapped_column(ForeignKey("model_versions.id", ondelete="SET NULL"))

    camera: Mapped[Camera] = relationship()
    model_version: Mapped[ModelVersion | None] = relationship()


class Alert(Base):
    """A plume raised to operators. One alert can be seen by several cameras."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # e.g. "A-2611"
    status: Mapped[AlertStatus] = mapped_column(_enum(AlertStatus, "alert_status"), default=AlertStatus.NEEDS_REVIEW, index=True)
    raised_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    # When a camera last saw this plume: the alert stays open while smoke keeps showing.
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    peak_score: Mapped[float] = mapped_column(Float)
    lat: Mapped[float | None] = mapped_column(Float)            # location estimate, when 2+ sites see it
    lon: Mapped[float | None] = mapped_column(Float)

    cameras: Mapped[list[AlertCamera]] = relationship(back_populates="alert", cascade="all, delete-orphan")
    reviews: Mapped[list[Review]] = relationship(
        back_populates="alert", cascade="all, delete-orphan", order_by="Review.created_at"
    )
    notifications: Mapped[list[Notification]] = relationship(back_populates="alert", cascade="all, delete-orphan")


class AlertCamera(Base):
    """A camera that sees an alert's plume, and the bearing from it."""

    __tablename__ = "alert_cameras"

    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True)
    bearing: Mapped[float] = mapped_column(Float)
    first_frame_id: Mapped[int | None] = mapped_column(ForeignKey("frames.id", ondelete="SET NULL"))

    alert: Mapped[Alert] = relationship(back_populates="cameras")
    camera: Mapped[Camera] = relationship()


class Review(Base):
    """One operator decision. Reviews are append-only: undoing adds a 'reopened' row."""

    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    verdict: Mapped[Verdict] = mapped_column(_enum(Verdict, "review_verdict"))
    reason: Mapped[str | None] = mapped_column(String(120))  # e.g. "Low cloud" when dismissed
    reviewer: Mapped[str] = mapped_column(String(80), default="operator")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    alert: Mapped[Alert] = relationship(back_populates="reviews")


class Notification(Base):
    """Outbox row: a message to send about an alert, and what happened when it was sent."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    channel: Mapped[Channel] = mapped_column(_enum(Channel, "notification_channel"))
    target: Mapped[str] = mapped_column(String(200))
    status: Mapped[DeliveryStatus] = mapped_column(
        _enum(DeliveryStatus, "delivery_status"), default=DeliveryStatus.PENDING, index=True
    )
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    error: Mapped[str | None] = mapped_column(Text)

    alert: Mapped[Alert] = relationship(back_populates="notifications")
