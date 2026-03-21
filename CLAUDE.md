# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Clawith is an open-source **multi-agent collaboration platform** — enterprise "digital employees" with persistent identity, long-term memory, private workspaces, and autonomous trigger-driven execution. Built with FastAPI (Python) backend + React 19 (TypeScript) frontend.

Version is tracked in the root `VERSION` file (shared by both frontend and backend).

## Development Commands

### First-Time Setup
```bash
bash setup.sh           # Production: env, PostgreSQL, backend venv, frontend npm, DB seed
bash setup.sh --dev     # Also installs pytest, ruff, and dev tools
```

### Start/Stop Services
```bash
bash restart.sh         # Stops old processes, starts backend(:8008) + frontend(:3008)
```

### Backend (cd backend/)
```bash
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8008 --reload  # Dev server

ruff check app/ --fix && ruff format app/   # Lint + format

pip install -e ".[dev]"
pytest                                       # All tests
pytest tests/test_foo.py -v                  # Single file
pytest tests/test_foo.py::test_bar -v        # Single case

alembic upgrade head                         # Apply migrations
alembic revision --autogenerate -m "desc"    # New migration
alembic heads                                # Must be single head
```

### Frontend (cd frontend/)
```bash
npm run dev              # Vite dev server on :3008 (proxies /api→:8008, /ws→ws://:8008)
npm run build            # tsc + vite build → dist/
```

### Docker
```bash
cp .env.example .env
docker compose up -d --build    # Full stack → :3008
```

## Architecture

```
Frontend (React 19 + Vite + TanStack Query)
    ↓ /api proxy (:3008 → :8008)
Backend (FastAPI + SQLAlchemy async)
    ↓
PostgreSQL (asyncpg) + Redis
```

### Agent Kernel — The Core Runtime

All agent execution flows through a unified kernel. This is the most important architectural layer.

```
Entry Points (WebSocket, Feishu, Task, Trigger, Heartbeat, Agent Delegation)
    ↓
runtime/invoker.py — invoke_agent() resolves deps, builds prompt, calls kernel
    ↓
kernel/engine.py — AgentKernel.handle() — pure LLM loop, zero DB deps
    ↓ (14 injected callbacks via KernelDependencies)
tools/service.py — ToolRuntimeService.execute() — governed tool execution
    ↓
tools/governance.py — security zone → capability gate → autonomy approval
    ↓
tools/executors/ — core.py, extended.py, integrations.py
```

**Key files:**

| File | Purpose |
|------|---------|
| `kernel/contracts.py` | `InvocationRequest`, `InvocationResult`, `RuntimeConfig` — pure dataclasses |
| `kernel/engine.py` | `AgentKernel` — stateless LLM loop with DI (441 LOC). All I/O injected via `KernelDependencies` |
| `runtime/invoker.py` | `invoke_agent()` — wires kernel to platform (DB, tools, memory, prompt). Single entry for ALL execution paths |
| `runtime/prompt_builder.py` | Assembles system prompt: agent context → knowledge → memory → active packs → skill catalog |
| `runtime/session.py` | `SessionContext` — tracks source, channel, active_packs per invocation |
| `core/execution_context.py` | `ExecutionIdentity` ContextVar — agent_bot vs delegated_user, read by audit |

**Execution flow:** Every entry point (WebSocket chat, Feishu message, trigger, heartbeat, task executor, agent-to-agent) builds an `InvocationRequest` and calls `invoke_agent()`. The kernel runs a multi-round LLM loop (max 50 rounds) with streaming callbacks.

### Tool System (`app/tools/`)

Tools follow a registry + executor + governance pattern:

| File | Purpose |
|------|---------|
| `runtime.py` | `ToolExecutionRegistry` — name → executor mapping, `try_execute()` |
| `service.py` | `ToolRuntimeService` — wraps governance + execution + timeout + logging |
| `governance.py` | `run_tool_governance()` — 3-layer preflight: security zone → capability gate → autonomy check |
| `governance_resolver.py` | Connects governance to real DB (agent security_zone, capability policies, autonomy service) |
| `packs.py` | `ToolPackSpec` — static capability bundles (web_pack, feishu_pack, email_pack, etc.) |
| `executors/core.py` | File I/O, skill loading, triggers, messaging — 13 core tool handlers |
| `executors/extended.py` | Web search, document reader, MCP, upload — 12 extended handlers |
| `executors/integrations.py` | Plaza, Feishu docs/calendar, email, MCP passthrough |
| `workspace.py` | `ensure_workspace()` — bootstraps agent filesystem (soul.md, memory/, skills/, workspace/) |

**Tool governance pipeline:** Every `execute_tool()` call runs through `run_tool_governance()` which checks: (1) security zone (public/standard/restricted), (2) capability policy (tenant/agent-level allow/deny/approval), (3) autonomy level (L1/L2/L3). If blocked, returns a user-friendly message; if escalated, creates an approval request.

**Dynamic tool expansion:** When an agent calls `load_skill` or `discover_resources`, the kernel expands the tool list from core-only to full toolset and emits a `pack_activation` event.

### Skill System (`app/skills/`)

Skills are markdown files with YAML frontmatter that define agent capabilities:

```yaml
---
name: "Web Research"
description: "Search and analyze web content"
tools: [web_search, jina_read]
---
# Instructions...
```

`SkillParser` → `WorkspaceSkillLoader` → `SkillRegistry` (dedup + fuzzy lookup). Skills are loaded progressively: catalog in prompt, full body via `load_skill` tool.

### Memory System (`app/memory/`)

File-backed memory with session summaries. `FileBackedMemoryStore` loads session summaries + agent facts → injects into system prompt as `memory_context`.

### Multi-Agent (`app/agents/`)

`delegate_to_agent()` wraps `invoke_agent()` with `SessionContext(source="agent")` and `core_tools_only=True` to prevent nested delegation loops.

### Backend Services (`backend/app/services/`)

| Service | Purpose |
|---------|---------|
| `llm_client.py` | Unified LLM client — OpenAI, Anthropic, OpenAI-compatible, Gemini |
| `agent_tools.py` | Tool definitions (OpenAI function-calling format) + legacy execute_tool |
| `trigger_daemon.py` | 15-sec tick loop evaluating cron/interval/poll/webhook/on_message triggers |
| `autonomy_service.py` | L1/L2/L3 enforcement — auto-execute, notify, or block-and-approve |
| `capability_gate.py` | `CAPABILITY_MAP` (tool → capability) + `check_capability()` per tenant/agent |
| `feishu_service.py` | Feishu OAuth, messaging, interactive approval cards |
| `pack_service.py` | Pack catalog, agent packs, capability summary, session runtime state |

### Frontend (`frontend/src/`)

| Area | Key Files |
|------|-----------|
| Pages | `AgentCreate.tsx` (5-step wizard: Identity→Capabilities→Risk→Channel→Review), `AgentDetail.tsx` (tabs: capabilities, skills, chat, settings), `EnterpriseSettings.tsx` (LLM pool, packs, audit, SSO, capabilities) |
| API layer | `services/api.ts` — `request<T>()` with JWT auth. Domain objects: `agentApi`, `packApi`, `capabilityApi`, `auditApi`, `oidcApi` |
| State | TanStack React Query 5 for server state; Zustand for UI state |
| i18n | `i18n/en.json` + `zh.json` — **both must be updated** for any UI text |
| Components | `CapabilityPackCard.tsx`, `ChannelConfig.tsx`, `FileBrowser.tsx`, `MarkdownRenderer.tsx` |

**Path alias:** `@/` maps to `src/`.

## Critical Conventions

### Multi-Tenancy
Every entity is tenant-scoped. All queries filter by `tenant_id`. First registered user becomes platform admin. Use `check_agent_access(db, current_user, agent_id)` before returning agent-scoped data.

### Agent Kernel Invariant
All agent execution goes through `invoke_agent()` → `AgentKernel.handle()`. Never call LLM directly from a route handler. The kernel is pure (zero DB imports) — all I/O via `KernelDependencies` callbacks.

### Tool Governance Invariant
All tool execution goes through `ToolRuntimeService.execute()` → `run_tool_governance()`. Never call a tool handler directly without governance checks.

### Capability Packs
Agents start with kernel-only tools (file I/O, skill loading, triggers). Capability packs (web, feishu, email, etc.) activate on-demand when a skill is loaded. Pack state tracked in `SessionContext.active_packs`.

### Alembic Migrations
- Check `alembic heads` before creating — must be single head
- `entrypoint.sh` applies `ALTER TABLE IF NOT EXISTS` patches for backward compatibility
- `main.py` lifespan runs `create_all` on startup

### i18n
Both `en.json` and `zh.json` must be updated for any UI text. Use `t('key')` from `useTranslation()`.

### Channel Integrations
Feishu/Lark, Discord, Slack, DingTalk, WeChat Work, Microsoft Teams — each has its own router in `api/` and streaming service in `services/`. Channel configs are per-agent.

### Environment Variables
Key vars (see `.env.example`): `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `JWT_SECRET_KEY`, `AGENT_DATA_DIR`, `JINA_API_KEY`, `FEISHU_APP_ID`/`FEISHU_APP_SECRET`.

### Ports
Frontend dev: 3008, Backend dev: 8008, PostgreSQL: 5432, Redis: 6379.

### Ruff
`target-version = "py311"`, `line-length = 120`.
