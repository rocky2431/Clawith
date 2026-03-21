from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_wecom_webhook_mode_requires_wecom_agent_id(monkeypatch):
    import app.api.wecom as wecom_api

    async def fake_check_agent_access(db, current_user, agent_id):
        return SimpleNamespace(id=agent_id), "manage"

    monkeypatch.setattr(wecom_api, "check_agent_access", fake_check_agent_access)
    monkeypatch.setattr(wecom_api, "is_agent_creator", lambda current_user, agent: True)

    with pytest.raises(HTTPException) as exc:
        await wecom_api.configure_wecom_channel(
            agent_id=uuid4(),
            data={
                "corp_id": "corp-id",
                "secret": "secret",
                "token": "token",
                "encoding_aes_key": "encoding-key",
            },
            current_user=SimpleNamespace(id=uuid4(), tenant_id=uuid4()),
            db=SimpleNamespace(),
        )

    assert exc.value.status_code == 422
    assert "wecom_agent_id" in str(exc.value.detail)
