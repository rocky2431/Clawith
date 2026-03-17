# Clawith 企业级升级报告

> **目标客户**: 小型投资机构（10-50人）
> **项目周期**: 2026-03-16 ~ 进行中
> **当前版本**: v0.3.0-enterprise

---

## 一、升级背景与目标

### 1.1 为什么做这次升级

Clawith 原本是一个开源的多 Agent 协作平台原型。对于投资机构而言，直接使用存在以下风险：

| 风险项 | 原始状态 | 投资机构要求 |
|--------|----------|-------------|
| API 密钥安全 | 明文存储在数据库 | 金融级加密存储 |
| 数据隔离 | 无租户隔离 | 严格的多租户边界 |
| 审计追踪 | 无 | 合规要求：谁在何时做了什么 |
| 知识库安全 | 无隔离 | 投研报告、尽调文档不能泄露 |
| Agent 权限 | 无边界 | Agent 不能越权访问敏感数据 |
| 服务可靠性 | 单点故障 | 限流、熔断、重试 |

### 1.2 核心设计原则

1. **数据不出墙** — 租户数据严格隔离，Agent A 绝不能看到 Agent B 租户的数据
2. **最小权限** — Agent 只能做被允许的事，敏感操作需人工审批
3. **全程可追溯** — 每个操作都有哈希链审计日志，不可篡改
4. **无感安全** — 安全机制对终端用户透明，不增加使用负担
5. **渐进增强** — 所有新功能向后兼容，不配置就不生效

---

## 二、已完成的升级清单

### 2.1 安全加固层（共 6 项）

#### ① Fernet 信封加密 — API 密钥保护
```
用户输入 API Key → AES-128-CBC 加密 → 密文存入 PostgreSQL → 使用时解密
```
- **文件**: `backend/app/services/secrets_provider.py`
- **效果**: 即使数据库被拖库，攻击者也无法获取明文 API Key
- **配置**: 设置 `SECRETS_MASTER_KEY` 环境变量即启用，不设置则降级为明文（开发模式）

#### ② 三层租户隔离
```
请求进入 → TenantMiddleware 从 JWT 提取 tenant_id
         → SQLAlchemy contextvar 自动注入查询条件
         → PostgreSQL RLS 策略兜底（数据库层面强制）
```
- **第一层**: HTTP 中间件 — 从 JWT token 的 `tid` claim 提取租户 ID
- **第二层**: ORM 层 — 所有查询自动带 `WHERE tenant_id = :current_tenant`
- **第三层**: 数据库层 — PostgreSQL Row-Level Security，即使 SQL 注入也无法跨租户
- **零侵入**: 不修改任何现有 API 端点的代码

#### ③ 哈希链审计日志
```
事件 → SHA-256(事件内容 + 上一条日志的哈希) → 写入 security_audit_events 表
```
- 任何人篡改中间的日志，后续所有日志的哈希链都会断裂
- 记录: 用户操作、Agent 行为、权限变更、数据访问
- 满足投资机构的合规审计要求

#### ④ RBAC 资源权限
- `resource_permissions` 表控制谁能访问什么
- 支持 RBAC（角色）和 ABAC（属性）混合评估
- 角色层级: `platform_admin` > `org_admin` > `agent_admin` > `member`

#### ⑤ Redis 分布式限流
- 滑动窗口算法，替代原来的内存计数器
- 防止单用户/Agent 耗尽系统资源
- 多实例部署时限流状态一致

#### ⑥ Feature Flags 功能开关
- 支持租户级、用户级、百分比级灰度
- 新功能可以只对特定客户开放
- Redis 缓存，性能开销 < 1ms

### 2.2 架构增强层（共 7 项）

#### ⑦ Agent 生命周期状态机
```
creating → idle → running → paused → stopped
                    ↓
                  error → recovering → idle
                    ↓
                  expired (TTL 到期自动)
```
- 9 个状态 + 4 个守卫条件
- 纯领域模块，无外部依赖
- 防止 Agent 进入非法状态

#### ⑧ 配置版本控制
- 每次 Agent 设置变更自动保存快照
- 支持查看历史版本和一键回滚
- 前端在 Agent 详情 → 设置 → 底部有折叠面板

#### ⑨ Redis Streams 事件总线
- 替代原来的内存 pub/sub 和文件 inbox
- 持久化、有序、支持消费组
- Agent 间通信的基础设施

#### ⑩ 执行引擎中间件链
```
请求 → ContextMiddleware → MemoryMiddleware → ToolReliabilityMiddleware → LLM
```
- **ContextMiddleware**: L0/L1/L2 分层上下文，智能分配 token 预算
- **MemoryMiddleware**: 结构化记忆提取，带相关性衰减
- **ToolReliabilityMiddleware**: 自动重试 + 熔断器 + 超时保护

#### ⑪ Agent 分类体系
| 维度 | 选项 | 说明 |
|------|------|------|
| **类型** (agent_class) | internal_tenant | 使用平台模型的租户内部员工 |
| | external_gateway | 通过 OpenClaw 网关连接的远程 Agent |
| | external_api | 仅通过 API 访问的无状态 Agent |
| **安全区** (security_zone) | standard | 正常访问组织资源 |
| | restricted | 所有操作需审批（涉及 PII/财务数据） |
| | public | 面向客户，仅限沙箱工具 |

#### ⑫ API 版本化
- `/api/v1/` 端点前缀，向后兼容双挂载
- 旧的 `/api/` 路径仍然可用
- 为未来 API 迭代预留空间

#### ⑬ 渠道抽象层
- 统一的 MessageBus 模式
- 支持: 飞书、Slack、Discord、钉钉、企业微信、Teams
- 新增渠道只需实现 `ChannelAdapter` 接口

### 2.3 知识库引擎（OpenViking 集成）

#### ⑭ OpenViking 微服务部署
- 部署为 Railway 内网微服务，与 backend 内网直连
- Embedding: `qwen/qwen3-embedding-8b`（$0.01/1M tokens）
- VLM: `qwen/qwen3.5-flash`（$0.05/1M tokens）
- 全走 OpenRouter API，一个 key 搞定

#### ⑮ 无感 KB 集成
- 管理员上传文件到"公司知识库" → 后端自动推送到 OpenViking 索引
- 企业设置 → 公司信息 tab → 知识库标题旁显示连接状态（🟢/灰色）
- Agent 对话时自动从知识库检索相关上下文

### 2.4 前端改造（共 8 项）

| # | 改动 | 说明 |
|---|------|------|
| ⑯ | API 路径迁移 | 36 处 `/api/` → `/api/v1/` |
| ⑰ | i18n 同步 | en.json + zh.json 键值同步 |
| ⑱ | Agent 分类 UI | 创建向导 step4 新增类型/安全区选择 |
| ⑲ | 工具选择 UI | 创建向导 step3 新增工具 toggle（按分类分组） |
| ⑳ | i18n 全覆盖 | Login、Layout、AgentDetail、EnterpriseSettings、Plaza、Invitations 共 150+ 字符串 |
| ㉑ | 配置版本历史 | Agent 详情 Settings 折叠面板 |
| ㉒ | Nginx DNS 动态解析 | 解决 backend 重部署后 frontend 断连 |
| ㉓ | OpenViking 状态指示器 | 企业设置知识库 tab 连接状态 |

---

## 三、投资机构场景下的安全架构

### 3.1 数据流安全

```
投资经理 ──(HTTPS)──→ Frontend ──(内网)──→ Backend ──(内网)──→ PostgreSQL
                                              ├──(内网)──→ Redis
                                              └──(内网)──→ OpenViking
```

- **外部暴露**: 仅 Frontend（nginx）有公网域名
- **Backend**: 无公网入口，只通过 nginx 代理
- **数据库/Redis/OpenViking**: 内网 only，零公网暴露
- **所有内网通信**: Wireguard 加密隧道（Railway 自动）

### 3.2 知识库隔离模型

```
┌─────────────────────────────────────────────┐
│                  OpenViking                  │
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │ Tenant A     │  │ Tenant B     │        │
│  │ (投资机构)    │  │ (其他客户)    │        │
│  │              │  │              │        │
│  │ 📁 尽调报告   │  │ 📁 ...       │        │
│  │ 📁 投研报告   │  │              │        │
│  │ 📁 LP 协议    │  │              │        │
│  └──────────────┘  └──────────────┘        │
│                                             │
│  account_id = tenant_id（物理隔离）          │
└─────────────────────────────────────────────┘
```

- **企业知识库**: 通过 `tenant_id` 隔离，Tenant A 的 Agent 永远搜不到 Tenant B 的文档
- **Agent 私有空间**: 每个 Agent 有独立的 `agent_data/<uuid>/` 目录
- **共享 vs 私有**: 企业知识库 = 全公司共享；Agent workspace = Agent 私有

### 3.3 Agent 权限边界

| 场景 | 控制机制 |
|------|----------|
| Agent 访问文件 | `security_zone` 决定可访问范围 |
| Agent 发送消息 | `autonomy_policy` 中 `send_feishu_message` 的审批级别 |
| Agent 执行代码 | 沙箱环境 + `autonomy_policy` 中 `write_workspace_files` |
| Agent 联网搜索 | `autonomy_policy` 中 `web_search` 控制 |
| Agent 跨租户 | **不可能** — 三层隔离 + RLS 硬拦截 |

#### 自治级别（Autonomy Levels）
- **L1 (自由执行)**: Agent 直接执行，不需要审批
- **L2 (部分审批)**: 敏感操作需人工确认
- **L3 (全部审批)**: 所有操作都需人工审批

**投资机构推荐配置**:
- 投研助手: L1（日常搜索、整理） + restricted zone（涉及 LP 数据时 L3）
- 合规检查 Agent: L2 + restricted zone
- 客户沟通 Agent: L3 + public zone（所有外发消息必须审批）

### 3.4 敏感数据保护

| 数据类型 | 保护措施 |
|----------|----------|
| LLM API Key | Fernet 加密存储，运行时解密 |
| 用户密码 | bcrypt 哈希，不可逆 |
| JWT Token | HS256 签名 + 过期时间 |
| 投研报告 | 租户隔离 + Agent security_zone |
| LP 协议 | restricted zone + L3 审批 |
| 审计日志 | 哈希链，不可篡改 |

---

## 四、当前进度

### 4.1 已完成 ✅

| 模块 | 状态 | 备注 |
|------|------|------|
| 密钥加密 (SecretsProvider) | ✅ 已部署 | 需设 SECRETS_MASTER_KEY 启用 |
| 三层租户隔离 | ✅ 已部署 | 自动生效 |
| 哈希链审计日志 | ✅ 已部署 | 企业设置 → 审计日志 tab |
| RBAC 权限 | ✅ 已部署 | 自动生效 |
| Redis 限流 | ✅ 已部署 | 自动生效 |
| Feature Flags | ✅ 代码就绪 | 需要管理 UI |
| Agent 状态机 | ✅ 已部署 | 后端自动执行 |
| 配置版本控制 | ✅ 已部署 | Agent 详情 → 设置 |
| 事件总线 | ✅ 已部署 | 后端自动使用 |
| 执行引擎 | ✅ 代码就绪 | 需要接入替换旧的 call_llm |
| Agent 分类 | ✅ 已部署 | 创建向导 step4 |
| API 版本化 | ✅ 已部署 | /api/v1/ |
| 渠道抽象 | ✅ 代码就绪 | 需要逐步迁移旧渠道代码 |
| OpenViking 部署 | ✅ 运行中 | Railway 内网微服务 |
| KB 自动索引 | ✅ 已部署 | 上传文件自动推送 |
| 前端 i18n | ✅ 已部署 | 150+ 字符串中英文 |
| Nginx 动态 DNS | ✅ 已部署 | 解决重部署断连 |

### 4.2 待完成 🔄

| 任务 | 优先级 | 预估工作量 | 说明 |
|------|--------|-----------|------|
| Feature Flags 管理 UI | P1 | 1 天 | 企业设置新增 tab |
| 执行引擎接入 | P1 | 2 天 | 替换 websocket.py 的 call_llm |
| 渠道迁移到抽象层 | P2 | 2 天 | 飞书/Slack/Discord 迁移 |
| OpenViking 语义搜索 UI | P2 | 1 天 | 知识库页面加搜索框 |
| Agent 模板（投资场景） | P2 | 1 天 | 投研助手、合规检查等预设模板 |
| SECRETS_MASTER_KEY UI 配置 | P3 | 0.5 天 | 平台配置 tab |
| 自定义审批流程 | P3 | 2 天 | 多级审批链 |
| SSO 集成（飞书/钉钉） | P3 | 1 天 | 已有飞书 SSO 基础 |

### 4.3 部署架构

```
Railway (Paimon.Finance workspace)
├── Frontend (nginx + React 19)     ── 公网: frontend-production-213e.up.railway.app
├── Backend (FastAPI + SQLAlchemy)   ── 内网: backend.railway.internal:8000
├── OpenViking (知识库引擎)          ── 内网: openviking.railway.internal:1933
├── PostgreSQL 18                    ── 内网: postgres.railway.internal:5432
└── Redis 8.2                        ── 内网: redis.railway.internal:6379
```

---

## 五、投资机构推荐配置

### 5.1 组织架构

```
paimon.finance (租户)
├── 管理员 (platform_admin)
│   └── 管理所有 Agent、模型、工具、配额
├── 投资团队 (member)
│   ├── 投研助手 Agent (internal_tenant, standard)
│   ├── 市场监控 Agent (internal_tenant, standard)
│   └── 尽调助手 Agent (internal_tenant, restricted)
├── 合规团队 (org_admin)
│   └── 合规检查 Agent (internal_tenant, restricted)
└── IR 团队 (member)
    └── LP 沟通 Agent (internal_tenant, public) ← L3 全审批
```

### 5.2 模型配置建议

| 用途 | 推荐模型 | 原因 |
|------|----------|------|
| 日常对话 | GPT-4o / Claude Sonnet | 通用能力强 |
| 投研分析 | Claude Opus / GPT-5 | 长文本理解 + 推理 |
| 快速摘要 | GPT-5-nano / Qwen3.5-Flash | 便宜快速 |
| Embedding | Qwen3-Embedding-8B (OpenRouter) | $0.01/1M，性价比最高 |
| 知识库 VLM | Qwen3.5-Flash (OpenRouter) | $0.05/1M，文档解析 |

### 5.3 安全配置清单

- [ ] 设置 `SECRETS_MASTER_KEY` 启用 API Key 加密
- [ ] 设置 `CORS_ORIGINS` 为具体域名（不要用 `*`）
- [ ] 设置强 `JWT_SECRET_KEY` 和 `SECRET_KEY`
- [ ] 启用邀请码注册（防止未授权注册）
- [ ] 为涉及 LP 数据的 Agent 设置 `restricted` 安全区
- [ ] 为对外沟通 Agent 设置 L3 全审批
- [ ] 定期检查审计日志

---

## 六、成本估算

### 6.1 基础设施（Railway）

| 服务 | 预估月费 |
|------|----------|
| Backend | $5-10 |
| Frontend | $3-5 |
| OpenViking | $5-10 |
| PostgreSQL | $5-10 |
| Redis | $3-5 |
| **合计** | **$21-40/月** |

### 6.2 AI API 费用（按 10 个 Agent 估算）

| 用途 | 月调用量 | 单价 | 月费 |
|------|---------|------|------|
| LLM 对话 | ~5M tokens | ~$2.5/1M | ~$12.5 |
| Embedding | ~2M tokens | $0.01/1M | ~$0.02 |
| VLM 解析 | ~1M tokens | $0.05/1M | ~$0.05 |
| **合计** | | | **~$13/月** |

### 总计: **~$35-55/月** — 远低于任何企业级 AI 平台

---

## 七、与竞品对比

| 能力 | Clawith (本次升级) | Coze | Dify | AutoGen |
|------|-------------------|------|------|---------|
| 多 Agent 协作 | ✅ 原生支持 | ❌ 单 Agent | ⚠️ 有限 | ✅ |
| 持久身份/记忆 | ✅ soul.md + memory.md | ❌ | ❌ | ❌ |
| 多租户隔离 | ✅ 三层隔离 + RLS | ❌ | ⚠️ workspace 级 | ❌ |
| 审计日志 | ✅ 哈希链 | ❌ | ⚠️ 基础 | ❌ |
| API Key 加密 | ✅ Fernet | ❌ | ❌ | N/A |
| 自主触发 | ✅ 6 种触发器 | ⚠️ 定时 | ⚠️ webhook | ❌ |
| 私有部署 | ✅ 完全自主 | ❌ SaaS only | ✅ | ✅ |
| 渠道集成 | ✅ 6 个平台 | ⚠️ 有限 | ⚠️ 有限 | ❌ |
| 知识库引擎 | ✅ OpenViking | ⚠️ 基础 RAG | ✅ | ❌ |
| 月费 | ~$50 | $99+/人 | $159+/人 | 免费(无托管) |

---

*文档生成时间: 2026-03-17*
*作者: Clawith Engineering Team*
