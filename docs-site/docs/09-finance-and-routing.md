# 09 · 财务与模型路由

AiGameAgent **具备财务感知**：每个 token、每次请求、每次失败都归因到一个提供方。老板能看一次会话的成本、按原因的失败率、按提供方的请求分布。一套简单的三档模型路由（save / balance / quality）决定新请求的去向。

**Source:** `apps/studio-server/src/index.ts`（财务汇总、模型路由）+ `production/model-routing.json`

## 三档

```ts
type ModelRouting = {
  tier: "save" | "balance" | "quality";
  executionProviderId: string;   // 普通 Agent Job 使用
  meetingProviderId: string;     // 会议室（领导层）Job 使用
};
```

| 档 | 执行 | 会议 | 何时选用 |
|------|-----------|---------|--------------|
| `save` | `local`（Ollama） | `local` | 「不出云账单——全本地」 |
| `balance` | `local`（Ollama） | `cloud` | 「默认：廉价的执行，聪明的会议」 |
| `quality` | `cloud` | `cloud` | 「钱不是问题，全部交给最强模型」 |

默认为 `balance`。切换档会写入 `production/model-routing.json`，并且不发事件（这是设置切换，不是状态变化）。

## Job 如何选择提供方

```ts
function pickQueueProviderId(agentId: string, opts): { providerId: string; providerReason?: string } {
  // 1. Explicit override on the enqueue
  if (opts.providerId) return { providerId: opts.providerId };

  // 2. Per-agent override (set by /api/system/route)
  if (agentProvider.has(agentId)) return { providerId: agentProvider.get(agentId)!, providerReason: "agent_provider_override" };

  // 3. Tier-based routing
  const tier = modelRouting.tier;
  if (opts.usage === "meeting") {
    return { providerId: modelRouting.meetingProviderId, providerReason: `tier_${tier}_meeting` };
  }
  return { providerId: modelRouting.executionProviderId, providerReason: `tier_${tier}_execution` };
}
```

`providerReason` 会作为 `policy.decision` 事件发出，便于老板审计走了哪条路径。

## 提供方配置

```ts
type Provider = {
  id: string;
  label: string;
  kind: "local" | "lan" | "cloud";
  baseUrl: string;          // OpenAI-compatible /v1
  model: string;
  capabilities: Array<"text" | "image" | "music">;
  pricing: { inputPer1k: number; outputPer1k: number; currency: string };
};
```

默认提供方（在 `getProviders()` 中硬编码）：

| ID | Label | Kind | baseUrl | Pricing |
|----|-------|------|---------|---------|
| `local` | Local (Ollama) | local | `http://127.0.0.1:11434/v1` | `0 / 0` |
| `lan` | LAN (vLLM) | lan | `http://127.0.0.1:8000/v1` | `0 / 0` |
| `cloud` | Cloud (OpenAI) | cloud | `https://api.openai.com/v1` | `0.005 / 0.015` USD |

`studio-providers.json`（gitignored）会覆盖默认值；老板可以加入自己的（例如 `deepseek`、`doubao`），无需重启。

## 财务汇总端点

```http
GET /api/finance/summary?range=today
```

响应：

```json
{
  "range": "today",
  "tokensEstimated": 42310,
  "requests": 47,
  "cost": 0.63,
  "failures": 3,
  "failuresByReason": {
    "upstream_5xx": 2,
    "timeout": 1
  },
  "requestsByProvider": {
    "local": 39,
    "cloud": 8
  }
}
```

### 它是怎么算出来的

1. 读取 `studio_events.jsonl` 最近 5,000 行
2. 筛选出 `ts` 落在 `range` 内、且在同一 `range` 的最后一次 `finance.reset` 之后的事件
3. **tokensEstimated** = 这些事件中 `llm.chunk.payload.text.length` 之和，再除以 4（粗略的字符/Token 比）
4. **requests** = `job.started` 的计数
5. **cost** = `(tokensEstimated / 1000) * cloud.pricing.outputPer1k`（仅算 cloud——local 免费）
6. **failures** = `ok === false` 的 `job.finished` 计数
7. **failuresByReason** = 按 `payload.failureReason` 分组
8. **requestsByProvider** = 按 `job.started.payload.providerId` 分组

> 这个 token 估算（字符数 / 4）是有意粗糙的。未来的变更可以替换成按模型的 tokenizer。

### 为什么是「最近 5,000 行」？

事件日志会无界增长。读整个文件终究会变慢；只读尾部既快，又能覆盖典型会话。实际预算为 5,000 行或 24 小时，取较短者。

### 重置语义

`POST /api/finance/reset` 会向日志发出一条 `finance.reset` 事件；后续读取时，**最后一次 reset 之前**的事件不计入。日志本身**不会**被截断——老板仍能在 `studio_events.jsonl` 中看到完整的审计轨迹。

## 每次失败的归因

每条 `job.failed` 都带：

```ts
{
  jobId: string;
  stage: string;        // 例如 "upstream"、"parse"、"policy"
  message: string;
  hint?: string;
  failureReason?: string;  // 例如 "upstream_5xx"、"timeout"、"cancelled"、"policy_block"
  projectId?: string;
  workgroupId?: string;
}
```

每条 `job.finished`（无论成功或失败）都带：

```ts
{
  jobId: string;
  ok: boolean;
  failureReason?: string;
  durationMs?: number;
  providerId?: string;
  upstreamStatus?: number;  // 上游返回的 HTTP 状态码
}
```

这就是 `studio-finance-telemetry` 中的规范：

> **Requirement: job.finished MUST carry attributable fields**
> When a task execution fails, the system SHALL include in `job.finished.payload`: `failureReason`, `durationMs`, `providerId`; if the upstream returns an HTTP status code, it MUST include `upstreamStatus`.

## 硬件等级 → 项目上限

服务端为主机计算一个「等级」（S / A / B / C），并以此为**并发活跃项目数**封顶：

```ts
const snap = await getAdviceSnapshot();
const projectLimit = snap.grade === "S" ? 3 : snap.grade === "A" ? 2 : 1;
```

等级由 advice 快照（内存 + GPU + 基准延迟）推导而来：24GB+ GPU + 低首块延迟 → `S`；8GB GPU + 约 2 秒首块 → `A`；纯 CPU 的 3B → `B/C`。

如果老板在 `activeProjects.size >= projectLimit` 时试图为新项目入队 Job，请求会以 `error: project_limit_reached` 返回 400。

## 设置 + 策略

```ts
const settings = {
  computeSlots: 1,                                  // 默认串行
  autoOutsource: true,                              // 首块过慢则升到 cloud
  autoOutsourceFirstChunkMsThreshold: 1800          // 1.8 秒阈值
};
```

`autoOutsource` 在启动时从策略中读取：

```ts
settings.autoOutsource = Boolean(policy.technicalDirector?.autoOutsource);
settings.autoOutsourceFirstChunkMsThreshold = Number(
  policy.technicalDirector?.firstChunkMsThreshold ?? settings.autoOutsourceFirstChunkMsThreshold
);
```

升档逻辑在 `pumpQueue()` worker 里——若首块在 `autoOutsourceFirstChunkMsThreshold` 之内没到达且存在 `cloud` 提供方，worker 会把请求重发到 `cloud`，并发出 `action: "auto_outsource"` 的 `policy.decision`。

## 老板面向的 UI：「Policy」抽屉

「Policy」（策略）抽屉暴露：

- Producer 模式（rules / llm）+ autoSplit + autoDispatch + maxSubtasks
- Technical Director 模式 + autoOutsource + 首块阈值 + 错误时暂停
- Creative Director 模式 + 无预览不放行 + 必须有验收标准
- 模型档单选（save / balance / quality），带一个独立的保存按钮

保存策略会写 `production/policy.json`；保存模型档会写 `production/model-routing.json`。两者都在下一次请求时重新加载内存状态。

## 成本上限（计划中，v1 未实现）

财务汇总里有 `cost` 字段，但目前还没有上限拦截。v2 的预期形态：

```ts
type CostCap = { dailyUSD: number; monthToDateUSD: number; hardBlock: boolean };
```

设置后，服务器将在日上限被触及后拒绝入队新的 `cloud` Job。钩子已就位（`pickQueueProviderId` 返回一个 `providerId`——加一行「会不会超限？」检查只需 5 行改动）。

## 接下来

- [Local LLM 集成](/docs/10-local-llm) —— 驱动路由的主机等级探测
- [完整 API 参考](/docs/13-api-reference) —— 财务 + 策略 + 模型路由端点
- [技术栈](/tech-stack) —— 相关库的版本固定
