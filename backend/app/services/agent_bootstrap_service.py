"""Agent bootstrap helpers for create-time channel configuration."""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.schemas import ChannelConfigCreate

logger = logging.getLogger(__name__)


async def _configure_feishu_channel(agent_id: uuid.UUID, config: dict, current_user: User, db: AsyncSession):
    from app.api.feishu import configure_channel

    payload = ChannelConfigCreate.model_validate(config)
    return await configure_channel(agent_id, payload, current_user, db)


async def _configure_slack_channel(agent_id: uuid.UUID, config: dict, current_user: User, db: AsyncSession):
    from app.api.slack import configure_slack_channel

    return await configure_slack_channel(agent_id, config, current_user, db)


async def _configure_discord_channel(agent_id: uuid.UUID, config: dict, current_user: User, db: AsyncSession):
    from app.api.discord_bot import configure_discord_channel

    return await configure_discord_channel(agent_id, config, current_user, db)


async def _configure_teams_channel(agent_id: uuid.UUID, config: dict, current_user: User, db: AsyncSession):
    from app.api.teams import configure_teams_channel

    return await configure_teams_channel(agent_id, config, current_user, db)


async def _configure_wecom_channel(agent_id: uuid.UUID, config: dict, current_user: User, db: AsyncSession):
    from app.api.wecom import configure_wecom_channel

    return await configure_wecom_channel(agent_id, config, current_user, db)


async def _configure_dingtalk_channel(agent_id: uuid.UUID, config: dict, current_user: User, db: AsyncSession):
    from app.api.dingtalk import configure_dingtalk_channel

    return await configure_dingtalk_channel(agent_id, config, current_user, db)


async def _configure_atlassian_channel(agent_id: uuid.UUID, config: dict, current_user: User, db: AsyncSession):
    from app.api.atlassian import configure_atlassian_channel

    return await configure_atlassian_channel(agent_id, config, current_user, db)


async def configure_bootstrap_channel(
    agent_id: uuid.UUID,
    channel_type: str,
    config: dict,
    current_user: User,
    db: AsyncSession,
):
    """Dispatch bootstrap channel setup to the channel-specific backend implementation."""
    normalized = (channel_type or "").strip()
    if normalized == "feishu":
        return await _configure_feishu_channel(agent_id, config, current_user, db)
    if normalized == "slack":
        return await _configure_slack_channel(agent_id, config, current_user, db)
    if normalized == "discord":
        return await _configure_discord_channel(agent_id, config, current_user, db)
    if normalized == "teams":
        return await _configure_teams_channel(agent_id, config, current_user, db)
    if normalized == "wecom":
        return await _configure_wecom_channel(agent_id, config, current_user, db)
    if normalized == "dingtalk":
        return await _configure_dingtalk_channel(agent_id, config, current_user, db)
    if normalized == "atlassian":
        return await _configure_atlassian_channel(agent_id, config, current_user, db)
    raise HTTPException(status_code=400, detail=f"Unsupported channel type: {normalized}")


async def configure_bootstrap_channels(
    agent_id: uuid.UUID,
    channels: list[dict],
    current_user: User,
    db: AsyncSession,
) -> list[dict]:
    """Configure all requested channels and capture per-channel results."""
    results: list[dict] = []
    for item in channels:
        channel_type = (item.get("channel_type") or "").strip()
        config = item.get("config") or {}
        try:
            await configure_bootstrap_channel(agent_id, channel_type, config, current_user, db)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            results.append({"channel_type": channel_type, "status": "failed", "detail": detail})
            continue
        except Exception as exc:  # pragma: no cover
            logger.exception("Unexpected bootstrap channel failure for %s", channel_type)
            results.append({"channel_type": channel_type, "status": "failed", "detail": str(exc)})
            continue

        results.append({"channel_type": channel_type, "status": "configured", "detail": None})
    return results
