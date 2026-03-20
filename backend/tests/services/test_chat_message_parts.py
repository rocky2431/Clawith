from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace


def test_serialize_tool_call_message_includes_parts_and_legacy_fields():
    from app.services.chat_message_parts import serialize_chat_message

    message = SimpleNamespace(
        role="tool_call",
        content='{"name":"read_file","args":{"path":"skills/test/SKILL.md"},"status":"done","result":"loaded","reasoning_content":"reasoning"}',
        created_at=datetime.now(timezone.utc),
        thinking=None,
    )

    entry = serialize_chat_message(message)

    assert entry["toolName"] == "read_file"
    assert entry["toolArgs"] == {"path": "skills/test/SKILL.md"}
    assert entry["toolStatus"] == "done"
    assert entry["toolResult"] == "loaded"
    assert entry["parts"] == [{
        "type": "tool_call",
        "name": "read_file",
        "args": {"path": "skills/test/SKILL.md"},
        "status": "done",
        "result": "loaded",
        "reasoning": "reasoning",
    }]


def test_serialize_assistant_message_with_thinking_includes_reasoning_part():
    from app.services.chat_message_parts import serialize_chat_message

    message = SimpleNamespace(
        role="assistant",
        content="final answer",
        created_at=datetime.now(timezone.utc),
        thinking="step by step",
    )

    entry = serialize_chat_message(message)

    assert entry["parts"] == [
        {"type": "reasoning", "text": "step by step"},
        {"type": "text", "text": "final answer"},
    ]


def test_split_inline_tools_creates_structured_parts():
    from app.services.chat_message_parts import split_inline_tools

    parts = split_inline_tools(
        "Before\n```tool_code\nweb_search\n```\n```json\n{\"query\": \"openai\"}\n```\nAfter"
    )

    assert parts == [
        {
            "role": "assistant",
            "content": "Before",
            "parts": [{"type": "text", "text": "Before"}],
        },
        {
            "role": "tool_call",
            "content": "",
            "toolName": "web_search",
            "toolArgs": {"query": "openai"},
            "toolStatus": "done",
            "toolResult": "",
            "parts": [{
                "type": "tool_call",
                "name": "web_search",
                "args": {"query": "openai"},
                "status": "done",
                "result": "",
            }],
        },
        {
            "role": "assistant",
            "content": "After",
            "parts": [{"type": "text", "text": "After"}],
        },
    ]


def test_stream_event_builders_include_structured_parts():
    from app.services.chat_message_parts import (
        build_chunk_event,
        build_compaction_event,
        build_done_event,
        build_permission_event,
        build_thinking_event,
        build_tool_call_event,
    )

    assert build_chunk_event("hello") == {
        "type": "chunk",
        "content": "hello",
        "part": {"type": "text_delta", "text": "hello"},
    }
    assert build_thinking_event("plan") == {
        "type": "thinking",
        "content": "plan",
        "part": {"type": "reasoning", "text": "plan"},
    }
    assert build_tool_call_event({
        "name": "read_file",
        "args": {"path": "skills/test/SKILL.md"},
        "status": "done",
        "result": "loaded",
        "reasoning_content": "why",
    }) == {
        "type": "tool_call",
        "name": "read_file",
        "args": {"path": "skills/test/SKILL.md"},
        "status": "done",
        "result": "loaded",
        "reasoning_content": "why",
        "part": {
            "type": "tool_call",
            "name": "read_file",
            "args": {"path": "skills/test/SKILL.md"},
            "status": "done",
            "result": "loaded",
            "reasoning": "why",
        },
    }
    assert build_done_event("final answer", thinking="step by step") == {
        "type": "done",
        "role": "assistant",
        "content": "final answer",
        "parts": [
            {"type": "reasoning", "text": "step by step"},
            {"type": "text", "text": "final answer"},
        ],
    }
    assert build_permission_event({
        "tool_name": "write_file",
        "status": "approval_required",
        "message": "This action requires approval.",
        "approval_id": "approval-123",
    }) == {
        "type": "permission",
        "tool_name": "write_file",
        "status": "approval_required",
        "message": "This action requires approval.",
        "approval_id": "approval-123",
        "part": {
            "type": "event",
            "event_type": "permission",
            "title": "Permission Gate",
            "text": "This action requires approval.",
            "status": "approval_required",
            "tool_name": "write_file",
            "approval_id": "approval-123",
        },
    }
    assert build_compaction_event({
        "summary": "older context compressed",
        "original_message_count": 20,
        "kept_message_count": 8,
    }) == {
        "type": "session_compact",
        "summary": "older context compressed",
        "original_message_count": 20,
        "kept_message_count": 8,
        "part": {
            "type": "event",
            "event_type": "session_compact",
            "title": "Context Compacted",
            "text": "older context compressed",
            "status": "info",
            "original_message_count": 20,
            "kept_message_count": 8,
        },
    }
