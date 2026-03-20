"""Pack service — compute pack availability, capability mapping, and session runtime state."""

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.channel_config import ChannelConfig
from app.services.capability_gate import CAPABILITY_MAP
from app.tools.packs import TOOL_PACKS, ToolPackSpec

logger = logging.getLogger(__name__)

# Kernel tools — always available, never in a pack
KERNEL_TOOLS = (
    "list_files",
    "read_file",
    "write_file",
    "edit_file",
    "glob_search",
    "grep_search",
    "load_skill",
    "set_trigger",
    "list_triggers",
    "send_channel_file",
    "send_message_to_agent",
    "send_web_message",
    "tool_search",
)

# Channel type → pack name mapping
_CHANNEL_PACK_MAP = {
    "feishu": "feishu_pack",
}


def _pack_to_dict(pack: ToolPackSpec) -> dict:
    """Serialize a ToolPackSpec with capability annotations."""
    capabilities = set()
    for tool in pack.tools:
        cap = CAPABILITY_MAP.get(tool)
        if cap:
            capabilities.add(cap)

    requires_channel = None
    if pack.source == "channel":
        for ch, pname in _CHANNEL_PACK_MAP.items():
            if pname == pack.name:
                requires_channel = ch
                break

    return {
        "name": pack.name,
        "summary": pack.summary,
        "source": pack.source,
        "activation_mode": pack.activation_mode,
        "tools": list(pack.tools),
        "capabilities": sorted(capabilities),
        "requires_channel": requires_channel,
    }


def get_pack_catalog() -> list[dict]:
    """Return full pack catalog with capability annotations."""
    return [_pack_to_dict(p) for p in TOOL_PACKS]


async def get_agent_packs(db: AsyncSession, agent_id: uuid.UUID) -> dict:
    """Compute which packs are available for a specific agent.

    Returns:
        {
            "kernel_tools": [...],
            "available_packs": [...],
            "channel_backed_packs": [...],
            "skill_declared_packs": [],
        }
    """
    # Check which channels are configured for this agent
    channel_result = await db.execute(
        select(ChannelConfig.channel_type).where(
            ChannelConfig.agent_id == agent_id,
            ChannelConfig.is_configured == True,  # noqa: E712
        )
    )
    configured_channels = {row[0] for row in channel_result.all()}

    available = []
    channel_backed = []
    for pack in TOOL_PACKS:
        pack_dict = _pack_to_dict(pack)

        if pack.source == "channel":
            required_ch = pack_dict.get("requires_channel")
            if required_ch and required_ch in configured_channels:
                channel_backed.append(pack_dict)
            # Channel packs only in channel_backed — frontend merges both lists
        else:
            available.append(pack_dict)

    return {
        "kernel_tools": list(KERNEL_TOOLS),
        "available_packs": available,
        "channel_backed_packs": channel_backed,
        "skill_declared_packs": [],
    }


async def get_capability_summary(db: AsyncSession, agent_id: uuid.UUID) -> dict:
    """Build comprehensive capability summary for an agent.

    Returns:
        {
            "kernel_tools": [...],
            "available_packs": [...],
            "capability_policies": [...],
            "pending_approvals": int,
        }
    """
    from app.models.audit import ApprovalRequest
    from app.models.capability_policy import CapabilityPolicy

    # Get agent info
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        return {
            "kernel_tools": list(KERNEL_TOOLS),
            "available_packs": [],
            "capability_policies": [],
            "pending_approvals": 0,
        }

    # Get packs
    packs_data = await get_agent_packs(db, agent_id)

    # Get capability policies for this agent + tenant defaults
    policies = []
    if agent.tenant_id:
        tenant_uuid = uuid.UUID(agent.tenant_id) if isinstance(agent.tenant_id, str) else agent.tenant_id
        policy_result = await db.execute(
            select(CapabilityPolicy)
            .where(
                CapabilityPolicy.tenant_id == tenant_uuid,
                (CapabilityPolicy.agent_id == agent_id) | (CapabilityPolicy.agent_id.is_(None)),
            )
            .order_by(CapabilityPolicy.capability)
        )
        for p in policy_result.scalars().all():
            policies.append(
                {
                    "id": str(p.id),
                    "capability": p.capability,
                    "allowed": p.allowed,
                    "requires_approval": p.requires_approval,
                    "scope": "agent" if p.agent_id else "tenant",
                }
            )

    # Count pending approvals
    pending_result = await db.execute(
        select(func.count())
        .select_from(ApprovalRequest)
        .where(
            ApprovalRequest.agent_id == agent_id,
            ApprovalRequest.status == "pending",
        )
    )
    pending_count = pending_result.scalar() or 0

    return {
        "kernel_tools": packs_data["kernel_tools"],
        "available_packs": packs_data["available_packs"],
        "channel_backed_packs": packs_data["channel_backed_packs"],
        "capability_policies": policies,
        "pending_approvals": pending_count,
    }


async def get_session_runtime_summary(db: AsyncSession, session_id: uuid.UUID) -> dict:
    """Build runtime summary for a chat session.

    Finds messages via ChatSession.id → conversation_id → ChatMessage.conversation_id,
    then scans parts for pack activations, tool calls, and permission events.
    """
    from app.models.audit import ChatMessage
    from app.models.chat_session import ChatSession

    # Resolve conversation_id from session
    sess_result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = sess_result.scalar_one_or_none()
    if not session:
        return {"activated_packs": [], "used_tools": [], "blocked_capabilities": [], "compaction_count": 0}

    conv_id = session.external_conv_id or str(session_id)
    result = await db.execute(
        select(ChatMessage)
        .where(
            ChatMessage.agent_id == session.agent_id,
            ChatMessage.conversation_id == conv_id,
        )
        .order_by(ChatMessage.created_at)
    )
    messages = result.scalars().all()

    activated_packs: list[str] = []
    used_tools: set[str] = set()
    blocked_capabilities: list[dict] = []
    compaction_count = 0

    for msg in messages:
        parts = getattr(msg, "parts", None)
        if not parts or not isinstance(parts, list):
            continue

        for part in parts:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")

            if ptype == "pack_activation":
                for p in part.get("packs", []):
                    name = p.get("name") if isinstance(p, dict) else str(p)
                    if name and name not in activated_packs:
                        activated_packs.append(name)

            elif ptype == "tool_call":
                tool_name = part.get("name")
                if tool_name:
                    used_tools.add(tool_name)

            elif ptype == "permission":
                status = part.get("status")
                if status in ("blocked", "capability_denied", "approval_required"):
                    blocked_capabilities.append(
                        {
                            "tool": part.get("tool_name"),
                            "status": status,
                            "capability": part.get("capability"),
                        }
                    )

            elif ptype == "session_compact":
                compaction_count += 1

    return {
        "activated_packs": activated_packs,
        "used_tools": sorted(used_tools),
        "blocked_capabilities": blocked_capabilities,
        "compaction_count": compaction_count,
    }
