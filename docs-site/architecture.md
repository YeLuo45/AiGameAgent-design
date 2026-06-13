# 架构

AiGameAgent Studio 是一个**包含三个工作区的 monorepo**，外加一层 OpenSpec 变更控制，目标是在单个 Node.js 进程内运行一座小型虚拟游戏工作室。

## 全局架构图

```mermaid
flowchart TB
  subgraph Boss["🧑‍💼 老板（浏览器）"]
    UI["Studio Web UI<br/>（Phaser 办公室 + DOM HUD）"]
  end

  subgraph Server["Node.js 进程（端口 8787）"]
    HTTP["HTTP server<br/>（node:http）"]
    WS["WebSocket /ws<br/>（ws）"]
    FS["chokidar 文件系统监听器"]
    Queue["任务队列 +<br/>ComputeSlots 调度器"]
    Hire["雇佣名册<br/>（按 Agent 维度的提供方）"]
    Policy["工作室策略<br/>（Producer / TD / CD）"]
    Charter["项目章程<br/>（目标 / 里程碑 / 节点）"]
    Finance["财务汇总<br/>（token / 成本 / 失败）"]
    Proxy["OpenAI 代理 /v1/*"]
  end

  subgraph Local["本地大模型"]
    Ollama["Ollama<br/>http://127.0.0.1:11434/v1"]
    vLLM["vLLM / LM Studio"]
  end

  subgraph Cloud["可选云端"]
    API["OpenAI / DeepSeek /<br/>Doubao / 自托管"]
  end

  UI -->|fetch /api/*<br/>WS /ws| HTTP
  UI -.->|WebSocket<br/>StudioEvents| WS
  FS -->|fs.change| WS
  HTTP --> Queue
  HTTP --> Hire
  HTTP --> Policy
  HTTP --> Charter
  HTTP --> Finance
  HTTP --> Proxy
  Proxy --> Ollama
  Proxy --> vLLM
  Proxy --> API
  Proxy -->|SSE chunks →<br/>StudioEvents| WS
  Queue -->|enqueue to LLM| Proxy
```

## 分层拆解

| 层 | 代码 | 职责 |
|------|------|----------------|
| **表现层** | `apps/studio-web/src/main.ts`（约 4,250 LOC） | Phaser 等距办公室、DOM HUD / 抽屉、WebSocket 客户端、面板逻辑 |
| **服务端核心** | `apps/studio-server/src/index.ts`（约 3,630 LOC） | HTTP 路由、队列、雇佣、策略、章程、财务、代理、WebSocket 广播 |
| **资源管线** | `apps/studio-server/src/asset-pipeline.ts`（约 280 LOC） | 图像生成、雪碧图打包、视频转码（sharp + ffmpeg） |
| **共享类型** | `packages/shared/src/studio-events.ts`（约 240 LOC） | 25 种 StudioEvent 类型、StudioAgentState、reduceState reducer |
| **变更控制** | `openspec/` | 9 份能力规范 + 1 份已归档的变更提案 |
| **Agent 清单** | `.claude/agents/*.md`（30 份文件） | frontmatter + 正文，声明每个 Agent 的角色、工具、范围 |
| **Skill 库** | `.claude/skills/*/SKILL.md`（44 个 skill） | 可复用的流程（setup-engine、brainstorm、gate-check 等） |
| **规则** | `.claude/rules/*.md`（7 条规则） | 路径作用域内的风格 / 架构规则（engine-code、design-docs 等） |
| **钩子** | `.claude/hooks/*.sh`（6 个钩子） | SessionStart / PreCompact / session-stop / pre-commit / pre-push 门禁 |

## 请求流示例：老板开启一次会议

1. **UI** 打开会议抽屉 → 以 `{ projectId, topic }` 调用 `POST /api/meeting/start`
2. **服务端** 构造项目专属的会议任务 → 以 `source=meeting_kickoff` 入队给 Producer / TD / CD
3. **调度器** 在 `ComputeSlots`（默认 1，可配置）中执行该任务 → 通过 `/v1/chat/completions` 调用大模型
4. **代理** 流式回传 SSE → 为每个 delta 发出 `llm.chunk` 事件
5. **WebSocket** 将事件扇出给所有 UI 客户端
6. **UI** 归并状态 → 重绘办公室 → secretary HUD 进行总结
7. **UI** 自动将完整 HTML 输出保存到 `production/preview/<projectId>/index.html`

## 请求流示例：Agent 写出 HTML 预览

```mermaid
sequenceDiagram
    participant Agent as LLM Agent
    participant Proxy as /v1/* 代理
    participant Bus as WebSocket 总线
    participant UI as Studio Web
    participant FS as production/preview/

    Agent->>Proxy: POST /v1/chat/completions (stream=true)
    Proxy-->>Agent: SSE 分片
    Proxy->>Bus: emit llm.chunk (text)
    Bus-->>UI: 广播
    UI->>UI: reduceState → 气泡展示文本
    Note over UI: 在 Agent 输出中检测到完整 <html>...</html>
    UI->>Proxy: POST /api/preview/save
    Proxy->>FS: 写入 index.html
    FS-->>UI: 预览 URL
```

## 模块依赖图

```mermaid
graph LR
  web[studio-web] --> shared[shared/studio-events]
  server[studio-server] --> shared
  server --> asset[asset-pipeline]
  web -.HTTP/WS.-> server
  server -.OpenAI 兼容.-> LLM[(本地 / 云端大模型)]
  web --> phaser[Phaser 3.90]
  server --> ws[ws 8.x]
  server --> chokidar[chokidar 4]
  asset --> sharp[sharp 0.34]
```

## 核心抽象

- **StudioEventEnvelope** —— `{ v, ts, type, sessionId, correlationId, agentId?, payload }` 是所有事件共用的单一类型，其上派生 25 种带类型的变体。
- **Job** —— `{ id, agentId, task, priority, createdAt, providerId, projectId, workgroupId, status, source?, producerChainId? }`
- **StudioPolicy** —— 三层：`producer`、`technicalDirector`、`creativeDirector`；每层可以是 `rules` 或 `llm` 模式。
- **Hire roster** —— `Set<agentId>`；首次运行时默认载入全部 30 个 Agent。
- **Charter** —— 每个项目 `{ goal, milestones[], nodes[] }`，带有 `version + archivedAt` 快照。
- **Provider** —— `{ id, label, kind: local|lan|cloud, baseUrl, model, capabilities, pricing }`。

## 工作区布局（带注释）

```
AiGameAgent/
├── apps/
│   ├── studio-server/        # Node.js HTTP + WS，端口 8787
│   │   ├── src/index.ts      # 主服务端（3,630 LOC）
│   │   ├── src/asset-pipeline.ts
│   │   └── tsconfig.json
│   └── studio-web/           # Phaser + Vite，dev 端口 5173
│       ├── src/main.ts       # 4,250 LOC：办公室 + DOM HUD
│       ├── src/style.css
│       ├── index.html
│       └── vite.config.ts
├── packages/
│   └── shared/
│       └── src/studio-events.ts  # 25 种事件类型 + reducer
├── .claude/
│   ├── agents/               # 30 份角色清单
│   ├── skills/               # 44 份 SKILL.md 流程
│   ├── rules/                # 7 条路径作用域规则
│   ├── hooks/                # 6 个生命周期脚本
│   └── docs/                 # 9 份协作 / 搭建文档
├── openspec/
│   ├── config.yaml
│   ├── specs/                # 9 份能力规范
│   └── changes/              # 1 份已归档变更
├── docs/                     # 协作 + 端到端清单
├── production/               # 运行时状态（已 gitignore）
├── scripts/                  # studio-e2e-smoke.mjs
├── package.json              # npm workspaces
└── tsconfig.base.json
```

## 接下来

- 查看 [技术栈](/tech-stack) 了解具体版本与各模块职责。
- 想读服务端代码？从 [Studio Server](/docs/01-studio-server) 开始。
- 想读客户端代码？从 [Studio Web](/docs/02-studio-web) 开始。
