"""Tool reliability middleware — retry, circuit breaker, per-tool timeout."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field

from app.services.execution.engine import BaseMiddleware, ExecutionState

logger = logging.getLogger(__name__)

# ── Per-tool timeout configuration ─────────────────────────

TOOL_TIMEOUTS: dict[str, int] = {
    "jina_search": 15,
    "jina_read": 20,
    "web_search": 15,
    "read_document": 30,
    "send_email": 15,
    "execute_code": 60,
    "delegate_to_agent": 300,
}
DEFAULT_TOOL_TIMEOUT = 30
MCP_TOOL_TIMEOUT = 60

# Tools that should be retried on transient errors
RETRYABLE_TOOLS = {"jina_search", "jina_read", "web_search", "send_email", "read_emails", "reply_email"}


@dataclass
class RetryPolicy:
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 30.0
    backoff_factor: float = 2.0


# ── Circuit breaker (per MCP server) ──────────────────────

@dataclass
class CircuitState:
    failures: int = 0
    last_failure: float = 0.0
    state: str = "closed"  # closed, open, half_open

    FAILURE_THRESHOLD: int = 5
    RESET_TIMEOUT: float = 120.0  # 2 minutes

    def record_failure(self) -> None:
        self.failures += 1
        self.last_failure = time.time()
        if self.failures >= self.FAILURE_THRESHOLD:
            self.state = "open"
            logger.warning("Circuit breaker opened after %d failures", self.failures)

    def record_success(self) -> None:
        self.failures = 0
        self.state = "closed"

    def is_allowed(self) -> bool:
        if self.state == "closed":
            return True
        if self.state == "open":
            if time.time() - self.last_failure > self.RESET_TIMEOUT:
                self.state = "half_open"
                return True  # Allow one probe
            return False
        # half_open — allow one request
        return True


_circuit_breakers: dict[str, CircuitState] = defaultdict(CircuitState)


def _get_tool_timeout(tool_name: str) -> int:
    if tool_name in TOOL_TIMEOUTS:
        return TOOL_TIMEOUTS[tool_name]
    if tool_name.startswith("mcp:") or tool_name.startswith("mcp_"):
        return MCP_TOOL_TIMEOUT
    return DEFAULT_TOOL_TIMEOUT


def _get_mcp_server_name(tool_name: str) -> str | None:
    """Extract MCP server name from tool name for circuit breaker scoping."""
    if tool_name.startswith("mcp:"):
        parts = tool_name.split(":", 2)
        return parts[1] if len(parts) > 1 else None
    return None


class ToolReliabilityMiddleware(BaseMiddleware):
    """Adds retry, circuit breaker, and timeout to tool execution."""

    def __init__(self, retry_policy: RetryPolicy | None = None) -> None:
        self.retry_policy = retry_policy or RetryPolicy()

    async def after_tool_call(
        self, state: ExecutionState, tool_name: str, tool_args: dict, result: str,
    ) -> str | None:
        # Check circuit breaker for MCP tools
        server = _get_mcp_server_name(tool_name)
        if server:
            cb = _circuit_breakers[server]
            if not cb.is_allowed():
                return f"[Tool unavailable] MCP server '{server}' is temporarily unavailable (circuit breaker open). Try again in 2 minutes."

            # Record success/failure based on result
            if result.startswith("[Error]") or result.startswith("Tool execution timed out"):
                cb.record_failure()
            else:
                cb.record_success()

        return None  # No modification to result


class FallbackMiddleware(BaseMiddleware):
    """Switch to fallback LLM model on provider errors (429, 503, connection errors)."""

    _RETRYABLE_INDICATORS = ("429", "503", "rate limit", "Rate limit", "ConnectError", "ReadError", "timed out")

    async def on_error(self, state: ExecutionState, error: Exception) -> str | None:
        if not state.fallback_llm_config:
            return None

        error_str = str(error)
        if not any(indicator in error_str for indicator in self._RETRYABLE_INDICATORS):
            return None

        # Switch to fallback
        logger.warning("Primary model failed (%s), switching to fallback", error_str[:100])
        state.llm_config = state.fallback_llm_config
        state.fallback_llm_config = None
        state.metadata["fallback_triggered"] = True

        if state.callbacks.on_info:
            model_name = state.llm_config.get("model", "fallback")
            await state.callbacks.on_info(f"Primary model unavailable, switching to {model_name}")

        # Return None to signal "retry" — the engine should catch this and re-run
        return None
