# 01 · Studio Server

Studio Server 是一个单一的 Node.js 进程，在 8787 端口同时提供 HTTP 与 WebSocket，托管 OpenAI 兼容代理，调度任务，跟踪财务，持久化章程 / 策略 / 路由，并向所有连上的 UI 广播 StudioEvents。

**源码：** `apps/studio-server/src/index.ts`（约 3,630 LOC）、`src/asset-pipeline.ts`（约 280 LOC）

## 它做什么

| 关注点 | 位置 | 原因 |
|---------|-------|-----|
| HTTP 路由 | `createServer` + `if (url.pathname === ...)` 链式判断 | 手写路由；不依赖 Express / Fastify——把安装体积压到最小 |
| OpenAI 代理 | 链路末端的 `/v1/*` catch-all | 对任何 OpenAI 兼容客户端（Cursor、Cline、Continue 等）透明 |
| WebSocket | `ws` 8.x，挂载在 `/ws` upgrade 上 | 一次广播，多个 UI |
| 文件监听 | `chokidar` 监听仓库根目录（忽略 `node_modules`、`.git`、`dist`、日志路径） | 产出 `fs.change` 事件供办公室使用 |
| 任务队列 | 内存中的 `Array<Job>` + `Map<slotId, Job>` 表示运行中 | 默认串行；`ComputeSlots` 控制并发度 |
| 雇佣名册 | `Set<agentId>`，持久化到 `production/studio-hired.json` | 可选门禁——只有被雇佣的 Agent 才会入队 |
| 策略 | `production/policy.json` —— 3 层（Producer / TD / CD） | 每层可为 "rules" 或 "llm" 模式 |
| 章程 | `production/charter/state.json` —— 每项目草稿 + 归档历史 | 保存时检测漂移 |
| 模型路由 | `production/model-routing.json` —— `tier: save | balance | quality` | 决定会议与执行环节走云端还是本地 |
| 财务 | 读取 `studio_events.jsonl`，汇总 token / 请求 / 成本 / 失败 | 按提供方归属成本 |
| 预览存储 | `production/preview/<projectId>/index.html` + `history/*.html` | 从 Agent 输出自动保存 |
| 资源管线 | `studioGenerateImages`、`studioPackSpritesheet`、`studioTranscodeVideo` | OpenAI images API + sharp + ffmpeg |

## 启动顺序

```ts
export async function main() {
  const env = getEnv();              // 端口 8787，host 127.0.0.1，仓库根
  // ... 打开 WebSocketServer（noServer: true）
  // ... 加载策略、模型路由、雇佣名册
  // ... 启动 chokidar 监听器
  // ... 启动 HTTP 服务
  server.listen(env.port, env.host);
  console.log(`[studio-server] listening on http://${env.host}:${env.port}`);
}
```

该函数返回正在运行的 server；除非被 kill，否则永不会退出。

## HTTP 接口（精选）

> 完整参考：[开放 API 参考](/docs/13-api-reference)。以下为非穷尽式精选：

### 资源端点

| 方法 | 路径 | 用途 |
|--------|------|---------|
| GET | `/api/agents` | 列出所有 Agent（解析 `.claude/agents/*.md` frontmatter） |
| GET | `/api/projects` | 列出项目 + `currentProjectId` |
| POST | `/api/projects` | 新建项目（默认标题："Default Project"） |
| POST | `/api/projects/select` | 切换当前项目 |
| GET | `/api/hire` | 读取雇佣名册 |
| POST | `/api/hire` | 切换某 Agent 的雇佣状态 |
| POST | `/api/hire/sync_all` | 恢复全部 Agent（重置） |

### 工作流端点

| 方法 | 路径 | 用途 |
|--------|------|---------|
| POST | `/api/queue/enqueue` | 加入任务；`autoSplit: true` → 按换行拆分 |
| GET | `/api/queue` | 读取队列与运行中任务 |
| POST | `/api/dept/workorder/action` | 对某部门执行 Approve / Reject / Redo |
| POST | `/api/meeting/start` | 发起一次会议（Producer / TD / CD 轮转） |
| GET | `/api/charter` | 读取某项目的草稿与已归档章程 |
| POST | `/api/charter` | 保存草稿 / 归档版本 |

### 对接大模型的端点

| 方法 | 路径 | 用途 |
|--------|------|---------|
| GET POST | `/v1/*` | 透明代理到 `STUDIO_UPSTREAM_BASE_URL` |
| POST | `/api/bench` | 测量 upstream 的首分片延迟 |
| POST | `/api/bench/sweep` | 并发度扫描 `[1,2,3]` |
| GET | `/api/advice` | 当前宿主推荐提供方与模型档位 |
| GET | `/api/system/profile` | 检测宿主 GPU / 内存（Windows 使用 CIM） |

### 运维端点

| 方法 | 路径 | 用途 |
|--------|------|---------|
| GET POST | `/api/policy` | 读取或写入 StudioPolicy |
| GET POST | `/api/model-routing` | 读取或写入档位 |
| GET | `/api/finance/summary?range=today` | token / 成本 / 失败汇总 |
| POST | `/api/finance/reset` | 标记一次重置（不会截断日志） |
| POST | `/api/emit` | 允许 UI 推送任意 `StudioEvent`（例如用户操作） |
| GET | `/preview?projectId=X&v=...` | 提供预览 HTML（iframe 目标） |
| GET POST | `/api/preview/save`、`/api/preview/history`、`/api/preview/restore` | 管理预览历史 |

## OpenAI 代理（承重墙）

`/v1/*` catch-all 让 AiGameAgent **对任何 OpenAI 客户端都能用**——Cursor、Continue、Cline、Aider，乃至裸 `curl`。老板可以把 Cursor 指到 `http://127.0.0.1:8787/v1`，然后 Studio 会：

1. 将请求（去掉 `Host`、`x-studio-*` header）转发到 `STUDIO_UPSTREAM_BASE_URL`
2. 流式回传 SSE 分片，解析 `data:` 行
3. 为文本 delta 发出 `llm.chunk` 事件
4. 检测 `tool_calls` 并按工具发出 `tool.start` / `tool.end`
5. 在 `[DONE]` 时发出 `llm.message_done`
6. 附带一个带任务（取自 `x-studio-task` header）的 `agent.assign` 事件

脱敏是刻意的——`Authorization` 在任何调试日志里都被替换成 `Bearer ***`。

## 任务调度器（队列）

```ts
type Job = {
  id: string;
  agentId: string;
  task: string;
  priority: number;
  createdAt: string;
  providerId: string;
  projectId: string;
  workgroupId: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  source?: string;
  producerChainId?: string;
  producerChainStepIndex?: number;
};
```

**派发规则：** 优先级降序，同档位内 FIFO。调度器在每次入队后都会跑一次 `pumpQueue()`。

**项目上限：** 按宿主能力分级（`S` → 3 个并行项目，`A` → 2，`B/C` → 1）。给 `S` 级宿主入队第 4 个项目时会以 `error: project_limit_reached` 拒绝。

**自动外包：** 如果本地 `firstChunkMs > 1800` 且配置了 `cloud` 提供方，TD 策略可以把任务提升到云端。

## 雇佣名册

```ts
const hired = new Set<string>();            // 内存中
const agentProvider = new Map<string, string>();  // 按 Agent 覆盖提供方

async function loadHiredInitial() {
  if (existsSync(studioHiredPath)) {
    // 从 production/studio-hired.json 加载
  } else {
    // 默认：雇佣 .claude/agents/ 中的全部 Agent
  }
}
```

如果 `hired.size > 0` 且目标 Agent 不在名册中，入队调用会以 `agent_not_hired` 拒绝。（空 `hired` = 不设门禁。）

## 策略

```ts
type StudioPolicy = {
  v: 1;
  producer: { mode: "rules" | "llm"; autoSplit: boolean; autoDispatch: boolean; maxSubtasks: number };
  technicalDirector: { mode: "rules" | "llm"; autoOutsource: boolean; firstChunkMsThreshold: number; pauseOnErrors: boolean };
  creativeDirector: { mode: "rules" | "llm"; gateOnNoPreview: boolean; requireAcceptanceCriteria: boolean };
};
```

**默认策略** 是三层都使用 `rules` 模式，`autoSplit: true`、`maxSubtasks: 5`、`gateOnNoPreview: false`、`requireAcceptanceCriteria: true`。LLM 模式（例如 `technicalDirector.mode: "llm"`）保留给未来 LLM 驱动的决策。

## 章程与变更控制

```ts
type CharterBody = { goal: string; milestones: string[]; nodes: string[] };
type CharterArchived = CharterBody & { version: number; archivedAt: string };
type PerProjectCharter = { draft: CharterBody; archived: CharterArchived | null; history: CharterArchived[] };
type PendingChange = { kinds: string[]; count: number; updatedAt: string; lastNotifyTs?: string };
```

当草稿与最近一份归档不一致时，服务端会计算 `driftKinds()`，并以 `change.detected` 事件对外呈现。老板随后在会议室里"清除"待处理的变更。

## FS 监听器

`chokidar` 监听整个仓库根目录，忽略：

- `**/node_modules/**`
- `**/.git/**`
- `**/dist/**`
- 日志路径自身
- `**/production/session-logs/**`
- `**/production/session-state/**`

每个事件被包装成 `fs.change` 信封并广播。办公室借此检测 Agent 编辑了哪个文件（并更新对应 Agent 的"工具"状态）。

## 资源管线（独立文件）

`asset-pipeline.ts` 导出三个异步函数：

```ts
studioGenerateImages({ repoRoot, projectId, prompt, n, size, imageBaseUrl, apiKey, model })
  → 写入 production/preview/<pid>/assets/gen/<runId>/{0..n-1}.png

studioPackSpritesheet({ repoRoot, projectId, sourceDir, outputName, maxWidth })
  → 使用 sharp 合成，写入 <name>.png + <name>.json（帧元数据）

studioTranscodeVideo({ repoRoot, projectId, input, output, codec })
  → spawn ffmpeg（或 FFMPEG_PATH），写入结果文件
```

图像生成器命中任何 OpenAI 兼容的 `images/generations` 端点。`n` 被夹在 1-10；`size` 默认为 `1024x1024`；`model` 默认为 `dall-e-2`。

## 安全与边界

- **默认仅 loopback**：`STUDIO_HOST=127.0.0.1`。要暴露到局域网需要显式环境变量。
- **路径遍历守卫**：所有项目 ID 在做任何路径拼接前都会被清洗到 `[a-zA-Z0-9_-]`。
- **CORS**：`applyCorsHeaders` 对 origin 允许 `*`，但生产部署预期位于反向代理之后。
- **脱敏**：`Authorization` header 在调试输出中被替换为 `Bearer ***`。
- **无 eval / 动态 require**：所有模块都是静态导入；任何用户输入都不会传给 `require()` 或 `eval()`。

## 服务端处理的失败模式

| 失败 | 行为 |
|---------|-----------|
| 上游返回 5xx | `job.finished` 携带 `ok: false`、`failureReason`、`upstreamStatus` |
| SSE 解析错误 | 仍然转发原始分片；发出一个通用的 chunk 事件 |
| 大模型返回非 JSON | 尝试 `parseMeetingTranscriptJson` → 回退到 `parseMeetingTranscriptLoose`（基于 `Secretary:...` 的正则） |
| 大模型返回被 ```fences``` 包裹的 JSON | 先剥掉外层 fences |
| 大模型返回嵌入 JSON 的散文 | `sliceOutermostJsonObject` 提取第一个 `{...}` 块 |
| Chokidar 对已删除文件触发 | 仍然以 `kind: unlink` 发出 `fs.change`——由 UI 忽略 |
| Charter state.json 损坏 | 被捕获；使用内存中的状态；在下一次保存前不会覆盖文件 |
| 队列请求中的提供方无效 | 以 `error: unknown_provider`（400）拒绝 |

## 接下来

- [Studio Web（等距办公室）](/docs/02-studio-web)——消费以上所有内容的前端
- [共享事件总线](/docs/03-events-bus)——服务端发出的 25 种事件类型
- [开放 API 参考](/docs/13-api-reference)——完整路由表
