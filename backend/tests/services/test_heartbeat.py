from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_build_heartbeat_tool_executor_enforces_plaza_limits(monkeypatch):
    from app.services.heartbeat import _build_heartbeat_tool_executor

    agent_id = uuid4()
    creator_id = uuid4()
    calls = []

    async def fake_execute_tool(tool_name, args, _agent_id, _creator_id):
        calls.append((tool_name, args, _agent_id, _creator_id))
        return f"ran:{tool_name}"

    monkeypatch.setattr("app.services.heartbeat.execute_tool", fake_execute_tool)

    executor = _build_heartbeat_tool_executor(agent_id, creator_id)

    first_post = await executor("plaza_create_post", {"content": "post-1"})
    blocked_post = await executor("plaza_create_post", {"content": "post-2"})
    first_comment = await executor("plaza_add_comment", {"content": "comment-1"})
    second_comment = await executor("plaza_add_comment", {"content": "comment-2"})
    blocked_comment = await executor("plaza_add_comment", {"content": "comment-3"})
    generic = await executor("web_search", {"query": "heartbeat"})

    assert first_post == "ran:plaza_create_post"
    assert blocked_post.startswith("[BLOCKED]")
    assert first_comment == "ran:plaza_add_comment"
    assert second_comment == "ran:plaza_add_comment"
    assert blocked_comment.startswith("[BLOCKED]")
    assert generic == "ran:web_search"
    assert calls == [
        ("plaza_create_post", {"content": "post-1"}, agent_id, creator_id),
        ("plaza_add_comment", {"content": "comment-1"}, agent_id, creator_id),
        ("plaza_add_comment", {"content": "comment-2"}, agent_id, creator_id),
        ("web_search", {"query": "heartbeat"}, agent_id, creator_id),
    ]
