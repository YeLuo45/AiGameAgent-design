# 10 · 本地大模型集成

AiGameAgent 为**本地优先（local-first）**的 LLM 使用而构建。默认上游是 `127.0.0.1:11434/v1` 上的 Ollama；工作室会自动检测宿主机的硬件，并推荐一个合适的模型档位。老板可以切换到云端以应对会议档位的需求，而无需改动栈中的其他部分。

**源码：** `apps/studio-server/src/index.ts`（`getWinGpuInfo`、`recommendLocalModels`、`getAdviceSnapshot`）+ `apps/studio-web/src/main.ts`（`setupPolicyUI`）

## 为什么要本地优先？

三个原因：

1. **成本**：在 16 GB GPU 上跑一个 7B Q4 模型是按 token 免费的。换成云端大约是 $0.15 / 1k 输出 token。
2. **隐私**：工作室的源码、章程（charter）和游戏 prompt 不会离开本机。
3. **延迟**：在本地硬件上跑 7B 模型，首字块延迟约 50-200ms；同样的请求打到远端 API 约 500-2000ms。

权衡在质量：7B 不如 70B。所以工作室采取**执行用本地、会议用云端**的策略（会议档位的 3 个领导型 Agent 能从更强的推理能力中受益）。

## 硬件检测

```ts
async function getWinGpuInfo(): Promise<{ gpuName?: string; vramGB?: number } | null> {
  if (process.platform !== "win32") return null;
  const ps = [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress"
  ];
  const txt = await execFileText("powershell", ps, 4500);
  const obj = JSON.parse(txt) as any;
  const name = typeof obj?.Name === "string" ? obj.Name : undefined;
  const ram = typeof obj?.AdapterRAM === "number" ? obj?.AdapterRAM : ...;
  const vramGB = typeof ram === "number" ? Math.round((ram / (1024 ** 3)) * 10) / 10 : undefined;
  return { gpuName: name, vramGB };
}
```

> 仅在 Windows 上通过 PowerShell + CIM 实现。在 Linux/macOS 上，`vramGB` 为 `undefined`，推荐器会回退到内存判断。

内存方面，`os.totalmem()` 跨平台可用。转换为 GB：

```ts
function gb(n: number) { return Math.round((n / (1024 ** 3)) * 10) / 10; }
```

## 模型推荐器

```ts
function recommendLocalModels(vramGB?: number, memGB?: number): string[] {
  const out: string[] = [];
  const v = vramGB ?? 0;
  const m = memGB ?? 0;
  if (v >= 24) out.push("32B 量化（Q4）", "14B 全精度/量化", "7B 全精度");
  else if (v >= 16) out.push("14B 量化（Q4/Q5）", "7B 全精度/量化");
  else if (v >= 8)  out.push("7B 量化（Q4/Q5）", "3B/4B 量化");
  else if (m >= 16) out.push("3B/4B 量化（CPU 跑）", "7B 量化（慢）");
  else              out.push("3B 量化（CPU 跑）");
  return out;
}
```

这是一个启发式表格——不是基准测试。老板随时可以通过 `/api/system/route` 按 Agent 覆盖。

## 主机档位（S / A / B / C）

advice 端点还会结合 VRAM、内存和一次性的基准测试，给出一个粗略的档位：

```ts
type Advice = {
  recommendedProviderId: string;        // "local" or "cloud"
  recommendedComputeSlots: number;      // 1-8
  grade: "S" | "A" | "B" | "C";
  localAgentCap: number;                // 能并行跑多少个 Agent
  notes: string[];
  localModelsSuggested: string[];
  observed: {
    memGB: number;
    gpuName?: string;
    vramGB?: number;
    local: { check: ProviderCheck; bench: BenchResult };
    cloud: { check: ProviderCheck };
  };
};
```

档位决定了 `project_limit`（S=3，A=2，B/C=1），也用于秘书 HUD 的"advice"提示。

## 基准测试端点

`POST /api/bench` 发起一次 `chat/completions` 请求并测量首字块延迟：

```ts
const body = {
  model: process.env.STUDIO_MODEL ?? "llama3.2",
  stream: true,
  messages: [{ role: "user", content: "输出 10 个数字，用逗号分隔。" }]
};
```

它返回：

```ts
{ ok: true, firstChunkMs: number, sampleChars: number, hint: string }
```

`POST /api/bench/sweep` 会在并发度 1、2、3 下运行基准测试，并报告每个并发度下近似 p50 的延迟。这是 advice 快照用来细化其推荐结果的输入。

## 感知流式的 SSE 代理

`/v1/*` 代理理解 SSE。对每个 `data:` 行：

1. 将原始 chunk 转发给客户端
2. 如果 chunk 中包含 `delta.content`，发出 `llm.chunk` 并附带文本
3. 如果 chunk 中包含 `delta.tool_calls`，按工具发出 `tool.start`
4. 在 `[DONE]` 时，发出 `llm.message_done` 并对每个活跃的工具发出 `tool.end`

对于非 SSE 响应（部分上游始终返回完整 JSON），代理仍会发出一个 `llm.chunk`，附带解析后的内容，以及一个 `llm.message_done`。

## 处理奇怪的上游格式

小型本地模型经常返回包裹在自然语言中的 JSON。服务端提供了三种回退方案用于会议纪要解析：

1. 严格 JSON：`JSON.parse(text).lines[]`
2. 去掉 ```json 围栏，再 `JSON.parse`
3. `sliceOutermostJsonObject` 抓取第一个 `{...}` 块

如果以上三种都失败，会用一条正则 `^(Secretary|Producer|Technical Director|Creative Director)\s*[:：]\s*(.+)$` 逐行解析。当模型太小、无法遵循 JSON 指令时，这条正则对 `Q: ... A: ...` 模式仍然有效。

## 通过代理使用 Cursor / Continue / Cline

"杀手级特性"——任何 OpenAI 兼容的客户端都可以指向工作室：

```json5
// Cursor 设置（或 .vscode/settings.json）
{
  "openai.baseUrl": "http://127.0.0.1:8787/v1",
  "openai.apiKey": "ignored-by-proxy"
}
```

当客户端在请求中带上这些头时：

```
x-studio-agent: <agentId>
x-studio-task: <task description>
```

代理会：

1. 将请求转发到上游
2. 发出 `agent.assign { task }`，让办公区显示该 Agent 正在思考
3. 像往常一样推送 `llm.chunk` 事件
4. 返回客户端期望的同一个 SSE 流

这就是 `local-llm-integration` 规范中承担关键作用的需求：

> **场景：Cursor 通过代理流式发送可见事件**
> - **当** 用户将 OpenAI 兼容客户端（如 Cursor）的 `baseURL` 指向 `http://127.0.0.1:<studio-port>/v1`
> - **则** 系统应记录并派发 `llm.chunk` 和 `llm.message_done` 事件，供 Studio Web UI 实时展示

## 推荐的 Ollama 安装

```bash
# 安装 Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 拉取默认模型
ollama pull llama3.2
ollama pull qwen2.5-coder:7b

# 验证
curl http://127.0.0.1:11434/v1/models
```

然后在工作室中设置 `STUDIO_UPSTREAM_BASE_URL=http://127.0.0.1:11434/v1`（即默认值）。

若要在更强的 GPU 上跑更大的模型：

```bash
ollama pull qwen2.5-coder:32b-instruct-q4_K_M
# 更新 STUDIO_MODEL=qwen2.5-coder:32b-instruct-q4_K_M
```

## 故障排查

| 症状 | 可能原因 | 修复 |
|---------|--------------|-----|
| `bench.ok = false`，`note: upstream_not_streaming` | 上游不支持 `stream: true` | 换个模型，或设置 `STREAM=false`（v1 暂不支持） |
| 所有请求都报 `error: upstream_5xx` | Ollama 崩溃或没有模型加载 | `ollama list` 后 `ollama pull <model>` |
| `firstChunkMs` 始终 > 5000 | 模型对 VRAM 而言太大，回退到 CPU | 降低模型规模或升级硬件 |
| 工作室提示 "no provider" | `STUDIO_UPSTREAM_BASE_URL` 不可达 | 用 `curl $STUDIO_UPSTREAM_BASE_URL/models` 验证 |
| 慢但能跑 | GPU 被其他应用争用 | 关掉游戏、带有 WebGL 的浏览器等 |

## 接下来

- [H5 与小游戏平台](/docs/11-minigame-platforms) —— 当本地模型本身就是游戏时（例如文字冒险）
- [财务与模型路由](/docs/09-finance-and-routing) —— 本地 vs 云端的成本如何被追踪
- [技术栈](/tech-stack) —— 精确的版本号
