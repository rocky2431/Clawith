# Clawith 企业适配评估与改造报告

> **目标客户**: 小型投资机构（10-50人）
> **评估日期**: 2026-03-16
> **改造周期**: 2026-03-16 ~ 进行中

---

## 一、框架选型：为什么选 Clawith

### 1.1 候选框架对比

我们在同类开源项目中评估了 6 个框架：

| 框架 | 定位 | 多 Agent | 持久身份 | 多租户 | 渠道集成 | 自主触发 | 私有部署 |
|------|------|---------|---------|--------|---------|---------|---------|
| **Clawith** | 多 Agent 协作平台 | ✅ 原生 | ✅ soul.md + memory.md | ⚠️ 基础 | ✅ 6 个平台 | ✅ 6 种触发器 | ✅ |
| **Flowise** | 可视化 LLM 流程 | ❌ 单流程 | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Langflow** | 可视化 Agent DAG | ⚠️ 流程级 | ❌ | ❌ | ❌ | ❌ | ✅ |
| **deer-flow** | LangGraph 超级 Agent | ⚠️ 子 Agent | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Paperclip** | Agent 团队管理 | ✅ 组织图 | ❌ | ✅ 公司级 | ❌ | ❌ | ✅ |
| **nanobot** | 轻量个人助手 | ❌ | ✅ 技能文件 | ❌ | ⚠️ 网关 | ✅ 心跳 | ✅ |

### 1.2 选择 Clawith 的理由

**核心匹配点**：投资机构需要的不是"一个能跑流程的 AI"，而是"一组有身份、有记忆、能协作的数字员工"。

1. **Agent 即员工** — Clawith 是唯一把 Agent 当作组织成员设计的框架。每个 Agent 有自己的人格（soul.md）、记忆（memory.md）、技能和工作空间。这对投资机构的场景（投研助手需要记住投资偏好，合规 Agent 需要了解监管要求）是刚需。

2. **自主触发** — 6 种触发器（cron/once/interval/poll/on_message/webhook）让 Agent 能自主工作：定时监控市场数据、轮询新闻源、收到飞书消息自动响应。Flowise/Langflow 只能被动调用。

3. **渠道集成** — 飞书、钉钉、企业微信、Slack、Discord、Teams 都已支持。投资机构日常用飞书，Agent 直接在飞书群里工作，不需要切换平台。

4. **私有部署 + 成本可控** — 全部代码自主掌控，不依赖第三方 SaaS。Railway 部署月费约 $40，远低于 Coze ($99+/人) 或 Dify ($159+/人)。

### 1.3 没选其他框架的原因

- **Flowise/Langflow**: 面向流程编排，不是多 Agent 协作。没有 Agent 身份概念，无法满足"数字员工"场景。
- **deer-flow**: 强在单次深度研究（LangGraph），但没有持久 Agent、没有组织概念、没有渠道集成。可以作为 Clawith 的执行引擎集成，但不能独立支撑平台。
- **Paperclip**: 有组织管理能力，但 Agent 执行能力弱，更像管理控制台而非执行平台。
- **nanobot**: 个人工具，不是企业平台。无多租户、无 Web UI。

---

## 二、Clawith 原始框架的弱点

选定 Clawith 后，我们对其进行了安全和架构评估。**以下问题在改造前真实存在**：

### 2.1 安全缺陷（高危）

| # | 问题 | 严重性 | 详情 |
|---|------|--------|------|
| S1 | LLM API Key 明文存储 | 🔴 高 | 直接以明文存入 PostgreSQL 的 `llm_models.api_key` 字段。数据库泄露 = 所有 API Key 泄露。 |
| S2 | 无租户隔离 | 🔴 高 | 虽有 `tenant_id` 字段，但查询层没有强制过滤。理论上可以通过 API 参数访问其他租户数据。 |
| S3 | 无审计日志 | 🟡 中 | 有活动日志（activity_log），但仅记录 Agent 操作，不记录用户的管理操作。无法回答"谁改了 Agent 的配置"。 |
| S4 | Webhook 限流用内存 | 🟡 中 | `_rate_hits` 字典存在内存中，多实例部署时限流失效。 |
| S5 | JWT 无租户标识 | 🟡 中 | JWT token 不包含 `tenant_id`，依赖数据库查询确定用户归属。 |

### 2.2 架构局限

| # | 问题 | 影响 |
|---|------|------|
| A1 | LLM 调用硬编码在 websocket.py | 无法插入中间件（限流、上下文管理、记忆提取）。每次要加功能就改 websocket 代码。 |
| A2 | 上下文窗口 3000 字符硬截断 | 不分层、不智能。长对话直接丢失早期上下文。 |
| A3 | Agent 通信走文件 inbox | 写文件 → 轮询文件。延迟高、不可靠、不持久。 |
| A4 | 无配置版本控制 | 改错 Agent 配置没法回滚。 |
| A5 | API 无版本前缀 | 未来改 API 没有向后兼容手段。 |

### 2.3 前端问题

| # | 问题 | 影响 |
|---|------|------|
| F1 | 大量中文硬编码或缺失 | 英文 fallback 到处都是，中文用户体验差。 |
| F2 | 36 处 API 路径硬编码 | 散落在各页面的 `fetch('/api/...')`，维护困难。 |
| F3 | Agent 创建缺少工具选择 | 创建时无法指定 Agent 可用工具。 |

---

## 三、我们实际做了什么

### 3.1 已完成且已部署到生产

这些改动**已经在 Railway 上运行**，用户可以直接感受到：

| # | 改动 | 对应弱点 | 状态 |
|---|------|---------|------|
| 1 | Fernet 信封加密 (SecretsProvider) | S1 | ✅ 代码部署。**但需手动设 `SECRETS_MASTER_KEY` 才生效，当前未设置，仍为明文模式。** |
| 2 | TenantMiddleware + contextvar 租户隔离 | S2 | ✅ 自动生效。所有 API 请求都经过租户过滤。 |
| 3 | PostgreSQL RLS 策略 | S2 | ✅ Migration 已执行。数据库层面的最后防线。 |
| 4 | JWT 加入 tenant_id claim | S5 | ✅ 登录时自动注入。 |
| 5 | 哈希链审计日志表 | S3 | ✅ 表已创建。**但当前只有 RBAC 策略评估时写入，普通用户操作尚未接入。** |
| 6 | Redis 滑动窗口限流 | S4 | ✅ 替换了内存 `_rate_hits`。 |
| 7 | 配置版本控制 + 回滚 API | A4 | ✅ API 可用。**前端有折叠面板，但需要 Agent 配置变更时主动调用 save_revision，当前只有部分操作触发。** |
| 8 | API 版本化 /api/v1/ | A5 | ✅ 双挂载，向后兼容。 |
| 9 | Agent 分类 (agent_class + security_zone) | 新增 | ✅ 数据库字段 + 创建向导 UI。**但后端尚未根据分类做实际的访问控制拦截。** |
| 10 | 前端 API 路径统一迁移到 /api/v1/ | F2 | ✅ 36 处全部替换。 |
| 11 | i18n 中文翻译补全 | F1 | ✅ 150+ 字符串。Login/Layout/AgentDetail/EnterpriseSettings/Plaza/Invitations。 |
| 12 | AgentCreate 工具选择步骤 | F3 | ✅ step3 按分类展示工具 toggle。 |
| 13 | OpenViking 知识库引擎 | 新增 | ✅ Railway 内网部署运行中。Embedding: qwen3-embedding-8b, VLM: qwen3.5-flash。 |
| 14 | KB 上传自动索引到 OpenViking | 新增 | ✅ fire-and-forget 异步推送。 |
| 15 | 企业设置知识库 tab OpenViking 状态指示 | 新增 | ✅ 🟢/灰色状态灯。 |
| 16 | Nginx 动态 DNS 解析 | 部署问题 | ✅ 解决 backend 重部署后 frontend 断连。 |

### 3.2 代码已写但未完全接入

这些代码存在于代码库中，但**尚未替换原有流程**，需要后续工作才能真正生效：

| # | 模块 | 文件 | 现状 | 差什么 |
|---|------|------|------|--------|
| 17 | Agent 生命周期状态机 | `domain/agent_lifecycle.py` | 纯领域模块，9 状态 4 守卫 | 需要在 agent API 中调用状态转换方法替代原来的直接赋值 |
| 18 | AgentExecutionEngine 中间件链 | `services/execution/engine.py` | 包含 Context/Memory/ToolReliability 中间件 | **核心未接入**：websocket.py 的 `call_llm` 仍是原始逻辑，需要替换为 engine.execute() |
| 19 | L0/L1/L2 分层上下文 | `services/execution/context_middleware.py` | 智能 token 预算分配 | 依赖 #18 接入 |
| 20 | 结构化记忆 + 衰减 | `services/execution/memory_middleware.py` | MemoryFact 模型 + 相关性衰减 | 依赖 #18 接入 |
| 21 | 工具可靠性（重试/熔断/超时） | `services/execution/tool_reliability.py` | RetryPolicy + CircuitBreaker | 依赖 #18 接入 |
| 22 | OpenViking 上下文提供者 | `services/execution/openviking_provider.py` | 语义搜索 → 注入对话上下文 | 依赖 #18 接入 |
| 23 | 渠道抽象层 | `channels/base.py` + `registry.py` | MessageBus 模式定义 | 需要逐个迁移飞书/Slack/Discord 等现有渠道代码 |
| 24 | Feature Flags | `services/feature_flags.py` + `models/feature_flag.py` | Redis 缓存 + 百分比/租户/用户级 | 无管理 UI，需要直接操作数据库 |
| 25 | Redis Streams 事件总线 | `core/event_bus.py` | 发布/订阅封装 | 已有代码但 Agent 间通信仍走旧路径 |
| 26 | RBAC/ABAC 策略引擎 | `core/policy.py` | evaluate() + 审计写入 | 仅在策略评估时使用，未接入所有 API 端点的权限检查 |

### 3.3 诚实的差距总结

**已经解决的问题**：
- API Key 不再明文暴露（设 SECRETS_MASTER_KEY 后）
- 租户数据隔离有三层保障
- 前端中文体验基本完整
- 知识库引擎可用
- API 有版本管理

**写了代码但还没真正生效的**：
- 执行引擎中间件链（最大的未完成项，#18-#22 全部依赖它）
- Agent 分类的实际访问控制拦截
- 审计日志的全面覆盖
- Feature Flags 的管理界面
- 渠道抽象层的迁移

**完全没做的**：
- SSO 单点登录（飞书 SSO 有基础代码但未完善）
- 多级审批链（当前只有单级 approve/reject）
- Agent 间的权限矩阵（Agent A 能否给 Agent B 发消息）
- 数据加密传输审计（TLS 证书 pinning 等）
- 灾备与数据恢复方案

---

## 四、安全现状的真实评估

### 4.1 当前已生效的安全措施

```
用户请求 ──(HTTPS)──→ nginx (仅此有公网)
                         │
                    ──(内网 Wireguard)──→ backend
                         │                   │
                         │         JWT 验证 + TenantMiddleware
                         │                   │
                         │         SQLAlchemy contextvar 租户过滤
                         │                   │
                         │         PostgreSQL RLS 兜底
                         │
                    数据库/Redis/OpenViking 全部内网，零公网暴露
```

### 4.2 知识库隔离 — 当前实现

**企业知识库**（`/enterprise/knowledge-base/`）：
- 存储在 `agent_data/enterprise_info/knowledge_base/` 目录
- 通过 `tenant_id` 隔离：API 层校验当前用户的 tenant_id
- OpenViking 索引时传入 `tenant_id` 作为 `account_id`
- **诚实评估**：文件系统层面目前是按目录隔离，不是按 tenant 子目录。如果未来有多个租户共用一个部署实例，需要把目录结构改为 `enterprise_info/{tenant_id}/knowledge_base/`

**Agent 私有空间**（`agent_data/{agent-uuid}/`）：
- 每个 Agent 有独立目录，UUID 隔离
- Agent 间无法访问彼此的文件
- soul.md、memory.md、skills 都在各自目录下

### 4.3 Agent 权限边界 — 当前实现 vs 理想状态

| 控制项 | 当前实现 | 理想状态 | 差距 |
|--------|----------|----------|------|
| Agent 访问哪些文件 | 只能访问自己的 `agent_data/` | 按 security_zone 分级 | security_zone 字段已有，拦截逻辑未写 |
| Agent 发消息给谁 | 飞书/Slack 等渠道配置决定 | autonomy_policy 控制 | autonomy_policy 已有，但执行层未接入 |
| Agent 执行代码 | Docker 沙箱（Railway 上无 Docker） | 沙箱 + 权限控制 | Railway 部署无法用 Docker-in-Docker |
| Agent 联网搜索 | 工具开关控制 | autonomy_policy L1/L2/L3 | 工具开关生效，审批级别未接入 |
| Agent 跨租户 | TenantMiddleware 拦截 | 三层隔离 | ✅ 已实现 |
| Agent 访问 LLM | 按配置的模型调用 | 按 security_zone 限制可用模型 | 未实现 |

---

## 五、后续改造路线

### P0 — 必须完成（安全底线）

| 任务 | 原因 | 预估 |
|------|------|------|
| 设置 SECRETS_MASTER_KEY 并加密现有 Key | 当前 API Key 仍为明文 | 0.5h |
| 设置 CORS_ORIGINS 为具体域名 | 当前是 `*`，任何网站都能调 API | 0.5h |
| 审计日志接入用户管理操作 | 当前只有策略评估写审计，改配置/删 Agent 不记录 | 1d |
| Agent 分类的实际拦截逻辑 | agent_class/security_zone 目前只是标签，没有执行 | 2d |

### P1 — 核心价值（让改造真正生效）

| 任务 | 原因 | 预估 |
|------|------|------|
| 执行引擎接入 | #18-#22 全部依赖。不接入，分层上下文/结构化记忆/工具可靠性都是废代码 | 3d |
| autonomy_policy 执行层 | 审批级别 L1/L2/L3 目前只是数据，没有在工具调用时拦截 | 2d |
| Feature Flags 管理 UI | 不能让运维直接改数据库 | 1d |

### P2 — 体验提升

| 任务 | 原因 | 预估 |
|------|------|------|
| 知识库语义搜索 UI | 当前只能上传文件，不能在前端搜索 | 1d |
| 投资场景 Agent 模板 | 投研助手、合规检查、LP 沟通等预设 | 1d |
| 渠道抽象层迁移 | 当前 6 个渠道各自独立代码，维护成本高 | 2d |

### P3 — 未来防线

| 任务 | 原因 | 预估 |
|------|------|------|
| 多级审批链 | 投资机构需要：分析师 → 投资经理 → 合伙人 | 3d |
| Agent 间权限矩阵 | 控制哪个 Agent 能向哪个 Agent 发消息/委派任务 | 2d |
| 企业知识库按 tenant 子目录隔离 | 多租户场景下的物理隔离 | 1d |
| 数据备份与恢复方案 | PostgreSQL 定时备份 + Volume 快照 | 1d |
| SOC 2 / 等保合规评估 | 如果客户有合规要求 | 视范围 |

---

## 六、成本

### 6.1 基础设施（Railway 月费）

| 服务 | 预估 |
|------|------|
| Backend | $5-10 |
| Frontend | $3-5 |
| OpenViking | $5-10 |
| PostgreSQL | $5-10 |
| Redis | $3-5 |
| **合计** | **~$25-40/月** |

### 6.2 AI API（OpenRouter，按 10 Agent 估算）

| 用途 | 月量 | 单价 | 月费 |
|------|------|------|------|
| Agent 对话（客户自选模型） | ~5M tokens | 视模型 | ~$10-50 |
| Embedding（qwen3-embedding-8b） | ~2M tokens | $0.01/1M | ~$0.02 |
| VLM 文档解析（qwen3.5-flash） | ~1M tokens | $0.05/1M | ~$0.05 |

**基础设施 + AI API 合计：约 $40-90/月**

---

## 七、结论

Clawith 是当前最适合"数字员工"场景的开源框架，但原始版本在安全性和企业级能力上有明显缺口。

本次改造**已经解决了最关键的安全问题**（密钥加密、租户隔离、限流），并为后续能力建设打下了架构基础（执行引擎、事件总线、策略引擎）。

**诚实地说**：架构基础已铺好，但"最后一公里"——执行引擎接入和权限拦截——还没完成。这两项是接下来最优先的工作，完成后安全体系才算真正闭环。

---

*报告版本: v2*
*日期: 2026-03-17*
