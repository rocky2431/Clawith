from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_execute_tool_direct_calls_execute_code_with_workspace_first(monkeypatch):
    from app.services.agent_tools import _execute_tool_direct

    workspace = Path("/tmp/test-agent-workspace")
    called = {}

    async def fake_ensure_workspace(agent_id, tenant_id=None):
        return workspace

    async def fake_execute_code(ws, arguments):
        called["ws"] = ws
        called["arguments"] = arguments
        return "ok"

    monkeypatch.setattr("app.services.agent_tools.ensure_workspace", fake_ensure_workspace)
    monkeypatch.setattr("app.services.agent_tools._execute_code", fake_execute_code)

    result = await _execute_tool_direct(
        "execute_code",
        {"language": "python", "code": "print('hi')"},
        uuid4(),
    )

    assert result == "ok"
    assert called["ws"] == workspace
    assert called["arguments"] == {"language": "python", "code": "print('hi')"}
