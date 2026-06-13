# 13 · 开放 API 参考

Studio 服务端暴露的每一个 HTTP 端点。路由按声明顺序匹配；`/v1/*` 是兜底的 OpenAI 代理，必须放在最后。

> 所有非 `/v1/*` 路由均返回 JSON。`404` 为 `{ "error": "not_found" }`。`500` 为 `{ "error": "internal_error", "message": "<details>" }`。每个响应都设置了 CORS 头（`access-control-allow-origin: *`）。

## 健康与机器信息

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/system/profile` | `{ ok, platform, osName, memGB, cpuModel, gpuName?, vramGB? }` |

## 资源

### Agent

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/agents` | — | `{ agents: Array<{id, description?}> }` |

### 项目

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/projects` | — | `{ projects: Array<{id,title,createdAt}>, currentProjectId }` |
| `POST` | `/api/projects` | `{ title?: string }` | `{ ok, project, projects, currentProjectId }` |
| `POST` | `/api/projects/select` | `{ projectId: string }` | `{ ok, currentProjectId }` |

### 雇佣

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/hire` | — | `{ hired: string[] }`（已排序） |
| `POST` | `/api/hire` | `{ agentId, hired: boolean }` | `{ hired: string[] }` |
| `POST` | `/api/hire/sync_all` | — | `{ ok, hired: string[] }` |

### 队列

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/queue` | — | `{ queue: Job[], running: Job[] }` |
| `POST` | `/api/queue/enqueue` | `{ agentId, task, priority?, autoSplit?, providerId?, projectId?, workgroupId? }` | `{ ok, job, providerReason?, split? }` 或 `{ ok, jobs, providerReason, split: true }` |

`Job` 结构：`{ id, agentId, task, priority, createdAt, providerId, projectId, workgroupId, status, source?, producerChainId? }`

### 部门工单

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/dept/workorder/action` | `{ deptId, action: "approve"\|"reject"\|"redo", agentId?, projectId?, workgroupId? }` | `{ ok, job, providerReason, task }` |

## 工作流

### 会议

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/meeting/start` | `{ projectId, topic? }` | `{ ok, projectId }` |
| `POST` | `/api/meeting/llm_ping` | `{}` | `{ ok, providerId, model, baseUrl, latencyMs, snippet? }` 或 `{ ok: false, error, ... }` |

### 章程（Charter）

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/charter?projectId=X` | — | `{ ok, projectId, draft: { goal, milestones[], nodes[] }, archived: {goal, milestones[], nodes[], version, archivedAt}\|null, history: CharterArchived[] }` |
| `POST` | `/api/charter` | `{ projectId, action: "save_draft"\|"archive", draft?: CharterBody }` | `{ ok, ... }` |
| `GET` | `/api/charter/changes?projectId=X` | — | `{ ok, pending: { kinds: string[], count, updatedAt, lastNotifyTs? }\|null }` |
| `POST` | `/api/charter/changes/clear` | `{ projectId }` | `{ ok }` |

### 预览

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/preview?projectId=X[&v=file.html]` | — | HTML（预览 iframe 的目标） |
| `POST` | `/api/preview/save` | `{ projectId, html }` | `{ ok, projectId, file }` |
| `GET` | `/api/preview/history?projectId=X` | — | `{ ok, files: string[] }` |
| `POST` | `/api/preview/restore` | `{ projectId, file }` | `{ ok, projectId }` |

### 资源管线（服务端内置）

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/asset/images` | `{ projectId, prompt, n?, size?, model? }` | `{ ok, runId, files[], relPaths[] }` 或 `{ ok: false, error, status? }` |
| `POST` | `/api/asset/spritesheet` | `{ projectId, sourceDir, outputName, maxWidth? }` | `{ ok, output, json, frameCount }` |
| `POST` | `/api/asset/video` | `{ projectId, input, output, codec? }` | `{ ok, output }` |

## 面向 LLM

| Method | Path | Notes |
|--------|------|-------|
| `GET POST` | `/v1/*` | 透明转发 OpenAI 兼容的代理 → `STUDIO_UPSTREAM_BASE_URL` |
| `POST` | `/api/bench` | 一次性首字块延迟测试 |
| `POST` | `/api/bench/sweep` | 并发扫描；body：`{ concurrencyLevels: number[] }` |
| `GET` | `/api/advice` | 当前主机的推荐提供方 + 档位 + 模型列表 |
| `POST` | `/api/system/route` | `{ agentId, providerId }` —— 按 Agent 覆盖 |

### `/v1/*` 识别的头

- `x-studio-agent: <id>` → 以该 agentId 发出 `agent.assign`
- `x-studio-task: <task>` → 发出 `agent.assign.payload.task`
- `authorization: Bearer ***` → 转发到上游，在调试日志中**被脱敏**

## 运维

### 策略

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/policy` | — | `{ ok, policy: StudioPolicy }` |
| `POST` | `/api/policy` | `{ policy: StudioPolicy }` | `{ ok, policy }` |

### 模型路由

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/model-routing` | — | `{ ok, modelRouting: { tier, executionProviderId, meetingProviderId } }` |
| `POST` | `/api/model-routing` | `{ tier: "save"\|"balance"\|"quality" }` | `{ ok, modelRouting }` |

### 财务

| Method | Path | Query | Returns |
|--------|------|-------|---------|
| `GET` | `/api/finance/summary` | `range=today`（v1 仅此取值） | `{ range, tokensEstimated, requests, cost, failures, failuresByReason, requestsByProvider }` |
| `POST` | `/api/finance/reset` | — | `{ ok }` |
| `GET` | `/api/studio/failures` | `limit?`（默认 25） | `{ ok, failures: Array<{ts, type, correlationId, agentId?, payload}> }` |

### 事件发射（UI → 服务端）

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/emit` | `{ type, agentId?, payload? }` | `{ ok }` |

允许 UI 将任意 `StudioEvent` 推入事件总线。用于"用户点击了批准"等老板操作。

## StudioEvent WebSocket（`/ws`）

连接到 `ws://127.0.0.1:8787/ws`。服务端会发送 JSON 编码的 `StudioEventEnvelope` 对象。没有按客户端的过滤；每个连接的客户端都会看到所有事件。

消费示例：

```ts
const ws = new WebSocket("ws://127.0.0.1:8787/ws");
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  console.log(ev.type, ev.payload);
};
```

服务端大约每 30 秒发送一次 `heartbeat` 事件——客户端可以将其作为"仍然存活"的信号。

## 错误码

| Code | 含义 | 出现位置 |
|------|---------|-------|
| `bad_json` | 请求体不是合法 JSON | `/api/queue/enqueue`、`/api/finance/reset` 等 |
| `unknown_provider` | `providerId` 不在名册中 | `/api/queue/enqueue`、`/api/system/route` |
| `provider_not_supported_for_text` | 提供方能力中不包含 "text" | `/api/queue/enqueue` |
| `missing_agent_or_task` | agentId 或 task 为空 | `/api/queue/enqueue` |
| `agent_not_hired` | agentId 不在雇佣名册中 | `/api/queue/enqueue` |
| `project_limit_reached` | 活跃项目数 ≥ 档位上限 | `/api/queue/enqueue`、`/api/dept/workorder/action` |
| `gate_no_preview` | Creative Director 关卡因没有 preview 而阻塞 | `/api/dept/workorder/action` |
| `not_found` | 没有匹配的路由 | 任意 |
| `internal_error` | 未处理的异常 | 任意 |

## StudioPolicy 结构

```ts
type StudioPolicy = {
  v: 1;
  producer: {
    mode: "rules" | "llm";
    autoSplit: boolean;
    autoDispatch: boolean;
    maxSubtasks: number;       // 1-12
  };
  technicalDirector: {
    mode: "rules" | "llm";
    autoOutsource: boolean;
    firstChunkMsThreshold: number;  // ms
    pauseOnErrors: boolean;
  };
  creativeDirector: {
    mode: "rules" | "llm";
    gateOnNoPreview: boolean;
    requireAcceptanceCriteria: boolean;
  };
};
```

## 变更日志

| Date | Change |
|------|--------|
| 2026-06 | v1 —— 初始 API 表面 |
| 2026-06 | 新增 `/api/system/profile`（Windows GPU 检测） |
| 2026-06 | 新增 `/api/bench/sweep`（并发扫描） |

## 接下来

- [Studio 服务端](/docs/01-studio-server) —— 代码导读
- [共享事件总线](/docs/03-events-bus) —— 这些端点会发出哪些事件
- [部署](/docs/14-deployment) —— 在不同环境中运行该服务
