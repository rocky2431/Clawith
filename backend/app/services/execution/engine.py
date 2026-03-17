"""Agent execution engine — middleware-wrapped tool loop.

Replaces the monolithic call_llm function in websocket.py with a composable,
middleware-driven execution model inspired by deer-flow's architecture.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


# ── Callbacks for real-time streaming ──────────────────────

@dataclass
class ExecutionCallbacks:
    """Callbacks for streaming execution events to the client."""

    on_chunk: Callable[[str], Coroutine] | None = None           # Text delta
    on_tool_call: Callable[[str, dict, str], Coroutine] | None = None  # name, args, status
    on_thinking: Callable[[str], Coroutine] | None = None        # Reasoning delta
    on_info: Callable[[str], Coroutine] | None = None            # Info messages
    on_progress: Callable[[str, float, str], Coroutine] | None = None  # tool, progress, message


# ── Execution state shared across middleware ───────────────

@dataclass
class ExecutionState:
    """Mutable context passed through the middleware chain."""

    agent_id: uuid.UUID
    tenant_id: uuid.UUID | None
    user_id: uuid.UUID | None
    messages: list[dict]              # Full conversation [{role, content, ...}]
    tools: list[dict]                 # Available tool definitions
    system_prompt: str                # Assembled system prompt
    llm_config: dict                  # provider, model, api_key, base_url, etc.
    fallback_llm_config: dict | None = None
    round_number: int = 0
    max_rounds: int = 30
    accumulated_tokens: int = 0
    context_budget: int = 8000        # Max tokens for context window
    metadata: dict[str, Any] = field(default_factory=dict)  # Middleware storage
    callbacks: ExecutionCallbacks = field(default_factory=ExecutionCallbacks)
    cancelled: asyncio.Event = field(default_factory=asyncio.Event)


# ── Middleware protocol ────────────────────────────────────

@runtime_checkable
class AgentMiddleware(Protocol):
    """Composable middleware for agent execution.

    Each method is optional (defaults to no-op).
    Middleware is called in order for before_agent/after_tool_call,
    and in reverse order for after_agent/on_error.
    """

    async def before_agent(self, state: ExecutionState) -> ExecutionState | None:
        """Called before LLM invocation. Can modify state or short-circuit (return None to skip)."""
        ...

    async def after_tool_call(
        self, state: ExecutionState, tool_name: str, tool_args: dict, result: str,
    ) -> str | None:
        """Called after each tool execution. Return modified result or None for unchanged."""
        ...

    async def after_agent(self, state: ExecutionState, response_content: str) -> None:
        """Called after LLM produces final response. For async side effects."""
        ...

    async def on_error(self, state: ExecutionState, error: Exception) -> str | None:
        """Called on error. Return string to substitute response, None to re-raise."""
        ...


class BaseMiddleware:
    """No-op base class for middleware — override only the hooks you need."""

    async def before_agent(self, state: ExecutionState) -> ExecutionState | None:
        return state

    async def after_tool_call(
        self, state: ExecutionState, tool_name: str, tool_args: dict, result: str,
    ) -> str | None:
        return None

    async def after_agent(self, state: ExecutionState, response_content: str) -> None:
        pass

    async def on_error(self, state: ExecutionState, error: Exception) -> str | None:
        return None


# ── Execution engine ───────────────────────────────────────

class AgentExecutionEngine:
    """Middleware-wrapped agent execution loop.

    Usage:
        engine = AgentExecutionEngine(middlewares=[...])
        result = await engine.execute(state)
    """

    def __init__(self, middlewares: list[BaseMiddleware] | None = None) -> None:
        self.middlewares = middlewares or []

    async def execute(self, state: ExecutionState) -> str:
        """Run the agent execution loop with middleware hooks.

        Returns the final assistant response content.
        """
        import json as _json
        from app.services.llm_client import LLMMessage, create_llm_client

        # Run before_agent hooks
        for mw in self.middlewares:
            result = await mw.before_agent(state)
            if result is None:
                logger.info("Middleware %s short-circuited execution", type(mw).__name__)
                return ""
            state = result

        # Create LLM client
        client = create_llm_client(**state.llm_config)
        final_content = ""

        try:
            for round_i in range(state.max_rounds):
                if state.cancelled.is_set():
                    logger.info("Execution cancelled for agent %s at round %d", state.agent_id, round_i)
                    break

                state.round_number = round_i

                # Build LLMMessage list from state
                api_messages = [LLMMessage(role="system", content=state.system_prompt)]
                for msg in state.messages:
                    api_messages.append(LLMMessage(
                        role=msg.get("role", "user"),
                        content=msg.get("content"),
                        tool_calls=msg.get("tool_calls"),
                        tool_call_id=msg.get("tool_call_id"),
                        reasoning_content=msg.get("reasoning_content"),
                    ))

                # Call LLM via streaming API
                response = await client.stream(
                    messages=api_messages,
                    tools=state.tools if state.tools else None,
                    on_chunk=state.callbacks.on_chunk,
                    on_thinking=state.callbacks.on_thinking,
                )

                content = response.content or ""
                tool_calls = response.tool_calls

                # No tool calls — we're done
                if not tool_calls:
                    final_content = content
                    break

                # Process tool calls
                state.messages.append({
                    "role": "assistant",
                    "content": content or None,
                    "tool_calls": [{"id": tc["id"], "type": "function", "function": tc["function"]} for tc in tool_calls],
                    "reasoning_content": response.reasoning_content,
                })

                for tc in tool_calls:
                    fn = tc.get("function", {})
                    tool_name = fn.get("name", "")
                    raw_args = fn.get("arguments", "{}")
                    try:
                        tool_args = _json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    except _json.JSONDecodeError:
                        tool_args = {}
                    tool_id = tc.get("id", "")

                    if state.callbacks.on_tool_call:
                        await state.callbacks.on_tool_call(tool_name, tool_args, "running")

                    from app.services.agent_tools import execute_tool
                    tool_result = await execute_tool(
                        tool_name, tool_args,
                        agent_id=state.agent_id,
                        user_id=state.user_id,
                    )

                    # Run after_tool_call hooks
                    for mw in self.middlewares:
                        modified = await mw.after_tool_call(state, tool_name, tool_args, tool_result)
                        if modified is not None:
                            tool_result = modified

                    if state.callbacks.on_tool_call:
                        await state.callbacks.on_tool_call(tool_name, tool_args, "done")

                    state.messages.append({
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "content": tool_result,
                    })

                # Track tokens
                if response.usage:
                    state.accumulated_tokens += response.usage.get("total_tokens", 0)
            else:
                final_content = content if content else "I've reached the maximum number of tool call rounds."

        except Exception as e:
            # Run on_error hooks (reverse order)
            for mw in reversed(self.middlewares):
                recovery = await mw.on_error(state, e)
                if recovery is not None:
                    final_content = recovery
                    break
            else:
                raise
        finally:
            await client.close()

        # Run after_agent hooks
        for mw in self.middlewares:
            await mw.after_agent(state, final_content)

        return final_content
