"""Memory middleware — passes through to memory_service.py for persistence.

Memory writes are handled by memory_service.on_conversation_end() at WebSocket disconnect.
This middleware is kept as a no-op shell for the v2 execution engine middleware chain.
"""

from __future__ import annotations

import logging

from app.services.execution.engine import BaseMiddleware, ExecutionState

logger = logging.getLogger(__name__)


class MemoryMiddleware(BaseMiddleware):
    """No-op middleware — memory persistence handled by memory_service.on_conversation_end()."""

    async def after_agent(self, state: ExecutionState, response_content: str) -> None:
        """No-op. Memory extraction happens at WebSocket disconnect via memory_service."""
        pass
