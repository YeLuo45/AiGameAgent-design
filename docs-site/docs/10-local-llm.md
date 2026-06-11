# 10 · Local LLM Integration

AiGameAgent is built for **local-first** LLM use. The default upstream is Ollama on `127.0.0.1:11434/v1`; the studio auto-detects the host's hardware and recommends a model tier that fits. The boss can switch up to cloud for the meeting tier without touching the rest of the stack.

**Source:** `apps/studio-server/src/index.ts` (`getWinGpuInfo`, `recommendLocalModels`, `getAdviceSnapshot`) + `apps/studio-web/src/main.ts` (`setupPolicyUI`)

## Why local-first?

Three reasons:

1. **Cost**: a 7B Q4 model running on a 16 GB GPU is free per-token. The cloud alternative is ~$0.15 / 1k output tokens.
2. **Privacy**: the studio's source code, charter, and game prompts never leave the box.
3. **Latency**: a 7B on local hardware is ~50-200ms first-chunk; the same request to a remote API is ~500-2000ms.

The trade-off is quality: a 7B is worse than a 70B. So the studio uses **local for execution** and **cloud for the meeting** (where the 3 leadership agents benefit from stronger reasoning).

## Hardware detection

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
  const ram = typeof obj?.AdapterRAM === "number" ? obj.AdapterRAM : ...;
  const vramGB = typeof ram === "number" ? Math.round((ram / (1024 ** 3)) * 10) / 10 : undefined;
  return { gpuName: name, vramGB };
}
```

> Windows-only via PowerShell + CIM. On Linux/macOS, `vramGB` is `undefined` and the recommender falls back to RAM.

For RAM, `os.totalmem()` is cross-platform. Converted to GB:

```ts
function gb(n: number) { return Math.round((n / (1024 ** 3)) * 10) / 10; }
```

## Model recommender

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

This is a heuristic table — not a benchmark. The boss can always override per-agent via `/api/system/route`.

## Host grade (S / A / B / C)

The advice endpoint also computes a coarse grade by combining VRAM, RAM, and a 1-shot bench:

```ts
type Advice = {
  recommendedProviderId: string;        // "local" or "cloud"
  recommendedComputeSlots: number;      // 1-8
  grade: "S" | "A" | "B" | "C";
  localAgentCap: number;                // how many agents can run in parallel
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

The grade drives `project_limit` (S=3, A=2, B/C=1) and the secretary HUD's "advice" callout.

## Bench endpoint

`POST /api/bench` issues a single `chat/completions` request and measures the first-chunk latency:

```ts
const body = {
  model: process.env.STUDIO_MODEL ?? "llama3.2",
  stream: true,
  messages: [{ role: "user", content: "输出 10 个数字，用逗号分隔。" }]
};
```

It returns:

```ts
{ ok: true, firstChunkMs: number, sampleChars: number, hint: string }
```

`POST /api/bench/sweep` runs the bench at concurrency levels 1, 2, 3 and reports p50-like latency per level. This is the input the advice snapshot uses to refine its recommendation.

## Streaming-aware SSE proxy

The `/v1/*` proxy understands SSE. For each `data:` line it:

1. Forwards the raw chunk to the client
2. If the chunk contains `delta.content`, emits `llm.chunk` with the text
3. If the chunk contains `delta.tool_calls`, emits `tool.start` per tool
4. On `[DONE]`, emits `llm.message_done` and `tool.end` per active tool

For non-SSE responses (some upstreams always return full JSON), the proxy still emits a single `llm.chunk` with the parsed content and a `llm.message_done`.

## Handling weird upstream shapes

Small local models often return JSON wrapped in prose. The server has three fallbacks for meeting transcript parsing:

1. Strict JSON: `JSON.parse(text).lines[]`
2. Strip ```json fences, then JSON.parse
3. `sliceOutermostJsonObject` to grab the first `{...}` block

If all three fail, a regex on `^(秘书|制作人|技术总监|创意总监)\s*[:：]\s*(.+)$` parses line-by-line. This works for `Q: ... A: ...` patterns even when the model is too small to follow JSON instructions.

## Cursor / Continue / Cline via proxy

The "killer feature" — any OpenAI-compatible client can point at the studio:

```json5
// Cursor settings (or .vscode/settings.json)
{
  "openai.baseUrl": "http://127.0.0.1:8787/v1",
  "openai.apiKey": "ignored-by-proxy"
}
```

When the client sends a request with these headers:

```
x-studio-agent: <agentId>
x-studio-task: <task description>
```

The proxy:

1. Forwards the request to the upstream
2. Emits `agent.assign { task }` so the office can show the agent thinking
3. Streams `llm.chunk` events as usual
4. Returns the same SSE stream the client expects

This is the `local-llm-integration` spec's load-bearing requirement:

> **Scenario: Cursor 通过代理可见流事件**
> - **WHEN** 用户将 OpenAI-compatible 客户端（如 Cursor）`baseURL` 指向 `http://127.0.0.1:<studio-port>/v1`
> - **THEN** 系统 SHALL 记录并分发 `llm.chunk` 与 `llm.message_done` 事件，供 Studio Web UI 实时显示

## Recommended Ollama setup

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a default model
ollama pull llama3.2
ollama pull qwen2.5-coder:7b

# Verify
curl http://127.0.0.1:11434/v1/models
```

Then in the studio, set `STUDIO_UPSTREAM_BASE_URL=http://127.0.0.1:11434/v1` (the default).

For larger models on a beefy GPU:

```bash
ollama pull qwen2.5-coder:32b-instruct-q4_K_M
# Update STUDIO_MODEL=qwen2.5-coder:32b-instruct-q4_K_M
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `bench.ok = false`, `note: upstream_not_streaming` | Upstream doesn't support `stream: true` | Pick a different model, or set `STREAM=false` (not in v1) |
| All requests fail with `error: upstream_5xx` | Ollama crashed, or no model loaded | `ollama list` and `ollama pull <model>` |
| `firstChunkMs` always > 5000 | Model too large for VRAM; CPU fallback | Drop model size or upgrade hardware |
| Studio says "no provider" | `STUDIO_UPSTREAM_BASE_URL` unreachable | `curl $STUDIO_UPSTREAM_BASE_URL/models` to verify |
| Slow but works | GPU contention with other apps | Close games, browsers with WebGL, etc. |

## Next

- [H5 & Mini-Game Platforms](/docs/11-minigame-platforms) — when the local model is the game itself (e.g. text adventure)
- [Finance & Model Routing](/docs/09-finance-and-routing) — how local vs cloud cost is tracked
- [Tech Stack](/tech-stack) — exact versions
