"""Structured memory middleware — debounced async extraction with confidence scoring and decay.

Replaces raw memory.md read/write with structured memory.json containing
categorized facts with confidence, decay, and access tracking.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.services.execution.engine import BaseMiddleware, ExecutionState

logger = logging.getLogger(__name__)

DECAY_THRESHOLD = 0.1
MEMORY_DEBOUNCE_SECONDS = 30


@dataclass
class MemoryFact:
    """A discrete fact extracted from conversation."""

    id: str
    content: str
    category: str  # preference, knowledge, relationship, decision, goal
    confidence: float = 0.8
    decay_rate: float = 0.05
    created_at: float = field(default_factory=time.time)
    last_accessed: float = field(default_factory=time.time)
    access_count: int = 1
    source: str = ""  # conversation_id or trigger

    def relevance(self) -> float:
        """Calculate current relevance score with time decay."""
        days_since_access = (time.time() - self.last_accessed) / 86400
        return self.confidence * (1 - self.decay_rate) ** days_since_access * math.log(self.access_count + 1)

    def touch(self) -> None:
        """Mark this fact as accessed."""
        self.last_accessed = time.time()
        self.access_count += 1


@dataclass
class AgentMemory:
    """Structured agent memory with summaries and discrete facts."""

    version: str = "1.0"
    last_updated: float = field(default_factory=time.time)
    work_context: str = ""      # What the agent is currently working on
    personal_context: str = ""  # User preferences, communication style
    top_of_mind: str = ""       # 1-3 sentence summary of most important recent items
    facts: list[MemoryFact] = field(default_factory=list)

    def prune(self) -> int:
        """Remove facts below relevance threshold. Returns count removed."""
        before = len(self.facts)
        self.facts = [f for f in self.facts if f.relevance() >= DECAY_THRESHOLD]
        removed = before - len(self.facts)
        if removed > 0:
            logger.info("Pruned %d stale memory facts", removed)
        return removed

    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, data: dict) -> AgentMemory:
        facts_raw = data.get("facts", [])
        facts = [MemoryFact(**f) for f in facts_raw]
        return cls(
            version=data.get("version", "1.0"),
            last_updated=data.get("last_updated", time.time()),
            work_context=data.get("work_context", ""),
            personal_context=data.get("personal_context", ""),
            top_of_mind=data.get("top_of_mind", ""),
            facts=facts,
        )


def _memory_path(agent_data_dir: str, agent_id: str) -> Path:
    return Path(agent_data_dir) / agent_id / "memory" / "memory.json"


def _legacy_memory_path(agent_data_dir: str, agent_id: str) -> Path:
    return Path(agent_data_dir) / agent_id / "memory" / "memory.md"


def load_memory(agent_data_dir: str, agent_id: str) -> AgentMemory:
    """Load structured memory, migrating from memory.md if needed."""
    json_path = _memory_path(agent_data_dir, agent_id)
    if json_path.exists():
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
            mem = AgentMemory.from_dict(data)
            mem.prune()
            return mem
        except Exception as e:
            logger.error("Failed to load memory.json for agent %s: %s", agent_id, e)

    # Fallback: migrate from memory.md
    md_path = _legacy_memory_path(agent_data_dir, agent_id)
    mem = AgentMemory()
    if md_path.exists():
        try:
            content = md_path.read_text(encoding="utf-8")
            if content.strip():
                mem.work_context = content[:2000]
                logger.info("Migrated memory.md to structured memory for agent %s", agent_id)
        except Exception as e:
            logger.error("Failed to read memory.md for agent %s: %s", agent_id, e)
    return mem


def save_memory(agent_data_dir: str, agent_id: str, memory: AgentMemory) -> None:
    """Save structured memory to memory.json."""
    json_path = _memory_path(agent_data_dir, agent_id)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    memory.last_updated = time.time()
    # Atomic write: write to temp file then rename
    tmp_path = json_path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(memory.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.rename(json_path)


# ── Debounced memory update queue ──────────────────────────

_pending_updates: dict[str, tuple[list[dict], float]] = {}  # agent_id -> (messages, scheduled_at)
_queue_lock = asyncio.Lock()


async def _queue_memory_update(agent_id: str, messages: list[dict]) -> None:
    """Queue a memory extraction for later (debounced)."""
    async with _queue_lock:
        _pending_updates[agent_id] = (messages, time.time() + MEMORY_DEBOUNCE_SECONDS)


async def process_pending_memory_updates(agent_data_dir: str) -> None:
    """Process pending memory updates (called by background task)."""
    now = time.time()
    ready: list[tuple[str, list[dict]]] = []

    async with _queue_lock:
        for agent_id, (messages, scheduled_at) in list(_pending_updates.items()):
            if now >= scheduled_at:
                ready.append((agent_id, messages))
                del _pending_updates[agent_id]

    for agent_id, messages in ready:
        try:
            mem = load_memory(agent_data_dir, agent_id)
            # Extract key points from the conversation as facts
            for msg in messages:
                if msg.get("role") == "user":
                    content = msg.get("content", "")
                    if content and len(content) > 20:
                        fact = MemoryFact(
                            id=f"conv_{int(time.time())}_{hash(content) % 10000}",
                            content=content[:500],
                            category="knowledge",
                            confidence=0.6,
                            source="conversation",
                        )
                        mem.facts.append(fact)
            mem.prune()
            save_memory(agent_data_dir, agent_id, mem)
            logger.info("Processed memory update for agent %s (%d facts)", agent_id, len(mem.facts))
        except Exception as e:
            logger.error("Failed to process memory update for agent %s: %s", agent_id, e)


# ── Middleware ─────────────────────────────────────────────

class MemoryMiddleware(BaseMiddleware):
    """Debounced async memory extraction after agent conversation completion."""

    async def after_agent(self, state: ExecutionState, response_content: str) -> None:
        """Queue memory extraction (debounced, non-blocking)."""
        # Filter messages: keep only user + final assistant (no tool calls)
        filtered = [
            m for m in state.messages
            if m.get("role") in ("user", "assistant") and "tool_calls" not in m
        ]
        if not filtered:
            return

        agent_id = str(state.agent_id)
        await _queue_memory_update(agent_id, filtered)
        logger.debug("Queued memory update for agent %s (%d messages)", agent_id, len(filtered))
