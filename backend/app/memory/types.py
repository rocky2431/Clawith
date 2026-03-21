"""Lightweight memory layer types used by the compatibility store."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class MemoryKind(StrEnum):
    WORKING = "working"
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    EXTERNAL = "external"


@dataclass(slots=True)
class MemoryItem:
    """Unified memory item returned by the retrieval pipeline."""

    kind: MemoryKind
    content: str
    score: float = 0.0
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class WorkingMemory:
    content: str = ""
    source: str = "focus"


@dataclass(slots=True)
class EpisodicMemory:
    summary: str = ""
    session_id: str | None = None


@dataclass(slots=True)
class SemanticMemory:
    subject: str = ""
    content: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ExternalMemoryRef:
    source: str
    content: str
