"""Unified Memory Service — conversation lifecycle management.

Covers three phases:
  1. on_conversation_start: inject previous session summary + agent memory
  2. maybe_compress_messages: LLM-powered compression near context window limit
  3. on_conversation_end: persist summary, extract memory facts, share to OpenViking
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Awaitable, Callable

from sqlalchemy import select

from app.database import async_session
from app.models.chat_session import ChatSession
from app.models.llm import LLMModel
from app.models.tenant_setting import TenantSetting
from app.services.conversation_summarizer import estimate_tokens, _extract_summary

logger = logging.getLogger(__name__)

CompactionCallback = Callable[[dict], Awaitable[None] | None]


# ============================================================================
# Public API
# ============================================================================


async def on_conversation_start(
    agent_id: uuid.UUID,
    session_id: str,
    tenant_id: uuid.UUID,
) -> str:
    """Return context string to inject into system prompt.

    Loads: previous session summary + agent structured memory.
    """
    parts: list[str] = []

    # 1. Previous session summary
    try:
        async with async_session() as db:
            result = await db.execute(
                select(ChatSession.summary)
                .where(
                    ChatSession.agent_id == agent_id,
                    ChatSession.summary.isnot(None),
                    ChatSession.id != uuid.UUID(session_id) if session_id else True,
                )
                .order_by(ChatSession.created_at.desc())
                .limit(1)
            )
            prev_summary = result.scalar_one_or_none()
            if prev_summary:
                parts.append(f"[Previous conversation summary]\n{prev_summary}")
    except Exception as e:
        logger.debug("Failed to load previous session summary: %s", e)

    # 2. Agent structured memory
    try:
        memory_text = _load_agent_memory(agent_id)
        if memory_text:
            parts.append(f"[Agent memory]\n{memory_text}")
    except Exception as e:
        logger.debug("Failed to load agent memory: %s", e)

    return "\n\n".join(parts)


async def maybe_compress_messages(
    messages: list[dict],
    model_provider: str,
    model_name: str,
    max_input_tokens_override: int | None,
    tenant_id: uuid.UUID | None,
    *,
    compress_threshold: float | None = None,
    keep_recent: int | None = None,
    on_compaction: CompactionCallback | None = None,
) -> list[dict]:
    """Compress old messages when approaching model context window.

    Returns potentially compressed message list with summary prepended.
    """
    # Resolve config from tenant settings
    config = await _get_memory_config(tenant_id) if tenant_id else {}
    threshold = compress_threshold if compress_threshold is not None else config.get("compress_threshold", 70) / 100.0
    recent_count = keep_recent if keep_recent is not None else config.get("keep_recent", 10)

    # Resolve context window
    context_limit = _get_input_context_limit(model_provider, model_name, max_input_tokens_override)
    trigger_tokens = int(context_limit * threshold)

    current_tokens = estimate_tokens(messages)
    if current_tokens <= trigger_tokens:
        return messages

    if len(messages) <= recent_count:
        return messages

    old_messages = messages[:-recent_count]
    recent_messages = messages[-recent_count:]

    # Ensure we don't break tool_call/tool_result pairs at the split point
    old_messages, recent_messages = _safe_split(old_messages, recent_messages)

    logger.info(
        "Memory compress: %d tokens > %d threshold (context=%d), summarizing %d old messages",
        current_tokens, trigger_tokens, context_limit, len(old_messages),
    )

    # Try LLM-powered summarization
    summary_model = await _get_summary_model_config(tenant_id) if tenant_id else None
    if summary_model:
        try:
            from app.services.conversation_summarizer import _llm_summarize
            summary = await _llm_summarize(old_messages, summary_model)
            if summary:
                if on_compaction:
                    maybe_result = on_compaction({
                        "summary": summary,
                        "original_message_count": len(messages),
                        "kept_message_count": len(recent_messages) + 1,
                    })
                    if maybe_result is not None:
                        await maybe_result
                return [{"role": "system", "content": f"[Previous conversation summary]\n{summary}"}] + recent_messages
        except Exception as e:
            logger.warning("LLM summarization failed, falling back to extraction: %s", e)

    # Fallback: text extraction
    summary = _extract_summary(old_messages)
    if on_compaction:
        maybe_result = on_compaction({
            "summary": summary,
            "original_message_count": len(messages),
            "kept_message_count": len(recent_messages) + 1,
        })
        if maybe_result is not None:
            await maybe_result
    return [{"role": "system", "content": f"[Previous conversation summary]\n{summary}"}] + recent_messages


async def on_conversation_end(
    agent_id: uuid.UUID,
    session_id: str,
    tenant_id: uuid.UUID,
    messages: list[dict],
) -> None:
    """Post-conversation background task: persist summary, extract memory, share knowledge.

    Fire-and-forget — exceptions are logged but never propagated.
    """
    if len(messages) < 4:
        return

    try:
        # 1. Generate session summary
        summary = await _generate_session_summary(messages, tenant_id)
        if summary:
            async with async_session() as db:
                result = await db.execute(
                    select(ChatSession).where(ChatSession.id == uuid.UUID(session_id))
                )
                session = result.scalar_one_or_none()
                if session:
                    session.summary = summary
                    await db.commit()
                    logger.info("Session summary saved for %s", session_id)

        # 2. Extract and update agent memory
        await _update_agent_memory(agent_id, messages, tenant_id)

        # 3. Write to OpenViking (if configured and enabled)
        config = await _get_memory_config(tenant_id)
        if config.get("extract_to_viking", False) and summary:
            from app.services import viking_client
            if viking_client.is_configured():
                await viking_client.add_resource(
                    content=summary,
                    to=f"viking://conversations/{agent_id}/{session_id}",
                    tenant_id=str(tenant_id),
                    agent_id=str(agent_id),
                    reason="conversation_summary",
                )
                logger.info("Summary written to OpenViking for session %s", session_id)

    except Exception as e:
        logger.error("on_conversation_end failed (non-fatal): %s", e, exc_info=True)


# ============================================================================
# Internal Helpers
# ============================================================================


def _get_input_context_limit(provider: str, model_name: str, override: int | None) -> int:
    """Resolve model input context window. Priority: override > ProviderSpec > 128000."""
    if override and override > 0:
        return override

    from app.services.llm_client import get_provider_spec
    spec = get_provider_spec(provider)
    if spec:
        return spec.max_input_tokens

    return 128000


async def _get_memory_config(tenant_id: uuid.UUID) -> dict:
    """Load memory configuration from TenantSetting(key='memory_config')."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(TenantSetting.value).where(
                    TenantSetting.tenant_id == tenant_id,
                    TenantSetting.key == "memory_config",
                )
            )
            value = result.scalar_one_or_none()
            return value if isinstance(value, dict) else {}
    except Exception:
        return {}


async def _get_summary_model_config(tenant_id: uuid.UUID) -> dict | None:
    """Resolve the LLM model to use for summarization from tenant config."""
    config = await _get_memory_config(tenant_id)
    model_id = config.get("summary_model_id")
    if not model_id:
        return None

    try:
        async with async_session() as db:
            result = await db.execute(
                select(LLMModel).where(LLMModel.id == uuid.UUID(str(model_id)))
            )
            model = result.scalar_one_or_none()
            if not model or not model.enabled:
                return None

            return {
                "provider": model.provider,
                "model": model.model,
                "api_key": model.api_key,
                "base_url": model.base_url,
            }
    except Exception as e:
        logger.warning("Failed to load summary model: %s", e)
        return None


async def _generate_session_summary(messages: list[dict], tenant_id: uuid.UUID) -> str | None:
    """Generate a summary for the session using LLM or fallback extraction."""
    summary_model = await _get_summary_model_config(tenant_id)
    if summary_model:
        try:
            from app.services.conversation_summarizer import _llm_summarize
            return await _llm_summarize(messages, summary_model)
        except Exception as e:
            logger.warning("LLM session summary failed, using extraction: %s", e)

    return _extract_summary(messages)


async def _update_agent_memory(agent_id: uuid.UUID, messages: list[dict], tenant_id: uuid.UUID) -> None:
    """Extract facts from conversation and update agent's memory.json."""
    from pathlib import Path
    from app.config import get_settings

    settings = get_settings()
    agent_dir = Path(settings.AGENT_DATA_DIR) / str(agent_id)
    memory_file = agent_dir / "memory" / "memory.json"

    # Load existing memory
    existing_facts: list[dict] = []
    if memory_file.exists():
        try:
            existing_facts = json.loads(memory_file.read_text())
            if not isinstance(existing_facts, list):
                existing_facts = []
        except (json.JSONDecodeError, OSError):
            existing_facts = []

    # Try LLM-powered fact extraction
    summary_model = await _get_summary_model_config(tenant_id)
    new_facts: list[dict] = []
    if summary_model:
        try:
            new_facts = await _extract_facts_with_llm(messages, summary_model)
        except Exception as e:
            logger.debug("LLM fact extraction failed: %s", e)

    if not new_facts:
        # Simple extraction: pull key user statements
        new_facts = _extract_facts_simple(messages)

    if not new_facts:
        return

    # Merge: add new facts, keep recent ones (cap at 50)
    from datetime import datetime, timezone
    timestamp = datetime.now(timezone.utc).isoformat()
    for fact in new_facts:
        fact.setdefault("timestamp", timestamp)

    all_facts = existing_facts + new_facts
    all_facts = all_facts[-50:]  # Keep most recent 50

    memory_file.parent.mkdir(parents=True, exist_ok=True)
    memory_file.write_text(json.dumps(all_facts, ensure_ascii=False, indent=2))
    logger.info("Updated memory.json for agent %s: %d facts", agent_id, len(all_facts))


def _load_agent_memory(agent_id: uuid.UUID) -> str:
    """Load agent's structured memory from memory.json."""
    from pathlib import Path
    from app.config import get_settings

    settings = get_settings()
    memory_file = Path(settings.AGENT_DATA_DIR) / str(agent_id) / "memory" / "memory.json"

    if not memory_file.exists():
        return ""

    try:
        facts = json.loads(memory_file.read_text())
        if not isinstance(facts, list) or not facts:
            return ""

        # Format recent facts for context
        lines = []
        for fact in facts[-15:]:  # Show at most 15 recent facts
            content = fact.get("content", fact.get("fact", ""))
            if content:
                lines.append(f"- {content}")

        return "\n".join(lines)
    except (json.JSONDecodeError, OSError):
        return ""


async def _extract_facts_with_llm(messages: list[dict], model_config: dict) -> list[dict]:
    """Use LLM to extract memorable facts from conversation."""
    from app.services.llm_client import LLMMessage, create_llm_client

    # Build condensed conversation text
    conversation_text = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not isinstance(content, str) or not content.strip():
            continue
        if role in ("user", "assistant") and "tool_calls" not in msg:
            conversation_text.append(f"{role}: {content[:300]}")

    if not conversation_text:
        return []

    text = "\n".join(conversation_text[-15:])

    client = create_llm_client(**model_config)
    try:
        response = await client.stream(
            messages=[
                LLMMessage(
                    role="system",
                    content=(
                        "Extract key facts from this conversation that would be useful to remember for future interactions. "
                        "Return a JSON array of objects with 'content' field. Extract 2-5 facts max. "
                        "Focus on: user preferences, important decisions, project details, personal information shared. "
                        "Respond ONLY with the JSON array, no other text."
                    ),
                ),
                LLMMessage(role="user", content=text),
            ],
            max_tokens=500,
            temperature=0.3,
        )

        # Parse JSON from response
        raw = (response.content or "").strip()
        # Handle markdown code blocks
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw
            raw = raw.rsplit("```", 1)[0]
            raw = raw.strip()

        facts = json.loads(raw)
        if isinstance(facts, list):
            return [f for f in facts if isinstance(f, dict) and f.get("content")]
    except (json.JSONDecodeError, Exception) as e:
        logger.debug("Failed to parse LLM fact extraction: %s", e)
    finally:
        await client.close()

    return []


def _extract_facts_simple(messages: list[dict]) -> list[dict]:
    """Simple fact extraction without LLM — pull key user statements."""
    facts = []
    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        # Keep substantive user messages (not short greetings)
        if len(content) > 30 and len(content) < 500:
            facts.append({"content": content[:200], "source": "user_message"})

    return facts[-3:]  # Keep at most 3


def _safe_split(old: list[dict], recent: list[dict]) -> tuple[list[dict], list[dict]]:
    """Ensure tool_call/tool_result pairs aren't split between old and recent.

    If the first message in 'recent' is a tool result, move it back into 'old'.
    Returns (old, recent) — same order as parameters.
    """
    if not recent or not old:
        return old, recent

    # If recent starts with a tool result, pull it into old
    while recent and recent[0].get("role") == "tool":
        old.append(recent.pop(0))

    # If old ends with an assistant message with tool_calls but no tool result follows,
    # move it to recent so the pair stays together
    if old and old[-1].get("tool_calls") and recent and recent[0].get("role") != "tool":
        recent.insert(0, old.pop())

    return old, recent
