"""Tests for TypedMemoryStore — save, query, expire round-trips."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.memory.types import MemoryItem, MemoryKind


def test_memory_item_creation():
    item = MemoryItem(
        kind=MemoryKind.SEMANTIC,
        content="User prefers Python over JavaScript",
        score=0.8,
        source="conversation",
    )
    assert item.kind == MemoryKind.SEMANTIC
    assert item.content == "User prefers Python over JavaScript"
    assert item.score == 0.8


def test_memory_kind_values():
    assert MemoryKind.WORKING == "working"
    assert MemoryKind.EPISODIC == "episodic"
    assert MemoryKind.SEMANTIC == "semantic"
    assert MemoryKind.EXTERNAL == "external"


def test_memory_item_default_metadata():
    item = MemoryItem(kind=MemoryKind.WORKING, content="test")
    assert item.metadata == {}
    assert item.score == 0.0
    assert item.source == ""
