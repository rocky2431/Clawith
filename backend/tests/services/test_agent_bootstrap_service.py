from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_configure_bootstrap_channels_dispatches_to_channel_specific_handlers(monkeypatch):
    import app.services.agent_bootstrap_service as service

    calls: list[tuple[str, dict]] = []

    async def fake_feishu(agent_id, config, current_user, db):
        calls.append(("feishu", config))
        return {"ok": True, "agent_id": str(agent_id)}

    async def fake_slack(agent_id, config, current_user, db):
        calls.append(("slack", config))
        return {"ok": True, "agent_id": str(agent_id)}

    monkeypatch.setattr(service, "_configure_feishu_channel", fake_feishu)
    monkeypatch.setattr(service, "_configure_slack_channel", fake_slack)

    agent_id = uuid4()
    current_user = SimpleNamespace(id=uuid4(), tenant_id=uuid4())

    results = await service.configure_bootstrap_channels(
        agent_id=agent_id,
        channels=[
            {"channel_type": "feishu", "config": {"app_id": "cli_xxx", "app_secret": "sec"}},
            {"channel_type": "slack", "config": {"bot_token": "xoxb", "signing_secret": "sign"}},
        ],
        current_user=current_user,
        db=SimpleNamespace(),
    )

    assert calls == [
        ("feishu", {"app_id": "cli_xxx", "app_secret": "sec"}),
        ("slack", {"bot_token": "xoxb", "signing_secret": "sign"}),
    ]
    assert results == [
        {"channel_type": "feishu", "status": "configured", "detail": None},
        {"channel_type": "slack", "status": "configured", "detail": None},
    ]


@pytest.mark.asyncio
async def test_configure_bootstrap_channels_captures_channel_failures(monkeypatch):
    import app.services.agent_bootstrap_service as service

    async def fake_dingtalk(agent_id, config, current_user, db):
        raise HTTPException(status_code=422, detail="app_key and app_secret are required")

    monkeypatch.setattr(service, "_configure_dingtalk_channel", fake_dingtalk)

    results = await service.configure_bootstrap_channels(
        agent_id=uuid4(),
        channels=[
            {"channel_type": "dingtalk", "config": {"app_key": ""}},
        ],
        current_user=SimpleNamespace(id=uuid4(), tenant_id=uuid4()),
        db=SimpleNamespace(),
    )

    assert results == [
        {
            "channel_type": "dingtalk",
            "status": "failed",
            "detail": "app_key and app_secret are required",
        }
    ]
