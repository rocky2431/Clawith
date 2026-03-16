"""Context middleware — tiered L0/L1/L2 context budget allocation.

Replaces the hard 3000-char truncation in agent_context.py with intelligent
budget-based context loading inspired by OpenViking's tiered model.
"""

from __future__ import annotations

import logging
from enum import IntEnum
from pathlib import Path
from typing import Protocol

from app.services.execution.engine import BaseMiddleware, ExecutionState

logger = logging.getLogger(__name__)


class ContextTier(IntEnum):
    L0 = 0  # Always loaded — identity, role, time
    L1 = 1  # Essential — soul, skills index, relationships, triggers
    L2 = 2  # Relevant — memory, company KB, channel docs (on-demand)


# ── Context provider protocol ──────────────────────────────

class ContextProvider(Protocol):
    """Interface for loading agent context at different tiers."""

    async def load_l0(self, agent_id: str, **kwargs) -> str:
        """Identity, role, current time, user info. Never truncated."""
        ...

    async def load_l1(self, agent_id: str, budget_tokens: int = 2000, **kwargs) -> str:
        """Soul personality, skills index, relationships, triggers."""
        ...

    async def load_l2(self, agent_id: str, query: str | None = None, budget_tokens: int = 4000, **kwargs) -> str:
        """Memory, company KB, channel docs. Relevance-ranked."""
        ...


# ── File-based context provider (default) ──────────────────

def _read_safe(path: Path, max_chars: int) -> str:
    """Read a file, truncate to max_chars. Return empty string on error."""
    try:
        if not path.exists():
            return ""
        content = path.read_text(encoding="utf-8", errors="replace")
        if len(content) > max_chars:
            content = content[:max_chars] + "\n... (truncated)"
        return content
    except Exception as e:
        logger.debug("Failed to read %s: %s", path, e)
        return ""


# Rough chars-per-token estimate (conservative for CJK-heavy content)
_CHARS_PER_TOKEN = 3


class FileContextProvider:
    """Loads context from the local agent_data filesystem."""

    def __init__(self, agent_data_dir: str) -> None:
        self.base_dir = Path(agent_data_dir)

    def _agent_dir(self, agent_id: str) -> Path:
        return self.base_dir / agent_id

    async def load_l0(self, agent_id: str, **kwargs) -> str:
        """Identity block — always loaded, never truncated."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        agent_dir = self._agent_dir(agent_id)
        soul_first_line = ""
        soul_path = agent_dir / "soul.md"
        if soul_path.exists():
            try:
                soul_first_line = soul_path.read_text(encoding="utf-8").split("\n")[0]
            except Exception as e:
                logger.debug("Failed to read soul.md first line: %s", e)
        return f"Current time: {now}\nAgent: {soul_first_line}"

    async def load_l1(self, agent_id: str, budget_tokens: int = 2000, **kwargs) -> str:
        """Soul, skills index, relationships, triggers, focus."""
        budget_chars = budget_tokens * _CHARS_PER_TOKEN
        agent_dir = self._agent_dir(agent_id)
        parts: list[str] = []
        remaining = budget_chars

        # Soul (highest priority in L1)
        soul = _read_safe(agent_dir / "soul.md", min(remaining, 2000))
        if soul:
            parts.append(f"## Soul\n{soul}")
            remaining -= len(soul)

        # Skills index (names only)
        skills_dir = agent_dir / "skills"
        if skills_dir.exists() and remaining > 200:
            skill_names = [d.name for d in skills_dir.iterdir() if d.is_dir()]
            if skill_names:
                idx = "## Available Skills\n" + ", ".join(skill_names)
                parts.append(idx[:remaining])
                remaining -= len(idx)

        # Relationships
        rel = _read_safe(agent_dir / "relationships.md", min(remaining, 500))
        if rel:
            parts.append(f"## Relationships\n{rel}")
            remaining -= len(rel)

        # Focus items
        focus = _read_safe(agent_dir / "focus.md", min(remaining, 500))
        if focus:
            parts.append(f"## Current Focus\n{focus}")
            remaining -= len(focus)

        return "\n\n".join(parts)

    async def load_l2(self, agent_id: str, query: str | None = None, budget_tokens: int = 4000, **kwargs) -> str:
        """Memory and extended context — loaded when budget allows."""
        budget_chars = budget_tokens * _CHARS_PER_TOKEN
        agent_dir = self._agent_dir(agent_id)
        parts: list[str] = []
        remaining = budget_chars

        # Memory (highest priority in L2)
        memory_path = agent_dir / "memory" / "memory.md"
        memory_json = agent_dir / "memory" / "memory.json"
        if memory_json.exists():
            mem = _read_safe(memory_json, min(remaining, 3000))
        else:
            mem = _read_safe(memory_path, min(remaining, 3000))
        if mem:
            parts.append(f"## Memory\n{mem}")
            remaining -= len(mem)

        return "\n\n".join(parts)


# ── Context middleware ─────────────────────────────────────

class ContextMiddleware(BaseMiddleware):
    """Assembles tiered agent context with budget allocation.

    Budget strategy:
      L0: 500 tokens (fixed, never truncated)
      L1: 2000 tokens (essential context)
      L2: remaining budget after messages (on-demand)
    """

    L0_BUDGET = 500
    L1_BUDGET = 2000

    def __init__(self, provider: ContextProvider | None = None) -> None:
        self._provider = provider

    def _get_provider(self) -> ContextProvider:
        if self._provider:
            return self._provider
        from app.config import get_settings
        return FileContextProvider(get_settings().AGENT_DATA_DIR)

    async def before_agent(self, state: ExecutionState) -> ExecutionState:
        """Assemble tiered context and set as system_prompt."""
        provider = self._get_provider()
        agent_id = str(state.agent_id)

        # Calculate L2 budget based on remaining context window
        # Rough estimate: each message ~100 tokens average
        message_tokens = len(state.messages) * 100
        l2_budget = max(0, state.context_budget - self.L0_BUDGET - self.L1_BUDGET - message_tokens)

        # Load tiers
        l0 = await provider.load_l0(agent_id)
        l1 = await provider.load_l1(agent_id, budget_tokens=self.L1_BUDGET)
        l2 = ""
        if l2_budget > 0:
            query = None
            if state.messages:
                last_user = next((m["content"] for m in reversed(state.messages) if m.get("role") == "user"), None)
                query = last_user
            l2 = await provider.load_l2(agent_id, query=query, budget_tokens=l2_budget)

        # Compose system prompt (preserve any existing prompt as prefix)
        context_parts = [p for p in [state.system_prompt, l0, l1, l2] if p]
        state.system_prompt = "\n\n".join(context_parts)

        logger.debug(
            "Context assembled for agent %s: L0=%d L1=%d L2=%d chars (budget: %d tokens)",
            agent_id, len(l0), len(l1), len(l2), state.context_budget,
        )
        return state
